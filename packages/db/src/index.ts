import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

export function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL не задан');
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
/** Любой драйвер Postgres (postgres-js в проде, PGlite в тестах) */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
