import type { BuildingId } from '../sim/camp';
import type { ConsumableId } from '../sim/consumables';
import type { EventId } from '../sim/events';
import type { GearSlot, Offhand } from '../sim/gear';
import type { HeroClassId, SkillId } from '../sim/heroes';
import type { ResourceKind } from '../sim/resources';
import type { Tier } from '../sim/types';
import type { EnemyKind } from '../sim/types';
import { gameMessage } from './game';
import type { GameMessage } from './gameMessages';

export const resourceMessage: Record<ResourceKind, GameMessage> = {
  stone: gameMessage('Камень', 'Stone'),
  wood: gameMessage('Дерево', 'Wood'),
  iron: gameMessage('Железо', 'Iron'),
  crystal: gameMessage('Кристалл', 'Crystal'),
  food: gameMessage('Пища', 'Food'),
  meat: gameMessage('Мясо', 'Meat'),
  pelt: gameMessage('Лисья шкура', 'Fox pelt'),
};

export const buildingMessage: Record<BuildingId, GameMessage> = {
  hq: gameMessage('Жильё', 'Housing'),
  kitchen: gameMessage('Кухня', 'Kitchen'),
  storage: gameMessage('Склад', 'Storehouse'),
  forge: gameMessage('Мастерская', 'Workshop'),
  infirmary: gameMessage('Лазарет', 'Infirmary'),
  yard: gameMessage('Плац', 'Training yard'),
};

export const gearMessage: Record<GearSlot, GameMessage> = {
  weapon: gameMessage('Кайло', 'Pickaxe'),
  armor: gameMessage('Стёганая куртка', 'Quilted jacket'),
  torch: gameMessage('Рудничный фонарь', 'Mining lantern'),
  bag: gameMessage('Заплечный короб', 'Backpack'),
  ring: gameMessage('Спокойная рука', 'Steady hand'),
};

export const offhandMessage: Record<Offhand, GameMessage> = {
  torch: gameMessage('Рудничный фонарь', 'Mining lantern'),
  shield: gameMessage('Щит', 'Shield'),
};

export const consumableMessage: Record<ConsumableId, {
  readonly name: GameMessage;
  readonly trigger: GameMessage;
  readonly effect: GameMessage;
}> = {
  bandage: {
    name: gameMessage('Повязка', 'Bandage'),
    trigger: gameMessage('осталась одна рана', 'one wound remains'),
    effect: gameMessage('залечивает одну рану', 'heals one wound'),
  },
  ration: {
    name: gameMessage('Дорожный паёк', 'Travel ration'),
    trigger: gameMessage('провиант дошёл до нуля', 'provisions reach zero'),
    effect: gameMessage('даёт 15 провианта', 'restores 15 provisions'),
  },
  smoke: {
    name: gameMessage('Дымовая шашка', 'Smoke bomb'),
    trigger: gameMessage('проснулись двое и больше', 'two or more enemies wake up'),
    effect: gameMessage('разрывает контакт', 'breaks contact'),
  },
};

export const tierMessage: Record<Tier, GameMessage> = {
  0: gameMessage('Подступы', 'Outskirts'),
  1: gameMessage('Ярус 1', 'Tier 1'),
  2: gameMessage('Ярус 2', 'Tier 2'),
  3: gameMessage('Дно', 'Depths'),
};

export const skillMessage: Record<SkillId, GameMessage> = {
  trail: gameMessage('Тропа', 'Trail'),
  haul: gameMessage('Заплечье', 'Haul'),
  cache: gameMessage('Схрон', 'Cache'),
};

export const heroClassMessage: Record<HeroClassId, GameMessage> = {
  archer: gameMessage('Лучник', 'Archer'),
  knight: gameMessage('Рыцарь', 'Knight'),
  rogue: gameMessage('Бандит', 'Rogue'),
};

export const enemyMessage: Record<EnemyKind, GameMessage> = {
  fox: gameMessage('Лиса', 'Fox'),
  minion: gameMessage('Скелет', 'Skeleton'),
  warrior: gameMessage('Скелет-воин', 'Skeleton warrior'),
  ghost: gameMessage('Привидение', 'Ghost'),
  guard: gameMessage('Стражник', 'Guard'),
  minotaur: gameMessage('Минотавр', 'Minotaur'),
  'stone-golem': gameMessage('Каменный голем', 'Stone golem'),
  mage: gameMessage('Скелет-маг', 'Skeleton mage'),
};

export const eventMessage: Record<EventId, { readonly name: GameMessage; readonly line: GameMessage }> = {
  storm: {
    name: gameMessage('Соляная буря', 'Salt storm'),
    line: gameMessage('Добыча ×1,5, риск +25%', 'Loot ×1.5; risk +25%'),
  },
  collapse: {
    name: gameMessage('Обвал', 'Collapse'),
    line: gameMessage('Шаги требуют на треть больше провианта, обзор сокращён', 'Steps consume 33% more provisions; vision is reduced'),
  },
  quiet: {
    name: gameMessage('Тихая ночь', 'Quiet night'),
    line: gameMessage('Меньше противников, но и меньше добычи', 'Fewer enemies, but less loot as well'),
  },
  vein: {
    name: gameMessage('Жила', 'Rich vein'),
    line: gameMessage('Больше добычи, но и больше противников', 'More loot, but more enemies as well'),
  },
};
