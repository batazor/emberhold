/**
 * Правила пошагового боя (§11.3). Здесь только то, что проверяется без
 * статистики: инварианты хода, порядка и урона. Числа боя живут в замерах.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DODGE_FLOOR_SHARE,
  DODGE_MAX,
  GUARD_SHARE,
  MINOTAUR_CHARGE_BONUS,
  STONE_ARMOR,
  advance,
  dodgeOf,
  rollPercent,
  alive,
  apply,
  battleOver,
  createBattle,
  enemyPlan,
  forecastRound,
  current,
  initiative,
  movePerTurn,
  moves,
  reachInHexes,
  targets,
} from './battle';
import type { BattlePlay, BattleState, BattleUnit } from './battle';
import { ROUND_SECONDS } from './battle';
import { ENEMY_STATS } from './enemies';
import { hexDistance, hexKey, hexToWorld } from './hex';

const N = 32;
const open = (): Uint8Array => new Uint8Array(N * N);
const nameOf = (u: BattleUnit): string => (u.side === 'hero' ? 'Герой' : ENEMY_STATS[u.kind!].name);
const flat = () => 4;

/** Герой и один скелет рядом, посреди чистого поля.
 *  Ловкость героя нулевая, а уворот противника гасится на месте: старые
 *  инварианты проверяют удар, блок и очередь, и случайный промах в них —
 *  шум, а не предмет. Уворот проверяется своими тестами, со своим сидом. */
function duo(kind: 'minion' | 'warrior' | 'mage' = 'minion', agility = 0, seed = 0, shield = false): BattleState {
  const c = hexToWorld({ q: 8, r: 8 });
  const e = hexToWorld({ q: 9, r: 8 });
  const state = createBattle(
    N, open(),
    [{ id: -1, x: c.x, z: c.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3, agility, hasShield: shield }],
    [{ id: 0, kind, level: 1, x: e.x, z: e.z, hp: ENEMY_STATS[kind].hp }],
    seed,
  );
  if (agility === 0) for (const u of state.units) u.dodge = 0;
  return state;
}

