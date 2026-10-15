import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { connect } from '@mamoney/db';
import { openRouterCategorizer } from './ai.ts';
import { createBot, setupBotProfile } from './bot.ts';
import { config } from './config.ts';
import { startScheduler } from './cron.ts';

const { db, client } = connect();
const bot = createBot({
  db,
  token: config.botToken,
  ai: openRouterCategorizer(config.openrouterKey, config.openrouterModels),
  publicUrl: config.publicUrl,
  defaults: { timezone: config.defaultTimezone, currency: config.defaultCurrency },
});

await bot.init();
const appUrl = config.publicUrl ? `${config.publicUrl.replace(/\/$/, '')}/app/` : null;
await setupBotProfile(bot, appUrl).catch((e) => console.error('setMyCommands', e));
startScheduler(db, bot.api, config.adminChatId);

if (config.publicUrl && config.webhookSecret) {
  // Прод: вебхук. Путь содержит секрет, Telegram дополнительно присылает secret_token в заголовке.
  const path = `/tg/${config.webhookSecret}`;
  const handle = webhookCallback(bot, 'http', { secretToken: config.webhookSecret });
  const server = createServer((req, res) => {
    if (req.url === '/healthz') return res.end('ok');
    if (req.method === 'POST' && req.url === path) return void handle(req, res);
    res.statusCode = 404;
    res.end();
  });
  server.listen(config.port, async () => {
    await bot.api.setWebhook(`${config.publicUrl.replace(/\/$/, '')}${path}`, {
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
    console.log(`@${bot.botInfo.username}: вебхук на порту ${config.port}`);
  });
  const stop = () => server.close(() => client.end().then(() => process.exit(0)));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} else {
  // Разработка: long polling, вебхук снимается
  await bot.api.deleteWebhook();
  console.log(`@${bot.botInfo.username}: polling`);
  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());
  await bot.start({ allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
  await client.end();
}
