# syntax=docker/dockerfile:1

# --- Build stage: install deps (incl. better-sqlite3 native addon) + next build
FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 compiles a native addon via node-gyp during install.
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@10

# Install against the committed lockfile. allowBuilds in pnpm-workspace.yaml
# lets better-sqlite3 / sharp run their native build scripts under pnpm 10.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# next.config sets output:"standalone" → .next/standalone is a runnable server.
RUN pnpm build

# --- Runtime stage: minimal standalone server -------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The standalone server.js binds to HOSTNAME:PORT.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone bundle traces only the node_modules it needs — including the
# compiled better-sqlite3 addon (kept external via serverExternalPackages).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# SQLite files (advisor.db / auth.db) default to ./data. Mount a host volume
# here to persist them across redeploys; the app also mkdir's it lazily.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

# /login is the only always-public route (middleware gates everything else).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["node", "server.js"]
