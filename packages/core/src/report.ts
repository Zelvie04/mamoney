import type { TxType } from './parse.js';

export interface ReportRow { type: TxType; amount: number | string; category: string | null; title: string }

export interface CategorySum {
  category: string;
  sum: number;
  titles: { title: string; sum: number; parts: number[] }[];
}

export interface Report { income: number; expense: number; net: number; incomes: CategorySum[]; expenses: CategorySum[] }

const num = (v: number | string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Math.round(n * 100) / 100;

function group(rows: readonly ReportRow[], type: TxType): CategorySum[] {
  const cats = new Map<string, { sum: number; titles: Map<string, { sum: number; parts: number[] }> }>();
  for (const r of rows) {
    if (r.type !== type) continue;
    const cat = (r.category ?? '').trim().toLowerCase() || 'без категории';
    const title = r.title.trim().toLowerCase() || 'прочее';
    const a = num(r.amount);
    const c = cats.get(cat) ?? { sum: 0, titles: new Map() };
    c.sum += a;
    const t = c.titles.get(title) ?? { sum: 0, parts: [] };
    t.sum += a;
    t.parts.push(a);
    c.titles.set(title, t);
    cats.set(cat, c);
  }
  return [...cats.entries()]
    .map(([category, c]) => ({
      category,
      sum: round(c.sum),
      titles: [...c.titles.entries()]
        .map(([title, t]) => ({ title, sum: round(t.sum), parts: t.parts }))
        .sort((a, b) => b.sum - a.sum),
    }))
    .sort((a, b) => b.sum - a.sum);
}

export function buildReport(rows: readonly ReportRow[]): Report {
  const incomes = group(rows, 'income');
  const expenses = group(rows, 'expense');
  const income = round(incomes.reduce((s, c) => s + c.sum, 0));
  const expense = round(expenses.reduce((s, c) => s + c.sum, 0));
  return { income, expense, net: round(income - expense), incomes, expenses };
}

export function formatMoney(n: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}

/** Текст отчёта для Telegram (HTML). detailed — с разбивкой по позициям, как недельный отчёт в n8n. */
export function formatReport(title: string, r: Report, opts: { detailed?: boolean; currency?: string } = {}): string {
  const f = (n: number) => formatMoney(n, opts.currency);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const section = (name: string, cats: CategorySum[]) => {
    if (!cats.length) return `<b>${name}</b>\n—`;
    const blocks = cats.map((c, i) => {
      const head = `${i + 1}. ${esc(c.category)}: ${f(c.sum)}`;
      if (!opts.detailed) return head;
      const lines = c.titles.map((t, j) =>
        t.parts.length > 1
          ? `   ${j + 1}) ${esc(t.title)}: ${t.parts.map(f).join(' + ')} = ${f(t.sum)}`
          : `   ${j + 1}) ${esc(t.title)}: ${f(t.sum)}`,
      );
      return [head, ...lines].join('\n');
    });
    return `<b>${name}</b>\n${blocks.join(opts.detailed ? '\n\n' : '\n')}`;
  };
  return [
    `<b>${esc(title)}</b>`,
    '',
    `Доход: ${f(r.income)}`,
    `Расход: ${f(r.expense)}`,
    `Итог: ${f(r.net)}`,
    '',
    section('Доходы по категориям', r.incomes),
    '',
    section('Расходы по категориям', r.expenses),
  ].join('\n');
}
