/**
 * Проверка правил лагеря без браузера. Возможна ровно потому, что sim/
 * не импортирует three и не трогает DOM (см. README).
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import {
  BUILD_COST,
  campArea,
  completeIfDue,
  createCamp,
  kitchenFood,
  moveBuilding,
  speedup,
  speedupCost,
  startUpgrade,
  freeWindow,
  storageCapacity,
  suggestUpgrade,
  upgradeBlock,
  upgradeProgress,
  villagerCount,
} from '../src/sim/camp';
import {
  deriveTier,
  modelKitchenFood,
  TIER_KITCHEN_GATE,
  TIER_SPEC,
  HERO_WOUNDS,
  WOUND_COST,
} from '../src/sim/balance';
import { addResources } from '../src/sim/resources';
import {
  RATION_FOOD,
  buyConsumable,
  cheapestAffordable,
  refundConsumable,
} from '../src/sim/consumables';
import { events, setEvents, summarize } from '../src/sim/telemetry';
import { load, save, wipe } from '../src/sim/save';
import { createRoster } from '../src/sim/heroes';
import { atRisk, backSteps, commandMove, createRaid, raidResult, stepRaid } from '../src/sim/raid';
import { TICK } from '../src/core/loop';
import { ENEMY_STATS, TIER_ROSTER } from '../src/sim/enemies';
import { generateLocation } from '../src/sim/generate';
import { distanceField, idx } from '../src/sim/grid';
import { HERO_REACH } from '../src/sim/config';

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  console.log(`  ✓ ${name}`);
};

console.log('Лагерь');

check('§20.4 — здание не может превысить Штаб', () => {
  const camp = createCamp();
  camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
  assert.equal(upgradeBlock(camp, 'kitchen'), 'hq-cap');
  assert.equal(upgradeBlock(camp, 'hq'), 'ok');
});

check('§20.1 — слот один', () => {
  const camp = createCamp();
  camp.levels = { hq: 3, kitchen: 1, storage: 1 };
  camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
  assert.equal(startUpgrade(camp, 'kitchen', 1000), true);
  assert.equal(upgradeBlock(camp, 'storage'), 'slot-busy');
  assert.equal(startUpgrade(camp, 'storage', 1000), false);
});

check('стоимость списывается ровно один раз', () => {
  const camp = createCamp();
  camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
  startUpgrade(camp, 'hq', 0);
  assert.equal(camp.resources.wood, 10 - (BUILD_COST[2]?.wood ?? 0));
  assert.equal(camp.resources.salt, 10 - (BUILD_COST[2]?.salt ?? 0));
});

check('не хватает ресурсов — стройка не начинается', () => {
  const camp = createCamp();
  assert.equal(upgradeBlock(camp, 'hq'), 'resources');
  assert.equal(startUpgrade(camp, 'hq', 0), false);
  assert.equal(camp.construction, null);
});

check('§20.2 — таймер 3 минуты и достройка по времени', () => {
  const camp = createCamp();
  camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
  startUpgrade(camp, 'hq', 1000);
  assert.equal(camp.construction?.endsAt, 1000 + 180);
  assert.equal(completeIfDue(camp, 1100), null, 'раньше срока не достраивается');
  assert.equal(completeIfDue(camp, 1180), 'hq');
  assert.equal(camp.levels.hq, 2);
  assert.equal(camp.construction, null);
});

check('оффлайн-прогресс: стройка завершается «за время отсутствия»', () => {
  const camp = createCamp();
  camp.resources = { salt: 10, wood: 10, iron: 0, crystal: 0 };
  startUpgrade(camp, 'hq', 0);
  // Игрок закрыл игру и вернулся через сутки.
  assert.equal(completeIfDue(camp, 86400), 'hq');
  assert.equal(camp.levels.hq, 2);
});

check('§20.5 — бесплатное окно min(5 мин, 25% таймера)', () => {
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

check('ускорение длинной стройки тратит соль и завершает её', () => {
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
check('первый таймер игры больше не пропускается даром', () => {
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

check('стартовая раскладка помещается в площадь Штаба ур. 1', () => {
  const camp = createCamp();
  const area = campArea(camp.levels.hq);
  for (const id of ['hq', 'kitchen', 'storage'] as const) {
    const p = camp.layout[id];
    assert.ok(p.x >= 0 && p.z >= 0 && p.x + 2 <= area && p.z + 2 <= area, `${id} за границей`);
  }
});

check('§2 — уровни зданий меняют вылазку', () => {
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

check('camp.html — жителей 2 + по одному на четыре уровня, потолок 10', () => {
  const camp = createCamp();
  assert.equal(villagerCount(camp), 2);
  camp.levels = { hq: 4, kitchen: 4, storage: 4 };
  assert.equal(villagerCount(camp), 5);
  camp.levels = { hq: 6, kitchen: 6, storage: 6 };
  assert.equal(villagerCount(camp), 6);
});

check('§20.4 — перестановка свободна, но не поверх соседа и не за границу', () => {
  const camp = createCamp();
  assert.equal(moveBuilding(camp, 'kitchen', 4, 1), true);
  assert.equal(moveBuilding(camp, 'kitchen', 1, 1), false, 'на Штаб нельзя');
  assert.equal(moveBuilding(camp, 'kitchen', 5, 1), false, 'след 2×2 не влезает в 6×6');
  camp.levels.hq = 5;
  assert.equal(moveBuilding(camp, 'kitchen', 7, 7), true, 'на площади 10×10 можно');
});

console.log('Сохранение');

check('save/load не падают без localStorage (Node, приватный режим)', () => {
  const camp = createCamp();
  camp.levels.hq = 3;
  save(camp, createRoster(), 123);
  const loaded = load();
  assert.equal(loaded.camp.levels.hq, 1, 'без хранилища — чистый лагерь');
  wipe();
});

check('битый и чужой сейв не роняет игру', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  store.set('new-world/save', '{ это не json');
  assert.equal(load().camp.levels.hq, 1);

  store.set('new-world/save', JSON.stringify({ version: 99, levels: { hq: 6 } }));
  assert.equal(load().camp.levels.hq, 1, 'чужая версия игнорируется');

  store.set(
    'new-world/save',
    JSON.stringify({ version: 1, levels: { hq: 999 }, resources: { salt: -5 } }),
  );
  const bad = load().camp;
  assert.equal(bad.levels.hq, 1, 'уровень вне диапазона отбрасывается');
  assert.equal(bad.resources.salt, 0, 'отрицательные ресурсы отбрасываются');
});

check('сейв с раскладкой за границей чинится при загрузке', () => {
  const camp = createCamp();
  camp.layout.kitchen = { x: 9, z: 9 }; // площадь при Штабе ур. 1 — 6×6
  save(camp, createRoster(), 0);
  const back = load().camp;
  assert.deepEqual(back.layout.kitchen, createCamp().layout.kitchen);
  wipe();
});

check('сейв переживает круг save → load', () => {
  const camp = createCamp();
  camp.levels = { hq: 4, kitchen: 3, storage: 2 };
  camp.resources = { salt: 50, wood: 40, iron: 20, crystal: 3 };
  camp.layout.kitchen = { x: 6, z: 3 };
  assert.equal(startUpgrade(camp, 'storage', 500), true);
  save(camp, createRoster(), 777);

  const { camp: back, watermark } = load();
  assert.deepEqual(back.levels, camp.levels);
  assert.deepEqual(back.resources, camp.resources);
  assert.deepEqual(back.layout.kitchen, { x: 6, z: 3 });
  assert.equal(back.construction?.building, 'storage');
  assert.equal(watermark, 777);
  wipe();
});

console.log('Вылазка');

/** Гоняет симуляцию, пока герой идёт, но не дольше лимита. */
const run = (state: ReturnType<typeof createRaid>, seconds: number): void => {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks && state.status === 'running' && state.path.length > 0; i++) {
    stepRaid(state, TICK, true, 5);
  }
};

