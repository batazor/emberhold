/**
 * Правила гарнизона (§6.1.6). Гарнизон обещает четыре вещи, и все четыре
 * проверяются здесь, а не глазами.
 *
 * Первое: **он ходит по земле, а не сквозь неё**. Каждая точка обхода —
 * свободная клетка локации, при любом плане и любом вырезанном угле.
 *
 * Второе: **он ничего не решает**. Ни одной клетки он не занимает,
 * в противниках локации его нет, и заход в замок остаётся прогулкой.
 *
 * Третье: **стрелок стоит на стене**. Его клетка — та, где стена, его
 * высота — измеренная площадка хода, и смотрит он наружу.
 *
 * Четвёртое: **смена непрерывна**. Стрелок выходит с края участка, доходит
 * до места и возвращается тем же путём: ни телепорта, ни появления посреди
 * прогона.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CASTLE_CELL, DIRS, deckOf, keyOf, partOf } from './castle';
import { atTrader, generateCastleSite, inYard } from './castleSite';
import {
  ARCHER_CYCLE,
  ARCHER_SPEED,
  DWELLER_SPEED,
  DWELLER_STAND,
  PATROL_SPEED,
  SQUAD,
  SQUAD_STEP,
  archerAt,
  dwellersAt,
  garrisonOf,
  patrolAt,
} from './garrison';
import { idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateCastleSite);
const guards = sites.map((site) => ({ site, g: garrisonOf(site) }));

/** Час игры с шагом в четверть секунды: смен стрелка в нём семьдесят пять. */
const HOUR = 3600;
const TICK = 0.25;

