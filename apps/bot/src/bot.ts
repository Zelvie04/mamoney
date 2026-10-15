import { Bot, type Context, InlineKeyboard, InputFile } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import {
  type Period,
  CURRENCY_PRESETS,
  DEFAULT_CURRENCY,
  buildReport,
  currencyName,
  formatMoney,
  formatReport,
  parseMessage,
  periodRange,
  isFutureDay,
  localDate,
  resolveOccurredAt,
} from '@mamoney/core';
import type { Db } from '@mamoney/db';
import {
  type AiCategorizer,
  addCategory,
  archiveCategory,
  listCategories,
  rememberRule,
  resolveCategory,
} from '@mamoney/domain';
import { addPlanned, budgetAlerts, clearPlanned, listPlanned } from '@mamoney/domain';
import {
  addTransaction,
  clearHistory,
  deleteTransaction,
  getBalance,
  getTransaction,
  recentTransactions,
  reportRows,
  setBalance,
  totals,
  updateTransaction,
} from '@mamoney/domain';
import { adminStats, formatStats, isAdmin } from '@mamoney/domain';
import { type User, defaultAccountId, ensureUser, exportCsv, getState, markBlocked, setCurrency, setState } from '@mamoney/domain';
import { BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION, COMMANDS, HELP, esc } from './texts.ts';
import { itemsToLines, type ImageReader, type Transcriber } from './media.ts';

export interface BotDeps {
  db: Db;
  token: string;
  ai?: AiCategorizer;
  publicUrl?: string;
  defaults: { timezone: string; currency: string };
  /** Кому доступна /stats */
  admin?: { ids: number[]; usernames: string[] };
  /** Распознавание голосовых (Deepgram) */
  transcribe?: Transcriber;
  /** Чтение фото чеков и скриншотов (модель с картинками) */
  readImage?: ImageReader;
  /** Скачать файл из Telegram; по умолчанию через Bot API */
  downloadFile?: (fileId: string) => Promise<Buffer>;
  /** Сколько голосовых и фото в сутки распознаём одному человеку (по умолчанию 30) */
  mediaDailyLimit?: number;
  /** Для тестов: готовые данные бота, чтобы не ходить в getMe */
  botInfo?: UserFromGetMe;
}

type Ctx = Context & { user: User };

const cancelKb = new InlineKeyboard().text('Отменить', 'cancel');
const REPORT_TITLES: Record<Period, string> = {
  week: 'С начала недели',
  prev_week: 'Прошлая неделя',
  month: 'С начала месяца',
  prev_month: 'Прошлый месяц',
};

