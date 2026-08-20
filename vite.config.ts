import { defineConfig } from 'vite';

// Порт назначает среда через PORT: в проекте нет ничего, что требовало бы
// конкретный 5173 — ни OAuth-возвратов, ни вебхуков, ни списков CORS.
// @types/node не подключены, поэтому до process добираемся через globalThis.
const rawPort = Number(
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.PORT,
);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : undefined;

export default defineConfig({
  base: './',
  server: { host: true, ...(port ? { port } : {}) },
  build: {
    target: 'es2022',
    // three тянет ~160 КБ gzip — держим его отдельным чанком, чтобы код игры
    // инвалидировался без него
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
