import { useState } from 'react';
import { api, type Budget } from '../api';
import { ErrorBox, Loading, Segments, Sheet, toast } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import { useLoad } from '../hooks';
import { haptic } from '../tg';

/** Прогресс бюджета. Состояние подписано текстом и значком, не только цветом. */
export function BudgetBar({ b, name, onClick }: { b: Budget; name: string; onClick?: () => void }) {
  const ratio = b.amount ? b.spent / b.amount : 0;
  const state = ratio > 1 ? { c: 'var(--crit)', t: `⚠ Превышен на ${money(b.spent - b.amount)}` } : ratio >= 0.8 ? { c: 'var(--warn)', t: `! Осталось ${money(b.amount - b.spent)}` } : { c: 'var(--accent)', t: `Осталось ${money(b.amount - b.spent)}` };
  return (
    <div style={{ padding: '8px 0' }} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="row spread">
        <span className="ellipsis">{name} <span className="badge">{b.period === 'week' ? 'неделя' : 'месяц'}</span></span>
        <span className="num">{money(b.spent)} <span className="muted">/ {money(b.amount)}</span></span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.min(100, ratio * 100)}%`, background: state.c }} />
      </div>
      <div className="row spread" style={{ fontSize: 13 }}>
        <span style={{ color: ratio >= 0.8 ? state.c : 'var(--sub)' }}>{state.t}</span>
        {b.forecast > b.amount && ratio <= 1 && <span className="muted">прогноз {money(b.forecast)}</span>}
      </div>
    </div>
  );
}

export function Budgets() {
  const { version, categories, refresh } = useApp();
  const list = useLoad(() => api.budgets(), [version]);
  const [edit, setEdit] = useState<Partial<Budget> | null>(null);
  const [amount, setAmount] = useState('');
  const name = (id: number | null) => (id ? categories.find((c) => c.id === id)?.name ?? '—' : 'Все расходы');

  const open = (b: Partial<Budget>) => {
    setEdit(b);
    setAmount(b.amount ? String(b.amount) : '');
  };
  const save = async () => {
    const a = Number(amount.replace(/\s/g, '').replace(',', '.'));
    if (!(a > 0) || !edit) return;
    await api.saveBudget({ id: edit.id, categoryId: edit.categoryId ?? null, period: edit.period ?? 'month', amount: a });
    haptic.ok();
    toast('Бюджет сохранён');
    setEdit(null);
    refresh();
  };
  const remove = async () => {
    if (!edit?.id) return;
    await api.deleteBudget(edit.id);
    setEdit(null);
    refresh();
  };

  return (
    <>
      <div className="title">Бюджеты</div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className="card empty">
          Задай лимит на месяц или неделю — общий или на категорию. Бот предупредит, когда потратишь 80%.
        </div>
      ) : (
        <div className="card">
          {list.data.map((b) => (
            <BudgetBar key={b.id} b={b} name={name(b.categoryId)} onClick={() => open(b)} />
          ))}
        </div>
      )}
      <button className="btn" onClick={() => open({ categoryId: null, period: 'month' })}>Добавить бюджет</button>

      <Sheet open={!!edit} onClose={() => setEdit(null)}>
        <div className="title">{edit?.id ? 'Бюджет' : 'Новый бюджет'}</div>
        <Segments value={edit?.period ?? 'month'} onChange={(p) => setEdit({ ...edit, period: p })} options={[{ id: 'month', label: 'На месяц' }, { id: 'week', label: 'На неделю' }] as const} />
        <input className="input amount-input num" inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} />
        <div className="field">
          <span>Категория</span>
          <div className="chips">
            <button className={`chip ${!edit?.categoryId ? 'on' : ''}`} onClick={() => setEdit({ ...edit, categoryId: null })}>Все расходы</button>
            {categories.filter((c) => c.type === 'expense' && !c.archived).map((c) => (
              <button key={c.id} className={`chip ${edit?.categoryId === c.id ? 'on' : ''}`} onClick={() => setEdit({ ...edit, categoryId: c.id })}>
                {c.emoji ? `${c.emoji} ` : ''}{c.name}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" onClick={save} disabled={!(Number(amount.replace(/\s/g, '').replace(',', '.')) > 0)}>Сохранить</button>
        {edit?.id && <button className="btn danger" onClick={remove}>Удалить</button>}
      </Sheet>
    </>
  );
}
