import { useState } from 'react';
import { api, type Category, type TxType } from '../api';
import { ErrorBox, Loading, Segments, Sheet, Switch, catIcon, toast } from '../components/ui';
import { useApp } from '../context';
import { money } from '../format';
import { useLoad } from '../hooks';
import { confirm, haptic } from '../tg';

type Page = 'menu' | 'categories' | 'planned' | 'settings';

export function More() {
  const [page, setPage] = useState<Page>('menu');
  if (page === 'categories') return <Categories back={() => setPage('menu')} />;
  if (page === 'planned') return <Planned back={() => setPage('menu')} />;
  if (page === 'settings') return <Settings back={() => setPage('menu')} />;
  return (
    <>
      <div className="title">Ещё</div>
      <div className="list">
        <MenuItem icon="🏷" title="Категории" sub="Добавить, переименовать, эмодзи" onClick={() => setPage('categories')} />
        <MenuItem icon="🗓" title="Планы" sub="Будущие траты и заметки" onClick={() => setPage('planned')} />
        <MenuItem icon="⚙️" title="Настройки" sub="Валюта, часовой пояс, отчёты" onClick={() => setPage('settings')} />
      </div>
      <div className="section-title">В боте</div>
      <div className="card sub" style={{ fontSize: 14 }}>
        /export — выгрузка всех операций в CSV<br />
        /clear — удалить всю историю<br />
        Записывать траты можно прямо в чат: «350 кофе».
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

  const add = async () => {
    const a = Number(amount.replace(/\s/g, '').replace(',', '.'));
    await api.addPlanned({ title: title.trim(), amount: a > 0 ? a : null, dueDate: date || null });
    setTitle('');
    setAmount('');
    setDate('');
    haptic.ok();
    refresh();
  };

  const total = (list.data ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <>
      <Back back={back} title="Планы" />
      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className="card empty">Здесь будут будущие траты. Их же бот присылает вместе с недельным отчётом.</div>
      ) : (
        <>
          <div className="list">
            {list.data.map((p) => (
              <div key={p.id} className="item">
                <button className="switch" aria-label="Выполнено" onClick={async () => (await api.updatePlanned(p.id, { done: true }), haptic.ok(), refresh())} style={{ width: 24, height: 24, borderRadius: 12 }} />
                <div className="grow">
                  <div>{p.title}</div>
                  {(p.amount || p.dueDate) && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {p.amount ? money(p.amount) : ''}
                      {p.amount && p.dueDate ? ' · ' : ''}
                      {p.dueDate ? new Date(`${p.dueDate}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''}
                    </div>
                  )}
                </div>
                <button className="chip" aria-label="Удалить" onClick={async () => (await api.deletePlanned(p.id), refresh())}>✕</button>
              </div>
            ))}
          </div>
          {total > 0 && <div className="muted" style={{ margin: '8px 4px' }}>Всего запланировано: {money(total)}</div>}
        </>
      )}
      <div className="section-title">Добавить</div>
      <input className="input" placeholder="Например, ремонт машины" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" inputMode="decimal" placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" />
      </div>
      <button className="btn" disabled={!title.trim()} onClick={add}>Добавить</button>
    </>
  );
}

const CURRENCIES = ['RUB', 'BYN', 'KZT', 'UAH', 'USD', 'EUR'];
const TIMEZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Minsk', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Almaty', 'Europe/Kyiv'];

function Settings({ back }: { back: () => void }) {
  const { me, refresh } = useApp();
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
        <label className="toggle">
          <span>Валюта</span>
          <select className="chip" value={me.user.currency} onChange={(e) => save({ currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
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
    </>
  );
}
