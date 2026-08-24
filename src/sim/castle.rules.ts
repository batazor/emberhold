/**
 * Правила стройки стен (§6.1.6). Проверяется не то, красив ли замок, — это
 * решает глаз, — а два обещания, которые модель стройки даёт числами.
 *
 * Первое: **генератор не знает про набор ничего сверх обмера**. Все имена,
 * все открытые рёбра и все три высоты сверяются с `catalog.json`, который
 * пишет `npm run models -- --pack=castle --write`. Разъехаться молча они
 * не могут: набор обновится — правило упадёт.
 *
 * Второе: **стена замкнута, и двор внутри**. Кольцо без разрыва, у каждой
 * клетки ровно два соседа, поворот каждой детали выведен из её же обмера,
 * а не подобран, и снаружи во двор не пройти, не пройдя сквозь стену.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  CORNER,
  DIRS,
  FLOOR,
  FIXED_BRIDGES,
  FREE_STAIRS,
  GATE_LEAVES,
  HEX_TOWER,
  INNER_WALLS,
  PARTS,
  STAIR_PARTS,
  STRAIGHT,
  WALK,
  WALL_TOP,
  CAP,
  TOWER,
  TOWER_MAX,
  buildTower,
  buildWall,
  keyOf,
  generateCastle,
  jointOf,
  towerHeight,
  turnDir,
  type Castle,
  type Joint,
  type Part,
  type Spot,
} from './castle';

interface CatalogModel {
  readonly name: string;
  readonly size: readonly number[];
  readonly deck: number | null;
  readonly open: readonly boolean[];
}

const catalog = JSON.parse(
  readFileSync(new URL('../../assets/kenney-castle-kit/catalog.json', import.meta.url), 'utf8'),
) as { module: { cell: number }; models: readonly CatalogModel[] };

const measured = new Map(catalog.models.map((m) => [m.name, m]));
const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337];
const castles = SEEDS.map(generateCastle);
const expanded = Array.from({ length: 128 }, (_, i) => generateCastle(i + 1));

const key = (c: Castle, x: number, z: number): number => z * c.width + x;
const isRing = (c: Castle, x: number, z: number): boolean =>
  c.ring.some((s) => s.x === x && s.z === z);

describe('Замок: словарь деталей взят из обмера', () => {
  test('каждая деталь генератора есть в каталоге набора', () => {
    for (const castle of castles) {
      for (const p of castle.pieces) {
        assert.ok(measured.has(p.model), `сид ${castle.seed}: детали «${p.model}» в наборе нет`);
      }
    }
  });

  test('объявленные открытые рёбра совпадают с измеренными', () => {
    const declared: readonly Part[] = [...Object.values(PARTS).flat(), ...STAIR_PARTS];
    for (const part of declared) {
      const model = measured.get(part.model);
      assert.ok(model !== undefined, `детали «${part.model}» в каталоге нет`);
      assert.deepEqual(
        part.open.map(Boolean),
        model.open.map(Boolean),
        `«${part.model}»: объявлено ${part.open} — измерено ${model.open}`,
      );
    }
  });

  test('три высоты модуля — из каталога, а не из головы', () => {
    // Этаж — высота яруса башни; ход — площадка стены под зубцами;
    // верх — самая высокая точка стены.
    assert.equal(measured.get('tower-square-base')!.size[1], FLOOR, 'этаж');
    assert.equal(measured.get('wall')!.deck, WALK, 'ход поверху');
    assert.equal(measured.get('wall')!.size[1], WALL_TOP, 'верх стены');
    assert.equal(catalog.module.cell, 1, 'клетка набора');
    assert.ok(WALK < WALL_TOP && WALK > FLOOR, 'ход обязан лежать между этажом и зубцами');
  });

  test('деталь стены входит в клетку набора', () => {
    // Угол с башенкой — единственный, кому положено вылезать: он занимает
    // полторы клетки, и вылезает наружу, а не во двор.
    for (const part of [...STRAIGHT, ...CORNER, ...STAIR_PARTS]) {
      const size = measured.get(part.model)!.size;
      const limit = part.model === 'wall-corner-half-tower' ? 1.5 : 1.06;
      assert.ok(size[0]! <= limit && size[2]! <= limit, `«${part.model}»: ${size[0]}×${size[2]}`);
    }
  });
});

describe('Конструктор: любые клетки — те же правила', () => {
  /** Клетки из картинки: `#` — стена. Так же читаются планы в правилах ниже. */
  const shape = (rows: readonly string[]): Spot[] => {
    const out: Spot[] = [];
    rows.forEach((row, z) => [...row].forEach((c, x) => { if (c === '#') out.push({ x, z }); }));
    return out;
  };

  const SHAPES: readonly (readonly [string, readonly string[], Joint])[] = [
    ['одинокая клетка', ['#'], 'одиночная'],
    ['конец отрезка', ['##'], 'тупик'],
    ['середина отрезка', ['###'], 'прямая'],
    ['буква Г', ['##', '#.'], 'угол'],
    ['тройник', ['.#.', '###'], 'тройник'],
    ['перекрёсток', ['.#.', '###', '.#.'], 'перекрёсток'],
  ];

  test('форма стыка читается по соседям, а не по замыслу', () => {
    for (const [what, rows, joint] of SHAPES) {
      const cells = shape(rows);
      const set = new Set(cells.map((s) => `${s.x}:${s.z}`));
      // Форма проверяется у клетки, у которой соседей больше всех: именно она
      // и есть то, ради чего пример нарисован.
      const worst = cells
        .map((s) => ({ s, n: DIRS.filter((d) => set.has(`${s.x + d[0]!}:${s.z + d[1]!}`)).length }))
        .reduce((a, b) => (b.n > a.n ? b : a));
      const dirs = DIRS.map((d, i) => (set.has(`${worst.s.x + d[0]!}:${worst.s.z + d[1]!}`) ? i : -1))
        .filter((i) => i >= 0);
      assert.equal(jointOf(dirs), joint, what);
    }
  });

  test('на каждую форму стыка встаёт деталь, и она повёрнута по соседям', () => {
    for (const [what, rows] of SHAPES) {
      const cells = shape(rows);
      const set = new Set(cells.map((s) => `${s.x}:${s.z}`));
      const built = buildWall(cells);
      assert.equal(built.joints.length, cells.length, `${what}: клетка осталась без детали`);
      for (const j of built.joints) {
        const piece = built.pieces.find((p) => p.x === j.spot.x && p.z === j.spot.z)!;
        if (j.joint === 'перекрёсток') continue;
        const open = measured.get(piece.model)!.open;
        const want = DIRS.map((d, i) => (set.has(`${j.spot.x + d[0]!}:${j.spot.z + d[1]!}`) ? i : -1))
          .filter((i) => i >= 0);
        const got = DIRS.map((_, dir) => dir)
          .filter((dir) => open[dir] === true)
          .map((dir) => turnDir(dir, piece.turn))
          .sort();
        assert.deepEqual([...got], [...want].sort(), `${what}: «${piece.model}» повёрнут мимо соседей`);
      }
    }
  });

  test('на перекрёстке встаёт башня — детали с четырьмя ходами в наборе нет', () => {
    const cross = shape(['.#.', '###', '.#.']);
    const built = buildWall(cross);
    const middle = built.pieces.filter((p) => p.x === 1 && p.z === 1);
    assert.equal(middle.length, 2, 'башня — этаж и шапка');
    assert.deepEqual(middle.map((p) => p.role), ['башня', 'башня']);
    assert.equal(middle[1]!.y, FLOOR, 'шапка стоит на этаже');
    assert.equal(
      Object.values(PARTS).flat().filter((p) => p.open.every(Boolean)).length,
      0,
      'если такая деталь появится, башню на перекрёстке надо пересмотреть',
    );
  });

  test('одна и та же стена собирается одинаково', () => {
    const cells = shape(['####', '#..#', '#..#', '####']);
    assert.deepEqual(buildWall(cells).pieces, buildWall(cells).pieces);
  });

  test('высоты деталей конструктора совпадают — стена не ступенчатая', () => {
    const walls = [...PARTS['одиночная'], ...PARTS['тупик'], ...PARTS['прямая'], ...PARTS['тройник']];
    for (const part of walls) {
      assert.equal(
        measured.get(part.model)!.size[1],
        WALL_TOP,
        `«${part.model}» другой высоты — стена вышла бы ступенькой`,
      );
    }
  });
});

