import { useEffect, useState } from 'react';
import { useStore } from '../hooks/useStore';
import { REPLAY_SPEEDS } from '../workers/replay';
import type { Connection } from '../ws';
import styles from './chart.module.css';
import dash from './dashboard.module.css';

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const date = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Session replay controls (WBS 11.4). The live stream keeps running while a session replays. */
export function ReplayPanel({ connection }: { connection: Connection }) {
  const sessions = useStore(connection.sessions);
  const replay = useStore(connection.replay);
  const [sessionId, setSessionId] = useState('');
  const [speed, setSpeed] = useState<number>(5);

  useEffect(() => {
    connection.requestSessions();
  }, [connection]);

  const selected = sessionId || sessions?.[0]?.id || '';
  const progress = replay ? (replay.at - replay.from) / Math.max(1, replay.to - replay.from) : 0;

  return (
    <div className={styles.replay} aria-label="Session replay" role="group">
      {!replay ? (
        <>
          <label className={dash.label} htmlFor="replay-session">
            Session
          </label>
          <select
            id="replay-session"
            className={dash.select}
            value={selected}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={!sessions?.length}
          >
            {!sessions?.length && (
              <option value="">{sessions ? 'No stored sessions' : 'Loading…'}</option>
            )}
            {sessions?.map((s) => (
              <option key={s.id} value={s.id}>
                {date.format(s.startedAt)} · {duration(s.endedAt - s.startedAt)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={dash.button}
            onClick={() => connection.requestSessions()}
          >
            Refresh
          </button>
        </>
      ) : (
        <span className={styles.replayStatus}>
          {replay.ended ? 'Replay finished' : replay.playing ? 'Replaying' : 'Paused at'}{' '}
          {time.format(replay.at)}{' '}
          <span className={dash.label}>
            ({time.format(replay.from)} – {time.format(replay.to)})
          </span>
          <progress
            className={styles.progress}
            value={progress}
            max={1}
            aria-label="Replay progress"
          />
        </span>
      )}
      <label className={dash.label} htmlFor="replay-speed">
        Speed
      </label>
      <select
        id="replay-speed"
        className={dash.select}
        value={replay?.speed ?? speed}
        onChange={(e) => {
          const v = Number(e.target.value);
          setSpeed(v);
          if (replay) connection.sendReplay({ action: 'speed', speed: v });
        }}
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      {!replay ? (
        <button
          type="button"
          className={dash.button}
          disabled={!selected}
          onClick={() => connection.sendReplay({ action: 'start', sessionId: selected, speed })}
        >
          ▶ Start replay
        </button>
      ) : (
        <>
          <button
            type="button"
            className={dash.button}
            onClick={() => connection.sendReplay({ action: replay.playing ? 'pause' : 'resume' })}
          >
            {replay.playing ? 'Pause' : replay.ended ? 'Replay again' : 'Resume'}
          </button>
          <button
            type="button"
            className={dash.button}
            onClick={() => connection.sendReplay({ action: 'stop' })}
          >
            Stop · back to live
          </button>
        </>
      )}
    </div>
  );
}
