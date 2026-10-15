import { normalize } from './text.js';

export interface CategoryRef { id: string | number; name: string }
export interface MerchantRule { pattern: string; categoryId: CategoryRef['id'] }

/** Совпадение как в n8n-версии: точное или по началу слова («каф» → «кафе»). */
export function matchCategory<C extends CategoryRef>(hint: string, categories: readonly C[]): C | null {
  const h = normalize(hint);
  if (!h) return null;
  return (
    categories.find((c) => normalize(c.name) === h) ??
    categories.find((c) => normalize(c.name).startsWith(h)) ??
    null
  );
}

/** Ищет выученное правило «название → категория», чтобы не звать ИИ для повторных трат. */
export function matchRule(title: string, rules: readonly MerchantRule[]): MerchantRule | null {
  const t = normalize(title);
  let best: MerchantRule | null = null;
  for (const r of rules) {
    const p = normalize(r.pattern);
    if (!p) continue;
    if (t === p || t.startsWith(p + ' ') || t.includes(' ' + p)) {
      if (!best || p.length > normalize(best.pattern).length) best = r;
    }
  }
  return best;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  'продукты', 'кафе', 'транспорт', 'дом', 'связь', 'здоровье', 'одежда', 'развлечения', 'подписки', 'подарки', 'другие расходы',
];
export const DEFAULT_INCOME_CATEGORIES = ['зарплата', 'подработка', 'подарки', 'возвраты', 'другие доходы'];

/**
 * Встроенный словарь для стандартных категорий: срабатывает до ИИ,
 * если у пользователя есть категория с таким именем.
 */
export const BUILTIN_KEYWORDS: Record<string, string[]> = {
  продукты: ['продукты', 'магнит', 'пятерочка', 'перекресток', 'лента', 'ашан', 'вкусвилл', 'дикси', 'фикс прайс', 'светофор', 'самокат', 'молоко', 'хлеб'],
  кафе: ['кафе', 'кофе', 'кофейня', 'ресторан', 'бар', 'кфс', 'kfc', 'бургер кинг', 'макдональдс', 'вкусно и точка', 'шаурма', 'пицца', 'суши', 'обед'],
  транспорт: ['такси', 'метро', 'автобус', 'трамвай', 'электричка', 'проезд', 'бензин', 'заправка', 'каршеринг', 'парковка', 'поезд', 'самолет'],
  связь: ['связь', 'телефон', 'мобильный', 'интернет', 'мтс', 'билайн', 'мегафон', 'теле2', 'tele2'],
  здоровье: ['аптека', 'врач', 'стоматолог', 'анализы', 'клиника', 'лекарства', 'таблетки'],
  дом: ['аренда', 'квартплата', 'жкх', 'коммуналка', 'свет', 'электричество', 'ремонт'],
  одежда: ['одежда', 'обувь', 'кроссовки', 'куртка', 'джинсы'],
  развлечения: ['кино', 'концерт', 'театр', 'игры', 'боулинг', 'клуб'],
  подписки: ['подписка', 'яндекс плюс', 'spotify', 'netflix', 'youtube', 'icloud'],
  подарки: ['подарок', 'подарки', 'цветы'],
  зарплата: ['зп', 'зарплата', 'аванс', 'оклад', 'премия'],
  подработка: ['подработка', 'фриланс', 'заказ'],
  возвраты: ['возврат', 'вернули', 'кэшбек', 'кешбек', 'кэшбэк'],
};

export function matchBuiltin<C extends CategoryRef>(text: string, categories: readonly C[]): C | null {
  const t = ` ${normalize(text)} `;
  for (const [name, words] of Object.entries(BUILTIN_KEYWORDS)) {
    if (!words.some((w) => t.includes(` ${normalize(w)} `))) continue;
    const c = categories.find((x) => normalize(x.name) === name);
    if (c) return c;
  }
  return null;
}
