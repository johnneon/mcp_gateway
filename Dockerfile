# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
COPY packages/fake-stdio-mcp packages/fake-stdio-mcp

RUN npm ci

COPY server/tsconfig.json server/tsconfig.json
COPY server/src server/src
COPY web web

RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3100 \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=3200 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
COPY packages/fake-stdio-mcp packages/fake-stdio-mcp

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3100 3200

VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.MCP_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/main.js"]