describe('Башня: апгрейд идёт только вверх', () => {
  const LEVELS = [1, 2, 3];

  test('уровень — это число этажей, и каждый добавляет ровно один', () => {
    for (const level of LEVELS) {
      const tower = buildTower({ x: 4, z: 4 }, level);
      const floors = tower.filter((p) =>
        p.model === TOWER.base || p.model === TOWER.keepBase || TOWER.body.includes(p.model as never));
      assert.equal(floors.length, level, `уровень ${level}: этажей ${floors.length}`);
      const cap = tower[tower.length - 1]!;
      assert.ok(
        cap.model === TOWER.cap || TOWER.roofs.includes(cap.model as never),
        `уровень ${level}: башня без завершения`,
      );
      // Этажи стоят друг на друге по измеренной высоте, а не через один.
      for (let i = 0; i < tower.length; i++) {
        assert.equal(
          Math.round(tower[i]!.y * 100) / 100,
          Math.round(FLOOR * i * 100) / 100,
          `уровень ${level}: ярус ${i} висит на ${tower[i]!.y}`,
        );
      }
    }
  });

  test('след на земле не растёт: надстройка не задевает соседей', () => {
    const spot = { x: 4, z: 4 };
    const feet = LEVELS.map((level) =>
      new Set(buildTower(spot, level).map((p) => `${p.x}:${p.z}`)));
    for (const set of feet) {
      assert.equal(set.size, 1, 'башня заняла больше одной клетки');
      assert.ok(set.has('4:4'), 'башня уехала с своей клетки');
    }
  });

  test('первый уровень вровень со стеной — это совпадение замеров, а не подгонка', () => {
    assert.equal(measured.get(TOWER.base)!.size[1], FLOOR, 'этаж');
    assert.equal(measured.get(TOWER.cap)!.size[1], CAP, 'зубцы');
    assert.equal(Math.round(towerHeight(1) * 100) / 100, WALL_TOP, 'этаж + зубцы = высота стены');
  });

  test('каждый уровень выше предыдущего ровно на этаж', () => {
    for (let level = 2; level <= TOWER_MAX; level++) {
      const step = Math.round((towerHeight(level) - towerHeight(level - 1)) * 100) / 100;
      assert.equal(step, FLOOR, `с ${level - 1} на ${level} прибавилось ${step}`);
    }
  });

  test('выше потолка башня не растёт, ниже первого не падает', () => {
    assert.equal(buildTower({ x: 0, z: 0 }, TOWER_MAX + 4).length, TOWER_MAX + 1);
    assert.equal(buildTower({ x: 0, z: 0 }, 0).length, 2, 'нулевой уровень — это первый');
    assert.equal(buildTower({ x: 0, z: 0 }, -3).length, 2);
  });

  test('башню ставят где просят, и апгрейд не трогает стену вокруг', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 3, z: 0 },
      { x: 4, z: 0 },
    ];
    const wallOnly = buildWall(line).pieces.filter((p) => p.x !== 2);
    for (const level of [1, 2, 3]) {
      const towers = new Map([[keyOf({ x: 2, z: 0 }), level]]);
      const built = buildWall(line, undefined, towers);
      const here = built.pieces.filter((p) => p.x === 2 && p.z === 0);
      assert.equal(here.length, level + 1, `уровень ${level}: деталей ${here.length}`);
      assert.ok(here.every((p) => p.role === 'башня'), `уровень ${level}: на клетке не башня`);
      // Соседние клетки не шелохнулись: апгрейд идёт вверх и только вверх.
      assert.deepEqual(
        built.pieces.filter((p) => p.x !== 2),
        wallOnly,
        `уровень ${level}: стена вокруг башни пересобралась`,
      );
      assert.equal(built.joints.find((j) => j.spot.x === 2)!.tower, level);
    }
  });

  test('на перекрёстке стоит башня первого уровня', () => {
    const cross = [
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 1, z: 2 },
    ];
    const middle = buildWall(cross).pieces.filter((p) => p.x === 1 && p.z === 1);
    assert.deepEqual(middle.map((p) => p.model), [TOWER.base, TOWER.cap]);
    assert.equal(Math.round((middle[1]!.y + CAP) * 100) / 100, WALL_TOP, 'башня не вровень со стеной');
  });

  test('донжон выше стены: в один ярус он перестал бы быть донжоном', () => {
    for (const c of castles) {
      const tower = c.pieces.filter((p) => p.role === 'башня');
      if (tower.length === 0) continue;
      const top = Math.max(...tower.map((p) => p.y));
      assert.ok(top >= FLOOR, `сид ${c.seed}: донжон в один ярус`);
      assert.ok(top <= FLOOR * TOWER_MAX + 0.001, `сид ${c.seed}: донжон выше потолка`);
    }
  });
});

