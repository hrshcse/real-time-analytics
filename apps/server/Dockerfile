# WebSocket server image (WBS 22.2). Build from the REPO ROOT:
#   docker build -f apps/server/Dockerfile -t rta-server .
#   docker run -p 8080:8080 -e ALLOWED_ORIGINS=http://localhost:5173 rta-server

# ── build: install the workspace, bundle the server (tsup inlines @rta/shared) ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=@rta/server --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @rta/server

# ── runtime: production dependencies + the bundle only ──
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace=@rta/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "apps/server/dist/index.js"]
