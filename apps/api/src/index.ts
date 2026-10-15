import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isFutureDay, localDate, parseMessage, periodRange, resolveOccurredAt } from '@mamoney/core';
import { users, type Db } from '@mamoney/db';
import { eq, sql } from 'drizzle-orm';
import {
  type AiCategorizer,
  type User,
  addCategory,
  addPlanned,
  addTransaction,
  adminStats,
  BROADCAST_MAX_LENGTH,
  broadcastRecipients,
  listBroadcasts,
  runningBroadcast,
  startBroadcast,
  type SendText,
  isAdmin,
  budgetProgress,
  categoryTotals,
  dailySeries,
  defaultAccountId,
  deleteBudget,
  deletePlanned,
  deleteTransaction,
  clearHistory,
  ensureUser,
  exportCsv,
  getBalance,
  listCategories,
  listPlanned,
  listTransactions,
  monthlySeries,
  rememberRule,
  resolveCategory,
  setBalance,
  setCurrency,
  totals,
  updateCategory,
  updatePlanned,
  updateTransaction,
  upsertBudget,
} from '@mamoney/domain';
import { verifyInitData } from './auth.ts';

export { signInitData, verifyInitData } from './auth.ts';

export interface ApiOptions {
  db: Db;
  botToken: string;
  defaults: { timezone: string; currency: string };
  ai?: AiCategorizer;
  /** Папка со сборкой Mini App (apps/miniapp/dist), раздаётся по /app/ */
  staticDir?: string;
  logger?: boolean;
  /** Отправка файла пользователю в чат с ботом (выгрузка CSV из Mini App) */
  sendDocument?: (chatId: number, file: Buffer, filename: string) => Promise<void>;
  /** Кому доступна общая статистика */
  admin?: { ids: number[]; usernames: string[] };
  /** Отправка текста в чат с ботом (рассылки владельца) */
  sendText?: SendText;
  /** Пауза между сообщениями рассылки */
  broadcastDelayMs?: number;
}

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

