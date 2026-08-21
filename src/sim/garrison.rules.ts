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
  STANDING_LOOKS,
  PATROL_SPEED,
  SQUAD,
  archerAt,
  dwellersAt,
  garrisonOf,
  patrolAt,
  PATROL_SPREAD_MAX,
  PATROL_STEP_MAX,
  PATROL_WALK,
  PATROL_STAND,
} from './garrison';
import { BODY } from './crowd';
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

  /**
   * Прежде здесь стояло «соседи на своём интервале»: колонна шла жёстко,
   * и проверялось, что промежуток между соседями не уходит дальше половины
   * от `SQUAD_STEP`. Такой отряд читался не караулом, а деталью механизма,
   * и правило вместе с ним заменено на два числа: колонна **не рассыпается**
   * и при этом **не идёт одной ногой**.
   */
  test('колонна не рассыпается: разброс держится в своих клетках', () => {
    for (const { site, g } of guards) {
      for (let t = 0; t < 300; t += TICK) {
        const men = patrolAt(g, t);
        assert.equal(men.length, SQUAD);
        for (let i = 0; i < men.length; i++) {
          for (let j = i + 1; j < men.length; j++) {
            const gap = Math.hypot(men[i]!.x - men[j]!.x, men[i]!.z - men[j]!.z);
            assert.ok(
              gap <= PATROL_SPREAD_MAX,
              `сид ${site.loc.seed}: отряд растянулся на ${gap.toFixed(2)} при потолке ${PATROL_SPREAD_MAX}`,
            );
          }
        }
      }
    }
  });

  test('каждый рыцарь и идёт, и стоит', () => {
    const cycle = PATROL_WALK + PATROL_STAND;
    for (const { site, g } of guards) {
      const walked = new Array(SQUAD).fill(0);
      const stood = new Array(SQUAD).fill(0);
      for (let t = 0; t < cycle * 2; t += TICK) {
        patrolAt(g, t).forEach((man, i) => {
          if (man.walking) walked[i]++;
          else stood[i]++;
        });
      }
      for (let i = 0; i < SQUAD; i++) {
        assert.ok(walked[i] > 0, `сид ${site.loc.seed}: рыцарь ${i} не идёт вовсе`);
        assert.ok(stood[i] > 0, `сид ${site.loc.seed}: рыцарь ${i} не стоит вовсе`);
      }
    }
  });

  /**
   * Обгон — не украшение, а то, ради чего у каждого своя фаза. Стоящего
   * обходит тот, кто сзади: стоянка стоит 3,9 клетки пути против интервала
   * в 1,3. Проверяется по `along` — сколько рыцарь прошёл ногами: у обогнавшего
   * число становится больше, чем у обойдённого.
   *
   * Требуется не «на каждом сиде», а «на большинстве»: фазы случайны, и сид,
   * на котором четверо разошлись почти в такт, — законный сид, а не поломка.
   */
  test('задний обходит переднего, и не на одном сиде', () => {
    let seen = 0;
    for (const { g } of guards) {
      const first = patrolAt(g, 0);
      let swapped = false;
      for (let t = TICK; t < 300 && !swapped; t += TICK) {
        const men = patrolAt(g, t);
        for (let i = 0; i < SQUAD && !swapped; i++) {
          for (let j = i + 1; j < SQUAD; j++) {
            const was = first[i]!.along - first[j]!.along;
            const now = men[i]!.along - men[j]!.along;
            if (was * now < 0) { swapped = true; break; }
          }
        }
      }
      if (swapped) seen++;
    }
    assert.ok(seen * 2 >= guards.length, `обгон виден только на ${seen} сидах из ${guards.length}`);
  });

  test('никто не пятится: пройденное ногами только растёт', () => {
    for (const { site, g } of guards) {
      let prev = patrolAt(g, 0);
      for (let t = TICK; t < 200; t += TICK) {
        const men = patrolAt(g, t);
        for (let i = 0; i < SQUAD; i++) {
          assert.ok(
            men[i]!.along >= prev[i]!.along - 1e-9,
            `сид ${site.loc.seed}: рыцарь ${i} сдал назад`,
          );
        }
        prev = men;
      }
    }
  });

  /**
   * Прежде проверялось, что через круг отряд стоит там же. С личным ходом
   * это неверно и не должно быть верным: у каждого свои стоянки, и «круг»
   * в секундах у них разный. Обещание, которое осталось, — тропа замкнута:
   * рыцарь обходит все четыре угла и возвращается, а не упирается в конец
   * списка точек.
   */
  test('тропа замкнута: рыцарь обходит все четыре угла', () => {
    for (const { site, g } of guards) {
      const lap = g.length / PATROL_SPEED * 1.6;
      const near = g.route.map(() => false);
      for (let t = 0; t < lap; t += TICK) {
        const man = patrolAt(g, t)[0]!;
        g.route.forEach((corner, k) => {
          if (Math.hypot(man.x - corner.x, man.z - corner.z) < 1.6) near[k] = true;
        });
      }
      near.forEach((hit, k) => {
        assert.ok(hit, `сид ${site.loc.seed}: угол ${k} тропы не пройден за круг с запасом`);
      });
    }
  });

  /**
   * Обход ходит в обе стороны, а маршрут записан один. Лицо, снятое с отрезка
   * маршрута, а не с направления движения, на половине сидов смотрело назад —
   * и путь, и шаг, и круг при этом сходились, поэтому ни одна прежняя проверка
   * этого не поймала. Ловится оно только так: куда шагнул за кадр — туда
   * и должен смотреть.
   */
  test('отряд идёт лицом вперёд, в какую сторону ни шёл бы обход', () => {
    for (const { site, g } of guards) {
      for (let t = 1; t < 60; t += 1.7) {
        const now = patrolAt(g, t)[0]!;
        const next = patrolAt(g, t + TICK)[0]!;
        const dx = next.x - now.x;
        const dz = next.z - now.z;
        const step = Math.hypot(dx, dz);
        if (step < 1e-6) continue;
        // На повороте лицо уже новой стороны, а шаг ещё старой: угол между
        // ними там честные 90°, и такие кадры проверять нечем.
        const dot = (dx / step) * Math.sin(now.facing) + (dz / step) * Math.cos(now.facing);
        assert.ok(
          dot > 0,
          `сид ${site.loc.seed}, way ${g.way}, t=${t.toFixed(1)}: идёт спиной вперёд (${dot.toFixed(2)})`,
        );
      }
    }
  });

  /**
   * Потолок шага двойной, и это не поблажка, а два разных обещания.
   *
   * Идущий сам по себе не может пройти за кадр больше, чем прошёл ногами:
   * тут потолок — скорость обхода с надбавкой на кривизну полосы
   * (`PATROL_STEP_MAX`). А кадр, на котором рядом кто-то ближе `BODY`, —
   * это кадр, где работает разведение (`sim/crowd.ts`), и сдвиг в сторону
   * там законен: он и есть «не проходят сквозь». Его потолок свой — ширина
   * тела: дальше разводить незачем, ближе не разведёшь.
   */
  test('шаг непрерывен: между кадрами никто не прыгает', () => {
    // Кадр здесь настоящий, а не крупный шаг правил: на четверти секунды
    // рыцарь успевает сойтись с соседом и разойтись целиком между двумя
    // замерами, и проверка «тесно ли сейчас» промахивается мимо всего,
    // что случилось внутри интервала.
    const FRAME = 1 / 60;
    for (const { site, g } of guards) {
      let prev = patrolAt(g, 0);
      for (let t = FRAME; t < 120; t += FRAME) {
        const men = patrolAt(g, t);
        for (let i = 0; i < men.length; i++) {
          const step = Math.hypot(men[i]!.x - prev[i]!.x, men[i]!.z - prev[i]!.z);
          // Тесно — если тесно было хоть на одном из двух кадров: разведение
          // работает и на том, где оно как раз развело.
          const crowded = men.some((o, j) =>
            j !== i && Math.hypot(o.x - men[i]!.x, o.z - men[i]!.z) < BODY + 1e-6)
            || prev.some((o, j) =>
              j !== i && Math.hypot(o.x - prev[i]!.x, o.z - prev[i]!.z) < BODY + 1e-6);
          const cap = PATROL_SPEED * FRAME * PATROL_STEP_MAX + (crowded ? BODY : 0);
          assert.ok(
            step <= cap + 1e-9,
            `сид ${site.loc.seed}: рыцарь ${i} прошёл ${step.toFixed(3)} за кадр`,
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
      const walking = g.yard.filter((w) => w.path.length > 1);
      const standing = g.yard.filter((w) => w.path.length === 1);
      assert.ok(g.yard.length >= 2, `сид ${site.loc.seed}: двор пуст`);
      assert.ok(walking.length <= 4, `сид ${site.loc.seed}: гуляющих ${walking.length} — это толпа`);
      // Стоящих не больше трёх: торговец (§13.5) и два ремесленника (§6.1.13).
      assert.ok(standing.length <= 3, `сид ${site.loc.seed}: стоящих ${standing.length}`);
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
       * Мерится он по гуляющим: стоящий у края клеток обхода не ест.
       */
      assert.ok(
        free / Math.max(1, walking.length) >= 10,
        `сид ${site.loc.seed}: ${free} свободных клеток двора на ${walking.length} гуляющих`,
      );
    }
  });

  test('обход замкнут, лежит во дворе и не идёт сквозь занятое', () => {
    for (const { site, g } of guards) {
      for (const w of g.yard) {
        // Обход из одной клетки бывает только у стоящих: торговец на лавке
        // (§13.5), кузнец и охотник у края двора (§6.1.13).
        if (w.path.length === 1) {
          assert.ok(STANDING_LOOKS.has(w.look), `сид ${site.loc.seed}: гуляющий «${w.look}» встал`);
          if (w.look === 'торговец') {
            assert.ok(site.trader !== null, `сид ${site.loc.seed}: стоящий торговец без лавки`);
            assert.deepEqual(w.path[0], site.trader, `сид ${site.loc.seed}: стоит не на лавке`);
          } else {
            const c = w.path[0]!;
            assert.ok(inYard(site, c), `сид ${site.loc.seed}: «${w.look}» стоит вне двора`);
            assert.equal(
              site.loc.blocked[idx(site.loc.size, c.x, c.z)],
              0,
              `сид ${site.loc.seed}: «${w.look}» стоит в занятой клетке`,
            );
          }
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
    // Четыре облика: гуляющий поселенец, стоящие торговец, кузнец и охотник.
    assert.equal(seen.size, 4, `обликов встретилось ${seen.size}`);
    assert.ok(seen.has('кузнец') && seen.has('охотник'), 'ремесленники §6.1.13 не встали ни в один двор');
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
          // Та же двойная мерка, что у обхода: на кадре с разведением сдвиг
          // в сторону законен, и потолок ему — ширина тела.
          const before = dwellersAt(g, t);
          const after = dwellersAt(g, t + STEP);
          const crowded = before.some((o, j) =>
            j !== i && Math.hypot(o.x - a.x, o.z - a.z) < BODY + 1e-6)
            || after.some((o, j) => j !== i && Math.hypot(o.x - b.x, o.z - b.z) < BODY + 1e-6);
          assert.ok(
            step <= DWELLER_SPEED * STEP + (crowded ? BODY : 0) + 1e-6,
            `сид ${site.loc.seed}: жилец ${i} прыгнул на ${step.toFixed(3)}`,
          );
          if (a.walking) moved += step; else stood += STEP;
        }
        if (w.path.length === 1) {
          // Стоящий не ходит вовсе, и это проверяется, а не подразумевается:
          // ушедшая лавка — панель от пустого места, а ремесленник без
          // скелета (§6.1.13) не идёт, а скользит.
          assert.equal(moved, 0, `сид ${site.loc.seed}: «${w.look}» сошёл с места`);
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
      const traders = g.yard.filter((w) => w.look === 'торговец');
      assert.equal(traders.length, 1, `сид ${site.loc.seed}: торговцев ${traders.length}`);
      const man = dwellersAt(g, 17.3)[g.yard.indexOf(traders[0]!)]!;
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
