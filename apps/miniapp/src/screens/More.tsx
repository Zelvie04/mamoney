import { useState } from 'react';
import { currencyName } from '@mamoney/core/currency';
import { api, type Category, type Planned as PlannedItem, type TxType } from '../api';
import { CurrencyPicker } from '../components/Currency';
import { ErrorBox, Loading, Segments, Sheet, Switch, catIcon, toast } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import { useLoad } from '../hooks';
import { PlannedRow, plannedTotal } from '../components/PlannedList';
import { Stats } from './Stats';
import { BroadcastPage } from './Broadcast';
import { confirm, haptic } from '../tg';

type Page = 'menu' | 'categories' | 'planned' | 'settings' | 'stats' | 'broadcast';

export function More({ initial = 'menu' }: { initial?: Page }) {
  const { me } = useApp();
  const [page, setPage] = useState<Page>(initial);
  if (page === 'stats') return <Stats back={() => setPage('menu')} />;
  if (page === 'broadcast') return <BroadcastPage back={() => setPage('menu')} />;
  if (page === 'categories') return <Categories back={() => setPage('menu')} />;
  if (page === 'planned') return <Planned back={() => setPage('menu')} />;
  if (page === 'settings') return <Settings back={() => setPage('menu')} />;
  return (
    <>
      <div className="title">Ещё</div>
      <div className="list">
        <MenuItem icon="🏷" title="Категории" sub="Добавить, переименовать, эмодзи" onClick={() => setPage('categories')} />
        <MenuItem icon="🗓" title="Будущие траты" sub="Планы с датой и без" onClick={() => setPage('planned')} />
        <MenuItem icon="⚙️" title="Настройки" sub="Валюта, часовой пояс, отчёты" onClick={() => setPage('settings')} />
        {me?.isAdmin && <MenuItem icon="📊" title="Статистика" sub="Только для тебя: общие цифры по боту" onClick={() => setPage('stats')} />}
        {me?.isAdmin && <MenuItem icon="📣" title="Рассылка" sub="Сообщение всем пользователям бота" onClick={() => setPage('broadcast')} />}
      </div>
      <Data />
      <p className="sub" style={{ fontSize: 13, margin: '14px 4px' }}>
        Всё можно делать здесь. Бот в чате остаётся для быстрых записей вроде «350 кофе» и присылает отчёты.
      </p>
    </>
  );
}

function Data() {
  const { refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    setBusy(true);
    try {
      await api.exportCsv();
      haptic.ok();
      toast('Файл отправлен в чат с ботом');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!(await confirm('Удалить все операции? Баланс обнулится. Категории, бюджеты и планы останутся.'))) return;
    if (!(await confirm('Точно? Это нельзя отменить. Можно сначала выгрузить CSV.'))) return;
    await api.clearHistory();
    haptic.ok();
    toast('История очищена');
    refresh();
  };
  return (
    <>
      <div className="section-title">Данные</div>
      <div className="list">
        <MenuItem icon="📤" title="Выгрузить в CSV" sub={busy ? 'Отправляю…' : 'Файл придёт в чат с ботом, открывается в Excel'} onClick={exportCsv} />
        <MenuItem icon="🗑" title="Очистить историю" sub="Удалить все операции" onClick={clear} />
      </div>
    </>
  );
}

function MenuItem({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="item" onClick={onClick}>
      <div className="icon" aria-hidden>{icon}</div>
      <div className="grow">
        <div>{title}</div>
        <div className="muted" style={{ fontSize: 13 }}>{sub}</div>
      </div>
      <span className="muted" aria-hidden>›</span>
    </button>
  );
}

function Back({ back, title }: { back: () => void; title: string }) {
  return (
    <div className="row" style={{ marginBottom: 8 }}>
      <button className="chip" onClick={back} aria-label="Назад">‹</button>
      <div className="title" style={{ margin: 0 }}>{title}</div>
    </div>
  );
}

const EMOJI = ['🛒', '☕', '🍔', '🚕', '🏠', '📱', '💊', '👕', '🎬', '🎁', '💳', '💼', '💰', '✈️', '🐱', '📚', '💪', '🎮', '🚗', '⚡'];

