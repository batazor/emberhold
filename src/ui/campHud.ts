import {
  BUILDINGS,
  BUILDING_ORDER,
  BUILD_COST,
  buildingCost,
  buildingMaxLevel,
  buildingSeconds,
  campQuiverCapacity,
  gearBlock,
  itemCap,
  coinsOf,
  speedupCost,
  upgradeBlock,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { ARROW_PACK, ARROW_PACK_COST, canBuyArrows } from '../sim/camp';
import {
  CHEST_BONUS,
  CHEST_COST,
  chestBlock,
  storeCapacity,
  storeUsed,
} from '../sim/chests';
import { GEAR, GEAR_COST, GEAR_ORDER, OFFHAND, OFFHAND_ORDER, gearItemLine, gearLine } from '../sim/gear';
import type { GearSlot, Offhand } from '../sim/gear';
import {
  buyBlock,
  CONSUMABLES,
  CONSUMABLE_ORDER,
  CONSUMABLE_SLOTS,
} from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { ONB_HINT } from '../sim/onboarding';
import { dayAt, firstRaidNode } from '../sim/world';
import type { Visit } from '../sim/world';
import type { LiveCamp } from '../sim/standing';
import type { OnbStep } from '../sim/onboarding';
import { RESOURCE_NAME } from '../sim/resources';
import { TENT_COST, homeless, homelessFolk, residentLook, tentBlock } from '../sim/residents';
import { clanTaskOpen } from '../sim/clan';
import { avatarSvg } from './avatar';
import { DailyPanel } from './dailyPanel';
import type { GiftPic } from './dailyPanel';
import type { ResourceKind, Resources } from '../sim/resources';
import { Banner } from './banner';
import type { Roster } from '../sim/heroes';
import { WorldMap } from './worldMap';
import { resourceIcon } from './resourceIcons';
import type { BuildCategory } from './buildPanel';
import { wallProgress, type WallTool } from '../sim/campWalls';
import {
  clearGameAttribute,
  clearGameText,
  gameDuration,
  gameMessage,
  gameText,
  setGameAttribute,
  setGameText,
  type GameMessageValues,
} from '../i18n/game';
import { buildingMessage, consumableMessage, gearMessage, offhandMessage, resourceMessage } from '../i18n/gameData';
import type { GameMessage } from '../i18n/gameMessages';

/**
 * Лагерь: сцена первая, карточка по тапу.
 *
 * Прежняя версия держала на экране все списки разом — постройки, снаряжение,
 * расходники, отряд и ярусы, — и на телефоне (360×780 у Galaxy, 393×852
 * у iPhone) они закрывали лагерь целиком: игрок видел набор карточек, а не
 * своё поселение. Это противоречит §2 — лагерь это то, ради чего
 * возвращаются, — и той самой раскадровке онбординга, где кадр 9 показывает
 * поляну и ровно одно возможное действие.
 *
 * Отсюда правило этой панели: **постоянно на экране только ресурсы и нижняя
 * строка**. Всё остальное живёт в одном листе, который выезжает снизу по
 * тапу — по зданию в сцене или по кнопке в строке — и уходит по тапу мимо.
 * Одновременно открыт ровно один раздел.
 */
export interface CampCallbacks {
  onUpgrade(id: BuildingId): void;
  onBuyConsumable(id: ConsumableId): void;
  onRefundConsumable(at: number): void;
  onSpeedup(): void;
  /** §4 — идут в место на карте, а не в «ярус»: ярус у места один из трёх чисел. */
  onRaid(node: number): void;
  /** §26 — отправить отряд в место без игрока. */
  onSortie(node: number): void;
  /** Открыть доступный для осмотра лагерь живого соседа. */
  onVisitCamp(id: string): void;
  /** Открыть оформление собственного лагеря или общего лагеря клана. */
  onAppearance(owner: 'player' | 'clan'): void;
  /** §14 — ковка и улучшение это одно действие: слот один, предмет один. */
  onCraft(slot: GearSlot): void;
  /** §20.4 — перестановка: карточка вооружает режим, дальше тап по клетке. */
  onMove(id: BuildingId): void;
  /** Открыть общий каталог стройки и погасить внешний режим размещения. */
  onConstruction(): void;
  /** §6.1.6 — стройка стен: карточка открывает панель, дальше жест по земле. */
  onWalls(category: BuildCategory): void;
  /** §14.3 — пачка стрел за железо. Единственный способ наполнить колчан. */
  onBuyArrows(): void;
  /** §14.2 — что в левой руке: фонарь или щит. Бесплатно и мгновенно. */
  onOffhand(offhand: Offhand): void;
  /** Поставить палатку жильцу (`sim/residents.ts`). */
  onTent(): void;
  /**
   * Пойти и добыть то, чего не хватает: дерево — топором по лесу поляны
   * (§13.3), пищу — приказом добытчику (§13.7).
   *
   * Заведено потому, что задание без выхода — не задание. Строка «Не хватает
   * дерева» с погасшей кнопкой сообщала беду и не предлагала ничего: игрок
   * читал отказ и оставался с ним один. Теперь причина остаётся строкой,
   * а кнопка ведёт к тому, чем причина лечится.
   */
  onGather(kind: 'wood' | 'food'): void;
  /** §30 — завести свой клан: строка задания открывает окно с именем. */
  onClan(): void;
  /** §29 — забрать сегодняшний подарок. Считает и зачисляет лагерь, а не
   *  панель: подарок проходит через кладовую наравне с добычей. */
  onClaimGift(): void;
  /** Поставить сундук-хранилище (`sim/chests.ts`): карточка вооружает
   *  режим, дальше тап по клетке — тем же жестом, что палатка. */
  onChest(): void;
  /** Открыть общий диспетчер жителей, их смен и поручений. */
  onResidents(): void;
  /** Архив открывает отдельный полноэкранный слой личных исследований. */
  onResearch(): void;
  /**
   * Лист открылся или закрылся. Панель зовёт это на переходе состояния,
   * а не на каждом `openSheet`: смена раздела внутри открытого листа —
   * не событие для тех, кто снаружи. Нужен он ровно одному слушателю —
   * вееру у большого пальца (`features/fan`): тот рисуется поверх всего
   * слоем и иначе стоит на карточке места, споря с ней за палец и за глаз.
   */
  onSheet(open: boolean): void;
  /**
   * Значок вещи §14 как `data:`-URL. Приходит снаружи, а не берётся здесь:
   * рисует его запечённая геометрия из `render/gearIcon.ts`, а панелям слой
   * рендера не виден (`scripts/arch.ts`). Пустая строка — значка нет,
   * и строка списка остаётся такой, какой была.
   */
  gearIcon(kind: GearSlot | 'shield', level: number): string;
  /** §29.4 — картинка вещи на карточке дня. Приходит оттуда же, откуда
   *  значок снаряжения, и по той же причине: рендер панелям не виден. */
  giftIcon(name: GiftPic): string;
}

/** §13.7 — пища пятой и последней: она не добывается в вылазке, и место
 *  в полосе у неё за четырьмя, что приносит герой. */
const RESOURCE_ORDER: readonly ResourceKind[] = ['stone', 'wood', 'iron', 'crystal', 'food'];

/*
 * Карта региона открыта всегда, с первой же вылазки.
 *
 * Раньше она ждала второй вылазки, а до неё место назначалось само — «ровно
 * одно решение на экране». Держалось это на том, что игрок к моменту выхода
 * из раскадровки не видел ни одного меню; с прологом это перестало быть
 * правдой: пролог сдаёт игрока в лагерь, и в лагере он и так стоит перед
 * нижней строкой из трёх кнопок. Прятать за одной из них ещё один экран,
 * который откроется через две вылазки, — это не «одно решение», а отложенное
 * меню, и назначенное место было его ширмой.
 *
 * Кнопка называется «В мир» и ведёт в мир. Ставка §11.6 при этом объявляется
 * до входа как и прежде — её называет карточка места на самой карте.
 */

/** Что открыто в листе. null — лист закрыт, на экране только лагерь.
 *  'store' — кладовая (§13.6): открывается тапом по сундуку в сцене.
 *  'daily' — подарок за вход (§29): открывается тапом по значку над сценой. */
type SheetKind = BuildingId | 'buildings' | 'tiers' | 'shop' | 'store' | 'daily' | null;

/**
 * Куда летит подарок (§29.4): к числу ресурса, к счёту кладовой или
 * к «Припасам». Человека в списке нет — он приходит сам и ниоткуда
 * не прилетает.
 */
export type FlyTarget = ResourceKind | 'store' | 'quiver';

const isBuilding = (kind: SheetKind): kind is BuildingId =>
  kind !== null && BUILDING_ORDER.includes(kind as BuildingId);

const BUILDING_GLYPH: Record<BuildingId, string> = {
  hq: '<path d="M3 12 12 4l9 8v9h-7v-6h-4v6H3z"/>',
  kitchen: '<path d="M4 10h16v11H4zM7 4h3v6H7zM14 2h3v8h-3zM8 14h8v3H8z"/>',
  storage: '<path d="M3 9 12 4l9 5v12H3zM7 12h10v9H7z"/>',
  forge: '<path d="M3 13h13v8H3zM6 8h7v5H6zM17 3h3v18h-3zM4 4h10v3H4z"/>',
  infirmary: '<path d="M3 8h18v13H3zM10 3h4v5h-4zM7 13h3v-3h4v3h3v4h-3v3h-4v-3H7z"/>',
  yard: '<path d="M4 18h16v3H4zM6 5h3v13H6zM15 3h3v15h-3zM3 8h9v3H3zM12 6h9v3h-9z"/>',
  archery: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
  barracks: '<path d="M3 10 12 4l9 6v11H3zM6 12h4v9H6zM14 12h4v9h-4zM8 7h8v3H8z"/>',
  watchtower: '<path fill-rule="evenodd" d="M5 3h3v3h3V3h3v3h3V3h3v18h-5v-6h-6v6H4V3zm5 6h4v3h-4z"/>',
  archive: '<path d="M4 3h14a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2zm3 4h10V5H7zm0 4h10V9H7zm0 4h7v-2H7z"/>',
};

type SupplyGlyph = ConsumableId | 'loadout' | 'rule' | 'quiver' | 'offhand';

const SUPPLY_GLYPH: Record<SupplyGlyph, string> = {
  ration: '<path d="M7 5h10l2 4-2 10H7L5 9zM8 9h8M9 13h6"/><path d="M10 5V3h4v2"/>',
  smoke: '<path d="M8 9h8l2 3-2 8H8l-2-8zM10 9V6h4v3"/><path d="M12 6c-2-2 2-2 0-4M15 7c3-2 0-3 2-5"/>',
  bandage: '<path d="M7 5h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6zm0 8h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6z"/><path d="M10 5v6m4 2v6"/>',
  loadout: '<path d="M7 5h10l2 5-2 10H7L5 10zM9 5V3h6v2"/><path d="M9 11h6M10 15h4"/>',
  rule: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  quiver: '<path d="M8 6h8l-1 15H9zM7 6h10"/><path d="M10 6 8 2m4 4V2m2 4 2-4"/>',
  offhand: '<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 7v9M8 11h8"/>',
};

const supplyGlyph = (kind: SupplyGlyph): string =>
  `<svg class="supply-icon" viewBox="0 0 24 24" aria-hidden="true">${SUPPLY_GLYPH[kind]}</svg>`;

const WALL_WORK_MESSAGE: Record<Exclude<WallTool, 'снос'>, GameMessage> = {
  'стена': gameMessage('Стена · строится', 'Wall · building'),
  'ограда': gameMessage('Ограда · строится', 'Fence · building'),
  'дорога': gameMessage('Дорога · строится', 'Road · building'),
  'фонарь': gameMessage('Фонарь · ставится', 'Lamp · placing'),
  'башня': gameMessage('Башня · строится', 'Tower · building'),
  'ворота': gameMessage('Ворота · строятся', 'Gate · building'),
  'лестница': gameMessage('Лестница · строится', 'Stairs · building'),
};

interface CostChip {
  readonly root: HTMLElement;
  readonly have: HTMLElement;
  readonly need: HTMLElement;
}

interface SupplyCard {
  readonly button: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly trigger: HTMLElement;
  readonly effect: HTMLElement;
  readonly price: HTMLElement;
  readonly action: HTMLElement;
}

interface BuildingCard {
  readonly button: HTMLButtonElement;
  readonly level: HTMLElement;
  readonly effect: HTMLElement;
  readonly costs: Map<ResourceKind, CostChip>;
}

const TENT_REASON_MESSAGE = {
  nobody: gameMessage('Все под крышей', 'Everyone has shelter'),
  resources: gameMessage('Не хватает дерева', 'Not enough wood'),
  area: gameMessage('На площадке нет места', 'No room on the site'),
} as const;

/**
 * Строки задания «добудь то, чего не хватает» (§13.3, §13.7). Лежат рядом
 * с причинами палатки и сундука по той же причине, по какой те лежат здесь:
 * слова панели живут в панели, а не в симуляции.
 */
const GATHER_WOOD_MESSAGE = gameMessage('Собрать дерево', 'Gather wood');
const GATHER_FOOD_MESSAGE = gameMessage('Собрать пищу', 'Gather food');
const SEND_FOR_FOOD_MESSAGE = gameMessage('Добывать пищу', 'Send for food');
const FOOD_TASK_MESSAGE = gameMessage(
  'В кладовой нет пищи: голодные не работают',
  'The pantry is out of food: the hungry do not work',
);
const FOOD_TASK_BUSY_MESSAGE = gameMessage(
  'В кладовой нет пищи · добытчик уже в поле',
  'The pantry is out of food · the gatherer is already out',
);

const CHEST_REASON_MESSAGE = {
  resources: gameMessage('Не хватает дерева', 'Not enough wood'),
  area: gameMessage('На площадке нет места', 'No room on the site'),
} as const;

const UPGRADE_REASON_MESSAGE = {
  max: gameMessage('Максимальный уровень', 'Maximum level'),
  locked: gameMessage('Нужно Жильё ур. 2', 'Requires Housing lvl 2'),
  'hq-cap': gameMessage('Сначала улучшите Жильё', 'Upgrade Housing first'),
  'slot-busy': gameMessage('Уже идёт другая стройка', 'Another construction job is underway'),
  resources: gameMessage('Не хватает ресурсов', 'Not enough resources'),
} as const;

const GEAR_REASON_MESSAGE = {
  'no-forge': gameMessage('Нужна Мастерская', 'Requires a Workshop'),
  max: gameMessage('Улучшено до предела', 'Fully upgraded'),
  'forge-cap': gameMessage('Сначала улучшите Мастерскую', 'Upgrade the Workshop first'),
  resources: gameMessage('Не хватает железа', 'Not enough iron'),
} as const;

interface Row {
  readonly box: HTMLElement;
  readonly level: HTMLElement;
  readonly effect: HTMLElement;
  readonly status: HTMLElement;
  readonly barWrap: HTMLElement;
  readonly bar: HTMLElement;
  readonly button: HTMLButtonElement;
  /** Значок вещи §14. Есть только у строк Мастерской: у зданий своя модель
   *  стоит в сцене, и второй её портрет в списке не нужен. */
  readonly pic?: HTMLImageElement;
}

interface BuildingRow extends Row {
  readonly next: HTMLElement;
  readonly costs: Map<ResourceKind, CostChip>;
  readonly actions: HTMLElement;
}

/**
 * Панель строится один раз и дальше обновляется на месте.
 *
 * Пересборка innerHTML каждый тик выглядит безобидно, но ломает ввод:
 * кнопка, заменённая между нажатием и отпусканием, не даёт события click,
 * и панель просто перестаёт нажиматься. Это стоило одного бага в этапе 3.
 * По той же причине лист не пересоздаёт разделы, а прячет лишние.
 */
export class CampHud {
  private readonly root: HTMLElement;
  private readonly resValues = new Map<ResourceKind, HTMLElement>();
  private readonly rows = new Map<BuildingId, BuildingRow>();
  private readonly buildingCards = new Map<BuildingId, BuildingCard>();
  private readonly gearRows = new Map<GearSlot, Row>();
  /** Лист кладовой (§13.6): полоса занятости и карточка сундука. */
  private storeLevel!: HTMLElement;
  private storeBarWrap!: HTMLElement;
  private storeBar!: HTMLElement;
  /** Счёт кладовой в полосе ресурсов: «занято/вместимость». */
  private storeMeter!: HTMLElement;
  private readonly commodityValues = new Map<ResourceKind, HTMLElement>();
  private chestName!: HTMLElement;
  private chestEffect!: HTMLElement;
  private chestStatus!: HTMLElement;
  private chestButton!: HTMLButtonElement;
  /** Карта региона (§4). Живёт в том же листе, где раньше был список ярусов. */
  private readonly map: WorldMap;
  /** Подарок за вход (§29): значок над сценой и семь карточек в листе. */
  private readonly daily: DailyPanel;
  /** Отряд, отданный лагерю снаружи (§26): карте он нужен, чтобы знать,
   *  есть ли кого отправить. */
  private roster: Roster | null = null;
  private readonly shopCards = new Map<ConsumableId, SupplyCard>();
  private supplyCount!: HTMLElement;
  private supplyFill!: HTMLElement;
  private supplyStatus!: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly task: HTMLElement;
  private readonly taskFace: HTMLElement;
  private readonly taskWhy: HTMLElement;
  private readonly taskButton: HTMLButtonElement;
  /** Какое задание сейчас на строке: от него зависит, что делает кнопка. */
  private taskDoes: 'tent' | 'clan' | 'chest' | 'shop' | 'world' | 'wood' | 'food' = 'tent';
  /** Разовая строка после оффлайн-вылазки: отчёт пришёл, дальше решение на карте. */
  private taskNudge: { kind: 'world'; text: string } | null = null;
  /** Сохраняемая ведущая цель первой главы; в отличие от мягкого совета,
   * открытие карты её не гасит. */
  private storyTask: string | null = null;

  private readonly sheet: HTMLElement;
  private readonly sheetKicker: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetClose: HTMLButtonElement;
  private readonly sections = new Map<string, HTMLElement>();
  /** Раздел «Мастерская» — часть карточки Мастерской, а не отдельная витрина. */
  private readonly gearSection: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private readonly constructionLive: HTMLButtonElement;
  private readonly constructionLiveName: HTMLElement;
  private readonly constructionLiveTime: HTMLElement;
  private readonly constructionLiveBar: HTMLElement;
  /**
   * Место для панелей, которые живут в лагере, но не принадлежат зданиям, —
   * сейчас там панель стройки стен. Стоит **над нижней строкой, а не в листе**,
   * и это исправление: раньше слот был разделом листа, а лист под отряд.
   * Кнопка «Стены» закрывает лист и показывает панель — то есть показывала её
   * внутри только что закрытого листа, и не показывала вовсе. Отладочная сцена
   * `?test=walls` ставит кольцо кодом и мимо этой дыры проходила.
   */
  readonly slot: HTMLElement;
  /** Полоса ресурсов: верхний край экрана, занятый панелью. */
  private readonly res: HTMLElement;
  private slots!: HTMLElement;
  private quiver!: HTMLButtonElement;
  private quiverValue!: HTMLElement;
  private quiverNote!: HTMLElement;
  private quiverCost!: HTMLElement;
  private offhand!: HTMLElement;
  private readonly offhandButtons = new Map<Offhand, HTMLButtonElement>();
  /**
   * Стреляет ли тот, кем сейчас идут. Колчан (§14.3) есть только у стрелка,
   * а класс живёт в ростере, которого лагерь не знает и знать не должен:
   * `CampState` — про постройки и припасы. Поэтому его сообщают снаружи.
   */
  private ranged = false;

  private open: SheetKind = null;
  /** Что говорить игроку и в каком порядке (`banner.ts`). */
  private readonly line = new Banner();
  private onb: OnbStep = 'done';
  /**
   * Последнее, что панель видела в sync. Нужно, чтобы открытый лист красился
   * сразу, а не на следующем тике: лист выезжает по тапу, и пустые строки
   * в нём — даже на один кадр — читаются как поломка.
   */
  private last: { camp: CampState; now: number } | null = null;

  constructor(parent: HTMLElement, private readonly cb: CampCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'camp';

    const res = document.createElement('div');
    this.res = res;
    res.className = 'panel res';
    for (const kind of RESOURCE_ORDER) {
      const item = document.createElement('span');
      item.className = 'res-item';
      const label = document.createElement('span');
      label.className = 'lbl';
      setGameText(label, resourceMessage[kind]);
      const value = document.createElement('b');
      value.textContent = '0';
      item.append(label, value);
      res.appendChild(item);
      this.resValues.set(kind, value);
    }
    // Счёт кладовой (§13.6) — пятым в полосе: конечность видна там же,
    // где сами числа, а не только в листе. Тап открывает кладовую —
    // тот же лист, что тап по сундуку в сцене.
    const meter = document.createElement('span');
    meter.className = 'res-item';
    const meterLabel = document.createElement('span');
    meterLabel.className = 'lbl';
    setGameText(meterLabel, gameMessage('кладовая', 'storage'));
    this.storeMeter = document.createElement('b');
    meter.append(meterLabel, this.storeMeter);
    meter.addEventListener('click', () => this.openStore());
    res.appendChild(meter);

    this.banner = document.createElement('div');
    this.banner.className = 'chip hint';

    /* ---------- задание ---------- */
    // Строка, а не уведомление. Уведомление гаснет через четыре секунды,
    // а «кому-то негде спать» не перестаёт быть правдой оттого, что игрок
    // отвернулся: пока задание открыто, оно обязано быть на экране.
    //
    // И не карточка здания: палатка зданием не является (`residents.ts`),
    // а прятать задание за кнопку нижней строки значило бы прятать
    // единственное, что лагерь сейчас просит.
    this.task = document.createElement('div');
    this.task.className = 'panel task';
    this.task.style.display = 'none';
    // Лицо того, кто ждёт крышу (`ui/avatar.ts`). Задание про человека,
    // и человек в нём — тот же, с которым знакомились на прогалине.
    this.taskFace = document.createElement('div');
    this.taskFace.className = 'face';
    this.taskWhy = document.createElement('span');
    this.taskWhy.className = 'why';
    this.taskButton = document.createElement('button');
    // Кнопка одна на все задания, и что она делает, решает то, что сейчас
    // на строке: две кнопки в одной строке — это уже меню, а задание обязано
    // называть одно действие.
    this.taskButton.addEventListener('click', () => {
      if (this.taskDoes === 'clan') this.cb.onClan();
      else if (this.taskDoes === 'chest') this.cb.onChest();
      else if (this.taskDoes === 'shop') this.openSheet('shop');
      else if (this.taskDoes === 'wood') this.cb.onGather('wood');
      else if (this.taskDoes === 'food') this.cb.onGather('food');
      else if (this.taskDoes === 'world') {
        this.taskNudge = null;
        this.openSheet('tiers');
      } else this.cb.onTent();
    });
    this.task.append(this.taskFace, this.taskWhy, this.taskButton);

    // Пустая середина — это и есть лагерь. Клики сквозь неё уходят на сцену,
    // иначе тап по зданию не дошёл бы до канваса.
    const space = document.createElement('div');
    space.className = 'camp-space';

    /* ---------- лист ---------- */
    this.sheet = document.createElement('div');
    this.sheet.className = 'panel sheet';
    const head = document.createElement('div');
    head.className = 'row mid sheet-head';
    const heading = document.createElement('span');
    this.sheetKicker = document.createElement('small');
    this.sheetKicker.style.display = 'none';
    this.sheetTitle = document.createElement('b');
    heading.append(this.sheetKicker, this.sheetTitle);
    this.sheetClose = document.createElement('button');
    this.sheetClose.className = 'ghost sheet-x';
    setGameText(this.sheetClose, gameMessage('Закрыть', 'Close'));
    this.sheetClose.addEventListener('click', () => this.close());
    head.append(heading, this.sheetClose);
    this.sheet.appendChild(head);

    for (const id of BUILDING_ORDER) {
      const section = document.createElement('div');
      section.className = 'sec';
      section.appendChild(this.makeRow(id));
      this.sections.set(id, section);
      this.sheet.appendChild(section);
    }

    const researchButton = document.createElement('button');
    researchButton.className = 'primary';
    setGameText(researchButton, gameMessage('Открыть дерево исследований', 'Open research tree'));
    researchButton.addEventListener('click', () => this.cb.onResearch());
    this.sections.get('archive')?.appendChild(researchButton);

    const buildings = document.createElement('div');
    buildings.className = 'sec build-catalog';
    buildings.appendChild(this.makeConstructionTabs('buildings'));
    const buildingGrid = document.createElement('div');
    buildingGrid.className = 'building-cards';
    for (const id of BUILDING_ORDER) buildingGrid.appendChild(this.makeBuildingCard(id));
    buildings.appendChild(buildingGrid);
    this.sections.set('buildings', buildings);
    this.sheet.appendChild(buildings);

    // §20.1 — сток без таймера. Живёт внутри карточки Мастерской: снаряжение
    // делает она, и отдельная вкладка разорвала бы эту связь.
    this.gearSection = document.createElement('div');
    this.gearSection.className = 'gear';
    for (const slot of GEAR_ORDER) this.gearSection.appendChild(this.makeGearRow(slot));
    this.sections.get('forge')?.appendChild(this.gearSection);

    // Кладовая (§13.6) — свой лист: открывается тапом по сундуку в сцене,
    // сундук и есть её лицо. Полоса занятости, запас по видам и карточка
    // постройки нового сундука.
    const store = document.createElement('div');
    store.className = 'sec';
    const storeBox = document.createElement('div');
    storeBox.className = 'b';
    this.storeLevel = document.createElement('span');
    this.storeLevel.className = 'dim';
    const storeTop = document.createElement('div');
    storeTop.className = 'row b-top';
    storeTop.append(this.storeLevel);
    this.storeBarWrap = document.createElement('div');
    this.storeBarWrap.className = 'bar';
    this.storeBar = document.createElement('i');
    this.storeBarWrap.appendChild(this.storeBar);
    // Запаса по видам здесь нет намеренно: он и так стоит в полосе ресурсов
    // прямо над листом, и вторая копия тех же чисел — это два места, где
    // взгляд обязан сверить одно и то же.
    storeBox.append(storeTop, this.storeBarWrap);
    store.appendChild(storeBox);
    const commodities = document.createElement('div');
    commodities.className = 'commodity-grid';
    for (const kind of ['meat', 'pelt'] as const) {
      const item = document.createElement('div');
      item.className = 'commodity card';
      const pic = document.createElement('img');
      pic.className = 'resource-pic';
      pic.src = resourceIcon(kind)!;
      pic.alt = '';
      const label = document.createElement('span');
      setGameText(label, resourceMessage[kind]);
      const value = document.createElement('b');
      value.textContent = '0';
      item.append(pic, label, value);
      commodities.appendChild(item);
      this.commodityValues.set(kind, value);
    }
    store.appendChild(commodities);
    this.sections.set('store', store);
    this.sheet.appendChild(store);

    const chest = document.createElement('div');
    chest.className = 'card b';
    const chestTop = document.createElement('div');
    chestTop.className = 'row b-top';
    // Счёт — в самом имени, а не бейджем в углу: «×0» тусклым кеглем
    // не читался, а сколько сундуков стоит — первое, что тут спрашивают.
    this.chestName = document.createElement('b');
    chestTop.append(this.chestName);
    this.chestEffect = document.createElement('div');
    this.chestEffect.className = 'b-eff';
    const chestBottom = document.createElement('div');
    chestBottom.className = 'row mid b-bot';
    this.chestStatus = document.createElement('span');
    this.chestStatus.className = 'dim';
    this.chestButton = document.createElement('button');
    this.chestButton.className = 'act';
    setGameText(this.chestButton, gameMessage('Поставить', 'Place'));
    // Лист закрывается, как у перестановки: дальше жест по земле, и сцена
    // обязана быть видна.
    this.chestButton.addEventListener('click', () => {
      this.cb.onChest();
      this.close();
    });
    chestBottom.append(this.chestStatus, this.chestButton);
    chest.append(chestTop, this.chestEffect, chestBottom);
    store.appendChild(chest);

    // §20.4 — перестановка бесплатна и мгновенна, поэтому это кнопка
    // в карточке, а не отдельный режим редактирования лагеря.
    this.moveButton = document.createElement('button');
    this.moveButton.className = 'ghost move';
    setGameText(this.moveButton, gameMessage('Переставить', 'Move'));
    this.moveButton.addEventListener('click', () => {
      if (!isBuilding(this.open)) return;
      this.cb.onMove(this.open);
      this.close();
    });

    // §21: подготовка к походу, а не магазин. Карточка показывает сначала
    // два занятых места и правила автосрабатывания, затем сами предметы:
    // игрок собирает набор, а не рассматривает витрину цен.
    const shop = document.createElement('div');
    shop.className = 'sec shop';

    const overview = document.createElement('div');
    overview.className = 'supply-overview';
    const loadout = document.createElement('section');
    loadout.className = 'card supply-summary supply-loadout';
    loadout.innerHTML = `<span class="supply-summary-icon">${supplyGlyph('loadout')}</span>`;
    const loadoutCopy = document.createElement('span');
    loadoutCopy.className = 'supply-summary-copy';
    const loadoutLabel = document.createElement('small');
    setGameText(loadoutLabel, gameMessage('Набор в поход', 'Expedition loadout'));
    this.supplyCount = document.createElement('strong');
    loadoutCopy.append(loadoutLabel, this.supplyCount);
    const loadoutTrack = document.createElement('span');
    loadoutTrack.className = 'supply-track';
    this.supplyFill = document.createElement('i');
    loadoutTrack.append(this.supplyFill);
    this.supplyStatus = document.createElement('small');
    loadout.append(loadoutCopy, loadoutTrack, this.supplyStatus);

    const makeRule = (icon: SupplyGlyph, title: GameMessage, copy: GameMessage): HTMLElement => {
      const rule = document.createElement('section');
      rule.className = 'card supply-rule';
      rule.innerHTML = `<span class="supply-summary-icon">${supplyGlyph(icon)}</span>`;
      const words = document.createElement('span');
      const strong = document.createElement('b');
      const small = document.createElement('small');
      setGameText(strong, title);
      setGameText(small, copy);
      words.append(strong, small);
      rule.append(words);
      return rule;
    };
    overview.append(
      loadout,
      makeRule('rule', gameMessage('Срабатывают сами', 'Automatic use'), gameMessage('Предмет сам выберет нужный момент', 'Each item waits for the right moment')),
      makeRule('loadout', gameMessage('На одну вылазку', 'One expedition'), gameMessage('Перед выходом набор можно вернуть', 'The loadout can be returned before departure')),
    );
    shop.append(overview);

    const itemHead = document.createElement('div');
    itemHead.className = 'row supply-section-head';
    const itemTitle = document.createElement('b');
    const itemNote = document.createElement('small');
    setGameText(itemTitle, gameMessage('Походные предметы', 'Expedition items'));
    setGameText(itemNote, gameMessage('Выберите не больше двух', 'Choose up to two'));
    itemHead.append(itemTitle, itemNote);
    shop.append(itemHead);

    const items = document.createElement('div');
    items.className = 'supply-items';
    for (const id of CONSUMABLE_ORDER) {
      const b = document.createElement('button');
      b.className = 'card supply-item';
      b.dataset['buy'] = id;
      b.addEventListener('click', () => this.cb.onBuyConsumable(id));
      const icon = document.createElement('span');
      icon.className = 'supply-item-icon';
      icon.innerHTML = supplyGlyph(id);
      const copy = document.createElement('span');
      copy.className = 'supply-item-copy';
      const name = document.createElement('b');
      const trigger = document.createElement('small');
      const effect = document.createElement('strong');
      copy.append(name, trigger, effect);
      const foot = document.createElement('span');
      foot.className = 'supply-item-foot';
      const price = document.createElement('small');
      const action = document.createElement('b');
      foot.append(price, action);
      b.append(icon, copy, foot);
      items.appendChild(b);
      this.shopCards.set(id, { button: b, name, trigger, effect, price, action });
    }
    shop.append(items);

    const picked = document.createElement('section');
    picked.className = 'card supply-picked';
    const pickedHead = document.createElement('div');
    pickedHead.className = 'row';
    const pickedTitle = document.createElement('b');
    const pickedNote = document.createElement('small');
    setGameText(pickedTitle, gameMessage('Взято с собой', 'Packed'));
    setGameText(pickedNote, gameMessage('Нажмите предмет, чтобы вернуть', 'Select an item to return it'));
    pickedHead.append(pickedTitle, pickedNote);
    this.slots = document.createElement('div');
    this.slots.className = 'slots supply-slots';
    picked.append(pickedHead, this.slots);
    shop.appendChild(picked);

    /**
     * §14.3 и §14.2 — колчан и левая рука.
     *
     * Обе механики были написаны, оттестированы и **не подключены ни к одной
     * кнопке**: `buyArrows` и `setOffhand` не звал никто. Колчан начинался
     * пустым и мог только убывать, то есть Лучник всегда дрался со штрафом
     * пустого колчана, а левая рука навсегда оставалась фонарём. Две
     * записанные решения игрок не мог принять вовсе.
     *
     * Место им здесь, а не в листе Мастерской: ковка стоит ресурсов и меняет
     * предмет, а это — сборы перед выходом. Стрелы кончаются каждую вылазку,
     * рука перекладывается бесплатно, и оба вопроса задаются ровно тогда же,
     * когда игрок берёт расходники.
     */
    this.quiver = document.createElement('button');
    this.quiver.className = 'card supply-utility supply-quiver';
    this.quiver.innerHTML = `<span class="supply-summary-icon">${supplyGlyph('quiver')}</span>`;
    const quiverCopy = document.createElement('span');
    const quiverTitle = document.createElement('b');
    setGameText(quiverTitle, gameMessage('Колчан', 'Quiver'));
    this.quiverNote = document.createElement('small');
    quiverCopy.append(quiverTitle, this.quiverNote);
    const quiverRight = document.createElement('span');
    this.quiverValue = document.createElement('strong');
    this.quiverCost = document.createElement('small');
    quiverRight.append(this.quiverValue, this.quiverCost);
    this.quiver.append(quiverCopy, quiverRight);
    this.quiver.addEventListener('click', () => this.cb.onBuyArrows());

    this.offhand = document.createElement('div');
    this.offhand.className = 'card supply-offhand';
    const offhandHead = document.createElement('span');
    offhandHead.className = 'supply-offhand-head';
    offhandHead.innerHTML = `<span class="supply-summary-icon">${supplyGlyph('offhand')}</span>`;
    const offhandWords = document.createElement('span');
    const offhandTitle = document.createElement('b');
    const offhandNote = document.createElement('small');
    setGameText(offhandTitle, gameMessage('Левая рука', 'Off hand'));
    setGameText(offhandNote, gameMessage('Выберите предмет перед выходом', 'Choose an item before departure'));
    offhandWords.append(offhandTitle, offhandNote);
    offhandHead.append(offhandWords);
    const offhandChoices = document.createElement('span');
    offhandChoices.className = 'slots supply-offhand-choices';
    for (const hand of OFFHAND_ORDER) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.addEventListener('click', () => this.cb.onOffhand(hand));
      this.offhandButtons.set(hand, b);
      offhandChoices.appendChild(b);
    }
    this.offhand.append(offhandHead, offhandChoices);
    const utilities = document.createElement('div');
    utilities.className = 'supply-utilities';
    utilities.append(this.quiver, this.offhand);
    shop.appendChild(utilities);
    this.sections.set('shop', shop);
    this.sheet.appendChild(shop);

    const tiers = document.createElement('div');
    tiers.className = 'sec tiers';
    this.map = new WorldMap({
      onRaid: (node) => this.cb.onRaid(node),
      onSortie: (node) => this.cb.onSortie(node),
      onVisitCamp: (id) => this.cb.onVisitCamp(id),
      onAppearance: (owner) => this.cb.onAppearance(owner),
    });
    tiers.append(this.map.root);
    this.sections.set('tiers', tiers);
    this.sheet.appendChild(tiers);

    // §29 — подарок за вход. Раздел листа, как карта: панель приносит свою
    // разметку целиком, лагерь даёт ей место и день.
    this.daily = new DailyPanel({
      onClaim: () => this.cb.onClaimGift(),
      onIcon: () => (this.open === 'daily' ? this.close() : this.openSheet('daily')),
      giftIcon: (name) => this.cb.giftIcon(name),
    });
    this.sections.set('daily', this.daily.root);
    this.sheet.appendChild(this.daily.root);

    this.slot = document.createElement('div');
    this.slot.className = 'sec camp-slot';

    // Единственный строительный слот виден и при закрытом листе. Тап ведёт
    // прямо к зданию, которое сейчас растёт, — искать его среди девяти не надо.
    this.constructionLive = document.createElement('button');
    this.constructionLive.className = 'panel construction-live';
    this.constructionLive.style.display = 'none';
    const liveText = document.createElement('span');
    this.constructionLiveName = document.createElement('b');
    this.constructionLiveTime = document.createElement('small');
    liveText.append(this.constructionLiveName, this.constructionLiveTime);
    const liveBar = document.createElement('span');
    liveBar.className = 'bar';
    this.constructionLiveBar = document.createElement('i');
    liveBar.appendChild(this.constructionLiveBar);
    this.constructionLive.append(liveText, liveBar);
    this.constructionLive.addEventListener('click', () => {
      const building = this.last?.camp.construction?.building;
      if (building !== undefined) {
        this.openBuilding(building);
        return;
      }
      const tool = this.last?.camp.walls?.work?.tool;
      if (tool !== undefined) this.cb.onWalls(tool === 'дорога' || tool === 'фонарь' ? 'decor' : 'defense');
    });

    /* ---------- нижняя строка ---------- */
    this.bar = document.createElement('div');
    this.bar.className = 'camp-bar';
    // «Стены» стоит рядом с «Отрядом», а не в листе здания: стройка стен —
    // не улучшение постройки, а свой режим со своим жестом, и прятать её
    // внутрь карточки Штаба значило бы соврать про то, чем она является.
    const walls = document.createElement('button');
    setGameText(walls, gameMessage('Строительство', 'Building'));
    walls.addEventListener('click', () => this.cb.onConstruction());
    this.wallsButton = walls;
    // Кнопки «Отряд» здесь больше нет: отряд переехал в веер у большого
    // пальца (`features/fan`) и стоит на экране постоянно. Лист открывался
    // ради одного вопроса — кем идти, — и на него теперь отвечает лицо
    // под пальцем, без листа и без второго касания.
    const supplies = this.makeBarButton(gameMessage('Припасы', 'Supplies'), 'shop');
    this.suppliesButton = supplies;
    this.bar.append(
      walls,
      this.makeActionButton(gameMessage('Жители', 'Residents'), () => this.cb.onResidents()),
      supplies,
      this.makeBarButton(gameMessage('В мир', 'World'), 'tiers', true),
    );

    // Значок стоит в пустом месте между полосами — там же, где сцена.
    // Отдельным слоем поверх всего он не нужен: `camp-space` и есть та
    // середина экрана, которая принадлежит лагерю (§6.2.6).
    space.appendChild(this.daily.icon);

    this.root.append(
      res, this.banner, this.task, space, this.sheet, this.slot,
      this.constructionLive, this.bar,
    );
    parent.appendChild(this.root);
    this.close();
  }

  private wallsButton!: HTMLButtonElement;
  /** «Припасы» — дом колчана (§14.3) и цель полёта подаренных стрел. */
  private suppliesButton!: HTMLButtonElement;

  /**
   * Показ кнопки «Стены». В лагере на поляне (§16.1) стены пока не строятся:
   * их рисует только сцена площадки, и кнопка обещала бы механику, которой
   * в кадре нет. Скрыта, а не выключена: заготовка, как HUD прогулки.
   */
  showWalls(show: boolean): void {
    this.wallsButton.style.display = show ? '' : 'none';
  }

  /**
   * Куда летит подарок (§29.4). Ресурс — к своему числу в полосе, сундук —
   * к счёту кладовой, стрелы — к «Припасам», где живёт колчан.
   */
  private landing(target: FlyTarget): HTMLElement | undefined {
    if (target === 'store') return this.storeMeter;
    if (target === 'quiver') return this.suppliesButton;
    return this.resValues.get(target);
  }

  /**
   * Подарок долетает до места, где он теперь лежит (§29.4).
   *
   * Механика от этого не меняется ничем: ресурсы зачислены до полёта, и полёт
   * — единственное в подарке, что можно выключить, ничего не сломав. Нужен он
   * затем, что до сих пор подарок превращался в строку баннера: игра говорила
   * «дали», а показать, куда именно, было нечем — и число в полосе менялось
   * само по себе, в стороне от нажатой кнопки.
   *
   * Летит картинка карточки, а не абстрактная искра: игрок только что видел
   * бревно на карточке, и в полосу «дерево» обязано прилететь оно же.
   *
   * `prefers-reduced-motion` отменяет полёт, но не отменяет ответ: число
   * вспыхивает на месте. Событие обязано быть заметно и тому, кто выключил
   * движение, — это то же правило, по которому §18.1 не оставляет звук
   * единственным носителем.
   */
  flyGift(targets: readonly FlyTarget[]): void {
    if (this.last === null || targets.length === 0) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = this.daily.origin(this.last.camp);
    targets.forEach((target, i) => {
      const to = this.landing(target);
      if (to === undefined || to.offsetParent === null) return;
      const flash = (): void => {
        to.classList.remove('gift-land');
        // Перезапуск анимации: без чтения раскладки браузер склеивает снятие
        // и возврат класса в один кадр, и вторая вспышка не случается вовсе.
        void to.offsetWidth;
        to.classList.add('gift-land');
        const off = (): void => to.classList.remove('gift-land');
        // Снимается по концу самой анимации, а не по таймеру: в спрятанной
        // вкладке таймеры растягиваются до секунды и класс переживал бы
        // вспышку. Таймер остаётся страховкой на случай, когда анимации
        // не случилось вовсе (движение выключено настройкой).
        to.addEventListener('animationend', off, { once: true });
        window.setTimeout(off, 800);
      };
      if (still || from.url === '') {
        window.setTimeout(flash, i * 90);
        return;
      }
      const fly = document.createElement('img');
      fly.className = 'gift-fly';
      fly.alt = '';
      fly.src = from.url;
      fly.style.left = `${from.rect.left}px`;
      fly.style.top = `${from.rect.top}px`;
      fly.style.width = `${from.rect.width}px`;
      fly.style.height = `${from.rect.height}px`;
      fly.style.transitionDelay = `${i * 90}ms`;
      document.body.appendChild(fly);
      const box = to.getBoundingClientRect();
      // Раскладку надо прокачать между вставкой и сдвигом: начало и конец,
      // заданные без неё, браузер считает одним состоянием, и перехода нет.
      //
      // Прокачка чтением, а не кадром `requestAnimationFrame`, и это не вкус:
      // спрятанной вкладке кадров не дают вовсе, и полёт, начатый из кадра,
      // там не начинался никогда — значок оставался лежать на карточке
      // навсегда. Чтение `offsetWidth` работает всегда и синхронно.
      void fly.offsetWidth;
      fly.style.transform =
        `translate(${box.left + box.width / 2 - from.rect.left - from.rect.width / 2}px, ` +
        `${box.top + box.height / 2 - from.rect.top - from.rect.height / 2}px) scale(0.42)`;
      fly.style.opacity = '0.15';
      let landed = false;
      const land = (): void => {
        if (landed) return;
        landed = true;
        fly.remove();
        flash();
      };
      fly.addEventListener('transitionend', land, { once: true });
      // Страховка на случай, когда перехода не случилось вовсе: вкладку
      // спрятали посреди полёта, движение выключено настройкой, переход
      // прервали. Значок обязан исчезнуть в любом из этих случаев —
      // висящая поверх игры картинка хуже, чем не случившийся полёт.
      window.setTimeout(land, 900 + i * 90);
    });
  }

  private makeBarButton(text: GameMessage, kind: SheetKind, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    setGameText(b, text);
    if (primary) b.className = 'primary';
    // Повторный тап по той же кнопке закрывает лист: кнопка, которая только
    // открывает, вынуждает целиться в «Закрыть».
    b.addEventListener('click', () => (this.open === kind ? this.close() : this.openSheet(kind)));
    return b;
  }

  private makeActionButton(text: GameMessage, action: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    setGameText(b, text);
    b.addEventListener('click', () => {
      this.close();
      action();
    });
    return b;
  }

  private makeConstructionTabs(active: 'buildings' | BuildCategory): HTMLElement {
    const tabs = document.createElement('div');
    tabs.className = 'construction-tabs';
    const entries: readonly [typeof active, GameMessage][] = [
      ['buildings', gameMessage('Здания', 'Buildings')],
      ['defense', gameMessage('Оборона', 'Defenses')],
      ['decor', gameMessage('Благоустройство', 'Amenities')],
    ];
    for (const [kind, label] of entries) {
      const button = document.createElement('button');
      setGameText(button, label);
      button.classList.toggle('active', kind === active);
      button.setAttribute('aria-pressed', kind === active ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (kind === 'buildings') this.openConstruction();
        else {
          this.close();
          this.cb.onWalls(kind);
        }
      });
      tabs.appendChild(button);
    }
    return tabs;
  }

  private makeCostChips(): { root: HTMLElement; chips: Map<ResourceKind, CostChip> } {
    const root = document.createElement('div');
    root.className = 'cost-chips';
    const chips = new Map<ResourceKind, CostChip>();
    for (const kind of RESOURCE_ORDER) {
      const chip = document.createElement('span');
      chip.className = 'cost-chip';
      const name = document.createElement('span');
      name.className = 'cost-name';
      setGameText(name, resourceMessage[kind]);
      const have = document.createElement('b');
      const slash = document.createTextNode('/');
      const need = document.createElement('b');
      chip.append(name, have, slash, need);
      chip.style.display = 'none';
      root.appendChild(chip);
      chips.set(kind, { root: chip, have, need });
    }
    return { root, chips };
  }

  private syncCostChips(
    chips: Map<ResourceKind, CostChip>,
    camp: CampState,
    id: BuildingId,
    level: number,
    visible: boolean,
  ): void {
    const cost = buildingCost(id, level);
    for (const [kind, chip] of chips) {
      const need = cost[kind] ?? 0;
      chip.root.style.display = visible && need > 0 ? '' : 'none';
      if (need <= 0) continue;
      const have = camp.resources[kind] ?? 0;
      chip.have.textContent = String(have);
      chip.need.textContent = String(need);
      chip.root.classList.toggle('cant', have < need);
    }
  }

  private makeBuildingCard(id: BuildingId): HTMLElement {
    const button = document.createElement('button');
    button.className = 'card building-pick';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'glyph');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = BUILDING_GLYPH[id];
    const name = document.createElement('b');
    setGameText(name, buildingMessage[id]);
    const level = document.createElement('span');
    level.className = 'badge building-level';
    const effect = document.createElement('span');
    effect.className = 'dim building-next';
    const costs = this.makeCostChips();
    button.append(icon, name, level, effect, costs.root);
    button.addEventListener('click', () => this.openBuilding(id));
    this.buildingCards.set(id, { button, level, effect, costs: costs.chips });
    return button;
  }

  private makeRow(id: BuildingId): HTMLElement {
    const box = document.createElement('div');
    box.className = 'b building-sheet';

    // Имя здания стоит в шапке листа, и второй раз оно только шумит:
    // карточка открыта ровно про одно здание.
    const top = document.createElement('div');
    top.className = 'row b-top';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'glyph building-glyph');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = BUILDING_GLYPH[id];
    const level = document.createElement('span');
    level.className = 'dim';
    top.append(icon, level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';
    const next = document.createElement('div');
    next.className = 'building-delta';

    const costs = this.makeCostChips();

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const bar = document.createElement('i');
    bar.className = 'warn';
    barWrap.appendChild(bar);
    barWrap.style.display = 'none';

    const bottom = document.createElement('div');
    bottom.className = 'row mid b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    bottom.append(status, button);
    const actions = document.createElement('div');
    actions.className = 'building-actions';
    actions.appendChild(bottom);

    // Слушатель вешается один раз на живой элемент — он и не переживает
    // перерисовку, потому что перерисовки больше нет.
    button.addEventListener('click', () => {
      if (button.dataset['mode'] === 'speedup') this.cb.onSpeedup();
      else this.cb.onUpgrade(id);
    });

    box.append(top, effect, next, costs.root, barWrap, actions);
    this.rows.set(id, {
      box, level, effect, next, costs: costs.chips, actions, status, barWrap, bar, button,
    });
    return box;
  }

  private makeGearRow(slot: GearSlot): HTMLElement {
    const box = document.createElement('div');
    // Пять предметов подряд — список, и коробка ему нужна общая: `.card`.
    box.className = 'card b gear-row';

    /*
     * Вещь видна вещью. Пять строк с одними подписями читались списком
     * свойств, а куются в них предметы: значок отвечает на «что это»
     * раньше, чем игрок дочитает строку эффекта. Рисуется он из той же
     * запечённой геометрии, что и сцена (`render/gearIcon.ts`), — картинок
     * в игру по-прежнему не едет ни одной (§6.1).
     */
    const pic = document.createElement('img');
    // `.chip` — подложка из словаря (`style.css`): своя коробка с краем
    // здесь запрещена, и правильно — плашек в игре ровно три.
    pic.className = 'chip gear-pic';
    // Пустой alt намеренно: имя вещи стоит рядом строкой, и повторять его
    // в озвучке значило бы называть предмет дважды.
    pic.alt = '';
    pic.decoding = 'async';

    const col = document.createElement('div');
    col.className = 'gear-col';

    const top = document.createElement('div');
    top.className = 'row b-top';
    const name = document.createElement('b');
    setGameText(name, gearMessage[slot]);
    const level = document.createElement('span');
    level.className = 'badge';
    top.append(name, level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    barWrap.style.display = 'none';
    const bar = document.createElement('i');
    barWrap.appendChild(bar);

    const bottom = document.createElement('div');
    bottom.className = 'row mid b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    button.className = 'act';
    bottom.append(status, button);
    button.addEventListener('click', () => this.cb.onCraft(slot));

    col.append(top, effect, bottom);
    box.append(pic, col);
    this.gearRows.set(slot, { box, level, effect, status, barWrap, bar, button, pic });
    return box;
  }

  /* ---------- лист: открыть, закрыть, назвать ---------- */

  openSheet(kind: SheetKind): void {
    const was = this.open !== null;
    this.open = kind;
    this.root.classList.toggle('supply-open', kind === 'shop');
    this.sheet.classList.toggle('supply-sheet', kind === 'shop');
    this.sheetKicker.style.display = kind === 'shop' ? '' : 'none';
    if (kind === 'shop') setGameText(this.sheetKicker, gameMessage('Подготовка к вылазке', 'Expedition preparation'));
    if (kind === 'tiers') this.taskNudge = null;
    this.sheet.style.display = kind === null ? 'none' : '';
    for (const [key, el] of this.sections) el.style.display = key === kind ? '' : 'none';
    const title = this.titleFor(kind);
    if (title === null) {
      clearGameText(this.sheetTitle);
      this.sheetTitle.textContent = '';
    } else setGameText(this.sheetTitle, title);
    if (kind === 'tiers' && this.last !== null) {
      this.map.open(this.last.camp, this.last.now);
      // Кадр мог встать до первого `sync`, когда выбирать было ещё не из чего:
      // тогда запирание случается здесь, на открытии листа.
      if (this.onb === 'world') {
        this.map.setOnly(firstRaidNode(dayAt(this.last.now), this.last.now));
      }
    }
    // Неделя подарков выкладывается на открытии листа (§29.4). Красить
    // её перед этим не нужно: `sync` идёт каждый кадр и для закрытого
    // раздела тоже — карточки уже знают, что на них написано.
    if (kind === 'daily') this.daily.appear();
    this.paintOpen();
    // Кнопка перестановки принадлежит карточке здания и переезжает в неё:
    // здание всегда одно, а разделов много.
    if (isBuilding(kind)) {
      this.rows.get(kind)?.actions.appendChild(this.moveButton);
      this.moveButton.style.display = (this.last?.camp.levels[kind] ?? 0) > 0 ? '' : 'none';
    } else {
      this.moveButton.style.display = 'none';
    }
    // На переходе, а не на каждом зове: конструктор закрывает закрытый лист,
    // и слушатель в этот момент ещё не создан.
    if (was !== (kind !== null)) this.cb.onSheet(kind !== null);
  }

  /** Тап по зданию в сцене. Открывает карточку именно этого здания. */
  openBuilding(id: BuildingId): void {
    this.openSheet(id);
  }

  openConstruction(): void {
    this.openSheet('buildings');
  }

  /** Тап по сундуку в сцене (§13.6): сундук — лицо кладовой. */
  openStore(): void {
    this.openSheet('store');
  }

  close(): void {
    this.openSheet(null);
  }

  get sheetOpen(): boolean {
    return this.open !== null;
  }

  private titleFor(kind: SheetKind): GameMessage | null {
    if (kind === null) return null;
    if (kind === 'tiers') return gameMessage('Карта региона', 'Region map');
    // Заголовок называет ту же кнопку, что открыла лист: «В вылазку» здесь
    // называло кнопку, которой больше нет.
    if (kind === 'shop') return gameMessage('Припасы', 'Supplies');
    if (kind === 'buildings') return gameMessage('Строительство', 'Building');
    if (kind === 'store') return gameMessage('Кладовая', 'Storage');
    if (kind === 'daily') return gameMessage('Подарок за вход', 'Daily gift');
    return buildingMessage[kind];
  }

  /* ---------- обновление ---------- */

  /**
   * Сколько экрана занято панелью сверху и снизу, в пикселях. Середина
   * между ними принадлежит сцене (`camp-space`), и всё, что встаёт поверх
   * лагеря, обязано умещаться туда, а не на кнопки.
   *
   * Считается по живым прямоугольникам, а не по константам вёрстки: высота
   * полосы зависит от безопасной зоны телефона, от строки задания и от того,
   * говорит ли сейчас баннер. Константа разошлась бы с вёрсткой молча.
   */
  bands(): { top: number; bottom: number } {
    const low = [this.res, this.banner, this.task]
      .filter((el) => el.offsetParent !== null)
      .reduce((y, el) => Math.max(y, el.getBoundingClientRect().bottom), 0);
    const bottomTops = [this.bar, this.constructionLive]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect().top);
    return {
      top: Math.round(low),
      bottom: Math.round(Math.max(0, window.innerHeight - Math.min(...bottomTops))),
    };
  }

  sync(camp: CampState, now: number, dt: number): void {
    for (const kind of RESOURCE_ORDER) {
      const el = this.resValues.get(kind);
      if (el !== undefined) el.textContent = String(camp.resources[kind]);
    }
    this.storeMeter.textContent = `${storeUsed(camp)}/${storeCapacity(camp)}`;

    this.line.tick(dt);

    this.syncTask(camp);
    this.daily.sync(camp, now);

    this.last = { camp, now };
    this.syncConstructionLive(camp, now);
    this.paintOpen();
    this.applyOnboarding();
  }

  /**
   * Строка задания. Красится в общем `sync`, а не в `paintOpen`: она видна
   * всегда, а не в открытом разделе, — в этом и смысл задания.
   *
   * Кнопка не гаснет молча. Когда палатку поставить нельзя, причина стоит
   * рядом словом — то же правило, что у `siteBlock` (§16.1) и у погасших
   * точек карты (§16.2): отказ обязан называть, чего не хватает.
   */
  private syncTask(camp: CampState): void {
    const need = homeless(camp);
    // Голод стоит сразу за крышей и перед всем прочим: без пищи не работает
    // никто (§13.7), а сундук, клан и колчан ждут до вечера.
    if (need === 0 && this.syncFoodTask(camp)) return;
    if (need === 0 && this.storyTask !== null) {
      this.syncWorldTask(this.storyTask);
      return;
    }
    if (need === 0 && clanTaskOpen(camp)) {
      this.syncClanTask();
      return;
    }
    if (need === 0 && this.syncChestTask(camp)) return;
    if (need === 0 && this.syncArrowTask(camp)) return;
    if (need === 0 && this.taskNudge !== null) {
      this.syncWorldTask(this.taskNudge.text);
      return;
    }
    this.task.style.display = need === 0 ? 'none' : 'flex';
    if (need === 0) {
      this.hideTaskFace();
      return;
    }
    // Имя вместо «гостя»: человек, которого позвали, стоит в лагере
    // с именем и лицом, и звать его в задании гостем — значит забыть
    // знакомство, ради которого он и пришёл.
    //
    // Строка нарочно именительная. «Гите негде спать» требует дательного,
    // а склонять имена из пула (§0.1) неоткуда: «Гость 2 негде спать» уже
    // получилось и читалось поломкой. Двоеточие обходит падеж целиком
    // и работает с любым именем.
    const first = homelessFolk(camp)[0];
    const who = first?.name ?? gameText(gameMessage('гость'));
    const taskMessage = need === 1
      ? gameMessage('Без крыши: {who}', 'Needs shelter: {who}')
      : gameMessage('Без крыши: {who} и ещё {count}', 'Need shelter: {who} and {count} more');
    const taskValues: GameMessageValues = { who, count: need - 1 };
    const face = first === undefined ? '' : `${first.look}/${first.seed}`;
    if (this.taskFace.dataset['who'] !== face) {
      this.taskFace.dataset['who'] = face;
      this.taskFace.innerHTML = first === undefined ? '' : avatarSvg(residentLook(first), first.seed);
      this.taskFace.style.display = first === undefined ? 'none' : '';
    }
    const block = tentBlock(camp);
    // Название причины дописывается к поводу, а не заменяет его: игрок
    // должен видеть и что просят, и почему нельзя, — одно без другого
    // это либо задание без выхода, либо отказ без повода.
    if (block === 'ok') setGameText(this.taskWhy, taskMessage, taskValues);
    else setGameText(this.taskWhy, gameMessage(
      '{task} · {reason}',
      '{task} · {reason}',
    ), {
      task: gameText(taskMessage, taskValues),
      reason: gameText(TENT_REASON_MESSAGE[block]),
    });
    /**
     * Не хватает дерева — кнопка ведёт за деревом, а не гаснет. Лес поляны
     * рубится тут же (§13.3), и «нет дерева» в лагере, стоящем в лесу, —
     * это не тупик, а одна невыполненная работа. Прочие отказы (места нет,
     * все под крышей) кнопку по-прежнему гасят: за них платят не топором.
     */
    if (block === 'resources') {
      setGameText(this.taskButton, GATHER_WOOD_MESSAGE);
      this.taskButton.disabled = false;
      this.taskDoes = 'wood';
      return;
    }
    setGameText(this.taskButton, gameMessage('Палатка · {cost}', 'Tent · {cost}'), {
      cost: this.costLine(0, TENT_COST),
    });
    this.taskButton.disabled = block !== 'ok';
    this.taskDoes = 'tent';
  }

  /**
   * Пустая кладовая по пище (§13.7). Стоит **за** крышей и **перед** прочими:
   * голод останавливает работу всего лагеря, а сундук и клан ждут до вечера.
   *
   * Кнопка ведёт к тому, чем пища и берётся, — к добытчику: §13.7 держит
   * правило «пищу приносит только жилец с приказом „Добывать пищу“».
   * Если ставить приказ некому, строка ведёт в мир: ягоды растут в местах
   * (§13.8), и там их берут руками.
   */
  private syncFoodTask(camp: CampState): boolean {
    if (camp.resources.food > 0) return false;
    this.task.style.display = 'flex';
    this.hideTaskFace();
    const feeder = camp.residents.some((r) => !r.rest && r.hunt === undefined && r.answer === 'кормим');
    setGameText(this.taskWhy, feeder ? FOOD_TASK_BUSY_MESSAGE : FOOD_TASK_MESSAGE);
    const canFeed = camp.residents.length > 0 && !feeder;
    setGameText(this.taskButton, canFeed ? SEND_FOR_FOOD_MESSAGE : GATHER_FOOD_MESSAGE);
    this.taskButton.disabled = false;
    this.taskDoes = canFeed ? 'food' : 'world';
    return true;
  }

  private hideTaskFace(): void {
    if (this.taskFace.dataset['who'] === '') return;
    this.taskFace.dataset['who'] = '';
    this.taskFace.innerHTML = '';
    this.taskFace.style.display = 'none';
  }

  /**
   * Задание про клан (§30). Стоит **за** крышей и не рядом с ней: строка
   * задания одна, и порядок в ней решает не важность вообще, а срочность.
   * Человек без крыши ждёт сегодня; имя лагеря подождёт до вечера — и стоит
   * оно ровно того, чтобы дождаться пустой строки, а не делить её.
   *
   * Лица у этого задания нет: клан — не человек, и чужое лицо рядом с ним
   * читалось бы как «этот просит клан».
   */
  private syncClanTask(): void {
    this.task.style.display = 'flex';
    this.taskDoes = 'clan';
    this.hideTaskFace();
    setGameText(this.taskWhy, gameMessage('У лагеря нет имени, а соседи уже в таблице', 'Your camp is still unnamed; your neighbors are already in the standings'));
    setGameText(this.taskButton, gameMessage('Создать клан', 'Create clan'));
    this.taskButton.disabled = false;
  }

  private syncChestTask(camp: CampState): boolean {
    const used = storeUsed(camp);
    const cap = storeCapacity(camp);
    if (used < cap * 0.8) return false;
    const block = chestBlock(camp);
    this.task.style.display = 'flex';
    this.taskDoes = 'chest';
    this.hideTaskFace();
    if (block === 'ok') setGameText(this.taskWhy, gameMessage(
      'Кладовая почти полна: {used}/{capacity}',
      'Storage is almost full: {used}/{capacity}',
    ), { used, capacity: cap });
    else setGameText(this.taskWhy, gameMessage(
      'Кладовая почти полна: {used}/{capacity} · {reason}',
      'Storage is almost full: {used}/{capacity} · {reason}',
    ), { used, capacity: cap, reason: gameText(CHEST_REASON_MESSAGE[block]) });
    setGameText(this.taskButton, gameMessage('Сундук · {cost}', 'Chest · {cost}'), {
      cost: this.costLine(0, CHEST_COST),
    });
    this.taskButton.disabled = block !== 'ok';
    return true;
  }

  private syncArrowTask(camp: CampState): boolean {
    const cap = this.ranged ? campQuiverCapacity(camp) : 0;
    if (cap <= 0 || camp.arrows > 0) return false;
    this.task.style.display = 'flex';
    this.taskDoes = 'shop';
    this.hideTaskFace();
    if (canBuyArrows(camp, cap)) setGameText(this.taskWhy, gameMessage('Колчан пуст', 'The quiver is empty'));
    else setGameText(this.taskWhy, gameMessage(
      'Колчан пуст · нужно {cost}',
      'Quiver is empty · requires {cost}',
    ), { cost: this.costLine(0, ARROW_PACK_COST) });
    setGameText(this.taskButton, gameMessage('Припасы', 'Supplies'));
    this.taskButton.disabled = false;
    return true;
  }

  private syncWorldTask(text: string): void {
    this.task.style.display = 'flex';
    this.taskDoes = 'world';
    this.hideTaskFace();
    clearGameText(this.taskWhy);
    this.taskWhy.textContent = text;
    setGameText(this.taskButton, gameMessage('В мир', 'World'));
    this.taskButton.disabled = false;
  }

  /**
   * Красится только открытый раздел: остальные не видны, и их пересчёт
   * каждый тик — работа, которой никто не увидит.
   */
  private paintOpen(): void {
    if (this.last === null) return;
    const { camp, now } = this.last;
    if (this.open === 'tiers') this.syncTiers(camp, now);
    else if (this.open === 'buildings') this.syncBuildingCatalog(camp);
    else if (this.open === 'shop') this.syncShop(camp);
    else if (this.open === 'store') this.syncStore(camp);
    else if (isBuilding(this.open)) {
      this.syncBuilding(camp, this.open, now);
      if (this.open === 'forge') this.syncGear(camp);
    }
  }

  private syncTiers(camp: CampState, now: number): void {
    this.map.sync(camp, now, this.roster ?? { heroes: [], active: 0 });
  }

  /**
   * §26 — карте нужен отряд: отправлять некого решает ростер, а лагерь про
   * героев не знает (см. `setRanged` — тот же случай и та же причина).
   */
  setRoster(roster: Roster): void {
    this.roster = roster;
  }

  /**
   * §30.6 — карте нужны чужие метки: читает их сеть, а панель про сеть
   * не знает. Тот же случай и та же причина, что у ростера строкой выше;
   * лагерь их только передаёт, потому что карта живёт в его листе.
   */
  setNeighbours(visits: readonly Visit[]): void {
    this.map.setNeighbours(visits);
  }

  /** Общий серверный снимок сменился после открытия интерфейса. */
  refreshWorld(now: number): void {
    this.map.refreshWorld(now);
  }

  /** §30.7 — то же для чужих лагерей: карта показывает их по кромке. */
  setCamps(live: readonly LiveCamp[]): void {
    this.map.setCamps(live);
  }

  /** Личный и клановый знаки приходят из серверного магазина. */
  setCosmetics(personal: unknown, clan: unknown): void {
    this.map.setCosmetics(personal, clan);
  }

  private syncShop(camp: CampState): void {
    const takenCount = camp.loadout.length;
    this.supplyCount.textContent = `${takenCount}/${CONSUMABLE_SLOTS}`;
    this.supplyFill.style.width = `${(takenCount / CONSUMABLE_SLOTS) * 100}%`;
    setGameText(this.supplyStatus, takenCount === 0
      ? gameMessage('Два свободных места', 'Two slots available')
      : takenCount >= CONSUMABLE_SLOTS
        ? gameMessage('Набор готов', 'Loadout ready')
        : gameMessage('Осталось одно место', 'One slot available'));

    for (const id of CONSUMABLE_ORDER) {
      const def = CONSUMABLES[id];
      const card = this.shopCards.get(id);
      if (card === undefined) continue;
      const price = (Object.entries(def.price) as [ResourceKind, number][])
        .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${amount}`)
        .join(' · ');
      const copy = consumableMessage[id];
      setGameText(card.name, copy.name);
      setGameText(card.trigger, gameMessage('Когда: {trigger}', 'When: {trigger}'), {
        trigger: gameText(copy.trigger),
      });
      setGameText(card.effect, gameMessage('→ {effect}', '→ {effect}'), { effect: gameText(copy.effect) });
      setGameText(card.price, gameMessage('Цена · {price}', 'Cost · {price}'), { price });
      const block = buyBlock(camp, id);
      setGameText(card.action, block === 'ok'
        ? gameMessage('Взять', 'Pack')
        : block === 'slots'
          ? gameMessage('Слоты заняты', 'Slots full')
          : gameMessage('Не хватает', 'Not enough'));
      card.button.disabled = block !== 'ok';
      card.button.classList.toggle('ready', block === 'ok');
    }
    /**
     * §14.3 — колчан. Вместимость даёт лук (`gearMods`), и без лука строка
     * не показывается вовсе: у ближника колчан не значит ничего, а кнопка,
     * которая ничего не делает, хуже отсутствующей.
     */
    const cap = this.ranged ? campQuiverCapacity(camp) : 0;
    this.quiver.style.display = cap > 0 ? '' : 'none';
    if (cap > 0) {
      const price = (Object.entries(ARROW_PACK_COST) as [ResourceKind, number][])
        .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${amount}`)
        .join(' · ');
      setGameText(this.quiverValue, gameMessage('{arrows} / {capacity}', '{arrows} / {capacity}'), {
        arrows: camp.arrows, capacity: cap,
      });
      setGameText(this.quiverNote, gameMessage('Стрелы возвращаются после вылазки', 'Unused arrows return after the raid'));
      setGameText(this.quiverCost, gameMessage('+{pack} · {price}', '+{pack} · {price}'), {
        pack: ARROW_PACK, price,
      });
      setGameAttribute(this.quiver, 'title', gameMessage(
        'Стрелы тратятся в вылазке; неиспользованные возвращаются в лагерь',
        'Arrows are spent during a raid; unused arrows return to camp',
      ));
      this.quiver.disabled = !canBuyArrows(camp, cap);
    }

    /**
     * §14.2 — левая рука. Выбор бесплатный и мгновенный: он обязан
     * пересматриваться перед каждым выходом, иначе слот теряет смысл.
     * Уровень у обоих предметов один и тот же — кован слот, а не предмет.
     */
    const level = camp.gear.torch;
    this.offhand.style.display = level > 0 ? '' : 'none';
    for (const hand of OFFHAND_ORDER) {
      const b = this.offhandButtons.get(hand);
      if (b === undefined) continue;
      const def = OFFHAND[hand];
      setGameText(b, offhandMessage[hand]);
      clearGameAttribute(b, 'title');
      b.title = gearItemLine(def, level);
      b.className = 'slot' + (camp.offhand === hand ? '' : ' empty');
      b.disabled = camp.offhand === hand;
    }

    this.slots.innerHTML = '';
    for (let i = 0; i < CONSUMABLE_SLOTS; i++) {
      const taken = camp.loadout[i];
      const slot = document.createElement('button');
      slot.className = 'slot supply-picked-slot' + (taken === undefined ? ' empty' : '');
      const icon = document.createElement('span');
      icon.innerHTML = supplyGlyph(taken ?? 'loadout');
      const words = document.createElement('span');
      const name = document.createElement('b');
      const note = document.createElement('small');
      setGameText(name, taken === undefined ? gameMessage('Свободный слот', 'Open slot') : consumableMessage[taken].name);
      setGameText(note, taken === undefined ? gameMessage('Выберите предмет выше', 'Choose an item above') : gameMessage('Нажмите, чтобы вернуть', 'Select to return'));
      words.append(name, note);
      slot.append(icon, words);
      slot.disabled = taken === undefined;
      if (taken !== undefined) {
        setGameAttribute(slot, 'title', gameMessage('Вернуть', 'Return'));
        slot.addEventListener('click', () => this.cb.onRefundConsumable(i));
      }
      this.slots.appendChild(slot);
    }
  }

  private syncConstructionLive(camp: CampState, now: number): void {
    const buildingWork = camp.construction;
    const wallWork = camp.walls?.work ?? null;
    this.constructionLive.style.display = (buildingWork === null && wallWork === null) || this.open !== null
      ? 'none'
      : '';
    const work = buildingWork ?? wallWork;
    if (work === null) return;
    if (buildingWork !== null) {
      setGameText(this.constructionLiveName, gameMessage(
        '{building} · ур. {level}',
        '{building} · lvl {level}',
      ), { building: gameText(buildingMessage[buildingWork.building]), level: buildingWork.toLevel });
    } else {
      setGameText(this.constructionLiveName, WALL_WORK_MESSAGE[wallWork!.tool]);
    }
    const left = Math.max(0, work.endsAt - now);
    setGameText(this.constructionLiveTime, gameMessage(
      'Осталось {duration}',
      '{duration} remaining',
    ), { duration: gameDuration(left) });
    const progress = buildingWork !== null
      ? 1 - left / Math.max(1, work.endsAt - work.startedAt)
      : wallProgress(camp.walls!, now);
    this.constructionLiveBar.style.width = `${Math.max(0, Math.min(100, progress * 100)).toFixed(1)}%`;
  }

  private syncBuildingCatalog(camp: CampState): void {
    for (const id of BUILDING_ORDER) {
      const card = this.buildingCards.get(id);
      if (card === undefined) continue;
      const level = camp.levels[id];
      const next = level + 1;
      const block = upgradeBlock(camp, id);
      setGameText(card.level, level > 0
        ? gameMessage('ур. {level}', 'lvl {level}')
        : gameMessage('новое', 'new'), { level });
      const max = buildingMaxLevel(id);
      if (level >= max) setGameText(card.effect, gameMessage(
        'Улучшено до предела',
        'Fully upgraded',
      ));
      else setGameText(card.effect, gameMessage(
        'Дальше · {effect}',
        'Next · {effect}',
      ), { effect: BUILDINGS[id].effect(next) });
      this.syncCostChips(card.costs, camp, id, next, level < max);
      card.button.classList.toggle('locked', block === 'locked');
      card.button.classList.toggle('busy', camp.construction?.building === id);
      card.button.classList.toggle('cant', block === 'resources');
    }
  }

  private syncBuilding(camp: CampState, id: BuildingId, now: number): void {
    const row = this.rows.get(id);
    if (row === undefined) return;
    const level = camp.levels[id];
    const c = camp.construction;

    if (c !== null && c.building === id) {
      const left = Math.max(0, c.endsAt - now);
      const total = Math.max(1, c.endsAt - c.startedAt);
      const price = speedupCost(left, total);
      setGameText(row.level, gameMessage('ур. {level} → {next}', 'lvl {level} → {next}'), {
        level, next: c.toLevel,
      });
      row.effect.textContent = BUILDINGS[id].effect(level);
      setGameText(row.next, gameMessage(
        'Строится · {effect}',
        'Building · {effect}',
      ), { effect: BUILDINGS[id].effect(c.toLevel) });
      row.next.style.display = '';
      this.syncCostChips(row.costs, camp, id, c.toLevel, false);
      row.barWrap.style.display = '';
      row.bar.style.width = `${((1 - left / total) * 100).toFixed(1)}%`;
      setGameText(row.status, gameMessage('{duration}', '{duration}'), { duration: gameDuration(left) });
      row.button.dataset['mode'] = 'speedup';
      // §20.5 — последние пять минут бесплатны.
      setGameText(row.button, price === 0
        ? gameMessage('Достроить', 'Finish')
        : gameMessage('Ускорить · монеты {coins}', 'Speed up · {coins} coins'), { coins: price });
      row.button.disabled = price > coinsOf(camp);
      return;
    }

    const block = upgradeBlock(camp, id);
    // Уровень 0 — не «ур. 0», а пустое место: цифра тут врала бы.
    setGameText(row.level, level > 0
      ? gameMessage('ур. {level}', 'lvl {level}')
      : gameMessage('не построена', 'not built'), { level });
    row.effect.textContent = BUILDINGS[id].effect(level);
    const max = buildingMaxLevel(id);
    if (level < max) {
      setGameText(row.next, gameMessage(
        'Следующий уровень · {effect}',
        'Next level · {effect}',
      ), { effect: BUILDINGS[id].effect(level + 1) });
      row.next.style.display = '';
    } else {
      clearGameText(row.next);
      row.next.textContent = '';
      row.next.style.display = 'none';
    }
    this.syncCostChips(row.costs, camp, id, level + 1, level < max);
    row.barWrap.style.display = 'none';
    row.button.dataset['mode'] = 'upgrade';
    setGameText(row.button, level > 0 ? gameMessage('Улучшить', 'Upgrade') : gameMessage('Построить', 'Build'));
    row.button.disabled = block !== 'ok';
    if (block === 'ok' || block === 'resources') {
      const seconds = buildingSeconds(id, level + 1);
      setGameText(row.status, seconds === 0
        ? gameMessage('Сразу', 'Immediately')
        : gameMessage('{duration}', '{duration}'), { duration: gameDuration(seconds) });
    } else if (block === 'locked') setGameText(row.status, gameMessage(
      'Нужно Жильё ур. {level}',
      'Requires Housing lvl {level}',
    ), { level: BUILDINGS[id].unlockHq });
    else setGameText(row.status, UPGRADE_REASON_MESSAGE[block]);
  }

  /** Лист кладовой (§13.6): занятость и карточка сундука. */
  private syncStore(camp: CampState): void {
    const used = storeUsed(camp);
    const cap = storeCapacity(camp);
    setGameText(this.storeLevel, gameMessage(
      'Занято {used} из {capacity}',
      '{used} of {capacity} used',
    ), { used, capacity: cap });
    this.storeBar.style.width = `${Math.min(100, (used / Math.max(1, cap)) * 100).toFixed(1)}%`;
    // Три ступени, как у «хорошо/плохо» всей игры: зелёная — место есть,
    // жёлтая с четырёх пятых — «пора строить сундук» говорится до потери
    // добычи, красная — приток стоит (в том числе перебор старого сейва).
    this.storeBar.className = used >= cap ? 'bad' : used >= cap * 0.8 ? 'warn' : 'good';
    for (const [kind, value] of this.commodityValues) {
      value.textContent = String(camp.resources[kind] ?? 0);
    }

    const block = chestBlock(camp);
    setGameText(this.chestName, camp.chests.length > 0
      ? gameMessage('Сундук ×{count}', 'Chest ×{count}')
      : gameMessage('Сундук', 'Chest'), { count: camp.chests.length });
    setGameText(this.chestEffect, gameMessage(
      'Кладовая +{bonus} за каждый',
      'Storage +{bonus} each',
    ), { bonus: CHEST_BONUS });
    this.chestButton.disabled = block !== 'ok';
    if (block === 'ok' || block === 'resources') setGameText(this.chestStatus, gameMessage(
      'дерево {wood}',
      'wood {wood}',
    ), { wood: CHEST_COST.wood ?? 0 });
    else setGameText(this.chestStatus, CHEST_REASON_MESSAGE[block]);
  }

  /** Снаряжение. Компромисс слота показывается всегда, а не только когда
   *  предмет надет: §14 требует, чтобы цена была видна до покупки. */
  private syncGear(camp: CampState): void {
    const open = camp.levels.forge > 0;
    this.gearSection.style.display = open ? '' : 'none';
    if (!open) return;
    for (const slot of GEAR_ORDER) {
      const row = this.gearRows.get(slot);
      if (row === undefined) continue;
      const level = camp.gear[slot];
      const block = gearBlock(camp, slot);
      // Левая рука показывает то, что в ней сейчас: слот кован один, а вещи
      // в нём две (§14.2), и значок обязан спрашивать у руки, а не у слота.
      const kind = slot === 'torch' ? camp.offhand : slot;
      if (row.pic !== undefined) {
        const src = this.cb.gearIcon(kind, level);
        // Присваивание сравнивается: одинаковый `data:`-URL, положенный
        // заново, заставляет браузер перерисовывать картинку каждый тик.
        if (src !== '' && row.pic.getAttribute('src') !== src) row.pic.src = src;
        row.pic.style.display = src === '' ? 'none' : '';
        // Не выкованное показано тем же силуэтом, но погашенным: слот,
        // у которого нет картинки вовсе, читается сломанным, а не пустым.
        row.pic.classList.toggle('empty', level === 0);
      }
      setGameText(row.level, level > 0
        ? gameMessage('ур. {level} / {max}', 'lvl {level} / {max}')
        : gameMessage('—', '—'), { level, max: itemCap(camp.levels.forge) });
      row.effect.textContent = `${gearLine(slot, level)} · ${GEAR[slot].tradeoff}`;
      setGameText(row.button, level > 0 ? gameMessage('Улучшить', 'Upgrade') : gameMessage('Выковать', 'Forge'));
      row.button.disabled = block !== 'ok';
      if (block === 'ok' || block === 'resources') setGameText(
        row.status,
        gameMessage('{price}', '{price}'),
        { price: this.gearCostLine(level + 1) },
      );
      else setGameText(row.status, GEAR_REASON_MESSAGE[block]);
    }
  }

  /* ---------- онбординг ---------- */

  /** Кадр онбординга. 'done' возвращает лагерь в обычный вид. */
  setOnboarding(step: OnbStep): void {
    if (this.onb === step) return;
    this.onb = step;
    // §16.2 — на кадре `world` карта открыта одним местом: игрок не видел
    // ни боя, ни ран, и «выбирай из двадцати» здесь не выбор, а рулетка.
    // Место называет `firstRaidNode`, а не карта: она про кадры не знает.
    if (step === 'world' && this.last !== null) {
      this.map.setOnly(firstRaidNode(dayAt(this.last.now), this.last.now));
    } else if (step !== 'world') {
      this.map.setOnly(null);
    }
    // Кадры 9 и 10 сами решают, что открыто: на экране ровно одно действие.
    // Оба последних кадра говорят одной карточкой — Мастерской: сначала она
    // просит камень, потом показывает, что на него куплено. Разводить их
    // по разным разделам значило бы прятать ответ на вопрос, который кадр
    // только что задал.
    // Карточка Мастерской открывается и на живом переходе, и на загрузке.
    // Прежде на загрузке она не открывалась — «самооткрытие читалось
    // поломкой», — но тихий кадр прячет нижнюю строку, а Мастерской в сцене
    // поляны ещё нет: сейв, перезагруженный посреди кадра, оставался вовсе
    // без действия. Открытая карточка здесь — не самодеятельность, а сам
    // кадр: оба последних кадра и есть её содержимое. Повторные входы
    // в лагерь ре-открытием не грозят: смена кадра проверяется выше.
    if (step === 'build' || step === 'craft') this.openSheet('forge');
    else if (step === 'done') this.close();
  }

  /**
   * Два последних кадра раскадровки: Мастерская просит камень, потом
   * показывает ковку. Ни нижней строки, ни кнопки «Закрыть»: закрывать
   * нечего, действие ровно одно.
   */
  private applyOnboarding(): void {
    /*
     * «Тихий» кадр прячет нижнюю строку, чтобы на экране осталось ровно одно
     * действие. На кадре `build` это можно делать только тогда, когда это
     * действие вправду есть: Мастерская теперь стоит камня, и первой вылазки
     * на неё хватает не всем (замер: четырём из пяти). Тому, кому не хватило,
     * спрятанная строка запирает единственный выход — вторую вылазку.
     *
     * Поэтому строка прячется по кошельку, а не по номеру кадра.
     */
    const affordable =
      this.last !== null && upgradeBlock(this.last.camp, 'forge') === 'ok';
    /*
     * У кадра `craft` тот же капкан, и он злее: ковать нечем по построению —
     * первый предмет стоит железа, а ярус 1 ещё заперт Кухней (§13.5).
     * Спрятанная строка отняла бы «В мир», то есть единственный путь
     * к торговцу, у которого это железо и берут. Кадр молчит только тогда,
     * когда ковка вправду доступна.
     */
    const canForge =
      this.last !== null && GEAR_ORDER.some((slot) => gearBlock(this.last!.camp, slot) === 'ok');
    const quiet = (this.onb === 'build' && affordable) || (this.onb === 'craft' && canForge);

    // Подсказка кадра держится, пока кадр не сменится, — но не поверх
    // сообщения: сообщение живёт секунды, кадр живёт до следующего кадра.
    // Кадр без подсказки не оставляет чужую: на `done` онбординг кончился,
    // и последняя его строка не имеет права висеть до конца игры.
    this.line.setSticky(ONB_HINT[this.onb] ?? '');
    this.banner.textContent = this.line.text;

    this.bar.style.display = quiet ? 'none' : '';
    // Значок подарка (§29) уходит вместе с нижней строкой и по той же
    // причине: тихий кадр оставляет на экране ровно одно действие, и второе,
    // сколь угодно бесплатное, отменяет весь кадр.
    this.daily.icon.style.display = quiet ? 'none' : '';
    this.sheetClose.style.display = quiet ? 'none' : '';
    if (quiet) this.moveButton.style.display = 'none';

    // Цену кадр не переписывает и подарка не делает: Мастерская стоит камня,
    // и обычная строка цены (`priceLine`) называет его сама. Прежний кадр
    // подменял здесь кнопку на «Построить · бесплатно» — бесплатных зданий
    // в игре больше нет ни одного.
    //
    // Кадр держится за постройку, а не за экран: игрок, ушедший во вторую
    // вылазку за недостающим камнем, возвращается на тот же кадр.
  }

  /* ---------- мелочи ---------- */

  /**
   * Кем идут: стрелок или ближник. Меняет только то, показывать ли колчан —
   * §14.3 у ближника не значит ничего, и строка «Стрелы 0 / 2» у Рыцаря
   * была бы обещанием механики, которой у него нет.
   */
  setRanged(ranged: boolean): void {
    if (this.ranged === ranged) return;
    this.ranged = ranged;
    this.paintOpen();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  /** Виден ли лагерный интерфейс. Спрашивает вёрстку, а не свой флаг:
   *  второй флаг рядом с `display` разошёлся бы с ним молча. */
  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Сказать игроку строку. Строки не спорят за одно поле, а становятся
   * в очередь (`banner.ts`): пришедшие в один тик показываются по очереди,
   * а не последней выигравшей.
   */
  notify(text: string): void {
    this.line.push(text);
    this.banner.textContent = this.line.text;
  }

  /** Одноразовая мягкая задача после событий, пришедших не от прямого тапа. */
  suggestWorld(text: string): void {
    this.taskNudge = { kind: 'world', text };
    if (this.last !== null) this.syncTask(this.last.camp);
  }

  /**
   * Ведущая сюжетная цель. Она пользуется той же одной строкой лагеря, что
   * хозяйственные задачи, но переживает открытие карты и перезапуск: источник
   * правды — сохранённый шаг главы, сюда приезжает только видимый текст.
   */
  setStoryTask(text: string | null): void {
    if (this.storyTask === text) return;
    this.storyTask = text;
    if (this.last !== null) this.syncTask(this.last.camp);
  }

  /**
   * Цена строкой. Второй довод — готовая цена: у палатки её нет в лестнице
   * `BUILD_COST`, а строка обязана выглядеть той же, что у зданий, — иначе
   * два ценника в одном лагере читаются двумя разными валютами.
   */
  private costLine(level: number, ready?: Partial<Resources>): string {
    const cost = ready ?? BUILD_COST[level];
    if (cost === undefined) return '';
    return (Object.entries(cost) as [ResourceKind, number][])
      .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${amount}`)
      .join(' · ');
  }

  private gearCostLine(level: number): string {
    const cost = GEAR_COST[level];
    if (cost === undefined) return '';
    return (Object.entries(cost) as [ResourceKind, number][])
      .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${amount}`)
      .join(' · ');
  }

  /** Итог вылазки: что зачислено на склад. */
  static resourceSummary(res: Resources): string {
    const order: readonly ResourceKind[] = [...RESOURCE_ORDER, 'meat', 'pelt'];
    const parts = order.filter((k) => (res[k] ?? 0) > 0).map(
      (k) => `${RESOURCE_NAME[k]} ${res[k] ?? 0}`,
    );
    return parts.length > 0 ? parts.join(' · ') : 'пусто';
  }
}