export function createBot(deps: BotDeps) {
  const { db, ai, defaults } = deps;
  const bot = new Bot<Ctx>(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const money = (u: User, n: number) => formatMoney(n, u.currency);
  const appUrl = deps.publicUrl ? `${deps.publicUrl.replace(/\/$/, '')}/app/` : null;

  // Блокировка бота: только помечаем, данные не трогаем
  // Telegram может прислать одно обновление повторно (например, если ответ на вебхук задержался) — второе пропускаем
  const seen = new Set<number>();
  bot.use(async (ctx, next) => {
    const id = ctx.update.update_id;
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
    await next();
  });

  bot.on('my_chat_member', async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (ctx.chat.type === 'private' && status === 'kicked') await markBlocked(db, ctx.chat.id);
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    if (ctx.chat && ctx.chat.type !== 'private') {
      if (ctx.message?.text?.startsWith('/')) await ctx.reply('Я работаю только в личных сообщениях.');
      return;
    }
    ctx.user = (await ensureUser(db, ctx.from, defaults)).user;
    await next();
  });

  // Любая команда сбрасывает режим ввода (в n8n-версии команды записывались как «будущие расходы»)
  bot.on('message:entities:bot_command', async (ctx, next) => {
    await setState(db, ctx.user.id, 'idle');
    await next();
  });

  const tidyMsg = async (ctx: Ctx) => {
    if (ctx.user.settings.cleanChat === false || !ctx.message) return;
    await ctx.deleteMessage().catch(() => {});
  };
  const tidy = tidyMsg;

  const currencyKb = () => {
    const kb = new InlineKeyboard();
    CURRENCY_PRESETS.forEach((c, i) => {
      kb.text(c.code, `cur:${c.code}`);
      if (i % 5 === 4) kb.row();
    });
    return kb.row().text(`«${DEFAULT_CURRENCY}»`, 'cur:-').text('Без валюты', 'cur:0').row().text('Своя…', 'cur:?');
  };
  const askCurrency = (ctx: Ctx) =>
    ctx.reply(
      `Какую валюту показывать? Сейчас: <b>${esc(currencyName(ctx.user.currency))}</b>.\nМожно выбрать из списка, написать свою или оставить без подписи. Поменять потом — /currency или в приложении.`,
      { parse_mode: 'HTML', reply_markup: currencyKb() },
    );

  bot.command('start', async (ctx) => {
    const kb = appUrl ? new InlineKeyboard().webApp('Открыть приложение', appUrl) : undefined;
    await ctx.reply(
      `Привет! Это MaMoney — учёт доходов и расходов прямо в Telegram.\n\nПрисылай сюда текст, голосовое или фото чека — я всё запишу. Посмотреть, поправить и настроить всё можно в приложении (кнопка ниже).\n\n${HELP}`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
    if (!ctx.user.settings.currencyChosen) await askCurrency(ctx);
  });

  bot.command('currency', async (ctx) => {
    await askCurrency(ctx);
    await tidy(ctx);
  });

  // Общая статистика — только владельцу; остальным команда как будто не существует
  bot.command('stats', async (ctx) => {
    if (!deps.admin || !isAdmin(ctx.user, deps.admin)) return ctx.reply('Не знаю такой команды. Список: /commands');
    await ctx.reply(formatStats(await adminStats(db)), { parse_mode: 'HTML' });
  });

  bot.command(['commands', 'help'], (ctx) => ctx.reply(COMMANDS));
  bot.command('creator', (ctx) => ctx.reply('Создатель: @Zelv04\nЕсть идеи или вопросы — пиши!'));
  bot.command('app', async (ctx) => {
    if (!appUrl) return ctx.reply('Приложение скоро появится.');
    await ctx.reply('Открыть MaMoney:', { reply_markup: new InlineKeyboard().webApp('Открыть приложение', appUrl) });
  });

  const sendReport = async (ctx: Ctx, period: Period) => {
    const { start, end } = periodRange(period, ctx.user.timezone);
    const report = buildReport(await reportRows(db, ctx.user.id, start, end));
    const detailed = period === 'week' || period === 'prev_week';
    await ctx.reply(formatReport(REPORT_TITLES[period], report, { detailed, currency: ctx.user.currency }), { parse_mode: 'HTML' });
    await tidy(ctx);
  };
  bot.command('weeknow', (ctx) => sendReport(ctx, 'week'));
  bot.command('week', (ctx) => sendReport(ctx, 'prev_week'));
  bot.command('monthnow', (ctx) => sendReport(ctx, 'month'));
  bot.command('month', (ctx) => sendReport(ctx, 'prev_month'));

  bot.command('total', async (ctx) => {
    const t = await totals(db, ctx.user.id);
    await ctx.reply(`За всё время\nДоход: ${money(ctx.user, t.income)}\nРасход: ${money(ctx.user, t.expense)}`);
    await tidy(ctx);
  });

  bot.command('last', async (ctx) => {
    const rows = await recentTransactions(db, ctx.user.id, 10);
    if (!rows.length) return ctx.reply('Пока нет операций.');
    const lines = rows.map(({ tx, category }) => {
      const sign = tx.type === 'income' ? '+' : '−';
      const d = tx.occurredAt.toLocaleDateString('ru-RU', { timeZone: ctx.user.timezone, day: '2-digit', month: '2-digit' });
      return `${d} ${sign}${money(ctx.user, tx.amount)} · ${esc(tx.title)}${category ? ` <i>(${esc(category)})</i>` : ''}`;
    });
    await ctx.reply(`<b>Последние операции</b>\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command('balance', async (ctx) => {
    await setState(db, ctx.user.id, 'balance');
    await ctx.reply(`Сейчас баланс: ${money(ctx.user, await getBalance(db, ctx.user.id))}\n\nЧтобы изменить, пришли новое значение числом.`, {
      reply_markup: cancelKb,
    });
    await tidy(ctx);
  });

  const categoriesText = async (u: User) => {
    const exp = await listCategories(db, u.id, 'expense');
    const inc = await listCategories(db, u.id, 'income');
    return `<b>Расходы:</b> ${esc(exp.map((c) => c.name).join(', ') || '—')}\n<b>Доходы:</b> ${esc(inc.map((c) => c.name).join(', ') || '—')}`;
  };

  bot.command('category', async (ctx) => {
    await setState(db, ctx.user.id, 'category');
    await ctx.reply(
      `${await categoriesText(ctx.user)}\n\nДобавить или убрать: <code>1+кафе</code>, <code>1-кафе</code> (расходы), <code>2+подработка</code> (доходы).`,
      { parse_mode: 'HTML', reply_markup: cancelKb },
    );
    await tidy(ctx);
  });

  bot.command('future', async (ctx) => {
    await setState(db, ctx.user.id, 'planned');
    await ctx.reply('Пиши планы и будущие траты в любом формате, по одному сообщению. Когда закончишь — /cancel или кнопка ниже.', {
      reply_markup: cancelKb,
    });
    await tidy(ctx);
  });

  bot.command('show_future', async (ctx) => {
    const list = await listPlanned(db, ctx.user.id);
    const line = (p: (typeof list)[number]) =>
      `• ${p.title}${p.amount ? ` — ${money(ctx.user, p.amount)}` : ''}${p.dueDate ? ` (${p.dueDate.split('-').reverse().slice(0, 2).join('.')})` : ''}`;
    await ctx.reply(list.length ? `Будущие траты:\n${list.map(line).join('\n')}` : 'Планов пока нет. Добавить — /future или запиши трату с будущей датой: «20.11 5000 ремонт»');
    await tidy(ctx);
  });

  bot.command('delete_future', async (ctx) => {
    await clearPlanned(db, ctx.user.id);
    await ctx.reply('Планы очищены.');
    await tidy(ctx);
  });

  bot.command('clear', async (ctx) => {
    await ctx.reply('Удалить всю историю операций? Это нельзя отменить.', {
      reply_markup: new InlineKeyboard().text('Да, удалить', 'clear:yes').text('Отменить', 'cancel'),
    });
    await tidy(ctx);
  });

  bot.command('cancel', async (ctx) => {
    await ctx.reply('Отменено.');
    await tidy(ctx);
  });

  bot.command('export', async (ctx) => {
    await ctx.replyWithDocument(new InputFile(await exportCsv(db, ctx.user.id), 'mamoney.csv'));
  });

  // ----- Кнопки -----
  bot.callbackQuery('cancel', async (ctx) => {
    await setState(db, ctx.user.id, 'idle');
    await ctx.answerCallbackQuery('Отменено');
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(/^cur:(.+)$/, async (ctx) => {
    const v = ctx.match[1]!;
    if (v === '?') {
      await setState(db, ctx.user.id, 'currency');
      await ctx.answerCallbackQuery();
      return ctx.editMessageText('Напиши, как подписывать суммы: код (GBP), символ (₿) или слово (баллов). До 12 символов.', { reply_markup: cancelKb });
    }
    const u = await setCurrency(db, ctx.user.id, v === '-' ? DEFAULT_CURRENCY : v === '0' ? '' : v);
    await ctx.answerCallbackQuery('Сохранено');
    await ctx.editMessageText(`Валюта: ${esc(currencyName(u.currency))}. Например: ${money(u, 1500)}`).catch(() => {});
  });

  bot.callbackQuery('clear:yes', async (ctx) => {
    await clearHistory(db, ctx.user.id);
    await ctx.answerCallbackQuery('Удалено');
    await ctx.editMessageText('История очищена. Начинаем с чистого листа.').catch(() => {});
  });

  bot.callbackQuery(/^undo:(\d+)$/, async (ctx) => {
    const t = await deleteTransaction(db, ctx.user.id, Number(ctx.match[1]));
    await ctx.answerCallbackQuery(t ? 'Запись удалена' : 'Уже удалена');
    const bal = money(ctx.user, await getBalance(db, ctx.user.id));
    await ctx.editMessageText(t ? `Удалено: ${esc(t.title)}, ${money(ctx.user, t.amount)}\nБаланс: ${bal}` : 'Запись уже удалена').catch(() => {});
  });

  bot.callbackQuery(/^cat:(\d+)$/, async (ctx) => {
    const t = await getTransaction(db, ctx.user.id, Number(ctx.match[1]));
    if (!t || t.type === 'transfer') return ctx.answerCallbackQuery('Запись не найдена');
    const list = await listCategories(db, ctx.user.id, t.type);
    const kb = new InlineKeyboard();
    list.forEach((c, i) => {
      kb.text(c.name, `setcat:${t.id}:${c.id}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  });

  bot.callbackQuery(/^setcat:(\d+):(\d+)$/, async (ctx) => {
    const [txId, catId] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const list = await listCategories(db, ctx.user.id);
    const cat = list.find((c) => c.id === catId);
    const t = cat && (await updateTransaction(db, ctx.user.id, txId, { categoryId: catId }));
    if (!t || !cat) return ctx.answerCallbackQuery('Не получилось');
    await rememberRule(db, ctx.user.id, t.title, catId);
    await ctx.answerCallbackQuery(`Категория: ${cat.name}`);
    await ctx.editMessageText(await recordText(ctx.user, t.type, t.amount, t.title, cat.name), {
      parse_mode: 'HTML',
      reply_markup: recordKb(t.id),
    });
  });

  // ----- Текст -----
  const recordKb = (id: number) => new InlineKeyboard().text('Отменить', `undo:${id}`).text('Категория', `cat:${id}`);
  const recordText = async (u: User, type: string, amount: number, title: string, category: string) =>
    `${type === 'income' ? '🟢 Доход' : '🔴 Расход'}: ${money(u, amount)}\n${esc(title)} · <i>${esc(category)}</i>\n\nБаланс: ${money(u, await getBalance(db, u.id))}`;

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply('Не знаю такой команды. Список: /commands');
    return handleText(ctx, text);
  });

  const MAX_FILE = 20 * 1024 * 1024; // больше Bot API скачать не даёт
  // Распознавание голоса и фото платное или с общим лимитом: не даём одному человеку израсходовать всё
  const mediaLimit = deps.mediaDailyLimit ?? 30;
  const mediaUse = new Map<number, { day: string; n: number }>();
  const mediaAllowed = (userId: number) => {
    const day = new Date().toISOString().slice(0, 10);
    const u = mediaUse.get(userId);
    const n = u?.day === day ? u.n : 0;
    if (n >= mediaLimit) return false;
    mediaUse.set(userId, { day, n: n + 1 });
    return true;
  };
  const LIMIT_TEXT = 'На сегодня лимит голосовых и фото исчерпан. Напиши текстом, например: 350 кофе';
  const download =
    deps.downloadFile ??
    (async (fileId: string) => {
      const f = await bot.api.getFile(fileId);
      const res = await fetch(`https://api.telegram.org/file/bot${deps.token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`file ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });

  // Голосовые: распознаём и обрабатываем как обычный текст
  bot.on(['message:voice', 'message:audio', 'message:video_note'], async (ctx) => {
    if (!deps.transcribe) return ctx.reply('Голосовые пока не подключены. Напиши текстом, например: 350 кофе');
    const m = ctx.message;
    const media = m.voice ?? m.audio ?? m.video_note!;
    if ((media.duration ?? 0) > 300) return ctx.reply('Слишком длинное голосовое: до 5 минут.');
    if ((media.file_size ?? 0) > MAX_FILE) return ctx.reply('Файл слишком большой.');
    if (!mediaAllowed(ctx.user.id)) return ctx.reply(LIMIT_TEXT);
    await ctx.replyWithChatAction('typing').catch(() => {});
    const mime = m.voice?.mime_type ?? m.audio?.mime_type ?? (m.video_note ? 'video/mp4' : 'audio/ogg');
    let text: string | null = null;
    try {
      text = await deps.transcribe(await download(media.file_id), mime);
    } catch (e) {
      console.error('Голосовое', (e as Error).message);
    }
    if (!text) return ctx.reply('Не получилось разобрать голосовое. Попробуй ещё раз или напиши текстом.');
    await ctx.reply(`🎙 <i>${esc(text)}</i>`, { parse_mode: 'HTML' });
    return handleText(ctx, text, { keepMessage: true });
  });

  // Фото чека или скриншота: показываем, что нашли, и записываем после подтверждения
  bot.on(['message:photo', 'message:document'], async (ctx, next) => {
    const m = ctx.message;
    const doc = m.document;
    if (doc && !doc.mime_type?.startsWith('image/')) return next();
    if (!deps.readImage) return ctx.reply('Фото пока не подключены. Напиши текстом, например: 350 кофе');
    const file = doc ?? m.photo!.at(-1)!;
    if ((file.file_size ?? 0) > MAX_FILE) return ctx.reply('Файл слишком большой.');
    if (!mediaAllowed(ctx.user.id)) return ctx.reply(LIMIT_TEXT);
    await ctx.replyWithChatAction('typing').catch(() => {});
    let items: Awaited<ReturnType<ImageReader>> = null;
    try {
      items = await deps.readImage(await download(file.file_id), doc?.mime_type ?? 'image/jpeg', {
        today: localDate(new Date(), ctx.user.timezone),
        caption: m.caption?.trim() || undefined,
      });
    } catch (e) {
      console.error('Фото', (e as Error).message);
    }
    if (!items) return ctx.reply('Не получилось прочитать фото: бесплатные модели сейчас перегружены. Попробуй через минуту или напиши текстом, например: 92,84 коммуналка');
    if (!items.length) return ctx.reply('Не нашёл на фото сумм. Можно написать текстом, например: 350 кофе');
    const lines = itemsToLines(items);
    await setState(db, ctx.user.id, 'photo', { lines });
    await ctx.reply(
      `📷 Нашёл на фото:\n<code>${esc(lines.join('\n'))}</code>\n\nЗаписать? Если что-то не так, пришли исправленный текст, и я запишу его.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('Записать', 'photo:ok').text('Отмена', 'cancel') },
    );
  });

  bot.callbackQuery('photo:ok', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { state, payload } = await getState(db, ctx.user.id);
    const lines = Array.isArray(payload.lines) ? (payload.lines as string[]) : [];
    if (state !== 'photo' || !lines.length) return ctx.editMessageReplyMarkup().catch(() => {});
    await setState(db, ctx.user.id, 'idle');
    await ctx.editMessageReplyMarkup().catch(() => {});
    return handleText(ctx, lines.join('\n'), { keepMessage: true });
  });

  /** Обработка текста: из сообщения, распознанного голосового или фото */
  const handleText = async (ctx: Ctx, text: string, { keepMessage = false } = {}) => {
    const tidy = (c: Ctx) => (keepMessage ? Promise.resolve() : tidyMsg(c));
    const { state } = await getState(db, ctx.user.id);
    if (state === 'photo') await setState(db, ctx.user.id, 'idle'); // прислал исправленный текст вместо подтверждения

    if (state === 'currency') {
      const u = await setCurrency(db, ctx.user.id, text);
      await setState(db, ctx.user.id, 'idle');
      await ctx.reply(`Валюта: ${esc(currencyName(u.currency))}. Например: ${money(u, 1500)}`);
      return tidy(ctx);
    }

    if (state === 'balance') {
      const v = Number(text.replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.-]+$/, ''));
      if (!Number.isFinite(v)) return ctx.reply('Пришли просто число, например 15000 или -200,50', { reply_markup: cancelKb });
      await setBalance(db, ctx.user.id, await defaultAccountId(db, ctx.user.id), v);
      await setState(db, ctx.user.id, 'idle');
      await ctx.reply(`Баланс обновлён: ${money(ctx.user, await getBalance(db, ctx.user.id))}`);
      return tidy(ctx);
    }

    if (state === 'category') {
      const m = text.match(/^([12])\s*([+-])\s*(.+)$/s);
      if (!m) return ctx.reply('Формат: 1+кафе или 2-подработка', { reply_markup: cancelKb });
      const type = m[1] === '1' ? 'expense' : 'income';
      const name = m[3]!.trim();
      if (m[2] === '+') {
        const r = await addCategory(db, ctx.user.id, type, name);
        if (r === 'exists') return ctx.reply('Такая категория уже есть.', { reply_markup: cancelKb });
      } else if (!(await archiveCategory(db, ctx.user.id, type, name))) {
        return ctx.reply('Нет такой категории.', { reply_markup: cancelKb });
      }
      await setState(db, ctx.user.id, 'idle');
      await ctx.reply(`Готово.\n\n${await categoriesText(ctx.user)}`, { parse_mode: 'HTML' });
      return tidy(ctx);
    }

    if (state === 'planned') {
      await addPlanned(db, ctx.user.id, text);
      await ctx.reply(`Записано в планы: ${text}`, { reply_markup: cancelKb });
      return tidy(ctx);
    }

    const results = parseMessage(text);
    if (results.every((r) => !r.ok)) {
      return ctx.reply('Не понял запись. Нужна сумма и название, например <code>350 кофе</code>.\nПодробнее: /start', {
        parse_mode: 'HTML',
      });
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    const accountId = await defaultAccountId(db, ctx.user.id);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const [i, r] of results.entries()) {
      if (!r.ok) {
        await ctx.reply(`Пропустил строку «${lines[i]}»: не нашёл ${r.error === 'no_amount' ? 'сумму' : 'название'}.`);
        continue;
      }
      const occurredAt = resolveOccurredAt(r.tx.date, r.tx.dayOffset, ctx.user.timezone);
      if (isFutureDay(occurredAt, ctx.user.timezone)) {
        const due = localDate(occurredAt, ctx.user.timezone);
        await addPlanned(db, ctx.user.id, r.tx.title, { amount: r.tx.amount, dueDate: due, type: r.tx.type });
        await ctx.reply(
          `🗓 В будущие траты: ${r.tx.title}, ${money(ctx.user, r.tx.amount)} на ${due.split('-').reverse().join('.')}\nВ баланс не идёт, пока не запишешь как операцию. Все планы — /show_future`,
        );
        continue;
      }
      const { category } = await resolveCategory(
        db,
        ctx.user.id,
        { type: r.tx.type, title: r.tx.title, text: lines[i] ?? text, hint: r.tx.categoryHint },
        ai,
      );
      const t = await addTransaction(db, {
        userId: ctx.user.id,
        accountId,
        categoryId: category.id,
        type: r.tx.type,
        amount: r.tx.amount,
        currency: ctx.user.currency,
        title: r.tx.title,
        occurredAt,
        source: 'bot',
        rawText: lines[i] ?? text,
      });
      let msg = await recordText(ctx.user, t.type, t.amount, t.title, category.name);
      if (t.type === 'expense') {
        for (const b of await budgetAlerts(db, ctx.user.id, category.id, ctx.user.timezone)) {
          const name = b.categoryId ? category.name : 'все расходы';
          msg += b.ratio > 1
            ? `\n⚠️ Бюджет «${esc(name)}» превышен: ${money(ctx.user, b.spent)} из ${money(ctx.user, b.amount)}`
            : `\n❗ Бюджет «${esc(name)}»: потрачено ${Math.round(b.ratio * 100)}% (${money(ctx.user, b.spent)} из ${money(ctx.user, b.amount)})`;
        }
      }
      await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: recordKb(t.id) });
    }
    await tidy(ctx);
  };

  bot.on('message', (ctx) => ctx.reply('Понимаю текст, голосовые и фото чеков. Например: 350 кофе'));

  bot.catch((err) => {
    console.error('Ошибка в обработчике', err.error);
  });

  return bot;
}

export async function setupBotProfile(bot: Bot<any>, appUrl: string | null) {
  await bot.api.setMyCommands(BOT_COMMANDS);
  await bot.api.setMyDescription(BOT_DESCRIPTION);
  await bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION);
  if (appUrl) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Приложение', web_app: { url: appUrl } } });
  }
}
