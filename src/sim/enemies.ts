import type { EnemyKind, EnemyStats } from './types';

/**
 * §15 — три типа, по одному на диапазон ярусов. Различимы силуэтом раньше,
 * чем цветом. §17.3 — чем опаснее противник, тем длиннее замах.
 */
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  scavenger: {
    kind: 'scavenger',
    name: 'Соляной падальщик',
    wounds: 1,
    speed: 2.2,
    telegraph: 0.25,
    attackInterval: 1.1,
    reach: 0.9,
    chases: true,
  },
  spearman: {
    kind: 'spearman',
    name: 'Копейщик пепла',
    wounds: 2,
    speed: 1.4,
    telegraph: 0.25,
    // Замер: герой снимает две раны копейщика за 2,4 с. При 1,4 с тот успевал
    // ударить дважды, и проход через комнату стоил жизни, а не раны (§15);
    // при 2,0 второй удар всё ещё успевал. При 2,6 он приходится уже после
    // смерти копейщика, и цена прохода — ровно одна рана.
    attackInterval: 2.6,
    reach: 1.5, // бьёт первым — за счёт длины копья, а не инициативы
    chases: true,
  },
  golem: {
    kind: 'golem',
    name: 'Обвальный голем',
    wounds: 5,
    speed: 0,
    telegraph: 0.5,
    attackInterval: 1.8,
    reach: 1.6,
    chases: false, // не преследует: перекрывает маршрут, обходится по кругу
  },
};

/**
 * Состав выводится моделью из бюджета ран (§22): копейщики и големы набираются
 * до бюджета, падальщики — по числу ожидаемых стычек. Руками здесь не правят;
 * сложность яруса задаётся в TIER_SPEC.
 */
export { TIER_ROSTER } from './balance';
