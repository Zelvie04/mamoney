import { describe, expect, it } from 'vitest';
import { buildReport, formatReport } from '../src/report.js';
import { periodRange, resolveOccurredAt } from '../src/period.js';

describe('buildReport', () => {
  it('группирует как недельный отчёт n8n', () => {
    const r = buildReport([
      { type: 'expense', amount: '50', category: 'Кафе', title: 'кфс' },
      { type: 'expense', amount: 30, category: 'кафе', title: 'КФС' },
      { type: 'expense', amount: 100, category: null, title: 'штраф' },
      { type: 'income', amount: 1000, category: 'зарплата', title: 'зп' },
    ]);
    expect(r).toMatchObject({ income: 1000, expense: 180, net: 820 });
    expect(r.expenses[0]).toMatchObject({ category: 'без категории', sum: 100 });
    expect(r.expenses[1]!.titles[0]).toEqual({ title: 'кфс', sum: 80, parts: [50, 30] });
    expect(formatReport('Неделя', r, { detailed: true }).replace(/\s/g, ' ')).toContain('кфс: 50,00 ₽ + 30,00 ₽ = 80,00 ₽');
  });
});

describe('periodRange', () => {
  const tz = 'Europe/Moscow';
  // Ср 15.10.2026 13:00 МСК
  const now = new Date('2026-10-15T10:00:00Z');
  it('неделя с понедельника 00:00 МСК', () => {
    expect(periodRange('week', tz, now).start.toISOString()).toBe('2026-10-11T21:00:00.000Z');
    const pw = periodRange('prev_week', tz, now);
    expect(pw.start.toISOString()).toBe('2026-10-04T21:00:00.000Z');
    expect(pw.end.toISOString()).toBe('2026-10-11T21:00:00.000Z');
  });
  it('прошлый месяц, в т.ч. через год', () => {
    const pm = periodRange('prev_month', tz, new Date('2026-01-10T10:00:00Z'));
    expect(pm.start.toISOString()).toBe('2025-11-30T21:00:00.000Z');
    expect(pm.end.toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });
  it('вчера — полдень предыдущего дня', () => {
    expect(resolveOccurredAt(null, -1, tz, now).toISOString()).toBe('2026-10-14T09:00:00.000Z');
  });
});
