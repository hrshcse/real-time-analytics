import type { ClientMessage } from '@rta/shared';
import type { ServerState } from '../ws';
import styles from './dashboard.module.css';

const RATES = [100, 1_000, 10_000, 50_000];
const BURST = { rate: 50_000, durationMs: 5_000 };

interface Props {
  connected: boolean;
  server: ServerState | null;
  send: (message: ClientMessage) => boolean;
}

const fmt = new Intl.NumberFormat();

/** Minimal controls to exercise the stream. Replaced by the full control bar in WBS 13. */
export function StreamControls({ connected, server, send }: Props) {
  const running = server?.running ?? false;
  const baseRate = server?.baseRate ?? RATES[1]!;
  const rates = RATES.includes(baseRate) ? RATES : [...RATES, baseRate].sort((a, b) => a - b);
  const bursting = server?.burstEndsAt != null;

  return (
    <div className={styles.controls}>
      <div className={styles.group} role="group" aria-label="Stream">
        <button
          type="button"
          className={styles.button}
          disabled={!connected || running}
          onClick={() => send({ type: 'start' })}
        >
          Start
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!connected || !running}
          onClick={() => send({ type: 'stop' })}
        >
          Stop
        </button>
      </div>

      <div className={styles.group}>
        <label className={styles.label} htmlFor="rate">
          Rate
        </label>
        <select
          id="rate"
          className={styles.select}
          disabled={!connected}
          value={baseRate}
          onChange={(e) => send({ type: 'setRate', rate: Number(e.target.value) })}
        >
          {rates.map((r) => (
            <option key={r} value={r}>
              {fmt.format(r)} events/sec
            </option>
          ))}
        </select>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          disabled={!connected || !running || bursting}
          onClick={() => send({ type: 'burst', ...BURST })}
        >
          Burst {fmt.format(BURST.rate)}/s × {BURST.durationMs / 1000}s
        </button>
        {bursting && <span className={styles.burst}>Burst active</span>}
      </div>
    </div>
  );
}
