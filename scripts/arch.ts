/**
 * Проверка границ. Не проверяет, что игра работает, — проверяет, что её
 * можно менять параллельно: слои не переплетаются, симуляция остаётся
 * headless, фичи не лезут друг другу внутрь, ссылки на документ существуют.
 *
 * Это то, что раньше приходилось помнить и повторять в ревью. Теперь падает
 * сборка, и помнить не нужно.
 *
 * Запуск: npm run arch
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface Violation {
  readonly rule: string;
  readonly where: string;
  readonly what: string;
}

const violations: Violation[] = [];
const fail = (rule: string, where: string, what: string): void => {
  violations.push({ rule, where, what });
};

/* ---------- обход исходников ---------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      walk(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))];
const source = new Map(files.map((f) => [relative(ROOT, f), readFileSync(f, 'utf8')]));

/** Все спецификаторы импорта файла — и статические, и типовые. */
function imports(code: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g;
  for (const m of code.matchAll(re)) out.push(m[1]!);
  // import 'x' без привязок
  for (const m of code.matchAll(/(?:^|\n)\s*import\s+'([^']+)'/g)) out.push(m[1]!);
  return out;
}

/** Куда указывает относительный импорт, в терминах путей от корня. */
function targetOf(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const dir = join(ROOT, file, '..');
  return relative(ROOT, resolve(dir, spec)).replaceAll('\\', '/');
}

const layerOf = (path: string): string | null => {
  const m = /^src\/(core|sim|render|ui|features)\//.exec(path);
  if (m !== null) return m[1]!;
  if (path === 'src/main.ts') return 'main';
  if (path.startsWith('scripts/')) return 'scripts';
  return null;
};

/**
 * Разрешённые рёбра. Правило одно: слой знает про себя и про то, что ниже.
 * Нижним быть выгодно — чем ниже слой, тем больше способов его проверить.
 */
const ALLOWED: Record<string, readonly string[]> = {
  core: ['core'],
  sim: ['core', 'sim'],
  render: ['core', 'sim', 'render'],
  ui: ['core', 'sim', 'ui'],
  features: ['core', 'sim', 'render', 'ui', 'features'],
  main: ['core', 'sim', 'render', 'ui', 'features'],
  scripts: ['core', 'sim', 'features', 'scripts'],
};

/* ---------- 1. слои ---------- */

for (const [file, code] of source) {
  const from = layerOf(file);
  if (from === null) continue;
  for (const spec of imports(code)) {
    const target = targetOf(file, spec);
    if (target === null) continue;
    const to = layerOf(target);
    if (to === null) continue;
    if (!(ALLOWED[from] ?? []).includes(to)) {
      fail('слои', file, `${from} → ${to} (${spec})`);
    }
  }
}

/* ---------- 2. симуляция остаётся headless ---------- */

/**
 * Главное архитектурное правило README: sim/ не импортирует three.
 * Ровно оно делает возможными npm run check, measure и play без браузера —
 * и серверную валидацию из §6 без переписывания игры.
 */
for (const [file, code] of source) {
  const layer = layerOf(file);
  if (layer === null || layer === 'render' || layer === 'ui' || layer === 'main') continue;
  for (const spec of imports(code)) {
    if (spec === 'three' || spec.startsWith('three/')) fail('headless', file, `импортирует ${spec}`);
  }
}

/**
 * DOM в симуляции. localStorage — объявленное исключение: это граница
 * сохранения, и она уже обёрнута в try/catch именно ради Node.
 */
const STORAGE_OK = new Set([
  'src/sim/save.ts',
  'src/sim/telemetry.ts',
  // Настройки игрока (§18.5) — такая же граница хранилища, как сейв, и по
  // тем же правилам: try/catch, разбор по одному полю, чистая `readMix`
  // рядом для проверок в Node.
  'src/core/settings.ts',
]);

/**
 * Часы и цикл — сама браузерная обвязка, им обращаться к окну положено.
 * Список именной: новый файл в core/, потянувшийся к DOM, обязан объяснить
 * себя здесь, а не проскочить под общим разрешением слоя.
 */
const BROWSER_HARNESS = new Set([
  'src/core/loop.ts',
  'src/core/clock.ts',
  // Звук (§18) — такая же обвязка, как часы и цикл: ему положено знать про
  // AudioContext и про сворачивание вкладки. Игровой логики в нём нет, что
  // играть — решает main по изменениям состояния.
  'src/core/audio.ts',
]);

for (const [file, code] of source) {
  const layer = layerOf(file);
  if (layer !== 'core' && layer !== 'sim') continue;
  // Правила гоняются в Node и подменяют хранилище намеренно — это их работа.
  if (file.endsWith('.rules.ts')) continue;
  if (BROWSER_HARNESS.has(file)) continue;
  const body = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const dom of ['document.', 'window.', 'performance.', 'requestAnimationFrame']) {
    if (body.includes(dom)) fail('headless', file, `трогает ${dom}`);
  }
  if (/\blocalStorage\b/.test(body) && !STORAGE_OK.has(file)) {
    fail('headless', file, 'трогает localStorage вне границы сохранения');
  }
}

/* ---------- 3. шаг вылазки остаётся детерминированным ---------- */

