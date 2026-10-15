import { describe, expect, it } from 'vitest';
import { parseMessage } from '@mamoney/core';
import { itemsToLines, parseImageItems } from '../src/media.ts';

describe('фото → строки записи', () => {
  it('разбирает ответ модели, отбрасывает мусор', () => {
    const items = parseImageItems('Вот: ```json\n{"items":[{"type":"expense","amount":"1 234,5","title":"Пятёрочка 24"},{"type":"x","amount":-80,"title":""},{"amount":0}]}\n```');
    expect(items).toEqual([
      { type: 'expense', amount: 1234.5, title: 'Пятёрочка', date: null },
      { type: 'expense', amount: 80, title: 'покупка', date: null },
    ]);
    expect(parseImageItems('не знаю')).toBeNull();
  });

  it('строки разбираются обычным парсером: копейки не принимаются за дату', () => {
    const lines = itemsToLines([
      { type: 'expense', amount: 12.05, title: 'кофе', date: '2026-10-12' },
      { type: 'income', amount: 500, title: 'возврат' },
    ]);
    expect(lines).toEqual(['12,05 кофе 12.10.2026', '+500 возврат']);
    const [a, b] = parseMessage(lines.join('\n'));
    expect(a).toMatchObject({ ok: true, tx: { amount: 12.05, title: 'кофе', type: 'expense', date: { y: 2026, m: 10, d: 12 } } });
    expect(b).toMatchObject({ ok: true, tx: { amount: 500, type: 'income' } });
  });
});
