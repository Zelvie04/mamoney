import { desc, eq, isNull, sql } from 'drizzle-orm';
import { broadcasts, users, type Broadcast, type Db } from '@mamoney/db';
import { markBlocked } from './users.ts';

export type SendStatus = 'sent' | 'blocked' | 'failed';
/** Отправка одного сообщения; ошибки Telegram превращает в статус, не бросает */
export type SendText = (tgId: number, text: string) => Promise<SendStatus>;

export const BROADCAST_MAX_LENGTH = 4096;

/** Сколько человек получит рассылку: все, кто не заблокировал бота */
export async function broadcastRecipients(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(isNull(users.blockedAt));
  return r?.n ?? 0;
}

export async function listBroadcasts(db: Db, limit = 20): Promise<Broadcast[]> {
  return db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(limit);
}

export async function runningBroadcast(db: Db): Promise<Broadcast | null> {
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.status, 'running')).limit(1);
  return b ?? null;
}

/** После перезапуска процесса незавершённые рассылки уже не продолжатся */
export async function interruptRunningBroadcasts(db: Db): Promise<void> {
  await db
    .update(broadcasts)
    .set({ status: 'interrupted', finishedAt: new Date() })
    .where(eq(broadcasts.status, 'running'));
}

/**
 * Создаёт рассылку и сразу возвращает её; отправка идёт в фоне (done — когда закончится).
 * Тем, кто заблокировал бота, не пишем; новых заблокировавших помечаем.
 */
export async function startBroadcast(
  db: Db,
  send: SendText,
  text: string,
  { delayMs = 40, log = console.error }: { delayMs?: number; log?: (m: string) => void } = {},
): Promise<{ broadcast: Broadcast; done: Promise<Broadcast> }> {
  const list = await db.select({ tgId: users.tgId }).from(users).where(isNull(users.blockedAt)).orderBy(users.id);
  const [b] = await db.insert(broadcasts).values({ text, total: list.length }).returning();
  const counts = { sent: 0, blocked: 0, failed: 0 };
  const save = (extra: Partial<Broadcast> = {}) =>
    db.update(broadcasts).set({ ...counts, ...extra }).where(eq(broadcasts.id, b!.id)).returning();

  const done = (async () => {
    for (const [i, u] of list.entries()) {
      const status = await send(u.tgId, text).catch(() => 'failed' as const);
      counts[status]++;
      if (status === 'blocked') await markBlocked(db, u.tgId);
      if (i % 20 === 19) await save();
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); // ~25 сообщений в секунду, в пределах лимита Telegram
    }
    const [final] = await save({ status: 'done', finishedAt: new Date() });
    return final!;
  })().catch(async (e) => {
    log(`Рассылка ${b!.id} прервана: ${(e as Error).message}`);
    const [final] = await save({ status: 'interrupted', finishedAt: new Date() });
    return final!;
  });

  return { broadcast: b!, done };
}
