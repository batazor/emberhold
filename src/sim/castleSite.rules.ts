/**
 * Правила площадки замка (§6.1.6, §4). Локация обещает игроку три вещи,
 * и все три проверяются здесь, а не глазами.
 *
 * Первое: **по ней можно ходить**. Каждая свободная клетка достижима от
 * выхода — тупиков, отрезанных стеной, не остаётся ни одного.
 *
 * Второе: **войти можно только в ворота**. Замок обязан быть замком:
 * если заложить проезд, двор становится недостижим.
 *
 * Третье: **в ней ничего нет**. Ни добычи, ни противников — это объявленное
 * состояние, а не забытый шаг генератора.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CASTLE_CELL } from './castle';
import { FIELD, TRADER_REACH, WOOD, atTrader, generateCastleSite, spotAt } from './castleSite';
import { distanceField, idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateCastleSite);

describe('Замок на карте: по нему ходят', () => {
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

  test('двор достижим — и достижим он через ворота', () => {
    for (const site of sites) {
      const { loc, castle } = site;
      // Клетки двора, занятые донжоном и лестницей, из проверки выпадают:
      // они не «недостижимы», они заняты постройкой.
      const yard = castle.yard
        .map((s) => spotAt(site, s))
        .filter((c) => !loc.blocked[idx(loc.size, c.x, c.z)]);
      assert.ok(yard.length > 0, `сид ${loc.seed}: во дворе не осталось места`);
      for (const cell of yard) {
        assert.ok(
          loc.backSteps[idx(loc.size, cell.x, cell.z)]! >= 0,
          `сид ${loc.seed}: двор ${cell.x},${cell.z} не достижим`,
        );
      }

      // Заложим проезд и повторим волну: если двор всё ещё достижим, стена
      // где-то дырявая, и замок не замок.
      const walled = Uint8Array.from(loc.blocked);
      for (let dz = 0; dz < CASTLE_CELL; dz++) {
        for (let dx = 0; dx < CASTLE_CELL; dx++) {
          walled[idx(loc.size, site.gate.x + dx, site.gate.z + dz)] = 1;
        }
      }
      const shut = distanceField(loc.size, walled, loc.evac);
      for (const cell of yard) {
        assert.equal(
          shut[idx(loc.size, cell.x, cell.z)],
          -1,
          `сид ${loc.seed}: во двор ${cell.x},${cell.z} попадают мимо ворот`,
        );
      }
    }
  });

  test('выход стоит снаружи, а не во дворе', () => {
    for (const site of sites) {
      const inYard = site.castle.yard
        .map((s) => spotAt(site, s))
        .some((c) => Math.abs(c.x - site.loc.evac.x) < CASTLE_CELL
          && Math.abs(c.z - site.loc.evac.z) < CASTLE_CELL);
      assert.ok(!inYard, `сид ${site.loc.seed}: выход оказался внутри стен`);
      assert.equal(site.loc.blocked[idx(site.loc.size, site.loc.evac.x, site.loc.evac.z)], 0);
    }
  });
});

describe('Замок на карте: чего в нём нет', () => {
  test('ни добычи, ни противников — и это решение, а не пропуск', () => {
    for (const site of sites) {
      assert.equal(site.loc.containers.length, 0, `сид ${site.loc.seed}: в замке добыча`);
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: в замке противник`);
    }
  });

  test('лес держит границу локации, и за него не выйти', () => {
    for (const site of sites) {
      const { loc } = site;
      for (let z = 0; z < loc.size; z++) {
        for (let x = 0; x < loc.size; x++) {
          const border = x < WOOD || z < WOOD || x >= loc.size - WOOD || z >= loc.size - WOOD;
          if (!border) continue;
          assert.equal(loc.blocked[idx(loc.size, x, z)], 1, `сид ${loc.seed}: дыра в лесу ${x},${z}`);
        }
      }
      assert.equal(
        site.trees.length,
        loc.size * loc.size - (loc.size - 2 * WOOD) ** 2,
        `сид ${loc.seed}: лес не совпал с рамкой`,
      );
    }
  });

  test('между лесом и стеной есть поле: замок видно целиком', () => {
    for (const site of sites) {
      const { loc, castle, at } = site;
      assert.ok(at.x >= WOOD + FIELD, `сид ${loc.seed}: замок упёрся в лес по x`);
      assert.ok(at.z >= WOOD + FIELD, `сид ${loc.seed}: замок упёрся в лес по z`);
      assert.ok(
        at.x + castle.width * CASTLE_CELL <= loc.size - WOOD - FIELD,
        `сид ${loc.seed}: замок вылез в лес по x`,
      );
      assert.ok(
        at.z + castle.depth * CASTLE_CELL <= loc.size - WOOD - FIELD,
        `сид ${loc.seed}: замок вылез в лес по z`,
      );
    }
  });

  test('размер локации идёт от размера замка, а не наоборот', () => {
    const sizes = new Set(sites.map((s) => s.loc.size));
    assert.ok(sizes.size > 1, 'все площадки одного размера — замок не произвольный');
    for (const site of sites) {
      const plan = Math.max(site.castle.width, site.castle.depth) * CASTLE_CELL;
      assert.equal(site.loc.size, plan + 2 * (FIELD + WOOD), `сид ${site.loc.seed}`);
    }
  });

  test('один сид — одна площадка', () => {
    for (const seed of SEEDS) {
      const a = generateCastleSite(seed);
      const b = generateCastleSite(seed);
      assert.deepEqual([...a.loc.blocked], [...b.loc.blocked], `сид ${seed}`);
      assert.deepEqual(a.loc.evac, b.loc.evac, `сид ${seed}`);
    }
  });

  /*
   * Торговец (§13.4). Замок до него был местом без назначения — «ни добычи,
   * ни противников, по нему пока только ходят». Обмен даёт ему смысл, и
   * поэтому стоит он во дворе: двор достижим только через ворота (правило
   * выше), и обмен обязан стоить прогулки внутрь, а не шага от выхода.
   */
  test('торговец есть на каждом сиде, и до него можно дойти', () => {
    for (const seed of SEEDS) {
      const site = generateCastleSite(seed);
      assert.notEqual(site.trader, null, `сид ${seed}: торговца нет`);
      const t = site.trader!;
      const { loc } = site;
      assert.equal(loc.blocked[idx(loc.size, t.x, t.z)], 0, `сид ${seed}: торговец в стене`);
      const reach = distanceField(loc.size, loc.blocked, loc.evac);
      assert.ok(reach[idx(loc.size, t.x, t.z)]! >= 0, `сид ${seed}: до торговца не дойти`);
      assert.ok(atTrader(site, t.x, t.z), `сид ${seed}: торговец не отзывается в своей же клетке`);
    }
  });

  test('торговец стоит в глубине двора, а не у ворот', () => {
    // Замер на 300 сидах: 11–27 шагов от выхода, в среднем 19. Ближняя
    // к воротам клетка сделала бы обмен придорожным ларьком — вошёл под арку,
    // поменял, вышел, и замка игрок так и не увидел.
    let worst = Infinity;
    for (const seed of SEEDS) {
      const site = generateCastleSite(seed);
      const t = site.trader!;
      const reach = distanceField(site.loc.size, site.loc.blocked, site.loc.evac);
      worst = Math.min(worst, reach[idx(site.loc.size, t.x, t.z)]!);
      // Радиус отклика не должен доставать до ворот: иначе панель откроется
      // с порога и двор снова окажется декорацией.
      const toGate = Math.hypot(t.x - site.gate.x, t.z - site.gate.z);
      assert.ok(toGate > TRADER_REACH, `сид ${seed}: торговец слышен от ворот`);
    }
    assert.ok(worst >= 8, `ближайший торговец в ${worst} шагах от выхода — это ларёк, а не двор`);
  });
});
