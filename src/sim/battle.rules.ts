/**
 * Правила пошагового боя (§11.3). Здесь только то, что проверяется без
 * статистики: инварианты хода, порядка и урона. Числа боя живут в замерах.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  GUARD_SHARE,
  advance,
  alive,
  apply,
  battleOver,
  createBattle,
  enemyPlan,
  current,
  initiative,
  movePerTurn,
  moves,
  reachInHexes,
  targets,
} from './battle';
import type { BattleState, BattleUnit } from './battle';
import { ROUND_SECONDS } from './battle';
import { ENEMY_STATS } from './enemies';
import { hexDistance, hexKey, hexToWorld } from './hex';

const N = 32;
const open = (): Uint8Array => new Uint8Array(N * N);
const nameOf = (u: BattleUnit): string => (u.side === 'hero' ? 'Герой' : ENEMY_STATS[u.kind!].name);
const flat = () => 4;

/** Герой и один скелет рядом, посреди чистого поля. */
function duo(kind: 'minion' | 'warrior' | 'mage' = 'minion'): BattleState {
  const c = hexToWorld({ q: 8, r: 8 });
  const e = hexToWorld({ q: 9, r: 8 });
  return createBattle(
    N, open(),
    [{ id: -1, x: c.x, z: c.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3 }],
    [{ id: 0, kind, x: e.x, z: e.z, hp: ENEMY_STATS[kind].hp }],
  );
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
      [{ id: -1, x: c.x, z: c.z, hp: 20, speed: 1.67, reach: 1, ranged: false, attack: 4, defense: 3 }],
      [
        { id: 0, kind: 'minion', x: c.x, z: c.z, hp: 4 },
        { id: 1, kind: 'minion', x: c.x + 0.01, z: c.z, hp: 4 },
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
