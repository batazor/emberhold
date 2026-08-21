/**
 * Правила кладбища (§6.1.7, §4). Локация обещает игроку четыре вещи,
 * и все четыре проверяются здесь, а не глазами.
 *
 * Первое: **по ней можно ходить**. Каждая свободная клетка достижима
 * от выхода — рядов могил, отрезавших угол участка, не остаётся.
 *
 * Второе: **войти можно только в проезд**. Ограда обязана быть оградой:
 * если заложить проезд, участок становится недостижим.
 *
 * Третье: **добычи нет, а привидения есть, и они внутри**. Пустая локация
 * и локация с противниками — разные обещания, и карточка карты обещает
 * второе.
 *
 * Четвёртое: **один сид — одно кладбище**. На этом держится §4: точка карты
 * обязана держать форму весь день.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FENCE_CELL } from './fence';
import { FIELD, WOOD, generateGraveSite } from './graveSite';
import { distanceField, idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateGraveSite);

/** Свободных клеток внутри ограды — та же величина, из которой выводится
 *  число привидений. Считается здесь заново: правило, читающее ту же
 *  переменную, что и код, проверяет опечатку, а не решение. */
function freeYardTiles(site: (typeof sites)[number]): number {
  const { loc } = site;
  const span = loc.size - 2 * (WOOD + FIELD);
  let free = 0;
  for (let z = site.at.z; z < site.at.z + span; z++) {
    for (let x = site.at.x; x < site.at.x + span; x++) {
      if (loc.blocked[idx(loc.size, x, z)] === 0) free++;
    }
  }
  return free;
}

describe('Кладбище на карте: по нему ходят', () => {
  test('каждая свободная клетка достижима от выхода', () => {
    for (const site of sites) {
      const { loc } = site;
      let free = 0;
      let reached = 0;
      for (let i = 0; i < loc.size * loc.size; i++) {
        if (loc.blocked[i]) continue;
        free++;
        if (loc.backSteps[i]! >= 0) reached++;
      }
      assert.equal(reached, free, `сид ${loc.seed}: отрезано ${free - reached} клеток из ${free}`);
    }
  });

  test('внутрь можно, и только через проезд', () => {
    for (const site of sites) {
      const { loc, gate } = site;
      // Клетка, где стоит привидение, заведомо внутри ограды: генератор
      // ставит их только во дворе. Берём её как пробу «внутри».
      const inside = site.loc.enemies[0];
      assert.ok(inside !== undefined, `сид ${loc.seed}: на участке пусто`);
      const at = idx(loc.size, inside.x, inside.z);
      assert.ok(loc.backSteps[at]! >= 0, `сид ${loc.seed}: внутрь не пройти`);

      // Заложим проезд и повторим волну: если внутрь всё ещё попасть можно,
      // ограда где-то дырявая, и участок не участок.
      const walled = Uint8Array.from(loc.blocked);
      for (let dz = 0; dz < FENCE_CELL; dz++) {
        for (let dx = 0; dx < FENCE_CELL; dx++) {
          const x = gate.x + dx;
          const z = gate.z + dz;
          if (x < loc.size && z < loc.size) walled[idx(loc.size, x, z)] = 1;
        }
      }
      const closed = distanceField(loc.size, walled, loc.evac);
      assert.ok(
        closed[at]! < 0,
        `сид ${loc.seed}: проезд заложен, а внутрь всё равно попадают — ограда дырявая`,
      );
    }
  });

  test('выход снаружи ограды и на свободной клетке', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.equal(loc.blocked[idx(loc.size, loc.evac.x, loc.evac.z)], 0);
      // Снаружи — значит в поле между лесом и оградой, а не в лесу и не внутри.
      assert.ok(loc.evac.x >= WOOD && loc.evac.z >= WOOD, `сид ${loc.seed}: выход в лесу`);
      assert.ok(
        loc.evac.x < loc.size - WOOD && loc.evac.z < loc.size - WOOD,
        `сид ${loc.seed}: выход в лесу`,
      );
    }
  });

  test('лес держит границу локации: край не вскрывается ни на одном сиде', () => {
    for (const site of sites) {
      const { loc } = site;
      // Пеньки по внутреннему краю проходимы намеренно, поэтому проверяется
      // самый край: он обязан быть стеной целиком.
      for (let i = 0; i < loc.size; i++) {
        for (const [x, z] of [[i, 0], [i, loc.size - 1], [0, i], [loc.size - 1, i]] as const) {
          assert.equal(loc.blocked[idx(loc.size, x, z)], 1, `сид ${loc.seed}: край открыт в ${x},${z}`);
        }
      }
    }
  });

  test('поле между лесом и оградой на месте: участок видно целиком', () => {
    for (const site of sites) {
      assert.ok(site.at.x >= WOOD + FIELD - 1 && site.at.z >= WOOD + FIELD - 1);
    }
  });
});

