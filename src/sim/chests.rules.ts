/**
 * Правила сундуков-хранилищ. Живут рядом с chests.ts: фича приносит
 * свои правила с собой.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import {
  CHEST_BONUS,
  CHEST_COST,
  STORE_BASE,
  adoptChest,
  buildChest,
  chestBlock,
  chestFits,
  stash,
  storeCapacity,
  storeFree,
  storeUsed,
} from './chests';
import { BUILD_COST } from './camp';
import { buildTent, tentFits } from './residents';
import { commandMove, createRaid, stepRaid } from './raid';
import { chestSiteNear, generateGlade } from './prologue';
import { generateLocation } from './generate';
import { generateCastleSite } from './castleSite';
import { ENEMY_STATS } from './enemies';

describe('сундуки-хранилища', () => {
  test('сундук стоит два дерева и встаёт на выбранную клетку', () => {
    const camp = createCamp();
    camp.resources.wood = 3;
    const spot = buildChest(camp, { x: 0, z: 0 });
    assert.deepEqual(spot, { x: 0, z: 0 });
    assert.equal(camp.resources.wood, 3 - (CHEST_COST.wood ?? 0));
    assert.equal(camp.chests.length, 1);
  });

  test('без дерева сундук не строится, и отказ называет причину', () => {
    const camp = createCamp();
    camp.resources.wood = (CHEST_COST.wood ?? 0) - 1;
    assert.equal(chestBlock(camp), 'resources');
    assert.equal(buildChest(camp, { x: 0, z: 0 }), null);
    assert.equal(camp.chests.length, 0);
  });

  test('цена сундука ниже второго уровня любого здания — правило палатки', () => {
    // §20.3: сундук — предмет, а не здание, и обязательством крупнее
    // настоящей постройки быть не может.
    const wood = CHEST_COST.wood ?? 0;
    assert.ok(wood < (BUILD_COST[2]?.wood ?? Infinity));
  });

  test('каждый сундук — +30 к кладовой, рюкзак он не трогает', () => {
    const camp = createCamp();
    camp.resources.wood = 10;
    assert.equal(storeCapacity(camp), STORE_BASE);
    buildChest(camp, { x: 0, z: 0 });
    buildChest(camp, { x: 5, z: 0 });
    assert.equal(storeCapacity(camp), STORE_BASE + CHEST_BONUS * 2);
  });

  test('потолок стоит на притоке: лишнее не входит, дорогое входит первым', () => {
    const camp = createCamp();
    camp.resources.stone = storeCapacity(camp) - 3;
    // Свободно три клетки, несут пять: кристалл и железо входят целиком,
    // дерево режется, и `stash` называет ровно то, что пропало.
    const lost = stash(camp, { crystal: 1, iron: 1, wood: 3 });
    assert.equal(lost, 2);
    assert.equal(camp.resources.crystal, 1);
    assert.equal(camp.resources.iron, 1);
    assert.equal(camp.resources.wood, 1);
    assert.equal(storeFree(camp), 0);
  });

  test('переполненный сейв ничего не теряет: перебор доживает до траты', () => {
    const camp = createCamp();
    camp.resources.stone = storeCapacity(camp) + 40;
    const was = storeUsed(camp);
    assert.equal(stash(camp, { wood: 5 }), 5); // нового не входит…
    assert.equal(storeUsed(camp), was); // …но и старое не отнимается
  });

  test('сундук и палатка не встают друг на друга', () => {
    const camp = createCamp();
    camp.resources.wood = 10;
    buildChest(camp, { x: 0, z: 0 });
    // Палатке нужен бездомный: жилец без крыши — единственный повод.
    camp.residents.push({ name: 'Тест', look: 'поселенец', seed: 1, answer: 'строим', rest: false });
    assert.equal(tentFits(camp, 0, 0), false);
    const tent = buildTent(camp, { x: 0, z: 3 });
    assert.deepEqual(tent, { x: 0, z: 3 });
    assert.equal(chestFits(camp, 0, 3), false);
  });

  test('приём сундука пролога: занятая клетка не теряет сундук, а сдвигает', () => {
    const camp = createCamp();
    // Клетка «мимо площадки» — путь сейва без сундуков и пролога без места.
    adoptChest(camp, { x: -1, z: -1 });
    assert.equal(camp.chests.length, 1);
    const spot = camp.chests[0]!;
    assert.ok(chestFits(camp, spot.x, spot.z) === false); // клетка теперь занята им самим
    assert.ok(spot.x >= 0 && spot.z >= 0);
  });

  test('на поляне сундук встаёт рядом со следом палатки и не на дереве', () => {
    const loc = generateGlade(42);
    // След 2×2 кладётся на первую пару свободных клеток, какую найдём.
    let cell: { x: number; z: number } | null = null;
    for (let z = 1; z < loc.size - 2 && cell === null; z++) {
      for (let x = 1; x < loc.size - 2 && cell === null; x++) {
        let free = true;
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            if (loc.blocked[(z + dz) * loc.size + (x + dx)]) free = false;
          }
        }
        if (free) cell = { x, z };
      }
    }
    assert.ok(cell !== null, 'на поляне не нашлось места под палатку');
    const hero = { x: cell.x - 1, z: cell.z - 1 };
    const spot = chestSiteNear(loc, [cell], hero, cell);
    if (spot !== null) {
      assert.equal(loc.blocked[spot.z * loc.size + spot.x], 0);
      // Рядом со следом: не дальше одной клетки от квадрата 2×2.
      assert.ok(spot.x >= cell.x - 1 && spot.x <= cell.x + 2);
      assert.ok(spot.z >= cell.z - 1 && spot.z <= cell.z + 2);
      // Не внутри следа.
      assert.ok(spot.x < cell.x || spot.x >= cell.x + 2 || spot.z < cell.z || spot.z >= cell.z + 2);
    }
  });
});

describe('засада сундука', () => {
  test('золотой сундук — иногда на ярусе 3 и никогда ниже', () => {
    // §13.6: редкая находка, а не строка росписи. Сто сидов — доля заходов
    // с сундуком обязана быть между «событием» и «не встретить никогда».
    let gold = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const loc = generateLocation(seed, 3, 1, 1);
      const chest = loc.containers.find((c) => c.look === 'золотой');
      if (chest === undefined) continue;
      gold++;
      assert.equal(chest.kind, 'crystal', `сид ${seed}: в золотом сундуке не кристалл`);
      assert.equal(chest.ambush?.kind, 'warrior', `сид ${seed}: засада не скелетами`);
      const count = chest.ambush?.count ?? 0;
      assert.ok(count >= 1 && count <= 3, `сид ${seed}: скелетов ${count}, а не 1–3`);
    }
    assert.ok(gold >= 20 && gold <= 60, `золотых сундуков ${gold} на 100 сидов`);
    for (let seed = 1; seed <= 30; seed++) {
      for (const tier of [0, 1, 2] as const) {
        assert.ok(
          generateLocation(seed, tier, 1, 1).containers.every((c) => c.look === undefined),
          `сид ${seed}: золотой сундук на ярусе ${tier}`,
        );
      }
    }
  });

  test('вскрытие казны замка поднимает стражу, и она не отпускает', () => {
    const site = generateCastleSite(7);
    const chest = site.loc.containers[0]!;
    const raid = createRaid({
      seed: 7,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loc: site.loc,
      evacOpen: true,
      containerFood: 0,
      hunger: false,
    });
    // Герой ставится вплотную и делает последний шаг сам: вскрытие —
    // это приход на клетку, и засада обязана подняться этим же шагом.
    raid.hero.x = chest.x - 1;
    raid.hero.z = chest.z;
    raid.hero.prevX = raid.hero.x;
    raid.hero.prevZ = raid.hero.z;
    assert.ok(commandMove(raid, { x: chest.x, z: chest.z }));
    for (let i = 0; i < 50 && !chest.opened; i++) stepRaid(raid, 0.1, false, 0);
    assert.ok(chest.opened, 'казна не вскрылась приходом на клетку');
    assert.ok(raid.bag.iron > 0, 'железо казны не попало в рюкзак');
    const guards = raid.loc.enemies.filter((e) => e.kind === 'guard');
    assert.equal(guards.length, chest.ambush!.count, 'стражи поднялось не столько, сколько назначено');
    for (const g of guards) {
      assert.ok(g.awake, 'стражник спит после засады');
      assert.equal(g.relentless, true, 'стражник без метки „не отпускает“');
      assert.equal(g.hp, ENEMY_STATS.guard.hp);
    }
    // Стражник быстрее героя — иначе погоня от ворот не догоняет никогда.
    assert.ok(ENEMY_STATS.guard.speed > 1.67, 'стражник медленнее героя');
    // Погоня: за десять секунд мира стража сокращает дистанцию до боя.
    const dist = (): number =>
      Math.min(...guards.map((g) => Math.hypot(g.x - raid.hero.x, g.z - raid.hero.z)));
    const before = dist();
    for (let i = 0; i < 100 && raid.battle === null; i++) stepRaid(raid, 0.1, false, 0);
    assert.ok(
      raid.battle !== null || dist() < before,
      'стража не приближается и бой не начинается',
    );
  });
});
