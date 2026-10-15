import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config';
import { createTokenBucket } from './rateLimit';
import { createSession } from './session';

/** Close codes (docs/PROTOCOL.md). */
export const CLOSE = { unauthorized: 4401, policy: 1008, tryAgainLater: 1013 } as const;

const TOKEN_PREFIX = 'token.';

/**
 * Creates the WebSocket server. Separate from index.ts (which only wires process signals) so tests
 * can start one on a random port.
 */
export function createServer(config: Config, log: (msg: string) => void = console.log) {
  const perIp = new Map<string, number>();

  const wss = new WebSocketServer({
    port: config.port,
    // Reject browsers from unexpected origins. Non-browser clients (no Origin header) are allowed
    // so scripts/tests can connect; the auth placeholder covers those.
    verifyClient: (
      { origin, req }: { origin: string; req: IncomingMessage },
      done: (ok: boolean, code?: number) => void,
    ) => {
      if (
        origin &&
        !config.allowedOrigins.includes('*') &&
        !config.allowedOrigins.includes(origin)
      ) {
        return done(false, 403);
      }
      const ip = req.socket.remoteAddress ?? 'unknown';
      if ((perIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) return done(false, 429);
      done(true);
    },
    // Pick our protocol, never echo the token back.
    handleProtocols: (protocols: Set<string>) => (protocols.has('rta.v1') ? 'rta.v1' : false),
    maxPayload: 64 * 1024, // client control messages are tiny
  });

  let nextId = 1;
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws, req) => {
    const id = nextId++;
    const ip = req.socket.remoteAddress ?? 'unknown';
    const tag = (msg: string) => log(`[conn ${id}] ${msg}`);

    // ── Auth placeholder (WBS 20) ──
    if (config.authToken) {
      const offered = (req.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim())
        .find((p) => p.startsWith(TOKEN_PREFIX));
      if (offered?.slice(TOKEN_PREFIX.length) !== config.authToken) {
        tag('rejected: bad or missing token');
        ws.close(CLOSE.unauthorized, 'Unauthorized');
        return;
      }
    }

    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    tag(`connected from ${ip} (${wss.clients.size} open)`);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    const session = createSession(ws, config, tag);
    // ── Rate limiting (WBS 20): token bucket per connection; persistent abuse → close 1008 ──
    const bucket = createTokenBucket(config.controlRatePerSec, config.controlRatePerSec);
    let rejected = 0;
    ws.on('message', (data) => {
      if (!bucket.take()) {
        rejected++;
        if (rejected > config.controlRatePerSec * 5) ws.close(CLOSE.policy, 'Too many messages');
        else ws.send(JSON.stringify({ type: 'error', message: 'Rate limited' }));
        return;
      }
      session.handleMessage(data.toString());
    });
    ws.on('close', (code) => {
      session.dispose();
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      tag(`closed (code ${code})`);
    });
    ws.on('error', (err) => tag(`error: ${err.message}`));
  });

  // Protocol-level ping/pong: detects dead TCP connections (e.g. laptop lid closed)
  // and frees their timers. Browsers answer pings automatically.
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 15_000);

  const ready = new Promise<number>((resolve) =>
    wss.on('listening', () => resolve((wss.address() as AddressInfo).port)),
  );

  return {
    wss,
    ready,
    close(): Promise<void> {
      clearInterval(pingTimer);
      for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
