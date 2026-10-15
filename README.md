# MaMoney

Финансовый Telegram-бот и Mini App. Перенос с n8n в код, план — `PROJECT_MAP.md` в файлах проекта.

```
packages/core   парсер операций, категории, отчёты, периоды (без зависимостей)
packages/db     схема Postgres (Drizzle), миграции, перенос из n8n-базы
apps/bot        бот на grammY: команды, запись операций, категории, отчёты по расписанию
apps/api        API для Mini App на Fastify (вход по подписи Telegram initData)
apps/miniapp    Mini App на React + Vite: главная, операции, аналитика, бюджеты, категории, планы, настройки
packages/domain общая логика бота и API (пользователи, операции, категории, бюджеты, аналитика)
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

## Бот локально

```bash
BOT_TOKEN=<тестовый бот> DATABASE_URL=postgres://... npm start -w @mamoney/bot
```
Без `PUBLIC_URL`/`WEBHOOK_SECRET` бот работает через long polling; с ними — ставит вебхук `https://<PUBLIC_URL>/tg/<WEBHOOK_SECRET>`.

## Деплой

```bash
cd deploy
cp ../.env.example .env   # заполнить
docker compose up -d --build
```
Поднимает Postgres 16, применяет миграции и запускает бота за Traefik, который уже работает для n8n.

## Как бот выбирает категорию

1. Явная подсказка в сообщении (`50 кфс.кафе`, `#кафе`).
2. Выученное правило «название → категория» (запоминается после ИИ и после ручной смены категории кнопкой).
3. Встроенный словарь для стандартных категорий (такси → транспорт, зп → зарплата…).
4. ИИ через OpenRouter.
5. «другие расходы» / «другие доходы».

## Mini App локально

```bash
npx tsx apps/api/scripts/preview.ts      # демо-данные в памяти, http://localhost:3999/app/
npm run dev -w @mamoney/miniapp          # hot reload, /api проксируется на :3000
```
Вне Telegram приложению нужен `initData`: превью-скрипт печатает подписанный для демо-пользователя, его можно передать через `VITE_DEV_INIT_DATA`.
