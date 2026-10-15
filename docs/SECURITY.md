# Security (WBS 20)

What this project does, and — just as important — what it deliberately doesn't.

## Threat model in one paragraph

A browser dashboard connected to a WebSocket server that streams metrics and accepts a few
control commands (start, stop, rate, burst). Realistic risks: a hostile web page connecting to the
server from a victim's browser (cross-site WebSocket hijacking), a client flooding control messages
or connections, malformed or hostile payloads reaching the UI, and script injection into the page.

## Controls in place

| Risk                                            | Control                                                                                                                        | Where                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Cross-site WebSocket hijacking                  | `Origin` allowlist checked at the handshake (403)                                                                              | `server.ts` `verifyClient`, `ALLOWED_ORIGINS`               |
| Unauthenticated access                          | **Placeholder** token via subprotocol `token.<AUTH_TOKEN>`; wrong/missing → close 4401, never retried by the client            | `server.ts`, `VITE_WS_TOKEN`                                |
| Control-message flooding                        | Token bucket per connection (default 10/s); 5 s worth of rejections → close 1008                                               | `rateLimit.ts`, `CONTROL_RATE_PER_SEC`                      |
| Connection flooding                             | Max simultaneous connections per IP (default 20) → 429 at the handshake                                                        | `MAX_CONNECTIONS_PER_IP`                                    |
| Oversized messages                              | `maxPayload` 64 KB on the server                                                                                               | `server.ts`                                                 |
| Hostile control values                          | `rate` clamped to `MAX_RATE`, burst duration ≤ 10 min, unknown types rejected                                                  | `session.ts`                                                |
| Slow / stalled clients exhausting server memory | Frames dropped when a socket's buffer exceeds `MAX_BUFFERED_BYTES`                                                             | `session.ts`                                                |
| Malformed / hostile stream data in the UI       | Every frame parsed safely; every event validated (`validateEvent`); counted, never trusted                                     | `processing/parse.ts`, `shared/validate.ts`                 |
| Script injection (XSS)                          | React escapes all text. ESLint **forbids** `dangerouslySetInnerHTML` and `innerHTML`/`outerHTML`                               | `eslint.config.js`                                          |
| Injected / third-party scripts                  | Production Content-Security-Policy: `script-src 'self'`, `connect-src 'self' ws: wss:`, `object-src 'none'`, `base-uri 'none'` | `vite.config.ts` (meta tag); send as a header too (Phase 8) |
| Free-text input abuse                           | Search capped at 100 chars, matched as plain substring (no regex)                                                              | `DataGrid.tsx`                                              |
| Dead connections holding resources              | Server ping/pong every 15 s terminates dead sockets; client heartbeat timeout 15 s                                             | `server.ts`, `connection.ts`                                |

Tests: `apps/server/src/server.test.ts` (origin rejection, 4401, per-IP cap, rate limit → 1008),
`e2e/dashboard.spec.ts` (4401 shown and not retried).

## The auth placeholder is NOT production auth

`VITE_WS_TOKEN` is compiled into the JavaScript bundle: anyone who loads the page can read it. It
only demonstrates the mechanics: where a credential travels, where the server checks it, which
close code the client treats as "don't retry". For production:

1. The user signs in over HTTPS (session cookie, `HttpOnly`, `Secure`, `SameSite`).
2. The page calls `POST /ws-ticket` and gets a **short-lived, single-use** ticket (≈ 30 s), bound to
   the user.
3. It connects to `wss://…?ticket=…` (or sends the ticket as the first message); the server
   validates and burns it, then attaches the user identity to the socket.
4. Authorise every control message against that identity (who may change the rate?).

Why not the `Authorization` header? Browsers' `WebSocket` API can't set custom headers. Why not
a long-lived token in the URL? URLs end up in logs and history; a single-use ticket makes that
harmless.

## Deployment checklist (Phase 8)

- `wss://` only (TLS terminates at the platform). `ws://` is for localhost.
- `ALLOWED_ORIGINS` = the exact production origin(s). Never `*`.
- CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` as response
  headers.
- Rate limits and connection caps sized for real traffic, ideally also at the proxy/load balancer.
- Dependency auditing in CI (`npm audit --audit-level=high`).
