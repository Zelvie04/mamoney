import type { Tx } from '../api';
import { useApp } from '../context';
import { dayLabel, money } from '../format';
import { catIcon } from './ui';

/** «Сегодня», «Вчера» или «12 окт.» (год — только если не текущий) */
function shortDay(iso: string, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-CA');
  if (day(d) === day(now)) return 'Сегодня';
  if (day(d) === day(new Date(now.getTime() - 86400_000))) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function TxItem({ tx, showDate = false }: { tx: Tx; showDate?: boolean }) {
  const { openEdit } = useApp();
  const income = tx.type === 'income';
  return (
    <button className="item" onClick={() => openEdit(tx)}>
      <div className="icon" aria-hidden>{catIcon(tx.category)}</div>
      <div className="grow">
        <div className="ellipsis">{tx.title}</div>
        <div className="muted ellipsis" style={{ fontSize: 13 }}>
          {showDate ? `${shortDay(tx.occurredAt)} · ` : ''}
          {tx.category?.name ?? 'без категории'}
          {tx.note ? ` · ${tx.note}` : ''}
        </div>
      </div>
      <div className={`num ${income ? 'income' : 'expense'}`} style={{ fontWeight: 600 }}>
        {money(income ? tx.amount : -tx.amount, { sign: true })}
      </div>
    </button>
  );
}

/** Лента, сгруппированная по дням, с итогом дня */
export function TxDays({ items }: { items: Tx[] }) {
  const groups = new Map<string, Tx[]>();
  for (const t of items) {
    const key = new Date(t.occurredAt).toDateString();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <>
      {[...groups.values()].map((list) => {
        const net = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
        return (
          <div key={list[0]!.id}>
            <div className="day">
              <span>{dayLabel(list[0]!.occurredAt)}</span>
              <span className="num">{money(net, { sign: true })}</span>
            </div>
            <div className="list">
              {list.map((t) => (
                <TxItem key={t.id} tx={t} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
