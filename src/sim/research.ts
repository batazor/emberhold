import type { CampState } from './camp';
import type { ResourceKind, Resources } from './resources';
import { canAfford, spend } from './resources';

/** Личное дерево лагеря. «Записи», а не «знания»: Знание уже характеристика героя. */
export type ResearchBranch = 'household' | 'craft' | 'scouting';

export type ResearchId =
  | 'crop-rotation'
  | 'road-provisions'
  | 'cartography'
  | 'work-orders'
  | 'leather-packs'
  | 'careful-opening'
  | 'shelving'
  | 'herbalism'
  | 'signal-network';

export interface ResearchJob {
  readonly id: ResearchId;
  readonly toLevel: number;
  readonly startedAt: number;
  readonly endsAt: number;
}

export interface ResearchState {
  notes: number;
  levels: Record<ResearchId, number>;
  job: ResearchJob | null;
}

export interface ResearchDef {
  readonly id: ResearchId;
  readonly branch: ResearchBranch;
  readonly row: 1 | 2 | 3;
  readonly name: string;
  readonly effects: readonly [string, string, string];
}

export const RESEARCH_ORDER: readonly ResearchId[] = [
  'crop-rotation', 'road-provisions', 'cartography',
  'work-orders', 'leather-packs', 'careful-opening',
  'shelving', 'herbalism', 'signal-network',
];

export const BRANCH_NAME: Record<ResearchBranch, string> = {
  household: 'Хозяйство',
  craft: 'Ремесло',
  scouting: 'Разведка',
};

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  'crop-rotation': {
    id: 'crop-rotation', branch: 'household', row: 1, name: 'Севооборот',
    effects: ['Открывается третья грядка', 'Открывается четвёртая грядка', 'Открываются все шесть грядок'],
  },
  'road-provisions': {
    id: 'road-provisions', branch: 'craft', row: 1, name: 'Дорожные припасы',
    effects: ['Провиант в вылазке +3', 'Провиант в вылазке +6', 'Провиант в вылазке +9'],
  },
  cartography: {
    id: 'cartography', branch: 'scouting', row: 1, name: 'Картография',
    effects: ['Обзор в вылазке +0,5', 'Обзор в вылазке +1', 'Обзор в вылазке +1,5'],
  },
  'work-orders': {
    id: 'work-orders', branch: 'household', row: 2, name: 'Рабочие наряды',
    effects: ['Потолок работы жильца +1', 'Потолок работы жильца +2', 'Потолок работы жильца +3'],
  },
  'leather-packs': {
    id: 'leather-packs', branch: 'craft', row: 2, name: 'Кожаные вьюки',
    effects: ['Рюкзак в вылазке +2', 'Рюкзак в вылазке +4', 'Рюкзак в вылазке +6'],
  },
  'careful-opening': {
    id: 'careful-opening', branch: 'scouting', row: 2, name: 'Осторожное вскрытие',
    effects: ['Контейнер стоит на 1 провиант меньше', 'Контейнер стоит на 2 провианта меньше', 'Контейнер стоит на 3 провианта меньше'],
  },
  shelving: {
    id: 'shelving', branch: 'household', row: 3, name: 'Полки и опись',
    effects: ['Кладовая +10', 'Кладовая +20', 'Кладовая +30'],
  },
  herbalism: {
    id: 'herbalism', branch: 'craft', row: 3, name: 'Травничество',
    effects: ['Лечение как при Лазарете на уровень выше', 'Лечение как на два уровня выше', 'Лечение как на три уровня выше'],
  },
  'signal-network': {
    id: 'signal-network', branch: 'scouting', row: 3, name: 'Сигнальная сеть',
    effects: ['Разведка Башни +0,5', 'Разведка Башни +1', 'Разведка Башни +1,5'],
  },
};

const EMPTY_LEVELS = (): Record<ResearchId, number> => Object.fromEntries(
  RESEARCH_ORDER.map((id) => [id, 0]),
) as Record<ResearchId, number>;

export const createResearch = (): ResearchState => ({ notes: 0, levels: EMPTY_LEVELS(), job: null });

export const researchLevel = (camp: Pick<CampState, 'research'>, id: ResearchId): number =>
  Math.max(0, Math.min(3, Math.floor(camp.research?.levels[id] ?? 0)));

