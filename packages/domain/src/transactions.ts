import { and, asc, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm';
import { accounts, categories, transactions, type Db } from '@mamoney/db';
import type { ReportRow } from '@mamoney/core';

export type Tx = typeof transactions.$inferSelect;

export async function addTransaction(db: Db, v: typeof transactions.$inferInsert): Promise<Tx> {
  const [t] = await db.insert(transactions).values(v).returning();
  return t!;
}

export async function getTransaction(db: Db, userId: number, id: number): Promise<Tx | null> {
  const [t] = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  return t ?? null;
}

export async function deleteTransaction(db: Db, userId: number, id: number): Promise<Tx | null> {
  const [t] = await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id))).returning();
  return t ?? null;
}

export async function updateTransaction(db: Db, userId: number, id: number, set: Partial<typeof transactions.$inferInsert>) {
  const [t] = await db.update(transactions).set(set).where(and(eq(transactions.userId, userId), eq(transactions.id, id))).returning();
  return t ?? null;
}

/** Баланс = начальные остатки счетов + доходы − расходы. Никаких хранимых счётчиков. */
export async function getBalance(db: Db, userId: number): Promise<number> {
  const [r] = await db.execute<{ balance: string }>(sql`
    SELECT
      COALESCE((SELECT sum(initial_balance) FROM ${accounts} WHERE user_id = ${userId} AND NOT archived), 0)
      + COALESCE((SELECT sum(CASE WHEN type = 'income' THEN amount WHEN type = 'expense' THEN -amount ELSE 0 END)
                  FROM ${transactions} WHERE user_id = ${userId}), 0) AS balance
  `).then((res: any) => res.rows ?? res);
  return Number(r?.balance ?? 0);
}

/** Установить баланс: подгоняем начальный остаток основного счёта. */
export async function setBalance(db: Db, userId: number, accountId: number, target: number) {
  const current = await getBalance(db, userId);
  await db
    .update(accounts)
    .set({ initialBalance: sql`${accounts.initialBalance} + ${target - current}` })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}

export async function totals(db: Db, userId: number, from?: Date, to?: Date) {
  const conds = [eq(transactions.userId, userId)];
  if (from) conds.push(gte(transactions.occurredAt, from));
  if (to) conds.push(lt(transactions.occurredAt, to));
  const [r] = await db
    .select({
      income: sql<string>`COALESCE(sum(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`COALESCE(sum(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
    })
    .from(transactions)
    .where(and(...conds));
  return { income: Number(r?.income ?? 0), expense: Number(r?.expense ?? 0) };
}

export async function reportRows(db: Db, userId: number, from: Date, to: Date): Promise<ReportRow[]> {
  const rows = await db
    .select({ type: transactions.type, amount: transactions.amount, title: transactions.title, category: categories.name })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)))
    .orderBy(asc(transactions.occurredAt));
  return rows.filter((r) => r.type !== 'transfer') as ReportRow[];
}

export async function recentTransactions(db: Db, userId: number, limit = 10) {
  return db
    .select({ tx: transactions, category: categories.name })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit);
}

export async function clearHistory(db: Db, userId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.update(accounts).set({ initialBalance: 0 }).where(eq(accounts.userId, userId));
  });
}

export interface TxFilter {
  from?: Date;
  to?: Date;
  type?: 'income' | 'expense';
  categoryId?: number;
  q?: string;
  limit?: number;
  /** Курсор: occurred_at|id последней записи предыдущей страницы */
  before?: { occurredAt: Date; id: number };
}

export async function listTransactions(db: Db, userId: number, f: TxFilter = {}) {
  const conds = [eq(transactions.userId, userId)];
  if (f.from) conds.push(gte(transactions.occurredAt, f.from));
  if (f.to) conds.push(lt(transactions.occurredAt, f.to));
  if (f.type) conds.push(eq(transactions.type, f.type));
  if (f.categoryId) conds.push(eq(transactions.categoryId, f.categoryId));
  if (f.q) conds.push(or(ilike(transactions.title, `%${f.q}%`), ilike(transactions.note, `%${f.q}%`))!);
  if (f.before) {
    conds.push(
      or(
        lt(transactions.occurredAt, f.before.occurredAt),
        and(eq(transactions.occurredAt, f.before.occurredAt), lt(transactions.id, f.before.id)),
      )!,
    );
  }
  return db
    .select({ tx: transactions, category: { id: categories.id, name: categories.name, emoji: categories.emoji, color: categories.color } })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(Math.min(f.limit ?? 50, 200));
}

/** CSV для Excel (UTF-8 с BOM, разделитель «;»), от старых к новым. */
export async function exportCsv(db: Db, userId: number): Promise<Buffer> {
  const rows = await recentTransactions(db, userId, 1_000_000);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [
    'date;type;amount;currency;category;title',
    ...rows.reverse().map(({ tx, category }) =>
      [tx.occurredAt.toISOString(), tx.type, tx.amount.toFixed(2).replace('.', ','), q(tx.currency), q(category ?? ''), q(tx.title)].join(';'),
    ),
  ].join('\n');
  return Buffer.from('\uFEFF' + csv, 'utf8');
}
