/**
 * Пошаговый бой (§11.3). Мир исследуется в реальном времени; как только
 * контакт завязался, время останавливается и на местности проступает
 * гекс-решётка (`hex.ts`).
 *
 * **Что это меняет в конструкции игры и чего не меняет.**
 *
 * Меняет: бой перестаёт быть арифметикой, за которой игрок наблюдает.
 * Атака, Защита, Скорость и позиция становятся тем, чем распоряжаются,
 * а не тем, что подставляется в формулу за кадром.
 *
 * Не меняет: решение «глубже или назад» (§22.5) остаётся главным. Поэтому
 * бой **стоит провианта за раунд**, а не только за завязку. Останови время
 * бесплатно — и стоять в бою станет выгоднее, чем идти, а весь §11
 * держится ровно на обратном.
 *
 * Случайности здесь нет по той же причине, что и раньше: шаг вылазки
 * детерминирован (`scripts/arch.ts`), и на этом стоит воспроизводимость
 * замеров. Инициатива считается Скоростью, а не броском.
 */
import { HERO_RANGED_REACH } from './config';
import { ENEMY_STATS } from './enemies';
import {
  hexDistance,
  hexKey,
  hexNeighbors,
  hexReach,
  hexSight,
  worldToHex,
} from './hex';
import type { Hex } from './hex';
import type { EnemyKind } from './types';

/**
 * Сколько секунд мира «стоит» раунд боя. Не настройка темпа, а курс обмена:
 * из него выводится, сколько гексов проходит боец за ход, и он же держит
 * скорости из §17.4 сравнимыми с прежними.
 */
export const ROUND_SECONDS = 2;

/**
 * Провиант за раунд боя сверх платы за завязку (§11.1). Единица — та же,
 * что за шаг: раунд стоит примерно как шаг, и затянувшийся бой съедает
 * дорогу домой. Без этого остановленное время становится бесплатным
 * убежищем, а §22.5 перестаёт работать.
 */
export const FOOD_PER_ROUND = 1;

export type Side = 'hero' | 'enemy';

export interface BattleUnit {
  readonly id: number;
  readonly side: Side;
  /** У противника — его вид; у героя null. */
  readonly kind: EnemyKind | null;
  hex: Hex;
  /** Очки стойкости у противника, целые раны у героя (§11.3). */
  hp: number;
  /** Гексов за ход. Выводится из скорости мира, а не назначается. */
  readonly move: number;
  /** Дальность удара в гексах. Ближний бой — единица, то есть соседство. */
  readonly reach: number;
  readonly ranged: boolean;
  /** Ходил ли уже в этом раунде. */
  acted: boolean;
  /** Держит ли блок до своего следующего хода (§14.2). */
  guarding: boolean;
}

export interface BattleState {
  readonly units: BattleUnit[];
  /** Порядок хода: индексы в `units`, отсортированные Скоростью. */
  readonly order: number[];
  /** Чей ход сейчас — позиция в `order`. */
  at: number;
  round: number;
  /** Что случилось за последний ход — для реплик HUD и звука. */
  events: string[];
}

export type BattleAction =
  | { readonly kind: 'move'; readonly to: Hex }
  | { readonly kind: 'attack'; readonly target: number }
  | { readonly kind: 'guard' }
  | { readonly kind: 'wait' };

/** Гексов за ход из скорости мира. Не меньше одного: боец, который не может
 *  сдвинуться, превращает бой в перестрелку двух столбов. */
export const movePerTurn = (speed: number): number =>
  Math.max(1, Math.round(speed * ROUND_SECONDS));

/**
 * Ближний бой — это соседство, и точка. В мире досягаемость меряется долями
 * клетки (топор воина 1,5 против геройской 1,0), и это имело смысл, пока
 * противник останавливался на длине своего оружия. На решётке остановиться
 * «в полутора гексах» нельзя, и полтора превращаются в один — то есть
 * в то же самое соседство. Разница уходит туда, где ей место: в Атаку.
 */
export const reachInHexes = (reach: number, ranged: boolean): number =>
  ranged ? Math.max(1, Math.round(reach)) : 1;

export const unitAt = (state: BattleState, hex: Hex): BattleUnit | undefined =>
  state.units.find((u) => u.hp > 0 && hexKey(u.hex) === hexKey(hex));

export const current = (state: BattleState): BattleUnit | undefined =>
  state.units[state.order[state.at] ?? -1];

export const alive = (state: BattleState, side: Side): BattleUnit[] =>
  state.units.filter((u) => u.side === side && u.hp > 0);

/** Занятые гексы — тела не проходятся насквозь. */
export const occupied = (state: BattleState, except?: number): ReadonlySet<string> =>
  new Set(state.units.filter((u) => u.hp > 0 && u.id !== except).map((u) => hexKey(u.hex)));

/**
 * Порядок хода. Быстрый ходит раньше — Скорость впервые получает смысл,
 * которого у неё не было: в реальном времени она задавала, как быстро враг
 * подбегает, и на этом её роль кончалась.
 *
 * Ничьи разрешаются номером, а не броском: шаг обязан быть детерминированным.
 * Герой при равной скорости ходит первым — правило одно и записано здесь,
 * а не выведено из порядка, в котором генератор разложил противников.
 */
export function initiative(units: readonly BattleUnit[], speeds: readonly number[]): number[] {
  return units
    .map((u, i) => ({ i, speed: speeds[i] ?? 0, side: u.side }))
    .sort((a, b) =>
      b.speed - a.speed
      || (a.side === b.side ? 0 : a.side === 'hero' ? -1 : 1)
      || a.i - b.i)
    .map((x) => x.i);
}

