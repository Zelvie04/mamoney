import { and, asc, eq, sql } from 'drizzle-orm';
import { planned, type Db } from '@mamoney/db';

export type PlannedType = 'income' | 'expense';
export interface PlannedExtra { amount?: number | null; dueDate?: string | null; type?: PlannedType }

export async function addPlanned(db: Db, userId: number, title: string, extra: PlannedExtra = {}) {
  const [p] = await db
    .insert(planned)
    .values({ userId, title, amount: extra.amount ?? null, dueDate: extra.dueDate ?? null, type: extra.type ?? 'expense' })
    .returning();
  return p!;
}

/** Невыполненные планы: сначала с датой (ближайшие первыми), потом без даты */
export async function listPlanned(db: Db, userId: number) {
  return db
    .select()
    .from(planned)
    .where(and(eq(planned.userId, userId), eq(planned.done, false)))
    .orderBy(sql`${planned.dueDate} ASC NULLS LAST`, asc(planned.id));
}

export async function clearPlanned(db: Db, userId: number) {
  await db.delete(planned).where(eq(planned.userId, userId));
}

export async function updatePlanned(
  db: Db,
  userId: number,
  id: number,
  set: { title?: string; amount?: number | null; dueDate?: string | null; done?: boolean; type?: PlannedType },
) {
  const [p] = await db.update(planned).set(set).where(and(eq(planned.id, id), eq(planned.userId, userId))).returning();
  return p ?? null;
}

export async function deletePlanned(db: Db, userId: number, id: number) {
  await db.delete(planned).where(and(eq(planned.id, id), eq(planned.userId, userId)));
}
