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
import { FIELD, TRADER_REACH, WOOD, atTrader, generateCastleSite, inYard, spotAt } from './castleSite';
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

/**
 * `inYard` — не удобство, а орган кадра: по нему решается, гасить ли стены,
 * пока герой внутри (§6.1.6.1). Ошибись он в любую сторону, и замок либо
 * стоит прозрачным всё время, либо прячет героя ровно тогда, когда его надо
 * показать. Проверяется поэтому здесь, без браузера.
 */
describe('Замок на карте: где кончается двор', () => {
  test('выход двором не считается', () => {
    for (const site of sites) {
      assert.ok(!inYard(site, site.loc.evac), `сид ${site.loc.seed}: выход посчитан двором`);
      assert.ok(!inYard(site, site.gate), `сид ${site.loc.seed}: ворота посчитаны двором`);
    }
  });

  test('лес и поле двором не считаются', () => {
    for (const site of sites) {
      const edge = { x: 0, z: 0 };
      assert.ok(!inYard(site, edge), `сид ${site.loc.seed}: угол локации посчитан двором`);
      // Клетка поля: между лесом и стеной, двором быть не может по построению.
      assert.ok(
        !inYard(site, { x: WOOD, z: WOOD + 1 }),
        `сид ${site.loc.seed}: клетка поля посчитана двором`,
      );
    }
  });

  test('двор непуст: иначе гасить стены было бы не для кого', () => {
    for (const site of sites) {
      let inside = 0;
      for (let z = 0; z < site.loc.size; z++) {
        for (let x = 0; x < site.loc.size; x++) if (inYard(site, { x, z })) inside++;
      }
      assert.ok(inside >= 16, `сид ${site.loc.seed}: во дворе ${inside} клеток`);
    }
  });
});

describe('Замок на карте: чего в нём нет', () => {
  test('из добычи — одна казна, противников на входе нет', () => {
    // Прежнее «ни добычи, ни противников» пересмотрено (§13.6): в каждом
    // замке ровно один сундук казны, и это вся добыча. Противников при
    // генерации по-прежнему ноль — стража поднимается только засадой
    // вскрытого сундука, и прогулка не тронувшего казну остаётся прогулкой.
    for (const site of sites) {
      assert.equal(site.loc.containers.length, 1, `сид ${site.loc.seed}: казна не одна`);
      const chest = site.loc.containers[0]!;
      assert.equal(chest.look, 'сундук', `сид ${site.loc.seed}: казна не сундуком`);
      assert.equal(chest.ambush?.kind, 'guard', `сид ${site.loc.seed}: казна без стражи`);
      assert.ok((chest.ambush?.count ?? 0) > 0, `сид ${site.loc.seed}: стражи ноль`);
      // Клетка сундука проходима: вскрытие — это приход на клетку.
      assert.equal(
        site.loc.blocked[idx(site.loc.size, chest.x, chest.z)],
        0,
        `сид ${site.loc.seed}: сундук в стене`,
      );
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: в замке противник`);
    }
  });

  test('казна не рядом с торговцем: кража не попадает в радиус обмена', () => {
    for (const site of sites) {
      const chest = site.loc.containers[0]!;
      if (site.trader === null) continue;
      const d = Math.hypot(chest.x - site.trader.x, chest.z - site.trader.z);
      assert.ok(d >= 3, `сид ${site.loc.seed}: сундук в ${d.toFixed(1)} клетках от торговца`);
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

describe('Замок на карте: дорога называет маршрут', () => {
  test('дорога — одна четырёхсвязная цепь от подхода до двора торговца', () => {
    for (const site of sites) {
      const { roads, loc } = site;
      assert.ok(roads.length >= 3, `сид ${loc.seed}: дороги нет`);
      // Связность: волна по клеткам дороги от первой накрывает все.
      const set = new Set(roads.map((s) => `${s.x}:${s.z}`));
      const queue = [roads[0]!];
      const seen = new Set([`${roads[0]!.x}:${roads[0]!.z}`]);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const d of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const key = `${cur.x + d[0]!}:${cur.z + d[1]!}`;
          if (!set.has(key) || seen.has(key)) continue;
          seen.add(key);
          queue.push({ x: cur.x + d[0]!, z: cur.z + d[1]! });
        }
      }
      assert.equal(seen.size, set.size, `сид ${loc.seed}: дорога порвана`);
    }
  });

  test('дорога проходима: плита не лежит под стеной', () => {
    for (const site of sites) {
      const { roads, loc } = site;
      // Ворота — единственная деталь над дорогой, и под аркой проходят.
      for (const plan of roads) {
        const base = spotAt(site, plan);
        const mid = { x: base.x + (CASTLE_CELL >> 1), z: base.z + (CASTLE_CELL >> 1) };
        if (mid.x < 0 || mid.z < 0 || mid.x >= loc.size || mid.z >= loc.size) continue;
        assert.equal(
          loc.blocked[idx(loc.size, mid.x, mid.z)], 0,
          `сид ${loc.seed}: дорога ${plan.x},${plan.z} упирается в постройку`,
        );
      }
    }
  });

  test('дорога доводит до торговца, и на ней не лежит валун', () => {
    for (const site of sites) {
      const { roads, trader, loc } = site;
      assert.notEqual(trader, null);
      const last = roads[roads.length - 1]!;
      const base = spotAt(site, last);
      const d = Math.hypot(base.x + (CASTLE_CELL >> 1) - trader!.x, base.z + (CASTLE_CELL >> 1) - trader!.z);
      assert.ok(d <= CASTLE_CELL, `сид ${loc.seed}: дорога кончается в ${d.toFixed(1)} кл. от торговца`);

      const cells = new Set<string>();
      for (const plan of roads) {
        const b = spotAt(site, plan);
        for (let dz = 0; dz < CASTLE_CELL; dz++) {
          for (let dx = 0; dx < CASTLE_CELL; dx++) cells.add(`${b.x + dx}:${b.z + dz}`);
        }
      }
      for (const stone of loc.stones) {
        assert.ok(!cells.has(`${stone.x}:${stone.z}`), `сид ${loc.seed}: валун на плите ${stone.x},${stone.z}`);
      }
    }
  });

  test('фонари стоят у дороги, не на ней и не в стене', () => {
    for (const site of sites) {
      const { lamps, loc } = site;
      assert.ok(lamps.length >= 1, `сид ${loc.seed}: у дороги ни одного фонаря`);
      const cells = new Set<string>();
      for (const plan of site.roads) {
        const b = spotAt(site, plan);
        for (let dz = 0; dz < CASTLE_CELL; dz++) {
          for (let dx = 0; dx < CASTLE_CELL; dx++) cells.add(`${b.x + dx}:${b.z + dz}`);
        }
      }
      for (const lamp of lamps) {
        assert.equal(loc.blocked[idx(loc.size, lamp.x, lamp.z)], 0, `сид ${loc.seed}: фонарь в стене`);
        assert.ok(!cells.has(`${lamp.x}:${lamp.z}`), `сид ${loc.seed}: фонарь посреди полотна`);
        assert.ok(!loc.stones.some((s) => s.x === lamp.x && s.z === lamp.z), `сид ${loc.seed}: фонарь в валуне`);
      }
    }
  });
});
