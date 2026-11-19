/// <reference types="vite/client" />

/** Compile-time constant: true only for `--mode mock` builds (see vite.config.ts `define`). */
declare const __MOCKS__: boolean;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_BASE_URL?: string;
}
