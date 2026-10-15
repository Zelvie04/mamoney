import { OPENROUTER_URL } from './ai.ts';

/** Голос → текст. null — не получилось или пусто. */
export type Transcriber = (audio: Buffer, mime: string) => Promise<string | null>;

export interface ImageItem {
  type: 'income' | 'expense';
  amount: number;
  title: string;
  /** YYYY-MM-DD, если на фото есть дата */
  date?: string | null;
}
/** Фото чека или скриншота → операции. null — модель недоступна. */
export type ImageReader = (image: Buffer, mime: string, opts: { today: string; caption?: string }) => Promise<ImageItem[] | null>;

/**
 * Deepgram: распознавание речи. Модели пробуются по очереди, на случай если первая не поддерживает русский.
 * https://developers.deepgram.com/reference/speech-to-text-api/listen
 */
export function deepgramTranscriber(opts: { apiKey: string; models?: string[]; language?: string; timeoutMs?: number }): Transcriber | undefined {
  const { apiKey, models = ['nova-3', 'nova-2'], language = 'ru', timeoutMs = 30_000 } = opts;
  if (!apiKey) return undefined;
  return async (audio, mime) => {
    for (const model of models) {
      try {
        const q = new URLSearchParams({ model, language, smart_format: 'true', numerals: 'true' });
        const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
          method: 'POST',
          headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mime || 'audio/ogg' },
          body: new Uint8Array(audio),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          console.error(`Deepgram ${model}: ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
        const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
        return text || null;
      } catch (e) {
        console.error(`Deepgram ${model}: ${(e as Error).message}`);
      }
    }
    return null;
  };
}

/** Бесплатные модели OpenRouter, которые принимают картинки. Берутся те, что сейчас есть в каталоге. */
const PREFERRED_VISION = [
  'google/gemma-3-27b-it:free',
  'qwen/qwen2.5-vl-72b-instruct:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
  'meta-llama/llama-4-maverick:free',
];

/** «auto» — спросить каталог OpenRouter и взять бесплатные модели с вводом картинок. */
export async function resolveVisionModels(baseUrl: string, configured: string[], max = 3): Promise<string[]> {
  if (!(configured.length === 1 && configured[0] === 'auto')) return configured;
  if (!baseUrl.startsWith(OPENROUTER_URL)) return [];
  try {
    const res = await fetch(`${OPENROUTER_URL}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const { data } = (await res.json()) as { data: { id: string; architecture?: { input_modalities?: string[] } }[] };
    const vision = new Set(
      data.filter((m) => m.id.endsWith(':free') && m.architecture?.input_modalities?.includes('image')).map((m) => m.id),
    );
    const preferred = PREFERRED_VISION.filter((id) => vision.has(id));
    return [...preferred, ...[...vision].filter((id) => !preferred.includes(id))].slice(0, max);
  } catch {
    return PREFERRED_VISION.slice(0, 2);
  }
}

const IMAGE_PROMPT = (today: string, caption?: string) =>
  [
    'На картинке чек, скриншот банковского приложения или запись о деньгах.',
    'Найди операции и верни только JSON без пояснений:',
    '{"items":[{"type":"expense|income","amount":123.45,"title":"коротко по-русски, 1-3 слова","date":"YYYY-MM-DD или null"}]}',
    'Правила:',
    '- Чек из магазина или кафе — ОДНА операция: итоговая сумма к оплате, title — что это (например «продукты», «кафе», «аптека») или название магазина.',
    '- Список операций из банка — по операции на строку; поступления — income, списания — expense.',
    '- amount — положительное число без валюты.',
    `- Сегодня ${today}. Дату ставь, только если она видна на картинке.`,
    '- Если денег на картинке нет — {"items":[]}.',
    caption ? `Подпись пользователя к фото: «${caption}». Учти её при выборе title.` : '',
  ]
    .filter(Boolean)
    .join('\n');

export function parseImageItems(content: string): ImageItem[] | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const raw = (JSON.parse(json) as { items?: unknown }).items;
    if (!Array.isArray(raw)) return null;
    return raw
      .map((x: any): ImageItem => ({
        type: x?.type === 'income' ? 'income' : 'expense',
        amount: Math.round(Math.abs(Number(String(x?.amount ?? '').replace(/\s/g, '').replace(',', '.'))) * 100) / 100,
        title: String(x?.title ?? '').replace(/[\r\n]+/g, ' ').replace(/\d/g, '').trim().slice(0, 60),
        date: typeof x?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null,
      }))
      .filter((x) => Number.isFinite(x.amount) && x.amount > 0)
      .map((x) => ({ ...x, title: x.title || (x.type === 'income' ? 'поступление' : 'покупка') }))
      .slice(0, 20);
  } catch {
    return null;
  }
}

/** Чтение фото через OpenAI-совместимый API с картинками (OpenRouter и т.п.). */
export function llmImageReader(opts: { baseUrl: string; apiKey: string; models: string[]; timeoutMs?: number }): ImageReader | undefined {
  const { baseUrl, apiKey, models, timeoutMs = 60_000 } = opts;
  if (!models.length || (baseUrl.startsWith(OPENROUTER_URL) && !apiKey)) return undefined;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return async (image, mime, { today, caption }) => {
    const dataUrl = `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}`;
    for (const model of models) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 800,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: IMAGE_PROMPT(today, caption) },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          console.error(`Фото, модель ${model}: ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const items = parseImageItems(data.choices?.[0]?.message?.content ?? '');
        if (items) return items;
      } catch (e) {
        console.error(`Фото, модель ${model}: ${(e as Error).message}`);
      }
    }
    return null;
  };
}

/**
 * Операции с фото → строки в формате обычной записи («350 кофе 12.10.2026»), чтобы дальше работал
 * тот же разбор, что и для текста. Копейки через запятую: «12.05» парсер принял бы за дату.
 */
export function itemsToLines(items: ImageItem[]): string[] {
  return items.map((i) => {
    const amount = Number.isInteger(i.amount) ? String(i.amount) : i.amount.toFixed(2).replace('.', ',');
    const date = i.date ? ` ${i.date.split('-').reverse().join('.')}` : '';
    return `${i.type === 'income' ? '+' : ''}${amount} ${i.title}${date}`;
  });
}
