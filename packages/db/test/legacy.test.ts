import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { importLegacy, type Query } from '../scripts/legacy.ts';

const q = (db: PGlite): Query => async (text, params) => (await db.query(text, params as any[])).rows as any[];

async function freshTarget() {
  const db = new PGlite();
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(new URL(f, dir), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await db.exec(stmt);
    }
  }
  return db;
}

describe('importLegacy', () => {
  let legacy: PGlite;
  beforeAll(async () => {
    legacy = new PGlite();
    await legacy.exec(`
      CREATE SCHEMA tg_finance;
      CREATE TABLE tg_finance.tg_users (
        tg_id bigint primary key, first_name text, last_name text, username text, registered_at timestamp,
        balance numeric, total_expense numeric, total_income numeric, waiting_for_balance boolean, category_wait boolean,
        expense_categories text[], income_categories text[], state text, future text[], last_broadcast_at timestamp);
      INSERT INTO tg_finance.tg_users VALUES
        (111, 'Аня', NULL, 'anya', '2026-01-05 10:00', 9500, 700, 10000, false, false,
         ARRAY['кафе','транспорт','другие расходы'], ARRAY['зарплата','другие доходы'], 'calm', ARRAY['ремонт 5000','подарок маме'], NULL),
        (222, 'Без таблицы', NULL, NULL, NULL, 0, 0, 0, false, false, NULL, NULL, 'calm', NULL, NULL);
      CREATE TABLE tg_finance.transactions_111 (
        id bigint generated always as identity primary key, created_at timestamp not null default now(),
        type text not null, title text not null, category text, amount numeric(12,2) not null);
      INSERT INTO tg_finance.transactions_111 (created_at, type, title, category, amount) VALUES
        ('2026-10-01 09:00', 'income', 'зп', 'Зарплата', 10000),
        ('2026-10-02 12:30', 'expense', 'кфс', 'кафе', 500),
        ('2026-10-03 08:00', 'expense', 'McDonald''s', 'фастфуд', 200);
    `);
  });

  it('переносит пользователей, категории, операции и баланс; повторный запуск без дублей', async () => {
    const target = await freshTarget();
    const r1 = await importLegacy(q(legacy), q(target));
    expect(r1.every((r) => r.ok)).toBe(true);
    expect(r1.find((r) => r.tgId === 111)).toMatchObject({ importedCount: 3, newBalance: 9500, newIncome: 10000, newExpense: 700 });

    const r2 = await importLegacy(q(legacy), q(target));
    expect(r2.every((r) => r.ok)).toBe(true);
    const { rows } = await target.query<{ c: number }>('SELECT count(*)::int AS c FROM transactions');
    expect(rows[0]!.c).toBe(3);

    const cats = (await target.query<{ name: string }>(
      `SELECT c.name FROM categories c JOIN users u ON u.id = c.user_id WHERE u.tg_id = 111 AND c.type = 'expense' ORDER BY 1`,
    )).rows.map((x) => x.name);
    expect(cats).toEqual(['другие расходы', 'кафе', 'транспорт', 'фастфуд']);

    const planned = (await target.query<{ title: string }>('SELECT title FROM planned ORDER BY id')).rows.map((x) => x.title);
    expect(planned).toEqual(['ремонт 5000', 'подарок маме']);

    const tx = (await target.query<{ title: string; cat: string | null }>(
      `SELECT t.title, c.name AS cat FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.legacy_id`,
    )).rows;
    expect(tx[0]).toEqual({ title: 'зп', cat: 'зарплата' });
    expect(tx[2]).toEqual({ title: "mcdonald's", cat: 'фастфуд' });
  });
});