describe('Пошаговый бой', () => {
  test('порядок хода — по Скорости, и ничьи разрешаются правилом', () => {
    // Скорость впервые получает смысл: в реальном времени она задавала лишь
    // то, как быстро враг подбегает. Ничья не может решаться броском —
    // шаг вылазки детерминирован.
    const units = [
      { side: 'hero' } as BattleUnit,
      { side: 'enemy' } as BattleUnit,
      { side: 'enemy' } as BattleUnit,
    ];
    assert.deepEqual(initiative(units, [1.7, 2.2, 1.4]), [0, 1, 2], 'герой открывает раунд');
    assert.deepEqual(initiative(units, [1.7, 1.4, 2.2]), [0, 2, 1], 'среди врагов — по Скорости');
    assert.deepEqual(initiative(units, [2, 2, 2]), initiative(units, [2, 2, 2]), 'порядок устойчив');
  });

  test('ход в гексах выводится из скорости мира, а не назначается', () => {
    // Курс обмена один на всех: иначе скорости §17.4 в бою и вне боя
    // означали бы разное.
    assert.equal(movePerTurn(1.67), Math.round(1.67 * ROUND_SECONDS));
    assert.equal(movePerTurn(2.2), Math.round(2.2 * ROUND_SECONDS));
    // Неподвижный всё равно может сдвинуться на гекс: боец, приросший
    // к месту, превращает бой в перестрелку двух столбов.
    assert.ok(movePerTurn(0) >= 1);
  });

  test('ближний бой — это соседство, дальний считает гексы', () => {
    assert.equal(reachInHexes(1.0, false), 1, 'геройское оружие');
    assert.equal(reachInHexes(1.5, false), 1, 'топор воина — то же соседство');
    assert.equal(reachInHexes(6, true), 6, 'выстрел меряется гексами');
  });

  test('никто не стоит в одном гексе с другим', () => {
    // Округление мировых координат может свести двоих в один гекс, хотя
    // в мире они стояли врозь. Бой от этого падать не должен.
    const c = hexToWorld({ q: 5, r: 5 });
    const state = createBattle(
      N, open(),
      [{ id: -1, x: c.x, z: c.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3, agility: 0 }],
      [
        { id: 0, kind: 'minion', level: 1, x: c.x, z: c.z, hp: 4 },
        { id: 1, kind: 'minion', level: 1, x: c.x + 0.01, z: c.z, hp: 4 },
      ],
    );
    const spots = state.units.map((u) => hexKey(u.hex));
    assert.equal(new Set(spots).size, spots.length, 'бойцы наложились друг на друга');
  });

  test('тело не проходится насквозь', () => {
    const state = duo();
    const actor = current(state)!;
    const foe = state.units.find((u) => u.side !== actor.side)!;
    const reach = moves(state, N, open(), actor);
    assert.ok(!reach.has(hexKey(foe.hex)), 'ход прошёл сквозь противника');
  });

  test('удар достаёт соседа и не достаёт дальнего', () => {
    const state = duo();
    const actor = current(state)!;
    const foe = state.units.find((u) => u.side !== actor.side)!;
    assert.equal(hexDistance(actor.hex, foe.hex), 1);
    assert.deepEqual(targets(state, N, open(), actor), [foe], 'сосед недосягаем');

    foe.hex = { q: foe.hex.q + 3, r: foe.hex.r };
    assert.deepEqual(targets(state, N, open(), actor), [], 'достаёт через три гекса');
  });

  test('блок делит удар, а не отменяет его', () => {
    // Отмена сделала бы блок единственным разумным ходом против сильного:
    // половина оставляет его решением, которое окупается не всегда.
    const state = duo();
    // Бьёт тот, чей ход, а не тот, кто первым записан: у скелета скорость
    // выше геройской, и очередь начинает он.
    const actor = current(state)!;
    const foe = state.units.find((u) => u.side !== actor.side)!;
    const before = foe.hp;

    apply(state, N, open(), { kind: 'attack', target: foe.id }, flat, nameOf);
    const plain = before - foe.hp;

    foe.hp = before;
    foe.guarding = true;
    apply(state, N, open(), { kind: 'attack', target: foe.id }, flat, nameOf);
    const guarded = before - foe.hp;

    assert.ok(guarded < plain, 'блок не уменьшил урон');
    assert.ok(guarded >= 1, 'блок обнулил урон — это уже неуязвимость');
    assert.equal(guarded, Math.max(1, Math.round(plain * GUARD_SHARE)));
  });

  test('минотавр после перемещения бьёт тараном', () => {
    const state = duo('minion');
    const enemy = state.units.find((u) => u.side === 'enemy')!;
    const hero = state.units.find((u) => u.side === 'hero')!;
    (enemy as { kind: BattleUnit['kind'] }).kind = 'minotaur';
    enemy.dodge = 0;
    hero.dodge = 0;
    while (current(state)!.id !== enemy.id) advance(state);
    enemy.moved = true;
    const before = hero.hp;
    const plays: BattlePlay[] = [];
    assert.equal(apply(state, N, open(), { kind: 'attack', target: hero.id }, flat, nameOf, plays), true);
    assert.equal(before - hero.hp, flat() + MINOTAUR_CHARGE_BONUS);
    const play = plays.at(-1);
    assert.equal(play?.kind, 'strike');
    assert.equal(play?.kind === 'strike' ? play.technique : null, 'minotaur-charge');
  });

  test('каменная броня голема гасит часть каждого удара', () => {
    const state = duo('minion');
    const enemy = state.units.find((u) => u.side === 'enemy')!;
    const hero = state.units.find((u) => u.side === 'hero')!;
    (enemy as { kind: BattleUnit['kind'] }).kind = 'stone-golem';
    while (current(state)!.id !== hero.id) advance(state);
    const before = enemy.hp;
    const plays: BattlePlay[] = [];
    assert.equal(apply(state, N, open(), { kind: 'attack', target: enemy.id }, flat, nameOf, plays), true);
    assert.equal(before - enemy.hp, Math.max(1, flat() - STONE_ARMOR));
    const play = plays.at(-1);
    assert.equal(play?.kind === 'strike' ? play.technique : null, 'stone-armor');
  });

  test('ход переходит по кругу, мёртвые пропускаются, раунд растёт', () => {
    const state = duo();
    const first = current(state)!;
    const seen = new Set<number>();
    for (let i = 0; i < state.order.length; i++) {
      seen.add(current(state)!.id);
      advance(state);
    }
    assert.equal(seen.size, state.units.length, 'кто-то не получил хода');
    assert.equal(state.round, 2, 'раунд не сменился');
    assert.equal(current(state)!.id, first.id, 'круг не замкнулся');

    // Мёртвый выбывает из очереди, а не держит её.
    state.units[1]!.hp = 0;
    advance(state);
    assert.equal(current(state)!.hp > 0, true, 'ход достался мёртвому');
  });

  test('блок держится до собственного следующего хода', () => {
    // Иначе он либо бесплатен и вечен, либо гаснет раньше чужого удара —
    // и в обоих случаях перестаёт быть ценой потраченного хода.
    const state = duo();
    const actor = current(state)!;
    apply(state, N, open(), { kind: 'guard' }, flat, nameOf);
    assert.equal(actor.guarding, true);
    advance(state);
    assert.equal(actor.guarding, true, 'блок снялся на чужом ходу');
    while (current(state)!.id !== actor.id) advance(state);
    assert.equal(actor.guarding, false, 'блок пережил собственный ход');
  });

  test('Заслон отталкивает первого ближнего атакующего', () => {
    const state = duo('minion', 0, 0, true);
    const hero = current(state)!;
    const enemy = state.units.find((u) => u.side === 'enemy')!;
    assert.equal(apply(state, N, open(), { kind: 'guard' }, flat, nameOf), true);
    advance(state);
    const before = { ...enemy.hex };
    const plays: BattlePlay[] = [];
    assert.equal(apply(state, N, open(), { kind: 'attack', target: hero.id }, flat, nameOf, plays), true);
    assert.equal(hexDistance(hero.hex, enemy.hex), 2, 'враг не отодвинулся от щита');
    assert.notDeepEqual(enemy.hex, before);
    assert.equal(hero.braceReady, false, 'один Заслон оттолкнул дважды');
    assert.ok(plays.some((p) => p.kind === 'strike' && p.pushedTo !== undefined));
  });

  test('щитоносец в Заслоне перехватывает первый удар по соседу', () => {
    const a = hexToWorld({ q: 8, r: 8 });
    const b = hexToWorld({ q: 8, r: 9 });
    const e = hexToWorld({ q: 9, r: 9 });
    const state = createBattle(
      N, open(),
      [
        { id: -1, x: a.x, z: a.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3, agility: 0, hasShield: true },
        { id: -2, x: b.x, z: b.z, hp: 5, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 0, agility: 0 },
      ],
      [{ id: 0, kind: 'minion', level: 1, x: e.x, z: e.z, hp: 8 }],
    );
    const shield = state.units.find((u) => u.id === -1)!;
    const ally = state.units.find((u) => u.id === -2)!;
    shield.guarding = true;
    shield.braceReady = true;
    shield.interceptReady = true;
    while (current(state)!.side !== 'enemy') advance(state);
    const shieldHp = shield.hp;
    const allyHp = ally.hp;
    const enemyHex = { ...state.units.find((u) => u.side === 'enemy')!.hex };
    const plays: BattlePlay[] = [];
    assert.equal(apply(state, N, open(), { kind: 'attack', target: ally.id }, flat, nameOf, plays), true);
    assert.ok(shield.hp < shieldHp, 'щитоносец не принял удар');
    assert.equal(ally.hp, allyHp, 'урон прошёл в прикрытого');
    assert.equal(shield.interceptReady, false);
    assert.deepEqual(
      state.units.find((u) => u.side === 'enemy')!.hex,
      enemyHex,
      'перехват через соседа не должен отбрасывать врага через две клетки',
    );
    assert.ok(plays.some((p) => p.kind === 'strike' && p.interceptedFor === ally.id));
  });

  test('прогноз не меняет бой и показывает цену Блока', () => {
    const state = duo();
    const before = JSON.stringify(state);
    const forecast = forecastRound(state, N, open(), flat);
    assert.notEqual(forecast, null);
    assert.equal(forecast!.damage, 4);
    assert.equal(forecast!.guardedDamage, 2);
    assert.equal(forecast!.threats.length, 1);
    assert.equal(JSON.stringify(state), before, 'прогноз сыграл бой вместо копии');
  });

  test('прогноз Заслона считает перехват соседнего союзника', () => {
    const allyAt = hexToWorld({ q: 8, r: 9 });
    const shieldAt = hexToWorld({ q: 8, r: 8 });
    const enemyAt = hexToWorld({ q: 9, r: 9 });
    const state = createBattle(
      N, open(),
      [
        { id: -2, x: allyAt.x, z: allyAt.z, hp: 5, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 0, agility: 0 },
        { id: -1, x: shieldAt.x, z: shieldAt.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3, agility: 0, hasShield: true },
      ],
      [{ id: 0, kind: 'minion', level: 1, x: enemyAt.x, z: enemyAt.z, hp: 8 }],
    );
    state.at = 1; // союзник уже выбрал ход; перед врагом решает щитоносец
    const forecast = forecastRound(state, N, open(), flat)!;
    assert.equal(forecast.damage, 0, 'без Заслона враг выбирает слабого союзника');
    assert.equal(forecast.guardedDamage, 2, 'Заслон переносит половину удара на щит');
    assert.equal(forecast.threats[0]?.guardedTarget, -1);
  });

  test('бой кончается, когда одна сторона кончилась', () => {
    const state = duo();
    assert.equal(battleOver(state), null);
    state.units[1]!.hp = 0;
    assert.equal(battleOver(state), 'hero');
    state.units[0]!.hp = 0;
    assert.equal(battleOver(state), 'enemy', 'ничья читается победой врага');
    assert.equal(alive(state, 'hero').length, 0);
  });

  test('чужое действие не проходит: ходит только тот, чей ход', () => {
    const state = duo();
    const notNow = state.units.find((u) => u.id !== current(state)!.id)!;
    const target = current(state)!;
    // Попытка ударить того, кто не в досягаемости текущего бойца.
    notNow.hex = { q: target.hex.q + 5, r: target.hex.r };
    assert.equal(
      apply(state, N, open(), { kind: 'attack', target: notNow.id }, flat, nameOf),
      false,
      'удар прошёл мимо правил досягаемости',
    );
  });
});

