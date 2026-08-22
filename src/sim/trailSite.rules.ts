/**
 * Правила лесной тропы (§6.1.17, §4). Локация обещает игроку четыре вещи,
 * и все четыре проверяются здесь, а не глазами.
 *
 * Первое: **по ней можно пройти**. Каждая открытая клетка достижима
 * от входа — виляние и отвилки нигде не рвут просеку.
 *
 * Второе: **она длинная и тесная**. Ход длиннее своей ширины минимум вдвое,
 * а каждая открытая клетка держится осевой: тропа, расползшаяся в поляну,
 * перестала бы быть тропой.
 *
 * Третье: **она ветвится в тупики**. Развилки есть на любом сиде, и каждый
 * отвилок удлиняет путь назад, а не срезает его: срезка отменяет длину,
 * ради которой локация заведена.
 *
 * Четвёртое: **это прогулка с работой**. Противников и находок нет — засады
 * придут своим записанным решением, — а добыча руками есть: валуны стоят
 * на обочине, и карточка карты обещает «дерево и камень», а не «нет».
 *
 * И как у всякой точки карты: **один сид — одна тропа** (§4).
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BRANCH_MIN,
  CLEAR_HALF,
  FORKS_MAX,
  FORKS_MIN,
  LEN_MAX,
  LEN_MIN,
  MOUTH,
  WOOD,
  generateTrailSite,
} from './trailSite';
import type { Cell } from './types';
import { distanceField, idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateTrailSite);

const near = (cells: readonly Cell[], x: number, z: number, r: number): boolean =>
  cells.some((c) => Math.abs(c.x - x) <= r && Math.abs(c.z - z) <= r);

describe('Тропа: по ней можно пройти', () => {
  test('каждая открытая клетка достижима от входа', () => {
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

  test('вход на открытой клетке и на грунте', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.equal(loc.blocked[idx(loc.size, loc.evac.x, loc.evac.z)], 0);
      assert.ok(
        site.path.some((c) => c.x === loc.evac.x && c.z === loc.evac.z),
        `сид ${loc.seed}: вход мимо грунта`,
      );
    }
  });

  /**
   * У дороги два конца, и оба выходы. Дальний — на грунте, на дальнем краю
   * хода, и идти до него не короче самого хода: выход, до которого ближе,
   * чем длина тропы, отменял бы длину, ради которой локация заведена.
   */
  test('дальний выход стоит в конце хода, и путь до него не короче хода', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.equal(loc.blocked[idx(loc.size, site.exit.x, site.exit.z)], 0);
      assert.ok(
        site.path.some((c) => c.x === site.exit.x && c.z === site.exit.z),
        `сид ${loc.seed}: дальний выход мимо грунта`,
      );
      assert.equal(site.exit.x, WOOD + site.length - 1, `сид ${loc.seed}: выход не на краю хода`);
      const steps = loc.backSteps[idx(loc.size, site.exit.x, site.exit.z)]!;
      assert.ok(
        steps >= site.length - 1,
        `сид ${loc.seed}: до дальнего выхода ${steps} шагов при длине ${site.length}`,
      );
    }
  });

  test('лес держит границу локации: рамка не вскрывается ни на одном сиде', () => {
    for (const site of sites) {
      const { loc } = site;
      // Не только самый край — вся рамка толщиной WOOD: просека и отвилки
      // не имеют права прогрызть её даже на клетку.
      for (let z = 0; z < loc.size; z++) {
        for (let x = 0; x < loc.size; x++) {
          const frame = x < WOOD || z < WOOD || x >= loc.size - WOOD || z >= loc.size - WOOD;
          if (!frame) continue;
          assert.equal(loc.blocked[idx(loc.size, x, z)], 1, `сид ${loc.seed}: рамка открыта в ${x},${z}`);
        }
      }
    }
  });
});

describe('Тропа: она длинная и тесная', () => {
  /**
   * Форма меряется по открытым клеткам, а не по константам генератора:
   * правило, читающее ту же переменную, что и код, проверяет опечатку,
   * а не решение.
   */
  test('ход длиннее своей ширины минимум вдвое', () => {
    for (const site of sites) {
      const { loc } = site;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let z = 0; z < loc.size; z++) {
        for (let x = 0; x < loc.size; x++) {
          if (loc.blocked[idx(loc.size, x, z)]) continue;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      }
      const long = x1 - x0 + 1;
      const wide = z1 - z0 + 1;
      assert.ok(long / wide >= 2, `сид ${loc.seed}: ход ${long} на ${wide} — участок, а не тропа`);
      assert.equal(long, site.length, `сид ${loc.seed}: длина хода разошлась с записанной`);
      assert.ok(site.length >= LEN_MIN && site.length <= LEN_MAX);
    }
  });

  test('тропа тесная: каждая открытая клетка держится осевой', () => {
    for (const site of sites) {
      const { loc } = site;
      const lines = [...site.spine, ...site.branches.flatMap((b) => b.line)];
      for (let z = 0; z < loc.size; z++) {
        for (let x = 0; x < loc.size; x++) {
          if (loc.blocked[idx(loc.size, x, z)]) continue;
          assert.ok(
            near(lines, x, z, CLEAR_HALF),
            `сид ${loc.seed}: клетка ${x},${z} открыта, а осевой рядом нет — поляна`,
          );
        }
      }
    }
  });

  test('ход виляет, а не прочерчен по линейке', () => {
    // Меряются колена — начала боковых отрезков осевой. Генератор вынуждает
    // колено каждые девять прямых клеток, и на длине в сорок четыре их
    // не может быть меньше четырёх ни на каком сиде.
    for (const site of sites) {
      let bends = 0;
      for (let i = 1; i < site.spine.length; i++) {
        const turn = site.spine[i]!.z !== site.spine[i - 1]!.z;
        const wasStraight = i === 1 || site.spine[i - 1]!.z === site.spine[i - 2]!.z;
        if (turn && wasStraight) bends++;
      }
      assert.ok(bends >= 4, `сид ${site.loc.seed}: у спины ${bends} колена — коридор`);
    }
  });
});

