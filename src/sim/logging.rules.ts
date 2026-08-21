/**
 * Правила вырубки (§13.3). Проверяется не то, что дерево падает, а два
 * свойства, без которых механику пришлось бы отменять:
 *
 * 1. **Кромка остаётся стеной.** Рубка по краю бесконечна, и ровно поэтому
 *    она обязана быть неспособна открыть проход: иначе «уйти с поляны нельзя»
 *    (§12.1) держалось бы на том, что игроку не пришло в голову рубить.
 * 2. **Рубка медленнее подбора.** Бесконечный источник, который ещё и быстрее
 *    конечного, отменяет собранное кольцо брусков и пролог заодно. Это
 *    не обещание, а замер на шестидесяти сидах.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { distanceField, idx } from './grid';
import {
  CHOP_SECONDS,
  CHOP_SWINGS,
  CHOP_WOOD,
  aimChop,
  chopBlock,
  fell,
  isEdge,
  startChop,
  stepChop,
  treeAt,
} from './logging';
import {
  CAMP_WOOD,
  firstGladeCell,
  generateGlade,
  gladeFood,
} from './prologue';
import { commandMove, createRaid, stepRaid } from './raid';
import type { Cell, RaidState } from './types';

const dt = 1 / 60;

/**
 * Поляна пролога с включённой рубкой. Рюкзак взят большим намеренно: здесь
 * меряется топор, а не сумка, — её собственные правила лежат в `prologue.rules.ts`.
 */
const glade = (seed = 1, capacity = 99): RaidState =>
  createRaid({
    seed,
    tier: 0,
    kitchenLevel: 1,
    storageLevel: 1,
    loc: generateGlade(seed),
    food: gladeFood(),
    capacity,
    evacOpen: false,
    containerFood: 0,
    hunger: false,
    logging: true,
  });

/** Первое дерево, к которому можно встать вплотную. */
function reachableTree(state: RaidState, edge: boolean): { tree: Cell; stand: Cell } {
  const { loc } = state;
  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      const tree = { x, z };
      if (!treeAt(loc, tree) || isEdge(loc, tree) !== edge) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const stand = { x: x + dx, z: z + dz };
          if (stand.x < 0 || stand.z < 0 || stand.x >= loc.size || stand.z >= loc.size) continue;
          if (loc.blocked[idx(loc.size, stand.x, stand.z)]) continue;
          return { tree, stand };
        }
      }
    }
  }
  throw new Error('на поляне не нашлось дерева, к которому можно подойти');
}

/** Поставить героя на клетку: рубит тот, кто дошёл. */
function stand(state: RaidState, cell: Cell): void {
  state.hero.x = cell.x;
  state.hero.z = cell.z;
  state.hero.prevX = cell.x;
  state.hero.prevZ = cell.z;
  state.path = [];
}

/** Срубить дерево от начала до конца. Возвращает секунды работы. */
function chopDown(state: RaidState, tree: Cell): { seconds: number; swings: number } {
  const chop = startChop(tree);
  let seconds = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const step = stepChop(state, chop, dt);
    seconds += dt;
    if (step.stopped !== null) throw new Error(`рубка прервана: ${step.stopped}`);
    if (step.felled) break;
  }
  return { seconds, swings: chop.swings };
}

