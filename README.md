# MaMoney

Финансовый Telegram-бот и Mini App. Перенос с n8n в код, план — `PROJECT_MAP.md` в файлах проекта.

```
packages/core   парсер операций, категории, отчёты, периоды (без зависимостей)
packages/db     схема Postgres (Drizzle), миграции, перенос из n8n-базы
apps/bot        бот на grammY (в работе)
apps/api        API для Mini App на Fastify (в работе)
apps/miniapp    React + Vite (в работе)
```

## Команды

```bash
npm install
npm test                                   # vitest
DATABASE_URL=... npm run migrate -w @mamoney/db
LEGACY_DATABASE_URL=... DATABASE_URL=... npm run import-legacy -w @mamoney/db
```

Перенос только читает старую базу (read-only), его можно запускать повторно; в конце печатает сверку по каждому пользователю.
Секреты — только в `.env` на сервере (см. `.env.example`).
