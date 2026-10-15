import { useEffect, useState } from 'react';
import { api, type Tx, type TxType } from '../api';
import { useApp } from '../context';
import { haptic } from '../tg';
import { Segments, Sheet, catIcon, toast } from './ui';

const today = () => new Date().toISOString().slice(0, 10);

/** Добавление (быстрой строкой или формой) и редактирование операции */
export function TxSheet({ open, tx, onClose }: { open: boolean; tx: Tx | null; onClose: () => void }) {
  const { categories, refresh } = useApp();
  const [mode, setMode] = useState<'quick' | 'form'>('quick');
  const [text, setText] = useState('');
  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (tx) {
      setMode('form');
      setType(tx.type === 'income' ? 'income' : 'expense');
      setAmount(String(tx.amount));
      setTitle(tx.title);
      setCategoryId(tx.categoryId);
      setDate(tx.occurredAt.slice(0, 10));
      setNote(tx.note ?? '');
    } else {
      setMode('quick');
      setText('');
      setType('expense');
      setAmount('');
      setTitle('');
      setCategoryId(null);
      setDate(today());
      setNote('');
    }
  }, [open, tx]);

  const cats = categories.filter((c) => c.type === type && !c.archived);
  const amountNum = Number(amount.replace(/\s/g, '').replace(',', '.'));
  const formOk = amountNum > 0 && title.trim().length > 0;

  const done = (msg: string) => {
    haptic.ok();
    toast(msg);
    refresh();
    onClose();
  };

  const submitQuick = async () => {
    setBusy(true);
    try {
      const r = await api.quick(text);
      if (!r.created.length) {
        haptic.err();
        toast('Не понял. Пример: 350 кофе');
        return;
      }
      const skipped = r.errors.length ? `, пропущено строк: ${r.errors.length}` : '';
      done(r.created.length === 1 ? `Записано: ${r.created[0]!.title}` : `Записано операций: ${r.created.length}${skipped}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async () => {
    setBusy(true);
    // Если дата не менялась — сохраняем время; иначе полдень выбранного дня
    const keepTime = tx && tx.occurredAt.slice(0, 10) === date;
    const occurredAt = keepTime ? undefined : date === today() && !tx ? undefined : new Date(`${date}T12:00:00`).toISOString();
    const body = { type, amount: amountNum, title: title.trim(), categoryId, note: note.trim() || null, ...(occurredAt ? { occurredAt } : {}) };
    try {
      if (tx) await api.updateTx(tx.id, body);
      else await api.addTx(body);
      done(tx ? 'Сохранено' : 'Записано');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!tx) return;
    setBusy(true);
    try {
      await api.deleteTx(tx.id);
      done('Удалено');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="row spread">
        <div className="title" style={{ margin: 0 }}>{tx ? 'Операция' : 'Новая запись'}</div>
        {!tx && (
          <Segments value={mode} onChange={setMode} options={[{ id: 'quick', label: 'Текстом' }, { id: 'form', label: 'Формой' }] as const} />
        )}
      </div>

      {mode === 'quick' && !tx ? (
        <>
          <label className="field">
            <span>Как в боте: сумма и название, можно несколько строк</span>
            <textarea
              className="input"
              autoFocus
              placeholder={'350 кофе\nзп 80000\nвчера 1200 продукты'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="btn" disabled={busy || !text.trim()} onClick={submitQuick}>
            Записать
          </button>
        </>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <Segments
              value={type}
              onChange={(t) => {
                setType(t);
                setCategoryId(null);
              }}
              options={[{ id: 'expense', label: 'Расход' }, { id: 'income', label: 'Доход' }] as const}
            />
          </div>
          <input
            className="input amount-input num"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))}
            aria-label="Сумма"
            autoFocus={!tx}
          />
          <label className="field">
            <span>Название</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="кофе, такси, зарплата…" />
          </label>
          <div className="field">
            <span>Категория{categoryId === null ? ' — подберу сам, если не выбрать' : ''}</span>
            <div className="chips">
              {cats.map((c) => (
                <button key={c.id} className={`chip ${categoryId === c.id ? 'on' : ''}`} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow">
              <span>Дата</span>
              <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Заметка</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
          </label>
          <button className="btn" disabled={busy || !formOk} onClick={submitForm}>
            {tx ? 'Сохранить' : 'Записать'}
          </button>
          {tx && (
            <button className="btn danger" disabled={busy} onClick={remove}>
              Удалить
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

export { catIcon };
