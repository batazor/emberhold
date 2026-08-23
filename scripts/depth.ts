/**
 * Глубина провала — со стороны боя.
 *
 * §11.3 держит правило: **провал обязан приходить глубже середины локации,
 * и глубина провала не может быть меньше глубины возвращения.** Первая
 * половина выполняется, вторая — нет, и §22.15 показал, что дело не в числах
 * яруса: карта MAP-Elites нашла две настройки из сорока шести, где павшие
 * не мельче дошедших, и обе непроходимые.
 *
 * Откуда берётся разрыв, видно из того, чем меряется глубина. Это самая
 * дальняя точка забега (`maxBack`). У дошедшего она обрывается провиантом
 * или рюкзаком — то есть на своём пределе; у павшего — стычкой. Пока стычки
 * стоят по глубокой части ровно, средняя гибель приходится раньше среднего
 * предела, и разрыв отрицателен **по построению**. Выправить его можно
 * только одним: **гибель обязана сгущаться ко дну** — туда, куда доходят
 * не все.
 *
 * Прибор перебирает не силу одного рычага, а **форму** нескольких, на одних
 * и тех же сидах:
 *
 *   1. `подъём` — уровень тела растёт с глубиной комнаты линейно. Ровно то,
 *      что §15 обещает формулой `урон = база × (1 + 0.06 × глубина)`,
 *      которой в коде нет; уровнем это делается той же линейкой, что и весь
 *      бестиарий (§22.6), и видно игроку в подписи боя.
 *   2. `ступень` — мелкая часть остаётся как есть, тела глубокой доли
 *      получают прибавку разом. Отличается от подъёма тем, что не трогает
 *      вход: у входа ярус обязан оставаться тем же, иначе §15 «учит, что бой
 *      дёшев» перестаёт работать на нулевом ярусе.
 *   3. `страж` — прибавку получает **одно** самое глубокое тело. Дно
 *      охраняется, остальная локация не меняется вовсе.
 *   4. `полоса` — тела сдвигаются глубже: всё, что мельче доли, переносится
 *      в глубокую часть. Это перепроверка `ENEMY_DEPTH_SHARE` (§11.3),
 *      подобранной ещё до пошагового боя.
 *
 * Прибор ничего не меняет в игре: локация правится после генерации, на копии.
 * Выбор рычага и значения — отдельное решение, и делается оно по этой таблице.
 *
 * Запуск: npm run depth
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { TIER_ENEMY_LEVEL, TIER_HERO_LEVEL, TIER_KITCHEN_GATE } from '../src/sim/balance';
import { enemyStats } from '../src/sim/enemies';
import { generateLocation } from '../src/sim/generate';
import { referenceLoadout } from '../src/sim/heroes';
import { idx } from '../src/sim/grid';
import { locationDepth } from '../src/sim/raid';
import type { Enemy, GameLocation, Tier } from '../src/sim/types';

/** Забегов на точку. Столько же, сколько у `npm run measure`: вердикт §11.3
 *  читается его линейкой, и мельче выборка тут не годится. */
const RUNS = 300;
const TIERS: readonly Tier[] = [0, 1, 2, 3];
/** Ниже этой доли успеха ярус перестаёт быть лестницей и становится стеной.
 *  Лечить одно правило ценой другого нельзя. */
