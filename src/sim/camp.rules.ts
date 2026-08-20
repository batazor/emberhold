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
  BUILD_COST,
  campArea,
  completeIfDue,
  createCamp,
  freeWindow,
  kitchenFood,
  moveBuilding,
  speedup,
  speedupCost,
  startUpgrade,
  storageCapacity,
  suggestUpgrade,
  upgradeBlock,
  upgradeProgress,
  villagerCount,
} from './camp';
import { modelKitchenFood } from './balance';

describe('Лагерь', () => {
  test('§20.4 — здание не может превысить Штаб', () => {
    const camp = createCamp();
    camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
    assert.equal(upgradeBlock(camp, 'kitchen'), 'hq-cap');
    assert.equal(upgradeBlock(camp, 'hq'), 'ok');
  });

  test('§20.1 — слот один', () => {
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1 };
    camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
    assert.equal(startUpgrade(camp, 'kitchen', 1000), true);
    assert.equal(upgradeBlock(camp, 'storage'), 'slot-busy');
    assert.equal(startUpgrade(camp, 'storage', 1000), false);
  });

  test('стоимость списывается ровно один раз', () => {
    const camp = createCamp();
    camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    assert.equal(camp.resources.wood, 10 - (BUILD_COST[2]?.wood ?? 0));
    assert.equal(camp.resources.salt, 10 - (BUILD_COST[2]?.salt ?? 0));
  });

  test('не хватает ресурсов — стройка не начинается', () => {
    const camp = createCamp();
    assert.equal(upgradeBlock(camp, 'hq'), 'resources');
    assert.equal(startUpgrade(camp, 'hq', 0), false);
    assert.equal(camp.construction, null);
  });

  test('§20.2 — таймер 3 минуты и достройка по времени', () => {
    const camp = createCamp();
    camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 1000);
    assert.equal(camp.construction?.endsAt, 1000 + 180);
    assert.equal(completeIfDue(camp, 1100), null, 'раньше срока не достраивается');
    assert.equal(completeIfDue(camp, 1180), 'hq');
    assert.equal(camp.levels.hq, 2);
    assert.equal(camp.construction, null);
  });

  test('оффлайн-прогресс: стройка завершается «за время отсутствия»', () => {
    const camp = createCamp();
    camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
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

  test('ускорение длинной стройки тратит соль и завершает её', () => {
    const camp = createCamp();
    camp.levels = { hq: 5, kitchen: 4, storage: 1 };
    camp.resources = { salt: 9999, wood: 9999, iron: 9999, crystal: 9999 };
    startUpgrade(camp, 'kitchen', 0); // до ур. 5 — три часа
    const before = camp.resources.salt;
    assert.equal(speedup(camp, 0), true);
    assert.ok(camp.resources.salt < before, 'соль списана');
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
    camp.resources = { salt: 100, wood: 10, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    const c = camp.construction!;
    const total = c.endsAt - c.startedAt;

    assert.ok(speedupCost(total, total) > 0, 'сразу после начала ускорение платное');
    assert.equal(speedupCost(40, total), 0, 'последние 45 секунд — бесплатны');

    const salt = camp.resources.salt;
    assert.equal(speedup(camp, 0), true);
    assert.ok(camp.resources.salt < salt, 'соль потрачена');
    assert.equal(camp.levels.hq, 2);
  });

  test('стартовая раскладка помещается в площадь Штаба ур. 1', () => {
    const camp = createCamp();
    const area = campArea(camp.levels.hq);
    for (const id of ['hq', 'kitchen', 'storage'] as const) {
      const p = camp.layout[id];
      assert.ok(p.x >= 0 && p.z >= 0 && p.x + 2 <= area && p.z + 2 <= area, `${id} за границей`);
    }
  });

  test('§2 — уровни зданий меняют вылазку', () => {
    // Числа Кухни больше не назначены руками: кривая выведена моделью (§22).
    // Закреплять здесь 50 и 90 означало бы фиксировать то, что модель обязана
    // пересчитывать, — проверяем связь, а не значение.
    assert.equal(kitchenFood(1), modelKitchenFood(1));
    assert.equal(kitchenFood(3), modelKitchenFood(3));
    assert.ok(kitchenFood(2) > kitchenFood(1), 'запас растёт с уровнем');
    assert.equal(storageCapacity(2), 19); // пример «12 из 19» из §11.2
    assert.equal(campArea(1), 6); // §20.4
    assert.equal(campArea(5), 10);
    assert.equal(campArea(6), 10, 'площадь не растёт выше таблицы');
  });

  test('camp.html — жителей 2 + по одному на четыре уровня, потолок 10', () => {
    const camp = createCamp();
    assert.equal(villagerCount(camp), 2);
    camp.levels = { hq: 4, kitchen: 4, storage: 4 };
    assert.equal(villagerCount(camp), 5);
    camp.levels = { hq: 6, kitchen: 6, storage: 6 };
    assert.equal(villagerCount(camp), 6);
  });

  test('§20.4 — перестановка свободна, но не поверх соседа и не за границу', () => {
    const camp = createCamp();
    assert.equal(moveBuilding(camp, 'kitchen', 4, 1), true);
    assert.equal(moveBuilding(camp, 'kitchen', 1, 1), false, 'на Штаб нельзя');
    assert.equal(moveBuilding(camp, 'kitchen', 5, 1), false, 'след 2×2 не влезает в 6×6');
    camp.levels.hq = 5;
    assert.equal(moveBuilding(camp, 'kitchen', 7, 7), true, 'на площади 10×10 можно');
  });
});

describe('Цены построек', () => {
  test('§20.1 — экран возврата предлагает самое дешёвое доступное улучшение', () => {
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1 };
    camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
    // У Кухни и Склада ур. 1 — одинаковая цена второго уровня, берётся первый
    // по порядку; главное, что предложение вообще есть.
    assert.notEqual(suggestUpgrade(camp), null);

    camp.resources = { salt: 0, wood: 0, iron: 0, crystal: 0 };
    assert.equal(suggestUpgrade(camp), null, 'без ресурсов покупки нет');

    camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
    startUpgrade(camp, 'kitchen', 0);
    assert.equal(suggestUpgrade(camp), null, 'слот занят — предлагать нечего (§20.1)');
  });

  test('прогресс к улучшению считается по самому дефицитному ресурсу', () => {
    const camp = createCamp();
    const cost = BUILD_COST[2] ?? {};
    camp.resources = { salt: cost.salt ?? 0, wood: 1, iron: 0, crystal: 0 };
    assert.equal(
      upgradeProgress(camp, 'hq'),
      1 / (cost.wood ?? 1),
      'соли хватает, считается по дереву',
    );
  });

  test('§13 — ресурсы входят в цену не раньше своего яруса', () => {
    for (const [level, cost] of Object.entries(BUILD_COST)) {
      const l = Number(level);
      // Железо идёт с ярусов 1–3 и в постройки от третьего уровня,
      // кристалл — только с ярусов 2–3 и в постройки от пятого.
      if (l < 3) assert.equal(cost.iron ?? 0, 0, `железо на уровне ${l}`);
      if (l < 5) assert.equal(cost.crystal ?? 0, 0, `кристалл на уровне ${l}`);
    }
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
