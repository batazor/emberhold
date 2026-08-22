/**
 * Правила валунов (§13.4). Проверяется не то, что камень разбивается,
 * а четыре свойства, без которых механику пришлось бы отменять:
 *
 * 1. **Валун не занимает клетку.** Он лежит на полу, по нему ходят, и путь
 *    назад от него не зависит. Стоит этому сломаться — и разбитый камень
 *    станет просекой (§13.3), то есть будет открывать проход там, где
 *    локация обещала стену.
 * 2. **Добыча медленнее подбора.** Тот же довод, что у вырубки: источник,
 *    который платится временем и при этом обгоняет находки, отменяет
 *    находки. Это не обещание, а замер на шестидесяти сидах.
 * 3. **Валун конечен.** Разбитый не возвращается нигде: бесконечна только
 *    кромка леса, и это её отдельное свойство (§13.3).
 * 4. **Лежат там, где обещано.** Список мест — решение (`STONES`), и молча
 *    протухает он одинаково легко в обе стороны: камень на поляне пролога
 *    ломает первые три минуты, отсутствие камня в вылазке отменяет механику.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { campStones, createCamp } from './camp';
import { campBlocked } from './campWalk';
import { CASTLE_CELL } from './castle';
import { generateCastleSite } from './castleSite';
import { distanceField, idx } from './grid';
import { generateLocation } from './generate';
import { generateGlade } from './prologue';
import { generateGraveSite } from './graveSite';
import { LOOT_SHARE } from './resources';
import {
  MINE_SECONDS,
  MINE_STONE_AVG,
  MINE_STONE_MAX,
  MINE_STONE_MIN,
  MINE_SWINGS,
  mineYield,
  STONES,
  aimMine,
  mineBlock,
  startMine,
  stepMine,
  stoneAt,
} from './stones';
import { commandMove, createRaid, stepRaid } from './raid';
import type { Cell, RaidState, Tier } from './types';
import type { Stone } from './stones';

const dt = 1 / 60;

/**
 * Вылазка без противников: меряется кайло, а не бой. Провиант и рюкзак взяты
 * с запасом по той же причине — их собственные правила лежат в другом месте.
 */
const dig = (seed: number, tier: Tier = 1): RaidState =>
  createRaid({
    seed,
    tier,
    kitchenLevel: 6,
    storageLevel: 6,
    loc: generateLocation(seed, tier, 1, 0),
  });

/** Поставить героя на клетку: работает тот, кто дошёл. */
function stand(state: RaidState, cell: Cell): void {
  state.hero.x = cell.x;
  state.hero.z = cell.z;
  state.hero.prevX = cell.x;
  state.hero.prevZ = cell.z;
  state.path = [];
}

/** Первый валун, к которому можно встать вплотную, и место, откуда бьют. */
function reachableStone(state: RaidState): { stone: Stone; spot: Cell } {
  const { loc } = state;
  for (const stone of loc.stones) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const spot = { x: stone.x + dx, z: stone.z + dz };
        if (spot.x < 0 || spot.z < 0 || spot.x >= loc.size || spot.z >= loc.size) continue;
        if (loc.blocked[idx(loc.size, spot.x, spot.z)]) continue;
        return { stone, spot };
      }
    }
  }
  throw new Error('в локации не нашлось валуна, к которому можно подойти');
}

/** Разбить валун от начала до конца. Возвращает секунды работы. */
function mineDown(state: RaidState, cell: Cell): { seconds: number; swings: number } {
  const work = startMine(cell);
  let seconds = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const step = stepMine(state, work, dt);
    seconds += dt;
    if (step.stopped !== null) throw new Error(`добыча прервана: ${step.stopped}`);
    if (step.taken) break;
  }
  return { seconds, swings: work.swings };
}

