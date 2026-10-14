import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // @rta/shared ships TypeScript source, so bundle it into the server output.
  noExternal: ['@rta/shared'],
});
