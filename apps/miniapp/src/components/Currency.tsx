import { useState } from 'react';
import { CURRENCY_MAX_LENGTH, CURRENCY_PRESETS, DEFAULT_CURRENCY, formatMoney } from '@mamoney/core/currency';
import { api } from '../api';
import { haptic } from '../tg';
import { toast } from './ui';

const SYMBOL: Record<string, string> = { BYN: 'Br', RUB: '₽', USD: '$', EUR: '€', KZT: '₸', UAH: '₴', PLN: 'zł', CNY: '¥', GEL: '₾', TRY: '₺' };

/** Выбор валюты: при первом входе (на весь экран) и в настройках (в шторке) */
export function CurrencyPicker({ current, onSaved, intro }: { current: string; onSaved: () => void; intro?: boolean }) {
  const isPreset = (c: string) => c === DEFAULT_CURRENCY || c === '' || CURRENCY_PRESETS.some((p) => p.code === c);
  const [value, setValue] = useState(current);
  const [custom, setCustom] = useState(isPreset(current) ? '' : current);
  const [customOn, setCustomOn] = useState(!isPreset(current));
  const [busy, setBusy] = useState(false);
  const chosen = customOn ? custom.trim() : value;

  const save = async () => {
    setBusy(true);
    try {
      await api.settings({ currency: chosen });
      haptic.ok();
      onSaved();
    } catch {
      toast('Не получилось сохранить');
    } finally {
      setBusy(false);
    }
  };
  const pick = (c: string) => (haptic.tap(), setCustomOn(false), setValue(c));

  return (
    <>
      {intro ? (
        <>
          <div className="title" style={{ marginTop: 12 }}>Какую валюту показывать?</div>
          <p className="sub" style={{ marginTop: -4 }}>Это только подпись к суммам, курсы не пересчитываются. Поменять можно в любой момент в настройках.</p>
        </>
      ) : (
        <div className="title">Валюта</div>
      )}
      <div className="currency-grid">
        {CURRENCY_PRESETS.map((p) => (
          <button key={p.code} className={`currency ${!customOn && value === p.code ? 'on' : ''}`} onClick={() => pick(p.code)}>
            <span className="sym" aria-hidden>{SYMBOL[p.code] ?? p.code}</span>
            <span className="code">{p.code}</span>
            <span className="name">{p.label}</span>
          </button>
        ))}
        <button className={`currency ${!customOn && value === DEFAULT_CURRENCY ? 'on' : ''}`} onClick={() => pick(DEFAULT_CURRENCY)}>
          <span className="sym" aria-hidden>¤</span>
          <span className="code">«{DEFAULT_CURRENCY}»</span>
          <span className="name">По умолчанию</span>
        </button>
        <button className={`currency ${!customOn && value === '' ? 'on' : ''}`} onClick={() => pick('')}>
          <span className="sym" aria-hidden>123</span>
          <span className="code">Без валюты</span>
          <span className="name">Просто числа</span>
        </button>
      </div>
      <button className={`currency wide ${customOn ? 'on' : ''}`} onClick={() => (haptic.tap(), setCustomOn(true))}>
        <span className="code">Своя</span>
        <span className="name">Код, символ или слово</span>
      </button>
      {customOn && (
        <input
          className="input"
          style={{ marginTop: 8 }}
          autoFocus
          maxLength={CURRENCY_MAX_LENGTH}
          placeholder="Например, GBP, ₿ или баллов"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row spread">
          <span className="muted">Так будут выглядеть суммы</span>
          <span className="num" style={{ fontWeight: 650 }}>{formatMoney(1500, chosen, { maxFraction: 0 })}</span>
        </div>
      </div>
      <button className="btn" disabled={busy || (customOn && !custom.trim())} onClick={save}>
        {intro ? 'Продолжить' : 'Сохранить'}
      </button>
    </>
  );
}