describe('Вырубка: кромка карты', () => {
  test('сколько ни руби кромку, с поляны не уйти', () => {
    for (const seed of [0, 5, 17]) {
      const state = glade(seed);
      const { loc } = state;
      // Каждую клетку рамки рубим трижды — больше, чем нужно любому игроку,
      // и заведомо больше одного раза.
      for (let pass = 0; pass < 3; pass++) {
        for (let z = 0; z < loc.size; z++) {
          for (let x = 0; x < loc.size; x++) {
            const cell = { x, z };
            if (!isEdge(loc, cell)) continue;
            stand(state, cell);
            state.bagTotal = 0;
            state.bag.wood = 0;
            fell(state, cell);
          }
        }
      }
      for (let i = 0; i < loc.size; i++) {
        for (const cell of [
          { x: i, z: 0 },
          { x: i, z: loc.size - 1 },
          { x: 0, z: i },
          { x: loc.size - 1, z: i },
        ]) {
          assert.equal(
            loc.blocked[idx(loc.size, cell.x, cell.z)],
            1,
            `сид ${seed}: рубка вскрыла кромку в ${cell.x},${cell.z}`,
          );
        }
      }
    }
  });

  test('на кромке рубка доступна вечно: одно и то же дерево даёт дерево снова', () => {
    const state = glade(3);
    const { tree, stand: spot } = reachableTree(state, true);
    stand(state, spot);
    for (let i = 1; i <= 5; i++) {
      assert.equal(chopBlock(state, tree), 'ok', `на ${i}-й раз кромка перестала рубиться`);
      chopDown(state, tree);
      assert.equal(state.bag.wood, i * CHOP_WOOD, `на ${i}-й раз дерева не прибавилось`);
    }
  });
});

describe('Вырубка: дерево внутри поляны', () => {
  test('падает один раз и оставляет после себя проход', () => {
    const state = glade(4);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    chopDown(state, tree);
    assert.equal(state.bag.wood, CHOP_WOOD, 'брусок не попал в сумку');
    assert.ok(!treeAt(state.loc, tree), 'дерево срублено, а клетка занята');
    assert.equal(chopBlock(state, tree), 'no-tree', 'по пустой клетке снова рубят');
  });

  test('просека пересчитывает путь назад, а не оставляет старый', () => {
    const state = glade(9);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    chopDown(state, tree);
    const fresh = distanceField(state.loc.size, state.loc.blocked, state.loc.evac);
    for (let i = 0; i < fresh.length; i++) {
      assert.equal(state.loc.backSteps[i], fresh[i], `путь назад разошёлся в клетке ${i}`);
    }
  });
});

describe('Вырубка: когда нельзя', () => {
  test('рубят вплотную, а не через поляну', () => {
    const state = glade(6);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, { x: spot.x, z: spot.z });
    assert.equal(chopBlock(state, tree), 'ok');
    stand(state, { x: spot.x + 3, z: spot.z });
    assert.equal(chopBlock(state, tree), 'far');
  });

  test('до дерева под рукой герой не делает лишнего шага', () => {
    const state = glade(8);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    const chop = aimChop(state, tree);
    assert.equal(state.path.length, 0, 'герой пошёл к дереву, у которого стоит');
    assert.equal(stepChop(state, chop, dt).stopped, null, 'рубка не началась на месте');
  });

  test('до дальнего дерева герой идёт сам, тем же жестом', () => {
    const state = glade(8);
    const { tree } = reachableTree(state, false);
    stand(state, state.loc.evac);
    aimChop(state, tree);
    assert.ok(state.path.length > 0, 'по тапу в дерево герой не двинулся');
  });

  test('полный рюкзак не рубит: дерево некуда класть', () => {
    const state = glade(6, 1);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    state.bagTotal = state.capacity;
    assert.equal(chopBlock(state, tree), 'bag');
  });

  test('в вылазке лес не рубится: стена там камень', () => {
    const state = createRaid({ seed: 2, tier: 1, kitchenLevel: 2, storageLevel: 2 });
    for (let z = 0; z < state.loc.size; z++) {
      for (let x = 0; x < state.loc.size; x++) {
        if (!state.loc.blocked[idx(state.loc.size, x, z)]) continue;
        assert.equal(chopBlock(state, { x, z }), 'no-forest');
        return;
      }
    }
  });

  test('дерево падает за десять замахов, а не за один тик', () => {
    const state = glade(11);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    const { seconds, swings } = chopDown(state, tree);
    assert.equal(swings, CHOP_SWINGS, 'замахов вышло не столько, сколько обещано');
    assert.ok(
      Math.abs(seconds - CHOP_SECONDS) < 0.1,
      `дерево падало ${seconds.toFixed(2)} с вместо ${CHOP_SECONDS}`,
    );
  });

  test('рубка платится временем, а не провиантом', () => {
    const state = glade(12);
    const { tree, stand: spot } = reachableTree(state, false);
    stand(state, spot);
    const before = state.food;
    chopDown(state, tree);
    assert.equal(state.food, before, 'топор потратил провиант — шагов при этом не было');
  });
});

