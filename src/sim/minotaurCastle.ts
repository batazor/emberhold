import { mulberry32, randInt } from '../core/rng';
import type { CampState } from './camp';
import { earnCoins } from './camp';
import { CASTLE_CELL } from './castle';
import { generateCastleSite, spotAt, type CastleSite } from './castleSite';
import { enemyStats } from './enemies';
import { idx } from './grid';
import { canAfford, spend, type ResourceKind, type Resources } from './resources';
import type { Cell, Container, Enemy } from './types';

export type MinotaurQuestResource = Extract<ResourceKind, 'stone' | 'wood' | 'iron'>;

export interface MinotaurQuest {
  readonly id: string;
  readonly title: string;
  readonly kind: MinotaurQuestResource;
  readonly amount: number;
  readonly reward: number;
  readonly reputation: number;
  completed: boolean;
}

export type MinotaurTradeReward = 'coins' | 'arrows' | 'crystal';

export interface MinotaurTrade {
  readonly id: string;
  readonly name: string;
  readonly costKind: MinotaurQuestResource;
  readonly costAmount: number;
  readonly rewardKind: MinotaurTradeReward;
  readonly rewardAmount: number;
  readonly reputation: number;
}

export type MinotaurRelicId = 'golden-horn' | 'golem-heart' | 'labyrinth-signet';
export interface MinotaurRelic {
  readonly id: MinotaurRelicId;
  readonly name: string;
  readonly effect: string;
}

export interface MinotaurCastleSite extends CastleSite {
  readonly minotaur: Enemy | null;
  readonly guards: readonly Enemy[];
  readonly goldenChest: Container;
}

/** Малые сделки всегда заметно дешевле единственного золотого сундука. */
export const MINOTAUR_TRADES: readonly MinotaurTrade[] = [
  { id: 'stone-coins', name: 'Кошель монет', costKind: 'stone', costAmount: 6, rewardKind: 'coins', rewardAmount: 7, reputation: 0 },
  { id: 'wood-coins', name: 'Тяжёлый кошель', costKind: 'wood', costAmount: 5, rewardKind: 'coins', rewardAmount: 10, reputation: 0 },
  { id: 'iron-arrows', name: 'Пачка стрел', costKind: 'iron', costAmount: 2, rewardKind: 'arrows', rewardAmount: 5, reputation: 2 },
  { id: 'stone-crystal', name: 'Кристальная крошка', costKind: 'stone', costAmount: 12, rewardKind: 'crystal', rewardAmount: 1, reputation: 4 },
  { id: 'iron-crystal', name: 'Цельный кристалл', costKind: 'iron', costAmount: 5, rewardKind: 'crystal', rewardAmount: 2, reputation: 7 },
];

export const MINOTAUR_RELICS: readonly MinotaurRelic[] = [
  { id: 'golden-horn', name: 'Золотой рог', effect: 'заказы приносят на 20% больше монет' },
  { id: 'golem-heart', name: 'Сердце голема', effect: 'торговые награды увеличены на 1' },
  { id: 'labyrinth-signet', name: 'Печать лабиринта', effect: 'товары открываются на 1 репутацию раньше' },
];

const QUESTS: readonly Omit<MinotaurQuest, 'completed'>[] = [
  { id: 'wall-stone', title: 'Камень для внутренней стены', kind: 'stone', amount: 12, reward: 24, reputation: 1 },
  { id: 'gate-timber', title: 'Брус для ворот', kind: 'wood', amount: 9, reward: 20, reputation: 1 },
  { id: 'golem-clamps', title: 'Железо для оков голема', kind: 'iron', amount: 5, reward: 26, reputation: 2 },
  { id: 'yard-paving', title: 'Плиты для двора', kind: 'stone', amount: 18, reward: 38, reputation: 2 },
  { id: 'throne-braces', title: 'Скобы для трона', kind: 'iron', amount: 8, reward: 46, reputation: 3 },
];

const RESOURCE_GENITIVE: Record<MinotaurQuestResource, string> = {
  stone: 'камня', wood: 'дерева', iron: 'железа',
};

