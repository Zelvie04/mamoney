import { sql } from 'drizzle-orm';
import type { Db } from '@mamoney/db';

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : ((r as { rows?: Record<string, unknown>[] }).rows ?? []));
const num = (v: unknown) => Number(v ?? 0);

/**
 * Общая статистика для владельца бота. Только агрегаты: никаких имён, сумм и текстов конкретных людей.
 */
export async function adminStats(db: Db, now = new Date()) {
  const at = now.toISOString();
  const one = async (q: ReturnType<typeof sql>) => rowsOf(await db.execute(q))[0] ?? {};

  const u = await one(sql`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '1 day') AS new_1d,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '7 days') AS new_7d,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '30 days') AS new_30d,
      count(*) FILTER (WHERE last_seen_at >= ${at}::timestamptz - interval '1 day') AS seen_1d,
      count(*) FILTER (WHERE last_seen_at >= ${at}::timestamptz - interval '7 days') AS seen_7d,
      count(*) FILTER (WHERE last_seen_at >= ${at}::timestamptz - interval '30 days') AS seen_30d,
      count(*) FILTER (WHERE blocked_at IS NOT NULL) AS blocked,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = users.id)) AS with_tx
    FROM users`);

  const t = await one(sql`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '1 day') AS d1,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '7 days') AS d7,
      count(*) FILTER (WHERE created_at >= ${at}::timestamptz - interval '30 days') AS d30,
      count(*) FILTER (WHERE source = 'bot') AS bot,
      count(*) FILTER (WHERE source = 'app') AS app,
      count(*) FILTER (WHERE source = 'legacy') AS legacy,
      count(DISTINCT user_id) FILTER (WHERE created_at >= ${at}::timestamptz - interval '7 days') AS writers_7d
    FROM transactions`);

  const r = await one(sql`
    SELECT count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'blocked') AS blocked,
      count(*) FILTER (WHERE status = 'failed') AS failed
    FROM report_log WHERE created_at >= ${at}::timestamptz - interval '30 days'`);

  const lastRun = await one(sql`
    SELECT max(created_at) AS at,
      count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status <> 'sent') AS not_sent
    FROM report_log WHERE created_at >= (SELECT max(created_at) FROM report_log) - interval '2 hours'`);

  const misc = await one(sql`
    SELECT (SELECT count(*) FROM planned WHERE done = false) AS planned,
      (SELECT count(DISTINCT user_id) FROM budgets) AS budget_users,
      (SELECT count(*) FROM users WHERE (settings->>'currencyChosen')::boolean IS TRUE) AS currency_chosen`);

  const daily = rowsOf(
    await db.execute(sql`
      WITH d AS (
        SELECT gs::date AS day FROM generate_series((${at}::timestamptz - interval '29 days')::date, ${at}::timestamptz::date, interval '1 day') gs
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM users WHERE created_at::date = d.day) AS new_users,
        (SELECT count(DISTINCT user_id) FROM transactions WHERE created_at::date = d.day) AS active_users,
        (SELECT count(*) FROM transactions WHERE created_at::date = d.day) AS tx
      FROM d ORDER BY d.day`),
  ).map((x) => ({ day: String(x.day), newUsers: num(x.new_users), activeUsers: num(x.active_users), tx: num(x.tx) }));

  return {
    users: {
      total: num(u.total), new1d: num(u.new_1d), new7d: num(u.new_7d), new30d: num(u.new_30d),
      seen1d: num(u.seen_1d), seen7d: num(u.seen_7d), seen30d: num(u.seen_30d),
      blocked: num(u.blocked), withTransactions: num(u.with_tx), currencyChosen: num(misc.currency_chosen),
    },
    transactions: {
      total: num(t.total), d1: num(t.d1), d7: num(t.d7), d30: num(t.d30), writers7d: num(t.writers_7d),
      bySource: { bot: num(t.bot), app: num(t.app), legacy: num(t.legacy) },
    },
    reports: {
      last30d: { sent: num(r.sent), blocked: num(r.blocked), failed: num(r.failed) },
      lastRun: lastRun.at ? { at: new Date(String(lastRun.at)).toISOString(), sent: num(lastRun.sent), notSent: num(lastRun.not_sent) } : null,
    },
    planned: num(misc.planned),
    budgetUsers: num(misc.budget_users),
    daily,
  };
}
export type AdminStats = Awaited<ReturnType<typeof adminStats>>;

/** Кто считается владельцем: по tg id или username из переменных окружения */
export function isAdmin(u: { tgId: number; username: string | null }, cfg: { ids: number[]; usernames: string[] }) {
  return cfg.ids.includes(u.tgId) || (!!u.username && cfg.usernames.includes(u.username.toLowerCase()));
}

export function parseAdminConfig(env: Record<string, string | undefined>) {
  const ids = [env.ADMIN_TG_IDS, env.ADMIN_CHAT_ID].join(',').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const usernames = (env.ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  return { ids, usernames };
}

export function formatStats(s: AdminStats): string {
  const L = [
    '<b>Статистика MaMoney</b>',
    '',
    `<b>Пользователи:</b> ${s.users.total}`,
    `новых: ${s.users.new1d} за сутки · ${s.users.new7d} за неделю · ${s.users.new30d} за месяц`,
    `заходили: ${s.users.seen1d} за сутки · ${s.users.seen7d} за неделю · ${s.users.seen30d} за месяц`,
    `записывали траты за неделю: ${s.transactions.writers7d}`,
    `хоть раз что-то записали: ${s.users.withTransactions}`,
    `заблокировали бота: ${s.users.blocked}`,
    '',
    `<b>Операции:</b> ${s.transactions.total}`,
    `за сутки ${s.transactions.d1} · за неделю ${s.transactions.d7} · за месяц ${s.transactions.d30}`,
    `через бота ${s.transactions.bySource.bot} · в приложении ${s.transactions.bySource.app} · перенесено ${s.transactions.bySource.legacy}`,
    '',
    `<b>Отчёты за 30 дней:</b> доставлено ${s.reports.last30d.sent}, бот заблокирован ${s.reports.last30d.blocked}, ошибок ${s.reports.last30d.failed}`,
  ];
  if (s.reports.lastRun) L.push(`последняя рассылка: доставлено ${s.reports.lastRun.sent}, не дошло ${s.reports.lastRun.notSent}`);
  L.push('', `Будущих трат в планах: ${s.planned} · бюджеты ведут: ${s.budgetUsers}`);
  return L.join('\n');
}