describe('Замок: расширенные семейства набора имеют работу', () => {
  test('квадратный и шестигранный стили встречаются, семейство гексагона используется целиком', () => {
    assert.ok(expanded.some((c) => c.towerStyle === 'квадратные'));
    assert.ok(expanded.some((c) => c.towerStyle === 'шестигранные'));
    const used = new Set(expanded.flatMap((c) => c.pieces.map((p) => p.model)));
    for (const model of [HEX_TOWER.base, HEX_TOWER.body, ...HEX_TOWER.tops, ...HEX_TOWER.roofs]) {
      assert.ok(used.has(model), `шестигранная деталь «${model}» не появляется`);
    }
    for (const c of expanded.filter((castle) => castle.towerStyle === 'шестигранные')) {
      assert.ok(c.towers.length > 0, `сид ${c.seed}: стиль есть, башен нет`);
      assert.ok(c.towers.every((spot) => c.pieces.some((p) =>
        p.x === spot.x && p.z === spot.z && p.model === HEX_TOWER.base)));
    }
  });

  test('узкие и деревянные укрепления появляются во дворе и не подменяют внешнюю стену', () => {
    const innerModels = [...INNER_WALLS.stone, ...INNER_WALLS.wood] as readonly string[];
    const used = new Set<string>();
    for (const c of expanded) {
      const inner = c.pieces.filter((p) => p.role === 'укрепление');
      assert.equal(inner.length, 2, `сид ${c.seed}: внутреннее укрепление не из двух клеток`);
      for (const p of inner) {
        used.add(p.model);
        assert.ok(innerModels.includes(p.model), `сид ${c.seed}: «${p.model}» не внутренняя стена`);
        assert.ok(c.yard.some((s) => s.x === p.x && s.z === p.z), `сид ${c.seed}: укрепление вне двора`);
        assert.ok(!isRing(c, p.x, p.z), `сид ${c.seed}: укрепление подменило кольцо`);
      }
    }
    for (const model of innerModels) assert.ok(used.has(model), `«${model}» не появляется`);
  });

  test('ворота используют все три створки, а каменный мост лежит в клетке рва на уровне дороги', () => {
    const leaves = new Set<string>();
    const fixed = new Set<string>();
    for (const c of expanded) {
      const leaf = c.pieces.filter((p) => (GATE_LEAVES as readonly string[]).includes(p.model));
      assert.equal(leaf.length, 1, `сид ${c.seed}: створок ${leaf.length}`);
      leaves.add(leaf[0]!.model);
      const bridges = c.pieces.filter((p) => (FIXED_BRIDGES as readonly string[]).includes(p.model));
      assert.equal(bridges.length, 1, `сид ${c.seed}: прямых мостов ${bridges.length}`);
      const bridge = bridges[0]!;
      fixed.add(bridge.model);
      assert.ok(c.moat.some((s) => s.x === bridge.x && s.z === bridge.z), `сид ${c.seed}: мост не над рвом`);
      assert.equal(Math.round((bridge.y + measured.get(bridge.model)!.deck!) * 100), 0, `сид ${c.seed}: настил висит`);
    }
    assert.deepEqual([...leaves].sort(), [...GATE_LEAVES].sort());
    assert.deepEqual([...fixed].sort(), [...FIXED_BRIDGES].sort());
  });

  test('отдельные лестницы и настенные баннеры используют обе модели', () => {
    const stairs = new Set<string>();
    const banners = new Set<string>();
    for (const c of expanded) {
      for (const p of c.pieces) {
        if ((FREE_STAIRS as readonly string[]).includes(p.model)) stairs.add(p.model);
        if (p.model === 'flag-banner-short' || p.model === 'flag-banner-long') banners.add(p.model);
      }
      assert.ok(c.pieces.some((p) => p.model === 'flag-banner-short' || p.model === 'flag-banner-long'));
    }
    assert.deepEqual([...stairs].sort(), [...FREE_STAIRS].sort());
    assert.deepEqual([...banners].sort(), ['flag-banner-long', 'flag-banner-short']);
  });

  test('ров окружает след замка непрерывным внешним поясом', () => {
    for (const c of expanded) {
      const inside = new Set([...c.ring, ...c.yard].map(keyOf));
      const moat = new Set(c.moat.map(keyOf));
      for (const spot of c.ring) {
        const touches = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) =>
          (dx !== 0 || dz !== 0) && moat.has(`${spot.x + dx}:${spot.z + dz}`)));
        assert.ok(touches,
          `сид ${c.seed}: у стены ${spot.x},${spot.z} нет рва`);
      }
      assert.ok(c.moat.every((s) => !inside.has(keyOf(s))), `сид ${c.seed}: вода попала внутрь`);
    }
  });
});

