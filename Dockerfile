# syntax=docker/dockerfile:1.7

# One shared build stage is used by both the API and the database-backup
# runtime targets. This prevents Docker Compose from installing pnpm
# dependencies and compiling TypeScript twice on normal deployments.
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build && pnpm prune --prod


FROM node:22-alpine AS api-runtime
ENV NODE_ENV=production
ENV INVOICE_PDF_CHROMIUM_PATH=/usr/local/bin/invoice-chromium
WORKDIR /app
RUN apk add --no-cache chromium font-noto font-noto-bengali \
  && ln -sf "$(command -v chromium-browser || command -v chromium)" /usr/local/bin/invoice-chromium \
  && addgroup -S app && adduser -S -G app app \
  && mkdir -p /app/logs && chown -R app:app /app
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]


# Dedicated scheduler runtime. The database bytes are streamed directly from
# the primary Atlas cluster into the secondary Atlas cluster. The /tmp path is
# only for the scheduler heartbeat, overlap lock, and short-lived credential
# config files; it is not a database-backup archive location and is not mounted
# to a persistent Docker volume.
FROM node:22-bookworm-slim AS backup-runtime
ARG MONGODB_DATABASE_TOOLS_VERSION=100.18.0
ARG TARGETARCH
ENV NODE_ENV=production
WORKDIR /app
RUN test "$TARGETARCH" = "amd64" \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSLo /tmp/mongodb-database-tools.deb \
       "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-debian12-x86_64-${MONGODB_DATABASE_TOOLS_VERSION}.deb" \
  && dpkg -i /tmp/mongodb-database-tools.deb \
  && rm -f /tmp/mongodb-database-tools.deb \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/real-estate-db-backup /app/logs \
  && chmod 0700 /tmp/real-estate-db-backup \
  && chown -R node:node /tmp/real-estate-db-backup /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 CMD node -e "const fs=require('fs');const p='/tmp/real-estate-db-backup/.scheduler-heartbeat';const s=fs.statSync(p);if(Date.now()-s.mtimeMs>120000)process.exit(1)" || exit 1
CMD ["node", "--enable-source-maps", "dist/app/module/backup/databaseBackup.scheduler.js"]
