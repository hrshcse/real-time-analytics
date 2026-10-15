import { config } from './config';
import { createServer } from './server';

const server = createServer(config);

server.ready.then((port) => {
  console.log(
    `WebSocket server on ws://localhost:${port}  ` +
      `(default ${config.defaultRate}/s, tick ${config.tickMs} ms` +
      `${config.authToken ? ', auth token required' : ''})`,
  );
});

function shutdown() {
  server.close().then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
