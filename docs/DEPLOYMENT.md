# Deployment (WBS 22)

```text
                    Internet
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   Vercel (static)          Azure App Service / any container host
   React app + worker       Node.js WebSocket server  (/healthz)
   https://app…             wss://api…
          │                         ▲
          └──── browser connects ───┘
   IndexedDB lives in each user's browser — it is not a server component.
```

## Web → Vercel

`vercel.json` at the repo root: `npm ci`, `npm run build -w @rta/web`, output `apps/web/dist`,
security headers (CSP, nosniff, Referrer-Policy, Permissions-Policy) and immutable caching for
hashed assets.

1. Import the GitHub repo in Vercel; leave **Root Directory** at the repo root.
2. Project env: `VITE_WS_URL=wss://<your-server-host>` (and `VITE_WS_TOKEN` if using the placeholder).
3. Add repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` to deploy from CI
   (`.github/workflows/deploy.yml`), or let Vercel's Git integration deploy on push.

## Server → container

`apps/server/Dockerfile` (build from the repo root): multi-stage, `node:22-alpine`, runs as `node`,
4 production packages, `HEALTHCHECK` on `/healthz`.

```bash
docker build -f apps/server/Dockerfile -t rta-server .
docker run -p 8080:8080 -e ALLOWED_ORIGINS=http://localhost:5173 rta-server
curl http://localhost:8080/healthz   # {"status":"ok","connections":0,…}
```

The deploy workflow pushes `ghcr.io/<owner>/rta-server:{latest,<sha>}` on every green CI run.

### Azure App Service (Web App for Containers)

1. Create a Linux Web App, container source = the GHCR image.
2. **Configuration → General settings → Web sockets: On** (off by default; without it the
   handshake fails).
3. App settings: `WEBSITES_PORT=8080`, `ALLOWED_ORIGINS=https://<your-vercel-domain>`,
   optionally `AUTH_TOKEN`, `MAX_RATE`.
4. Health check path: `/healthz`.
5. Repo secrets `AZURE_WEBAPP_NAME` and `AZURE_WEBAPP_PUBLISH_PROFILE` enable the deploy step.

TLS terminates at App Service, so clients use `wss://<app>.azurewebsites.net`.

### Why not Vercel for the server

Vercel Functions are request/response with execution limits; a WebSocket server needs a
long-lived process. Any host that runs a container and allows WebSockets works (Azure App Service,
Render, Fly.io, Railway, a VM).

## Scaling notes

Each connection has its own generator, so instances are independent: scale out behind a load
balancer without sticky sessions for this demo. A real feed would have one producer and fan out
via pub/sub (Redis, NATS, Azure Web PubSub), with per-client backpressure kept at the edge.
