/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_BUFFER_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
