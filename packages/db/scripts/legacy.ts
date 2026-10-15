/**
 * Перенос данных из n8n-версии (схема tg_finance: tg_users + transactions_<tg_id>) в новую схему.
 * Можно запускать повторно: пользователи обновляются, операции не дублируются (legacy_id).
 * Старую базу только читает.
 */
export type Query = (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export interface ImportOptions {
  /** В каком поясе записаны старые created_at (timestamp without time zone). */
  legacyTimezone?: string;
  log?: (msg: string) => void;
}

export interface UserReport {
  tgId: number;
  legacyCount: number;
  importedCount: number;
  legacyIncome: number;
  legacyExpense: number;
  newIncome: number;
  newExpense: number;
  legacyBalance: number;
  newBalance: number;
  ok: boolean;
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const round = (x: number) => Math.round(x * 100) / 100;
const clean = (s: unknown) => String(s ?? '').trim().toLowerCase();

export async function importLegacy(legacy: Query, target: Query, opts: ImportOptions = {}): Promise<UserReport[]> {
  const tz = opts.legacyTimezone ?? 'UTC';
  const log = opts.log ?? (() => {});
  const users = await legacy('SELECT * FROM tg_finance.tg_users ORDER BY tg_id');
  const tables = new Set(
    (await legacy(`SELECT tablename FROM pg_tables WHERE schemaname = 'tg_finance' AND tablename LIKE 'transactions\\_%'`)).map(
      (r) => r.tablename as string,
    ),
  );
  const reports: UserReport[] = [];

  for (const u of users) {
    const tgId = Math.abs(n(u.tg_id));
    const table = `transactions_${tgId}`;
    const txs = tables.has(table)
      ? await legacy(`SELECT id, created_at::text AS created_at, type, title, category, amount FROM tg_finance."${table}" ORDER BY id`)
      : [];

    const [nu] = await target(
      `INSERT INTO users (tg_id, username, first_name, last_name, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (tg_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id`,
      [tgId, u.username ?? null, u.first_name ?? null, u.last_name ?? null, u.registered_at ?? null],
    );
    const userId = n(nu!.id);

    // Категории: из списков пользователя и из того, что реально встречается в операциях
    const wanted = new Map<string, 'income' | 'expense'>();
    const add = (type: 'income' | 'expense', name: unknown) => {
      const c = clean(name);
      if (c) wanted.set(`${type}:${c}`, type);
    };
    for (const c of (u.expense_categories as string[] | null) ?? []) add('expense', c);
    for (const c of (u.income_categories as string[] | null) ?? []) add('income', c);
    for (const t of txs) add(t.type, t.category);
    for (const [key, type] of wanted) {
      await target(
        `INSERT INTO categories (user_id, type, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, type, key.slice(type.length + 1)],
      );
    }
    const catRows = await target(`SELECT id, type, lower(name) AS name FROM categories WHERE user_id = $1`, [userId]);
    const catId = (type: string, name: unknown) => catRows.find((c) => c.type === type && c.name === clean(name))?.id ?? null;

    // Основной счёт. Начальный баланс подбирается так, чтобы итоговый баланс совпал со старым.
    let [acc] = await target(`SELECT id FROM accounts WHERE user_id = $1 AND is_default`, [userId]);
    const legacyNet = txs.reduce((s, t) => s + (t.type === 'income' ? n(t.amount) : -n(t.amount)), 0);
    const initial = round(n(u.balance) - legacyNet);
    if (!acc) {
      [acc] = await target(
        `INSERT INTO accounts (user_id, name, initial_balance, is_default) VALUES ($1, 'Основной', $2, true) RETURNING id`,
        [userId, initial],
      );
    }

    let imported = 0;
    for (const t of txs) {
      const res = await target(
        `INSERT INTO transactions (user_id, account_id, category_id, type, amount, title, occurred_at, source, legacy_id)
         VALUES ($1, $2, $3, $4, $5, $6, ($7::timestamp AT TIME ZONE $8), 'legacy', $9)
         ON CONFLICT (user_id, legacy_id) DO NOTHING RETURNING id`,
        [userId, acc!.id, catId(t.type, t.category), t.type, n(t.amount), clean(t.title) || 'без названия', t.created_at, tz, n(t.id)],
      );
      imported += res.length;
    }

    // «Будущие расходы» → planned (только при первом переносе пользователя)
    const future = ((u.future as string[] | null) ?? []).map((s) => String(s).trim()).filter(Boolean);
    const [{ cnt } = { cnt: 0 }] = await target(`SELECT count(*)::int AS cnt FROM planned WHERE user_id = $1`, [userId]);
    if (n(cnt) === 0) {
      for (const f of future) await target(`INSERT INTO planned (user_id, title) VALUES ($1, $2)`, [userId, f]);
    }

    const [sums] = await target(
      `SELECT count(*)::int AS cnt,
              COALESCE(sum(amount) FILTER (WHERE type = 'income'), 0) AS inc,
              COALESCE(sum(amount) FILTER (WHERE type = 'expense'), 0) AS exp,
              (SELECT initial_balance FROM accounts WHERE id = $2) AS init
       FROM transactions WHERE user_id = $1 AND source = 'legacy'`,
      [userId, acc!.id],
    );
    const legacyIncome = round(txs.filter((t) => t.type === 'income').reduce((s, t) => s + n(t.amount), 0));
    const legacyExpense = round(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + n(t.amount), 0));
    const newIncome = round(n(sums!.inc));
    const newExpense = round(n(sums!.exp));
    const newBalance = round(n(sums!.init) + newIncome - newExpense);
    const r: UserReport = {
      tgId,
      legacyCount: txs.length,
      importedCount: n(sums!.cnt),
      legacyIncome,
      legacyExpense,
      newIncome,
      newExpense,
      legacyBalance: round(n(u.balance)),
      newBalance,
      ok: txs.length === n(sums!.cnt) && legacyIncome === newIncome && legacyExpense === newExpense && round(n(u.balance)) === newBalance,
    };
    reports.push(r);
    log(`${r.ok ? 'OK ' : 'ERR'} ${tgId}: операций ${r.importedCount}/${r.legacyCount} (новых ${imported}), баланс ${r.newBalance} / ${r.legacyBalance}`);
  }
  return reports;
}
