export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

/** Subprotocols offered on connect: our protocol id, plus the auth placeholder token if set. */
export const WS_PROTOCOLS = import.meta.env.VITE_WS_TOKEN
  ? ['rta.v1', `token.${import.meta.env.VITE_WS_TOKEN}`]
  : ['rta.v1'];

/** Frame buffer wait (ms) before posting to the worker. 0 = no buffering (experiment baseline). */
export const BUFFER_MAX_WAIT_MS = Number(import.meta.env.VITE_BUFFER_MS ?? 50);