function Categories({ back }: { back: () => void }) {
  const { categories, refresh } = useApp();
  const [type, setType] = useState<TxType>('expense');
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);

  const open = (c: Partial<Category>) => {
    setEdit(c);
    setName(c.name ?? '');
    setEmoji(c.emoji ?? null);
  };
  const save = async () => {
    try {
      if (edit?.id) await api.updateCategory(edit.id, { name, emoji });
      else await api.addCategory({ type, name, emoji: emoji ?? undefined });
      haptic.ok();
      setEdit(null);
      refresh();
    } catch {
      toast('Такая категория уже есть');
    }
  };
  const archive = async () => {
    if (!edit?.id || !(await confirm(`Убрать категорию «${edit.name}»? Старые операции сохранятся.`))) return;
    await api.updateCategory(edit.id, { archived: true });
    setEdit(null);
    refresh();
  };

  return (
    <>
      <Back back={back} title="Категории" />
      <Segments value={type} onChange={setType} options={[{ id: 'expense', label: 'Расходы' }, { id: 'income', label: 'Доходы' }] as const} />
      <div className="list" style={{ marginTop: 10 }}>
        {categories.filter((c) => c.type === type && !c.archived).map((c) => (
          <button key={c.id} className="item" onClick={() => open(c)}>
            <div className="icon" aria-hidden>{catIcon(c)}</div>
            <div className="grow">{c.name}</div>
            <span className="muted" aria-hidden>›</span>
          </button>
        ))}
      </div>
      <button className="btn" onClick={() => open({ type })}>Добавить категорию</button>

      <Sheet open={!!edit} onClose={() => setEdit(null)}>
        <div className="title">{edit?.id ? 'Категория' : 'Новая категория'}</div>
        <input className="input" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field">
          <span>Значок</span>
          <div className="chips">
            {EMOJI.map((e) => (
              <button key={e} className={`chip ${emoji === e ? 'on' : ''}`} onClick={() => setEmoji(emoji === e ? null : e)} aria-label={e}>{e}</button>
            ))}
          </div>
        </div>
        <button className="btn" disabled={!name.trim()} onClick={save}>Сохранить</button>
        {edit?.id && <button className="btn danger" onClick={archive}>Убрать</button>}
      </Sheet>
    </>
  );
}

