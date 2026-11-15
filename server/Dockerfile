FROM node:20-slim

# Prisma needs OpenSSL at runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN npx prisma generate

ENV SERVER_PORT=3001
EXPOSE 3001

# Apply pending migrations, then start the WebSocket server
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/index.ts"]
