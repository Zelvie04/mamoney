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
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-3-27b-it:free',
  'qwen/qwen2.5-vl-72b-instruct:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
  'meta-llama/llama-4-maverick:free',
];

/** «auto» — спросить каталог OpenRouter и взять бесплатные модели с вводом картинок. */
export async function resolveVisionModels(baseUrl: string, configured: string[], max = 4): Promise<string[]> {
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
    // модели-фильтры и «рассуждающие» для чтения чеков не подходят: первые не отвечают по делу, вторые слишком медленные
    const rest = [...vision].filter((id) => !preferred.includes(id) && !/safety|guard|reasoning|thinking/i.test(id));
    return [...preferred, ...rest].slice(0, max);
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

/** Ответ модели → операции. Терпим обёртки вида ```json, пояснения вокруг и массив без {"items": …}. */
export function parseImageItems(content: string): ImageItem[] | null {
  const pick = (v: unknown): unknown => (Array.isArray(v) ? v : (v as any)?.items ?? (v as any)?.operations ?? null);
  const candidates = [content.match(/\{[\s\S]*\}/)?.[0], content.match(/\[[\s\S]*\]/)?.[0]].filter(Boolean) as string[];
  let raw: unknown = null;
  for (const c of candidates) {
    try {
      raw = pick(JSON.parse(c));
      if (Array.isArray(raw)) break;
    } catch {
      // следующий кандидат
    }
  }
  if (!Array.isArray(raw)) return null;
  return raw
      .map((x: any): ImageItem => ({
        type: x?.type === 'income' ? 'income' : 'expense',
        amount: Math.round(Math.abs(Number(String(x?.amount ?? '').replace(/[^\d.,]/g, '').replace(',', '.'))) * 100) / 100,
        title: String(x?.title ?? '').replace(/[\r\n]+/g, ' ').replace(/\d/g, '').trim().slice(0, 60),
        date: typeof x?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null,
      }))
      .filter((x) => Number.isFinite(x.amount) && x.amount > 0)
      .map((x) => ({ ...x, title: x.title || (x.type === 'income' ? 'поступление' : 'покупка') }))
      .slice(0, 20);
}

/** Чтение фото через OpenAI-совместимый API с картинками (OpenRouter и т.п.). */
export function llmImageReader(opts: { baseUrl: string; apiKey: string; models: string[]; timeoutMs?: number }): ImageReader | undefined {
  const { baseUrl, apiKey, models, timeoutMs = 60_000 } = opts;
  if (!models.length || (baseUrl.startsWith(OPENROUTER_URL) && !apiKey)) return undefined;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return async (image, mime, { today, caption }) => {
    const dataUrl = `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}`;
    const ask = async (model: string): Promise<ImageItem[] | 'busy' | null> => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 4000,
            // «рассуждающие» модели иначе тратят весь лимит на размышления и возвращают пустой ответ
            reasoning: { effort: 'low' },
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
          return res.status === 429 ? 'busy' : null;
        }
        const data = (await res.json()) as {
          choices?: { finish_reason?: string; message?: { content?: unknown; reasoning?: string } }[];
        };
        const choice = data.choices?.[0];
        const c = choice?.message?.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? '').join('') : '';
        const items = parseImageItems(text) ?? parseImageItems(choice?.message?.reasoning ?? '');
        if (!items) {
          console.error(`Фото, модель ${model}: ответ не разобран (${choice?.finish_reason ?? '?'}): ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
        }
        return items;
      } catch (e) {
        console.error(`Фото, модель ${model}: ${(e as Error).message}`);
        return null;
      }
    };
    // Бесплатный пул часто отвечает 429: такие модели пробуем ещё раз в конце, после паузы
    const busy: string[] = [];
    for (const model of models) {
      const r = await ask(model);
      if (r === 'busy') busy.push(model);
      else if (r) return r;
    }
    for (const model of busy) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await ask(model);
      if (r && r !== 'busy') return r;
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
