import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const txType = pgEnum('tx_type', ['income', 'expense', 'transfer']);
export const categoryType = pgEnum('category_type', ['income', 'expense']);
export const txSource = pgEnum('tx_source', ['bot', 'app', 'import', 'recurring', 'legacy']);
export const budgetPeriod = pgEnum('budget_period', ['week', 'month']);

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tgId: bigint('tg_id', { mode: 'number' }).notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  language: text('language').notNull().default('ru'),
  currency: text('currency').notNull().default('RUB'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  /** Рассылка не дошла (бот заблокирован). Данные НЕ удаляются. */
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  settings: jsonb('settings').$type<UserSettings>().notNull().default({}),
  createdAt: created(),
});

export interface UserSettings {
  weeklyReport?: boolean;
  monthlyReport?: boolean;
  reportHour?: number;
  dailyReminder?: boolean;
  cleanChat?: boolean;
  /** Пользователь сам выбрал валюту (при первом входе спрашиваем) */
  currencyChosen?: boolean;
}

export const accounts = pgTable('accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('RUB'),
  initialBalance: money('initial_balance').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  archived: boolean('archived').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: created(),
}, (t) => [index('accounts_user_idx').on(t.userId)]);

export const categories = pgTable('categories', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: categoryType('type').notNull(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  color: text('color'),
  parentId: bigint('parent_id', { mode: 'number' }),
  archived: boolean('archived').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: created(),
}, (t) => [uniqueIndex('categories_user_type_name_uq').on(t.userId, t.type, sql`lower(${t.name})`)]);

export const transactions = pgTable('transactions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: bigint('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
  /** Для переводов между счетами */
  toAccountId: bigint('to_account_id', { mode: 'number' }).references(() => accounts.id),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id, { onDelete: 'set null' }),
  type: txType('type').notNull(),
  amount: money('amount').notNull(),
  currency: text('currency').notNull().default('RUB'),
  title: text('title').notNull(),
  note: text('note'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  source: txSource('source').notNull().default('bot'),
  rawText: text('raw_text'),
  /** id из старой таблицы transactions_<tg_id> — чтобы перенос можно было перезапускать без дублей */
  legacyId: bigint('legacy_id', { mode: 'number' }),
  createdAt: created(),
}, (t) => [
  index('tx_user_time_idx').on(t.userId, t.occurredAt),
  index('tx_user_category_idx').on(t.userId, t.categoryId),
  uniqueIndex('tx_user_legacy_uq').on(t.userId, t.legacyId),
  check('tx_amount_positive', sql`${t.amount} > 0`),
]);

export const budgets = pgTable('budgets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** null = общий бюджет на все расходы */
  categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id, { onDelete: 'cascade' }),
  period: budgetPeriod('period').notNull().default('month'),
  amount: money('amount').notNull(),
  createdAt: created(),
});

export const recurring = pgTable('recurring', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: txType('type').notNull(),
  amount: money('amount').notNull(),
  title: text('title').notNull(),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id, { onDelete: 'set null' }),
  accountId: bigint('account_id', { mode: 'number' }).references(() => accounts.id),
  /** RRULE (RFC 5545), напр. FREQ=MONTHLY;BYMONTHDAY=10 */
  rrule: text('rrule').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  /** true — создавать операцию автоматически; false — только напоминать */
  autoCreate: boolean('auto_create').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});

/** Бывшие «будущие расходы» (/future): заметка, сумма и дата необязательны */
export const planned = pgTable('planned', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  amount: money('amount'),
  dueDate: date('due_date'),
  done: boolean('done').notNull().default(false),
  createdAt: created(),
});

export const goals = pgTable('goals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  targetAmount: money('target_amount').notNull(),
  savedAmount: money('saved_amount').notNull().default(0),
  deadline: date('deadline'),
  createdAt: created(),
});

/** Выученные соответствия «название → категория», чтобы не звать ИИ повторно */
export const merchantRules = pgTable('merchant_rules', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  categoryId: bigint('category_id', { mode: 'number' }).notNull().references(() => categories.id, { onDelete: 'cascade' }),
  createdAt: created(),
}, (t) => [uniqueIndex('merchant_rules_user_pattern_uq').on(t.userId, t.pattern)]);

/** Диалоговое состояние бота (balance / category / future …) */
export const botState = pgTable('bot_state', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  state: text('state').notNull().default('idle'),
  payload: jsonb('payload').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
