import { and, eq } from 'drizzle-orm';
import { DEFAULT_EMOJI, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@mamoney/core';
import { accounts, botState, categories, users, type Db } from '@mamoney/db';

export interface TgUser { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string }
export type User = typeof users.$inferSelect;

export interface UserDefaults { timezone: string; currency: string }

/** Находит пользователя или регистрирует: счёт «Основной» и стандартные категории. */
export async function ensureUser(db: Db, tg: TgUser, defaults: UserDefaults): Promise<{ user: User; created: boolean }> {
  const [existing] = await db.select().from(users).where(eq(users.tgId, tg.id));
  if (existing) {
    if (existing.blockedAt || existing.username !== (tg.username ?? null) || existing.firstName !== (tg.first_name ?? null)) {
      const [u] = await db
        .update(users)
        .set({ blockedAt: null, username: tg.username ?? null, firstName: tg.first_name ?? null, lastName: tg.last_name ?? null })
        .where(eq(users.id, existing.id))
        .returning();
      return { user: u!, created: false };
    }
    return { user: existing, created: false };
  }

  return db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        tgId: tg.id,
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        timezone: defaults.timezone,
        currency: defaults.currency,
        settings: { weeklyReport: true, monthlyReport: true, cleanChat: true },
      })
      .onConflictDoNothing({ target: users.tgId })
      .returning();
    if (!u) {
      // Параллельная регистрация того же пользователя — берём уже созданного
      const [again] = await tx.select().from(users).where(eq(users.tgId, tg.id));
      return { user: again!, created: false };
    }
    await tx.insert(accounts).values({ userId: u.id, name: 'Основной', currency: u.currency, isDefault: true });
    await tx.insert(categories).values([
      ...DEFAULT_EXPENSE_CATEGORIES.map((name, sort) => ({ userId: u.id, type: 'expense' as const, name, sort, emoji: DEFAULT_EMOJI[name] ?? null })),
      ...DEFAULT_INCOME_CATEGORIES.map((name, sort) => ({ userId: u.id, type: 'income' as const, name, sort, emoji: DEFAULT_EMOJI[name] ?? null })),
    ]);
    return { user: u, created: true };
  });
}

export async function defaultAccountId(db: Db, userId: number): Promise<number> {
  const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.isDefault, true)));
  if (a) return a.id;
  const [created] = await db.insert(accounts).values({ userId, name: 'Основной', isDefault: true }).returning({ id: accounts.id });
  return created!.id;
}

export type BotStateName = 'idle' | 'balance' | 'category' | 'planned';

export async function getState(db: Db, userId: number): Promise<{ state: BotStateName; payload: Record<string, unknown> }> {
  const [s] = await db.select().from(botState).where(eq(botState.userId, userId));
  return { state: (s?.state as BotStateName) ?? 'idle', payload: (s?.payload as Record<string, unknown>) ?? {} };
}

export async function setState(db: Db, userId: number, state: BotStateName, payload: Record<string, unknown> = {}) {
  await db
    .insert(botState)
    .values({ userId, state, payload, updatedAt: new Date() })
    .onConflictDoUpdate({ target: botState.userId, set: { state, payload, updatedAt: new Date() } });
}

export async function markBlocked(db: Db, tgId: number) {
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.tgId, tgId));
}