export const minotaurResourceText = (kind: MinotaurQuestResource, amount: number): string =>
  `${amount} ед. ${RESOURCE_GENITIVE[kind]}`;

/** Заказ постоянен для конкретного замка и потому честно переживает возврат. */
export function minotaurQuestRotation(seed: number, cycle = 0): readonly MinotaurQuest[] {
  const rng = mulberry32(seed ^ 0x6d696e6f ^ Math.imul(cycle + 1, 0x9e3779b9));
  const pool = [...QUESTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 3).map((quest) => ({ ...quest, completed: false }));
}

export function minotaurQuestFor(seed: number, cycle = 0): MinotaurQuest {
  return minotaurQuestRotation(seed, cycle)[0]!;
}

export function acceptMinotaurQuest(camp: CampState, seed: number, id?: string): MinotaurQuest {
  const key = String(seed >>> 0);
  const quests = (camp.minotaurQuests ??= {});
  const existing = quests[key];
  if (existing !== undefined && !existing.completed) return existing as MinotaurQuest;
  const cycle = camp.minotaurQuestCycle ?? 0;
  const rotation = minotaurQuestRotation(seed, cycle);
  const selected = rotation.find((quest) => quest.id === id) ?? rotation[0]!;
  quests[key] = { ...selected };
  return quests[key] as MinotaurQuest;
}

export function completeMinotaurQuest(camp: CampState, seed: number): boolean {
  const quest = camp.minotaurQuests?.[String(seed >>> 0)];
  if (quest === undefined || quest.completed) return false;
  const cost: Partial<Resources> = { [quest.kind]: quest.amount };
  if (!canAfford(camp.resources, cost)) return false;
  spend(camp.resources, cost);
  const bonus = Object.values(camp.minotaurRelics ?? {}).includes('golden-horn') ? 1.2 : 1;
  earnCoins(camp, Math.round(quest.reward * bonus));
  quest.completed = true;
  camp.minotaurReputation = (camp.minotaurReputation ?? 0) + (quest.reputation ?? 1);
  camp.minotaurQuestCycle = (camp.minotaurQuestCycle ?? 0) + 1;
  return true;
}

export function makeMinotaurTrade(camp: CampState, id: string): MinotaurTrade | null {
  const offer = MINOTAUR_TRADES.find((trade) => trade.id === id);
  if (offer === undefined) return null;
  const signet = Object.values(camp.minotaurRelics ?? {}).includes('labyrinth-signet');
  if ((camp.minotaurReputation ?? 0) < Math.max(0, offer.reputation - (signet ? 1 : 0))) return null;
  const cost: Partial<Resources> = { [offer.costKind]: offer.costAmount };
  if (!canAfford(camp.resources, cost)) return null;
  spend(camp.resources, cost);
  const bonus = Object.values(camp.minotaurRelics ?? {}).includes('golem-heart') ? 1 : 0;
  const amount = offer.rewardAmount + bonus;
  if (offer.rewardKind === 'coins') earnCoins(camp, amount);
  else if (offer.rewardKind === 'arrows') camp.arrows += amount;
  else camp.resources.crystal += amount;
  return offer;
}

export const minotaurTradeRewardText = (trade: MinotaurTrade, bonus = 0): string => {
  const amount = trade.rewardAmount + bonus;
  if (trade.rewardKind === 'coins') return `${amount} монет`;
  if (trade.rewardKind === 'arrows') return `${amount} стрел`;
  return `${amount} ед. кристалла`;
};

export function relicFor(seed: number): MinotaurRelic {
  return MINOTAUR_RELICS[(seed >>> 0) % MINOTAUR_RELICS.length]!;
}

export function claimMinotaurRelic(camp: CampState, seed: number): MinotaurRelic {
  const key = String(seed >>> 0);
  const relics = (camp.minotaurRelics ??= {});
  const relic = relicFor(seed);
  relics[key] ??= relic.id;
  return MINOTAUR_RELICS.find((entry) => entry.id === relics[key]) ?? relic;
}

