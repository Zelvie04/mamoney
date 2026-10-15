function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const config = {
  botToken: req('BOT_TOKEN'),
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  publicUrl: process.env.PUBLIC_URL ?? '',
  port: Number(process.env.PORT ?? 3000),
  openrouterKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterModels: (process.env.OPENROUTER_MODELS ?? 'meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  adminChatId: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null,
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Moscow',
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'RUB',
};
export type Config = typeof config;
