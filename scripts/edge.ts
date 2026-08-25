/**
 * Сборка серверных функций (§6, §26).
 *
 * Смысл скрипта — в том, чего он **не** делает: не переписывает симуляцию
 * на язык сервера. `src/sim` не знает про three и DOM (правило «headless»
 * в `scripts/arch.ts`), поэтому тот же код идёт в Deno как есть, а esbuild
 * лишь склеивает граф импортов в один файл. Вторая реализация правил
 * разошлась бы с первой молча — и разошлась бы в бою.
 *
 * Отсюда и проверка в конце: если в сборку затесался `document`, `window`
 * или `localStorage`, значит функция утащила за собой кусок клиента,
 * и в Deno он не заведётся. Ловить это на деплое дороже, чем здесь.
 *
 * Запуск: npm run edge
 */
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
/**
 * Раскладка Supabase CLI: функция — это каталог с `index.js`. Сборка кладётся
 * прямо туда, а не в свой `dist`, чтобы деплой был одной командой и не требовал
 * копирования руками: `npx supabase functions deploy <имя>`.
 */
const OUT = join(ROOT, 'supabase', 'functions');

/** Что собирается. Имя — оно же имя функции в Supabase. */
const FUNCTIONS = ['sortie', 'wheel', 'billing', 'stripe-webhook', 'telegram-auth', 'telegram-webhook', 'vk-auth'] as const;

/** Чего в серверной сборке быть не может: это клиент, а не симуляция. */
const CLIENT_ONLY = ['document.', 'window.', 'localStorage', 'requestAnimationFrame'];

for (const name of FUNCTIONS) {
  mkdirSync(join(OUT, name), { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'edge', `${name}.ts`)],
    outfile: join(OUT, name, 'index.js'),
    bundle: true,
    format: 'esm',
    // Deno, а не Node: своих встроенных модулей функция не зовёт вовсе.
    platform: 'neutral',
    target: 'es2022',
    // Импорты по URL и jsr: остаются как есть — их разрешает сам Deno.
    external: ['jsr:*', 'npm:*', 'https://*'],
    // Сжато. Читать сборку незачем: исходник лежит рядом (`edge/*.ts`)
    // и он же — источник правды; в панели Supabase живёт только результат.
    // Несжатая отправка стоит втрое дороже на каждом деплое.
    minify: true,
  });

  const code = readFileSync(join(OUT, name, "index.js"), 'utf8');
  const found = CLIENT_ONLY.filter((bad) => code.includes(bad));
  if (found.length > 0) {
    console.error(`✗ ${name}: в сборку попал клиент — ${found.join(', ')}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`✓ ${name}.js — ${(code.length / 1024).toFixed(1)} КБ`);
}
