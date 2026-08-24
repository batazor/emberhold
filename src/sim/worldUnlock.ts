/**
 * Условия открытия прогулочных мест глобальной карты.
 *
 * Вылазки остаются основой мира и запираются только Кухней. Особые места
 * открываются развитием лагеря: так новая точка становится наградой за уже
 * понятное действие, а не ещё одной кнопкой на карте с первой минуты.
 *
 * Состояние отдельно не сохраняется. Все пять условий монотонны и выводятся
 * из уже существующего сейва — старому сохранению не нужна миграция, а
 * карточка и фактический вход не могут разойтись из-за забытого флага.
 */
import type { CampState } from './camp';
import type { Roster } from './heroes';
import type { NodeKind } from './world';

export type WorldUnlockGoal = 'forge' | 'raids' | 'storage' | 'kitchen' | 'hero';

export interface WorldUnlock {
  readonly goal: WorldUnlockGoal;
  readonly current: number;
  readonly required: number;
  readonly unlocked: boolean;
}

interface WorldUnlockRule {
  readonly goal: WorldUnlockGoal;
  readonly required: number;
  current(camp: CampState, roster: Roster): number;
}

type UnlockableNodeKind = Exclude<NodeKind, 'вылазка'>;

/**
 * Лестница намеренно использует разные системы, которыми место затем
 * пользуется: торговец продолжает Мастерскую, тропа окупает вместительный
 * Склад, колесо знакомит с кристаллами после первого расширения Кухни,
 * а боевой замок ждёт подготовленного героя.
 */
const WORLD_UNLOCK_RULE: Record<UnlockableNodeKind, WorldUnlockRule> = {
  'замок': {
    goal: 'forge',
    required: 1,
    current: (camp) => camp.levels.forge,
  },
  'кладбище': {
    goal: 'raids',
    required: 3,
    current: (camp) => camp.raids,
  },
  'тропа': {
    goal: 'storage',
    required: 2,
    current: (camp) => camp.levels.storage,
  },
  'призы': {
    goal: 'kitchen',
    required: 2,
    current: (camp) => camp.levels.kitchen,
  },
  'замок минотавра': {
    goal: 'hero',
    required: 3,
    current: (_camp, roster) => roster.heroes.reduce(
      (highest, hero) => Math.max(highest, hero.level),
      0,
    ),
  },
};

/** Вылазка возвращает null: у неё уже есть отдельный гейт Кухни. */
export function worldUnlock(
  kind: NodeKind,
  camp: CampState,
  roster: Roster,
): WorldUnlock | null {
  if (kind === 'вылазка') return null;
  const rule = WORLD_UNLOCK_RULE[kind];
  const current = Math.max(0, Math.floor(rule.current(camp, roster)));
  return {
    goal: rule.goal,
    current,
    required: rule.required,
    unlocked: current >= rule.required,
  };
}
