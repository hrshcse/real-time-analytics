import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@rta/shared';
import type { Config } from './config';
import { createGenerator, createRateAccumulator } from './generator';

/**
 * One streaming session per WebSocket connection.
 * Each client controls its own rate, so two browser tabs can run different experiments.
 */
export function createSession(ws: WebSocket, config: Config, log: (msg: string) => void) {
  const generator = createGenerator({ badEventPct: config.badEventPct });
  const accumulator = createRateAccumulator();

  let running = true;
  let baseRate = config.defaultRate;
  let burst: { rate: number; endsAt: number } | null = null;
  let seq = 0;
  let serverDropped = 0;
  let lastTick = performance.now();

  const currentRate = () => (burst ? burst.rate : baseRate);

  function send(message: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  function sendStatus() {
    send({
      type: 'status',
      running,
      rate: currentRate(),
      baseRate,
      burstEndsAt: burst?.endsAt ?? null,
    });
  }

  function tick() {
    const now = performance.now();
    // Cap elapsed time so a stalled event loop doesn't produce one giant catch-up frame.
    const elapsed = Math.min(now - lastTick, 1000);
    lastTick = now;

    if (burst && Date.now() >= burst.endsAt) {
      burst = null;
      sendStatus();
    }
    if (!running) return;

    const count = accumulator.take(currentRate(), elapsed);
    if (count === 0) return;

    // Server-side backpressure: if the client isn't draining its socket, skip this frame
    // instead of letting the server's memory grow without bound.
    if (ws.bufferedAmount > config.maxBufferedBytes) {
      serverDropped++;
      return;
    }

    const sentAt = Date.now();
    const events = generator.generate(count, sentAt - elapsed, elapsed);

    if (config.badFramePct > 0 && Math.random() * 100 < config.badFramePct) {
      ws.send('{"type":"batch","events":[{"id":"truncated'); // deliberately invalid JSON
      return;
    }

    // `events` may contain deliberately invalid items when BAD_EVENT_PCT > 0.
    ws.send(JSON.stringify({ type: 'batch', seq: seq++, sentAt, serverDropped, events }));
  }

  function clampRate(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.round(value), config.maxRate);
  }

  function handleMessage(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      send({ type: 'error', message: 'Invalid JSON' });
      return;
    }
    switch (msg?.type) {
      case 'start':
        running = true;
        accumulator.reset();
        lastTick = performance.now();
        break;
      case 'stop':
        running = false;
        break;
      case 'setRate': {
        const rate = clampRate(msg.rate);
        if (rate === null) return send({ type: 'error', message: 'setRate: invalid rate' });
        baseRate = rate;
        break;
      }
      case 'burst': {
        const rate = clampRate(msg.rate);
        const duration = msg.durationMs;
        if (rate === null || typeof duration !== 'number' || duration <= 0 || duration > 600_000) {
          return send({ type: 'error', message: 'burst: invalid rate or durationMs' });
        }
        burst = { rate, endsAt: Date.now() + duration };
        break;
      }
      default:
        return send({ type: 'error', message: 'Unknown message type' });
    }
    log(`control: ${raw}`);
    sendStatus();
  }

  const tickTimer = setInterval(tick, config.tickMs);
  const heartbeatTimer = setInterval(
    () => send({ type: 'heartbeat', serverTime: Date.now() }),
    config.heartbeatMs,
  );

  send({
    type: 'hello',
    serverTime: Date.now(),
    rate: currentRate(),
    tickMs: config.tickMs,
    running,
  });

  return {
    handleMessage,
    dispose() {
      clearInterval(tickTimer);
      clearInterval(heartbeatTimer);
    },
  };
}
