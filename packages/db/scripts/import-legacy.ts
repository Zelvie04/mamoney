import postgres from 'postgres';
import { importLegacy, type Query } from './legacy.ts';

const legacyUrl = process.env.LEGACY_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL;
if (!legacyUrl || !targetUrl) {
  console.error('Нужны LEGACY_DATABASE_URL (база n8n) и DATABASE_URL (новая база)');
  process.exit(1);
}

const legacySql = postgres(legacyUrl, { max: 1 });
const targetSql = postgres(targetUrl, { max: 1 });
const q = (sql: postgres.Sql): Query => (text, params = []) => sql.unsafe(text, params as any[]) as any;

try {
  // Читаем старую базу в read-only транзакции, чтобы скрипт физически не мог её изменить
  await legacySql`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;
  const reports = await importLegacy(q(legacySql), q(targetSql), {
    legacyTimezone: process.env.LEGACY_TIMEZONE ?? 'UTC',
    log: console.log,
  });
  const bad = reports.filter((r) => !r.ok);
  console.log(`\nПользователей: ${reports.length}, расхождений: ${bad.length}`);
  if (bad.length) process.exitCode = 2;
} finally {
  await legacySql.end();
  await targetSql.end();
}
