import { describe, expect, it } from 'vitest';
import { parseMessage, parseTransaction } from '../src/parse.js';

const ok = (s: string) => {
  const r = parseTransaction(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.tx;
};

describe('parseTransaction', () => {
  it('расход по умолчанию, сумма в любом месте', () => {
    expect(ok('350 кофе')).toMatchObject({ type: 'expense', amount: 350, title: 'кофе', categoryHint: null });
    expect(ok('кофе 350')).toMatchObject({ type: 'expense', amount: 350, title: 'кофе' });
  });

  it('доход по ключевым словам и плюсу', () => {
    expect(ok('зп 80000')).toMatchObject({ type: 'income', amount: 80000, title: 'зп' });
    expect(ok('зп 80000 работа')).toMatchObject({ type: 'income', amount: 80000, title: 'работа' });
    expect(ok('+1500 вернули долг')).toMatchObject({ type: 'income', amount: 1500, title: 'долг' });
    expect(ok('пришло 500 от мамы')).toMatchObject({ type: 'income', title: 'от мамы' });
  });

  it('кириллица: ключевое слово только целым словом', () => {
    // «плюсовка» не должна делать операцию доходом
    expect(ok('200 плюсовка')).toMatchObject({ type: 'expense', title: 'плюсовка' });
  });

  it('явная категория после . ! : и через #', () => {
    expect(ok('50 кфс.кафе')).toMatchObject({ title: 'кфс', categoryHint: 'кафе' });
    expect(ok('50 кфс!кафе')).toMatchObject({ title: 'кфс', categoryHint: 'кафе' });
    expect(ok('50 кфс #кафе')).toMatchObject({ title: 'кфс', categoryHint: 'кафе' });
  });

  it('разные форматы сумм', () => {
    expect(ok('1 500,50 продукты').amount).toBe(1500.5);
    expect(ok('1.5к такси').amount).toBe(1500);
    expect(ok('2k такси').amount).toBe(2000);
    expect(ok('3 тыс аренда').amount).toBe(3000);
    expect(ok('такси 450р').amount).toBe(450);
    expect(ok('такси 450 ₽')).toMatchObject({ amount: 450, title: 'такси' });
  });

  it('десятичная сумма не путается с категорией', () => {
    expect(ok('99.90 молоко')).toMatchObject({ amount: 99.9, title: 'молоко', categoryHint: null });
  });

  it('даты', () => {
    expect(ok('вчера 300 такси')).toMatchObject({ dayOffset: -1, amount: 300, title: 'такси' });
    expect(ok('12.10 300 такси')).toMatchObject({ date: { y: 0, m: 10, d: 12 }, amount: 300 });
    // одно число — это сумма, не дата
    expect(ok('12.10 такси')).toMatchObject({ amount: 12.1, date: null });
  });

  it('апострофы и кавычки не ломают ничего', () => {
    expect(ok("300 McDonald's")).toMatchObject({ title: "mcdonald's" });
  });

  it('ошибки формата', () => {
    expect(parseTransaction('кофе')).toEqual({ ok: false, error: 'no_amount' });
    expect(parseTransaction('300')).toEqual({ ok: false, error: 'no_title' });
    expect(parseTransaction('0 кофе')).toEqual({ ok: false, error: 'bad_amount' });
  });

  it('несколько строк', () => {
    const r = parseMessage('300 такси\n150 кофе\n\nзп 50000');
    expect(r.map((x) => x.ok && x.tx.type)).toEqual(['expense', 'expense', 'income']);
  });
});
