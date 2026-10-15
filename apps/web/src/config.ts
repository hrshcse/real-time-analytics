export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

/** Frame buffer wait (ms) before posting to the worker. 0 = no buffering (experiment baseline). */
export const BUFFER_MAX_WAIT_MS = Number(import.meta.env.VITE_BUFFER_MS ?? 50);
