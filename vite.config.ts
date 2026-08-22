import { cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Порт назначает среда через PORT: в проекте нет ничего, что требовало бы
// конкретный 5173 — ни OAuth-возвратов, ни вебхуков, ни списков CORS.
const rawPort = Number(process.env.PORT);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : undefined;

/**
 * Сборка многостраничная: игра — index.html, рядом артбуки и их оглавление.
 * Список страниц читается из папки, а не перечисляется здесь: перечисленный
 * молча отстаёт, и новая книга оказывается в оглавлении собранного сайта
 * ссылкой в 404. Папку уже сторожит npm run arch — она и есть источник.
 */
const pages = Object.fromEntries(
  readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith('.html'))
    .map((name) => [name.slice(0, -'.html'.length), resolve(import.meta.dirname, name)]),
);

export default defineConfig({
  plugins: [
    {
      // Артбуки читают каталоги и .gltf из assets/ на живом сайте так же,
      // как на dev-сервере. В public/ папку не переносим: её адрес зашит
      // в rules-проверки и в сами страницы, а Vite копирует public целиком —
      // это тот же cp, только с переездом. Игре копия не нужна: геометрия
      // запечена в *.data.ts ещё генератором.
      name: 'copy-assets-for-artbooks',
      closeBundle() {
        cpSync('assets', 'dist/assets', { recursive: true });
      },
    },
  ],
  base: './',
  server: { host: true, ...(port ? { port } : {}) },
  preview: { host: true, ...(port ? { port } : {}) },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: pages,
      output: {
        // three тянет ~160 КБ gzip — держим его отдельным чанком, чтобы код игры
        // инвалидировался без него
        manualChunks: { three: ['three'] },
      },
    },
  },
});
