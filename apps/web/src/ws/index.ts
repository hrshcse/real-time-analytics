import { WS_URL } from '../config';
import { createConnection } from './connection';

/** The app-wide connection. Components receive it as a prop so tests can pass a fake. */
export const appConnection = createConnection(WS_URL);

export * from './connection';
export { useConnection } from './useConnection';
