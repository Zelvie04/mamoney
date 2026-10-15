import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Db } from '@mamoney/db';
import { createBot } from '../src/bot.ts';
import type { AiCategorizer } from '@mamoney/domain';

export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const dir = new URL('../../../packages/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(new URL(f, dir), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  return drizzle(pg, { schema }) as unknown as Db;
}

export interface Call { method: string; payload: any }

/** Бот с перехватом всех запросов к Telegram API. */
export async function testBot(
  opts: { ai?: AiCategorizer; db?: Db; admin?: { ids: number[]; usernames: string[] } } & Pick<Parameters<typeof createBot>[0], 'transcribe' | 'readImage'> = {},
) {
  const db = opts.db ?? (await testDb());
  const calls: Call[] = [];
  let msgId = 1000;
  const bot = createBot({
    db,
    token: 'test',
    ai: opts.ai,
    admin: opts.admin,
    transcribe: opts.transcribe,
    readImage: opts.readImage,
    downloadFile: async (id) => Buffer.from(`file:${id}`),
    publicUrl: 'https://mamoney.example',
    defaults: { timezone: 'Europe/Moscow', currency: 'RUB' },
    botInfo: {
      id: 1, is_bot: true, first_name: 'MaMoney', username: 'mamoney_test_bot',
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
    } as any,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method.startsWith('send') ? { message_id: ++msgId, date: 0, chat: { id: 1, type: 'private' } } : true } as any;
  });

  const user = { id: 42, is_bot: false, first_name: 'Тест', username: 'tester' };
  let updateId = 1;
  const text = async (t: string) => {
    const isCmd = t.startsWith('/');
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: user.id, type: 'private', first_name: user.first_name },
        from: user,
        text: t,
        ...(isCmd ? { entities: [{ type: 'bot_command', offset: 0, length: t.split(' ')[0]!.length }] } : {}),
      },
    } as any);
  };
  const media = async (extra: Record<string, unknown>) => {
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: user.id, type: 'private', first_name: user.first_name },
        from: user,
        ...extra,
      },
    } as any);
  };
  const voice = (duration = 3) => media({ voice: { file_id: 'v1', file_unique_id: 'v1', duration, mime_type: 'audio/ogg' } });
  const photo = (caption?: string) =>
    media({ photo: [{ file_id: 'small', file_unique_id: 's', width: 90, height: 90 }, { file_id: 'big', file_unique_id: 'b', width: 1280, height: 1280 }], caption });
  const press = async (data: string) => {
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: String(updateId), from: user, chat_instance: '1', data,
        message: { message_id: 999, date: 0, chat: { id: user.id, type: 'private' }, text: 'x' },
      },
    } as any);
  };
  const sent = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text as string);
  const last = () => sent().at(-1) ?? '';
  return { bot, db, calls, text, voice, photo, press, sent, last, reset: () => (calls.length = 0) };
}
