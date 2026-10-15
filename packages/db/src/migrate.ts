import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connect } from './index.ts';

const { db, client } = connect();
await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
await client.end();
console.log('Миграции применены');
