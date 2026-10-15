/** Тонкая обёртка над window.Telegram.WebApp. Вне Telegram всё работает как заглушки. */
type Haptic = 'light' | 'medium' | 'heavy';
interface WebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  onEvent(e: string, cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: Haptic): void; notificationOccurred(s: 'success' | 'error' | 'warning'): void };
  showConfirm?(msg: string, cb: (ok: boolean) => void): void;
  disableVerticalSwipes?(): void;
}

export const tg: WebApp | undefined = (window as any).Telegram?.WebApp;
export const insideTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  const apply = () => {
    document.documentElement.dataset.theme = tg.colorScheme;
    for (const [k, v] of Object.entries(tg.themeParams)) {
      document.documentElement.style.setProperty(`--tg-${k.replace(/_/g, '-')}`, v);
    }
  };
  apply();
  tg.onEvent('themeChanged', apply);
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.impactOccurred('light'),
  ok: () => tg?.HapticFeedback?.notificationOccurred('success'),
  err: () => tg?.HapticFeedback?.notificationOccurred('error'),
};

export function confirm(msg: string): Promise<boolean> {
  if (tg?.showConfirm && insideTelegram) return new Promise((r) => tg.showConfirm!(msg, r));
  return Promise.resolve(window.confirm(msg));
}

