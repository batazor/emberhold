/**
 * Правила лагеря. Живут рядом с camp.ts, а не в общем файле проверок:
 * фича приносит свои правила с собой, и два агента никогда не правят
 * один и тот же файл ради своих проверок.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ARROW_PACK,
  ARROW_PACK_COST,
  BUILD_COST,
  MAX_LEVEL,
  buyArrows,
  campArea,
  completeIfDue,
  createCamp,
  freeWindow,
  kitchenFood,
  moveBuilding,
  speedup,
  speedupCost,
  setOffhand,
  startUpgrade,
  storageCapacity,
  suggestUpgrade,
  upgradeBlock,
  upgradeProgress,
  villagerCount,
} from './camp';
import { modelKitchenFood, roundNice, tierForLevel } from './balance';
import { LOOT_SHARE } from './resources';
import type { ResourceKind } from './resources';
import { bowQuiver } from './gear';

describe('Лагерь', () => {
  test('§20.4 — здание не может превысить Жильё', () => {
    const camp = createCamp();
    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999 };
    assert.equal(upgradeBlock(camp, 'kitchen'), 'hq-cap');
    assert.equal(upgradeBlock(camp, 'hq'), 'ok');
  });

  test('§20.1 — слот один', () => {
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 0 , infirmary: 0, yard: 0};
    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999 };
    assert.equal(startUpgrade(camp, 'kitchen', 1000), true);
    assert.equal(upgradeBlock(camp, 'storage'), 'slot-busy');
    assert.equal(startUpgrade(camp, 'storage', 1000), false);
  });

  test('стоимость списывается ровно один раз', () => {
    const camp = createCamp();
    camp.resources = { stone: 10, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    assert.equal(camp.resources.wood, 10 - (BUILD_COST[2]?.wood ?? 0));
    assert.equal(camp.resources.stone, 10 - (BUILD_COST[2]?.stone ?? 0));
  });

  test('не хватает ресурсов — стройка не начинается', () => {
    const camp = createCamp();
    assert.equal(upgradeBlock(camp, 'hq'), 'resources');
    assert.equal(startUpgrade(camp, 'hq', 0), false);
    assert.equal(camp.construction, null);
  });

  test('§20.2 — таймер 3 минуты и достройка по времени', () => {
    const camp = createCamp();
    camp.resources = { stone: 10, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 1000);
    assert.equal(camp.construction?.endsAt, 1000 + 180);
    assert.equal(completeIfDue(camp, 1100), null, 'раньше срока не достраивается');
    assert.equal(completeIfDue(camp, 1180), 'hq');
    assert.equal(camp.levels.hq, 2);
    assert.equal(camp.construction, null);
  });

  test('оффлайн-прогресс: стройка завершается «за время отсутствия»', () => {
    const camp = createCamp();
    camp.resources = { stone: 10, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    // Игрок закрыл игру и вернулся через сутки.
    assert.equal(completeIfDue(camp, 86400), 'hq');
    assert.equal(camp.levels.hq, 2);
  });

  test('§20.5 — бесплатное окно min(5 мин, 25% таймера)', () => {
    const threeMin = 3 * 60;
    const eightHours = 8 * 3600;
    assert.equal(freeWindow(threeMin), 45, 'у трёхминутной стройки окно 45 секунд');
    assert.equal(freeWindow(12 * 60), 180, 'у двенадцатиминутной — три минуты');
    assert.equal(freeWindow(45 * 60), 300, 'дальше упирается в потолок пяти минут');
    assert.equal(freeWindow(eightHours), 300, 'у длинных окно прежнее');

    assert.equal(speedupCost(45, threeMin), 0, 'внутри окна даром');
    assert.ok(speedupCost(threeMin, threeMin) > 0, 'с первой секунды — уже нет');
    assert.equal(speedupCost(300, eightHours), 0, 'для длинной стройки пять минут даром');
    assert.equal(speedupCost(0, eightHours), 0);
    // ×1.5 за каждый час: ускорять ночную стройку невыгодно.
    assert.ok(speedupCost(eightHours, eightHours) > speedupCost(3 * 3600, 3 * 3600) * 10);
  });

  test('ускорение длинной стройки тратит камень и завершает её', () => {
    const camp = createCamp();
    camp.levels = { hq: 5, kitchen: 4, storage: 1, forge: 0 , infirmary: 0, yard: 0};
    camp.resources = { stone: 9999, wood: 9999, iron: 9999, crystal: 9999 };
    startUpgrade(camp, 'kitchen', 0); // до ур. 5 — три часа
    const before = camp.resources.stone;
    assert.equal(speedup(camp, 0), true);
    assert.ok(camp.resources.stone < before, 'камень списан');
    assert.equal(camp.levels.kitchen, 5);
    assert.equal(camp.construction, null);
  });

  /**
   * Столкновение §20.2 и §20.5, которое чинит долевое окно.
   * Раньше трёхминутная стройка целиком лежала внутри плоских пяти минут,
   * и первый таймер игры пропускался даром. Теперь у неё есть 2 мин 15 с,
   * которые действительно надо ждать или оплачивать.
   */
  test('первый таймер игры больше не пропускается даром', () => {
    const camp = createCamp();
    camp.resources = { stone: 100, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    const c = camp.construction!;
    const total = c.endsAt - c.startedAt;

    assert.ok(speedupCost(total, total) > 0, 'сразу после начала ускорение платное');
    assert.equal(speedupCost(40, total), 0, 'последние 45 секунд — бесплатны');

    const stone = camp.resources.stone;
    assert.equal(speedup(camp, 0), true);
    assert.ok(camp.resources.stone < stone, 'камень потрачен');
    assert.equal(camp.levels.hq, 2);
  });

  test('§16.1 — Мастерская ур. 1 стоит камня и встаёт без таймера', () => {
    const camp = createCamp();
    camp.levels.hq = 2; // жильё после второго акта пролога
    camp.resources = { stone: 1, wood: 99, iron: 99, crystal: 99 };
    assert.equal(upgradeBlock(camp, 'forge'), 'resources', 'на один камень не встаёт');

    camp.resources.stone = BUILD_COST[1]?.stone ?? 0;
    assert.equal(startUpgrade(camp, 'forge', 0), true);
    assert.equal(camp.levels.forge, 1, 'первый уровень мгновенный — таймера нет');
    assert.equal(camp.construction, null);
    assert.equal(camp.resources.stone, 0, 'камень ушёл на глазах');
  });

  test('цена первого уровня бьёт только Мастерскую', () => {
    // Кухня, Склад и жильё стоят в лагере с ур. 1 и на ключ `1` не выходят
    // никогда: если это перестанет быть правдой, цена пролога протечёт в них.
    const camp = createCamp();
    for (const id of ['hq', 'kitchen', 'storage'] as const) {
      assert.ok(camp.levels[id] >= 1, `${id} стартует построенным`);
    }
    assert.equal(camp.levels.forge, 0, 'Мастерская — единственная непостроенная');
  });

  test('стартовая раскладка помещается в площадь Жилья ур. 1', () => {
    const camp = createCamp();
    const area = campArea(camp.levels.hq);
    for (const id of ['hq', 'kitchen', 'storage'] as const) {
      const p = camp.layout[id];
      assert.ok(p.x >= 0 && p.z >= 0 && p.x + 2 <= area && p.z + 2 <= area, `${id} за границей`);
    }
  });

  test('§2 — уровни зданий меняют вылазку', () => {
    // Кухня — чистая модель (§22): слой округления к ней не кладётся, окно
    // между «дойти до дна» и «обойти всё» на ярусе 0 уже шага округления.
    // Склад — модель плюс округление (§20.3.3), и проверяется обещание
    // приёма, а не число: модель обязана его пересчитывать.
    for (let level = 1; level <= 4; level++) {
      assert.equal(kitchenFood(level), modelKitchenFood(level), `Кухня ур. ${level}`);
      assert.ok(kitchenFood(level) > kitchenFood(level - 1), 'запас растёт с уровнем');
      assert.equal(storageCapacity(level) % 5, 0, `Склад ур. ${level}: игрок читает круглое`);
      assert.ok(
        Math.abs(storageCapacity(level) - (11 + 4 * level)) < 5,
        `Склад ур. ${level}: округление увело от модели дальше шага`,
      );
      assert.ok(
        storageCapacity(level) > storageCapacity(level - 1),
        'рюкзак растёт с уровнем: округление не слепило две ступени в одну',
      );
    }
    assert.equal(storageCapacity(2), 20); // пример «12 из 20» из §11.2
    assert.equal(campArea(1), 6); // §20.4
    assert.equal(campArea(5), 10);
    assert.equal(campArea(6), 10, 'площадь не растёт выше таблицы');
  });

  test('camp.html — жителей 2 + по одному на четыре уровня, потолок 10', () => {
    const camp = createCamp();
    assert.equal(villagerCount(camp), 2);
    camp.levels = { hq: 4, kitchen: 4, storage: 4, forge: 0 , infirmary: 0, yard: 0};
    assert.equal(villagerCount(camp), 5);
    camp.levels = { hq: 6, kitchen: 6, storage: 6, forge: 0 , infirmary: 0, yard: 0};
    assert.equal(villagerCount(camp), 6);
  });

  test('§20.4 — перестановка свободна, но не поверх соседа и не за границу', () => {
    const camp = createCamp();
    assert.equal(moveBuilding(camp, 'kitchen', 4, 1), true);
    assert.equal(moveBuilding(camp, 'kitchen', 1, 1), false, 'на Жильё нельзя');
    assert.equal(moveBuilding(camp, 'kitchen', 5, 1), false, 'след 2×2 не влезает в 6×6');
    camp.levels.hq = 5;
    assert.equal(moveBuilding(camp, 'kitchen', 7, 7), true, 'на площади 10×10 можно');
  });
});

