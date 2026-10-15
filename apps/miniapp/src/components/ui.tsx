import { type ReactNode, useEffect, useState } from 'react';
import { useBackButton } from '../hooks';

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useBackButton(open, onClose);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="grip" />
        {children}
      </div>
    </div>
  );
}

export function Segments<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segments" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Loading() {
  return (
    <>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </>
  );
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error">
      {error}
      {retry && (
        <button className="btn ghost" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}

let pushToast: (s: string) => void = () => {};
export const toast = (s: string) => pushToast(s);

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: number | undefined;
    pushToast = (s) => {
      setMsg(s);
      clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 2200);
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export const catIcon = (c: { emoji: string | null; name: string } | null | undefined) =>
  c?.emoji || (c?.name ? c.name[0]!.toUpperCase() : '•');
