/**
 * Проверка правил лагеря без браузера. Возможна ровно потому, что sim/
 * не импортирует three и не трогает DOM (см. README).
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import {
  BUILD_COST,
  craftGear,
  gearBlock,
  suggestGear,
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
import { events, setEvents, summarize } from '../src/sim/telemetry';
import { load, save, wipe } from '../src/sim/save';
import { createRoster } from '../src/sim/heroes';
import { GEAR_COST, MAX_ITEM_LEVEL, emptyGear } from '../src/sim/gear';
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
  camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 0 };
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
  camp.levels = { hq: 5, kitchen: 4, storage: 1, forge: 0 };
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
  camp.levels = { hq: 4, kitchen: 4, storage: 4, forge: 0 };
  assert.equal(villagerCount(camp), 5);
  camp.levels = { hq: 6, kitchen: 6, storage: 6, forge: 0 };
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
  camp.levels = { hq: 4, kitchen: 3, storage: 2, forge: 0 };
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
  // Кузница здесь уже стоит: её первый уровень бесплатен и мгновенен (§20.3),
  // и пока её нет, она перебивает любое платное предложение — это проверяется
  // отдельно ниже.
  camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 1 };
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

console.log('Кузница и снаряжение');

check('§16 — Кузница закрыта до Штаба ур. 2 и говорит, чем закрыта', () => {
  const camp = createCamp();
  camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
  assert.equal(camp.levels.forge, 0, 'в новом лагере Кузницы нет');
  assert.equal(upgradeBlock(camp, 'forge'), 'locked');
  assert.equal(gearBlock(camp, 'weapon'), 'no-forge', 'ковать негде');
  camp.levels.hq = 2;
  assert.equal(upgradeBlock(camp, 'forge'), 'ok');
});

check('§20.3 — первый уровень Кузницы бесплатен и мгновенен', () => {
  const camp = createCamp();
  camp.levels.hq = 2;
  assert.equal(startUpgrade(camp, 'forge', 1000), true);
  assert.equal(camp.levels.forge, 1, 'выросла на глазах, без таймера');
  assert.equal(camp.construction, null, 'слот стройки свободен');
  assert.deepEqual(camp.resources, { salt: 0, wood: 0, iron: 0, crystal: 0 });
});

check('§20.1 — ковка работает, пока слот стройки занят', () => {
  const camp = createCamp();
  camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 1 };
  camp.resources = { salt: 999, wood: 999, iron: 999, crystal: 999 };
  assert.equal(startUpgrade(camp, 'kitchen', 0), true);
  assert.equal(upgradeBlock(camp, 'storage'), 'slot-busy', 'стройка встала в очередь');
  // Это и есть ответ §20.1 на конфликт: главная кнопка экрана возврата
  // не исчезает, она меняет предложение.
  assert.equal(suggestUpgrade(camp), null);
  assert.notEqual(suggestGear(camp), null, 'Кузница предлагает трату');
  assert.equal(craftGear(camp, 'weapon'), true);
  assert.equal(camp.gear.weapon, 1);
  assert.notEqual(camp.construction, null, 'ковка не тронула стройку');
});

check('§14 — предмет не может быть лучше своей Кузницы', () => {
  const camp = createCamp();
  camp.levels = { hq: 2, kitchen: 1, storage: 1, forge: 1 };
  camp.resources = { salt: 0, wood: 0, iron: 999, crystal: 999 };
  assert.equal(craftGear(camp, 'bag'), true, 'ур. 1 доступен');
  assert.equal(gearBlock(camp, 'bag'), 'forge-cap', 'ур. 2 требует Кузницу ур. 2');
  camp.levels.forge = 5;
  assert.equal(craftGear(camp, 'bag'), true);
  camp.levels.forge = 6;
  for (let i = camp.gear.bag; i < MAX_ITEM_LEVEL; i++) craftGear(camp, 'bag');
  assert.equal(camp.gear.bag, MAX_ITEM_LEVEL);
  assert.equal(gearBlock(camp, 'bag'), 'max', 'шестого уровня у предметов нет');
});

check('§14 — Кузница улучшает, а не рандомит', () => {
  const a = createCamp();
  const b = createCamp();
  for (const camp of [a, b]) {
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 3 };
    camp.resources = { salt: 0, wood: 0, iron: 999, crystal: 999 };
    craftGear(camp, 'ring');
    craftGear(camp, 'ring');
  }
  // Один и тот же вход даёт один и тот же выход: ни бросков, ни перебросов.
  assert.deepEqual(a.gear, b.gear);
  assert.equal(a.gear.ring, 2);
  assert.deepEqual(a.resources, b.resources);
});

check('§14 — каждый слот меняет вылазку, и каждый чем-то платит', () => {
  const bare = createRaid({ seed: 7, tier: 1, kitchenLevel: 2, storageLevel: 2 });
  const gear = emptyGear();
  gear.bag = 3;
  const withBag = createRaid({ seed: 7, tier: 1, kitchenLevel: 2, storageLevel: 2, gear });
  assert.equal(withBag.capacity, bare.capacity + 3, 'сумка расширяет рюкзак');

  const armed = createRaid({
    seed: 7,
    tier: 1,
    kitchenLevel: 2,
    storageLevel: 2,
    gear: { ...emptyGear(), weapon: 2 },
  });
  assert.ok(armed.mods.attackInterval < 1, 'оружие ускоряет удар');
  assert.equal(armed.capacity, bare.capacity - 1, '§14 — тяжёлое оружие стоит места');

  const armored = createRaid({
    seed: 7,
    tier: 1,
    kitchenLevel: 2,
    storageLevel: 2,
    gear: { ...emptyGear(), armor: 3 },
  });
  assert.equal(armored.hero.wounds, bare.hero.wounds + 1, 'броня добавляет рану');
  assert.ok(armored.mods.foodStep > 1, '§14 — тяжёлая броня дороже в дороге');

  const lit = createRaid({
    seed: 7,
    tier: 1,
    kitchenLevel: 2,
    storageLevel: 2,
    gear: { ...emptyGear(), torch: 4 },
  });
  assert.equal(lit.mods.vision, 2, 'фонарь прибавляет обзор');
});

check('§11.2 и §14 — кольцо смягчает ставку, но не отменяет её', () => {
  const make = (ring: number) => {
    const state = createRaid({
      seed: 3,
      tier: 3,
      kitchenLevel: 3,
      storageLevel: 3,
      gear: { ...emptyGear(), ring },
    });
    state.bagTotal = 10;
    return atRisk(state);
  };
  assert.equal(make(0), 10, 'на дне без кольца под угрозой всё');
  assert.equal(make(5), 5, 'потолок кольца — половина');
  assert.ok(make(5) > 0, 'ставка остаётся ставкой');
});

check('§14 — снаряжение не теряется при провале', () => {
  const camp = createCamp();
  camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 3 };
  camp.resources = { salt: 0, wood: 0, iron: 999, crystal: 999 };
  craftGear(camp, 'weapon');
  craftGear(camp, 'armor');
  const before = { ...camp.gear };
  const raid = createRaid({ seed: 11, tier: 2, kitchenLevel: 2, storageLevel: 2, gear: camp.gear });
  raid.bagTotal = 8;
  raid.bag = { salt: 8, wood: 0, iron: 0, crystal: 0 };
  raid.status = 'failed';
  const result = raidResult(raid);
  assert.ok(result.lost > 0, 'добыча теряется');
  assert.deepEqual(camp.gear, before, 'снаряжение остаётся в лагере');
});

check('§14 — цена снаряжения только железо и кристалл', () => {
  for (let level = 1; level <= MAX_ITEM_LEVEL; level++) {
    const cost = GEAR_COST[level] ?? {};
    assert.equal(cost.salt ?? 0, 0, `соль на уровне ${level}`);
    assert.equal(cost.wood ?? 0, 0, `дерево на уровне ${level}`);
    assert.ok((cost.iron ?? 0) > 0, `железо на уровне ${level}`);
    // §13 — кристалл не входит в цену раньше своего яруса.
    if (level < 3) assert.equal(cost.crystal ?? 0, 0, `кристалл на уровне ${level}`);
  }
  const totals = [1, 2, 3, 4, 5].map((l) =>
    Object.values(GEAR_COST[l] ?? {}).reduce((a, b) => a + b, 0),
  );
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i]! > totals[i - 1]!, `ступень ${i + 1} не дороже предыдущей`);
  }
});

check('снаряжение переживает круг save → load', () => {
  wipe();
  const camp = createCamp();
  camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 2 };
  camp.resources = { salt: 0, wood: 0, iron: 999, crystal: 999 };
  craftGear(camp, 'torch');
  craftGear(camp, 'torch');
  save(camp, createRoster(), 5);
  const { camp: back } = load();
  assert.equal(back.gear.torch, 2);
  assert.equal(back.levels.forge, 2, 'непостроенное и построенное различимы');
  wipe();
});

console.log(`\n${checks} проверок пройдено`);
