import { useEffect, useState } from 'react';

/** Seconds until `target` (ms since epoch), ticking twice a second while target is set. */
export function useCountdown(target: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    const tick = () => setNow(Date.now());
    // Sync right away: `now` may be from long before this target was set (stale first frame).
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [target]);
  return target === null ? null : Math.max(0, Math.ceil((target - now) / 1000));
}
