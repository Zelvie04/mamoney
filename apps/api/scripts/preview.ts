// Демо-сервер для просмотра Mini App без Telegram: PGlite в памяти + тестовые данные.
// Запуск: npx tsx apps/api/scripts/preview.ts  →  http://localhost:3999/app/
import { fileURLToPath } from 'node:url';
import { testDb } from '../../bot/test/helpers.ts';
import { addTransaction, defaultAccountId, ensureUser, listCategories, upsertBudget, addPlanned, setBalance } from '@mamoney/domain';
import { buildApi, signInitData } from '../src/index.ts';

const TOKEN = 'preview:token';
const db = await testDb();
const { user } = await ensureUser(db, { id: 1, first_name: 'Зелв' }, { timezone: 'Europe/Moscow', currency: 'RUB' });
const acc = await defaultAccountId(db, user.id);
const cats = await listCategories(db, user.id);
const cat = (n: string) => cats.find((c) => c.name === n)!.id;
const items: [string, string, number][] = [
  ['продукты', 'магнит', 1240], ['кафе', 'кофе', 290], ['транспорт', 'такси', 450], ['кафе', 'кфс', 520],
  ['продукты', 'пятёрочка', 860], ['связь', 'мтс', 600], ['развлечения', 'кино', 900], ['здоровье', 'аптека', 740],
  ['транспорт', 'метро', 70], ['подписки', 'яндекс плюс', 399], ['одежда', 'кроссовки', 6900], ['дом', 'квартплата', 7800],
];
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
for (let d = 0; d < 95; d++) {
  const n = Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const [c, title, base] = items[Math.floor(rnd() * items.length)]!;
    await addTransaction(db, { userId: user.id, accountId: acc, categoryId: cat(c), type: 'expense', amount: Math.round(base * (0.6 + rnd() * 0.8)), title, occurredAt: new Date(Date.now() - d * 86400_000 - rnd() * 36e6) });
  }
  if (d % 30 === 3) await addTransaction(db, { userId: user.id, accountId: acc, categoryId: cat('зарплата'), type: 'income', amount: 85000, title: 'зп', occurredAt: new Date(Date.now() - d * 86400_000) });
  if (d % 30 === 18) await addTransaction(db, { userId: user.id, accountId: acc, categoryId: cat('подработка'), type: 'income', amount: 12000, title: 'фриланс', occurredAt: new Date(Date.now() - d * 86400_000) });
}
await setBalance(db, user.id, acc, 48350);
await upsertBudget(db, user.id, { categoryId: cat('кафе'), period: 'month', amount: 4000 });
await upsertBudget(db, user.id, { categoryId: null, period: 'month', amount: 60000 });
await upsertBudget(db, user.id, { categoryId: cat('развлечения'), period: 'week', amount: 1500 });
await addPlanned(db, user.id, 'ремонт машины', { amount: 25000, dueDate: new Date(Date.now() + 36 * 86400_000).toLocaleDateString('en-CA') });
await addPlanned(db, user.id, 'страховка', { amount: 4200, dueDate: new Date(Date.now() + 3 * 86400_000).toLocaleDateString('en-CA') });
await addPlanned(db, user.id, 'премия', { amount: 15000, type: 'income', dueDate: new Date(Date.now() + 12 * 86400_000).toLocaleDateString('en-CA') });
await addPlanned(db, user.id, 'подарок маме');

const app = await buildApi({ db, botToken: TOKEN, defaults: { timezone: 'Europe/Moscow', currency: 'RUB' }, sendDocument: async () => {}, admin: { ids: [1], usernames: [] }, staticDir: fileURLToPath(new URL('../../miniapp/dist', import.meta.url)) });
await app.listen({ port: 3999 });
console.log('INIT_DATA=' + signInitData({ id: 1, first_name: 'Зелв' }, TOKEN));