describe('Гарнизон: отряд обходит периметр', () => {
  test('каждая точка тропы — свободная клетка локации', () => {
    for (const { site, g } of guards) {
      const { loc } = site;
      for (let t = 0; t < g.length / PATROL_SPEED; t += TICK) {
        for (const man of patrolAt(g, t)) {
          const x = Math.round(man.x);
          const z = Math.round(man.z);
          assert.ok(
            x >= 0 && z >= 0 && x < loc.size && z < loc.size,
            `сид ${loc.seed}: ${x},${z} вне локации`,
          );
          assert.equal(
            loc.blocked[idx(loc.size, x, z)],
            0,
            `сид ${loc.seed}: тропа идёт сквозь занятое ${x},${z}`,
          );
        }
      }
    }
  });

  test('тропа охватывает замок: след постройки внутри неё', () => {
    for (const { site, g } of guards) {
      const x0 = Math.min(...g.route.map((p) => p.x));
      const x1 = Math.max(...g.route.map((p) => p.x));
      const z0 = Math.min(...g.route.map((p) => p.z));
      const z1 = Math.max(...g.route.map((p) => p.z));
      for (const piece of site.castle.pieces) {
        const x = site.at.x + piece.x * CASTLE_CELL;
        const z = site.at.z + piece.z * CASTLE_CELL;
        assert.ok(
          x > x0 && x + CASTLE_CELL - 1 < x1 && z > z0 && z + CASTLE_CELL - 1 < z1,
          `сид ${site.loc.seed}: деталь ${piece.model} ${x},${z} вне тропы`,
        );
      }
    }
  });

  test('отряд идёт колонной: соседи на своём интервале', () => {
    for (const { site, g } of guards) {
      for (let t = 0; t < 120; t += TICK) {
        const men = patrolAt(g, t);
        assert.equal(men.length, SQUAD);
        for (let i = 1; i < men.length; i++) {
          const dx = men[i]!.x - men[i - 1]!.x;
          const dz = men[i]!.z - men[i - 1]!.z;
          const gap = Math.hypot(dx, dz);
          // На углу колонна складывается, и по прямой между соседями
          // становится меньше клеток, чем пройдено ногами. Меньше половины
          // интервала не бывает: угол один, а шагов между соседями больше.
          assert.ok(
            gap > SQUAD_STEP * 0.5 && gap < SQUAD_STEP * 1.5,
            `сид ${site.loc.seed}: интервал ${gap.toFixed(2)} при ${SQUAD_STEP}`,
          );
        }
      }
    }
  });

  test('обход замкнут: круг возвращает отряд туда же', () => {
    for (const { site, g } of guards) {
      const lap = g.length / PATROL_SPEED;
      const before = patrolAt(g, 3)[0]!;
      const after = patrolAt(g, 3 + lap)[0]!;
      assert.ok(
        Math.hypot(before.x - after.x, before.z - after.z) < 1e-6,
        `сид ${site.loc.seed}: круг не сошёлся`,
      );
    }
  });

  test('шаг непрерывен: между кадрами никто не прыгает', () => {
    for (const { site, g } of guards) {
      let prev = patrolAt(g, 0);
      for (let t = TICK; t < 300; t += TICK) {
        const men = patrolAt(g, t);
        for (let i = 0; i < men.length; i++) {
          const step = Math.hypot(men[i]!.x - prev[i]!.x, men[i]!.z - prev[i]!.z);
          assert.ok(
            step <= PATROL_SPEED * TICK + 1e-9,
            `сид ${site.loc.seed}: рыцарь ${i} прошёл ${step.toFixed(3)} за ${TICK} с`,
          );
        }
        prev = men;
      }
    }
  });

  test('гарнизон ничего не решает: локация по-прежнему пуста', () => {
    for (const { site } of guards) {
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: в замке завелись противники`);
      assert.equal(site.loc.containers.length, 0, `сид ${site.loc.seed}: в замке завелась добыча`);
    }
  });
});

describe('Гарнизон: стрелок на стене', () => {
  test('стрелку есть куда выйти при любом сиде', () => {
    for (const { site, g } of guards) {
      assert.ok(g.runs.length > 0, `сид ${site.loc.seed}: верх стены не проходим нигде`);
      for (const run of g.runs) assert.ok(run.posts.length > 0);
    }
  });

  test('участки рвутся ровно там, где ход кончается', () => {
    for (const { site, g } of guards) {
      // Считаем проходимые клетки кольца сами, тем же правилом §6.1.6 —
      // площадка есть и открытое ребро есть, — и сверяем с тем, что нарезал
      // гарнизон. Разойтись эти два счёта могут только вместе с набором.
      const walkable = site.castle.ring.filter((spot) => {
        const piece = site.castle.pieces.find(
          (p) => p.x === spot.x && p.z === spot.z && p.y === 0 && p.role !== 'двор',
        );
        if (piece === undefined) return false;
        const part = partOf(piece.model);
        return deckOf(piece.model) !== null && part !== undefined && part.open.some(Boolean);
      });
      const posts = g.runs.reduce((sum, run) => sum + run.posts.length, 0);
      assert.equal(posts, walkable.length, `сид ${site.loc.seed}: клеток верха не столько`);
    }
  });

  test('каждый пост стоит на стене и на измеренной высоте', () => {
    for (const { site, g } of guards) {
      const { loc } = site;
      for (const run of g.runs) {
        for (const post of run.posts) {
          const x = Math.round(post.x);
          const z = Math.round(post.z);
          assert.equal(
            loc.blocked[idx(loc.size, x, z)],
            1,
            `сид ${loc.seed}: пост ${x},${z} не на стене`,
          );
          // Ход набора — 1,18 и 1,31 в его единицах; в клетках локации это
          // вдвое больше. Обе высоты выше героя (1,38), и это то самое
          // обещание §6.1.6: по стене ходят над головой.
          assert.ok(
            post.y > 2.3 && post.y < 2.7,
            `сид ${loc.seed}: пост на высоте ${post.y}`,
          );
        }
      }
    }
  });

  /**
   * Наружная сторона считается по восьми направлениям, а не по четырём,
   * и это тот же счёт, каким §6.1.6 считает саму стену: у внутреннего угла
   * выреза все четыре стороны заняты стеной и двором, а наружу он выходит
   * углом. По четырём такая клетка «смотрела» бы на север — и стрелок стоял
   * бы на ней спиной к полю.
   */
  test('у каждой клетки верха есть наружная сторона', () => {
    for (const { site } of guards) {
      const ring = new Set(site.castle.ring.map(keyOf));
      const yard = new Set(site.castle.yard.map(keyOf));
      const eight = [...DIRS, [-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
      for (const spot of site.castle.ring) {
        const out = eight.filter(([dx, dz]) => {
          const key = `${spot.x + dx}:${spot.z + dz}`;
          return !ring.has(key) && !yard.has(key);
        });
        assert.ok(out.length > 0, `сид ${site.loc.seed}: клетка ${keyOf(spot)} не смотрит наружу`);
      }
    }
  });

  test('стрелка нет дольше, чем есть', () => {
    for (const { site, g } of guards) {
      let present = 0;
      let total = 0;
      for (let t = 0; t < HOUR; t += TICK) {
        total++;
        if (archerAt(g, t) !== null) present++;
      }
      const share = present / total;
      assert.ok(
        share > 0.2 && share < 0.5,
        `сид ${site.loc.seed}: стрелок на стене ${(share * 100) | 0}% времени`,
      );
    }
  });

  test('смена одна на цикл, и она непрерывна', () => {
    for (const { site, g } of guards) {
      let shifts = 0;
      let was = false;
      for (let t = 0; t < ARCHER_CYCLE * 20; t += TICK) {
        const now = archerAt(g, t) !== null;
        if (now && !was) shifts++;
        was = now;
      }
      assert.equal(shifts, 20, `сид ${site.loc.seed}: смен ${shifts} на двадцать циклов`);
    }
  });

  test('стрелок не прыгает: путь смены непрерывен', () => {
    for (const { site, g } of guards) {
      let prev = archerAt(g, 0);
      for (let t = TICK; t < ARCHER_CYCLE * 6; t += TICK) {
        const now = archerAt(g, t);
        if (prev !== null && now !== null) {
          const step = Math.hypot(now.x - prev.x, now.z - prev.z);
          assert.ok(
            step <= ARCHER_SPEED * TICK + 1e-9,
            `сид ${site.loc.seed}: стрелок прошёл ${step.toFixed(3)} за ${TICK} с`,
          );
        }
        prev = now;
      }
    }
  });

  /**
   * Край участка — там, где стоит башня или ворота: выйти на стену больше
   * неоткуда. Сверяется расстоянием, а не совпадением клеток: кадры берутся
   * сеткой в четверть секунды, и последний кадр смены отстоит от края
   * на пройденное за эту четверть.
   */
  test('выходит и уходит стрелок краем участка', () => {
    for (const { site, g } of guards) {
      const ends = g.runs.flatMap((run) => [run.posts[0]!, run.posts[run.posts.length - 1]!]);
      let prev = archerAt(g, 0);
      for (let t = TICK; t < ARCHER_CYCLE * 6; t += TICK) {
        const now = archerAt(g, t);
        const born = prev === null && now !== null;
        const gone = prev !== null && now === null;
        if (born || gone) {
          const at = born ? now! : prev!;
          const near = Math.min(...ends.map((e) => Math.hypot(e.x - at.x, e.z - at.z)));
          assert.ok(
            near <= ARCHER_SPEED * TICK + 1e-9,
            `сид ${site.loc.seed}: смена ${born ? 'началась' : 'кончилась'} в ${near.toFixed(2)} от края`,
          );
        }
        prev = now;
      }
    }
  });

  test('один сид — одна очередь смен', () => {
    for (const { site } of guards) {
      const a = garrisonOf(site);
      const b = garrisonOf(site);
      for (let t = 0; t < ARCHER_CYCLE * 3; t += 1.7) {
        assert.deepEqual(archerAt(a, t), archerAt(b, t), `сид ${site.loc.seed}: смены разошлись`);
        assert.deepEqual(patrolAt(a, t), patrolAt(b, t), `сид ${site.loc.seed}: обход разошёлся`);
      }
    }
  });
});

/**
 * Жильцы двора (§6.1.6.1). Гарнизон отвечает на вопрос «замок чей-то»,
 * жильцы — на вопрос «в замке живут». Проверяется здесь то же, что у отряда,
 * и той же меркой: обход замкнут, лежит там, где ему положено, и считается
 * из времени, а не из состояния.
 */
describe('Замок: жильцы двора', () => {
  test('жильцы есть, и двор ими не забит', () => {
    for (const { site, g } of guards) {
      assert.ok(g.yard.length >= 2, `сид ${site.loc.seed}: двор пуст`);
      assert.ok(g.yard.length <= 4, `сид ${site.loc.seed}: жильцов ${g.yard.length} — это толпа`);
      let free = 0;
      for (let z = 0; z < site.loc.size; z++) {
        for (let x = 0; x < site.loc.size; x++) {
          if (inYard(site, { x, z }) && site.loc.blocked[idx(site.loc.size, x, z)] === 0) free++;
        }
      }
      /**
       * Десять — измеренный минимум, и берётся он не плотностью, а нижним
       * порогом в двоих: на самом тесном дворе порог плотность перебивает.
       * Порог сохранён потому, что двор без жильцов не выполняет обещания
       * карточки, а двое на два десятка клеток — всё ещё двор, а не толпа.
       */
      assert.ok(
        free / g.yard.length >= 10,
        `сид ${site.loc.seed}: ${free} свободных клеток двора на ${g.yard.length} жильцов`,
      );
    }
  });

  test('обход замкнут, лежит во дворе и не идёт сквозь занятое', () => {
    for (const { site, g } of guards) {
      for (const w of g.yard) {
        // Обход из одной клетки бывает ровно у одного жильца — торговца:
        // он стоит на месте, и это его работа (§13.5).
        if (w.path.length === 1) {
          assert.ok(site.trader !== null, `сид ${site.loc.seed}: стоящий жилец без лавки`);
          assert.deepEqual(w.path[0], site.trader, `сид ${site.loc.seed}: стоит не на лавке`);
          continue;
        }
        assert.ok(w.path.length >= 2, `сид ${site.loc.seed}: обход из одной клетки`);
        for (const c of w.path) {
          assert.ok(inYard(site, c), `сид ${site.loc.seed}: обход вышел за двор в ${c.x},${c.z}`);
          assert.equal(
            site.loc.blocked[idx(site.loc.size, c.x, c.z)],
            0,
            `сид ${site.loc.seed}: обход идёт сквозь занятую клетку ${c.x},${c.z}`,
          );
        }
        assert.ok(w.cycle > 0, `сид ${site.loc.seed}: круг нулевой длины`);
      }
    }
  });

  test('облики разные: двор не собран из одинаковых', () => {
    const seen = new Set(guards.flatMap(({ g }) => g.yard.map((w) => w.look)));
    assert.equal(seen.size, 2, `обликов встретилось ${seen.size}`);
  });

  test('за круг жилец не покидает двора и возвращается к началу', () => {
    for (const { site, g } of guards) {
      for (let i = 0; i < g.yard.length; i++) {
        const w = g.yard[i]!;
        const start = dwellersAt(g, 0)[i]!;
        // Полный круг: тот же кадр, и это и есть смысл слова «замкнут».
        const round = dwellersAt(g, w.cycle)[i]!;
        assert.ok(
          Math.hypot(round.x - start.x, round.z - start.z) < 1e-6,
          `сид ${site.loc.seed}: за круг жилец ${i} не вернулся`,
        );
        for (let t = 0; t < w.cycle; t += 0.25) {
          const man = dwellersAt(g, t)[i]!;
          assert.ok(
            inYard(site, { x: Math.round(man.x), z: Math.round(man.z) }),
            `сид ${site.loc.seed}: на ${t.toFixed(2)} с жилец ${i} вне двора`,
          );
        }
      }
    }
  });

  test('жилец идёт своим шагом и стоит на углах', () => {
    for (const { site, g } of guards) {
      for (let i = 0; i < g.yard.length; i++) {
        const w = g.yard[i]!;
        let stood = 0;
        let moved = 0;
        const STEP = 1 / 60;
        for (let t = 0; t + STEP <= w.cycle; t += STEP) {
          const a = dwellersAt(g, t)[i]!;
          const b = dwellersAt(g, t + STEP)[i]!;
          const step = Math.hypot(b.x - a.x, b.z - a.z);
          assert.ok(
            step <= DWELLER_SPEED * STEP + 1e-6,
            `сид ${site.loc.seed}: жилец ${i} прыгнул на ${step.toFixed(3)}`,
          );
          if (a.walking) moved += step; else stood += STEP;
        }
        if (w.path.length === 1) {
          // Торговец не ходит вовсе, и это проверяется, а не подразумевается:
          // ушедшая лавка — это панель, открывающаяся от пустого места.
          assert.equal(moved, 0, `сид ${site.loc.seed}: торговец сошёл с места`);
          continue;
        }
        assert.ok(moved > 1, `сид ${site.loc.seed}: жилец ${i} прошёл за круг ${moved.toFixed(2)}`);
        assert.ok(
          stood > DWELLER_STAND,
          `сид ${site.loc.seed}: жилец ${i} за круг ни разу не постоял`,
        );
      }
    }
  });

  /**
   * До жильцов лавка была точкой без тела, и во дворе, где никого нет, это
   * никому не мешало. С жильцами невидимый торговец стал бы единственным
   * невидимым человеком среди видимых. Правило держит это на месте.
   */
  test('у торговца есть тело, и оно стоит на его клетке', () => {
    for (const { site, g } of guards) {
      if (site.trader === null) continue;
      const standing = g.yard.filter((w) => w.path.length === 1);
      assert.equal(standing.length, 1, `сид ${site.loc.seed}: стоящих ${standing.length}`);
      const man = dwellersAt(g, 17.3)[g.yard.indexOf(standing[0]!)]!;
      assert.ok(
        atTrader(site, man.x, man.z),
        `сид ${site.loc.seed}: тело торговца не дотягивается до его лавки`,
      );
      assert.equal(man.walking, false, `сид ${site.loc.seed}: торговец идёт`);
    }
  });

  test('время, а не состояние: тот же момент даёт тот же кадр', () => {
    for (const { g } of guards) {
      for (const t of [0, 3.7, 41, 1000.25]) {
        assert.deepEqual(dwellersAt(g, t), dwellersAt(g, t));
      }
    }
  });
});