describe('Замок: стена — замкнутая цепь', () => {
  test('соседи по списку — соседи по сетке, и кольцо смыкается', () => {
    for (const c of castles) {
      assert.ok(c.ring.length >= 12, `сид ${c.seed}: кольцо из ${c.ring.length} клеток`);
      for (let i = 0; i < c.ring.length; i++) {
        const a = c.ring[i]!;
        const b = c.ring[(i + 1) % c.ring.length]!;
        const step = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
        assert.equal(step, 1, `сид ${c.seed}: разрыв между ${a.x},${a.z} и ${b.x},${b.z}`);
      }
      const seen = new Set(c.ring.map((s) => key(c, s.x, s.z)));
      assert.equal(seen.size, c.ring.length, `сид ${c.seed}: клетка стены повторяется`);
    }
  });

  test('у каждой клетки стены ровно два соседа по стене', () => {
    for (const c of castles) {
      for (const s of c.ring) {
        const n = DIRS.filter((d) => isRing(c, s.x + d[0]!, s.z + d[1]!)).length;
        assert.equal(n, 2, `сид ${c.seed}: у ${s.x},${s.z} соседей ${n}`);
      }
    }
  });

  test('на клетку кольца приходится одна деталь нижнего яруса', () => {
    for (const c of castles) {
      const ground = c.pieces.filter(
        (p) => p.y === 0 && p.role !== 'знамя' && isRing(c, p.x, p.z),
      );
      const perCell = new Map<number, number>();
      for (const p of ground) {
        // Ворота — арка, створка и мост в одной клетке. Створка
        // и мост — проезд, а не вторая деталь стены.
        if ((p.role === 'ворота' && p.model !== 'tower-square-arch') || p.role === 'мост') continue;
        perCell.set(key(c, p.x, p.z), (perCell.get(key(c, p.x, p.z)) ?? 0) + 1);
      }
      assert.equal(perCell.size, c.ring.length, `сид ${c.seed}: клетка кольца осталась пустой`);
      for (const [, n] of perCell) assert.equal(n, 1, `сид ${c.seed}: в клетке ${n} деталей`);
    }
  });
});

