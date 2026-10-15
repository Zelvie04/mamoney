import { DEFAULT_CURRENCY } from '@mamoney/core';

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
  /** Любой OpenAI-совместимый API. По умолчанию OpenRouter; для своей модели — например http://ollama:11434/v1 */
  aiBaseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
  aiKey: process.env.AI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '',
  /** Через запятую или «auto» — бесплатные модели OpenRouter, доступные сейчас */
  aiModels: (process.env.AI_MODELS ?? process.env.OPENROUTER_MODELS ?? 'auto')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  adminChatId: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null,
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Moscow',
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? DEFAULT_CURRENCY,
};
export type Config = typeof config;
