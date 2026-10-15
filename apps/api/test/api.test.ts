import { describe, expect, it } from 'vitest';
import { buildApi, signInitData, verifyInitData } from '../src/index.ts';
import { users } from '@mamoney/db';
import { testDb } from '../../bot/test/helpers.ts';

const TOKEN = '123:abc';
const user = { id: 77, first_name: 'Аня', username: 'anya' };

async function setup(extra: Partial<Parameters<typeof buildApi>[0]> = {}) {
  const db = await testDb();
  const sentDocs: { chatId: number; file: Buffer; filename: string }[] = [];
  const app = await buildApi({
    db, botToken: TOKEN, defaults: { timezone: 'Europe/Moscow', currency: 'RUB' },
    sendDocument: async (chatId, file, filename) => void sentDocs.push({ chatId, file, filename }),
    ...extra,
  });
  const auth = { authorization: `tma ${signInitData(user, TOKEN)}` };
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: auth, payload: body as any });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null };
  };
  return { app, call, db, sentDocs };
}

describe('initData', () => {
  it('подпись проверяется, подделка и протухшие данные — нет', () => {
    const ok = signInitData(user, TOKEN);
    expect(verifyInitData(ok, TOKEN)?.id).toBe(77);
    expect(verifyInitData(ok, 'other:token')).toBeNull();
    expect(verifyInitData(ok.replace('%22id%22%3A77', '%22id%22%3A78'), TOKEN)).toBeNull();
    expect(verifyInitData(signInitData(user, TOKEN, 1_000_000), TOKEN)).toBeNull();
  });
});