const MIN_SUCCESS = 0.5;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const pp = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)} п.п.`;

/* ---------- геометрия глубины ---------- */

/** Доля глубины клетки: у входа ноль, у самой дальней точки единица. Та же
 *  величина, которой меряется глубина забега, — иначе рычаг и вердикт
 *  считали бы разное. */
function depthOf(loc: GameLocation, x: number, z: number, deepest: number): number {
  const back = loc.backSteps[idx(loc.size, Math.round(x), Math.round(z))] ?? 0;
  return Math.min(1, Math.max(0, back / Math.max(1, deepest)));
}

/** Тело с назначенным уровнем: стойкость пересчитывается той же таблицей,
 *  что и в генераторе, иначе уровень будет в подписи, но не в бою. */
const atLevel = (e: Enemy, level: number): Enemy => ({
  ...e,
  level: Math.max(1, level),
  hp: enemyStats(e.kind, Math.max(1, level)).hp,
});

/** Свободные клетки, отсортированные от дна ко входу. Тем же порядком
 *  их раскладывает генератор. */
function deepCells(loc: GameLocation): { x: number; z: number; back: number }[] {
  const out: { x: number; z: number; back: number }[] = [];
  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      const i = idx(loc.size, x, z);
      if (loc.blocked[i]) continue;
      const back = loc.backSteps[i] ?? -1;
      if (back < 0) continue;
      out.push({ x, z, back });
    }
  }
  return out.sort((a, b) => b.back - a.back);
}

/* ---------- рычаги ---------- */

interface Lever {
  readonly name: string;
  readonly apply: (loc: GameLocation, tier: Tier) => GameLocation;
}

/** Уровень растёт с глубиной комнаты линейно: `+k` у самого дна. */
const ramp = (k: number): Lever => ({
  name: `подъём +${k}`,
  apply: (loc, tier) => {
    const deepest = locationDepth(loc);
    const base = TIER_ENEMY_LEVEL[tier];
    return {
      ...loc,
      enemies: loc.enemies.map((e) =>
        atLevel(e, base + Math.round(k * depthOf(loc, e.x, e.z, deepest))),
      ),
    };
  },
});

/** Ступень: тела глубже доли `from` получают `+k`, остальные не меняются. */
const step = (from: number, k: number): Lever => ({
  name: `ступень ${Math.round(from * 100)}%+${k}`,
  apply: (loc, tier) => {
    const deepest = locationDepth(loc);
    const base = TIER_ENEMY_LEVEL[tier];
    return {
      ...loc,
      enemies: loc.enemies.map((e) =>
        depthOf(loc, e.x, e.z, deepest) >= from ? atLevel(e, base + k) : e,
      ),
    };
  },
});

/** Страж: прибавку получает одно самое глубокое тело. */
const guard = (k: number): Lever => ({
  name: `страж +${k}`,
  apply: (loc, tier) => {
    if (loc.enemies.length === 0) return loc;
    const deepest = locationDepth(loc);
    let best = 0;
    loc.enemies.forEach((e, i) => {
      if (depthOf(loc, e.x, e.z, deepest) > depthOf(loc, loc.enemies[best]!.x, loc.enemies[best]!.z, deepest)) {
        best = i;
      }
    });
    const base = TIER_ENEMY_LEVEL[tier];
    return {
      ...loc,
      enemies: loc.enemies.map((e, i) => (i === best ? atLevel(e, base + k) : e)),
    };
  },
});

/**
 * Страж дна: самое глубокое тело **переносится на дно** и получает прибавку.
 *
 * Отличие от `страж` принципиальное, и его показал первый прогон: тела живут
 * в глубокой доле, но дно локации — самая дальняя точка — часто пусто, а бот
 * до него и не доходит (возврат на 74% глубины у нулевого яруса). Прибавка
 * самому глубокому из имеющихся усиливает встречу там, где ходят все;
 * прибавка на дне усиливает её там, куда доходят не все, — а правило §11.3
 * требует ровно этого.
 */
const bottom = (k: number): Lever => ({
  name: `страж дна +${k}`,
  apply: (loc, tier) => {
    if (loc.enemies.length === 0) return loc;
    const cells = deepCells(loc);
    const spot = cells[0];
    if (spot === undefined) return loc;
    const deepest = locationDepth(loc);
    let best = 0;
    loc.enemies.forEach((e, i) => {
      const cur = depthOf(loc, e.x, e.z, deepest);
      const held = depthOf(loc, loc.enemies[best]!.x, loc.enemies[best]!.z, deepest);
      if (cur > held) best = i;
    });
    const base = TIER_ENEMY_LEVEL[tier];
    return {
      ...loc,
      enemies: loc.enemies.map((e, i) =>
        i === best
          ? { ...atLevel(e, base + k), x: spot.x, z: spot.z, prevX: spot.x, prevZ: spot.z }
          : e,
      ),
    };
  },
});

/**
 * Полоса: тела мельче доли `from` переносятся в глубокую часть. Перепроверка
 * `ENEMY_DEPTH_SHARE`, подобранной ещё до пошагового боя.
 *
 * Перенос идёт на свободные клетки от дна и не занимает клетку находки:
 * генератор этого тоже не делает, и опыт обязан отличаться от игры ровно
 * одним, а не двумя.
 */
const band = (from: number): Lever => ({
  name: `полоса ${Math.round(from * 100)}%`,
  apply: (loc) => {
    const deepest = locationDepth(loc);
    const busy = new Set<string>([
      ...loc.containers.map((c) => `${c.x},${c.z}`),
      ...loc.enemies.map((e) => `${Math.round(e.x)},${Math.round(e.z)}`),
    ]);
    const spots = deepCells(loc).filter(
      (c) => c.back / Math.max(1, deepest) >= from && !busy.has(`${c.x},${c.z}`),
    );
    let next = 0;
    return {
      ...loc,
      enemies: loc.enemies.map((e) => {
        if (depthOf(loc, e.x, e.z, deepest) >= from) return e;
        const spot = spots[next++];
        if (spot === undefined) return e;
        return { ...e, x: spot.x, z: spot.z, prevX: spot.x, prevZ: spot.z };
      }),
    };
  },
});

/** Сочетание: сперва сдвинуть полосу, потом поставить ступень. */
const both = (from: number, k: number): Lever => ({
  name: `полоса ${Math.round(from * 100)}% + ступень +${k}`,
  apply: (loc, tier) => step(from, k).apply(band(from).apply(loc, tier), tier),
});

/** Полоса плюс страж дна: мелкие тела уходят вглубь, дно охраняется. */
const bandBottom = (from: number, k: number): Lever => ({
  name: `полоса ${Math.round(from * 100)}% + страж дна +${k}`,
  apply: (loc, tier) => bottom(k).apply(band(from).apply(loc, tier), tier),
});

const LEVERS: readonly Lever[] = [
  { name: 'как есть', apply: (loc) => loc },
  ramp(2),
  step(0.85, 4),
  guard(4),
  band(0.7),
  both(0.7, 2),
  bottom(2),
  bottom(4),
  bandBottom(0.7, 2),
  bandBottom(0.7, 4),
];

/* ---------- замер ---------- */

interface Result {
  readonly success: number;
  readonly failDepth: number;
  readonly okDepth: number;
  readonly haul: number;
}

function measure(tier: Tier, lever: Lever): Result {
  let ok = 0;
  let okDepth = 0;
  let failDepth = 0;
  let fails = 0;
  let haul = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const loc = lever.apply(generateLocation(seed, tier, 1), tier);
    const r = playRaid(
      {
        seed,
        tier,
        kitchenLevel: TIER_KITCHEN_GATE[tier],
        storageLevel: tier + 1,
        loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
        loc,
      },
      POLICIES.cautious,
      mulberry32(seed),
    );
    haul += r.carriedTotal;
    const depth = r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    if (r.status === 'evacuated') {
      ok += 1;
      okDepth += depth;
    } else {
      fails += 1;
      failDepth += depth;
    }
  }
  return {
    success: ok / RUNS,
    okDepth: ok > 0 ? okDepth / ok : 0,
    failDepth: fails > 0 ? failDepth / fails : 0,
    haul: haul / RUNS,
  };
}

console.log('Глубина провала: перебор форм рычага со стороны боя\n');
console.log(`${RUNS} вылазок на точку, сиды общие, бот-осторожный`);
console.log('Правило §11.3: провал глубже 50% И не мельче возвращения.\n');

const table = LEVERS.map((lever) => ({
  lever,
  per: TIERS.map((tier) => ({ tier, r: measure(tier, lever) })),
}));

for (const { lever, per } of table) {
  const holds = per.filter((x) => x.r.failDepth > 0.5 && x.r.failDepth >= x.r.okDepth).length;
  const playable = per.every((x) => x.r.success >= MIN_SUCCESS);
  console.log(`— ${lever.name} — по правилу ${holds} из ${TIERS.length}, проходим: ${playable ? 'да' : 'нет'}`);
  console.log('  ярус   успех   провал на   возврат на   разница   заход');
  for (const { tier, r } of per) {
    console.log(
      `  ${String(tier).padStart(4)}${pct(r.success).padStart(8)}${pct(r.failDepth).padStart(12)}` +
        `${pct(r.okDepth).padStart(13)}${pp(r.failDepth - r.okDepth).padStart(12)}${r.haul.toFixed(1).padStart(8)}`,
    );
  }
  console.log('');
}

/* ---------- вердикт ---------- */

console.log('══ Свод ══\n');
console.log('рычаг                          по правилу   худшая разница   успех   заход   проходим');
const summary = table.map(({ lever, per }) => {
  const holds = per.filter((x) => x.r.failDepth > 0.5 && x.r.failDepth >= x.r.okDepth).length;
  const worst = Math.min(...per.map((x) => x.r.failDepth - x.r.okDepth));
  const playable = per.every((x) => x.r.success >= MIN_SUCCESS);
  const success = mean(per.map((x) => x.r.success));
  const haul = mean(per.map((x) => x.r.haul));
  return { name: lever.name, holds, worst, playable, success, haul };
});
for (const s of summary) {
  console.log(
    `${s.name.padEnd(30)}${`${s.holds} из ${TIERS.length}`.padStart(12)}${pp(s.worst).padStart(17)}` +
      `${pct(s.success).padStart(8)}${s.haul.toFixed(1).padStart(8)}${(s.playable ? 'да' : 'нет').padStart(11)}`,
  );
}

/* ---------- чем обрывается глубина дошедшего ---------- */

/**
 * Последний блок отвечает на возражение, без которого вердикт читается
 * неверно. Глубина дошедшего — это точка, где он **сам** повернул, и повернул
 * он по своей политике: осторожный бот уходит, набрав 60% рюкзака
 * (`POLICIES.cautious.bagStop`). Если разрыв держится только на этой
 * привычке, то чинить надо не бой, а то, что обрывает заход.
 *
 * Поэтому та же игра меряется тремя политиками сразу. Расходятся глубины —
 * значит предел ставит политика; совпадают — значит игра.
 */
console.log('\n\n══ Чем обрывается глубина дошедшего ══\n');
console.log('политика     ярус   успех   провал на   возврат на   разница');
for (const name of ['cautious', 'balanced', 'greedy'] as const) {
  for (const tier of TIERS) {
    let ok = 0;
    let okDepth = 0;
    let failDepth = 0;
    let fails = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = playRaid(
        {
          seed,
          tier,
          kitchenLevel: TIER_KITCHEN_GATE[tier],
          storageLevel: tier + 1,
          loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
          loc: generateLocation(seed, tier, 1),
        },
        POLICIES[name],
        mulberry32(seed),
      );
      const depth = r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
      if (r.status === 'evacuated') {
        ok += 1;
        okDepth += depth;
      } else {
        fails += 1;
        failDepth += depth;
      }
    }
    const okD = ok > 0 ? okDepth / ok : 0;
    const failD = fails > 0 ? failDepth / fails : 0;
    console.log(
      `${name.padEnd(12)}${String(tier).padStart(4)}${pct(ok / RUNS).padStart(8)}` +
        `${pct(failD).padStart(12)}${pct(okD).padStart(13)}${pp(failD - okD).padStart(12)}`,
    );
  }
}

const winners = summary.filter((s) => s.holds === TIERS.length && s.playable);
const moved = summary.filter((s) => s.worst > summary[0]!.worst + 0.02);
console.log('');
if (winners.length > 0) {
  const best = winners.reduce((a, b) => (b.haul > a.haul ? b : a));
  console.log(
    `✓ Рычаг найден: «${best.name}» выполняет правило §11.3 на всех ярусах\n` +
      `  при среднем успехе ${pct(best.success)} и заходе ${best.haul.toFixed(1)}.\n` +
      '  Это кандидат в §15, а не решение: лестницу проверяет `npm run measure`,\n' +
      '  петлю — `npm run verify`.',
  );
} else if (moved.length > 0) {
  const best = moved.reduce((a, b) => (b.worst > a.worst ? b : a));
  console.log(
    `⚠ Правило не закрывается ни одной формой, но разрыв двигается: лучшее —\n` +
      `  «${best.name}», худшая разница ${pp(best.worst)} против ${pp(summary[0]!.worst)}\n` +
      '  у нынешней игры. Значит направление верное, а силы не хватает —\n' +
      '  или мешает то, что глубина дошедшего обрывается позже по построению.',
  );
} else {
  console.log(
    '⚠ Ни одна форма рычага разрыв не сдвинула. Гибель ко дну не сгущается\n' +
      '  ничем из перечисленного, и вторая половина правила §11.3 держится\n' +
      '  не за бой, а за то, чем меряется глубина.',
  );
}
