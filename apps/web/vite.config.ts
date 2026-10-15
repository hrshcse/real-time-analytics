/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for production builds only (WBS 20). Dev needs inline scripts for
 * React Fast Refresh, so the policy is injected at build time. Hosting should also send it as a
 * header (vercel.json); the meta tag covers static hosts that can't.
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self'",
    // React `style={{…}}` attributes (grid positions) need inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // The WebSocket server is a different origin: allow ws/wss explicitly.
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'rta-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig({
  plugins: [react(), csp()],
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