describe('API', () => {
  it('без подписи — 401', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });

  it('операции: создать, быстро добавить, список, правка, удаление, сводка', async () => {
    const { call } = await setup();
    const me = await call('GET', '/api/me');
    expect(me.body).toMatchObject({ user: { tgId: 77, currency: 'RUB' }, balance: 0 });

    const cats = (await call('GET', '/api/categories')).body as any[];
    const cafe = cats.find((c) => c.name === 'кафе');

    const created = await call('POST', '/api/transactions', { type: 'expense', amount: 450, title: 'Обед', categoryId: cafe.id });
    expect(created.status).toBe(201);

    const quick = await call('POST', '/api/transactions/quick', { text: 'зп 50000\n200 такси\nчушь' });
    expect(quick.status).toBe(201);
    expect(quick.body.created).toHaveLength(2);
    expect(quick.body.errors).toEqual([{ line: 3, error: 'no_amount' }]);

    const list = await call('GET', '/api/transactions?limit=2');
    expect(list.body.items).toHaveLength(2);
    expect(list.body.nextCursor).toMatch(/^\d+:\d+$/);
    const page2 = await call('GET', `/api/transactions?limit=2&cursor=${list.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    await call('POST', '/api/transactions', { type: 'expense', amount: 5, title: 'старое', occurredAt: '2025-01-10T10:00:00Z' });
    const month = await call('GET', '/api/transactions?period=month');
    expect(month.body.items.map((t: any) => t.title)).not.toContain('старое');
    expect((await call('GET', '/api/transactions?q=старое')).body.items).toHaveLength(1);
    await call('DELETE', `/api/transactions/${(await call('GET', '/api/transactions?q=старое')).body.items[0].id}`);

    const search = await call('GET', '/api/transactions?q=такс');
    expect(search.body.items.map((t: any) => t.title)).toEqual(['такси']);
    expect(search.body.items[0].category.name).toBe('транспорт');

    const patched = await call('PATCH', `/api/transactions/${created.body.id}`, { amount: 500 });
    expect(patched.body.amount).toBe(500);

    const sum = await call('GET', '/api/summary?period=month');
    expect(sum.body).toMatchObject({ income: 50000, expense: 700, net: 49300, balance: 49300 });
    expect(sum.body.categories.find((c: any) => c.name === 'кафе').sum).toBe(500);
    expect(sum.body.daily.length).toBeGreaterThan(0);

    expect((await call('DELETE', `/api/transactions/${created.body.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/transactions/${created.body.id}`)).status).toBe(404);

    const monthly = await call('GET', '/api/analytics/monthly?months=6');
    expect(monthly.body).toHaveLength(6);
    expect(monthly.body.at(-1)).toMatchObject({ income: 50000, expense: 200 });
  });

  it('чужую операцию не видно и не изменить', async () => {
    const { app, call } = await setup();
    const t = await call('POST', '/api/transactions', { type: 'expense', amount: 10, title: 'x' });
    const other = { authorization: `tma ${signInitData({ id: 99, first_name: 'B' }, TOKEN)}` };
    const r = await app.inject({ method: 'PATCH', url: `/api/transactions/${t.body.id}`, headers: other, payload: { amount: 1 } });
    expect(r.statusCode).toBe(404);
    const list = await app.inject({ url: '/api/transactions', headers: other });
    expect(list.json().items).toHaveLength(0);
  });

  it('бюджеты с прогрессом, категории, планы, настройки', async () => {
    const { call } = await setup();
    const cats = (await call('GET', '/api/categories')).body as any[];
    const food = cats.find((c) => c.name === 'продукты');
    await call('POST', '/api/budgets', { categoryId: food.id, period: 'month', amount: 1000 });
    await call('POST', '/api/transactions', { type: 'expense', amount: 850, title: 'магнит', categoryId: food.id });
    const b = (await call('GET', '/api/budgets')).body;
    expect(b[0]).toMatchObject({ amount: 1000, spent: 850 });

    const c = await call('POST', '/api/categories', { type: 'expense', name: 'Котик', emoji: '🐱' });
    expect(c.body).toMatchObject({ name: 'котик', emoji: '🐱' });
    expect((await call('POST', '/api/categories', { type: 'expense', name: 'котик' })).status).toBe(409);

    const p = await call('POST', '/api/planned', { title: 'отпуск', amount: 50000, dueDate: '2026-12-01' });
    expect(p.status).toBe(201);
    await call('PATCH', `/api/planned/${p.body.id}`, { done: true });
    expect((await call('GET', '/api/planned')).body).toHaveLength(0);

    const s = await call('PATCH', '/api/settings', { currency: 'byn', weeklyReport: false });
    expect(s.body).toMatchObject({ currency: 'BYN', settings: { weeklyReport: false, cleanChat: true } });
    expect((await call('PATCH', '/api/settings', { timezone: 'Mars/Base' })).status).toBe(400);
  });

  it('всё без бота: валюта, баланс, выгрузка, очистка, «всё время»', async () => {
    const { call, sentDocs } = await setup();
    expect((await call('GET', '/api/me')).body.user.settings.currencyChosen).toBeUndefined();

    const s = await call('PATCH', '/api/settings', { currency: 'byn' });
    expect(s.body).toMatchObject({ currency: 'BYN', settings: { currencyChosen: true } });
    expect((await call('PATCH', '/api/settings', { currency: '' })).body.currency).toBe('');
    expect((await call('PATCH', '/api/settings', { currency: 'x'.repeat(13) })).status).toBe(400);

    await call('POST', '/api/transactions', { type: 'expense', amount: 300, title: 'кофе', occurredAt: '2020-01-05T10:00:00Z' });
    await call('POST', '/api/transactions', { type: 'income', amount: 1000, title: 'зп' });
    expect((await call('PUT', '/api/balance', { balance: 5000 })).body).toEqual({ balance: 5000 });
    expect((await call('GET', '/api/me')).body.balance).toBe(5000);

    const all = (await call('GET', '/api/summary?period=all')).body;
    expect(all).toMatchObject({ income: 1000, expense: 300 });
    expect((await call('GET', '/api/transactions?period=all')).body.items).toHaveLength(2);

    expect((await call('POST', '/api/export')).body).toEqual({ sent: true });
    expect(sentDocs[0]!.chatId).toBe(77);
    expect(sentDocs[0]!.file.toString('utf8')).toContain('"кофе"');

    expect((await call('DELETE', '/api/transactions')).status).toBe(400);
    expect((await call('DELETE', '/api/transactions?confirm=all')).status).toBe(204);
    expect((await call('GET', '/api/transactions?period=all')).body.items).toHaveLength(0);
    expect((await call('GET', '/api/me')).body.balance).toBe(0);
  });

  it('дата в будущем — в будущие траты, а не в баланс', async () => {
    const { call } = await setup();
    const future = new Date(Date.now() + 10 * 86400_000);
    const r = await call('POST', '/api/transactions', { type: 'expense', amount: 5000, title: 'ремонт', occurredAt: future.toISOString() });
    expect(r.status).toBe(201);
    expect(r.body.planned).toMatchObject({ title: 'ремонт', amount: 5000, type: 'expense' });
    expect((await call('GET', '/api/me')).body.balance).toBe(0);

    const d = future.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
    const q = await call('POST', '/api/transactions/quick', { text: `${d} 700 подарок\n100 кофе` });
    expect(q.body.planned).toHaveLength(1);
    expect(q.body.created).toHaveLength(1);

    const list = (await call('GET', '/api/planned')).body as any[];
    expect(list.map((p) => p.title)).toEqual(['ремонт', 'подарок']);
    const noDate = await call('POST', '/api/planned', { title: 'отпуск' });
    expect(noDate.body.dueDate).toBeNull();
    expect(((await call('GET', '/api/planned')).body as any[]).at(-1).title).toBe('отпуск');
  });

  it('статистика только владельцу и без личных данных', async () => {
    const plain = await setup();
    expect((await plain.call('GET', '/api/admin/stats')).status).toBe(403);
    expect((await plain.call('GET', '/api/me')).body.isAdmin).toBe(false);

    const { call } = await setup({ admin: { ids: [], usernames: ['anya'] } });
    await call('POST', '/api/transactions', { type: 'expense', amount: 100, title: 'кофе' });
    expect((await call('GET', '/api/me')).body.isAdmin).toBe(true);
    const st = await call('GET', '/api/admin/stats');
    expect(st.status).toBe(200);
    expect(st.body.users).toMatchObject({ total: 1, new1d: 1, seen1d: 1, withTransactions: 1 });
    expect(st.body.transactions).toMatchObject({ total: 1, d1: 1, bySource: { app: 1 } });
    expect(st.body.daily).toHaveLength(30);
    expect(JSON.stringify(st.body)).not.toMatch(/anya|кофе|77/);
  });
  it('рассылка: только владельцу, пробная себе, всем кроме заблокировавших', async () => {
    const plain = await setup();
    expect((await plain.call('POST', '/api/admin/broadcast', { text: 'привет' })).status).toBe(403);

    const got: { chatId: number; text: string }[] = [];
    const { call, db } = await setup({
      admin: { ids: [], usernames: ['anya'] },
      broadcastDelayMs: 0,
      sendText: async (chatId, text) => {
        if (chatId === 2) return 'blocked';
        got.push({ chatId, text });
        return 'sent';
      },
    });
    await call('GET', '/api/me');
    await db.insert(users).values([{ tgId: 1 }, { tgId: 2 }, { tgId: 3, blockedAt: new Date() }]);
    expect((await call('GET', '/api/admin/broadcasts')).body).toMatchObject({ recipients: 3, items: [] });

    expect((await call('POST', '/api/admin/broadcast', { text: 'проба', test: true })).body).toEqual({ status: 'sent' });
    expect(got).toEqual([{ chatId: 77, text: 'проба' }]);
    expect((await call('POST', '/api/admin/broadcast', { text: '   ' })).status).toBe(400);

    const started = await call('POST', '/api/admin/broadcast', { text: 'Новая версия!' });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'running', total: 3 });
    let list: any;
    for (let i = 0; i < 50; i++) {
      list = (await call('GET', '/api/admin/broadcasts')).body;
      if (list.items[0].status !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(list.items[0]).toMatchObject({ status: 'done', total: 3, sent: 2, blocked: 1, failed: 0, text: 'Новая версия!' });
    expect(got.slice(1).map((g) => g.chatId).sort()).toEqual([1, 77]);
    expect(list.recipients).toBe(2); // заблокировавший помечен и больше не получит
  });
});
