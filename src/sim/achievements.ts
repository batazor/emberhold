import type { CampState } from './camp';
import { dayAt } from './world';

/**
 * Ранние награды — не чек-лист действий, а три ступени первой петли:
 * игрок создаёт место, возвращается в него с добычей и делает его домом
 * ещё для кого-то. `paceDay` — ориентир темпа, не календарный замок:
 * пропущенную награду можно получить позже.
 */
export const ACHIEVEMENT_IDS = ['first-camp', 'first-return', 'first-shelter'] as const;
export type AchievementId = typeof ACHIEVEMENT_IDS[number];

export interface AchievementState {
  /** Мировые сутки, в которые началась личная летопись. */
  foundedDay: number;
  /** Момент и личный игровой день получения. */
  earned: Partial<Record<AchievementId, { at: number; day: number }>>;
  /** Просмотренные в коллекции награды. Непросмотренные зовут значком. */
  seen: AchievementId[];
}

export interface AchievementDef {
  readonly id: AchievementId;
  readonly paceDay: 1 | 2 | 3;
  readonly icon: 'camp' | 'return' | 'shelter';
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-camp',
    paceDay: 1,
    icon: 'camp',
  },
  {
    id: 'first-return',
    paceDay: 2,
    icon: 'return',
  },
  {
    id: 'first-shelter',
    paceDay: 3,
    icon: 'shelter',
  },
] as const;

export const achievementDef = (id: AchievementId): AchievementDef =>
  ACHIEVEMENTS.find((entry) => entry.id === id)!;

export function achievementState(camp: CampState, now: number): AchievementState {
  if (camp.achievements === undefined) {
    camp.achievements = { foundedDay: dayAt(now), earned: {}, seen: [] };
  }
  return camp.achievements;
}

/** Получить награду один раз. Возвращённое определение питает HUD. */
export function earnAchievement(
  camp: CampState,
  id: AchievementId,
  now: number,
): AchievementDef | null {
  const state = achievementState(camp, now);
  if (state.earned[id] !== undefined) return null;
  state.earned[id] = {
    at: now,
    day: Math.max(1, dayAt(now) - state.foundedDay + 1),
  };
  return achievementDef(id);
}

/**
 * Факты, которые можно честно восстановить из старого сохранения.
 * Успешное возвращение сюда не входит: `raids` считает и провалы, поэтому
 * приписать ему добычу было бы неправдой.
 */
export function reconcileAchievements(camp: CampState, now: number): AchievementDef[] {
  const unlocked: AchievementDef[] = [];
  if (camp.origin !== undefined) {
    const def = earnAchievement(camp, 'first-camp', now);
    if (def !== null) unlocked.push(def);
  }
  if (camp.residents.length > 0 && camp.tents.length > 0) {
    const def = earnAchievement(camp, 'first-shelter', now);
    if (def !== null) unlocked.push(def);
  }
  return unlocked;
}

export function unseenAchievements(camp: CampState): AchievementId[] {
  const state = camp.achievements;
  if (state === undefined) return [];
  return ACHIEVEMENT_IDS.filter((id) => state.earned[id] !== undefined && !state.seen.includes(id));
}

export function markAchievementsSeen(camp: CampState): boolean {
  const state = camp.achievements;
  if (state === undefined) return false;
  const next = ACHIEVEMENT_IDS.filter((id) => state.earned[id] !== undefined);
  if (next.length === state.seen.length && next.every((id) => state.seen.includes(id))) return false;
  state.seen = next;
  return true;
}
