import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Config } from './config';
import { CLOSE, createServer } from './server';

const base: Config = {
  port: 0, // random free port
  defaultRate: 0,
  maxRate: 100_000,
  tickMs: 50,
  heartbeatMs: 5000,
  maxBufferedBytes: 8 * 1024 * 1024,
  badEventPct: 0,
  badFramePct: 0,
  allowedOrigins: ['http://localhost:5173'],
  authToken: null,
  controlRatePerSec: 5,
  maxConnectionsPerIp: 2,
};

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

async function start(over: Partial<Config> = {}) {
  const s = createServer({ ...base, ...over }, () => {});
  stop = s.close;
  return s.ready;
}

/** Resolves with the close code, or 'open' if the socket opened and stayed open briefly. */
function outcome(url: string, opts: { protocols?: string[]; origin?: string } = {}) {
  return new Promise<number | 'open' | 'error'>((resolve) => {
    const ws = new WebSocket(url, opts.protocols, { origin: opts.origin });
    let opened = false;
    ws.on('open', () => {
      opened = true;
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.close();
          resolve('open');
        }
      }, 150);
    });
    ws.on('close', (code) => opened && resolve(code));
    ws.on('unexpected-response', () => resolve('error'));
    ws.on('error', () => !opened && resolve('error'));
  });
}

describe('health endpoint (deployment)', () => {
  it('GET /healthz → 200 with connection count; other HTTP → 426', async () => {
    const port = await start();
    const ok = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'ok', connections: 0 });
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(426);
  });
});

describe('server security (WBS 20)', () => {
  it('rejects an unknown browser origin at the handshake', async () => {
    const port = await start();
    expect(await outcome(`ws://127.0.0.1:${port}`, { origin: 'http://evil.example' })).toBe(
      'error',
    );
    expect(await outcome(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' })).toBe(
      'open',
    );
  });

  it('auth placeholder: closes with 4401 without the right token subprotocol', async () => {
    const port = await start({ authToken: 's3cret' });
    expect(await outcome(`ws://127.0.0.1:${port}`, { protocols: ['rta.v1'] })).toBe(
      CLOSE.unauthorized,
    );
    expect(await outcome(`ws://127.0.0.1:${port}`, { protocols: ['rta.v1', 'token.wrong'] })).toBe(
      CLOSE.unauthorized,
    );
    expect(await outcome(`ws://127.0.0.1:${port}`, { protocols: ['rta.v1', 'token.s3cret'] })).toBe(
      'open',
    );
  });

  it('caps connections per IP', async () => {
    const port = await start({ maxConnectionsPerIp: 2 });
    const a = new WebSocket(`ws://127.0.0.1:${port}`);
    const b = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([a, b].map((ws) => new Promise((r) => ws.on('open', r))));
    expect(await outcome(`ws://127.0.0.1:${port}`)).toBe('error'); // 429 at the handshake
    a.close();
    b.close();
  });

  it('rate-limits control messages, then closes persistent abusers with 1008', async () => {
    const port = await start({ controlRatePerSec: 5 });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const errors: string[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'error') errors.push(m.message);
    });
    await new Promise((r) => ws.on('open', r));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    for (let i = 0; i < 100; i++) ws.send(JSON.stringify({ type: 'setRate', rate: 1 }));
    expect(await closed).toBe(CLOSE.policy);
    expect(errors).toContain('Rate limited');
  });
});