const id = z.coerce.number().int().positive();
const money = z.coerce.number().positive().max(1e11);
const txBody = z.object({
  type: z.enum(['income', 'expense']),
  amount: money,
  title: z.string().trim().min(1).max(200),
  categoryId: id.nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export async function buildApi(opts: ApiOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request', issues: err.issues });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/healthz', async () => 'ok');

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir, prefix: '/app/' });
    app.get('/app', (_req, reply) => reply.redirect('/app/'));
    app.get('/', (_req, reply) => reply.redirect('/app/'));
  }

  await app.register(async (api) => {
    api.decorateRequest('user', null as unknown as User);
    api.addHook('preHandler', async (req: FastifyRequest, reply) => {
      const raw = req.headers.authorization?.replace(/^tma\s+/i, '') ?? '';
      const tg = verifyInitData(raw, opts.botToken);
      if (!tg) return reply.code(401).send({ error: 'unauthorized' });
      req.user = (await ensureUser(db, tg, opts.defaults)).user;
    });

    type PeriodQ = 'week' | 'month' | 'prev_week' | 'prev_month' | 'all';
    const periodToRange = (p: PeriodQ, tz: string) =>
      p === 'all' ? { start: new Date(0), end: new Date(Date.now() + 86400_000) } : periodRange(p, tz);
    const tzRange = (u: User, q: { from?: Date; to?: Date; period?: PeriodQ }) => {
      if (q.from || q.to) return { start: q.from ?? new Date(0), end: q.to ?? new Date() };
      return periodToRange(q.period ?? 'month', u.timezone);
    };
    const rangeQuery = z.object({
      period: z.enum(['week', 'month', 'prev_week', 'prev_month', 'all']).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    });

    api.get('/me', async (req) => {
      const u = req.user;
      return {
        user: { id: u.id, tgId: u.tgId, firstName: u.firstName, username: u.username, currency: u.currency, timezone: u.timezone, settings: u.settings },
        isAdmin: !!opts.admin && isAdmin(u, opts.admin),
        balance: await getBalance(db, u.id),
      };
    });

    api.patch('/settings', async (req) => {
      const b = z
        .object({
          currency: z.string().max(12).optional(),
          timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }).optional(),
          weeklyReport: z.boolean().optional(),
          monthlyReport: z.boolean().optional(),
          reportHour: z.number().int().min(0).max(23).optional(),
          cleanChat: z.boolean().optional(),
        })
        .parse(req.body);
      const { currency, timezone, ...settings } = b;
      if (currency !== undefined) await setCurrency(db, req.user.id, currency);
      const [u] = await db
        .update(users)
        .set({
          ...(timezone ? { timezone } : {}),
          settings: sql`${users.settings} || ${JSON.stringify(settings)}::jsonb`,
        })
        .where(eq(users.id, req.user.id))
        .returning();
      return { currency: u!.currency, timezone: u!.timezone, settings: u!.settings };
    });

    api.get('/summary', async (req) => {
      const u = req.user;
      const { start, end } = tzRange(u, rangeQuery.parse(req.query));
      const [t, cats, daily, budgets] = await Promise.all([
        totals(db, u.id, start, end),
        categoryTotals(db, u.id, start, end),
        dailySeries(db, u.id, start, end, u.timezone),
        budgetProgress(db, u.id, u.timezone),
      ]);
      const first = daily.find((d) => d.income || d.expense)?.day;
      const from = first && start.getTime() === 0 ? new Date(`${first}T00:00:00Z`) : start;
      const days = Math.max(1, Math.ceil((Math.min(end.getTime(), Date.now()) - from.getTime()) / 86400_000));
      return {
        from: start, to: end,
        balance: await getBalance(db, u.id),
        income: t.income, expense: t.expense, net: t.income - t.expense,
        avgExpensePerDay: Math.round((t.expense / days) * 100) / 100,
        categories: cats, daily, budgets,
      };
    });

    api.get('/analytics/monthly', async (req) => {
      const { months } = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }).parse(req.query);
      return monthlySeries(db, req.user.id, months, req.user.timezone);
    });

    const notAdmin = (req: FastifyRequest) => !opts.admin || !isAdmin(req.user, opts.admin);

    api.get('/admin/stats', async (req, reply) => {
      if (notAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
      return adminStats(db);
    });

    api.get('/admin/broadcasts', async (req, reply) => {
      if (notAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
      return { recipients: await broadcastRecipients(db), items: await listBroadcasts(db) };
    });

    api.post('/admin/broadcast', async (req, reply) => {
      if (notAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
      if (!opts.sendText) return reply.code(501).send({ error: 'not_available' });
      const { text, test } = z
        .object({ text: z.string().trim().min(1).max(BROADCAST_MAX_LENGTH), test: z.boolean().optional() })
        .parse(req.body);
      // Пробная отправка — только себе
      if (test) return { status: await opts.sendText(req.user.tgId, text) };
      if (await runningBroadcast(db)) return reply.code(409).send({ error: 'already_running' });
      try {
        const { broadcast } = await startBroadcast(db, opts.sendText, text, { delayMs: opts.broadcastDelayMs });
        return reply.code(202).send(broadcast);
      } catch (e) {
        // одновременный второй запуск отсекает уникальный индекс
        if (JSON.stringify(e).includes('23505') || /broadcasts_one_running/.test(String(e))) {
          return reply.code(409).send({ error: 'already_running' });
        }
        throw e;
      }
    });

    api.put('/balance', async (req) => {
      const { balance } = z.object({ balance: z.coerce.number().min(-1e11).max(1e11) }).parse(req.body);
      await setBalance(db, req.user.id, await defaultAccountId(db, req.user.id), balance);
      return { balance: await getBalance(db, req.user.id) };
    });

    api.post('/export', async (req, reply) => {
      if (!opts.sendDocument) return reply.code(501).send({ error: 'not_available' });
      await opts.sendDocument(req.user.tgId, await exportCsv(db, req.user.id), 'mamoney.csv');
      return { sent: true };
    });

    // ----- Операции -----
    api.delete('/transactions', async (req, reply) => {
      z.object({ confirm: z.literal('all') }).parse(req.query);
      await clearHistory(db, req.user.id);
      return reply.code(204).send();
    });

    api.get('/transactions', async (req) => {
      const q = rangeQuery
        .extend({
          type: z.enum(['income', 'expense']).optional(),
          categoryId: id.optional(),
          q: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().regex(/^\d+:\d+$/).optional(),
        })
        .parse(req.query);
      const before = q.cursor ? { occurredAt: new Date(Number(q.cursor.split(':')[0])), id: Number(q.cursor.split(':')[1]) } : undefined;
      const range = q.period ? periodToRange(q.period, req.user.timezone) : null;
      const rows = await listTransactions(db, req.user.id, { ...q, from: range?.start ?? q.from, to: range?.end ?? q.to, before });
      const lastRow = rows.at(-1);
      return {
        items: rows.map((r) => ({ ...r.tx, category: r.category?.id ? r.category : null })),
        nextCursor: rows.length === q.limit && lastRow ? `${lastRow.tx.occurredAt.getTime()}:${lastRow.tx.id}` : null,
      };
    });

    api.post('/transactions', async (req, reply) => {
      const b = txBody.parse(req.body);
      const u = req.user;
      // Дата ещё не наступила — это будущая трата, а не операция: в баланс она не попадает
      if (b.occurredAt && isFutureDay(b.occurredAt, u.timezone)) {
        const p = await addPlanned(db, u.id, b.title, { amount: b.amount, dueDate: localDate(b.occurredAt, u.timezone), type: b.type });
        return reply.code(201).send({ planned: p });
      }
      const cats = await listCategories(db, u.id, b.type);
      if (b.categoryId && !cats.some((c) => c.id === b.categoryId)) return reply.code(400).send({ error: 'bad_category' });
      const categoryId = b.categoryId ?? (await resolveCategory(db, u.id, { type: b.type, title: b.title, text: b.title, hint: null }, opts.ai)).category.id;
      const t = await addTransaction(db, {
        userId: u.id, accountId: await defaultAccountId(db, u.id), categoryId, type: b.type, amount: b.amount,
        currency: u.currency, title: b.title.toLowerCase(), note: b.note ?? null, occurredAt: b.occurredAt ?? new Date(), source: 'app',
      });
      if (b.categoryId) await rememberRule(db, u.id, t.title, b.categoryId);
      return reply.code(201).send(t);
    });

    /** Быстрое добавление строкой, как в боте: «350 кофе», несколько строк */
    api.post('/transactions/quick', async (req, reply) => {
      const { text } = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
      const u = req.user;
      const accountId = await defaultAccountId(db, u.id);
      const created = [];
      const planned = [];
      const errors = [];
      for (const [i, r] of parseMessage(text).entries()) {
        if (!r.ok) { errors.push({ line: i + 1, error: r.error }); continue; }
        const occurredAt = resolveOccurredAt(r.tx.date, r.tx.dayOffset, u.timezone);
        if (isFutureDay(occurredAt, u.timezone)) {
          planned.push(await addPlanned(db, u.id, r.tx.title, { amount: r.tx.amount, dueDate: localDate(occurredAt, u.timezone), type: r.tx.type }));
          continue;
        }
        const { category } = await resolveCategory(db, u.id, { type: r.tx.type, title: r.tx.title, text, hint: r.tx.categoryHint }, opts.ai);
        created.push(await addTransaction(db, {
          userId: u.id, accountId, categoryId: category.id, type: r.tx.type, amount: r.tx.amount, currency: u.currency,
          title: r.tx.title, occurredAt, source: 'app', rawText: text,
        }));
      }
      return reply.code(created.length || planned.length ? 201 : 400).send({ created, planned, errors });
    });

    api.patch('/transactions/:id', async (req, reply) => {
      const txId = id.parse((req.params as any).id);
      const b = txBody.partial().parse(req.body);
      if (b.categoryId) {
        const cats = await listCategories(db, req.user.id);
        if (!cats.some((c) => c.id === b.categoryId)) return reply.code(400).send({ error: 'bad_category' });
      }
      const t = await updateTransaction(db, req.user.id, txId, { ...b, ...(b.title ? { title: b.title.toLowerCase() } : {}) });
      if (!t) return reply.code(404).send({ error: 'not_found' });
      if (b.categoryId) await rememberRule(db, req.user.id, t.title, b.categoryId);
      return t;
    });

    api.delete('/transactions/:id', async (req, reply) => {
      const t = await deleteTransaction(db, req.user.id, id.parse((req.params as any).id));
      return t ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    });

    // ----- Категории -----
    api.get('/categories', async (req) => listCategories(db, req.user.id));

    api.post('/categories', async (req, reply) => {
      const b = z.object({ type: z.enum(['income', 'expense']), name: z.string().trim().min(1).max(40), emoji: z.string().max(8).optional(), color: z.string().max(16).optional() }).parse(req.body);
      const c = await addCategory(db, req.user.id, b.type, b.name);
      if (c === 'exists') return reply.code(409).send({ error: 'exists' });
      return reply.code(201).send(b.emoji || b.color ? await updateCategory(db, req.user.id, c.id, { emoji: b.emoji, color: b.color }) : c);
    });

    api.patch('/categories/:id', async (req, reply) => {
      const b = z.object({
        name: z.string().trim().min(1).max(40).optional(), emoji: z.string().max(8).nullable().optional(),
        color: z.string().max(16).nullable().optional(), sort: z.number().int().optional(), archived: z.boolean().optional(),
      }).parse(req.body);
      const c = await updateCategory(db, req.user.id, id.parse((req.params as any).id), b);
      return c ?? reply.code(404).send({ error: 'not_found' });
    });

    // ----- Бюджеты -----
    api.get('/budgets', async (req) => budgetProgress(db, req.user.id, req.user.timezone));
    const budgetBody = z.object({ categoryId: id.nullable(), period: z.enum(['week', 'month']).default('month'), amount: money });
    api.post('/budgets', async (req, reply) => reply.code(201).send(await upsertBudget(db, req.user.id, budgetBody.parse(req.body))));
    api.patch('/budgets/:id', async (req, reply) => {
      const b = await upsertBudget(db, req.user.id, { ...budgetBody.parse(req.body), id: id.parse((req.params as any).id) });
      return b ?? reply.code(404).send({ error: 'not_found' });
    });
    api.delete('/budgets/:id', async (req, reply) => {
      await deleteBudget(db, req.user.id, id.parse((req.params as any).id));
      return reply.code(204).send();
    });

    // ----- Планы -----
    const plannedBody = z.object({
      title: z.string().trim().min(1).max(500),
      amount: money.nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      done: z.boolean().optional(),
      type: z.enum(['income', 'expense']).optional(),
    });
    api.get('/planned', async (req) => listPlanned(db, req.user.id));
    api.post('/planned', async (req, reply) => {
      const b = plannedBody.parse(req.body);
      return reply.code(201).send(await addPlanned(db, req.user.id, b.title, b));
    });
    api.patch('/planned/:id', async (req, reply) => {
      const p = await updatePlanned(db, req.user.id, id.parse((req.params as any).id), plannedBody.partial().parse(req.body));
      return p ?? reply.code(404).send({ error: 'not_found' });
    });
    api.delete('/planned/:id', async (req, reply) => {
      await deletePlanned(db, req.user.id, id.parse((req.params as any).id));
      return reply.code(204).send();
    });
  }, { prefix: '/api' });

  return app;
}
