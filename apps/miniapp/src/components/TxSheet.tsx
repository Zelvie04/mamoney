import { useEffect, useState } from 'react';
import { api, type Tx, type TxType } from '../api';
import { useApp } from '../context';
import { haptic } from '../tg';
import { Segments, Sheet, catIcon, toast } from './ui';

/** Сегодня по часам телефона (toISOString дал бы дату по UTC и ошибся бы ночью) */
const today = () => new Date().toLocaleDateString('en-CA');

/** Режим добавления запоминается: как выбрал в прошлый раз, по умолчанию — форма */
type Mode = 'quick' | 'form';
const MODE_KEY = 'mamoney.addMode';
const savedMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'quick' ? 'quick' : 'form';
  } catch {
    return 'form';
  }
};
const saveMode = (m: Mode) => {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // без хранилища просто не запоминаем
  }
};

/** Добавление (быстрой строкой или формой) и редактирование операции */
export function TxSheet({ open, tx, onClose }: { open: boolean; tx: Tx | null; onClose: () => void }) {
  const { categories, refresh } = useApp();
  const [mode, setModeState] = useState<Mode>(savedMode);
  const setMode = (m: Mode) => (saveMode(m), setModeState(m));
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
      setModeState('form');
      setType(tx.type === 'income' ? 'income' : 'expense');
      setAmount(String(tx.amount));
      setTitle(tx.title);
      setCategoryId(tx.categoryId);
      setDate(new Date(tx.occurredAt).toLocaleDateString('en-CA'));
      setNote(tx.note ?? '');
    } else {
      setModeState(savedMode());
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
  const future = !tx && date > today();

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
      const plannedN = r.planned?.length ?? 0;
      if (!r.created.length && !plannedN) {
        haptic.err();
        toast('Не понял. Пример: 350 кофе');
        return;
      }
      const skipped = r.errors.length ? `, пропущено строк: ${r.errors.length}` : '';
      const parts = [
        r.created.length === 1 ? `Записано: ${r.created[0]!.title}` : r.created.length ? `Записано операций: ${r.created.length}` : '',
        plannedN ? `в будущие траты: ${plannedN}` : '',
      ].filter(Boolean);
      done(parts.join(', ') + skipped);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async () => {
    setBusy(true);
    // Если дата не менялась — сохраняем время; иначе полдень выбранного дня
    const keepTime = tx && new Date(tx.occurredAt).toLocaleDateString('en-CA') === date;
    const occurredAt = keepTime ? undefined : date === today() && !tx ? undefined : new Date(`${date}T12:00:00`).toISOString();
    const body = { type, amount: amountNum, title: title.trim(), categoryId, note: note.trim() || null, ...(occurredAt ? { occurredAt } : {}) };
    try {
      if (tx) await api.updateTx(tx.id, body);
      else {
        const r = await api.addTx(body);
        if ('planned' in r) return done('Добавлено в будущие траты');
      }
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
              <input className="input" type="date" value={date} max={tx ? today() : undefined} onChange={(e) => setDate(e.target.value || today())} />
            </label>
          </div>
          {future && <div className="hint-box">🗓 Дата ещё не наступила — запись попадёт в будущие траты и не изменит баланс.</div>}
          <label className="field">
            <span>Заметка</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
          </label>
          <button className="btn" disabled={busy || !formOk} onClick={submitForm}>
            {tx ? 'Сохранить' : future ? 'Запланировать' : 'Записать'}
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
