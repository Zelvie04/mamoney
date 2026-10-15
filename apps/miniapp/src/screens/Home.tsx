import { useState } from 'react';
import { api, type Period } from '../api';
import { BarList } from '../components/BarList';
import { TxItem } from '../components/TxList';
import { ErrorBox, Loading, Segments, Sheet, toast } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import { useLoad } from '../hooks';
import { haptic } from '../tg';
import { BudgetBar } from './Budgets';
import { PlannedRow, plannedTotal } from '../components/PlannedList';

export function Home({ go }: { go: (tab: 'tx' | 'budgets' | 'planned') => void }) {
  const { version, me, categories } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  const s = useLoad(() => api.summary(period), [period, version]);
  const recent = useLoad(() => api.transactions({ limit: 5 }), [version]);
  const planned = useLoad(() => api.planned(), [version]);
  const [editBalance, setEditBalance] = useState(false);

  if (s.error) return <ErrorBox error={s.error} retry={s.reload} />;
  if (!s.data) return <Loading />;
  const d = s.data;
  const expenses = d.categories.filter((c) => c.type === 'expense');

  return (
    <>
      <div className="card hero">
        <button className="balance-btn" onClick={() => (haptic.tap(), setEditBalance(true))} aria-label="Изменить баланс">
          <div className="label">{me?.user.firstName ? `${me.user.firstName}, твой баланс` : 'Баланс'}</div>
          <div className="value num">{money(d.balance)}</div>
          <div className="edit">Изменить</div>
        </button>
      </div>
      <BalanceSheet open={editBalance} current={d.balance} onClose={() => setEditBalance(false)} />

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
        <div className="list">{recent.data.items.map((t) => <TxItem key={t.id} tx={t} showDate />)}</div>
      ) : (
        <div className="card empty">Пока пусто. Нажми «+» или напиши боту «350 кофе».</div>
      )}

      <div className="section-title row spread">
        <span>Будущие траты</span>
        <button className="chip" onClick={() => go('planned')}>{planned.data?.length ? 'Все' : 'Добавить'}</button>
      </div>
      {planned.data?.length ? (
        <>
          <div className="list">
            {planned.data.slice(0, 4).map((p) => <PlannedRow key={p.id} p={p} onClick={() => go('planned')} />)}
          </div>
          {plannedTotal(planned.data) > 0 && (
            <div className="muted" style={{ margin: '8px 4px', fontSize: 14 }}>
              Всего запланировано {money(plannedTotal(planned.data))}
              {planned.data.length > 4 ? ` · ещё ${planned.data.length - 4}` : ''}
            </div>
          )}
        </>
      ) : (
        <div className="card empty" style={{ padding: '18px 16px' }}>Здесь появятся траты с будущей датой. Выбери дату позже сегодняшней при добавлении.</div>
      )}
    </>
  );
}

/** Ручная корректировка баланса: операции не меняются, сдвигается начальный остаток счёта */
function BalanceSheet({ open, current, onClose }: { open: boolean; current: number; onClose: () => void }) {
  const { refresh } = useApp();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const num = Number(value.replace(/\s/g, '').replace(',', '.'));
  const ok = value.trim() !== '' && Number.isFinite(num);
  const save = async () => {
    setBusy(true);
    try {
      await api.setBalance(num);
      haptic.ok();
      toast('Баланс обновлён');
      setValue('');
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="title">Баланс</div>
      <p className="sub" style={{ marginTop: -4 }}>Сейчас {money(current)}. Укажи, сколько денег на самом деле, и баланс подстроится. История операций не изменится.</p>
      <input className="input" inputMode="decimal" autoFocus placeholder={String(current)} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,\s-]/g, ''))} />
      <button className="btn" disabled={!ok || busy} onClick={save}>Сохранить</button>
    </Sheet>
  );
}
