import { useEffect, useState } from 'react';
import { api, type Period, type Tx, type TxType } from '../api';
import { TxDays } from '../components/TxList';
import { ErrorBox, Loading, Segments } from '../components/ui';
import { useApp } from '../context';

type P = Period | 'all';

export function Transactions() {
  const { version, categories } = useApp();
  const [period, setPeriod] = useState<P>('month');
  const [type, setType] = useState<TxType | 'all'>('all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Tx[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filter = { period: period === 'all' ? undefined : period, type: type === 'all' ? undefined : type, categoryId: categoryId ?? undefined, q: query || undefined };

  useEffect(() => {
    let alive = true;
    setItems(null);
    api
      .transactions({ ...filter, limit: 50 })
      .then((r) => alive && (setItems(r.items), setCursor(r.nextCursor), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, type, categoryId, query, version]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await api.transactions({ ...filter, cursor, limit: 50 });
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } finally {
      setMore(false);
    }
  };

  const cats = categories.filter((c) => type === 'all' || c.type === type);

  return (
    <>
      <div className="title">Операции</div>
      <input className="input" type="search" placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ marginTop: 10 }}>
        <Segments
          value={period}
          onChange={setPeriod}
          options={[{ id: 'week', label: 'Неделя' }, { id: 'month', label: 'Месяц' }, { id: 'prev_month', label: 'Прошлый мес.' }, { id: 'all', label: 'Всё' }] as const}
        />
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {(['all', 'expense', 'income'] as const).map((t) => (
          <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => (setType(t), setCategoryId(null))}>
            {t === 'all' ? 'Все' : t === 'expense' ? 'Расходы' : 'Доходы'}
          </button>
        ))}
        <select className="chip" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} aria-label="Категория">
          <option value="">Все категории</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorBox error={error} />
      ) : !items ? (
        <div style={{ marginTop: 16 }}><Loading /></div>
      ) : items.length === 0 ? (
        <div className="empty">Ничего не нашлось</div>
      ) : (
        <>
          <TxDays items={items} />
          {cursor && (
            <button className="btn ghost" disabled={more} onClick={loadMore}>
              {more ? 'Загружаю…' : 'Показать ещё'}
            </button>
          )}
        </>
      )}
    </>
  );
}