describe('Вырубка: медленнее подбора', () => {
  /** Жадный подбор: от ближайшего бруска к ближайшему — то же, что кольцо. */
  function gather(seed: number, need: number): number {
    const state = glade(seed);
    let t = 0;
    while (t < 240 && state.bag.wood < need) {
      if (state.path.length === 0) {
        const cell = firstGladeCell(state.loc, state.hero);
        if (cell === null) break;
        commandMove(state, cell);
        if (state.path.length === 0) break;
      }
      stepRaid(state, dt, false, 0);
      t += dt;
    }
    return state.bag.wood >= need ? t : Infinity;
  }

  /** Жадная рубка: к ближайшему дереву, к которому можно встать, и валим. */
  function chopping(seed: number, need: number): number {
    const state = glade(seed);
    let t = 0;
    while (t < 600 && state.bag.wood < need) {
      let best: Cell | null = null;
      let bestDist = Infinity;
      for (let z = 0; z < state.loc.size; z++) {
        for (let x = 0; x < state.loc.size; x++) {
          const tree = { x, z };
          if (!treeAt(state.loc, tree)) continue;
          let open = false;
          for (let dz = -1; dz <= 1 && !open; dz++) {
            for (let dx = -1; dx <= 1 && !open; dx++) {
              const nx = x + dx;
              const nz = z + dz;
              if (nx < 0 || nz < 0 || nx >= state.loc.size || nz >= state.loc.size) continue;
              if (!state.loc.blocked[idx(state.loc.size, nx, nz)]) open = true;
            }
          }
          if (!open) continue;
          const d = Math.hypot(state.hero.x - x, state.hero.z - z);
          if (d < bestDist) {
            bestDist = d;
            best = tree;
          }
        }
      }
      if (best === null) break;
      commandMove(state, best);
      const chop = startChop(best);
      for (let i = 0; i < 60 * 120; i++) {
        stepRaid(state, dt, false, 0);
        const step = stepChop(state, chop, dt);
        t += dt;
        if (step.felled || step.stopped !== null) break;
      }
    }
    return state.bag.wood >= need ? t : Infinity;
  }

  /**
   * Замер на 60 сидах: подбор трёх брусков — 6,8–10,2 с (в среднем 8,1),
   * рубка тех же трёх — 16,4–28,2 (23,2). Худший запас рубки над подбором
   * 7,1 секунды, и десять замахов на дерево (`CHOP_SWINGS`) взяты отсюда,
   * а не назначены: на восьми запас ужимался до двух секунд, то есть
   * до дрожания генератора.
   */
  test('вырубить лагерь дольше, чем собрать его с земли — на каждом сиде', () => {
    let worst = Infinity;
    for (let seed = 0; seed < 60; seed++) {
      const picked = gather(seed, CAMP_WOOD);
      const chopped = chopping(seed, CAMP_WOOD);
      assert.ok(Number.isFinite(picked), `сид ${seed}: бруски не собрались`);
      assert.ok(Number.isFinite(chopped), `сид ${seed}: лес не срубился`);
      assert.ok(
        chopped > picked,
        `сид ${seed}: рубка ${chopped.toFixed(1)} с обогнала подбор ${picked.toFixed(1)} с`,
      );
      worst = Math.min(worst, chopped - picked);
    }
    // Запас, а не просто «больше»: разница в полсекунды означала бы, что
    // механика держится на округлении.
    assert.ok(worst > 4, `худший запас рубки над подбором ${worst.toFixed(1)} с`);
  });
});
