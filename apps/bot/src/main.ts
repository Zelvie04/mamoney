import { fileURLToPath } from 'node:url';
import { InputFile, webhookCallback } from 'grammy';
import { buildApi } from '@mamoney/api';
import { connect } from '@mamoney/db';
import { llmCategorizer, resolveModels } from './ai.ts';
import { createBot, setupBotProfile } from './bot.ts';
import { config } from './config.ts';
import { startScheduler } from './cron.ts';

const { db, client } = connect();
const aiModels = await resolveModels(config.aiBaseUrl, config.aiModels);
const ai = llmCategorizer({ baseUrl: config.aiBaseUrl, apiKey: config.aiKey, models: aiModels });
console.log(`AI-категоризация: ${ai ? aiModels.join(', ') : 'выключена'}`);
const defaults = { timezone: config.defaultTimezone, currency: config.defaultCurrency };
const bot = createBot({ db, token: config.botToken, ai, publicUrl: config.publicUrl, defaults });

await bot.init();
const base = config.publicUrl.replace(/\/$/, '');
const appUrl = base ? `${base}/app/` : null;
await setupBotProfile(bot, appUrl).catch((e) => console.error('setMyCommands', e));
startScheduler(db, bot.api, config.adminChatId);

// Один процесс: вебхук бота + API Mini App + статика Mini App
const app = await buildApi({
  db,
  botToken: config.botToken,
  defaults,
  ai,
  staticDir: process.env.MINIAPP_DIR ?? fileURLToPath(new URL('../../miniapp/dist', import.meta.url)),
  logger: true,
  sendDocument: async (chatId, file, filename) => {
    await bot.api.sendDocument(chatId, new InputFile(file, filename));
  },
});

const useWebhook = Boolean(base && config.webhookSecret);
if (useWebhook) {
  app.post(`/tg/${config.webhookSecret}`, webhookCallback(bot, 'fastify', { secretToken: config.webhookSecret }));
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
