import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { budgets, categories, transactions, type Db } from '@mamoney/db';
import { periodRange } from '@mamoney/core';

const rowsOf = (res: any): any[] => res.rows ?? res;

export interface CategoryTotal { id: number | null; name: string; emoji: string | null; color: string | null; type: 'income' | 'expense'; sum: number; count: number }

export async function categoryTotals(db: Db, userId: number, from: Date, to: Date): Promise<CategoryTotal[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      emoji: categories.emoji,
      color: categories.color,
      type: transactions.type,
      sum: sql<string>`sum(${transactions.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to), sql`${transactions.type} <> 'transfer'`))
    .groupBy(categories.id, categories.name, categories.emoji, categories.color, transactions.type)
    .orderBy(sql`sum(${transactions.amount}) DESC`);
  return rows.map((r) => ({ ...r, name: r.name ?? 'без категории', sum: Number(r.sum), type: r.type as 'income' | 'expense' }));
}

/** Доходы/расходы по дням в часовом поясе пользователя. */
export async function dailySeries(db: Db, userId: number, from: Date, to: Date, tz: string) {
  const res = await db.execute(sql`
    SELECT to_char((occurred_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
           COALESCE(sum(amount) FILTER (WHERE type = 'income'), 0) AS income,
           COALESCE(sum(amount) FILTER (WHERE type = 'expense'), 0) AS expense
    FROM ${transactions}
    WHERE user_id = ${userId} AND occurred_at >= ${from.toISOString()} AND occurred_at < ${to.toISOString()}
    GROUP BY 1 ORDER BY 1`);
  return rowsOf(res).map((r) => ({ day: String(r.day), income: Number(r.income), expense: Number(r.expense) }));
}

/** Помесячно за последние N месяцев (включая текущий). */
export async function monthlySeries(db: Db, userId: number, months: number, tz: string) {
  const res = await db.execute(sql`
    WITH m AS (
      SELECT to_char(gs, 'YYYY-MM') AS month
      FROM generate_series(date_trunc('month', now() AT TIME ZONE ${tz}) - make_interval(months => ${months - 1}),
                           date_trunc('month', now() AT TIME ZONE ${tz}), interval '1 month') gs
    ), t AS (
      SELECT to_char(occurred_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
             sum(amount) FILTER (WHERE type = 'income') AS income,
             sum(amount) FILTER (WHERE type = 'expense') AS expense
      FROM ${transactions} WHERE user_id = ${userId} GROUP BY 1
    )
    SELECT m.month, COALESCE(t.income, 0) AS income, COALESCE(t.expense, 0) AS expense
    FROM m LEFT JOIN t USING (month) ORDER BY m.month`);
  return rowsOf(res).map((r) => ({ month: String(r.month), income: Number(r.income), expense: Number(r.expense) }));
}

export type BudgetPeriod = 'week' | 'month';

export async function listBudgets(db: Db, userId: number) {
  return db.select().from(budgets).where(eq(budgets.userId, userId));
}

export async function upsertBudget(db: Db, userId: number, v: { id?: number; categoryId: number | null; period: BudgetPeriod; amount: number }) {
  if (v.id) {
    const [b] = await db
      .update(budgets)
      .set({ categoryId: v.categoryId, period: v.period, amount: v.amount })
      .where(and(eq(budgets.id, v.id), eq(budgets.userId, userId)))
      .returning();
    return b ?? null;
  }
  const [b] = await db.insert(budgets).values({ userId, categoryId: v.categoryId, period: v.period, amount: v.amount }).returning();
  return b!;
}

export async function deleteBudget(db: Db, userId: number, id: number) {
  await db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.userId, userId)));
}

/** Бюджеты с потраченным в текущем периоде и прогнозом на конец периода. */
export async function budgetProgress(db: Db, userId: number, tz: string, now = new Date()) {
  const list = await listBudgets(db, userId);
  const out = [];
  for (const b of list) {
    const { start } = periodRange(b.period === 'week' ? 'week' : 'month', tz, now);
    const end = b.period === 'week' ? new Date(start.getTime() + 7 * 86400_000) : periodRange('month', tz, new Date(start.getTime() + 40 * 86400_000)).start;
    const conds = [eq(transactions.userId, userId), eq(transactions.type, 'expense'), gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)];
    if (b.categoryId) conds.push(eq(transactions.categoryId, b.categoryId));
    const [r] = await db.select({ spent: sql<string>`COALESCE(sum(${transactions.amount}), 0)` }).from(transactions).where(and(...conds));
    const spent = Number(r?.spent ?? 0);
    const elapsed = Math.max(1, (now.getTime() - start.getTime()) / 86400_000);
    const total = (end.getTime() - start.getTime()) / 86400_000;
    out.push({ ...b, spent, forecast: Math.round((spent / elapsed) * total * 100) / 100, periodStart: start, periodEnd: end });
  }
  return out;
}

/** Для уведомления в боте: какие бюджеты по этой категории перешли порог 80% или 100%. */
export async function budgetAlerts(db: Db, userId: number, categoryId: number | null, tz: string) {
  const all = await budgetProgress(db, userId, tz);
  return all
    .filter((b) => b.categoryId === null || b.categoryId === categoryId)
    .map((b) => ({ ...b, ratio: b.amount > 0 ? b.spent / b.amount : 0 }))
    .filter((b) => b.ratio >= 0.8);
}
