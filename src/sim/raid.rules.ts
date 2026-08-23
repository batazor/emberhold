/**
 * Правила вылазки.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { START_FOOD } from './balance';
import { TICK } from '../core/loop';
import { createCamp, kitchenFood, storageCapacity } from './camp';
import { bowQuiver, emptyGear } from './gear';
import { createHero, enemyXp, loadout } from './heroes';
import { POLICIES, botBattlePlan } from './bot';
import {
  atRisk,
  backSteps,
  commandBattle,
  commandMove,
  createRaid,
  inBattle,
  raidResult,
  stepRaid,
} from './raid';
import type { RaidState } from './raid';
import { addResources } from './resources';

/** Гоняет симуляцию, пока герой идёт, но не дольше лимита. */
const run = (state: RaidState, seconds: number): void => {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks && state.status === 'running' && state.path.length > 0; i++) {
    stepRaid(state, TICK, true, 5);
  }
};

describe('Вылазка', () => {
  /**
   * §11.4 — обзор считается в одном месте и одним числом.
   *
   * Правило заведено на конкретном расхождении: слагаемых у обзора три —
   * формула, фонарь из снаряжения и событие, — а свет на экране брал только
   * формулу. Выкованный фонарь будил скелетов на два тайла дальше, не расширив
   * круга света; обвал сужал обзор, не тронув картинку. Проверяется поэтому
   * не формула (она в config), а то, что все три слагаемых доезжают
   * до `state.vision`, откуда читает и `stepContact`, и рендер.
   */
  test('§11.4 — фонарь и событие доезжают до обзора', () => {
    const opts = {
      seed: 5,
      tier: 2 as const,
      kitchenLevel: 3,
      storageLevel: 3,
      gear: emptyGear(),
    };
    const bare = createRaid(opts);
    const lit = createRaid({ ...opts, gear: { ...emptyGear(), torch: 4 } });
    const shielded = createRaid({ ...opts, gear: { ...emptyGear(), torch: 4 }, offhand: 'shield' });
    const buried = createRaid({ ...opts, event: 'collapse' });

    assert.equal(lit.vision, bare.vision + lit.mods.vision, 'фонарь не расширил обзор');
    assert.ok(lit.mods.vision > 0, 'и прибавка у фонаря ненулевая, иначе проверка пустая');
    assert.equal(shielded.vision, bare.vision, '§14.2 — со щитом в левой руке не светит');
    assert.equal(buried.vision, bare.vision + buried.visionAdd, 'обвал не сузил обзор');
    assert.equal(buried.visionAdd, -1, 'и сужает он именно на тайл');

    // Шаг пересчитывает число целиком, а не только базу: до этого поля
    // слагаемые складывались внутри stepRaid и наружу не выходили.
    const before = lit.vision;
    stepRaid(lit, TICK, false, lit.loadout.knowledge);
    assert.equal(lit.vision, before, 'день на входе и день на шаге дают одно');
    stepRaid(lit, TICK, true, lit.loadout.knowledge);
    assert.equal(lit.vision, before - 1, '§11.4 — ночь отнимает тайл, а фонарь остаётся');
  });

  /**
   * §14.3. Вместимость колчана задаёт лук, запас — лагерь, и путать их нельзя.
   * Пока `arrowsMax` считался от взятого, ноль в лагере обнулял вместимость,
   * а подбор упирается в `arrows < arrowsMax` — и пустой колчан не мог
   * наполниться ничем, кроме покупки за железо. Ноль был поглощающим:
   * потратил всё, железа нет — стрелкового класса больше нет.
   */
  test('§14.3 — пустой лагерный запас не запирает колчан', () => {
    const opts = {
      seed: 7,
      tier: 0 as const,
      kitchenLevel: 1,
      storageLevel: 1,
      loadout: loadout(createHero('archer', 0)),
      gear: emptyGear(),
    };
    const empty = createRaid({ ...opts, arrows: 0 });
    assert.equal(empty.arrows, 0, 'взять из пустого лагеря нечего');
    assert.equal(empty.arrowsMax, bowQuiver(0), 'но колчан всё равно вмещает');
    assert.ok(empty.arrows < empty.arrowsMax, 'значит подбор в вылазке возможен');

    // Запас сверх вместимости в колчан не влезает — это и есть вторая половина
    // правила: числа разные, но запас никогда не больше колчана.
    const full = createRaid({ ...opts, arrows: 99 });
    assert.equal(full.arrows, bowQuiver(0), 'взято не больше вместимости');
  });

  test('§14.3 — колчан не заводится у тех, кто не стреляет', () => {
    const knight = createRaid({
      seed: 7,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loadout: loadout(createHero('knight', 0)),
      gear: emptyGear(),
      arrows: 99,
    });
    assert.equal(knight.arrowsMax, 0, 'у ближнего боя колчана нет вовсе');
    assert.equal(knight.arrows, 0);
  });

  test('§2 — Кухня и Склад задают провиант и рюкзак', () => {
    const raid = createRaid({ seed: 1, tier: 1, kitchenLevel: 3, storageLevel: 2 });
    // Значения берутся из кривых, а не повторяются числом: кривая Кухни выведена
    // моделью и меняется вместе с TIER_SPEC.
    assert.equal(raid.food, kitchenFood(3));
    assert.equal(raid.foodMax, kitchenFood(3));
    assert.equal(raid.capacity, storageCapacity(2));
  });

  test('§11.1 — путь назад считается от выхода', () => {
    const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    assert.equal(backSteps(raid), 0, 'на точке выхода путь назад нулевой');
    const far = raid.loc.containers[0];
    assert.ok(far !== undefined);
    assert.equal(commandMove(raid, far), true, 'до контейнера есть путь');
    run(raid, 120);
    assert.ok(backSteps(raid) > 0, 'отойдя от выхода, путь назад вырос');
  });

  test('контейнер стоит провианта и наполняет рюкзак (§11.1)', () => {
    const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    const target = raid.loc.containers[0];
    assert.ok(target !== undefined);
    commandMove(raid, target);
    run(raid, 120);
    assert.ok(raid.bagTotal > 0, 'добыча в рюкзаке');
    assert.ok(raid.food < raid.foodMax - raid.steps, 'вскрытие списало сверх шагов');
    assert.equal(raid.loc.containers[0]?.opened, true);
  });

  test('§11.2 — под угрозой ceil(добыча × доля яруса)', () => {
    const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    raid.bag.stone = 7;
    raid.bagTotal = 7;
    assert.equal(atRisk(raid), 5, '7 × 0.6 = 4.2 → 5');
  });

  test('провал теряет долю рюкзака, возвращение — ничего', () => {
    const raid = createRaid({ seed: 3, tier: 3, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 6, wood: 0, iron: 3, crystal: 1, food: 0 };
    raid.bagTotal = 10;

    raid.status = 'failed';
    const lost = raidResult(raid);
    assert.equal(lost.lost, 10, 'на дне ставка 100%');
    assert.equal(lost.carriedTotal, 0);

    raid.status = 'evacuated';
    const saved = raidResult(raid);
    assert.equal(saved.lost, 0);
    assert.deepEqual(saved.carried, { stone: 6, wood: 0, iron: 3, crystal: 1, food: 0 });
  });

  test('потери распределяются по составу рюкзака, а не по одному виду', () => {
    const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 10, wood: 0, iron: 10, crystal: 0, food: 0 };
    raid.bagTotal = 20;
    raid.status = 'failed';
    const r = raidResult(raid);
    assert.equal(r.lost, 12, '20 × 0.6');
    assert.equal(r.carriedTotal, 8);
    assert.ok(r.carried.stone > 0 && r.carried.iron > 0, 'обе кучи пострадали');
  });

  /**
   * §11.3 — бой обязан кончаться, и обязан кончаться **тем, кто его ведёт.**
   *
   * Правило написано по цене конкретной поломки. Пошаговый бой ждёт решения
   * героя (`stepBattle` возвращает `false` на его ходу), а `scripts/combat.ts`
   * вёл дуэль одним `stepRaid` — как при автобое. Очередь вставала намертво,
   * прибор докручивал свой лимит, ничего не измерив, и печатал вердикт
   * «Атака и Защита в бой не входят» — про механику, которая работала.
   *
   * Хуже отсутствующего прибора только уверенно врущий, поэтому дальше
   * это ловит `npm run check`, а не чтение вывода глазами.
   */
  describe('§11.3 — бой ведёт тот, кто его начал', () => {
    /** Вылазка с единственным противником вплотную: бой завяжется сразу. */
    const duel = () => {
      const raid = createRaid({ seed: 5, tier: 1, kitchenLevel: 3, storageLevel: 2 });
      const enemy = raid.loc.enemies[0];
      assert.ok(enemy !== undefined, 'ярус 1 без противников — правило не о том');
      raid.loc.enemies.length = 1;
      enemy.x = raid.hero.x + 0.5;
      enemy.z = raid.hero.z;
      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      enemy.awake = true;
      return { raid, enemy };
    };

    test('ведомый бой кончается падением одной из сторон', () => {
      const { raid, enemy } = duel();
      for (let i = 0; i < 4000 && raid.status === 'running'; i++) {
        if (inBattle(raid)) {
          // Отклонённое решение кончается ожиданием, а не повтором: иначе
          // очередь стоит и бой не кончается по другой причине.
          if (!commandBattle(raid, botBattlePlan(raid, POLICIES.greedy))) {
            commandBattle(raid, { kind: 'wait' });
          }
        }
        stepRaid(raid, TICK, false, 5);
        if (!inBattle(raid) && (enemy.hp <= 0 || raid.hero.hp <= 0)) break;
      }
      assert.equal(inBattle(raid), false, 'бой не кончился: очередь встала');
      assert.ok(
        enemy.hp <= 0 || raid.hero.hp <= 0,
        'бой кончился, но никто не пал — значит мерили не бой',
      );
      assert.equal(
        raid.combatXp,
        enemy.hp <= 0 ? enemyXp(enemy.kind, enemy.level) : 0,
        'опыт начисляется один раз за павшего врага',
      );
      assert.equal(raidResult(raid).combatXp, raid.combatXp, 'награда доезжает до итога');
    });

    test('неведомый бой стоит на месте, а не идёт сам', () => {
      // Вторая половина того же правила, и она важнее первой. Прибор,
      // забывший ход героя, обязан выглядеть зависшим — тогда его чинят.
      // Если бы такой бой как-то доигрывался сам, поломка выше осталась бы
      // невидимой ровно так же, как была.
      const { raid, enemy } = duel();
      const hp = enemy.hp;
      for (let i = 0; i < 2000 && raid.status === 'running'; i++) stepRaid(raid, TICK, false, 5);
      assert.equal(inBattle(raid), true, 'бой доигрался без единого решения героя');
      assert.equal(raid.battle?.round, 1, 'раунд сдвинулся, хотя герой не ходил');
      assert.equal(enemy.hp, hp, 'стойкость упала без единого удара героя');
    });
  });

  test('добыча доезжает до лагеря', () => {
    const camp = createCamp();
    const raid = createRaid({ seed: 11, tier: 1, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 4, wood: 3, iron: 1, crystal: 0, food: 0 };
    raid.bagTotal = 8;
    raid.status = 'evacuated';
    addResources(camp.resources, raidResult(raid).carried);
    // §13.7 — пища стартового запаса лежит нетронутой: вылазка её не приносит
    // (в находках пищи нет) и не тратит (содержание считается в лагере).
    assert.deepEqual(camp.resources, { stone: 4, wood: 3, iron: 1, crystal: 0, food: START_FOOD });
  });
});