check('§2 — Кухня и Склад задают провиант и рюкзак', () => {
  const raid = createRaid({ seed: 1, tier: 1, kitchenLevel: 3, storageLevel: 2 });
  // Значения берутся из кривых, а не повторяются числом: кривая Кухни выведена
  // моделью и меняется вместе с TIER_SPEC.
  assert.equal(raid.food, kitchenFood(3));
  assert.equal(raid.foodMax, kitchenFood(3));
  assert.equal(raid.capacity, storageCapacity(2));
});

check('§11.1 — путь назад считается от эвакуации', () => {
  const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
  assert.equal(backSteps(raid), 0, 'на точке эвакуации путь назад нулевой');
  const far = raid.loc.containers[0];
  assert.ok(far !== undefined);
  assert.equal(commandMove(raid, far), true, 'до контейнера есть путь');
  run(raid, 120);
  assert.ok(backSteps(raid) > 0, 'отойдя от выхода, путь назад вырос');
});

check('контейнер стоит провианта и наполняет рюкзак (§11.1)', () => {
  const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
  const target = raid.loc.containers[0];
  assert.ok(target !== undefined);
  commandMove(raid, target);
  run(raid, 120);
  assert.ok(raid.bagTotal > 0, 'добыча в рюкзаке');
  assert.ok(raid.food < raid.foodMax - raid.steps, 'вскрытие списало сверх шагов');
  assert.equal(raid.loc.containers[0]?.opened, true);
});