describe('Замок: поворот выведен, а не подобран', () => {
  test('открытые рёбра детали после поворота смотрят ровно на соседей', () => {
    for (const c of castles) {
      for (const p of c.pieces) {
        if (p.role !== 'стена' && p.role !== 'угол') continue;
        const open = measured.get(p.model)!.open;
        const want = DIRS.map((d, i) => (isRing(c, p.x + d[0]!, p.z + d[1]!) ? i : -1))
          .filter((i) => i >= 0);
        const got = DIRS.map((_, dir) => dir)
          .filter((dir) => open[dir] === true)
          .map((dir) => turnDir(dir, p.turn))
          .sort();
        assert.deepEqual(
          got,
          [...want].sort(),
          `сид ${c.seed}: «${p.model}» в ${p.x},${p.z} повёрнут на ${p.turn} мимо соседей`,
        );
      }
    }
  });

  test('лестница выходит ходом к стене, а не в пустой двор', () => {
    for (const c of castles) {
      for (const p of c.pieces) {
        if (p.role !== 'лестница') continue;
        if ((FREE_STAIRS as readonly string[]).includes(p.model)) continue;
        const open = measured.get(p.model)!.open;
        const out = DIRS.map((_, dir) => dir).filter((dir) => open[dir] === true);
        assert.equal(out.length, 1, `«${p.model}»: ходов ${out.length}, ожидался один`);
        const dir = turnDir(out[0]!, p.turn);
        assert.ok(
          isRing(c, p.x + DIRS[dir]![0]!, p.z + DIRS[dir]![1]!),
          `сид ${c.seed}: лестница в ${p.x},${p.z} упирается не в стену`,
        );
      }
    }
  });
});