describe('Тропа: она ветвится в тупики', () => {
  test('развилки есть на любом сиде, и каждый отвилок не обрубок', () => {
    for (const site of sites) {
      const n = site.branches.length;
      assert.ok(n >= FORKS_MIN, `сид ${site.loc.seed}: отвилков ${n} — развилка случайность`);
      assert.ok(n <= FORKS_MAX, `сид ${site.loc.seed}: отвилков ${n} — лабиринт, а не тропа`);
      for (const b of site.branches) {
        assert.ok(b.line.length >= BRANCH_MIN, `сид ${site.loc.seed}: отвилок в ${b.line.length} клетки`);
        assert.ok(
          site.spine.some((c) => c.x === b.from.x && c.z === b.from.z),
          `сид ${site.loc.seed}: развилка ${b.from.x},${b.from.z} не на ходу`,
        );
      }
    }
  });

  /**
   * Тупик — это ровно одна дверь, и доказывается он волной, а не словом:
   * то же правило, каким кладбище доказывает ограду («войти можно только
   * в проезд»). Устье развилки закладывается — и конец отвилка обязан
   * стать недостижимым. Отвилок со вторым соединением — срезка, срезка
   * отменяет длину, ради которой локация заведена, и это правило её ловит.
   */
  test('единственная дверь отвилка — его развилка: заложи её, и конец отрезан', () => {
    for (const site of sites) {
      const { loc } = site;
      for (const b of site.branches) {
        const tip = b.line[b.line.length - 1]!;
        assert.ok(
          loc.backSteps[idx(loc.size, tip.x, tip.z)]! >= 0,
          `сид ${loc.seed}: до конца отвилка не дойти`,
        );
        const walled = Uint8Array.from(loc.blocked);
        for (let dz = -MOUTH; dz <= MOUTH; dz++) {
          for (let dx = -MOUTH; dx <= MOUTH; dx++) {
            const x = b.from.x + dx;
            const z = b.from.z + dz;
            if (x < 0 || z < 0 || x >= loc.size || z >= loc.size) continue;
            walled[idx(loc.size, x, z)] = 1;
          }
        }
        const closed = distanceField(loc.size, walled, loc.evac);
        assert.ok(
          closed[idx(loc.size, tip.x, tip.z)]! < 0,
          `сид ${loc.seed}: устье заложено, а конец отвилка всё равно достижим — срезка`,
        );
      }
    }
  });
});

describe('Тропа: прогулка с работой', () => {
  test('ни находок, ни противников — ни на одном сиде', () => {
    for (const site of sites) {
      assert.equal(site.loc.containers.length, 0, `сид ${site.loc.seed}: на тропе находки`);
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: на тропе противники`);
    }
  });

  /**
   * Валуны — добыча камня без глубины (§13.4). Стоят на обочине: клетка
   * проходима — по валуну по колено ходят, — но не на грунте: катить
   * камень на дорогу незачем, и ход остаётся ходом. Разнос — чтобы
   * обочина не читалась каменоломней.
   */
  test('валуны стоят на обочине: проходимо, не на грунте, вразнос', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.ok(loc.stones.length >= 3, `сид ${loc.seed}: валунов ${loc.stones.length} — обочина пустая`);
      assert.ok(loc.stones.length <= 10, `сид ${loc.seed}: валунов ${loc.stones.length} — каменоломня`);
      for (const s of loc.stones) {
        assert.equal(s.taken, false);
        assert.equal(loc.blocked[idx(loc.size, s.x, s.z)], 0, `сид ${loc.seed}: валун в лесу`);
        assert.ok(
          !site.path.some((c) => c.x === s.x && c.z === s.z),
          `сид ${loc.seed}: валун ${s.x},${s.z} на грунте`,
        );
      }
      for (const a of loc.stones) {
        for (const b of loc.stones) {
          if (a.id >= b.id) continue;
          assert.ok(
            Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) > 3,
            `сид ${loc.seed}: валуны ${a.id} и ${b.id} слиплись`,
          );
        }
      }
    }
  });
});

describe('Тропа: один сид — одна тропа', () => {
  test('два вызова с одним сидом дают одно и то же', () => {
    for (const seed of SEEDS) {
      const a = generateTrailSite(seed);
      const b = generateTrailSite(seed);
      assert.equal(a.length, b.length);
      assert.deepEqual(a.spine, b.spine);
      assert.deepEqual(a.branches, b.branches);
      assert.deepEqual(a.loc.stones, b.loc.stones);
      assert.deepEqual(a.exit, b.exit);
      assert.deepEqual(a.path, b.path);
      assert.deepEqual([...a.loc.blocked], [...b.loc.blocked]);
      assert.deepEqual(a.loc.evac, b.loc.evac);
    }
  });

  test('длина выпадает разная: пятнадцать сидов — не одна тропа', () => {
    const seen = new Set(sites.map((s) => s.length));
    assert.ok(seen.size >= 3, `на пятнадцати сидах длин ${seen.size}`);
  });
});
