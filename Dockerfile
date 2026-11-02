# syntax=docker/dockerfile:1
FROM node:20.20.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA secret is required only behind a managed TLS proxy.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --include=dev --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com
COPY . .
RUN npm run build && npm prune --omit=dev --offline
FROM node:20.20.2-bookworm-slim
ENV NODE_ENV=production PORT=3001 DATA_FILE=/app/data/game.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/public/assets ./public/assets
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
