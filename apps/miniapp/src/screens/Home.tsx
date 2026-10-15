import { useState } from 'react';
import { api, type Period } from '../api';
import { BarList } from '../components/BarList';
import { TxItem } from '../components/TxList';
import { ErrorBox, Loading, Segments } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import { useLoad } from '../hooks';
import { BudgetBar } from './Budgets';

export function Home({ go }: { go: (tab: 'tx' | 'budgets') => void }) {
  const { version, me, categories } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  const s = useLoad(() => api.summary(period), [period, version]);
  const recent = useLoad(() => api.transactions({ limit: 5 }), [version]);

  if (s.error) return <ErrorBox error={s.error} retry={s.reload} />;
  if (!s.data) return <Loading />;
  const d = s.data;
  const expenses = d.categories.filter((c) => c.type === 'expense');

  return (
    <>
      <div className="card hero">
        <div className="label">{me?.user.firstName ? `${me.user.firstName}, твой баланс` : 'Баланс'}</div>
        <div className="value num">{money(d.balance)}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <Segments value={period} onChange={setPeriod} options={[{ id: 'week', label: 'Эта неделя' }, { id: 'month', label: 'Этот месяц' }] as const} />
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="label"><span className="dot" style={{ background: 'var(--income)' }} />Доход</div>
          <div className="value num">{money(d.income)}</div>
        </div>
        <div className="card tile">
          <div className="label"><span className="dot" style={{ background: 'var(--expense)' }} />Расход</div>
          <div className="value num">{money(d.expense)}</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread">
          <span className="muted">Итог периода</span>
          <span className="num" style={{ fontWeight: 650, color: d.net >= 0 ? 'var(--good)' : 'var(--crit)' }}>
            {d.net >= 0 ? '▲ ' : '▼ '}
            {money(d.net, { sign: true })}
          </span>
        </div>
        <div className="row spread" style={{ marginTop: 6 }}>
          <span className="muted">В среднем в день</span>
          <span className="num">{money(d.avgExpensePerDay)}</span>
        </div>
      </div>

      {d.budgets.length > 0 && (
        <>
          <div className="section-title row spread">
            <span>Бюджеты</span>
            <button className="chip" onClick={() => go('budgets')}>Все</button>
          </div>
          <div className="card">
            {d.budgets.slice(0, 3).map((b) => (
              <BudgetBar key={b.id} b={b} name={b.categoryId ? categories.find((c) => c.id === b.categoryId)?.name ?? '—' : 'Все расходы'} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">Куда ушли деньги</div>
      <div className="card">
        <BarList items={expenses} total={d.expense} color="var(--expense)" limit={6} />
      </div>

      <div className="section-title row spread">
        <span>Последние операции</span>
        <button className="chip" onClick={() => go('tx')}>Все</button>
      </div>
      {recent.data?.items.length ? (
        <div className="list">{recent.data.items.map((t) => <TxItem key={t.id} tx={t} />)}</div>
      ) : (
        <div className="card empty">Пока пусто. Нажми «+» или напиши боту «350 кофе».</div>
      )}
    </>
  );
}