check('§11.2 — под угрозой ceil(добыча × доля яруса)', () => {
  const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
  raid.bag.salt = 7;
  raid.bagTotal = 7;
  assert.equal(atRisk(raid), 5, '7 × 0.6 = 4.2 → 5');
});

check('провал теряет долю рюкзака, эвакуация — ничего', () => {
  const raid = createRaid({ seed: 3, tier: 3, kitchenLevel: 3, storageLevel: 2 });
  raid.bag = { salt: 6, wood: 0, iron: 3, crystal: 1 };
  raid.bagTotal = 10;

  raid.status = 'failed';
  const lost = raidResult(raid);
  assert.equal(lost.lost, 10, 'на дне ставка 100%');
  assert.equal(lost.carriedTotal, 0);

  raid.status = 'evacuated';
  const saved = raidResult(raid);
  assert.equal(saved.lost, 0);
  assert.deepEqual(saved.carried, { salt: 6, wood: 0, iron: 3, crystal: 1 });
});

check('потери распределяются по составу рюкзака, а не по одному виду', () => {
  const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
  raid.bag = { salt: 10, wood: 0, iron: 10, crystal: 0 };
  raid.bagTotal = 20;
  raid.status = 'failed';
  const r = raidResult(raid);
  assert.equal(r.lost, 12, '20 × 0.6');
  assert.equal(r.carriedTotal, 8);
  assert.ok(r.carried.salt > 0 && r.carried.iron > 0, 'обе кучи пострадали');
});

check('добыча доезжает до лагеря', () => {
  const camp = createCamp();
  const raid = createRaid({ seed: 11, tier: 1, kitchenLevel: 3, storageLevel: 2 });
  raid.bag = { salt: 4, wood: 3, iron: 1, crystal: 0 };
  raid.bagTotal = 8;
  raid.status = 'evacuated';
  addResources(camp.resources, raidResult(raid).carried);
  assert.deepEqual(camp.resources, { salt: 4, wood: 3, iron: 1, crystal: 0 });
});

console.log('Бой');

