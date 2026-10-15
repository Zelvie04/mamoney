import type { Planned } from '../api';
import { money } from '../format';

const todayStr = () => new Date().toLocaleDateString('en-CA');

/** «сегодня», «завтра», «через 5 дн.», «20 ноября», «просрочено на 2 дн.» */
export function dueLabel(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const days = Math.round((Date.parse(`${due}T12:00:00`) - Date.parse(`${todayStr()}T12:00:00`)) / 86400_000);
  if (days < 0) return { text: `просрочено на ${-days} дн.`, overdue: true };
  if (days === 0) return { text: 'сегодня', overdue: false };
  if (days === 1) return { text: 'завтра', overdue: false };
  if (days < 7) return { text: `через ${days} дн.`, overdue: false };
  return { text: new Date(`${due}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }), overdue: false };
}

export function PlannedRow({ p, onClick, action }: { p: Planned; onClick?: () => void; action?: React.ReactNode }) {
  const due = dueLabel(p.dueDate);
  return (
    <div className="item">
      {action}
      <button className="grow" style={{ all: 'unset', flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onClick}>
        <div className="ellipsis">{p.title}</div>
        <div className={`muted ${due?.overdue ? 'overdue' : ''}`} style={{ fontSize: 14 }}>{due ? due.text : 'без даты'}</div>
      </button>
      {p.amount ? (
        <span className="num" style={{ fontWeight: 600, color: p.type === 'income' ? 'var(--income)' : undefined }}>
          {money(p.type === 'income' ? p.amount : -p.amount, { sign: p.type === 'income' })}
        </span>
      ) : null}
    </div>
  );
}

export const plannedTotal = (list: Planned[]) =>
  list.reduce((s, p) => s + (p.amount ?? 0) * (p.type === 'income' ? -1 : 1), 0);
