import { describe, expect, it } from 'vitest';
import { buildApi, signInitData, verifyInitData } from '../src/index.ts';
import { testDb } from '../../bot/test/helpers.ts';

const TOKEN = '123:abc';
const user = { id: 77, first_name: 'Аня', username: 'anya' };

async function setup() {
  const db = await testDb();
  const app = await buildApi({ db, botToken: TOKEN, defaults: { timezone: 'Europe/Moscow', currency: 'RUB' } });
  const auth = { authorization: `tma ${signInitData(user, TOKEN)}` };
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: auth, payload: body as any });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null };
  };
  return { app, call, db };
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
});