describe('Пошаговый бой: конечность', () => {
  test('ход состоит из одного перемещения и одного действия', () => {
    // Без этого бой не кончается никогда: план «дойти» остаётся выполнимым
    // после каждого шага, очередь не двигается. Золотой мастер показал это
    // как 95% провалов при нуле полученных ран — цифра ноль в такой метрике
    // всегда значит ошибку, а не баланс.
    const state = duo();
    const actor = current(state)!;
    const first = [...moves(state, N, open(), actor).values()][0]!;
    assert.equal(apply(state, N, open(), { kind: 'move', to: first.hex }, flat, nameOf), true);
    assert.equal(
      apply(state, N, open(), { kind: 'move', to: actor.hex }, flat, nameOf),
      false,
      'боец сходил дважды за ход',
    );
  });

  test('шаг на месте не считается ходом', () => {
    const state = duo();
    const actor = current(state)!;
    assert.ok(
      !moves(state, N, open(), actor).has(hexKey(actor.hex)),
      'собственный гекс попал в ходы — очередь встанет',
    );
  });

  test('бой сходится: очередь всегда доходит до конца', () => {
    // Исчерпывающая проверка того, что вешало игру: гоняем бой правилами
    // обеих сторон и требуем, чтобы он кончился за разумное число ходов.
    for (const kind of ['minion', 'warrior', 'mage'] as const) {
      const state = duo(kind);
      let turns = 0;
      while (battleOver(state) === null && turns < 500) {
        const unit = current(state)!;
        const plan = enemyPlan(state, N, open(), unit, ENEMY_STATS[kind].chases);
        // Обе стороны ходят одним правилом: вопрос не в тактике, а в том,
        // что очередь обязана двигаться при любом решении.
        if (!apply(state, N, open(), plan, flat, nameOf)) {
          apply(state, N, open(), { kind: 'wait' }, flat, nameOf);
        }
        if (current(state)!.acted) advance(state);
        turns += 1;
      }
      assert.ok(battleOver(state) !== null, `${kind}: бой не сошёлся за 500 ходов`);
    }
  });
});

