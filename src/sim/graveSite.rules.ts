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
import { CLANS } from './world';
import { FENCE_CELL } from './fence';
import { EPITAPH_REACH, FIELD, WOOD, epitaphAt, generateGraveSite, readEpitaph } from './graveSite';
import { distanceField, idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateGraveSite);

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

  test('привидения есть, их немного, и все они внутри ограды', () => {
    for (const site of sites) {
      const { loc } = site;
      assert.ok(loc.enemies.length >= 2 && loc.enemies.length <= 4, `сид ${loc.seed}: ${loc.enemies.length}`);
      for (const e of loc.enemies) {
        assert.equal(e.kind, 'ghost', `сид ${loc.seed}: на кладбище не привидение`);
        // Внутри ограды — значит дальше от края, чем лес, поле и сама ограда.
        const inX = e.x > site.at.x && e.x < site.at.x + (loc.size - 2 * (WOOD + FIELD));
        const inZ = e.z > site.at.z && e.z < site.at.z + (loc.size - 2 * (WOOD + FIELD));
        assert.ok(inX && inZ, `сид ${loc.seed}: привидение ${e.x},${e.z} вне участка`);
      }
    }
  });

  test('в одной клетке не стоит двух отметок', () => {
    for (const site of sites) {
      const seen = new Set<string>();
      for (const mark of site.marks) {
        const key = `${mark.x}:${mark.z}`;
        assert.ok(!seen.has(key), `сид ${site.loc.seed}: две отметки в ${key}`);
        seen.add(key);
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

describe('Кладбище: что написано на камнях (§0.1)', () => {
  test('на камне надпись, на насыпи нет', () => {
    for (const site of sites) {
      for (const mark of site.marks) {
        if (mark.model === 'grave' || mark.model === 'coffin') {
          assert.equal(mark.epitaph, null, `${site.loc.seed}: на насыпи что-то написано`);
        } else {
          assert.ok(
            mark.epitaph !== null && mark.epitaph.length > 0,
            `${site.loc.seed}: камень ${mark.model} без надписи`,
          );
        }
      }
    }
  });

  /**
   * Главное правило раздела, и оно про §0.1, а не про текст: **на камне
   * не может стоять того, чего нет в игре**. Фракции эпитафий сверяются
   * с фракциями карты мира — переименуют клан, и правило упадёт, а не
   * оставит на кладбище имя, которого в мире больше нет.
   */
  test('фракции на камнях — те же, что на карте мира', () => {
    const stems = CLANS.map((c) => c.name.split(' ').pop()!.slice(0, 4));
    const seen = new Set<string>();
    for (const site of sites) {
      for (const mark of site.marks) {
        if (mark.epitaph === null) continue;
        const hit = stems.find((stem) => mark.epitaph!.includes(stem));
        assert.ok(hit !== undefined, `«${mark.epitaph}» — фракции нет на карте`);
        seen.add(hit);
      }
    }
    assert.equal(seen.size, CLANS.length, 'на камнях встретились не все фракции карты');
  });

  test('камень читается подходом, и читается ближайший', () => {
    for (const site of sites) {
      const stone = site.marks.find((m) => m.epitaph !== null);
      assert.ok(stone !== undefined);
      // Вплотную — читается он же.
      assert.equal(epitaphAt(site, stone.x, stone.z)?.epitaph, stone.epitaph);
      // Что бы ни прочиталось с любого места участка — оно в пределах
      // вытянутой руки. Проверять «этот камень, а не соседний» бессмысленно:
      // ряды идут через клетку, и с полутора клеток соседний бывает ближе.
      for (const mark of site.marks) {
        const read = epitaphAt(site, mark.x, mark.z);
        if (read === null) continue;
        const d = Math.hypot(read.x - mark.x, read.z - mark.z);
        assert.ok(d <= EPITAPH_REACH, `прочиталось с ${d.toFixed(2)} клетки`);
      }

      // Вдали от участка не читается ничего: надпись привязана к камню.
      assert.equal(epitaphAt(site, 0, 0), null, 'надпись слышна за оградой');
    }
  });

  test('надпись ничего не меняет: кладбище остаётся прогулкой', () => {
    // Чтение — чистая функция от места: два вызова подряд дают то же самое,
    // и ни один не трогает участок.
    for (const site of sites) {
      const before = JSON.stringify(site.marks);
      const stone = site.marks.find((m) => m.epitaph !== null)!;
      epitaphAt(site, stone.x, stone.z);
      epitaphAt(site, stone.x, stone.z);
      assert.equal(JSON.stringify(site.marks), before);
    }
  });
});

describe('Кладбище: надпись всплывает один раз на подход', () => {
  test('стоя у камня, игрок читает его один раз, а не каждый кадр', () => {
    const site = sites[0]!;
    const stone = site.marks.find((m) => m.epitaph !== null)!;
    let last: string | null = null;
    const said: string[] = [];
    // Шестьдесят кадров на одном месте — столько же, сколько секунда игры.
    for (let i = 0; i < 60; i++) {
      const read = readEpitaph(site, stone.x, stone.z, last);
      last = read.last;
      if (read.say !== null) said.push(read.say);
    }
    assert.equal(said.length, 1, `надпись всплыла ${said.length} раз`);
  });

  test('отошёл и вернулся — читает снова', () => {
    const site = sites[0]!;
    const stone = site.marks.find((m) => m.epitaph !== null)!;
    let last: string | null = null;
    const say = (x: number, z: number): string | null => {
      const read = readEpitaph(site, x, z, last);
      last = read.last;
      return read.say;
    };
    assert.ok(say(stone.x, stone.z) !== null, 'у камня не прочиталось');
    assert.equal(say(stone.x, stone.z), null, 'на месте повторилось');
    // Уйти за ограду, где камней нет вовсе, и вернуться.
    assert.equal(say(0, 0), null);
    assert.ok(say(stone.x, stone.z) !== null, 'вернувшись, не прочитал');
  });

  test('за один обход участка читается не одна надпись', () => {
    // Мерка простая: кладбище обязано быть населённым разными людьми.
    // Один текст на весь участок — это не кладбище, а копия одного камня.
    for (const site of sites) {
      let last: string | null = null;
      const said = new Set<string>();
      for (let z = 0; z < site.loc.size; z++) {
        for (let x = 0; x < site.loc.size; x++) {
          const read = readEpitaph(site, x, z, last);
          last = read.last;
          if (read.say !== null) said.add(read.say);
        }
      }
      assert.ok(said.size >= 3, `сид ${site.loc.seed}: на весь участок ${said.size} надписи`);
    }
  });
});