check('§15 — герой достаёт до каждого противника', () => {
  for (const stats of Object.values(ENEMY_STATS)) {
    // Противник останавливается на reach × 0.9; если герой не достаёт туда,
    // враг неуязвим, а не «бьёт первым».
    const engageAt = Math.max(HERO_REACH, stats.reach);
    assert.ok(engageAt >= stats.reach * 0.9, `${stats.name} недосягаем`);
  }
});

check('§22 — бюджет ран, а не голов', () => {
  // Считать противников поштучно означает мерить не то: падальщик стоит
  // 0 ран (герой убивает его раньше первого удара), копейщик 1, голем 2.
  // Замер детерминирован — 150 из 150 забегов дали одно и то же значение.
  for (const [tier, roster] of Object.entries(TIER_ROSTER)) {
    const wounds = roster.reduce((sum, kind) => sum + WOUND_COST[kind], 0);
    assert.ok(
      wounds < HERO_WOUNDS,
      `ярус ${tier}: состав стоит ${wounds} ран при ${HERO_WOUNDS} у героя — ` +
        'драка со всеми означает гарантированную смерть, а не риск',
    );
    // Верхняя граница по головам остаётся, но она про отрисовку:
    // скиннованные меши не инстансятся (§21).
    assert.ok(roster.length <= 12, `ярус ${tier}: ${roster.length} противников`);
  }
});

check('§15 — голем не встаёт в единственный проход', () => {
  // Проверяем на десяти сидах: от эвакуации до каждого контейнера должен
  // существовать путь, даже если зону голема считать непроходимой.
  for (let seed = 1; seed <= 10; seed++) {
    const loc = generateLocation(seed, 3);
    const walled = Uint8Array.from(loc.blocked);
    for (const e of loc.enemies) {
      if (e.kind !== 'golem') continue;
      for (let z = Math.round(e.z) - 1; z <= Math.round(e.z) + 1; z++) {
        for (let x = Math.round(e.x) - 1; x <= Math.round(e.x) + 1; x++) {
          if (x >= 0 && z >= 0 && x < loc.size && z < loc.size) walled[idx(loc.size, x, z)] = 1;
        }
      }
    }
    const reach = distanceField(loc.size, walled, loc.evac);
    for (const c of loc.containers) {
      assert.ok(reach[idx(loc.size, c.x, c.z)]! >= 0, `сид ${seed}: контейнер отрезан големом`);
    }
  }
});

console.log('Расходники (§21)');

check('§21.1 — не больше двух за вылазку', () => {
  const camp = createCamp();
  camp.resources = { salt: 999, wood: 0, iron: 999, crystal: 0 };
  assert.equal(buyConsumable(camp, 'ration'), true);
  assert.equal(buyConsumable(camp, 'bandage'), true);
  assert.equal(buyConsumable(camp, 'smoke'), false, 'третий слот не продаётся');
  assert.equal(camp.loadout.length, 2);
});

check('§21.1 — купленное сгорает: возврат денег только до входа', () => {
  const camp = createCamp();
  camp.resources = { salt: 20, wood: 0, iron: 0, crystal: 0 };
  buyConsumable(camp, 'ration');
  assert.equal(camp.resources.salt, 16);
  assert.equal(refundConsumable(camp, 0), true);
  assert.equal(camp.resources.salt, 20, 'вернули целиком');
  assert.equal(refundConsumable(camp, 0), false, 'возвращать нечего');
});

check('§21.1 — повязка срабатывает сама на последней ране', () => {
  const raid = createRaid({
    seed: 5, tier: 1, kitchenLevel: 3, storageLevel: 2, consumables: ['bandage'],
  });
  raid.hero.wounds = 1;
  stepRaid(raid, TICK, true, 5);
  assert.equal(raid.hero.wounds, 2, 'рана возвращена');
  assert.deepEqual(raid.fired, ['bandage']);
  assert.equal(raid.consumables.length, 0, 'расходник истрачен');
});