function Planned({ back }: { back: () => void }) {
  const { version, refresh } = useApp();
  const list = useLoad(() => api.planned(), [version]);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [edit, setEdit] = useState<PlannedItem | null>(null);

  const [type, setType] = useState<TxType>('expense');

  const add = async () => {
    const a = Number(amount.replace(/\s/g, '').replace(',', '.'));
    await api.addPlanned({ title: title.trim(), amount: a > 0 ? a : null, dueDate: date || null, type });
    setTitle('');
    setAmount('');
    setDate('');
    haptic.ok();
    toast('Добавлено');
    refresh();
  };

  const total = plannedTotal(list.data ?? []);

  return (
    <>
      <Back back={back} title="Будущие траты" />
      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className="card empty">Пока пусто. Добавь ниже или при новой записи выбери дату позже сегодняшней. Бот присылает этот список вместе с недельным отчётом.</div>
      ) : (
        <>
          <div className="list">
            {list.data.map((p) => (
              <PlannedRow
                key={p.id}
                p={p}
                onClick={() => setEdit(p)}
                action={
                  <button
                    className="check"
                    aria-label="Выполнено, убрать из списка"
                    onClick={async () => (await api.updatePlanned(p.id, { done: true }), haptic.ok(), toast('Отмечено'), refresh())}
                  />
                }
              />
            ))}
          </div>
          {total > 0 && <div className="muted" style={{ margin: '8px 4px', fontSize: 14 }}>Всего запланировано {money(total)}</div>}
        </>
      )}
      <div className="section-title">Добавить</div>
      <Segments value={type} onChange={setType} options={[{ id: 'expense', label: 'Трата' }, { id: 'income', label: 'Поступление' }] as const} />
      <input className="input" style={{ marginTop: 8 }} placeholder={type === 'expense' ? 'Например, ремонт машины' : 'Например, премия'} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата (можно не указывать)" />
      </div>
      <div className="muted" style={{ fontSize: 13, margin: '6px 4px 0' }}>Дату можно не указывать.</div>
      <button className="btn" disabled={!title.trim()} onClick={add}>Добавить</button>
      <PlannedSheet item={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PlannedSheet({ item, onClose }: { item: PlannedItem | null; onClose: () => void }) {
  const { refresh } = useApp();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<TxType>('expense');
  const [last, setLast] = useState<PlannedItem | null>(null);
  if (item !== last) {
    setLast(item);
    setType(item?.type ?? 'expense');
    setTitle(item?.title ?? '');
    setAmount(item?.amount ? String(item.amount) : '');
    setDate(item?.dueDate ?? '');
  }
  const a = Number(amount.replace(/\s/g, '').replace(',', '.'));
  const done = (msg: string) => (haptic.ok(), toast(msg), refresh(), onClose());
  const save = async () => {
    await api.updatePlanned(item!.id, { title: title.trim(), amount: a > 0 ? a : null, dueDate: date || null, type });
    done('Сохранено');
  };
  const record = async () => {
    await api.addTx({ type, amount: a, title: title.trim(), categoryId: null });
    await api.updatePlanned(item!.id, { done: true });
    done(type === 'expense' ? 'Записано в расходы' : 'Записано в доходы');
  };
  const remove = async () => {
    await api.deletePlanned(item!.id);
    done('Удалено');
  };
  return (
    <Sheet open={!!item} onClose={onClose}>
      <div className="title">Будущая запись</div>
      <Segments value={type} onChange={setType} options={[{ id: 'expense', label: 'Трата' }, { id: 'income', label: 'Поступление' }] as const} />
      <input className="input" style={{ marginTop: 8 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" />
      </div>
      <button className="btn" disabled={!title.trim()} onClick={save}>Сохранить</button>
      {a > 0 && <button className="btn ghost" disabled={!title.trim()} onClick={record}>{type === 'expense' ? 'Потратил — записать в расходы' : 'Получил — записать в доходы'}</button>}
      <button className="btn danger" onClick={remove}>Удалить</button>
    </Sheet>
  );
}

const TIMEZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Minsk', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Almaty', 'Europe/Kyiv'];

function Settings({ back }: { back: () => void }) {
  const { me, refresh } = useApp();
  const [cur, setCur] = useState(false);
  if (!me) return <Loading />;
  const s = me.user.settings;
  const save = async (patch: Parameters<typeof api.settings>[0]) => {
    await api.settings(patch);
    haptic.tap();
    refresh();
  };
  return (
    <>
      <Back back={back} title="Настройки" />
      <div className="section-title">Основное</div>
      <div className="list">
        <button className="toggle" onClick={() => setCur(true)}>
          <span>Валюта</span>
          <span className="chip">{currencyName(me.user.currency)}</span>
        </button>
        <label className="toggle">
          <span>Часовой пояс</span>
          <select className="chip" value={me.user.timezone} onChange={(e) => save({ timezone: e.target.value })}>
            {(TIMEZONES.includes(me.user.timezone) ? TIMEZONES : [me.user.timezone, ...TIMEZONES]).map((t) => <option key={t} value={t}>{t.split('/')[1]?.replace('_', ' ')}</option>)}
          </select>
        </label>
      </div>
      <div className="section-title">Отчёты от бота</div>
      <div className="list">
        <div className="toggle"><span>Недельный (по понедельникам)</span><Switch label="Недельный отчёт" on={s.weeklyReport !== false} onChange={(v) => save({ weeklyReport: v })} /></div>
        <div className="toggle"><span>Месячный (1-го числа)</span><Switch label="Месячный отчёт" on={s.monthlyReport !== false} onChange={(v) => save({ monthlyReport: v })} /></div>
        <label className="toggle">
          <span>Время отправки</span>
          <select className="chip" value={s.reportHour ?? 9} onChange={(e) => save({ reportHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      </div>
      <div className="section-title">Чат</div>
      <div className="list">
        <div className="toggle"><span>Удалять мои сообщения после записи</span><Switch label="Чистый чат" on={s.cleanChat !== false} onChange={(v) => save({ cleanChat: v })} /></div>
      </div>
      <Sheet open={cur} onClose={() => setCur(false)}>
        <CurrencyPicker current={me.user.currency} onSaved={() => (setCur(false), refresh())} />
      </Sheet>
    </>
  );
}
