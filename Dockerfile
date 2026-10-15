FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/bot/package.json apps/bot/
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/bot apps/bot
USER node
CMD ["npx", "tsx", "apps/bot/src/main.ts"]
