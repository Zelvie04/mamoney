import { describe, expect, it } from 'vitest';
import { matchCategory, matchRule } from '../src/categorize.js';

const cats = [{ id: 1, name: 'Кафе' }, { id: 2, name: 'Транспорт' }, { id: 3, name: 'продукты' }];

describe('matchCategory', () => {
  it('точно и по началу', () => {
    expect(matchCategory('кафе', cats)?.id).toBe(1);
    expect(matchCategory('транс', cats)?.id).toBe(2);
    expect(matchCategory('еда', cats)).toBeNull();
  });
});

describe('matchRule', () => {
  it('самое длинное совпадение', () => {
    const rules = [{ pattern: 'кфс', categoryId: 1 }, { pattern: 'яндекс такси', categoryId: 2 }, { pattern: 'яндекс', categoryId: 3 }];
    expect(matchRule('яндекс такси до дома', rules)?.categoryId).toBe(2);
    expect(matchRule('кфс', rules)?.categoryId).toBe(1);
    expect(matchRule('кофе', rules)).toBeNull();
  });
});

import { matchBuiltin } from '../src/categorize.js';
describe('matchBuiltin', () => {
  it('словарь срабатывает только если у юзера есть категория', () => {
    expect(matchBuiltin('300 такси до дома', [{ id: 1, name: 'Транспорт' }])?.id).toBe(1);
    expect(matchBuiltin('300 такси', [{ id: 1, name: 'машина' }])).toBeNull();
    expect(matchBuiltin('такситория', [{ id: 1, name: 'транспорт' }])).toBeNull();
  });
});