describe('Валуны: где лежат', () => {
  test('в вылазке их больше всего, и вглубь больше', () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const counts = [1, 2, 3, 4, 5].map((seed) => generateLocation(seed, tier, 1, 0).stones.length);
      const want = STONES.raid[tier]!;
      for (const n of counts) {
        // Разнос может не дать положить все на тесной локации — но не половину.
        assert.ok(n > want / 2, `ярус ${tier}: валунов ${n} из ${want}`);
        assert.ok(n <= want, `ярус ${tier}: валунов ${n} больше обещанных ${want}`);
      }
      if (tier > 0) {
        assert.ok(
          STONES.raid[tier]! > STONES.raid[tier - 1]!,
          `ярус ${tier} не богаче предыдущего — глубина перестала расти целиком`,
        );
      }
    }
  });

  test('на поляне пролога и на кладбище их нет', () => {
    assert.deepEqual(generateGlade(7).stones, [], 'поляна: в прологе жест ровно один');
    assert.deepEqual(generateGraveSite(7).loc.stones, [], 'кладбище: это прогулка');
  });

  test('у замка они в поле, а не во дворе', () => {
    for (const seed of [1, 2, 3, 11, 42]) {
      const site = generateCastleSite(seed);
      assert.ok(site.loc.stones.length > STONES.castle / 2, `сид ${seed}: у замка пусто`);
      const yard = new Set(site.castle.yard.map((s) => `${s.x}:${s.z}`));
      for (const stone of site.loc.stones) {
        const plan = {
          x: Math.floor((stone.x - site.at.x) / CASTLE_CELL),
          z: Math.floor((stone.z - site.at.z) / CASTLE_CELL),
        };
        assert.ok(!yard.has(`${plan.x}:${plan.z}`), `сид ${seed}: валун во дворе замка`);
      }
    }
  });

  test('в лагере они есть, и все — на площадке', () => {
    const camp = createCamp();
    assert.ok(camp.stones.length > STONES.camp / 2, 'лагерь начинается без камней');
    for (const stone of camp.stones) {
      assert.ok(stone.x >= 0 && stone.z >= 0 && stone.x < 10 && stone.z < 10, 'валун вне площадки');
    }
    // Раскладка одна на всех: лагерь у всех начинается одинаковым.
    assert.deepEqual(campStones(), camp.stones);
  });

  test('валун не мешает ни ходьбе по лагерю, ни стройке', () => {
    const camp = createCamp();
    const blocked = campBlocked(camp);
    for (const stone of camp.stones) {
      assert.equal(blocked[idx(10, stone.x, stone.z)] ?? 0, 0, 'валун занял клетку лагеря');
    }
  });

  test('локация выводится из сида вместе с камнями', () => {
    for (const seed of [3, 19, 77]) {
      const a = generateLocation(seed, 2, 1, 0).stones;
      const b = generateLocation(seed, 2, 1, 0).stones;
      assert.deepEqual(a, b, `сид ${seed}: валуны разошлись между двумя сборками`);
    }
  });

  test('валун не ложится на находку и не занимает клетку', () => {
    for (let seed = 0; seed < 30; seed++) {
      const loc = generateLocation(seed, 2, 1, 0);
      for (const stone of loc.stones) {
        const at = idx(loc.size, stone.x, stone.z);
        assert.equal(loc.blocked[at], 0, `сид ${seed}: валун в стене`);
        assert.ok(
          !loc.containers.some((c) => c.x === stone.x && c.z === stone.z),
          `сид ${seed}: валун лёг на находку — тап стал бы спорным`,
        );
      }
    }
  });

  test('путь назад считается так, будто валунов нет', () => {
    const loc = generateLocation(5, 1, 1, 0);
    const fresh = distanceField(loc.size, loc.blocked, loc.evac);
    for (let i = 0; i < fresh.length; i++) {
      assert.equal(loc.backSteps[i], fresh[i], `путь назад разошёлся в клетке ${i}`);
    }
  });
});

describe('Валуны: работа', () => {
  test('валун разбивается за положенные замахи, а не за один тик', () => {
    const state = dig(11);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    const { seconds, swings } = mineDown(state, stone);
    assert.equal(swings, MINE_SWINGS, 'замахов вышло не столько, сколько обещано');
    assert.ok(
      Math.abs(seconds - MINE_SECONDS) < 0.1,
      `валун разбивался ${seconds.toFixed(2)} с вместо ${MINE_SECONDS}`,
    );
    assert.equal(state.bag.stone, mineYield(stone), 'камни не попали в сумку');
    assert.ok(
      state.bag.stone >= MINE_STONE_MIN && state.bag.stone <= MINE_STONE_MAX,
      `валун отдал ${state.bag.stone} камней вне вилки ${MINE_STONE_MIN}–${MINE_STONE_MAX}`,
    );
  });

  test('разбитый валун не возвращается', () => {
    const state = dig(12);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    mineDown(state, stone);
    assert.equal(stoneAt(state.loc.stones, stone), null, 'валун цел после того, как его разбили');
    assert.equal(mineBlock(state.hero, state.loc.stones, stone, true), 'gone');
  });

  test('добыча платится временем, а не провиантом', () => {
    const state = dig(13);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    const before = state.food;
    mineDown(state, stone);
    assert.equal(state.food, before, 'кайло потратило провиант — шагов при этом не было');
  });

  test('бьют вплотную, а не через зал', () => {
    const state = dig(14);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    assert.equal(mineBlock(state.hero, state.loc.stones, stone, true), 'ok');
    stand(state, { x: spot.x + 4, z: spot.z });
    assert.equal(mineBlock(state.hero, state.loc.stones, stone, true), 'far');
  });

  test('полный рюкзак не добывает: камень некуда класть', () => {
    const state = dig(15);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    state.bagTotal = state.capacity;
    assert.equal(mineBlock(state.hero, state.loc.stones, stone, false), 'bag');
    assert.equal(stepMine(state, startMine(stone), dt).stopped, 'bag');
  });

  test('до валуна под рукой герой не делает лишнего шага', () => {
    const state = dig(16);
    const { stone, spot } = reachableStone(state);
    stand(state, spot);
    const work = aimMine(state, stone, commandMove);
    assert.equal(state.path.length, 0, 'герой пошёл к валуну, у которого стоит');
    assert.equal(stepMine(state, work, dt).stopped, null, 'работа не началась на месте');
  });

  test('до дальнего валуна герой идёт сам, тем же жестом', () => {
    const state = dig(16);
    const { stone } = reachableStone(state);
    stand(state, state.loc.evac);
    aimMine(state, stone, commandMove);
    assert.ok(state.path.length > 0, 'по тапу в валун герой не двинулся');
  });
});

