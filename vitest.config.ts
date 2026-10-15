import { defineConfig } from 'vitest/config';

// PGlite поднимает Postgres в памяти — первый запуск в файле может занять несколько секунд
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