export const totalResearchLevels = (camp: Pick<CampState, 'research'>): number =>
  RESEARCH_ORDER.reduce((sum, id) => sum + researchLevel(camp, id), 0);

const previousInBranch = (def: ResearchDef): ResearchId | null => {
  if (def.row === 1) return null;
  return RESEARCH_ORDER.find((id) => {
    const other = RESEARCH[id];
    return other.branch === def.branch && other.row === def.row - 1;
  }) ?? null;
};

export function researchCost(id: ResearchId, toLevel: number): { notes: number; resources: Partial<Resources>; seconds: number } {
  const def = RESEARCH[id];
  const rank = Math.max(1, Math.min(3, Math.floor(toLevel)));
  const notes = (def.row * 2 + rank - 1) * rank;
  const base = def.row * (rank + 1);
  const kind: ResourceKind = def.branch === 'household'
    ? (def.row === 1 ? 'wood' : 'stone')
    : def.branch === 'craft'
      ? (def.row === 3 ? 'crystal' : 'iron')
      : (def.row === 3 ? 'iron' : 'stone');
  const seconds = [0, 3 * 60, 12 * 60, 45 * 60][def.row]! * rank;
  return { notes, resources: { [kind]: base * 2 }, seconds };
}

export type ResearchBlock = 'ok' | 'archive' | 'row' | 'previous' | 'levels' | 'busy' | 'max' | 'notes' | 'resources';

export function researchBlock(camp: CampState, id: ResearchId): ResearchBlock {
  if (camp.levels.archive <= 0) return 'archive';
  const def = RESEARCH[id];
  if (camp.levels.archive < def.row) return 'row';
  if (camp.research.job !== null) return 'busy';
  const level = researchLevel(camp, id);
  if (level >= 3) return 'max';
  const previous = previousInBranch(def);
  if (previous !== null && researchLevel(camp, previous) <= 0) return 'previous';
  const required = def.row === 1 ? 0 : def.row === 2 ? 3 : 9;
  if (totalResearchLevels(camp) < required) return 'levels';
  const cost = researchCost(id, level + 1);
  if (camp.research.notes < cost.notes) return 'notes';
  if (!canAfford(camp.resources, cost.resources)) return 'resources';
  return 'ok';
}

export function startResearch(camp: CampState, id: ResearchId, now: number): boolean {
  if (researchBlock(camp, id) !== 'ok' || !Number.isFinite(now)) return false;
  const toLevel = researchLevel(camp, id) + 1;
  const cost = researchCost(id, toLevel);
  camp.research.notes -= cost.notes;
  spend(camp.resources, cost.resources);
  camp.research.job = { id, toLevel, startedAt: now, endsAt: now + cost.seconds };
  return true;
}

/** Возвращает завершённый узел; эффекты читаются из уровней без отдельных флагов. */
export function completeResearchIfDue(camp: CampState, now: number): ResearchId | null {
  const job = camp.research.job;
  if (job === null || now < job.endsAt) return null;
  camp.research.levels[job.id] = Math.max(researchLevel(camp, job.id), job.toLevel);
  camp.research.job = null;
  if (job.id === 'crop-rotation' && camp.farm !== undefined) {
    camp.farm.activePlots = Math.max(camp.farm.activePlots, researchedFarmPlots(camp));
  }
  return job.id;
}

export function grantResearchNotes(camp: CampState, amount = 1): number {
  if (camp.levels.archive <= 0 || amount <= 0) return 0;
  const granted = Math.max(0, Math.floor(amount));
  camp.research.notes += granted;
  return granted;
}

export const researchedFarmPlots = (camp: Pick<CampState, 'research'>): number => {
  const level = researchLevel(camp, 'crop-rotation');
  return level === 3 ? 6 : 2 + level;
};

export const researchFoodBonus = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'road-provisions') * 3;

export const researchBagBonus = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'leather-packs') * 2;

export const researchScoutingBonus = (camp: Pick<CampState, 'research'>): number =>
  (researchLevel(camp, 'cartography') + researchLevel(camp, 'signal-network')) / 2;

export const researchContainerDiscount = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'careful-opening');

export const researchWorkCapBonus = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'work-orders');

export const researchStoreBonus = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'shelving') * 10;

export const researchInfirmaryBonus = (camp: Pick<CampState, 'research'>): number =>
  researchLevel(camp, 'herbalism');