describe('Валуны: медленнее подбора', () => {
  /** Жадный подбор: от ближайшей каменной находки к следующей. */
  function gather(seed: number, need: number): number {
    const state = dig(seed);
    let t = 0;
    while (t < 240 && state.bag.stone < need) {
      const left = state.loc.containers.filter((c) => !c.opened && c.kind === 'stone');
      if (left.length === 0) break;
      const near = left.reduce((a, b) =>
        Math.hypot(state.hero.x - a.x, state.hero.z - a.z)
        <= Math.hypot(state.hero.x - b.x, state.hero.z - b.z) ? a : b,
      );
      if (!commandMove(state, near)) break;
      while (t < 240 && state.path.length > 0) {
        stepRaid(state, dt, false, 0);
        t += dt;
      }
    }
    return state.bag.stone >= need ? t : Infinity;
  }

  /** Жадная добыча: к ближайшему валуну — и десять замахов. */
  function mining(seed: number, need: number): number {
    const state = dig(seed);
    let t = 0;
    while (t < 600 && state.bag.stone < need) {
      const left = state.loc.stones.filter((s) => !s.taken);
      if (left.length === 0) break;
      const near = left.reduce((a, b) =>
        Math.hypot(state.hero.x - a.x, state.hero.z - a.z)
        <= Math.hypot(state.hero.x - b.x, state.hero.z - b.z) ? a : b,
      );
      const work = aimMine(state, near, commandMove);
      for (let i = 0; i < 60 * 120; i++) {
        stepRaid(state, dt, false, 0);
        const step = stepMine(state, work, dt);
        t += dt;
        if (step.taken || step.stopped !== null) break;
      }
    }
    return state.bag.stone >= need ? t : Infinity;
  }

  /**
   * Замер на шестидесяти сидах яруса 1 без противников. Требование то же,
   * что у топора (§13.3): добыча обязана проигрывать подбору **на каждом
   * сиде**, и с запасом — разница в полсекунды означала бы, что механика
   * держится на округлении.
   *
   * Сиды, где каменных находок не набралось на три единицы, пропускаются:
   * вид добычи выпадает по ярусу (§13), и локация без камня ничего
   * не говорит про кайло.
   */
  test('накопать три камня дольше, чем подобрать их — на каждом сиде', () => {
    let worst = Infinity;
    let counted = 0;
    for (let seed = 0; seed < 60; seed++) {
      const picked = gather(seed, 3);
      if (!Number.isFinite(picked)) continue;
      const mined = mining(seed, 3);
      assert.ok(Number.isFinite(mined), `сид ${seed}: три камня не накопались`);
      assert.ok(
        mined > picked,
        `сид ${seed}: добыча ${mined.toFixed(1)} с обогнала подбор ${picked.toFixed(1)} с`,
      );
      worst = Math.min(worst, mined - picked);
      counted++;
    }
    assert.ok(counted >= 30, `сидов с каменными находками нашлось ${counted} — замер не на чем вести`);
    assert.ok(worst > 4, `худший запас добычи над подбором ${worst.toFixed(1)} с`);
  });

  /**
   * То же требование, но не прогоном, а ценой — той же меркой, которой
   * считаются ограда и стена (`campWalls.rules.ts`, `npm run fence`).
   * Прогон говорит про конкретную локацию, цена — про экономику целиком:
   * пока камень кайлом дороже камня из находки, лишний источник не может
   * стать основным.
   */
  test('камень кайлом дороже камня из находки', () => {
    /** Секунда за находку: замер бота, ярус 0 — 10,2 с на заход, 5,8 находки. */
    const PER_FIND = 10.2 / 5.8;
    const found = PER_FIND / (LOOT_SHARE[0].stone ?? 1);
    const dug = MINE_SECONDS / MINE_STONE_AVG;
    assert.ok(
      dug > found * 2,
      `камень кайлом ${dug.toFixed(1)} с против ${found.toFixed(1)} с находкой — ` +
        'запас меньше двукратного, и кайло становится основным источником',
    );
  });
});
