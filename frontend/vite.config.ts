import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite';

const WORKER_FILE = 'mockServiceWorker.js';

/**
 * Serves (dev) and emits (build) MSW's service worker in mock mode only.
 * The worker never lives in /public, so production builds cannot ship it.
 */
function mswWorker(): Plugin {
  const source = (): string =>
    readFileSync(
      fileURLToPath(new URL(`./node_modules/msw/lib/${WORKER_FILE}`, import.meta.url)),
      'utf8',
    );
  return {
    name: 'smart-classroom:msw-worker',
    configureServer(server) {
      server.middlewares.use(`/${WORKER_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source());
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(`/${WORKER_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKER_FILE, source: source() });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.API_PROXY_TARGET ?? 'http://localhost:8000';
  const plugins: PluginOption[] = [react()];
  if (mode === 'mock') plugins.push(mswWorker());
  if (mode === 'analyze') {
    plugins.push(visualizer({ filename: 'stats.html', gzipSize: true, template: 'treemap' }));
  }

  return {
    plugins,
    define: {
      // Literal boolean so the mock bootstrap in main.tsx is dead-code-eliminated outside mock mode.
      __MOCKS__: JSON.stringify(mode === 'mock'),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy:
        mode === 'mock'
          ? undefined
          : {
              '/api': {
                target: proxyTarget,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
              },
              '/ws': { target: proxyTarget, ws: true, changeOrigin: true },
            },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