describe('Цены построек', () => {
  test('§20.1 — экран возврата предлагает самое дешёвое доступное улучшение', () => {
    const camp = createCamp();
    // Мастерская здесь уже стоит: её первый уровень бесплатен и мгновенен (§20.3),
    // и пока её нет, она перебивает любое платное предложение. Это отдельное
    // правило, оно проверяется в gear.rules.ts.
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 1 , infirmary: 0, yard: 0};
    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999 };
    // У Кухни и Склада ур. 1 — одинаковая цена второго уровня, берётся первый
    // по порядку; главное, что предложение вообще есть.
    assert.notEqual(suggestUpgrade(camp), null);

    camp.resources = { stone: 0, wood: 0, iron: 0, crystal: 0 };
    assert.equal(suggestUpgrade(camp), null, 'без ресурсов покупки нет');

    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999 };
    startUpgrade(camp, 'kitchen', 0);
    assert.equal(suggestUpgrade(camp), null, 'слот занят — предлагать нечего (§20.1)');
  });

  test('прогресс к улучшению считается по самому дефицитному ресурсу', () => {
    const camp = createCamp();
    const cost = BUILD_COST[2] ?? {};
    camp.resources = { stone: cost.stone ?? 0, wood: 1, iron: 0, crystal: 0 };
    assert.equal(
      upgradeProgress(camp, 'hq'),
      1 / (cost.wood ?? 1),
      'камня хватает, считается по дереву',
    );
  });

  test('§13 — ресурсы входят в цену не раньше, чем игрок может их добыть', () => {
    /*
     * Прежде правило называло уровни числами — «железо от третьего, кристалл
     * от пятого», — и числа были списаны с таблицы, выписанной руками. Теперь
     * цена выводится (§20.3), и проверять надо то, ради чего правило писалось:
     * цену нечем платить, если ресурс не выпадает там, где игрок копит.
     */
    for (const [level, cost] of Object.entries(BUILD_COST)) {
      const l = Number(level);
      if (l < 2) continue; // ур. 1 — цена пролога, мимо вывода (§16.2)
      const available = LOOT_SHARE[tierForLevel(l)];
      for (const kind of Object.keys(cost) as ResourceKind[]) {
        assert.ok(
          (available[kind] ?? 0) > 0,
          `уровень ${l}: ${kind} в цене, но не выпадает на ярусе ${tierForLevel(l)}`,
        );
      }
    }
  });

  test('§20.3 — цена уровня растёт, и растёт круглыми числами', () => {
    let prev = 0;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const cost = BUILD_COST[level] ?? {};
      const sum = Object.values(cost).reduce((a, b) => a + b, 0);
      assert.ok(sum > prev, `уровень ${level}: цена не выросла (${sum} против ${prev})`);
      for (const [kind, amount] of Object.entries(cost) as [ResourceKind, number][]) {
        assert.equal(
          amount,
          roundNice(amount),
          `уровень ${level}: ${kind} ${amount} — игрок читает некруглое`,
        );
      }
      prev = sum;
    }
  });

  /**
   * §14.3. Пустой стартовый колчан запирал сам себя, и это стоило класса:
   * пачка стоит железа, железо падает с яруса 1, ярус 1 отпирает Кухня ур. 2,
   * а Лучник доступен сразу после пролога. Подбор в вылазке дефект не лечил —
   * он упирается в `arrows < arrowsMax`, и при пустом запасе вместимость
   * колчана роли не играла. Правило сторожит именно вход, а не покупку.
   */
  test('§14.3 — колчан не заводится пустым', () => {
    assert.ok(createCamp().arrows > 0, 'новый лагерь выдаёт стрелы');
  });

  test('§14.3 — пачка покупается и не лезет выше вместимости', () => {
    const camp = createCamp();
    const cap = bowQuiver(camp.gear.weapon);
    camp.arrows = 0;
    camp.resources = { stone: 0, wood: 0, iron: 99, crystal: 0 };

    assert.ok(buyArrows(camp, cap), 'железа хватает — пачка куплена');
    assert.equal(camp.arrows, Math.min(cap, ARROW_PACK), 'сверх вместимости не влезает');
    assert.equal(camp.resources.iron, 99 - (ARROW_PACK_COST.iron ?? 0), 'железо списано');

    camp.arrows = cap;
    assert.equal(buyArrows(camp, cap), false, 'полный колчан не покупает');
  });

  /**
   * §14.2 — рука перекладывается бесплатно, поэтому единственное, что здесь
   * можно сломать, это молчание: повтор того же значения обязан отличаться
   * от смены, иначе интерфейсу нечего сказать игроку.
   */
  test('§14.2 — левая рука перекладывается и различает повтор', () => {
    const camp = createCamp();
    assert.equal(camp.offhand, 'torch', 'умолчание — фонарь');
    assert.ok(setOffhand(camp, 'shield'), 'смена руки состоялась');
    assert.equal(camp.offhand, 'shield');
    assert.equal(setOffhand(camp, 'shield'), false, 'повтор ничего не меняет');
  });

  test('§20.3 — цена растёт с уровнем', () => {
    const totals = [2, 3, 4, 5, 6].map((l) =>
      Object.values(BUILD_COST[l] ?? {}).reduce((a, b) => a + b, 0),
    );
    for (let i = 1; i < totals.length; i++) {
      assert.ok(totals[i]! > totals[i - 1]!, `уровень ${i + 2} не дороже предыдущего`);
    }
  });
});