function centreOfYard(site: CastleSite): Cell {
  const cx = site.at.x + site.castle.width * CASTLE_CELL / 2;
  const cz = site.at.z + site.castle.depth * CASTLE_CELL / 2;
  let best: Cell | null = null;
  let distance = Infinity;
  for (const spot of site.castle.yard) {
    const base = spotAt(site, spot);
    const cell = { x: base.x + (CASTLE_CELL >> 1), z: base.z + (CASTLE_CELL >> 1) };
    if (site.loc.blocked[idx(site.loc.size, cell.x, cell.z)] !== 0) continue;
    const d = (cell.x - cx) ** 2 + (cell.z - cz) ** 2;
    if (d < distance) { best = cell; distance = d; }
  }
  return best ?? site.trader ?? site.gate;
}

function minotaurBy(site: CastleSite, chest: Cell): Cell {
  const cells: Cell[] = [
    { x: chest.x + 2, z: chest.z }, { x: chest.x - 2, z: chest.z },
    { x: chest.x, z: chest.z + 2 }, { x: chest.x, z: chest.z - 2 },
    { x: chest.x + 1, z: chest.z + 1 }, { x: chest.x - 1, z: chest.z - 1 },
  ];
  return cells.find((cell) =>
    cell.x > 0 && cell.z > 0 && cell.x < site.loc.size - 1 && cell.z < site.loc.size - 1
    && site.loc.blocked[idx(site.loc.size, cell.x, cell.z)] === 0,
  ) ?? site.gate;
}

function nearestFree(site: CastleSite, target: Cell, used: readonly Cell[]): Cell {
  let best: Cell | null = null;
  let distance = Infinity;
  for (let z = Math.max(1, target.z - 5); z <= Math.min(site.loc.size - 2, target.z + 5); z++) {
    for (let x = Math.max(1, target.x - 5); x <= Math.min(site.loc.size - 2, target.x + 5); x++) {
      if (site.loc.blocked[idx(site.loc.size, x, z)] !== 0) continue;
      if (used.some((cell) => cell.x === x && cell.z === z)) continue;
      const d = (x - target.x) ** 2 + (z - target.z) ** 2;
      if (d < distance) { best = { x, z }; distance = d; }
    }
  }
  return best ?? site.gate;
}

export function generateMinotaurCastle(seed: number, defeated: boolean, claimed: boolean): MinotaurCastleSite {
  const base = generateCastleSite(seed);
  const at = centreOfYard(base);
  const goldenChest: Container = {
    id: 1, x: at.x, z: at.z, amount: 8, kind: 'crystal', opened: claimed,
    look: 'золотой',
    ...(defeated ? {} : { lockedBy: ['minotaur', 'stone-golem'] as const }),
  };
  const pos = minotaurBy(base, at);
  const stats = enemyStats('minotaur', 1);
  const minotaur: Enemy | null = defeated ? null : {
    id: 1, kind: 'minotaur', level: 1,
    x: pos.x, z: pos.z, prevX: pos.x, prevZ: pos.z,
    hp: stats.hp, awake: false, peaceful: true, telegraph: 0, cooldown: 0,
  };
  const golemStats = enemyStats('stone-golem', 1);
  const guardCells = defeated ? [] : [
    nearestFree(base, { x: at.x - 3, z: at.z + 1 }, [at, pos]),
    nearestFree(base, { x: at.x + 3, z: at.z + 1 }, [at, pos]),
  ];
  // Если первый голем занял ближайшую клетку второго, второй выбирается заново.
  if (guardCells.length === 2 && guardCells[0]!.x === guardCells[1]!.x && guardCells[0]!.z === guardCells[1]!.z) {
    guardCells[1] = nearestFree(base, { x: at.x + 3, z: at.z - 1 }, [at, pos, guardCells[0]!]);
  }
  const guards: Enemy[] = guardCells.map((cell, i) => ({
    id: i + 2, kind: 'stone-golem', level: 1,
    x: cell.x, z: cell.z, prevX: cell.x, prevZ: cell.z,
    hp: golemStats.hp, awake: false, peaceful: true, telegraph: 0, cooldown: 0,
  }));
  const loc = {
    ...base.loc,
    containers: [goldenChest],
    enemies: minotaur === null ? [] : [minotaur, ...guards],
  };
  return { ...base, loc, minotaur, guards, goldenChest };
}