describe('Кладбище: что в нём есть и чего нет', () => {
  test('добычи нет ни на одном сиде', () => {
    for (const site of sites) assert.equal(site.loc.containers.length, 0);
  });

  /**
   * Проверяется **плотность, а не счёт**. Счёт пережил бы правку размера
   * молча: на вдвое большем участке те же четыре привидения — пустой двор,
   * и правило, написанное числом, об этом не скажет. Инвариант же верен
   * при любом размере участка и переживёт следующую правку.
   */
  test('привидения есть, участок ими не забит, и все они внутри ограды', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.ok(loc.enemies.length >= 2, `сид ${loc.seed}: участок пуст`);
      assert.ok(
        loc.enemies.length <= 6,
        `сид ${loc.seed}: привидений ${loc.enemies.length} — это уже бой, а не прогулка`,
      );
      const free = freeYardTiles(site);
      assert.ok(
        free / loc.enemies.length >= 20,
        `сид ${loc.seed}: ${free} свободных клеток на ${loc.enemies.length} привидений — ` +
          'участок забит, и уйти шагом уже не выйдет',
      );
      for (const e of loc.enemies) {
        assert.equal(e.kind, 'ghost', `сид ${loc.seed}: на кладбище не привидение`);
        // Внутри ограды — значит дальше от края, чем лес, поле и сама ограда.
        const inX = e.x > site.at.x && e.x < site.at.x + (loc.size - 2 * (WOOD + FIELD));
        const inZ = e.z > site.at.z && e.z < site.at.z + (loc.size - 2 * (WOOD + FIELD));
        assert.ok(inX && inZ, `сид ${loc.seed}: привидение ${e.x},${e.z} вне участка`);
      }
    }
  });

  test('склеп и могилы стоят, и хотя бы часть из них обходят', () => {
    for (const site of sites) {
      assert.ok(site.marks.some((m) => m.model === 'crypt'), `сид ${site.loc.seed}: склепа нет`);
      assert.ok(site.marks.some((m) => m.solid), `сид ${site.loc.seed}: обходить нечего`);
      assert.ok(site.marks.some((m) => !m.solid), `сид ${site.loc.seed}: переступать нечего`);
    }
  });

  test('пеньки по краю проходимы: по вырубке ходят', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.ok(site.stumps.length > 0, `сид ${loc.seed}: вырубки нет`);
      for (const s of site.stumps) {
        assert.equal(
          loc.blocked[idx(loc.size, s.x, s.z)],
          0,
          `сид ${loc.seed}: пенёк ${s.x},${s.z} перекрыл проход`,
        );
      }
    }
  });
});

describe('Кладбище: один сид — одно кладбище', () => {
  test('два вызова с одним сидом дают одно и то же', () => {
    for (const seed of SEEDS) {
      const a = generateGraveSite(seed);
      const b = generateGraveSite(seed);
      assert.equal(a.material, b.material);
      assert.deepEqual(a.fence, b.fence);
      assert.deepEqual(a.marks, b.marks);
      assert.deepEqual([...a.loc.blocked], [...b.loc.blocked]);
      assert.deepEqual(a.loc.enemies, b.loc.enemies);
    }
  });

  test('материал ограды выпадает разный: четыре кладбища, а не одно', () => {
    const seen = new Set(sites.map((s) => s.material));
    assert.ok(seen.size >= 3, `на пятнадцати сидах материалов ${seen.size}`);
  });
});
