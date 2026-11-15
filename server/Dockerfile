FROM node:20-slim AS base

# Prisma needs OpenSSL at runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build stage: install all dependencies, generate the Prisma client, compile TypeScript,
# then drop the dev dependencies (typescript, tsx, type definitions).
FROM base AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN ./node_modules/.bin/prisma generate \
    && ./node_modules/.bin/tsc --outDir dist \
    && pnpm prune --prod

# Runtime stage: compiled JavaScript and production dependencies only.
FROM base

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/legacy/*.json ./legacy/

# Files stay owned by root (read-only for the app); the server runs unprivileged.
USER node

ENV SERVER_PORT=3001
EXPOSE 3001

# Apply pending migrations, then start the WebSocket server.
# `exec` replaces the shell so stop signals reach node instead of stopping at sh.
CMD ["sh", "-c", "node dist/src/migrate.js && exec node dist/src/index.js"]
