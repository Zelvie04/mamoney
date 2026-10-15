import { describe, expect, it } from 'vitest';
import { currencyName, formatMoney, normalizeCurrency } from '../src/index.ts';

const n = (s: string) => s.replace(/\s/g, ' ');

describe('валюта', () => {
  it('ISO-коды форматируются как валюта', () => {
    expect(n(formatMoney(1500, 'RUB'))).toBe('1 500,00 ₽');
    expect(n(formatMoney(1500, 'BYN', { maxFraction: 0 }))).toMatch(/^1 500 (Br|BYN)$/);
  });
  it('своя подпись и пустая', () => {
    expect(n(formatMoney(1500.5, 'денег'))).toBe('1 500,5 денег');
    expect(n(formatMoney(1500, ''))).toBe('1 500');
    expect(n(formatMoney(2, '₿'))).toBe('2 ₿');
  });
  it('нормализация ввода', () => {
    expect(normalizeCurrency(' usd ')).toBe('USD');
    expect(normalizeCurrency('Баллов')).toBe('Баллов');
    expect(normalizeCurrency('abc')).toBe('abc');
    expect(normalizeCurrency('очень длинная подпись валюты')).toHaveLength(12);
    expect(currencyName('BYN')).toBe('Белорусский рубль');
    expect(currencyName('')).toBe('Без валюты');
  });
});
