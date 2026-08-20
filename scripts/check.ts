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
import { addResources } from '../src/sim/resources';
import { events, setEvents, summarize } from '../src/sim/telemetry';
import { load, save, wipe } from '../src/sim/save';
import { atRisk, backSteps, commandMove, createRaid, raidResult, stepRaid } from '../src/sim/raid';
import { TICK } from '../src/core/loop';

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
  assert.equal(kitchenFood(1), 50); // §11.1
  assert.equal(kitchenFood(3), 90);
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
  save(camp, 123);
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
  save(camp, 0);
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
  save(camp, 777);

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
  assert.equal(raid.food, 90);
  assert.equal(raid.foodMax, 90);
  assert.equal(raid.capacity, 19);
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
  camp.resources = { salt: 4, wood: 4, iron: 0, crystal: 0 }; // нужно wood 8, salt 4
  assert.equal(upgradeProgress(camp, 'hq'), 0.5, 'дерева половина, соли хватает');
});

console.log(`\n${checks} проверок пройдено`);
