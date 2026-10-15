export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const HELP = `Пиши операции обычным текстом, сумму можно ставить в любом месте:
<code>350 кофе</code>
<code>такси 1.5к</code>
<code>вчера 1200 продукты</code>
<code>зп 80000</code> или <code>+5000 вернули долг</code> — доход

Категорию можно указать сразу: <code>50 кфс.кафе</code> или <code>50 кфс #кафе</code>. Иначе бот подберёт её сам и запомнит.
Несколько операций — по одной на строку.

Команды: /commands`;

export const COMMANDS = `/start — приветствие и инструкция
/app — открыть приложение
/weeknow — эта неделя
/week — прошлая неделя
/monthnow — этот месяц
/month — прошлый месяц
/last — последние операции
/balance — баланс и его изменение
/currency — валюта
/total — доходы и расходы за всё время
/category — категории
/future — записать планы на будущее
/show_future — показать планы
/delete_future — очистить планы
/export — выгрузка в CSV
/clear — удалить всю историю
/cancel — отменить текущее действие
/creator — об авторе`;

export const BOT_COMMANDS: { command: string; description: string }[] = COMMANDS.split('\n').map((l) => {
  const [c, d] = l.split(' — ');
  return { command: c!.slice(1), description: d! };
});
