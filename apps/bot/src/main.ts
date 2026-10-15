import { fileURLToPath } from 'node:url';
import { GrammyError, InputFile, webhookCallback } from 'grammy';
import { buildApi } from '@mamoney/api';
import { interruptRunningBroadcasts, parseAdminConfig, type SendText } from '@mamoney/domain';
import { connect } from '@mamoney/db';
import { llmCategorizer, resolveModels } from './ai.ts';
import { createBot, setupBotProfile } from './bot.ts';
import { deepgramTranscriber, llmImageReader, resolveVisionModels } from './media.ts';
import { config } from './config.ts';
import { startScheduler } from './cron.ts';

const { db, client } = connect();
const aiModels = await resolveModels(config.aiBaseUrl, config.aiModels);
const ai = llmCategorizer({ baseUrl: config.aiBaseUrl, apiKey: config.aiKey, models: aiModels });
console.log(`AI-категоризация: ${ai ? aiModels.join(', ') : 'выключена'}`);
const visionModels = await resolveVisionModels(config.aiBaseUrl, config.aiVisionModels);
const readImage = llmImageReader({ baseUrl: config.aiBaseUrl, apiKey: config.aiKey, models: visionModels });
console.log(`Фото: ${readImage ? visionModels.join(', ') : 'выключены'}`);
const transcribe = deepgramTranscriber({ apiKey: config.deepgramKey });
console.log(`Голосовые: ${transcribe ? 'Deepgram' : 'выключены (нет DEEPGRAM_API_KEY)'}`);
const defaults = { timezone: config.defaultTimezone, currency: config.defaultCurrency };
const bot = createBot({ db, token: config.botToken, ai, publicUrl: config.publicUrl, defaults, admin: parseAdminConfig(process.env), transcribe, readImage });

await bot.init();
const base = config.publicUrl.replace(/\/$/, '');
const appUrl = base ? `${base}/app/` : null;
await setupBotProfile(bot, appUrl).catch((e) => console.error('setMyCommands', e));
startScheduler(db, bot.api, config.adminChatId);
await interruptRunningBroadcasts(db);

/** Обычный текст без разметки; при лимите Telegram ждём и пробуем ещё раз */
const sendText: SendText = async (chatId, text) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
      return 'sent';
    } catch (e) {
      if (!(e instanceof GrammyError)) return 'failed';
      if (e.error_code === 403 || /chat not found|user is deactivated/i.test(e.description)) return 'blocked';
      if (e.error_code !== 429) return 'failed';
      await new Promise((r) => setTimeout(r, ((e.parameters.retry_after ?? 1) + 1) * 1000));
    }
  }
  return 'failed';
};

// Один процесс: вебхук бота + API Mini App + статика Mini App
const app = await buildApi({
  db,
  botToken: config.botToken,
  defaults,
  ai,
  staticDir: process.env.MINIAPP_DIR ?? fileURLToPath(new URL('../../miniapp/dist', import.meta.url)),
  logger: true,
  admin: parseAdminConfig(process.env),
  sendText,
  sendDocument: async (chatId, file, filename) => {
    await bot.api.sendDocument(chatId, new InputFile(file, filename));
  },
});

const useWebhook = Boolean(base && config.webhookSecret);
if (useWebhook) {
  app.post(`/tg/${config.webhookSecret}`, webhookCallback(bot, 'fastify', {
      secretToken: config.webhookSecret,
      // Фото и голосовые обрабатываются дольше: отвечаем Telegram сразу, иначе он пришлёт то же сообщение ещё раз
      onTimeout: 'return',
      timeoutMilliseconds: 5000,
    }));
}

await app.listen({ port: config.port, host: '0.0.0.0' });

if (useWebhook) {
  await bot.api.setWebhook(`${base}/tg/${config.webhookSecret}`, {
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  });
  console.log(`@${bot.botInfo.username}: вебхук, порт ${config.port}`);
} else {
  // Локальная разработка: long polling
  await bot.api.deleteWebhook();
  void bot.start({ allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
  console.log(`@${bot.botInfo.username}: polling, API на порту ${config.port}`);
}

const stop = async () => {
  if (!useWebhook) await bot.stop();
  await app.close();
  await client.end();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
