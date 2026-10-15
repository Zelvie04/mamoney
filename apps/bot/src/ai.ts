import type { AiCategorizer } from './services/categories.ts';

/**
 * Категоризация через OpenRouter. Пробует модели по очереди; любой сбой → null,
 * и бот просто ставит «другие расходы». Вызывается только когда правила не помогли.
 */
export function openRouterCategorizer(apiKey: string, models: string[], timeoutMs = 8000): AiCategorizer | undefined {
  if (!apiKey || !models.length) return undefined;
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
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content ?? '';
        const json = content.match(/\{[\s\S]*\}/)?.[0];
        const cat = json ? (JSON.parse(json) as { category?: unknown }).category : null;
        if (typeof cat === 'string' && cat.trim()) return cat.trim();
      } catch {
        // следующая модель
      }
    }
    return null;
  };
}
