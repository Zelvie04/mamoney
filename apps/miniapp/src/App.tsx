import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Category, type Me, type Tx } from './api';
import { CurrencyPicker } from './components/Currency';
import { TxSheet } from './components/TxSheet';
import { ErrorBox, Toaster } from './components/ui';
import { Ctx } from './context';
import { setCurrency } from './format';
import { Analytics } from './screens/Analytics';
import { Budgets } from './screens/Budgets';
import { Home } from './screens/Home';
import { More } from './screens/More';
import { Transactions } from './screens/Transactions';
import { haptic } from './tg';

type Tab = 'home' | 'tx' | 'analytics' | 'budgets' | 'more';

const ICONS: Record<Tab, JSX.Element> = {
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  tx: <path d="M5 6h14M5 12h14M5 18h9" />,
  analytics: <path d="M5 20V11M12 20V5M19 20v-7" />,
  budgets: <><circle cx="12" cy="12" r="8" /><path d="M12 12V4M12 12l6 4" /></>,
  more: <><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></>,
};
const LABELS: Record<Tab, string> = { home: 'Главная', tx: 'Операции', analytics: 'Аналитика', budgets: 'Бюджеты', more: 'Ещё' };

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [morePage, setMorePage] = useState<'menu' | 'planned'>('menu');
  const go = (t: Tab | 'planned') => {
    if (t === 'planned') {
      setMorePage('planned');
      setTab('more');
    } else setTab(t);
    window.scrollTo(0, 0);
  };
  const [me, setMe] = useState<Me | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState<{ open: boolean; tx: Tx | null }>({ open: false, tx: null });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    Promise.all([api.me(), api.categories()])
      .then(([m, c]) => {
        setCurrency(m.user.currency);
        setMe(m);
        setCategories(c);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [version]);

  const ctx = useMemo(
    () => ({
      me, categories, version, refresh,
      openAdd: () => setSheet({ open: true, tx: null }),
      openEdit: (tx: Tx) => setSheet({ open: true, tx }),
    }),
    [me, categories, version, refresh],
  );

  if (error && !me) return <div className="app"><ErrorBox error={error} retry={refresh} /></div>;
  if (me && !me.user.settings.currencyChosen) {
    return (
      <main className="app">
        <CurrencyPicker intro current={me.user.currency} onSaved={refresh} />
        <Toaster />
      </main>
    );
  }

  return (
    <Ctx.Provider value={ctx}>
      <main className="app">
        {tab === 'home' && <Home go={go} />}
        {tab === 'tx' && <Transactions />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'budgets' && <Budgets />}
        {tab === 'more' && <More key={morePage} initial={morePage} />}
      </main>
      {tab !== 'more' && (
        <button className="fab" aria-label="Добавить операцию" onClick={() => (haptic.tap(), ctx.openAdd())}>+</button>
      )}
      <nav className="tabbar">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => (haptic.tap(), setMorePage('menu'), go(t))} aria-current={tab === t}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[t]}
            </svg>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      <TxSheet open={sheet.open} tx={sheet.tx} onClose={() => setSheet({ open: false, tx: null })} />
      <Toaster />
    </Ctx.Provider>
  );
}