describe('Пошаговый бой: уворот', () => {
  /** Противник бьёт героя раз за разом; ход и здоровье сбрасываются,
   *  чтобы мерить только броски, а не исход боя. */
  function volley(state: BattleState, hits: number): { dodges: number; floorHeld: boolean } {
    const hero = state.units.find((u) => u.side === 'hero')!;
    const foe = state.units.find((u) => u.side === 'enemy')!;
    while (current(state)!.id !== foe.id) advance(state);
    let dodges = 0;
    let floorHeld = true;
    for (let i = 0; i < hits; i++) {
      const before = hero.hp;
      assert.equal(
        apply(state, N, open(), { kind: 'attack', target: hero.id }, flat, nameOf),
        true,
        'удар не прошёл по правилам — стенд сломан, а не уворот',
      );
      if (hero.hp === before) dodges += 1;
      if (hero.dodge < hero.dodgeBase * DODGE_FLOOR_SHARE - 1e-9) floorHeld = false;
      hero.hp = 20;
      foe.acted = false;
    }
    return { dodges, floorHeld };
  }

  test('§11.3 — база уворота из Ловкости: монотонна и упирается в потолок', () => {
    // Потолок держит неуязвимость невозможной по построению: рост с уровнем
    // не должен доводить до бойца, по которому не попадают вовсе.
    assert.equal(dodgeOf(0), 0, 'нулевая Ловкость дала уворот');
    let prev = 0;
    for (let a = 1; a <= 40; a++) {
      const now = dodgeOf(a);
      assert.ok(now >= prev, `Ловкость ${a} увернула хуже, чем ${a - 1}`);
      prev = now;
    }
    assert.ok(dodgeOf(1000) <= DODGE_MAX, 'потолок уворота не держит');
    assert.ok(DODGE_MAX < 100, 'потолок в сотню — неуязвимость');
  });

  test('§11.3 — бросок детерминирован: тот же сид даёт ту же серию', () => {
    // На этом стоит воспроизводимость замеров и разбора бага по сейву:
    // случайность видит игрок, но не прибор.
    for (let n = 0; n < 50; n++) {
      const r = rollPercent(7, n);
      assert.equal(r, rollPercent(7, n), 'бросок не воспроизводится');
      assert.ok(r >= 0 && r < 100, 'бросок вышел за проценты');
    }
    const a = volley(duo('minion', 15, 7), 40);
    const b = volley(duo('minion', 15, 7), 40);
    assert.equal(a.dodges, b.dodges, 'два одинаковых боя разошлись');
  });

  test('§11.3 — нулевая Ловкость не уворачивается никогда', () => {
    // Иначе уворот стал бы свойством всех, а не характеристикой: герой
    // без Ловкости обязан получать каждый удар, как до её появления.
    const { dodges } = volley(duo('minion', 0, 3), 60);
    assert.equal(dodges, 0, 'боец без уворота ушёл от удара');
  });

  test('§11.3 — уворот работает, но не падает ниже трети базы', () => {
    // Плавающий уворот: промахи его сжигают, и серия атак пробивает
    // увёртливого. Пол в треть базы держит обратное — увёртливый не
    // вытаптывается в столб, по которому попадают всегда.
    const { dodges, floorHeld } = volley(duo('minion', 15, 11), 60);
    assert.ok(dodges > 0, 'Ловкость 15 не увернула ни разу за 60 ударов');
    assert.ok(dodges < 60, 'уворот стал неуязвимостью');
    assert.ok(floorHeld, 'уворот упал ниже трети базы');
  });

  test('§11.3 — держащий блок не уворачивается: блок и уворот не складываются', () => {
    // Сложенные, они дали бы позу, в которой можно стоять вечно; врозь
    // это два разных решения с разной ценой.
    const state = duo('minion', 15, 5);
    const hero = state.units.find((u) => u.side === 'hero')!;
    const foe = state.units.find((u) => u.side === 'enemy')!;
    hero.guarding = true;
    while (current(state)!.id !== foe.id) advance(state);
    for (let i = 0; i < 30; i++) {
      const before = hero.hp;
      apply(state, N, open(), { kind: 'attack', target: hero.id }, flat, nameOf);
      assert.ok(hero.hp < before, 'удар по блоку прошёл в пустоту');
      hero.hp = 20;
      hero.guarding = true;
      foe.acted = false;
    }
  });
});
