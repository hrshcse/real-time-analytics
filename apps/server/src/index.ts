import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config';
import { createSession } from './session';

const wss = new WebSocketServer({
  port: config.port,
  // Reject browsers from unexpected origins. Non-browser clients (no Origin header) are
  // allowed so scripts/tests can connect; real auth comes later (WBS 20).
  verifyClient: ({ origin }: { origin: string }) =>
    !origin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin),
  maxPayload: 64 * 1024, // client control messages are tiny
});

let nextId = 1;
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const log = (msg: string) => console.log(`[conn ${id}] ${msg}`);
  log(`connected from ${req.socket.remoteAddress} (${wss.clients.size} open)`);

  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  const session = createSession(ws, config, log);
  ws.on('message', (data) => session.handleMessage(data.toString()));
  ws.on('close', (code) => {
    session.dispose();
    log(`closed (code ${code})`);
  });
  ws.on('error', (err) => log(`error: ${err.message}`));
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

wss.on('listening', () => {
  console.log(
    `WebSocket server on ws://localhost:${config.port}  ` +
      `(default ${config.defaultRate}/s, tick ${config.tickMs} ms)`,
  );
});

function shutdown() {
  clearInterval(pingTimer);
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  wss.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