check('§21 — паёк срабатывает на нуле провианта', () => {
  const raid = createRaid({
    seed: 5, tier: 1, kitchenLevel: 3, storageLevel: 2, consumables: ['ration'],
  });
  raid.food = 0;
  stepRaid(raid, TICK, true, 5);
  assert.equal(raid.food, RATION_FOOD);
  assert.deepEqual(raid.fired, ['ration']);
});

check('§21 — повязка страхует ошибку, а не воскрешает', () => {
  const raid = createRaid({
    seed: 5, tier: 1, kitchenLevel: 3, storageLevel: 2, consumables: ['bandage'],
  });
  raid.hero.wounds = 0;
  stepRaid(raid, TICK, true, 5);
  assert.equal(raid.status, 'failed', 'на нуле ран вылазка провалена');
  assert.deepEqual(raid.fired, [], 'повязка не тратится на труп');
});

check('§21 — дым гасит свалку и даёт передышку', () => {
  const raid = createRaid({
    seed: 5, tier: 2, kitchenLevel: 3, storageLevel: 2, consumables: ['smoke'],
  });
  // Врагов надо поставить рядом: далёкие теряют героя в том же тике,
  // и свалки не получается.
  for (const e of raid.loc.enemies.slice(0, 2)) {
    e.x = raid.hero.x + 2;
    e.z = raid.hero.z + 2;
    e.awake = true;
  }
  stepRaid(raid, TICK, true, 5);
  assert.deepEqual(raid.fired, ['smoke']);
  assert.equal(raid.loc.enemies.every((e) => !e.awake), true, 'контакт разорван');
  assert.ok(raid.smokeUntil > raid.elapsed, 'есть окно, пока никто не просыпается');
});

check('§21 — без расходников ничего не срабатывает', () => {
  const raid = createRaid({ seed: 5, tier: 1, kitchenLevel: 3, storageLevel: 2 });
  raid.hero.wounds = 1;
  raid.food = 0;
  stepRaid(raid, TICK, true, 5);
  assert.deepEqual(raid.fired, []);
  assert.equal(raid.hero.wounds, 1);
});

check('§20.1 — экран возврата предлагает расходник, когда слот занят', () => {
  const camp = createCamp();
  camp.resources = { salt: 30, wood: 30, iron: 0, crystal: 0 };
  startUpgrade(camp, 'hq', 0);
  assert.equal(suggestUpgrade(camp), null, 'стройку предложить нельзя');
  assert.notEqual(
    cheapestAffordable(camp.resources, camp.loadout),
    null,
    'а расходник — можно: в этом весь второй сток',
  );
});

check('§21.3 — предлагается самый дешёвый по карману', () => {
  const camp = createCamp();
  camp.resources = { salt: 6, wood: 0, iron: 0, crystal: 0 };
  assert.equal(cheapestAffordable(camp.resources, camp.loadout), 'ration', 'паёк за 4');
  camp.resources.salt = 3;
  assert.equal(cheapestAffordable(camp.resources, camp.loadout), null);
});

console.log('Телеметрия и экран возврата');

check('§9 — сводка отвечает на «эвакуируются ли слишком рано»', () => {
  setEvents([
    { t: 'raid_end', at: 0, tier: 1, failed: false, maxBack: 5, locMaxBack: 20, carried: 6, lost: 0, steps: 30, foodLeft: 40, durationSec: 60 },
    { t: 'raid_end', at: 1, tier: 1, failed: true, maxBack: 15, locMaxBack: 20, carried: 0, lost: 4, steps: 50, foodLeft: 0, durationSec: 90 },
  ]);
  const s = summarize(events());
  assert.equal(s.raids, 2);
  assert.equal(s.failRate, 0.5);
  assert.equal(s.avgDepthShare, 0.5, '(5/20 + 15/20) / 2');
  assert.equal(s.avgCarried, 3);
  assert.equal(s.avgLost, 2);
});

