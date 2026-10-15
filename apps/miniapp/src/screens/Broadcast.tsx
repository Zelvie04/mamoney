import { useEffect, useState } from 'react';
import { api, type Broadcast } from '../api';
import { ErrorBox, Loading, toast } from '../components/ui';
import { useLoad } from '../hooks';
import { confirm, haptic } from '../tg';

const DRAFT_KEY = 'mamoney.broadcastDraft';
const MAX = 4096;
const n = (v: number) => v.toLocaleString('ru-RU');

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(v: string) {
  try {
    if (v) localStorage.setItem(DRAFT_KEY, v);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* без сохранения черновика */
  }
}

/** Рассылка владельца: текст всем, кто не заблокировал бота */
export function BroadcastPage({ back }: { back: () => void }) {
  const list = useLoad(() => api.broadcasts(), []);
  const [text, setText] = useState(readDraft);
  const [busy, setBusy] = useState(false);
  const running = list.data?.items.some((b) => b.status === 'running') ?? false;

  useEffect(() => writeDraft(text), [text]);
  // Пока идёт отправка, обновляем счётчики
  useEffect(() => {
    if (!running) return;
    const t = setInterval(list.reload, 2000);
    return () => clearInterval(t);
  }, [running, list.reload]);

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX;

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.broadcast(trimmed, true);
      toast('status' in r && r.status === 'sent' ? 'Отправил тебе в чат с ботом' : 'Не получилось отправить, проверь чат с ботом');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendAll = async () => {
    const who = n(list.data?.recipients ?? 0);
    if (!(await confirm(`Отправить сообщение ${who} пользователям? Отменить рассылку после начала нельзя.`))) return;
    setBusy(true);
    try {
      await api.broadcast(trimmed);
      haptic.ok();
      toast('Рассылка началась');
      setText('');
      list.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="chip" onClick={back} aria-label="Назад">‹</button>
        <div className="title" style={{ margin: 0 }}>Рассылка</div>
      </div>
      {list.error ? (
        <ErrorBox error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          <div className="card">
            <textarea
              className="input"
              rows={6}
              placeholder="Текст сообщения. Придёт от бота обычным сообщением."
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Текст рассылки"
            />
            <div className="muted" style={{ fontSize: 13, margin: '6px 2px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>Получат: {n(list.data.recipients)} чел.</span>
              <span style={tooLong ? { color: 'var(--danger)' } : undefined}>{n(trimmed.length)} / {n(MAX)}</span>
            </div>
            <button className="btn ghost" disabled={!trimmed || tooLong || busy} onClick={test}>Сначала отправить себе</button>
            <button className="btn" disabled={!trimmed || tooLong || busy || running} onClick={sendAll}>
              {running ? 'Идёт рассылка…' : `Отправить всем (${n(list.data.recipients)})`}
            </button>
          </div>
          <p className="sub" style={{ fontSize: 13, margin: '10px 4px' }}>
            Тем, кто заблокировал бота, сообщение не уходит. Если человек снова откроет бота, он опять будет получать рассылки.
          </p>

          {list.data.items.length > 0 && (
            <>
              <div className="section-title">Прошлые рассылки</div>
              <div className="list">
                {list.data.items.map((b) => <Row key={b.id} b={b} />)}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Row({ b }: { b: Broadcast }) {
  const when = new Date(b.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const done = b.sent + b.blocked + b.failed;
  const state =
    b.status === 'running' ? `отправляю ${n(done)} из ${n(b.total)}` : b.status === 'interrupted' ? 'прервана перезапуском' : 'готово';
  return (
    <div className="item" style={{ alignItems: 'flex-start' }}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.text}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {when} · {state}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Дошло {n(b.sent)} · заблокировали {n(b.blocked)}{b.failed ? ` · ошибок ${n(b.failed)}` : ''}
        </div>
      </div>
    </div>
  );
}
