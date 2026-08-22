/**
 * Правила лесной тропы (§6.1.17, §4). Локация обещает игроку три вещи,
 * и все три проверяются здесь, а не глазами.
 *
 * Первое: **по ней можно пройти**. Каждая открытая клетка достижима
 * от входа — виляние спины нигде не рвёт просеку.
 *
 * Второе: **она длинная**. Ход длиннее своей ширины минимум вдвое — это
 * и есть отличие тропы от участка, и меряется оно, а не оценивается.
 *
 * Третье: **это прогулка**. Ни добычи, ни валунов, ни противников:
 * пустая тропа — обещание карточки карты, и засады сюда придут своим
 * записанным решением, а не молча.
 *
 * И как у всякой точки карты: **один сид — одна тропа** (§4).
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CLEAR_HALF,
  DIRT_HALF,
  LEN_MAX,
  LEN_MIN,
  MEANDER,
  WOOD,
  generateTrailSite,
} from './trailSite';
import { idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateTrailSite);

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

  test('лес держит границу локации: край не вскрывается ни на одном сиде', () => {
    for (const site of sites) {
      const { loc } = site;
      for (let i = 0; i < loc.size; i++) {
        for (const [x, z] of [[i, 0], [i, loc.size - 1], [0, i], [loc.size - 1, i]] as const) {
          assert.equal(loc.blocked[idx(loc.size, x, z)], 1, `сид ${loc.seed}: край открыт в ${x},${z}`);
        }
      }
    }
  });
});

describe('Тропа: она длинная', () => {
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
      // Разброс спины входит в ширину: перо шире заявленного — форма поплыла.
      assert.ok(wide <= 2 * MEANDER + 2 * CLEAR_HALF + 1, `сид ${loc.seed}: ход расползся до ${wide}`);
    }
  });

  test('просека тесная: в любом столбце хода открыто не больше пяти клеток', () => {
    for (const site of sites) {
      const { loc } = site;
      for (let x = WOOD; x < WOOD + site.length; x++) {
        let open = 0;
        for (let z = 0; z < loc.size; z++) if (!loc.blocked[idx(loc.size, x, z)]) open++;
        assert.ok(open <= 2 * CLEAR_HALF + 1, `сид ${loc.seed}: столбец ${x} открыт на ${open}`);
        assert.ok(open >= 1, `сид ${loc.seed}: столбец ${x} перекрыт — ход порван`);
      }
    }
  });

  test('грунт лежит внутри просеки и уже её: обочина есть с обеих сторон', () => {
    for (const site of sites) {
      const { loc } = site;
      for (const c of site.path) {
        assert.equal(loc.blocked[idx(loc.size, c.x, c.z)], 0, `сид ${loc.seed}: грунт в лесу`);
      }
      for (let x = WOOD; x < WOOD + site.length; x++) {
        const dirt = site.path.filter((c) => c.x === x).length;
        assert.equal(dirt, 2 * DIRT_HALF + 1, `сид ${loc.seed}: в столбце ${x} грунта ${dirt}`);
      }
    }
  });
});

describe('Тропа: это прогулка', () => {
  test('ни добычи, ни валунов, ни противников — ни на одном сиде', () => {
    for (const site of sites) {
      assert.equal(site.loc.containers.length, 0, `сид ${site.loc.seed}: на тропе добыча`);
      assert.equal(site.loc.stones.length, 0, `сид ${site.loc.seed}: на тропе валуны`);
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: на тропе противники`);
    }
  });
});

describe('Тропа: один сид — одна тропа', () => {
  test('два вызова с одним сидом дают одно и то же', () => {
    for (const seed of SEEDS) {
      const a = generateTrailSite(seed);
      const b = generateTrailSite(seed);
      assert.equal(a.length, b.length);
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
