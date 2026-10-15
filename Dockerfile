FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/miniapp/package.json apps/miniapp/
RUN npm ci --include=dev --no-audit --no-fund

FROM deps AS miniapp
COPY apps/miniapp apps/miniapp
RUN npm run build -w @mamoney/miniapp

FROM deps
ENV NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/bot apps/bot
COPY --from=miniapp /app/apps/miniapp/dist apps/miniapp/dist
USER node
EXPOSE 3000
CMD ["npx", "tsx", "apps/bot/src/main.ts"]
