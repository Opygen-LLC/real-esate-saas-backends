# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:5000/ready >/dev/null || exit 1
CMD ["node", "dist/server.js"]
