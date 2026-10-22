# One image for Railway (or any Docker host): builds the PWA, then runs the
# Tier 2 server, which serves both the app and /api from one address.
# server/Dockerfile (used by docker-compose.yml) is the API on its own.

# 1. Build the PWA.
FROM node:22-slim AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# 2. The server, with the built app next to it.
# Debian slim, not alpine: better-sqlite3 ships prebuilt binaries for glibc.
FROM node:22-slim
WORKDIR /app/server

# Build tools in case better-sqlite3 has to compile, removed in the same layer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=client /client/dist /app/client/dist

ENV NODE_ENV=production \
    CLIENT_DIST=/app/client/dist \
    DB_PATH=/data/smartattend.db \
    PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