/**
 * В шаге вылазки нет случайности вообще: всё, что можно было бросить, уже
 * брошено генерацией локации по сиду (§4). Следствий у этого больше, чем
 * кажется: два процесса с одинаковым состоянием и одинаковым dt дают
 * одинаковый результат, а значит вылазку можно пересчитать — в замере,
 * в золотом мастере, в разборе бага по сейву и на сервере, если он появится.
 *
 * Держится свойство на строке, которой нет, и умирает от строки, которую
 * легко дописать: первый же крит или разброс урона потянет в шаг Math.random
 * или mulberry32, и детерминизм пропадёт молча — игра будет выглядеть
 * исправной, а замеры перестанут сходиться. Если случайность в шаге всё же
 * понадобится, её сид обязан лежать в состоянии и продвигаться шагом; тогда
 * правило снимается решением, а не нарушается походя.
 *
 * Правило про сами файлы, а не про их зависимости: generateLocation остаётся
 * случайным сколько угодно — его зовут один раз на входе, а не на шаге.
 */
const DETERMINISTIC = ['src/sim/raid.ts', 'src/sim/pathfinding.ts'];

for (const file of DETERMINISTIC) {
  const code = source.get(file);
  if (code === undefined) {
    fail('детерминизм', file, 'файла нет — правило указывает в пустоту');
    continue;
  }
  const body = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/\bMath\.random\b/.test(body)) fail('детерминизм', file, 'зовёт Math.random');
  for (const spec of imports(code)) {
    if (targetOf(file, spec) === 'src/core/rng') fail('детерминизм', file, `импортирует ${spec}`);
  }
}

/* ---------- 4. изоляция фич ---------- */

/**
 * Фича видна другим только через свой index.ts. Без этого правила
 * «каталог на фичу» — просто раскладка папок: связность возвращается
 * первым же импортом чужой внутренности.
 */
for (const [file, code] of source) {
  const mine = /^src\/features\/([^/]+)\//.exec(file)?.[1];
  for (const spec of imports(code)) {
    const target = targetOf(file, spec);
    if (target === null) continue;
    const theirs = /^src\/features\/([^/]+)(\/(.*))?$/.exec(target);
    if (theirs === null) continue;
    const name = theirs[1]!;
    const rest = theirs[3] ?? '';
    if (name === mine) continue;
    if (rest === '' || rest === 'index' || rest === 'index.ts') continue;
    fail('изоляция фич', file, `лезет внутрь features/${name}: ${spec}`);
  }
}

/* ---------- 5. ссылки на документ ---------- */

/**
 * §N в коде — обещание, что решение записано в DESIGN.md. Ничем не
 * подкреплённое, оно протухает молча: §22 упоминался в четырёх файлах,
 * когда раздела ещё не существовало.
 */
const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
const sections = new Set<string>();
for (const m of design.matchAll(/^#{1,6}\s+(\d+(?:\.\d+)*)\.?\s/gm)) sections.add(m[1]!);

const missing = new Map<string, string[]>();
for (const [file, code] of source) {
  for (const m of code.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    const ref = m[1]!;
    if (sections.has(ref)) continue;
    const list = missing.get(ref) ?? [];
    if (!list.includes(file)) list.push(file);
    missing.set(ref, list);
  }
}
for (const [ref, where] of [...missing].sort()) {
  fail('ссылки', where.join(', '), `§${ref} — такого раздела в DESIGN.md нет`);
}

/* ---------- 6. оглавление артбуков ---------- */

/**
 * artbooks.html — единственный вход в артбуки, и список книг в нём написан
 * руками. Такой список расходится с папкой молча: новый артбук просто не
 * появляется в оглавлении, а переименованный заголовок остаётся старым —
 * и оба раза страница выглядит исправной.
 */
const HUB = 'artbooks.html';
const NOT_A_BOOK = new Set(['index.html', HUB]);

const books = readdirSync(ROOT)
  .filter((name) => name.endsWith('.html') && !NOT_A_BOOK.has(name))
  .sort();

const hub = readFileSync(join(ROOT, HUB), 'utf8');
const shelves = new Set(
  [...(/const SHELVES = \[([^\]]*)\]/.exec(hub)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!),
);

const listed = new Map<string, { title: string; shelf: string }>();
for (const m of hub.matchAll(/\{ file:'([^']+)', title:'([^']+)', shelf:'([^']+)' \}/g)) {
  listed.set(m[1]!, { title: m[2]!, shelf: m[3]! });
}

for (const file of books) {
  const entry = listed.get(file);
  if (entry === undefined) {
    fail('артбуки', HUB, `${file} не попал в оглавление`);
    continue;
  }
  const title = /<title>([^<]*)<\/title>/.exec(readFileSync(join(ROOT, file), 'utf8'))?.[1]?.trim() ?? '';
  if (entry.title !== title) {
    fail('артбуки', HUB, `${file}: в оглавлении «${entry.title}», в книге «${title}»`);
  }
  if (!shelves.has(entry.shelf)) {
    fail('артбуки', HUB, `${file}: полки «${entry.shelf}» нет в SHELVES`);
  }
}
for (const file of listed.keys()) {
  if (!books.includes(file)) fail('артбуки', HUB, `${file} есть в оглавлении, но не в папке`);
}

/* ---------- отчёт ---------- */

const RULES = ['слои', 'headless', 'детерминизм', 'изоляция фич', 'ссылки', 'артбуки'];

if (violations.length === 0) {
  console.log(`Границы целы: ${source.size} файлов, ${books.length} артбуков, ${RULES.length} правил.`);
  process.exit(0);
}

console.error(`Нарушений границ: ${violations.length}\n`);
for (const rule of RULES) {
  const group = violations.filter((v) => v.rule === rule);
  if (group.length === 0) continue;
  console.error(`  ${rule}`);
  for (const v of group) console.error(`    ${v.where}\n      ${v.what}`);
  console.error('');
}
process.exit(1);
