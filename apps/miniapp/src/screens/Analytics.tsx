import { useState } from 'react';
import { api, type Period } from '../api';
import { BarList } from '../components/BarList';
import { DailyChart, MonthlyChart } from '../components/Charts';
import { ErrorBox, Loading, Segments } from '../components/ui';
import { useApp } from '../context';
import { PERIODS, money, monthLabel } from '../format';
import { useLoad } from '../hooks';

export function Analytics() {
  const { version } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  const [table, setTable] = useState(false);
  const s = useLoad(() => api.summary(period), [period, version]);
  const prev = useLoad(
    () => (period === 'month' || period === 'week' ? api.summary(period === 'month' ? 'prev_month' : 'prev_week') : Promise.resolve(null)),
    [period, version],
  );
  const m = useLoad(() => api.monthly(12), [version]);

  return (
    <>
      <div className="title">Аналитика</div>
      <Segments value={period} onChange={setPeriod} options={PERIODS} />
      {s.error && <ErrorBox error={s.error} retry={s.reload} />}
      {!s.data ? (
        <div style={{ marginTop: 10 }}><Loading /></div>
      ) : (
        <>
          <div className="tiles">
            <div className="card tile">
              <div className="label">Расход</div>
              <div className="value num">{money(s.data.expense)}</div>
              {(period === 'month' || period === 'week') && prev.data && prev.data.expense > 0 && (
                <Delta now={s.data.expense} before={prev.data.expense} />
              )}
            </div>
            <div className="card tile">
              <div className="label">В среднем в день</div>
              <div className="value num">{money(s.data.avgExpensePerDay)}</div>
            </div>
          </div>

          <div className="section-title">{period === 'all' ? 'Расходы по месяцам' : 'Расходы по дням'}</div>
          <div className="card">
            {!s.data.daily.some((d) => d.expense > 0) ? <div className="empty">Нет расходов за период</div> : period === 'all' ? <MonthlyChart data={byMonth(s.data.daily)} /> : <DailyChart data={fillDays(s.data.daily)} />}
          </div>

          <div className="section-title">Расходы по категориям</div>
          <div className="card">
            <BarList items={s.data.categories.filter((c) => c.type === 'expense')} total={s.data.expense} color="var(--expense)" />
          </div>

          <div className="section-title">Доходы по категориям</div>
          <div className="card">
            <BarList items={s.data.categories.filter((c) => c.type === 'income')} total={s.data.income} color="var(--income)" />
          </div>
        </>
      )}

      {period !== 'all' && (<>
      <div className="section-title row spread">
        <span>12 месяцев</span>
        <button className="chip" onClick={() => setTable(!table)}>{table ? 'График' : 'Таблица'}</button>
      </div>
      <div className="card">
        {!m.data ? (
          <Loading />
        ) : table ? (
          <table className="num" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr className="muted"><th align="left">Месяц</th><th align="right">Доход</th><th align="right">Расход</th><th align="right">Итог</th></tr>
            </thead>
            <tbody>
              {[...m.data].reverse().map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)} {r.month.slice(2, 4)}</td>
                  <td align="right">{money(r.income)}</td>
                  <td align="right">{money(r.expense)}</td>
                  <td align="right">{money(r.income - r.expense, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <MonthlyChart data={m.data} />
        )}
      </div>
      </>)}
    </>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct > 0;
  return (
    <div style={{ fontSize: 13, marginTop: 2, color: up ? 'var(--crit)' : 'var(--good)' }}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% к прошлому
    </div>
  );
}

/** Дни без операций тоже показываем — иначе столбики «слипаются» */
function fillDays(daily: { day: string; income: number; expense: number }[]) {
  if (!daily.length) return daily;
  const map = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  const start = new Date(`${daily[0]!.day}T12:00:00Z`);
  const end = new Date(`${daily.at(-1)!.day}T12:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400_000)) {
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, income: 0, expense: 0 });
  }
  return out;
}

function byMonth(daily: { day: string; income: number; expense: number }[]) {
  const m = new Map<string, { month: string; income: number; expense: number }>();
  for (const d of daily) {
    const k = d.day.slice(0, 7);
    const r = m.get(k) ?? { month: k, income: 0, expense: 0 };
    r.income += d.income;
    r.expense += d.expense;
    m.set(k, r);
  }
  return [...m.values()];
}