/** Начало боя: бойцы встают на решётку там, где застал контакт. */
export function createBattle(
  hero: { x: number; z: number; wounds: number; speed: number; reach: number; ranged: boolean },
  enemies: readonly { id: number; kind: EnemyKind; x: number; z: number; hp: number }[],
): BattleState {
  const units: BattleUnit[] = [
    {
      id: -1,
      side: 'hero',
      kind: null,
      hex: worldToHex(hero.x, hero.z),
      hp: hero.wounds,
      move: movePerTurn(hero.speed),
      reach: reachInHexes(hero.ranged ? HERO_RANGED_REACH : hero.reach, hero.ranged),
      ranged: hero.ranged,
      acted: false,
      guarding: false,
    },
  ];

  const taken = new Set<string>([hexKey(units[0]!.hex)]);
  for (const e of enemies) {
    const stats = ENEMY_STATS[e.kind];
    let hex = worldToHex(e.x, e.z);
    // Двое в одном гексе — следствие округления, а не расстановки: в мире
    // они стояли врозь. Раздвигаем по соседям, а не роняем бой.
    if (taken.has(hexKey(hex))) {
      const free = hexNeighbors(hex).find((n) => !taken.has(hexKey(n)));
      if (free !== undefined) hex = free;
    }
    taken.add(hexKey(hex));
    units.push({
      id: e.id,
      side: 'enemy',
      kind: e.kind,
      hex,
      hp: e.hp,
      move: movePerTurn(stats.speed),
      reach: reachInHexes(stats.ranged ? stats.reach : 1, stats.ranged),
      ranged: stats.ranged,
      acted: false,
      guarding: false,
    });
  }

  const speeds = units.map((u) => (u.side === 'hero' ? hero.speed : ENEMY_STATS[u.kind!].speed));
  return { units, order: initiative(units, speeds), at: 0, round: 1, events: [] };
}

/** Кончился ли бой и чем. */
export function battleOver(state: BattleState): 'hero' | 'enemy' | null {
  if (alive(state, 'hero').length === 0) return 'enemy';
  if (alive(state, 'enemy').length === 0) return 'hero';
  return null;
}

/** Куда этот боец может дойти за свой ход. */
export function moves(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  unit: BattleUnit,
): Map<string, { hex: Hex; steps: number }> {
  return hexReach(size, blocked, unit.hex, unit.move, occupied(state, unit.id));
}

/** Кого этот боец достаёт с места, где стоит. */
export function targets(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  unit: BattleUnit,
): BattleUnit[] {
  return state.units.filter(
    (u) =>
      u.hp > 0
      && u.side !== unit.side
      && hexDistance(unit.hex, u.hex) <= unit.reach
      // Ближний достаёт соседа и без линии: он и так вплотную.
      && (!unit.ranged || hexSight(size, blocked, unit.hex, u.hex)),
  );
}

/** Передать ход следующему живому. Новый раунд снимает блоки и отметки. */
export function advance(state: BattleState): void {
  for (let step = 0; step < state.order.length + 1; step++) {
    state.at += 1;
    if (state.at >= state.order.length) {
      state.at = 0;
      state.round += 1;
      for (const u of state.units) u.acted = false;
    }
    const next = current(state);
    if (next !== undefined && next.hp > 0) {
      // Блок держится до собственного следующего хода: он и есть цена хода,
      // потраченного на защиту, а не бесплатная поза.
      next.guarding = false;
      return;
    }
  }
}

/**
 * Сколько ран снимает удар этого бойца по этому. Урон считается теми же
 * правилами, что и в реальном времени: у противника очки стойкости, у героя
 * целые раны через пробой (§11.3). Пошаговость меняет, **когда** бьют,
 * а не **как** считается удар, — иначе получилось бы две модели боя,
 * и настраивать пришлось бы обе.
 */
export interface Damage {
  /** Сколько снять с цели: очков стойкости или ран. */
  readonly amount: number;
  /** Отражён ли удар блоком. */
  readonly blocked: boolean;
}

/**
 * Блок делит удар пополам, а не отменяет его. Отмена превратила бы блок
 * в единственный разумный ход против сильного противника; половина оставляет
 * его решением — потраченным ходом, который окупается не всегда.
 */
export const GUARD_SHARE = 0.5;

/** Применить действие текущего бойца. Возвращает, потрачен ли ход. */
export function apply(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  action: BattleAction,
  damageOf: (from: BattleUnit, to: BattleUnit) => number,
  name: (u: BattleUnit) => string,
): boolean {
  const unit = current(state);
  if (unit === undefined || unit.hp <= 0) return false;
  state.events.length = 0;

  switch (action.kind) {
    case 'move': {
      const reach = moves(state, size, blocked, unit);
      const spot = reach.get(hexKey(action.to));
      if (spot === undefined) return false;
      unit.hex = spot.hex;
      // Шаг хода не кончает: подойти и ударить — один ход, иначе ближний бой
      // становится вдвое медленнее дальнего без всякой на то причины.
      return true;
    }
    case 'attack': {
      const target = state.units.find((u) => u.id === action.target && u.hp > 0);
      if (target === undefined) return false;
      if (!targets(state, size, blocked, unit).includes(target)) return false;
      const raw = damageOf(unit, target);
      const dealt = target.guarding ? Math.max(1, Math.round(raw * GUARD_SHARE)) : raw;
      target.hp -= dealt;
      state.events.push(
        target.guarding
          ? `${name(unit)} бьёт — ${name(target)} держит`
          : `${name(unit)} бьёт`,
      );
      if (target.hp <= 0) state.events.push(`${name(target)} падёт`);
      unit.acted = true;
      return true;
    }
    case 'guard': {
      unit.guarding = true;
      unit.acted = true;
      state.events.push(`${name(unit)} закрывается`);
      return true;
    }
    case 'wait': {
      unit.acted = true;
      return true;
    }
  }
}
