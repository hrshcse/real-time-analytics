# Real-Time Analytics Dashboard

High-volume streaming dashboard: WebSocket → Web Worker → aggregation/downsampling → React.
Plan: [`docs/WBS.md`](docs/WBS.md) · Wire protocol: [`docs/PROTOCOL.md`](docs/PROTOCOL.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Tasks: [`docs/tasks/`](docs/tasks)

## Stack (versions as scaffolded, Oct 2026)

| Area        | Choice                                                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| Runtime     | Node `^20.19 \|\| >=22.12` (Vite 8 requirement)                                     |
| Language    | TypeScript **6.0** (pinned `~6.0.3` — typescript-eslint 8 doesn't support TS 7 yet) |
| Web         | React 19, Vite 8, CSS Modules, Chart.js 4                                           |
| Server      | Node + `ws` 8, run with `tsx` in dev, bundled with `tsup` for prod                  |
| Tests       | Vitest 5 (+ jsdom, Testing Library). Playwright added in Phase 7                    |
| Lint/format | ESLint 10 flat config, typescript-eslint, Prettier                                  |

## Layout

```text
apps/
  web/        React dashboard (Vite)
  server/     WebSocket server + event generator
packages/
  shared/     Types shared by both: AnalyticsEvent, wire protocol
docs/         WBS, protocol, task briefs, later ARCHITECTURE/PERFORMANCE/DECISIONS
```

> Deviation from the WBS: workers will live in `apps/web/src/workers/` rather than a
> top-level `workers/` folder, so Vite can bundle them with `new Worker(new URL(...))`.

## Setup

```bash
npm install
npm run dev          # server on ws://localhost:8080 + web on http://localhost:5173
```

Optional config: copy `apps/server/.env.example` → `apps/server/.env`, and
`apps/web/.env.example` → `apps/web/.env.local`.

## Scripts (from the repo root)

| Command                          | What it does              |
| -------------------------------- | ------------------------- |
| `npm run dev`                    | Server + web together     |
| `npm run dev:server` / `dev:web` | One side only             |
| `npm run lint`                   | ESLint across the repo    |
| `npm run typecheck`              | `tsc` in every workspace  |
| `npm test`                       | Vitest in every workspace |
| `npm run build`                  | Production builds         |
| `npm run format`                 | Prettier write            |

## Testing the stream by hand

Server fault injection (in `apps/server/.env`):

- `BAD_EVENT_PCT=5` — 5% of events are invalid (missing timestamp, `value: "NaN"`, unknown metric, `id: null`)
- `BAD_FRAME_PCT=10` — 10% of frames are truncated, invalid JSON

Stop the server (Ctrl+C) to simulate a disconnect.
