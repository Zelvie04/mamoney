import { DEFAULT_CURRENCY, formatMoney } from '@mamoney/core/currency';

let currency = DEFAULT_CURRENCY;
export const setCurrency = (c: string) => (currency = c);

export const money = (n: number, opts: { sign?: boolean; compact?: boolean } = {}) => {
  const f = formatMoney(Math.abs(n), currency, { maxFraction: opts.compact || Number.isInteger(n) ? 0 : 2, compact: opts.compact });
  if (!opts.sign) return n < 0 ? `−${f}` : f;
  return n > 0 ? `+${f}` : n < 0 ? `−${f}` : f;
};

export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  if (same(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
};

export const PERIODS = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'prev_week', label: 'Прошлая нед.' },
  { id: 'prev_month', label: 'Прошлый мес.' },
  { id: 'all', label: 'Всё время' },
] as const;

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
