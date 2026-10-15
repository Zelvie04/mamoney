import type { AiCategorizer } from '@mamoney/domain';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

/** Бесплатные модели OpenRouter, которые хорошо понимают русский. Берутся те, что сейчас есть в каталоге. */
const PREFERRED_FREE = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

/**
 * Список моделей. «auto» — для OpenRouter спрашиваем каталог и берём доступные бесплатные:
 * сначала из PREFERRED_FREE, потом любые другие :free. Бесплатные модели в OpenRouter
 * часто появляются и исчезают, поэтому жёсткий список быстро устаревает.
 */
export async function resolveModels(baseUrl: string, configured: string[], max = 4): Promise<string[]> {
  if (!(configured.length === 1 && configured[0] === 'auto')) return configured;
  if (!baseUrl.startsWith(OPENROUTER_URL)) return [];
  try {
    const res = await fetch(`${OPENROUTER_URL}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const { data } = (await res.json()) as { data: { id: string }[] };
    const free = new Set(data.map((m) => m.id).filter((id) => id.endsWith(':free')));
    const preferred = PREFERRED_FREE.filter((id) => free.has(id));
    const rest = [...free].filter((id) => !preferred.includes(id) && /instruct|chat|-it:|gemma|llama|qwen|mistral/i.test(id));
    return [...preferred, ...rest].slice(0, max);
  } catch {
    return PREFERRED_FREE.slice(0, 2);
  }
}

/**
 * Категоризация через любой OpenAI-совместимый API: OpenRouter, свой Ollama/llama.cpp на VPS и т.п.
 * Пробует модели по очереди; любой сбой → null, и бот ставит «другие расходы».
 * Вызывается только когда правила и выученные соответствия не помогли.
 */
export function llmCategorizer(opts: { baseUrl: string; apiKey: string; models: string[]; timeoutMs?: number }): AiCategorizer | undefined {
  const { baseUrl, apiKey, models, timeoutMs = 8000 } = opts;
  const isOpenRouter = baseUrl.startsWith(OPENROUTER_URL);
  if (!models.length || (isOpenRouter && !apiKey)) return undefined;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return async ({ title, text, type, categories }) => {
    const prompt = [
      `Выбери одну категорию для ${type === 'income' ? 'дохода' : 'расхода'} из списка.`,
      `Список: ${categories.join(', ')}`,
      `Название: ${title}`,
      `Исходное сообщение: ${text}`,
      'Ответь только JSON: {"category": "<точное имя из списка>"}. Если не уверен — выбери «другие».',
    ].join('\n');
    for (const model of models) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, temperature: 0, max_tokens: 60, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content ?? '';
        const json = content.match(/\{[\s\S]*?\}/)?.[0];
        const cat = json ? (JSON.parse(json) as { category?: unknown }).category : null;
        if (typeof cat === 'string' && cat.trim()) return cat.trim();
      } catch {
        // следующая модель
      }
    }
    return null;
  };
}
