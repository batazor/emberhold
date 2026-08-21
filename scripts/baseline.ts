/**
 * Золотой мастер петли. Гоняет восемь детерминированных сессий по двадцать
 * вылазок и сравнивает сводку с baseline.json.
 *
 * Зачем: агент, правящий бой, узнаёт, что сдвинул экономику лагеря, не читая
 * camp.ts. Цена изменения перестаёт зависеть от размера игры — а без этого
 * параллельная работа сводится к тому, что каждый обязан знать всё.
 *
 * Расхождение — не обязательно поломка. Если сдвиг намеренный, его
 * записывают: npm run baseline. Тогда diff baseline.json попадает в коммит
 * и говорит ревью, что именно изменилось в игре.
 *
 * Запуск: npm run verify · npm run baseline (перезаписать)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RAIDS, playSession } from '../src/sim/session';
import type { SessionResult } from '../src/sim/session';

const FILE = join(resolve(import.meta.dirname, '..'), 'baseline.json');

/** Сиды закреплены: меняются они — меняется всё, и сравнивать станет нечего. */
const SEEDS = [20260820, 7, 42, 1337, 90210, 555, 31337, 2718];

type Kind = 'доля' | 'среднее' | 'уровень';

/**
 * Допуск узкий намеренно. Прогон детерминирован, поэтому любое расхождение
 * сверх плавающей арифметики — настоящее изменение поведения, а не шум.
 */
const TOLERANCE: Record<Kind, { abs?: number; rel?: number }> = {
  'доля': { abs: 0.02 },
  'среднее': { rel: 0.03 },
  'уровень': { abs: 0.15 },
};

const METRICS: readonly { key: string; kind: Kind; label: string }[] = [
  { key: 'failRate', kind: 'доля', label: 'провалов' },
  // §22.6 — без состава провалов мастер слеп к бою: правка, перенёсшая
  // провалы из провианта в бой при той же доле, прошла бы незамеченной.
  { key: 'combatFailShare', kind: 'доля', label: 'из них в бою' },
  { key: 'avgWoundsTaken', kind: 'среднее', label: 'ран за вылазку' },
  { key: 'avgFights', kind: 'среднее', label: 'стычек за вылазку' },
  { key: 'avgDepthShare', kind: 'доля', label: 'глубина выхода' },
  { key: 'buyOfferRate', kind: 'доля', label: 'покупка доступна' },
  { key: 'buyTakeRate', kind: 'доля', label: 'из них выбрали стройку' },
  { key: 'avgCarried', kind: 'среднее', label: 'вынесено за вылазку' },
  { key: 'avgLost', kind: 'среднее', label: 'потеряно за вылазку' },
  { key: 'avgFoodLeft', kind: 'среднее', label: 'провианта на выходе' },
  { key: 'medianReturnMin', kind: 'среднее', label: 'возврат после таймера, мин' },
  { key: 'hq', kind: 'уровень', label: 'Жильё на конец' },
  { key: 'kitchen', kind: 'уровень', label: 'Кухня на конец' },
  { key: 'storage', kind: 'уровень', label: 'Склад на конец' },
  { key: 'elapsedHours', kind: 'среднее', label: 'игрового времени, ч' },
];

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const round = (x: number): number => Math.round(x * 1e4) / 1e4;

function measure(): Record<string, number> {
  const runs: SessionResult[] = SEEDS.map(playSession);
  const pick = (fn: (r: SessionResult) => number | null): number =>
    round(mean(runs.map(fn).filter((x): x is number => x !== null)));

  return {
    failRate: pick((r) => r.summary.failRate),
    combatFailShare: pick((r) => r.summary.combatFailShare),
    avgWoundsTaken: pick((r) => r.summary.avgWoundsTaken),
    avgFights: pick((r) => r.summary.avgFights),
    avgDepthShare: pick((r) => r.summary.avgDepthShare),
    buyOfferRate: pick((r) => r.summary.buyOfferRate),
    buyTakeRate: pick((r) => r.summary.buyTakeRate),
    avgCarried: pick((r) => r.summary.avgCarried),
    avgLost: pick((r) => r.summary.avgLost),
    avgFoodLeft: pick((r) => r.summary.avgFoodLeft),
    medianReturnMin: pick((r) => r.summary.medianReturnMin),
    hq: pick((r) => r.levels.hq),
    kitchen: pick((r) => r.levels.kitchen),
    storage: pick((r) => r.levels.storage),
    elapsedHours: pick((r) => r.elapsedHours),
  };
}

interface Baseline {
  readonly note: string;
  readonly seeds: readonly number[];
  readonly raidsPerSession: number;
  readonly metrics: Readonly<Record<string, number>>;
}

const metrics = measure();

if (process.argv.includes('--write')) {
  const data: Baseline = {
    note: 'Золотой мастер петли. Перезаписывать только вместе с намеренным изменением игры: npm run baseline',
    seeds: SEEDS,
    raidsPerSession: RAIDS,
    metrics,
  };
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Мастер записан: ${SEEDS.length} сессий × ${RAIDS} вылазок → baseline.json`);
  for (const m of METRICS) console.log(`  ${m.label.padEnd(28)} ${metrics[m.key]}`);
  process.exit(0);
}

let base: Baseline;
try {
  base = JSON.parse(readFileSync(FILE, 'utf8')) as Baseline;
} catch {
  console.error('baseline.json не найден или битый. Записать: npm run baseline');
  process.exit(1);
}

const drift: string[] = [];
for (const m of METRICS) {
  const was = base.metrics[m.key];
  const now = metrics[m.key];
  if (was === undefined || now === undefined) {
    drift.push(`  ${m.label.padEnd(28)} метрики нет в мастере — запишите заново`);
    continue;
  }
  const tol = TOLERANCE[m.kind];
  const limit = tol.abs ?? Math.abs(was) * (tol.rel ?? 0);
  const delta = now - was;
  if (Math.abs(delta) <= limit + 1e-9) continue;
  const sign = delta > 0 ? '+' : '';
  drift.push(
    `  ${m.label.padEnd(28)} ${was} → ${now}   (${sign}${round(delta)}, допуск ±${round(limit)})`,
  );
}

if (drift.length === 0) {
  console.log(`Петля не сдвинулась: ${SEEDS.length} сессий × ${RAIDS} вылазок, ${METRICS.length} метрик.`);
  process.exit(0);
}

console.error(`Петля сдвинулась — ${drift.length} метрик из ${METRICS.length}:\n`);
for (const line of drift) console.error(line);
console.error(
  '\nЕсли это и есть цель изменения — запишите новый мастер: npm run baseline,\n' +
    'и пусть diff baseline.json уедет в тот же коммит.',
);
process.exit(1);
