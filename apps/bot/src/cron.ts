import { GrammyError, type Api } from 'grammy';
import { eq, isNull, sql } from 'drizzle-orm';
import { buildReport, formatReport, periodRange } from '@mamoney/core';
import { users, type Db } from '@mamoney/db';
import { listPlanned } from '@mamoney/domain';
import { reportRows } from '@mamoney/domain';
import { markBlocked } from '@mamoney/domain';

const DEFAULT_REPORT_HOUR = 9;

function localNow(tz: string, now: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', weekday: 'short', day: 'numeric', hour: 'numeric' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { weekday: g('weekday'), day: Number(g('day')), hour: Number(g('hour')) };
}

export interface ScheduledResult { sent: number; blocked: number; failed: number }

/**
 * Раз в час: кому сейчас (по его часовому поясу) пора получить недельный или месячный отчёт.
 * Повторная отправка в тот же день исключена отметкой в settings.
 * Если бот заблокирован — помечаем пользователя; данные никогда не удаляются.
 */
export async function runScheduledReports(db: Db, api: Api, now = new Date(), log = console.log): Promise<ScheduledResult> {
  const res: ScheduledResult = { sent: 0, blocked: 0, failed: 0 };
  const list = await db.select().from(users).where(isNull(users.blockedAt));
  const today = now.toISOString().slice(0, 10);

  for (const u of list) {
    const s = u.settings ?? {};
    const l = localNow(u.timezone, now);
    if (l.hour !== (s.reportHour ?? DEFAULT_REPORT_HOUR)) continue;
    const jobs: ('prev_week' | 'prev_month')[] = [];
    if (l.weekday === 'Mon' && s.weeklyReport !== false && (s as any).lastWeekly !== today) jobs.push('prev_week');
    if (l.day === 1 && s.monthlyReport !== false && (s as any).lastMonthly !== today) jobs.push('prev_month');

    for (const job of jobs) {
      const { start, end } = periodRange(job, u.timezone, now);
      const rows = await reportRows(db, u.id, start, end);
      if (!rows.length) continue; // пустые отчёты не шлём
      let text = formatReport(job === 'prev_week' ? 'Итоги прошлой недели' : 'Итоги прошлого месяца', buildReport(rows), {
        detailed: job === 'prev_week',
        currency: u.currency,
      });
      const planned = await listPlanned(db, u.id);
      if (planned.length) text += `\n\n<b>Планы</b>\n${planned.map((p) => `• ${p.title}`).join('\n')}`;
      try {
        await api.sendMessage(u.tgId, text, { parse_mode: 'HTML' });
        res.sent++;
        const key = job === 'prev_week' ? 'lastWeekly' : 'lastMonthly';
        await db
          .update(users)
          .set({ settings: sql`${users.settings} || ${JSON.stringify({ [key]: today })}::jsonb` })
          .where(eq(users.id, u.id));
      } catch (e) {
        if (e instanceof GrammyError && (e.error_code === 403 || /chat not found/i.test(e.description))) {
          await markBlocked(db, u.tgId);
          res.blocked++;
          break;
        }
        res.failed++;
        log(`Отчёт ${job} для ${u.tgId} не отправлен: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 50)); // не упираться в лимиты Telegram
    }
  }
  return res;
}

/** Запуск в начале каждого часа. */
export function startScheduler(db: Db, api: Api, adminChatId: number | null) {
  const tick = async () => {
    try {
      const r = await runScheduledReports(db, api);
      if ((r.sent || r.failed) && adminChatId) {
        await api.sendMessage(adminChatId, `Отчёты: отправлено ${r.sent}, бот заблокирован ${r.blocked}, ошибок ${r.failed}`).catch(() => {});
      }
    } catch (e) {
      console.error('Сбой планировщика', e);
    }
  };
  const msToNextHour = 3600_000 - (Date.now() % 3600_000) + 5_000;
  setTimeout(() => {
    void tick();
    setInterval(tick, 3600_000);
  }, msToNextHour);
}

