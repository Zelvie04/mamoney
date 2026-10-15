import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

export function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL не задан');
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
export type Db = ReturnType<typeof connect>['db'];
