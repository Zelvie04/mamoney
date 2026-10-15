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
