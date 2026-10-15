import { GrammyError } from 'grammy';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { transactions, users } from '@mamoney/db';
import { runScheduledReports } from '../src/cron.ts';
import { testBot } from './helpers.ts';

describe('отчёты по расписанию', () => {
  it('шлёт в понедельник в 9:00 по поясу пользователя, один раз; блокировка не удаляет данные', async () => {
    const t = await testBot();
    await t.text('100 кофе');
    // переносим операцию в прошлую неделю
    await t.db.update(transactions).set({ occurredAt: new Date('2026-10-14T10:00:00Z') });
    const monday9msk = new Date('2026-10-19T06:00:00Z');

    const sent: string[] = [];
    const api = { sendMessage: async (_id: number, text: string) => (sent.push(text), {}) } as any;
    expect(await runScheduledReports(t.db, api, monday9msk)).toMatchObject({ sent: 1 });
    expect(sent[0]).toContain('Итоги прошлой недели');
    expect(await runScheduledReports(t.db, api, monday9msk)).toMatchObject({ sent: 0 });

    // другой понедельник, бот заблокирован
    const blockedApi = {
      sendMessage: async () => {
        throw new GrammyError('Forbidden', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'sendMessage', {});
      },
    } as any;
    await t.db.update(transactions).set({ occurredAt: new Date('2026-10-21T10:00:00Z') });
    expect(await runScheduledReports(t.db, blockedApi, new Date('2026-10-26T06:00:00Z'))).toMatchObject({ blocked: 1 });
    const [u] = await t.db.select().from(users).where(eq(users.tgId, 42));
    expect(u!.blockedAt).not.toBeNull();
    expect((await t.db.select().from(transactions)).length).toBe(1);
  });
});
