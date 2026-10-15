import { wordRe } from './text.js';

export type TxType = 'income' | 'expense';

export interface ParsedTx {
  type: TxType;
  amount: number;
  title: string;
  /** Категория, которую пользователь указал явно: «50 кфс.кафе», «50 кфс #кафе» */
  categoryHint: string | null;
  /** Дата операции, если указана в тексте; иначе null (= сейчас) */
  date: { y: number; m: number; d: number } | null;
  /** Сдвиг в днях для «вчера»/«позавчера»; применяется к «сегодня» в часовом поясе пользователя */
  dayOffset: number;
}

export type ParseResult = { ok: true; tx: ParsedTx } | { ok: false; error: 'no_amount' | 'no_title' | 'bad_amount' };

export const INCOME_WORDS = [
  'доход', 'пришло', 'пришла', 'поступило', 'поступление', 'зп', 'зарплата', 'зарплату',
  'аванс', 'вернули', 'возврат', 'кэшбек', 'кешбек', 'кэшбэк', 'плюс', 'получил', 'получила',
] as const;

export const EXPENSE_WORDS = [
  'минус', 'забрали', 'потратил', 'потратила', 'потратили', 'расход', 'списали', 'заплатил', 'заплатила',
] as const;

const incomeRe = wordRe(INCOME_WORDS);
const expenseRe = wordRe(EXPENSE_WORDS);
const relDayRe = wordRe(['вчера', 'позавчера', 'сегодня']);
const currencyRe = /(?<![\p{L}])(?:руб(?:лей|ля|ль)?|р|₽|rub|byn|usd|eur|\$|€)(?![\p{L}])\.?/giu;

// Число: «1 500,50», «1500.5», «1.5к», «2k», «3 тыс»
const amountRe =
  /(?<![\p{L}\p{N}.,])([+-]?)(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s?(к|k|тыс\.?|тр)(?![\p{L}]))?(?![\p{N}])/giu;

// Явная дата: 12.10, 12.10.2026, 12/10
const dateRe = /(?<![\p{N}.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\p{N}.,])/u;

interface AmountMatch { value: number; sign: string; index: number; length: number }

function findAmounts(text: string): AmountMatch[] {
  const out: AmountMatch[] = [];
  for (const m of text.matchAll(amountRe)) {
    const int = m[2]!.replace(/[  ]/g, '');
    const frac = m[3] ?? '';
    let value = Number(frac ? `${int}.${frac}` : int);
    if (m[4]) value *= 1000;
    out.push({ value, sign: m[1] ?? '', index: m.index!, length: m[0].length });
  }
  return out;
}

/**
 * Разбирает одну строку вида «350 кофе», «зп 80000», «+1500 вернули», «1.5к такси.транспорт».
 * По умолчанию операция — расход; доход определяется по «+» перед суммой или ключевым словам.
 */
export function parseTransaction(input: string): ParseResult {
  let text = input.trim();
  let date: ParsedTx['date'] = null;
  let dayOffset = 0;

  const rel = text.match(relDayRe);
  if (rel) {
    const w = rel[0].toLowerCase();
    dayOffset = w === 'вчера' ? -1 : w === 'позавчера' ? -2 : 0;
    text = text.replace(relDayRe, ' ');
  }

  // Дата считается датой, только если кроме неё в строке есть ещё число-сумма
  const dm = text.match(dateRe);
  if (dm && findAmounts(text.replace(dm[0], ' ')).length > 0) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const yRaw = dm[3];
      const y = yRaw ? (yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw)) : 0; // 0 = текущий год
      date = { y, m, d };
      text = text.replace(dm[0], ' ');
    }
  }

  const amounts = findAmounts(text);
  const first = amounts[0];
  if (!first) return { ok: false, error: 'no_amount' };
  if (!Number.isFinite(first.value) || first.value <= 0) return { ok: false, error: 'bad_amount' };

  const hasIncomeWord = incomeRe.test(text);
  incomeRe.lastIndex = 0;
  const type: TxType = first.sign === '+' || (hasIncomeWord && first.sign !== '-') ? 'income' : 'expense';

  let rest = text.slice(0, first.index) + ' ' + text.slice(first.index + first.length);
  rest = rest.replace(currencyRe, ' ');

  // Явная категория: «#кафе» в любом месте или часть после . ! : в конце
  let categoryHint: string | null = null;
  const hash = rest.match(/#([\p{L}\p{N}_ -]+)/u);
  if (hash) {
    categoryHint = hash[1]!.trim();
    rest = rest.replace(hash[0], ' ');
  } else {
    const parts = rest.split(/[.!:]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      categoryHint = parts.slice(1).join(' ');
      rest = parts[0]!;
    }
  }

  const clean = (s: string) =>
    s
      .replace(/(^|\s)[+-](?=\s|$)/g, ' ')
      .replace(/[^\p{L}\p{N}\s'"«»()&-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  // «зп 80000» — ключевое слово и есть название; иначе убираем его из названия
  const title = clean(rest.replace(incomeRe, ' ').replace(expenseRe, ' ')) || clean(rest);
  incomeRe.lastIndex = 0;
  expenseRe.lastIndex = 0;

  if (!title) return { ok: false, error: 'no_title' };

  return {
    ok: true,
    tx: {
      type,
      amount: Math.round(first.value * 100) / 100,
      title,
      categoryHint: categoryHint ? categoryHint.toLowerCase() : null,
      date,
      dayOffset,
    },
  };
}

/** Несколько операций в одном сообщении, по одной на строку. */
export function parseMessage(text: string): ParseResult[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseTransaction);
}
