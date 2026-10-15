import { api } from '../api';
import { CountChart } from '../components/Charts';
import { ErrorBox, Loading } from '../components/ui';
import { useApp } from '../context';
import { useLoad } from '../hooks';

const n = (v: number) => v.toLocaleString('ru-RU');

/** Общая статистика для владельца: только агрегаты, без данных конкретных людей */
export function Stats({ back }: { back: () => void }) {
  const { version } = useApp();
  const s = useLoad(() => api.adminStats(), [version]);
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="chip" onClick={back} aria-label="Назад">‹</button>
        <div className="title" style={{ margin: 0 }}>Статистика</div>
      </div>
      {s.error ? (
        <ErrorBox error={s.error} retry={s.reload} />
      ) : !s.data ? (
        <Loading />
      ) : (
        <>
          <div className="tiles" style={{ marginTop: 0 }}>
            <Tile label="Пользователей" value={n(s.data.users.total)} sub={`+${n(s.data.users.new7d)} за неделю`} />
            <Tile label="Заходили за неделю" value={n(s.data.users.seen7d)} sub={`${n(s.data.users.seen1d)} за сутки`} />
            <Tile label="Операций всего" value={n(s.data.transactions.total)} sub={`+${n(s.data.transactions.d7)} за неделю`} />
            <Tile label="Записывали за неделю" value={n(s.data.transactions.writers7d)} sub="человек" />
          </div>

          <div className="section-title">Записывали траты, человек в день</div>
          <div className="card"><CountChart data={s.data.daily} dataKey="activeUsers" name="Записывали" /></div>

          <div className="section-title">Новые пользователи по дням</div>
          <div className="card"><CountChart data={s.data.daily} dataKey="newUsers" name="Новых" /></div>

          <div className="section-title">Пользователи</div>
          <div className="list">
            <Line k="Новых за сутки / неделю / месяц" v={`${n(s.data.users.new1d)} / ${n(s.data.users.new7d)} / ${n(s.data.users.new30d)}`} />
            <Line k="Заходили за сутки / неделю / месяц" v={`${n(s.data.users.seen1d)} / ${n(s.data.users.seen7d)} / ${n(s.data.users.seen30d)}`} />
            <Line k="Хоть раз что-то записали" v={n(s.data.users.withTransactions)} />
            <Line k="Выбрали валюту" v={n(s.data.users.currencyChosen)} />
            <Line k="Заблокировали бота" v={n(s.data.users.blocked)} />
          </div>

          <div className="section-title">Операции</div>
          <div className="list">
            <Line k="За сутки / неделю / месяц" v={`${n(s.data.transactions.d1)} / ${n(s.data.transactions.d7)} / ${n(s.data.transactions.d30)}`} />
            <Line k="Через бота" v={n(s.data.transactions.bySource.bot)} />
            <Line k="В приложении" v={n(s.data.transactions.bySource.app)} />
            <Line k="Перенесено из n8n" v={n(s.data.transactions.bySource.legacy)} />
            <Line k="Будущих трат в планах" v={n(s.data.planned)} />
            <Line k="Ведут бюджеты, человек" v={n(s.data.budgetUsers)} />
          </div>

          <div className="section-title">Отчёты за 30 дней</div>
          <div className="list">
            <Line k="Доставлено" v={n(s.data.reports.last30d.sent)} />
            <Line k="Бот заблокирован" v={n(s.data.reports.last30d.blocked)} />
            <Line k="Ошибки отправки" v={n(s.data.reports.last30d.failed)} />
            {s.data.reports.lastRun && (
              <Line
                k={`Последняя рассылка, ${new Date(s.data.reports.lastRun.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`}
                v={`${n(s.data.reports.lastRun.sent)} дошло · ${n(s.data.reports.lastRun.notSent)} нет`}
              />
            )}
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '12px 4px' }}>Только общие цифры: имена, суммы и записи людей здесь не видны. То же в боте — команда /stats.</p>
        </>
      )}
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{sub}</div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="toggle">
      <span>{k}</span>
      <span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  );
}
