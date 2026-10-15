import { tg } from './tg';

export type TxType = 'income' | 'expense';
export interface Category { id: number; type: TxType; name: string; emoji: string | null; color: string | null; sort: number; archived: boolean }
export interface Tx {
  id: number; type: TxType | 'transfer'; amount: number; currency: string; title: string; note: string | null;
  occurredAt: string; categoryId: number | null; category: Pick<Category, 'id' | 'name' | 'emoji' | 'color'> | null;
}
export interface Budget { id: number; categoryId: number | null; period: 'week' | 'month'; amount: number; spent: number; forecast: number }
export interface CategoryTotal { id: number | null; name: string; emoji: string | null; type: TxType; sum: number; count: number }
export interface Summary {
  balance: number; income: number; expense: number; net: number; avgExpensePerDay: number;
  categories: CategoryTotal[]; daily: { day: string; income: number; expense: number }[]; budgets: Budget[];
}
export interface Me {
  user: { id: number; firstName: string | null; username: string | null; currency: string; timezone: string; settings: Settings };
  balance: number;
}
export interface Settings { weeklyReport?: boolean; monthlyReport?: boolean; reportHour?: number; cleanChat?: boolean; currencyChosen?: boolean }
export interface Planned { id: number; title: string; amount: number | null; dueDate: string | null; done: boolean }
export type Period = 'week' | 'month' | 'prev_week' | 'prev_month' | 'all';

const initData = tg?.initData || import.meta.env.VITE_DEV_INIT_DATA || '';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `tma ${initData}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('Открой приложение из бота в Telegram');
  if (!res.ok && res.status !== 400) throw new Error(`Ошибка сервера (${res.status})`);
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (res.status === 400 && !('created' in data)) throw new Error('Проверь введённые данные');
  return data as T;
}

const qs = (o: Record<string, unknown>) =>
  '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  me: () => req<Me>('GET', '/me'),
  settings: (s: Partial<Settings & { currency: string; timezone: string }>) => req<unknown>('PATCH', '/settings', s),
  setBalance: (balance: number) => req<{ balance: number }>('PUT', '/balance', { balance }),
  exportCsv: () => req<{ sent: boolean }>('POST', '/export'),
  clearHistory: () => req<void>('DELETE', '/transactions?confirm=all'),
  summary: (period: Period) => req<Summary>('GET', `/summary${qs({ period })}`),
  monthly: (months = 12) => req<{ month: string; income: number; expense: number }[]>('GET', `/analytics/monthly${qs({ months })}`),
  transactions: (f: { period?: Period; type?: TxType; categoryId?: number; q?: string; cursor?: string | null; limit?: number }) =>
    req<{ items: Tx[]; nextCursor: string | null }>('GET', `/transactions${qs(f)}`),
  addTx: (t: { type: TxType; amount: number; title: string; categoryId?: number | null; occurredAt?: string; note?: string | null }) =>
    req<Tx>('POST', '/transactions', t),
  quick: (text: string) => req<{ created: Tx[]; errors: { line: number; error: string }[] }>('POST', '/transactions/quick', { text }),
  updateTx: (id: number, t: Partial<{ type: TxType; amount: number; title: string; categoryId: number | null; occurredAt: string; note: string | null }>) =>
    req<Tx>('PATCH', `/transactions/${id}`, t),
  deleteTx: (id: number) => req<void>('DELETE', `/transactions/${id}`),
  categories: () => req<Category[]>('GET', '/categories'),
  addCategory: (c: { type: TxType; name: string; emoji?: string }) => req<Category>('POST', '/categories', c),
  updateCategory: (id: number, c: Partial<Pick<Category, 'name' | 'emoji' | 'archived' | 'sort'>>) => req<Category>('PATCH', `/categories/${id}`, c),
  budgets: () => req<Budget[]>('GET', '/budgets'),
  saveBudget: (b: { id?: number; categoryId: number | null; period: 'week' | 'month'; amount: number }) =>
    b.id ? req<Budget>('PATCH', `/budgets/${b.id}`, b) : req<Budget>('POST', '/budgets', b),
  deleteBudget: (id: number) => req<void>('DELETE', `/budgets/${id}`),
  planned: () => req<Planned[]>('GET', '/planned'),
  addPlanned: (p: { title: string; amount?: number | null; dueDate?: string | null }) => req<Planned>('POST', '/planned', p),
  updatePlanned: (id: number, p: Partial<Planned>) => req<Planned>('PATCH', `/planned/${id}`, p),
  deletePlanned: (id: number) => req<void>('DELETE', `/planned/${id}`),
};
