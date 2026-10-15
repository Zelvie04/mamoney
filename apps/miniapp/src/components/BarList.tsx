import type { CategoryTotal } from '../api';
import { money } from '../format';

/** Рейтинг категорий: длина полоски = доля от максимума. Один цвет — величина, а не идентичность. */
export function BarList({ items, total, color, limit, onPick }: { items: CategoryTotal[]; total: number; color: string; limit?: number; onPick?: (c: CategoryTotal) => void }) {
  if (!items.length) return <div className="empty">Пока нет данных за период</div>;
  const shown = limit && items.length > limit ? [...items.slice(0, limit - 1), fold(items.slice(limit - 1))] : items;
  const max = Math.max(...shown.map((i) => i.sum));
  return (
    <div>
      {shown.map((c) => (
        <div
          key={`${c.id}-${c.name}`}
          className="bar-row"
          onClick={() => onPick?.(c)}
          role={onPick ? 'button' : undefined}
          title={`${c.name}: ${money(c.sum)}, операций: ${c.count}`}
        >
          <div className="ellipsis">
            {c.emoji && <span aria-hidden style={{ marginRight: 6 }}>{c.emoji}</span>}
            {c.name}
            <span className="muted" style={{ marginLeft: 6, fontSize: 13 }}>{total ? Math.round((c.sum / total) * 100) : 0}%</span>
          </div>
          <div className="num" style={{ fontWeight: 600 }}>{money(c.sum)}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(2, (c.sum / max) * 100)}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function fold(rest: CategoryTotal[]): CategoryTotal {
  return { id: null, name: 'остальное', emoji: '⋯', type: rest[0]!.type, sum: rest.reduce((s, c) => s + c.sum, 0), count: rest.reduce((s, c) => s + c.count, 0) };
}
