import { useCallback, useEffect, useRef, useState } from 'react';
import { tg } from './tg';

/** Системная кнопка «Назад» Telegram, пока открыт лист */
export function useBackButton(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    const t = tg;
    if (!t || !active) return;
    const h = () => cb.current();
    t.BackButton.show();
    t.BackButton.onClick(h);
    return () => {
      t.BackButton.offClick(h);
      t.BackButton.hide();
    };
  }, [active]);
}

/** Загрузка данных с перезапросом по ключу */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