describe('Замок: двор, ворота и ярусы', () => {
  test('ворота одни, и они на прямом участке', () => {
    for (const c of castles) {
      const arches = c.pieces.filter((p) => p.model === 'tower-square-arch');
      assert.equal(arches.length, 1, `сид ${c.seed}: арок ${arches.length}`);
      const g = arches[0]!;
      assert.equal(g.x, c.gate.x, `сид ${c.seed}: арка не в клетке ворот`);
      assert.equal(g.z, c.gate.z, `сид ${c.seed}: арка не в клетке ворот`);
      const dirs = DIRS.map((d, i) => (isRing(c, g.x + d[0]!, g.z + d[1]!) ? i : -1)).filter((i) => i >= 0);
      assert.equal(dirs.length, 2, `сид ${c.seed}: у ворот соседей ${dirs.length}`);
      const a = DIRS[dirs[0]!]!;
      const b = DIRS[dirs[1]!]!;
      assert.ok(a[0] === -b[0]! && a[1] === -b[1]!, `сид ${c.seed}: ворота встали в угол`);
    }
  });

  test('подъёмный мост один и лежит от ворот наружу', () => {
    for (const c of castles) {
      const bridges = c.pieces.filter((p) => p.model === 'bridge-draw');
      assert.equal(bridges.length, 1, `сид ${c.seed}: мостов ${bridges.length}`);
      const bridge = bridges[0]!;
      assert.equal(bridge.x, c.gate.x, `сид ${c.seed}: мост уехал от ворот`);
      assert.equal(bridge.z, c.gate.z, `сид ${c.seed}: мост уехал от ворот`);

      const inward = DIRS.findIndex((dir) =>
        c.yard.some((s) => s.x === c.gate.x + dir[0] && s.z === c.gate.z + dir[1]));
      assert.ok(inward >= 0, `сид ${c.seed}: у ворот нет двора`);
      const open = measured.get(bridge.model)!.open;
      const direction = open.findIndex(Boolean);
      assert.ok(direction >= 0, `сид ${c.seed}: у моста нет направления`);
      const outward = turnDir(direction, bridge.turn);
      const opposite = [1, 0, 3, 2] as const;
      assert.equal(outward, opposite[inward], `сид ${c.seed}: мост лежит во двор`);
    }
  });

  test('во двор снаружи не пройти, не пройдя стену', () => {
    for (const c of castles) {
      // Заливка снаружи по клеткам, которые не стена: поле берётся с запасом
      // в одну клетку, чтобы у заливки было откуда начать.
      const w = c.width + 2;
      const d = c.depth + 2;
      const blocked = new Uint8Array(w * d);
      for (const s of c.ring) blocked[(s.z + 1) * w + (s.x + 1)] = 1;
      const seen = new Uint8Array(w * d);
      const queue = [0];
      seen[0] = 1;
      while (queue.length > 0) {
        const cur = queue.pop()!;
        const cx = cur % w;
        const cz = (cur / w) | 0;
        for (const [dx, dz] of DIRS) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
          const ni = nz * w + nx;
          if (seen[ni] || blocked[ni]) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      assert.ok(c.yard.length > 0, `сид ${c.seed}: двора нет`);
      for (const s of c.yard) {
        assert.equal(seen[(s.z + 1) * w + (s.x + 1)], 0, `сид ${c.seed}: двор ${s.x},${s.z} снаружи`);
      }
    }
  });

  test('двор не распадается: из любой клетки достижима любая', () => {
    for (const c of castles) {
      const inYard = new Set(c.yard.map((s) => key(c, s.x, s.z)));
      const seen = new Set([key(c, c.yard[0]!.x, c.yard[0]!.z)]);
      const queue = [c.yard[0]!];
      while (queue.length > 0) {
        const cur = queue.pop()!;
        for (const [dx, dz] of DIRS) {
          const k = key(c, cur.x + dx, cur.z + dz);
          if (!inYard.has(k) || seen.has(k)) continue;
          seen.add(k);
          queue.push({ x: cur.x + dx, z: cur.z + dz });
        }
      }
      assert.equal(seen.size, c.yard.length, `сид ${c.seed}: двор распался на части`);
    }
  });

  test('донжон и лестница стоят во дворе, а не в кольце', () => {
    for (const c of castles) {
      for (const p of c.pieces) {
        if (p.role !== 'башня' && p.role !== 'лестница' && p.role !== 'двор' && p.role !== 'укрепление') continue;
        if (p.role === 'башня' && isRing(c, p.x, p.z)) continue;
        assert.ok(
          c.yard.some((s) => s.x === p.x && s.z === p.z),
          `сид ${c.seed}: «${p.model}» в ${p.x},${p.z} стоит не во дворе`,
        );
      }
    }
  });

  test('у донжона есть вход на земле, а у башен стены его нет', () => {
    for (const c of castles) {
      const entrances = c.pieces.filter((p) => p.model === TOWER.keepBase);
      assert.equal(entrances.length, 1, `сид ${c.seed}: входов донжона ${entrances.length}`);
      const entrance = entrances[0]!;
      assert.equal(entrance.y, 0, `сид ${c.seed}: дверь донжона не на земле`);
      assert.ok(
        c.yard.some((s) => s.x === entrance.x && s.z === entrance.z),
        `сид ${c.seed}: вход донжона не во дворе`,
      );
      assert.ok(
        c.pieces.filter((p) => isRing(c, p.x, p.z)).every((p) => p.model !== TOWER.keepBase),
        `сид ${c.seed}: дверь попала на башню стены`,
      );
    }
  });

  test('двор вымощен весь и ровно один раз', () => {
    for (const c of castles) {
      const ground = c.pieces.filter((p) => p.model === 'ground');
      assert.equal(ground.length, c.yard.length, `сид ${c.seed}: плит ${ground.length} на ${c.yard.length} клеток`);
      const seen = new Set(ground.map((p) => key(c, p.x, p.z)));
      assert.equal(seen.size, ground.length, `сид ${c.seed}: клетка двора вымощена дважды`);
    }
  });

  test('ярусы каждой башни стоят друг на друге по измеренной высоте', () => {
    for (const c of castles) {
      const cells = new Map<string, typeof c.pieces[number][]>();
      for (const p of c.pieces.filter((piece) => piece.role === 'башня')) {
        const list = cells.get(`${p.x}:${p.z}`) ?? [];
        list.push(p);
        cells.set(`${p.x}:${p.z}`, list);
      }
      for (const [spot, tower] of cells) {
        tower.sort((a, b) => a.y - b.y);
        assert.equal(tower[0]!.y, 0, `сид ${c.seed}: башня ${spot} начинается не с земли`);
        for (let i = 1; i < tower.length; i++) {
          const below = tower[i - 1]!;
          const expected = Math.round((below.y + measured.get(below.model)!.size[1]!) * 100) / 100;
          const actual = Math.round(tower[i]!.y * 100) / 100;
          assert.equal(actual, expected, `сид ${c.seed}: над «${below.model}» остался зазор`);
        }
      }
    }
  });
});

describe('Замок: один сид — один замок', () => {
  test('два вызова с одним сидом дают один и тот же список деталей', () => {
    for (const seed of SEEDS) {
      assert.deepEqual(generateCastle(seed).pieces, generateCastle(seed).pieces, `сид ${seed}`);
    }
  });

  test('разные сиды дают разные замки', () => {
    const shapes = new Set(castles.map((c) => JSON.stringify(c.pieces)));
    assert.equal(shapes.size, castles.length, 'генератор повторяется');
  });
});
