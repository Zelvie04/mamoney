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
    expect(t.last()).toBe('Планы:\n• ремонт машины');
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
