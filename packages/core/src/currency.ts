/**
 * Валюта пользователя — это либо ISO-код (BYN, RUB, USD…), либо произвольная подпись
 * («денег», «₿», «баллов»), либо пустая строка (просто число без подписи).
 * Суммы между валютами не пересчитываются: это только подпись к числам.
 */
export const DEFAULT_CURRENCY = 'денег';
export const CURRENCY_MAX_LENGTH = 12;

export const CURRENCY_PRESETS: readonly { code: string; label: string }[] = [
  { code: 'BYN', label: 'Белорусский рубль' },
  { code: 'RUB', label: 'Российский рубль' },
  { code: 'USD', label: 'Доллар США' },
  { code: 'EUR', label: 'Евро' },
  { code: 'KZT', label: 'Казахстанский тенге' },
  { code: 'UAH', label: 'Гривна' },
  { code: 'PLN', label: 'Польский злотый' },
  { code: 'CNY', label: 'Юань' },
  { code: 'GEL', label: 'Грузинский лари' },
  { code: 'TRY', label: 'Турецкая лира' },
];

let supported: Set<string> | null = null;
/** Настоящий ли это код валюты. Intl принимает любые три буквы, поэтому сверяемся со списком. */
export function isIsoCurrency(c: string): boolean {
  if (!/^[A-Z]{3}$/.test(c)) return false;
  if (!supported) {
    const list = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
    supported = new Set(list ?? CURRENCY_PRESETS.map((p) => p.code));
  }
  return supported.has(c);
}

/** Нормализует ввод пользователя: «byn» → «BYN», лишние пробелы убираются, длина ограничена. */
export function normalizeCurrency(input: string): string {
  const s = input.trim().replace(/\s+/g, ' ').slice(0, CURRENCY_MAX_LENGTH);
  return isIsoCurrency(s.toUpperCase()) && /^[a-zA-Z]{3}$/.test(s) ? s.toUpperCase() : s;
}

/** Короткое имя для кнопок и настроек */
export function currencyName(c: string): string {
  if (!c) return 'Без валюты';
  return CURRENCY_PRESETS.find((p) => p.code === c)?.label ?? c;
}

export function formatMoney(n: number, currency: string = DEFAULT_CURRENCY, opts: { maxFraction?: number; compact?: boolean } = {}): string {
  const maximumFractionDigits = opts.maxFraction ?? 2;
  const notation = opts.compact && Math.abs(n) >= 10_000 ? 'compact' : 'standard';
  if (isIsoCurrency(currency)) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits, notation }).format(n);
  }
  const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits, notation }).format(n);
  return currency ? `${num} ${currency}` : num;
}