check('§20.1 — считается доля возвратов с доступной покупкой', () => {
  setEvents([
    { t: 'return_screen', at: 0, canBuy: true, chose: 'build' },
    { t: 'return_screen', at: 1, canBuy: true, chose: 'raid' },
    { t: 'return_screen', at: 2, canBuy: false, chose: 'raid' },
    { t: 'return_screen', at: 3, canBuy: true, chose: 'build' },
  ]);
  const s = summarize(events());
  assert.equal(s.buyOfferRate, 0.75, 'покупка предлагалась в трёх возвратах из четырёх');
  assert.equal(s.buyTakeRate, 2 / 3, 'из них стройку выбрали дважды');
});

check('§9 — время возврата меряется только там, где таймер шёл', () => {
  setEvents([
    { t: 'session_start', at: 0, awaySec: 600, timerLeftSec: 100 },
    { t: 'session_start', at: 1, awaySec: 1800, timerLeftSec: 0 },
    { t: 'session_start', at: 2, awaySec: 99999, timerLeftSec: null },
  ]);
  const s = summarize(events());
  assert.equal(s.medianReturnMin, 20, 'медиана 10 и 30 минут; заход без таймера не в счёт');
});

check('точка выхода из сессии считается по местам', () => {
  setEvents([
    { t: 'exit', at: 0, where: 'raid' },
    { t: 'exit', at: 1, where: 'camp' },
    { t: 'exit', at: 2, where: 'camp' },
  ]);
  assert.deepEqual(summarize(events()).exits, { raid: 1, camp: 2, return: 0 });
});

check('пустая телеметрия не ломает сводку', () => {
  setEvents([]);
  const s = summarize(events());
  assert.equal(s.raids, 0);
  assert.equal(s.firstBuilding, null);
  assert.equal(s.medianReturnMin, null);
});

check('§20.1 — экран возврата предлагает самое дешёвое доступное улучшение', () => {
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

check('прогресс к улучшению считается по самому дефицитному ресурсу', () => {
  const camp = createCamp();
  const cost = BUILD_COST[2] ?? {};
  camp.resources = { salt: cost.salt ?? 0, wood: 1, iron: 0, crystal: 0 };
  assert.equal(
    upgradeProgress(camp, 'hq'),
    1 / (cost.wood ?? 1),
    'соли хватает, считается по дереву',
  );
});

check('§13 — ресурсы входят в цену не раньше своего яруса', () => {
  for (const [level, cost] of Object.entries(BUILD_COST)) {
    const l = Number(level);
    // Железо идёт с ярусов 1–3 и в постройки от третьего уровня,
    // кристалл — только с ярусов 2–3 и в постройки от пятого.
    if (l < 3) assert.equal(cost.iron ?? 0, 0, `железо на уровне ${l}`);
    if (l < 5) assert.equal(cost.crystal ?? 0, 0, `кристалл на уровне ${l}`);
  }
});

check('§20.3 — цена растёт с уровнем', () => {
  const totals = [2, 3, 4, 5, 6].map((l) =>
    Object.values(BUILD_COST[l] ?? {}).reduce((a, b) => a + b, 0),
  );
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i]! > totals[i - 1]!, `уровень ${i + 2} не дороже предыдущего`);
  }
});

console.log(`\n${checks} проверок пройдено`);

check('§12.2 и §22 — запас на гейте лежит между «до дна» и «полным обходом»', () => {
  for (const tier of [0, 1, 2, 3] as const) {
    const d = deriveTier(TIER_SPEC[tier]);
    const food = kitchenFood(TIER_KITCHEN_GATE[tier]);
    assert.ok(
      d.geometry.deepAndBack <= food * 0.85,
      `ярус ${tier}: до дна и обратно ${d.geometry.deepAndBack} не влезает в ${food}`,
    );
    assert.ok(
      d.geometry.fullTour > food,
      `ярус ${tier}: полный обход ${d.geometry.fullTour} по карману при ${food}`,
    );
    assert.ok(d.checks.survivable, `ярус ${tier}: забег непереживаем`);
  }
});
