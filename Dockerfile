# syntax=docker/dockerfile:1
# One image runs everything: the API, which also serves the built web app.
# Postgres runs separately (see docker-compose.yml, or any managed Postgres).

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    MEDIA_DIR=/data/media \
    PUBLIC_DIR=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY packages/shared ./packages/shared
COPY apps/api/src ./apps/api/src
COPY apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data/media && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node 24 runs the TypeScript sources directly (type stripping); there is no API build step.
CMD ["node", "apps/api/src/server.ts"]
