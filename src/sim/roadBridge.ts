import type { CampState } from './camp';
import type { ResourceKind } from './resources';
import type { SupplyRoute } from './roadStory';
import type { NodeKind } from './world';

/** Вторая дорожная глава: обычная хозяйственная проблема у старого моста. */
export type BridgeStoryStep = 'maintenance' | 'shortfall' | 'find-crew' | 'done';

export type RoadMissionAction = 'trade' | 'cross-trail' | 'hunt-trail' | 'visit-trader';

export type RoadMissionId =
  | 'inspect-bridge'
  | 'carry-tools'
  | 'buy-iron'
  | 'buy-provisions'
  | 'patrol-road'
  | 'clear-foxes'
  | 'check-toll'
  | 'escort-cart';

export interface BridgeStory {
  step: BridgeStoryStep;
  /** Сколько дорожных поручений выполнено за всё время. */
  completed: number;
  /** Игровые сутки последнего поручения: в одни сутки выполняется только одно. */
  lastDay: number;
  /** Как лагерь устроил постоянную работу моста. */
  outcome?: SupplyRoute;
}

export interface RoadMission {
  readonly id: RoadMissionId;
  readonly action: RoadMissionAction;
  readonly target: NodeKind;
  readonly reward: { readonly kind: ResourceKind | 'coins'; readonly amount: number };
}

export const BRIDGE_STORY_STEPS: readonly BridgeStoryStep[] = [
  'maintenance', 'shortfall', 'find-crew', 'done',
];

export const ROAD_MISSION_ACTIONS: readonly RoadMissionAction[] = [
  'trade', 'cross-trail', 'hunt-trail', 'visit-trader',
];

const MISSION: Readonly<Record<RoadMissionId, RoadMission>> = {
  'inspect-bridge': { id: 'inspect-bridge', action: 'cross-trail', target: 'тропа', reward: { kind: 'iron', amount: 2 } },
  'carry-tools': { id: 'carry-tools', action: 'cross-trail', target: 'тропа', reward: { kind: 'iron', amount: 2 } },
  'buy-iron': { id: 'buy-iron', action: 'trade', target: 'замок', reward: { kind: 'coins', amount: 2 } },
  'buy-provisions': { id: 'buy-provisions', action: 'trade', target: 'замок', reward: { kind: 'coins', amount: 2 } },
  'patrol-road': { id: 'patrol-road', action: 'cross-trail', target: 'тропа', reward: { kind: 'iron', amount: 3 } },
  'clear-foxes': { id: 'clear-foxes', action: 'hunt-trail', target: 'тропа', reward: { kind: 'iron', amount: 3 } },
  'check-toll': { id: 'check-toll', action: 'visit-trader', target: 'замок', reward: { kind: 'coins', amount: 2 } },
  'escort-cart': { id: 'escort-cart', action: 'cross-trail', target: 'тропа', reward: { kind: 'wood', amount: 3 } },
};

const OPENING: Readonly<Record<SupplyRoute, readonly [RoadMissionId, RoadMissionId]>> = {
  work: ['inspect-bridge', 'carry-tools'],
  trade: ['buy-iron', 'buy-provisions'],
  force: ['patrol-road', 'clear-foxes'],
};

const DAILY: Readonly<Record<SupplyRoute, readonly RoadMissionId[]>> = {
  work: ['escort-cart', 'check-toll', 'clear-foxes'],
  trade: ['buy-iron', 'check-toll', 'escort-cart'],
  force: ['patrol-road', 'clear-foxes', 'check-toll'],
};

/** Глава начинается только после честно закрытого «Пропавшего обоза». */
export function startBridgeStory(camp: CampState): boolean {
  if (camp.bridgeStory !== undefined || camp.roadStory?.step !== 'done' || camp.roadStory.route === undefined) {
    return false;
  }
  camp.bridgeStory = { step: 'maintenance', completed: 0, lastDay: -1 };
  return true;
}

/** Текущее поручение — функция состояния и суток, без случайности и таймера. */
export function activeRoadMission(
  camp: Pick<CampState, 'roadStory' | 'bridgeStory'>,
  day: number,
): RoadMission | null {
  const story = camp.bridgeStory;
  if (story === undefined || story.lastDay === day) return null;
  if (story.step === 'maintenance') {
    const route = camp.roadStory?.route;
    if (route === undefined) return null;
    const id = OPENING[route][Math.min(1, story.completed)];
    return MISSION[id];
  }
  if (story.step !== 'done' || story.outcome === undefined) return null;
  const pool = DAILY[story.outcome];
  const id = pool[((day % pool.length) + pool.length) % pool.length];
  return MISSION[id] ?? null;
}

/** Засчитывает только действие активного поручения и не больше одного в сутки. */
export function completeRoadMission(
  camp: CampState,
  day: number,
  action: RoadMissionAction,
): RoadMission | null {
  const mission = activeRoadMission(camp, day);
  const story = camp.bridgeStory;
  if (mission === null || story === undefined || mission.action !== action) return null;
  story.completed += 1;
  story.lastDay = day;
  if (story.step === 'maintenance' && story.completed >= 2) story.step = 'shortfall';
  return mission;
}

/** После первых двух рейсов торговец признаёт недостачу первого обоза. */
export function reportBridgeShortfall(camp: CampState): boolean {
  const story = camp.bridgeStory;
  if (story?.step !== 'shortfall') return false;
  story.step = 'find-crew';
  return true;
}

export type BridgeDecisionBlock = 'ok' | 'wood' | 'coins';

export function bridgeDecisionBlock(camp: CampState, route: SupplyRoute): BridgeDecisionBlock {
  if (route === 'work' && camp.resources.wood < 10) return 'wood';
  if (route === 'trade' && (camp.coins ?? 0) < 5) return 'coins';
  return 'ok';
}

/** Решение не «правильное»: игрок выбирает, кто дальше содержит мост. */
export function settleBridge(camp: CampState, route: SupplyRoute, day: number): boolean {
  const story = camp.bridgeStory;
  if (story?.step !== 'find-crew' || bridgeDecisionBlock(camp, route) !== 'ok') return false;
  if (route === 'work') camp.resources.wood -= 10;
  if (route === 'trade') camp.coins = (camp.coins ?? 0) - 5;
  camp.bridgeStory = {
    step: 'done',
    completed: story.completed,
    lastDay: day,
    outcome: route,
  };
  return true;
}
