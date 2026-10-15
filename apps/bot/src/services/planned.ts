import { and, asc, eq } from 'drizzle-orm';
import { planned, type Db } from '@mamoney/db';

export async function addPlanned(db: Db, userId: number, title: string) {
  const [p] = await db.insert(planned).values({ userId, title }).returning();
  return p!;
}

export async function listPlanned(db: Db, userId: number) {
  return db.select().from(planned).where(and(eq(planned.userId, userId), eq(planned.done, false))).orderBy(asc(planned.id));
}

export async function clearPlanned(db: Db, userId: number) {
  await db.delete(planned).where(eq(planned.userId, userId));
}
