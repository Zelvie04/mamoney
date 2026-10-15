/**
 * Границы периодов в часовом поясе пользователя. Возвращаются как Date (UTC-моменты),
 * конец — исключающий. Заменяет ручной сдвиг «+3 часа» из n8n.
 */
export type Period = 'week' | 'prev_week' | 'month' | 'prev_month';

function zonedParts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd };
}

/** Момент локальной полуночи y-m-d в поясе tz. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

export function periodRange(period: Period, tz: string, now = new Date()): { start: Date; end: Date } {
  const { y, m, d, wd } = zonedParts(now, tz);
  const at = (yy: number, mm: number, dd: number) => {
    const n = new Date(Date.UTC(yy, mm - 1, dd));
    return zonedMidnight(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), tz);
  };
  switch (period) {
    case 'week':
      return { start: at(y, m, d - wd), end: now };
    case 'prev_week':
      return { start: at(y, m, d - wd - 7), end: at(y, m, d - wd) };
    case 'month':
      return { start: at(y, m, 1), end: now };
    case 'prev_month':
      return { start: at(y, m - 1, 1), end: at(y, m, 1) };
  }
}

/** Дата операции из разбора: явная дата или «сегодня + сдвиг», в полдень по поясу пользователя. */
export function resolveOccurredAt(
  date: { y: number; m: number; d: number } | null,
  dayOffset: number,
  tz: string,
  now = new Date(),
): Date {
  if (!date && dayOffset === 0) return now;
  const today = zonedParts(now, tz);
  const base = date ? { y: date.y || today.y, m: date.m, d: date.d } : { y: today.y, m: today.m, d: today.d + dayOffset };
  const n = new Date(Date.UTC(base.y, base.m - 1, base.d));
  const midnight = zonedMidnight(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), tz);
  return new Date(midnight.getTime() + 12 * 3600_000);
}
