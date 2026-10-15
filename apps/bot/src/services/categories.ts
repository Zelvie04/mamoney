import { and, asc, eq, sql } from 'drizzle-orm';
import { matchBuiltin, matchCategory, matchRule, normalize } from '@mamoney/core';
import { categories, merchantRules, type Db } from '@mamoney/db';

export type Category = typeof categories.$inferSelect;
export type CatType = 'income' | 'expense';

export const FALLBACK = { expense: 'другие расходы', income: 'другие доходы' } as const;

export async function listCategories(db: Db, userId: number, type?: CatType): Promise<Category[]> {
  const conds = [eq(categories.userId, userId), eq(categories.archived, false)];
  if (type) conds.push(eq(categories.type, type));
  return db.select().from(categories).where(and(...conds)).orderBy(asc(categories.sort), asc(categories.name));
}

export async function addCategory(db: Db, userId: number, type: CatType, name: string): Promise<Category | 'exists'> {
  const clean = normalize(name);
  const [existing] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.type, type), sql`lower(${categories.name}) = ${clean}`));
  if (existing && !existing.archived) return 'exists';
  if (existing) {
    const [c] = await db.update(categories).set({ archived: false }).where(eq(categories.id, existing.id)).returning();
    return c!;
  }
  const [c] = await db.insert(categories).values({ userId, type, name: clean, sort: 100 }).returning();
  return c!;
}

/** Убираем в архив, а не удаляем: старые операции сохраняют категорию в отчётах. */
export async function archiveCategory(db: Db, userId: number, type: CatType, name: string): Promise<Category | null> {
  const found = matchCategory(name, await listCategories(db, userId, type));
  if (!found) return null;
  const [c] = await db.update(categories).set({ archived: true }).where(eq(categories.id, found.id)).returning();
  return c ?? null;
}

export async function ensureFallback(db: Db, userId: number, type: CatType): Promise<Category> {
  const list = await listCategories(db, userId, type);
  const hit = list.find((c) => normalize(c.name) === FALLBACK[type]);
  if (hit) return hit;
  const r = await addCategory(db, userId, type, FALLBACK[type]);
  return r === 'exists' ? (await listCategories(db, userId, type)).find((c) => normalize(c.name) === FALLBACK[type])! : r;
}

export async function rememberRule(db: Db, userId: number, title: string, categoryId: number) {
  const pattern = normalize(title);
  if (!pattern) return;
  await db
    .insert(merchantRules)
    .values({ userId, pattern, categoryId })
    .onConflictDoUpdate({ target: [merchantRules.userId, merchantRules.pattern], set: { categoryId } });
}

export type AiCategorizer = (input: { title: string; text: string; type: CatType; categories: string[] }) => Promise<string | null>;

export type ResolvedBy = 'hint' | 'rule' | 'ai' | 'fallback';

/**
 * Порядок: явная категория пользователя → выученное правило → встроенный словарь → ИИ → «другие расходы/доходы».
 * Ответ ИИ запоминается, чтобы следующая такая же трата определялась без него.
 */
export async function resolveCategory(
  db: Db,
  userId: number,
  p: { type: CatType; title: string; text: string; hint: string | null },
  ai?: AiCategorizer,
): Promise<{ category: Category; by: ResolvedBy }> {
  const list = await listCategories(db, userId, p.type);

  if (p.hint) {
    const hit = matchCategory(p.hint, list);
    if (hit) {
      await rememberRule(db, userId, p.title, hit.id);
      return { category: hit, by: 'hint' };
    }
  }

  const rules = await db
    .select({ pattern: merchantRules.pattern, categoryId: merchantRules.categoryId })
    .from(merchantRules)
    .where(eq(merchantRules.userId, userId));
  const rule = matchRule(p.title, rules);
  const ruleCat = rule && list.find((c) => c.id === rule.categoryId);
  if (ruleCat) return { category: ruleCat, by: 'rule' };

  const builtin = matchBuiltin(p.text, list);
  if (builtin) return { category: builtin, by: 'rule' };

  if (ai && list.length) {
    try {
      const name = await ai({ title: p.title, text: p.text, type: p.type, categories: list.map((c) => c.name) });
      const hit = name ? matchCategory(name, list) : null;
      if (hit && normalize(hit.name) !== FALLBACK[p.type]) {
        await rememberRule(db, userId, p.title, hit.id);
        return { category: hit, by: 'ai' };
      }
    } catch {
      // ИИ недоступен — не мешаем записи
    }
  }

  return { category: await ensureFallback(db, userId, p.type), by: 'fallback' };
}
