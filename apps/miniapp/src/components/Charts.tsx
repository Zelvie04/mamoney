import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';
import { money, monthLabel } from '../format';

/** SVG-атрибуты не понимают var(--x): берём реальные цвета из CSS и следим за сменой темы */
function useColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return { income: v('--income'), expense: v('--expense'), grid: v('--grid'), axis: v('--axis'), track: v('--track') };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** Короткие подписи оси: 8к, 1,2 млн */
const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн` : v >= 1000 ? `${Math.round(v / 1000)}к` : String(v));


function Tip({ active, payload, label, fmtLabel }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="t">{fmtLabel ? fmtLabel(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="num">
          <span className="dot" style={{ background: p.color }} />
          {p.name}: {money(p.value)}
        </div>
      ))}
    </div>
  );
}

const shortDay = (d: string) => String(Number(d.slice(8, 10)));
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

/** Расходы по дням: одна серия, без легенды (название — в заголовке карточки) */
export function DailyChart({ data }: { data: { day: string; expense: number }[] }) {
  const c = useColors();
  const axis = { stroke: c.axis, fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <div className="chart" role="img" aria-label="Расходы по дням">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={8} />
          <YAxis {...axis} width={36} tickFormatter={short} />
          <Tooltip cursor={{ fill: c.track }} content={<Tip fmtLabel={longDay} />} />
          <Bar dataKey="expense" name="Расход" fill={c.expense} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Доходы и расходы по месяцам: две серии, одна ось, легенда + таблица рядом */
export function MonthlyChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  const c = useColors();
  const axis = { stroke: c.axis, fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <>
      <div className="legend">
        <span><span className="dot" style={{ background: 'var(--income)' }} />Доход</span>
        <span><span className="dot" style={{ background: 'var(--expense)' }} />Расход</span>
      </div>
      <div className="chart" role="img" aria-label="Доходы и расходы по месяцам">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} />
            <YAxis {...axis} width={36} tickFormatter={short} />
            <Tooltip cursor={{ fill: c.track }} content={<Tip fmtLabel={(m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} />} />
            <Bar dataKey="income" name="Доход" fill={c.income} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Bar dataKey="expense" name="Расход" fill={c.expense} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
