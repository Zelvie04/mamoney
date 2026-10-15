import { describe, expect, it } from 'vitest';
import { testBot } from './helpers.ts';

const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s/g, ' ');

describe('бот', () => {
  it('/start регистрирует пользователя и показывает кнопку приложения', async () => {
    const t = await testBot();
    await t.text('/start');
    const call = t.calls.find((c) => c.method === 'sendMessage')!;
    expect(call.payload.text).toContain('MaMoney');
    expect(JSON.stringify(call.payload.reply_markup)).toContain('https://mamoney.example/app/');
  });

  it('записывает расход, категория по подсказке, баланс считается', async () => {
    const t = await testBot();
    await t.text('/balance');
    await t.text('10 000');
    expect(plain(t.last())).toContain('10 000,00 ₽');
    await t.text('350 кофе #кафе');
    expect(plain(t.last())).toMatch(/Расход: 350,00 ₽.*кофе · кафе.*Баланс: 9 650,00 ₽/s);
  });

  it('учится: второй раз то же название без ИИ', async () => {
    let aiCalls = 0;
    const t = await testBot({ ai: async () => (aiCalls++, 'транспорт') });
    await t.text('300 поездка домой');
    await t.text('450 поездка домой');
    expect(aiCalls).toBe(1);
    expect(plain(t.last())).toContain('поездка домой · транспорт');
  });

  it('ИИ упал — категория «другие расходы», запись всё равно создаётся', async () => {
    const t = await testBot({ ai: async () => { throw new Error('down'); } });
    await t.text('500 непонятное');
    expect(plain(t.last())).toContain('непонятное · другие расходы');
  });

  it('доход и несколько строк', async () => {
    const t = await testBot();
    await t.text('зп 50000\n200 метро');
    const s = t.sent().map(plain);
    expect(s[0]).toContain('Доход: 50 000,00 ₽');
    expect(s[0]).toContain('зарплата');
    expect(s[1]).toContain('Баланс: 49 800,00 ₽');
  });

  it('кнопка «Отменить» удаляет запись и возвращает баланс', async () => {
    const t = await testBot();
    await t.text('100 хлеб');
    const kb = t.calls.filter((c) => c.method === 'sendMessage').at(-1)!.payload.reply_markup.inline_keyboard[0];
    const undo = kb.find((b: any) => b.callback_data.startsWith('undo:')).callback_data;
    await t.press(undo);
    const edit = t.calls.find((c) => c.method === 'editMessageText')!;
    expect(plain(edit.payload.text)).toContain('Баланс: 0,00 ₽');
  });

  it('смена категории запоминается', async () => {
    const t = await testBot();
    await t.text('700 аптека');
    const id = t.calls.filter((c) => c.method === 'sendMessage').at(-1)!.payload.reply_markup.inline_keyboard[0][1].callback_data.split(':')[1];
    await t.press(`cat:${id}`);
    const kb = t.calls.find((c) => c.method === 'editMessageReplyMarkup')!.payload.reply_markup.inline_keyboard.flat();
    const health = kb.find((b: any) => b.text === 'здоровье').callback_data;
    await t.press(health);
    await t.text('300 аптека');
    expect(plain(t.last())).toContain('аптека · здоровье');
  });

  it('команда в режиме планов не записывается в планы', async () => {
    const t = await testBot();
    await t.text('/future');
    await t.text('ремонт машины');
    await t.text('/show_future');
    expect(t.last()).toBe('Будущие траты:\n• ремонт машины');
  });

  it('категории: добавить и убрать', async () => {
    const t = await testBot();
    await t.text('/category');
    await t.text('1+Фастфуд');
    expect(t.last()).toContain('фастфуд');
    await t.text('/category');
    await t.text('1-фаст');
    expect(t.last()).not.toContain('фастфуд');
  });

  it('отчёт за неделю', async () => {
    const t = await testBot();
    await t.text('50 кфс.кафе');
    await t.text('30 кфс.кафе');
    await t.text('/weeknow');
    expect(plain(t.last())).toContain('кфс: 50,00 ₽ + 30,00 ₽ = 80,00 ₽');
  });

  it('непонятный текст — подсказка, без записи', async () => {
    const t = await testBot();
    await t.text('привет');
    expect(t.last()).toContain('Не понял запись');
  });
});

import { upsertBudget, listCategories } from '@mamoney/domain';
describe('бюджеты в боте', () => {
  it('предупреждает при 80% и при превышении', async () => {
    const t = await testBot();
    await t.text('/start');
    const [u] = await t.db.execute<any>("SELECT id FROM users WHERE tg_id = 42" as any).then((r: any) => r.rows ?? r);
    const cafe = (await listCategories(t.db, u.id, 'expense')).find((c) => c.name === 'кафе')!;
    await upsertBudget(t.db, u.id, { categoryId: cafe.id, period: 'month', amount: 1000 });
    await t.text('500 обед #кафе');
    expect(t.last()).not.toContain('Бюджет');
    await t.text('350 ужин #кафе');
    expect(plain(t.last())).toContain('Бюджет «кафе»: потрачено 85%');
    await t.text('300 кофе #кафе');
    expect(plain(t.last())).toContain('превышен');
  });
});

describe('валюта в боте', () => {
  it('при первом /start спрашивает валюту, выбор из списка и своя', async () => {
    const t = await testBot();
    await t.text('/start');
    expect(t.last()).toContain('Какую валюту показывать');
    expect(JSON.stringify(t.calls.at(-1)!.payload.reply_markup)).toContain('cur:BYN');

    await t.press('cur:BYN');
    const edit = t.calls.find((c) => c.method === 'editMessageText')!;
    expect(plain(edit.payload.text)).toContain('Белорусский рубль');

    t.reset();
    await t.text('/start');
    expect(t.sent().some((s) => s.includes('Какую валюту'))).toBe(false);

    await t.press('cur:?');
    await t.text('баллов');
    expect(plain(t.last())).toContain('1 500 баллов');
    await t.text('200 кофе');
    expect(plain(t.last())).toContain('Расход: 200 баллов');

    await t.press('cur:0');
    await t.text('100 чай');
    expect(plain(t.last())).toContain('Расход: 100 чай');
  });
});

describe('будущие траты и статистика в боте', () => {
  it('трата с будущей датой уходит в планы, баланс не меняется', async () => {
    const t = await testBot();
    const d = new Date(Date.now() + 5 * 86400_000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
    await t.text(`${d} 5000 ремонт`);
    expect(t.last()).toContain('В будущие траты: ремонт');
    await t.text('/balance');
    expect(plain(t.last())).toContain('0,00 ₽');
    await t.text('/show_future');
    expect(plain(t.last())).toContain('ремонт — 5 000,00 ₽');
  });

  it('/stats только владельцу', async () => {
    const other = await testBot();
    await other.text('/stats');
    expect(other.last()).toContain('Не знаю такой команды');
    const t = await testBot({ admin: { ids: [42], usernames: [] } });
    await t.text('100 кофе');
    await t.text('/stats');
    expect(plain(t.last())).toMatch(/Пользователи: 1.*Операции: 1/s);
  });
});
