import { gameMessage } from '../i18n/game';
import type { RoadMissionId } from '../sim/roadBridge';

export const ROAD_MISSION_COPY = {
  'inspect-bridge': {
    objective: gameMessage('Пройдите Тропу и осмотрите настил', 'Cross the Trail and inspect the decking'),
    detail: gameMessage('Артель просит проверить старый мост после первого обоза', 'The crew asks you to check the old bridge after the first caravan'),
  },
  'carry-tools': {
    objective: gameMessage('Доставьте инструменты через Тропу', 'Carry tools across the Trail'),
    detail: gameMessage('Пройдите Тропу от одного выхода до другого', 'Cross the Trail from one exit to the other'),
  },
  'buy-iron': {
    objective: gameMessage('Заключите сделку с торговцем', 'Make a deal with the trader'),
    detail: gameMessage('Любой честный обмен поддержит дорожные поставки', 'Any completed trade will support the road supply line'),
  },
  'buy-provisions': {
    objective: gameMessage('Проведите ещё одну сделку с торговцем', 'Make another deal with the trader'),
    detail: gameMessage('Артели нужны регулярные, а не разовые поставки', 'The crew needs regular supplies, not a one-off delivery'),
  },
  'patrol-road': {
    objective: gameMessage('Пройдите Тропу дозором', 'Patrol the Trail end to end'),
    detail: gameMessage('Доберитесь до дальнего выхода', 'Reach the far exit'),
  },
  'clear-foxes': {
    objective: gameMessage('Поймайте лису на Тропе', 'Catch a fox on the Trail'),
    detail: gameMessage('Вернитесь из вылазки хотя бы с одной лисой', 'Return from the raid with at least one fox'),
  },
  'check-toll': {
    objective: gameMessage('Проверьте дорожный сбор у торговца', 'Check the road toll with the trader'),
    detail: gameMessage('Подойдите к прилавку в замковом дворе', 'Approach the stall in the castle courtyard'),
  },
  'escort-cart': {
    objective: gameMessage('Проведите телегу через Тропу', 'Escort a cart across the Trail'),
    detail: gameMessage('Пройдите Тропу от одного выхода до другого', 'Cross the Trail from one exit to the other'),
  },
} as const satisfies Readonly<Record<RoadMissionId, {
  readonly objective: ReturnType<typeof gameMessage>;
  readonly detail: ReturnType<typeof gameMessage>;
}>>;
