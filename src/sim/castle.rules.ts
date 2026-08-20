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
  PARTS,
  STAIRS,
  STRAIGHT,
  WALK,
  WALL_TOP,
  buildWall,
  generateCastle,
  jointOf,
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
    const declared: readonly Part[] = [...Object.values(PARTS).flat(), STAIRS];
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
    for (const part of [...STRAIGHT, ...CORNER, STAIRS]) {
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
        // Ворота — арка и створка в одной клетке: створка не деталь стены,
        // она в проезде.
        if (p.model === 'gate') continue;
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
        if (p.role !== 'башня' && p.role !== 'лестница' && p.role !== 'двор') continue;
        assert.ok(
          c.yard.some((s) => s.x === p.x && s.z === p.z),
          `сид ${c.seed}: «${p.model}» в ${p.x},${p.z} стоит не во дворе`,
        );
      }
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

  test('ярусы башни стоят на измеренных высотах, а не в воздухе', () => {
    for (const c of castles) {
      const tower = c.pieces.filter((p) => p.role === 'башня').sort((a, b) => a.y - b.y);
      if (tower.length === 0) continue;
      assert.equal(tower[0]!.y, 0, `сид ${c.seed}: донжон начинается не с земли`);
      for (let i = 1; i < tower.length; i++) {
        const below = tower[i - 1]!;
        const gap = Math.round((tower[i]!.y - below.y) * 100) / 100;
        assert.ok(gap === 0 || gap === FLOOR, `сид ${c.seed}: ярус поднят на ${gap}, а этаж ${FLOOR}`);
        if (gap === FLOOR) {
          assert.equal(
            measured.get(below.model)!.size[1],
            FLOOR,
            `сид ${c.seed}: под ярусом стоит «${below.model}» высотой не в этаж`,
          );
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
