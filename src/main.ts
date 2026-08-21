import './style.css';
import { Clock } from './core/clock';
import { loadMix } from './core/settings';
import { startLoop } from './core/loop';
import {
  bindPageAudio,
  play,
  startAmbient,
  setMix,
  startCampTune,
  startPulse,
  stopAmbient,
  stopCampTune,
  stopPulse,
} from './core/audio';
import {
  BUILDINGS,
  BUILD_SECONDS,
  campArea,
  completeIfDue,
  craftGear,
  gearBlock,
  moveBuilding,
  speedup,
  speedupCost,
  startUpgrade,
  upgradeBlock,
} from './sim/camp';
import type { BuildingId, CampState } from './sim/camp';
import { GEAR, MAX_ITEM_LEVEL } from './sim/gear';
import type { GearSlot } from './sim/gear';
import { visionRadius } from './sim/config';
import {
  HERO_CLASSES,
  activeHero,
  applyRaidOutcome,
  firstReady,
  loadout,
  raidBlock,
  refreshHeroes,
  selectHero,
  startTraining,
  syncRoster,
  trainBlock,
} from './sim/heroes';
import type { HeroClassId, HeroLoadout, HeroState, Roster } from './sim/heroes';
import { ONB_HINT, firstTapCell, grantLevelOffBooks, reveal } from './sim/onboarding';
import type { OnbStep } from './sim/onboarding';
import {
  adoptGladeLayout,
  firstGladeCell,
  generateGlade,
  gladeCapacity,
  gladeFood,
  nearCamp,
  restTick,
  CAMP_WOOD,
  KITCHEN_WOOD,
  TENT_WOOD,
  UPGRADE_WOOD,
  siteBlock,
} from './sim/prologue';
import {
  aimChop,
  chopBlock,
  chopProgress,
  isEdge,
  stepChop,
  treeAt,
} from './sim/logging';
import type { Chop } from './sim/logging';
import {
  MINE_STONE,
  aimMine,
  mineBlock,
  mineProgress,
  standNear,
  startMine,
  stepMine,
  stepMineInto,
  stoneAt,
} from './sim/stones';
import type { Stone } from './sim/stones';
import { idx } from './sim/grid';
import { inReach } from './sim/work';
import type { Work, WorkBlock } from './sim/work';
import { commandMove, createRaid, raidResult, stepRaid, useSkill } from './sim/raid';
import type { RaidState } from './sim/raid';
import { CONSUMABLES, buyConsumable, refundConsumable } from './sim/consumables';
import type { ConsumableId } from './sim/consumables';
import { RESOURCE_NAME, addResources, emptyResources } from './sim/resources';
import { load, save, wipe } from './sim/save';
import { KIND, dayAt, lootMul, nodeSeed, regionAt, shiftAt, worldAt } from './sim/world';
import { BuildPanel } from './ui/buildPanel';
import {
  campNav,
  commandCampMove,
  createCampHero,
  stepCampHero,
  type CampHero,
  type CampNav,
} from './sim/campWalk';
import { topWalkable } from './sim/campTop';
import { CASTLE_CELL, WALK } from './sim/castle';
import {
  completeWallIfDue,
  cycleTower,
  emptyWalls,
  gateBlock,
  nextTowerLevel,
  cycleFence,
  fenceMaterial,
  fencePieces,
  razeWall,
  stairsBlock,
  startTower,
  startWall,
  raiseWall,
  strokeFit,
  toggleGate,
  putStairs,
  wallPieces,
  wallPrice,
  wallSeconds,
  wallSpotOf,
  type WallSite,
  type WallTool,
} from './sim/campWalls';
import type { Spot } from './sim/castle';
import { FENCE } from './sim/fence';
import { atTrader, generateCastleSite, type CastleSite } from './sim/castleSite';
import { archerAt, dwellersAt, garrisonOf, patrolAt } from './sim/garrison';
import { generateGraveSite, readEpitaph } from './sim/graveSite';
import { trade } from './sim/trade';
import type { OfferId } from './sim/trade';
import { TradePanel } from './ui/tradePanel';
import type { GraveSite } from './sim/graveSite';
import { loadTelemetry, track } from './sim/telemetry';
import type { Cell, Tier } from './sim/types';
import { CampView } from './render/campView';
import { CursorWind } from './render/cursorWind';
import { TiltWind } from './render/tiltWind';
import { RaidView } from './render/raidView';
import { SceneRig } from './render/scene';
import { TitleView } from './render/titleView';
import { CampHud } from './ui/campHud';
import { RosterPanel } from './ui/rosterPanel';
import { ReturnScreen } from './ui/returnScreen';
import { StatsPanel } from './ui/statsPanel';
import { CampPrompt } from './ui/campPrompt';
import { SettingsMenu } from './ui/settings';
import { Hud } from './ui/hud';
import { BattleHud } from './ui/battleHud';
import { commandBattle, inBattle } from './sim/raid';
import { current, moves, targets, unitAt } from './sim/battle';
import { worldToHex, hexKey, hexToWorld } from './sim/hex';
import { StartScreen } from './ui/startScreen';
import { installBench } from './features/bench';
import { bindCampInput } from './features/campInput';
import { createDirector } from './features/onboarding';
import { panelsFor, soundFor } from './features/scene';
import type { Scene } from './features/scene';
import { createRaidEar } from './features/raidAudio';

const app = document.getElementById('app');
if (app === null) throw new Error('нет #app');

/* ---------- состояние ---------- */
const loaded = load();
const clock = new Clock(loaded.watermark);
let camp: CampState = loaded.camp;
const roster: Roster = loaded.roster;

loadTelemetry();
// §9 — время до возвращения в игру после установки таймера. Меряется только
// там, где таймер реально шёл: иначе это просто «как часто заходят».
const startedAt = clock.now();
track({
  t: 'session_start',
  at: startedAt,
  awaySec: loaded.watermark > 0 ? Math.max(0, startedAt - loaded.watermark) : 0,
  timerLeftSec:
    camp.construction === null ? null : Math.max(0, camp.construction.endsAt - startedAt),
});

const finishedOffline = completeIfDue(camp, startedAt); // стройка могла закончиться без нас
if (finishedOffline !== null) {
  track({ t: 'build_done', at: startedAt, building: finishedOffline, level: camp.levels[finishedOffline] });
}

let mode: 'title' | 'camp' | 'raid' = 'title';
let raid: RaidState | null = null;
let titleView: TitleView | null = null;
/** Герой, который сейчас в локации: раны и опыт зачисляются ему. */
let raidHero: HeroState | null = null;
/** Место на карте, в котором идёт вылазка (§4). Экран возврата зовёт обратно
 *  в него же — пока в нём есть что брать. */
let raidNode = 0;
let raidView: RaidView | null = null;
/**
 * Идёт пролог. Отдельного режима у него нет: поляна ходится теми же
 * правилами, что вылазка, и отличается тем, чем кадр кончается — не
 * возвращением, а нулём провианта.
 */
let inGlade = false;
/**
 * Начата новая игра. Сейв уже стёрт, но страница ещё жива: до перезагрузки
 * цикл успевает вызвать persist и записать прежний кадр обратно — и «Новая
 * игра» возвращала туда же, откуда её нажали, вместо заставки.
 */
let wiped = false;
/**
 * Что сейчас ставится на поляну; null — режима выбора места нет.
 * Порядок один и жёсткий: сначала палатка, потом костёр. Очаг ставит тот,
 * кто уже решил остаться, — значит, крыша идёт первой.
 */
let placing: BuildingId | null = null;
const PITCH_ORDER: readonly BuildingId[] = ['hq', 'kitchen'];
const PITCH_HINT: Partial<Record<BuildingId, string>> = {
  hq: 'Выберите место для палатки',
  kitchen: 'Теперь костёр',
};
/** Клетки, уже занятые зданиями лагеря. */
const pitched: Cell[] = [];
/** Сколько брусков собрано на поляне. Хранится затем, чтобы кольцо
 *  подсказки переезжало на следующий брусок в момент подбора, а не
 *  пересчитывалось каждый кадр. */
let gladeTaken = -1;
/** Недостоянные у лагеря секунды (`restTick`). Обнуляются, стоит отойти. */
let restAcc = 0;
/** Палатка поднята до второго уровня — пролог отработал. */
let upgraded = false;
/** Герой отдыхает у лагеря: провиант кончился и ещё не набран. */
let resting = false;
/**
 * Начатая рубка (§13.3): какое дерево валят и сколько осталось. Живёт здесь,
 * а не в `RaidState`, по той же причине, что и выбор места под здание: шаг
 * вылазки обязан оставаться тем же самым и в замере, и у бота, где топора
 * нет вовсе.
 */
let chop: Chop | null = null;
/**
 * Начатая добыча (§13.5): по какому валуну бьют и сколько осталось. Живёт
 * здесь по той же причине, что и рубка, — шаг вылазки обязан оставаться
 * тем же самым и у бота, где кайла нет вовсе.
 */
let mine: Work | null = null;
/** То же в лагере: там рюкзака нет, и камень идёт прямо в кладовую. */
let campMine: { work: Work; stone: Stone } | null = null;

/**
 * Что сказать игроку строкой вылазки. Не подсказка, а событие: строка
 * гаснет сама через 2,5 секунды и возвращает прежнюю — тот же канал, что
 * у «Рюкзак полон — контейнер не вскрыт» (`raid.ts`). Копится до шага,
 * потому что события вылазки чистятся в начале каждого тика, а тап
 * приходит между тиками.
 */
let sayNext: string | null = null;
const say = (text: string): void => {
  sayNext = text;
};

/** Почему рубить нельзя — словами игрока. Отказ обязан называть причину:
 *  молчащий отказ читается как поломка (§16.1). */
const CHOP_DENY: Record<WorkBlock, string> = {
  ok: '',
  off: 'Здесь не лес — рубить нечего',
  gone: 'Дерева здесь больше нет',
  far: 'К этому дереву не подойти',
  bag: 'Рюкзак полон — дерево некуда класть',
};

/** То же для кайла (§13.5). Словарь причин общий, слова — свои: игрок
 *  видит камень, а не «работу по клетке». */
const MINE_DENY: Record<WorkBlock, string> = {
  ok: '',
  off: 'Здесь нечего добывать',
  gone: 'Камня здесь больше нет',
  far: 'К этому камню не подойти',
  bag: 'Рюкзак полон — камень некуда класть',
};

/** Что сейчас написано в строке подсказки пролога. Сравнение затем, чтобы
 *  не переписывать одну и ту же строку шестьдесят раз в секунду. */
let gladeHint = '';
let resultShown = false;
/** camp.html: лагерь замирает через 20 секунд без касаний. */
let idleSeconds = 0;
let lastCampFrame = 0;
let selected: BuildingId | null = null;

/**
 * Отладка, а не механика — как ползунок «Ночь». Плотность травы меряется
 * ползунком и задаётся в адресе (?grass=N), чтобы замер повторялся.
 */
const debugParams = new URLSearchParams(location.search);
let grassPerTile = Number(debugParams.get('grass') ?? 24);
if (!Number.isFinite(grassPerTile)) grassPerTile = 24;
grassPerTile = Math.max(0, Math.min(64, Math.round(grassPerTile)));
const seedParam = Number(debugParams.get('seed'));
const debugSeed = Number.isFinite(seedParam) && debugParams.has('seed') ? seedParam | 0 : null;

/**
 * Кем идём в вылазку. Выбранный герой может быть занят (ушёл лечиться,
 * пока игрок был в лагере) — тогда берём первого готового, а не блокируем
 * кнопку: §11.8 вводил ротацию затем, чтобы простой не останавливал игру.
 */
function heroForRaid(): HeroState | null {
  const chosen = activeHero(roster);
  if (raidBlock(chosen) === 'ok') return chosen;
  return firstReady(roster);
}

// Громкость из прошлой сессии — до первого звука (§18.5). Настройки лежат
// отдельно от сейва и переживают «Новую игру»: выключенный звук не должен
// включаться сам.
setMix(loadMix());
bindPageAudio();

const rig = new SceneRig(app);
const campView = new CampView(camp);
rig.world.add(campView.group);

/* ---------- HUD ---------- */
const hud = new Hud(app, {
  onRotate: (steps) => rig.rotate(steps),
  onZoom: (delta) => rig.zoom(delta),
  onEvacuate: () => {
    if (raid !== null && raid.status === 'running') {
      commandMove(raid, raid.loc.evac);
      raidView?.showMarker(raid.loc.evac.x, raid.loc.evac.z);
    }
  },
  onNight: (value) => {
    rig.night = value;
  },
  onGrass: (perTile) => {
    grassPerTile = perTile;
    raidView?.setGrassDensity(perTile);
  },
  onSkill: () => {
    if (raid === null) return;
    if (useSkill(raid)) track({ t: 'skill', at: clock.now(), skill: raid.loadout.skill, tier: raid.loc.tier });
  },
});

const campHud = new CampHud(app, {
  onUpgrade: (id) => {
    // Кадр «поставьте Мастерскую» идёт обычной стройкой, без подарка.
    // Дарить и нечего: жильё, Кухня и Склад стоят с ур. 1 из `createCamp`,
    // а палатку и костёр игрок уже оплатил деревом на поляне. Мастерская —
    // четвёртое здание и первое, у которого есть ценник; платит он камнем,
    // за которым и ходил, и цена уходит со счётчика у него на глазах.
    //
    // Мгновенность при этом осталась: у первого уровня нет таймера (§20.2),
    // и ждать игрока на этом кадре ещё никто не учил.
    if (onboarding.step === 'build' && id === 'forge') {
      if (!beginUpgrade(id)) return;
      onboarding.set('craft');
      return;
    }
    // Отказ обязан быть слышен: молчащая кнопка читается как поломка.
    beginUpgrade(id);
  },
  onBuyConsumable: (id) => buy(id),
  onRefundConsumable: (at) => {
    if (refundConsumable(camp, at)) persist();
  },
  onSpeedup: () => {
    const now = clock.now();
    const c = camp.construction;
    if (c === null) return;
    const left = Math.max(0, c.endsAt - now);
    const cost = speedupCost(left, c.endsAt - c.startedAt);
    if (!speedup(camp, now)) return;
    track({ t: 'speedup', at: now, building: c.building, cost, leftSec: left });
    persist();
  },
  onRaid: (node) => {
    // Первая вылазка: место игрок выбрал на карте сам, и кадр трогается
    // отсюда, а не из локации — в локацию он уже приезжает начатым.
    if (onboarding.step === 'world') onboarding.set('move');
    // Вторая вылазка — конец раскадровки: дальше игра работает как обычно.
    // Кадр `craft` кончается первой ковкой, а не входом в вылазку: она и есть
    // то, ради чего Мастерская строилась. Раньше он висел до следующего входа,
    // то есть до того, как игрок сделает обещанное.
    toRaid(node);
  },
  onCraft: (slot) => forge(slot),
  // §20.4 — карточка вооружает перестановку, дальше игрок бьёт по клетке.
  onMove: (id) => {
    selected = id;
    campView.highlight(selected);
    campHud.notify(`${BUILDINGS[id].name}: коснитесь свободного места`);
  },
  onWalls: () => openWalls(),
});

/* ---------- стройка стен (§6.1.6) ---------- */

/**
 * Панель стройки вооружает сцену: пока карточка выбрана, палец строит,
 * а не крутит камеру. Это решение, а не упущение — рисовать и одновременно
 * возить камеру одним пальцем нельзя, а «Готово» возвращает камеру сразу.
 */
const buildPanel = new BuildPanel({
  onTool: (tool) => {
    buildTool = tool;
    campView.hideWallGhost();
    stroke = null;
  },
  onDone: () => {
    buildPanel.setVisible(false);
    buildTool = null;
    campView.hideWallGhost();
    persist();
  },
  // Материал ограды перебирается тапом по уже выбранной карточке: он общий
  // на весь лагерь, поэтому меняет и то, что уже стоит.
  onCycleFence: () => {
    const material = cycleFence(wallsOf());
    refreshWalls();
    campHud.notify(`Ограда: ${FENCE[material].title.toLowerCase()}`);
    persist();
  },
});
campHud.slot.appendChild(buildPanel.root);

/** Герой лагеря: он же тот, кто ходил по поляне в прологе (§16.1). */
let campHero: CampHero = createCampHero(camp);

let buildTool: WallTool | null = null;
/** Клетки, через которые ведут палец. Не null — мазок идёт прямо сейчас. */
let stroke: Spot[] | null = null;

const wallsOf = (): NonNullable<typeof camp.walls> => (camp.walls ??= emptyWalls());

/** Клетки стены, по верху которых ходят: их спрашивает лестница. */
const topsOf = (): ReadonlySet<string> => {
  const nav = campNav(camp);
  const out = new Set<string>();
  for (let z = 0; z < nav.top.grid; z++) {
    for (let x = 0; x < nav.top.grid; x++) if (topWalkable(nav.top, { x, z })) out.add(`${x}:${z}`);
  }
  return out;
};
const wallSite = (): WallSite => ({
  area: campArea(camp.levels.hq),
  layout: camp.layout,
  levels: camp.levels,
});

function openWalls(): void {
  buildPanel.setVisible(true);
  buildPanel.update(wallsOf(), clock.now());
  campHud.notify('Стены: выберите карточку, дальше жест по земле');
}

/** Перерисовать стены и обновить счётчики панели. */
function refreshWalls(): void {
  campView.setWalls(wallPieces(wallsOf()));
  campView.setFences(fencePieces(wallsOf()));
  buildPanel.update(wallsOf(), clock.now());
}

/** Тап или мазок по земле в режиме стройки. Возвращает: жест обработан. */
function buildAt(hit: { x: number; z: number }, finished: boolean): boolean {
  if (buildTool === null) return false;
  const walls = wallsOf();
  const site = wallSite();
  const spot = wallSpotOf(Math.round(hit.x), Math.round(hit.z));
  // Слот один на лагерь: стена и улучшение здания спорят за одно и то же.
  const busy = camp.construction !== null;

  if (buildTool === 'стена' || buildTool === 'ограда') {
    const tool = buildTool;
    if (stroke === null) stroke = [];
    const last = stroke[stroke.length - 1];
    if (last === undefined || last.x !== spot.x || last.z !== spot.z) stroke.push(spot);
    if (!finished) {
      // Призрак ведётся по тем же клеткам, которые встанут: показывать одно,
      // а строить другое — худший вид обмана в стройке.
      const fit = new Set(strokeFit(walls, site, stroke, tool).map((s) => `${s.x}:${s.z}`));
      campView.showWallGhost(stroke.map((s) => ({ spot: s, ok: fit.has(`${s.x}:${s.z}`) })));
      // Счёт ведётся вместе с мазком: цену игрок обязан видеть до того,
      // как отпустит палец, а не после.
      const material = fenceMaterial(walls);
      const cost = wallPrice(tool, fit.size, material);
      const paid = cost.wood !== undefined ? `${cost.wood} дерева` : `${cost.stone ?? 0} камня`;
      const minutes = Math.round(wallSeconds(tool, fit.size) / 6) / 10;
      buildPanel.setNote(
        fit.size === 0
          ? `Здесь ${tool === 'ограда' ? 'ограде' : 'стене'} не встать`
          : `${fit.size} кл. · ${paid} · ${minutes} мин`,
      );
      return true;
    }
    const cells = strokeFit(walls, site, stroke, tool);
    stroke = null;
    campView.hideWallGhost();
    return finishWall(startWall(walls, camp.resources, tool, cells, clock.now(), busy));
  }

  if (!finished) return true;

  if (buildTool === 'башня') {
    // Снять башню — не стройка: она разбирается сносом, как и всё остальное.
    if (nextTowerLevel(walls, spot) === null) return finishWall('Выше некуда: снимите сносом');
    return finishWall(startTower(walls, site, camp.resources, spot, clock.now(), busy));
  }
  if (buildTool === 'ворота') {
    const why = gateBlock(walls, spot);
    if (why !== 'ok') return finishWall(`Ворота: ${why}`);
    return finishWall(startWall(walls, camp.resources, 'ворота', [spot], clock.now(), busy));
  }
  if (buildTool === 'лестница') {
    const tops = topsOf();
    const why = stairsBlock(walls, site, spot, tops);
    if (why !== 'ok') return finishWall(`Лестница: ${why}`);
    return finishWall(startWall(walls, camp.resources, 'лестница', [spot], clock.now(), busy));
  }

  // Снос мгновенный и с возвратом камня: сносить — не строить, и трогать
  // планировку не должно стоить дороже, чем не трогать её.
  if (!razeWall(walls, spot, camp.resources)) return finishWall('Здесь ничего не стоит');
  play('build');
  buildPanel.setNote(null);
  refreshWalls();
  campHud.sync(camp, clock.now(), 0);
  persist();
  return true;
}

/** Общий хвост стройки: отказ называет причину, успех занимает слот. */
function finishWall(result: string): boolean {
  if (result !== 'ok') {
    play('deny');
    buildPanel.setNote(result === 'слот занят' ? 'Слот занят другой стройкой' : result);
    return true;
  }
  play('build');
  buildPanel.setNote(null);
  buildPanel.update(wallsOf(), clock.now());
  campHud.sync(camp, clock.now(), 0);
  persist();
  return true;
}

const rosterPanel = new RosterPanel(campHud.slot, {
  onSelect: (index) => {
    const hero = roster.heroes[index];
    if (hero === undefined) return;
    if (raidBlock(hero) !== 'ok') {
      campHud.notify(`${HERO_CLASSES[hero.cls].name} занят`);
      return;
    }
    selectHero(roster, index);
    persist();
  },
  onTrain: (index) => {
    const hero = roster.heroes[index];
    if (hero === undefined) return;
    const block = trainBlock(roster, hero);
    if (block !== 'ok') {
      campHud.notify(`${HERO_CLASSES[hero.cls].name}: ${TRAIN_REASON[block] ?? 'нельзя тренировать'}`);
      return;
    }
    startTraining(roster, hero, clock.now());
    track({ t: 'train_start', at: clock.now(), cls: hero.cls, level: hero.level });
    persist();
  },
});

const TRAIN_REASON: Record<string, string> = {
  cap: 'потолок — на два уровня ниже лучшего',
  busy: 'занят',
  'slot-busy': 'тренировочный слот занят',
  max: 'максимальный уровень',
};

const BLOCK_REASON: Record<string, string> = {
  max: 'максимальный уровень',
  'hq-cap': 'выше Жилья нельзя',
  'slot-busy': 'слот занят другой стройкой',
  resources: 'не хватает ресурсов',
  ok: 'не вышло',
};

function upgradeReason(state: CampState, id: BuildingId): string {
  return BLOCK_REASON[upgradeBlock(state, id)] ?? 'не вышло';
}

const GEAR_REASON: Record<string, string> = {
  'no-forge': 'нужна Мастерская',
  max: 'лучше не бывает',
  'forge-cap': 'Мастерская не тянет выше',
  resources: 'не хватает железа',
  ok: 'не вышло',
};

/**
 * §20.1 — ковка. В отличие от стройки, она мгновенна и не занимает слот:
 * это и есть то действие, которое экран возврата предлагает, пока идёт таймер.
 */
function forge(slot: GearSlot): boolean {
  const block = gearBlock(camp, slot);
  if (!craftGear(camp, slot)) {
    campHud.notify(`${GEAR[slot].name}: ${GEAR_REASON[block] ?? 'не вышло'}`);
    return false;
  }
  const level = camp.gear[slot];
  track({ t: 'craft', at: clock.now(), slot, toLevel: level });
  // Раскадровка кончается здесь: игрок сковал первое, что обещала Мастерская.
  if (onboarding.step === 'craft') onboarding.set('done');
  campHud.notify(`${GEAR[slot].name} ур. ${level}`);
  persist();
  return true;
}

const startScreen = new StartScreen(app, {
  // До лагеря игрок доходит сам: кнопка открывает поляну, а лагерь
  // появляется в конце пролога как его результат.
  onPlay: () => (onboarding.step === 'glade' ? toGlade() : toCamp()),
});

const campPrompt = new CampPrompt(app, {
  onPitch: () => {
    campPrompt.setVisible(false);
    // Лагерь встаёт прямо здесь. Никакого перехода в отдельную сцену:
    // поляна, по которой игрок только что ходил, и есть место, где он
    // остался, — и первое здание вырастает у него на глазах, а не за
    // загрузочным экраном.
    startPlacing(PITCH_ORDER[0]!);
  },
});

/**
 * Лавка торговца (§13.5). Открывается подходом во дворе замка, гаснет уходом.
 *
 * Обмен ничего не пишет в мир и никуда не ведёт: он меняет только кошелёк,
 * и поэтому сохраняется тем же `persist`, что и всякая трата. Прибавка
 * говорится строкой события — той же, в которой вылазка сообщает о подобранном
 * (§18.1): игрок обязан увидеть, что именно у него прибавилось.
 */
const tradePanel = new TradePanel(app, {
  onTrade: (id: OfferId) => {
    if (!trade(camp, id)) {
      // Отказ обязан быть слышен так же, как виден (§18.3).
      play('deny');
      return;
    }
    play('build');
    track({ t: 'trade', at: clock.now(), offer: id });
    if (raid !== null) raid.events.push(TradePanel.gained(id));
    tradePanel.sync(camp);
    persist();
  },
});

/**
 * Настройки (§18.5). Живут во всех сборках, а не только в дев: громкость
 * нужна игроку, а не разработчику. «Новая игра» переехала сюда же из
 * дев-меню — сейв переживает перезагрузку, и стереть его из консоли нельзя:
 * игра тут же запишет его обратно.
 */
new SettingsMenu(app, {
  onNewGame: () => {
    wiped = true;
    wipe();
    location.reload();
  },
});

const statsPanel = new StatsPanel(app);

function buy(id: ConsumableId): boolean {
  if (!buyConsumable(camp, id)) {
    campHud.notify(`${CONSUMABLES[id].name}: не хватает или слоты заняты`);
    return false;
  }
  track({ t: 'consumable', at: clock.now(), id, phase: 'buy' });
  campHud.notify(`${CONSUMABLES[id].name} — в вылазку`);
  persist();
  return true;
}

function persist(): void {
  if (wiped) return;
  save(camp, roster, clock.watermark, onboarding.step);
}

/**
 * Показ кадра — единственное место, где онбординг что-то показывает или
 * прячет. Полосы включаются здесь, а не в цикле: сравнивать состояние
 * каждый тик значило бы драться с игроком за видимость элементов.
 */
function showOnb(step: OnbStep): void {
  hud.setReveal(reveal(step));
  hud.setHint(ONB_HINT[step] ?? '');
  campHud.setOnboarding(step);
  // Второй акт пролога: кольцо ведёт за деревом, а с полной сумкой —
  // обратно к палатке. Оно и есть весь интерфейс улучшения.
  if (step === 'upgrade' && raid !== null) {
    // Строку подсказки кадр только что переписал своей: пусть второй акт
    // назовёт её заново — отдых и улучшение говорят по обстановке, а не по кадру.
    gladeHint = '';
    const home = pitched[0];
    // Ветки «уже улучшено» здесь нет: улучшение кончает кадр вместе
    // с прологом, и показывать этому кадру больше нечего.
    if (raid.bag.wood >= UPGRADE_WOOD && home !== undefined) {
      raidView?.showHint(home.x, home.z);
    } else {
      const cell = firstGladeCell(raid.loc, raid.hero);
      if (cell !== null) raidView?.showHint(cell.x, cell.z);
      else raidView?.hideHint();
    }
    return;
  }
  // Точка тапа нужна ровно в первом кадре: дальше игрок уже знает жест.
  if ((step === 'glade' || step === 'gather') && raid !== null) {
    const cell = firstGladeCell(raid.loc, raid.hero);
    if (cell !== null) raidView?.showHint(cell.x, cell.z);
    else raidView?.hideHint();
  } else if (step === 'move' && raid !== null) {
    const cell = firstTapCell(raid.loc, raid.hero);
    if (cell !== null) raidView?.showHint(cell.x, cell.z);
  } else {
    raidView?.hideHint();
  }
}

/**
 * Раскадровка (§16) живёт в features/onboarding: кадр, его время, скриптовая
 * рана и счётчик вскрытого — там. Здесь остаётся показ и то, что смена кадра
 * значит для сессии.
 */
const onboarding = createDirector(loaded.onboarding, {
  now: () => clock.now(),
  show: showOnb,
  shake: () => shake(),
  changed: (step) => {
    track({ t: 'onboarding', at: clock.now(), step });
    persist();
  },
});

/** Экран коротко дёргается на ране. Заведено кадром 3 онбординга, теперь
 *  зовётся на каждой ране вылазки: §11.3 считает раны штуками, и каждая
 *  обязана быть замечена телом, а не только глазом. */
function shake(): void {
  const canvas = rig.renderer.domElement;
  canvas.classList.remove('shake');
  // Пересчёт стилей между снятием и возвратом класса — иначе вторая
  // анимация подряд не запускается вовсе.
  void canvas.offsetWidth;
  canvas.classList.add('shake');
}

/**
 * §11.3 — панель боя. Кнопок три, и хода среди них нет: ходят тапом
 * по гексу, тем же жестом, каким ходят по локации (§6).
 */
const battleHud = new BattleHud(app, {
  onAttack: () => heroAttack(),
  onGuard: () => { if (raid !== null) commandBattle(raid, { kind: 'guard' }); },
  onWait: () => { if (raid !== null) commandBattle(raid, { kind: 'wait' }); },
});

/** Ударить того, кого достаём. Если целей несколько — самого израненного:
 *  добить дешевле, чем начать нового, и это же правило у бота. */
function heroAttack(): void {
  if (raid === null || raid.battle === null) return;
  const unit = current(raid.battle);
  if (unit === undefined || unit.side !== 'hero') return;
  const list = targets(raid.battle, raid.loc.size, raid.loc.blocked, unit);
  if (list.length === 0) return;
  const weakest = list.reduce((a, b) => (a.hp <= b.hp ? a : b));
  commandBattle(raid, { kind: 'attack', target: weakest.id });
}

const returnScreen = new ReturnScreen(app, {
  onBuyConsumable: (id) => {
    buy(id);
    returnScreen.hide();
    toCamp();
  },
  onBuild: (id) => {
    beginUpgrade(id);
    returnScreen.hide();
    toCamp();
  },
  onCraft: (slot) => {
    forge(slot);
    returnScreen.hide();
    toCamp();
  },
  onRaid: (node) => {
    returnScreen.hide();
    toRaid(node);
  },
  onCamp: () => {
    returnScreen.hide();
    // Кадр 9 начинается ровно здесь: лагерь открывается как награда.
    if (onboarding.step === 'return') onboarding.set('build');
    toCamp();
  },
});

function beginUpgrade(id: BuildingId): boolean {
  const now = clock.now();
  if (!startUpgrade(camp, id, now)) {
    // Отказ обязан быть слышен так же, как виден (§18.3).
    play('deny');
    campHud.notify(`${BUILDINGS[id].name}: ${upgradeReason(camp, id)}`);
    return false;
  }
  const toLevel = camp.levels[id] + 1;
  track({ t: 'build_start', at: now, building: id, toLevel, seconds: BUILD_SECONDS[toLevel] ?? 0 });
  play('build');
  campHud.notify(`${BUILDINGS[id].name}: стройка началась`);
  persist();
  return true;
}

/**
 * Вернувшийся герой ранен и занят лечением (§3) — на этом и держится
 * потребность в ротации. Опыт начисляется от вынесенного, а не от времени
 * в локации: иначе выгодно бродить, а не решать.
 */
function finishRaidForHero(
  state: RaidState,
  carried: number,
  evacuated: boolean,
  now: number,
): void {
  const hero = raidHero;
  raidHero = null;
  if (hero === null) return;

  const name = HERO_CLASSES[hero.cls].name;
  const outcome = applyRaidOutcome(
    hero,
    state.hero.hp,
    carried,
    state.loc.tier,
    evacuated,
    now,
  );
  if (outcome.levels > 0) campHud.notify(`${name}: уровень ${hero.level}`);
  if (outcome.healSec > 0) {
    track({ t: 'heal_start', at: now, cls: hero.cls, wounds: outcome.wounds, seconds: outcome.healSec });
    campHud.notify(`${name} ранен — Лазарет ${RosterPanel.healText(outcome.wounds)}`);
  }
}

/* ---------- звук (§18) ---------- */

/**
 * Ухо вылазки (features/raidAudio): симуляция событий для звука не выдаёт,
 * ухо само сравнивает состояние с прошлым тиком и озвучивает разницу.
 */
const ear = createRaidEar();

/* ---------- переходы между сценами ---------- */

/**
 * Показать сцену: панели и звук берутся из таблицы (features/scene), а не
 * раскладываются в каждом переходе заново. Переход после этого говорит
 * только то, что относится к нему одному, — что построить, куда навести
 * камеру и что записать.
 */
function showScene(scene: Scene, tier: Tier = 0): void {
  // Панель стройки живёт только в лагере: оставшись открытой, она вооружала бы
  // палец поверх вылазки.
  if (scene !== 'camp' && buildPanel.visible) {
    buildPanel.setVisible(false);
    buildTool = null;
    campView.hideWallGhost();
  }
  // Кадры 9 и 10 показывают ровно одно действие: отряд и данные ждут.
  const quiet = onboarding.step === 'build' || onboarding.step === 'craft';
  const panels = panelsFor(scene, quiet);
  hud.setVisible(panels.hud);
  campHud.setVisible(panels.campHud);
  rosterPanel.setVisible(panels.roster);
  statsPanel.setVisible(panels.stats);
  startScreen.setVisible(panels.startScreen);
  campPrompt.setVisible(panels.campPrompt);
  if (!panels.returnScreen) returnScreen.hide();

  const sound = soundFor(scene, tier);
  if (sound.ambient === null) stopAmbient();
  else startAmbient(sound.ambient);
  if (sound.campTune) startCampTune();
  else stopCampTune();
  if (sound.pulse) startPulse();
  else stopPulse();

  mode = scene;
}

/**
 * Самое щадящее место сегодняшнего региона. Нужно там, где место не
 * выбирают: перезапуск посреди кадра вылазки и отладочный вход.
 */
function safestNode(now: number): number {
  // Только вылазки: у замка и кладбища `tier: 0`, и без фильтра сортировка
  // ставила прогулку первой — перезапуск посреди кадра вылазки уводил гулять
  // по стенам вместо того, что кадр обещает.
  const nodes = regionAt(dayAt(now)).nodes.filter((n) => KIND[n.kind].raidable);
  return [...nodes].sort((a, b) => a.tier - b.tier)[0]?.id ?? 0;
}

/**
 * Вылазка в место на карте (§4). Ярус, ставка и богатство названы до входа
 * карточкой карты — сюда приходит уже принятое решение.
 */
/**
 * §11.7 — кто идёт следом за ведущим. Все, кто на ногах и свободен: §11.8
 * отменил ротацию как выбор, и «оставить кого-то дома» перестало быть
 * решением — раненые и без того лечатся, а остальные выходят вместе.
 */
function followersOf(lead: HeroState): HeroLoadout[] {
  return roster.heroes
    .filter((h) => h.id !== lead.id && h.wounds === 0 && h.status === 'ready')
    .map((h) => loadout(h));
}

/** Классы тех, кто идёт следом: вид рисует их теми же моделями. */
const mateClasses = (r: RaidState): HeroClassId[] =>
  r.party.slice(1).map((f) => f.loadout.cls);

function toRaid(node: number): boolean {
  // Место и его богатство берутся на момент входа, а не на момент открытия
  // панели: панель могла провисеть полчаса, а смена мира — сорок минут.
  const now = clock.now();
  const day = dayAt(now);
  const place = regionAt(day).nodes[node];
  leaveTitle();
  inGlade = false;
  chop = null;
  campPrompt.setVisible(false);
  // Регион пересобрался, пока панель была открыта, — идти некуда.
  if (place === undefined) {
    campHud.notify('Регион пересобрался — выберите место заново');
    return false;
  }
  // Замок (§6.1.6) — не вылазка: там нечего добывать и не с кем драться,
  // и заход в него не тратит ни богатство места, ни героя.
  if (place.kind === 'замок') return toCastle(node, nodeSeed(day, node));
  // Кладбище (§6.1.7) — та же прогулка, но населённая: добычи нет,
  // а привидения есть.
  if (place.kind === 'кладбище') return toGraveyard(node, nodeSeed(day, node));
  const tier = place.tier;
  // §3 — в вылазку идёт один герой, и он обязан быть свободен.
  const hero = heroForRaid();
  if (hero === null) {
    campHud.notify('Все герои заняты — ждём лечения или тренировки');
    return false;
  }
  raidNode = node;
  leaveWalkSites();
  const rotated = hero !== activeHero(roster);
  if (rotated) selectHero(roster, roster.heroes.indexOf(hero));
  hero.status = 'raid';
  raidHero = hero;

  const state = worldAt(now, camp.visits)[node];
  const rich = state?.rich ?? 0;
  const mul = lootMul(rich);
  // §11.6 — событие объявлено картой до входа, и здесь оно уже принятое
  // решение: карточка назвала ставку и добычу, игрок нажал «Войти».
  const event = state?.event ?? null;

  raidView?.dispose();
  raid = createRaid({
    // Сид у места свой и не меняется: пещера — свойство места, а не захода.
    // ?seed=N по-прежнему перебивает его: §6 — воспроизводимость багов.
    seed: debugSeed ?? nodeSeed(day, node),
    tier,
    // §4 — истощение множит добычу, а не запирает вход: плохая сделка
    // оставляет решение игроку, запрет отправляет его ждать вне игры.
    lootMul: mul,
    // §11.6 — что здесь сегодня. Складывается с богатством: выработанная
    // локация под бурей остаётся выработанной.
    event,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    followers: followersOf(hero),
    // §14 — снаряжение складывается поверх класса: класс отвечает «кем идём»,
    // снаряжение — «с чем». Левая рука отдельно: §14.2 — это выбор перед
    // выходом, а не уровень предмета, и перекладывается он бесплатно.
    gear: camp.gear,
    offhand: camp.offhand,
    // §14.3 — колчан наполняется на выходе из лагерного запаса. Взятое
    // уходит из лагеря целиком: то, что не выстрелили, вернётся с героем,
    // а то, что осталось в мёртвом, — нет.
    arrows: camp.arrows,
    // §21 — расходники: что взято в эту вылазку и сгорит на выходе.
    consumables: camp.loadout,
    // Первая вылазка держит выход закрытым до первой добычи (см. onboarding).
    evacOpen: !onboarding.inRaid,
  });
  camp.arrows = Math.max(0, camp.arrows - raid.arrowsMax);
  // §21 — купленное уходит в вылазку и не возвращается: сгорает независимо
  // от того, пригодилось или нет. Копить нечего.
  camp.loadout = [];
  // Заход тратит богатство места — и чужой, и свой. Это единственная дельта,
  // которую мир хранит (§4): кланы и восстановление считаются функцией.
  camp.visits.push({ node, shift: shiftAt(now) });
  persist();
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'mine', null, null, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(18, true);
  rig.night = 1;
  resultShown = false;
  ear.reset(raid);
  showScene('raid', tier);
  // Счётчики первой вылазки обнуляются вместе с ней: перезапуск возвращает
  // игрока к первому кадру, а не к середине раскадровки.
  onboarding.enterRaid(raid);
  track({ t: 'raid_start', at: now, tier, food: raid.foodMax, capacity: raid.capacity });
  // §11.8 — ротация меряется здесь: сменил героя или дождался лечения.
  track({ t: 'hero_pick', at: clock.now(), cls: hero.cls, level: hero.level, rotated });
  return true;
}

/** Площадка последнего замка: ручка отладочной сцены `?castle`. */
let castleNow: CastleSite | null = null;

/**
 * Замок (§6.1.6). Собирается тем же `createRaid`, что вылазка и пролог:
 * ходьба, шаг и камера обязаны считаться одинаково везде, иначе прогулка
 * научит игрока не тому, что его ждёт дальше.
 *
 * Отличается замок тем, чего в нём нет. Ни добычи, ни противников, ни голода:
 * это постройка, а не сделка, и провиант в ней ничего не решает. Выход
 * открыт сразу — уйти можно в любой момент, потому что уходить не от чего.
 */
/**
 * Участок кладбища, пока по нему ходят, и камень, который герой читает
 * прямо сейчас. Второе нужно затем, чтобы надпись всплывала один раз
 * на подход, а не шестьдесят раз в секунду.
 */
let graveSite: GraveSite | null = null;
let readStone: string | null = null;

/**
 * Снять прогулочную сцену перед входом в любую другую.
 *
 * Флаг сцены живёт дольше самой сцены, и снимать его обязан **каждый вход,
 * а не сосед**. Пока снимали соседи, `castleNow` уходил из замка в вылазку:
 * его обнуляло только кладбище, а `toRaid` обнулял один `graveSite`. Цикл
 * же проверяет близость к торговцу безусловно, и панель обмена всплывала
 * посреди обычной вылазки — на клетке, где торговец стоял в замке
 * и где в вылазке нет никого.
 *
 * Поэтому здесь одна функция на все флаги: добавить сцену и забыть снять
 * её у трёх соседей больше нельзя, снимать нужно в одном месте.
 */
function leaveWalkSites(): void {
  castleNow = null;
  graveSite = null;
  readStone = null;
  tradePanel.setVisible(false);
}

function toGraveyard(node: number, seed: number): boolean {
  const hero = heroForRaid() ?? roster.heroes[0]!;
  chop = null;
  const site = generateGraveSite(seed);
  leaveWalkSites();
  graveSite = site;
  raidNode = node;
  // Раны здесь получить можно, а вот занимать героя незачем: добычи нет,
  // и заход не обязан снимать с ротации того, кто просто сходил посмотреть.
  raidHero = null;
  raidView?.dispose();
  raid = createRaid({
    seed,
    tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    followers: followersOf(hero),
    loc: site.loc,
    evacOpen: true,
    containerFood: 0,
    hunger: false,
  });
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'grave', null, site, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Ниже, чем в замке: ограда не прячет участок, и подниматься над ней,
  // чтобы заглянуть внутрь, не нужно — через неё и так видно.
  rig.setZoom(22, true);
  // Сумерки: кладбище стоит на поверхности, но не полдень же на нём.
  rig.night = 0.45;
  resultShown = false;
  ear.reset(raid);
  showScene('raid', 0);
  return true;
}

function toCastle(node: number, seed: number): boolean {
  const hero = heroForRaid() ?? roster.heroes[0]!;
  chop = null;
  const site = generateCastleSite(seed);
  leaveWalkSites();
  // Площадка запоминается ради гарнизона и торговца (§13.5): и тот и другой
  // считаются из неё по ходу прогулки.
  castleNow = site;
  raidNode = node;
  // Ран и опыта здесь никто не получает, поэтому герой и не занимается:
  // прогулка не обязана снимать его с лечения.
  raidHero = null;
  raidView?.dispose();
  raid = createRaid({
    seed,
    tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    followers: followersOf(hero),
    loc: site.loc,
    evacOpen: true,
    containerFood: 0,
    hunger: false,
  });
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'castle', site, null, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Замок выше всего, что игра показывала до сих пор: с высоты вылазки
  // стена закрывала бы двор целиком.
  rig.setZoom(26, true);
  // День: замок стоит на поверхности, и подземный мрак спрятал бы его.
  rig.night = 0.1;
  resultShown = false;
  ear.reset(raid);
  showScene('raid', 0);
  return true;
}

/**
 * Заставка. Показывается на холодном старте и больше нигде: возврат из
 * вылазки ведёт на экран возврата (§20.1), а не сюда — между вылазкой
 * и тратой добычи ничего вставлять нельзя.
 */
function toTitle(): void {
  leaveWalkSites();
  titleView = new TitleView(rig);
  rig.world.add(titleView.group);
  campView.group.visible = false;
  rig.lookAt(titleView.center.x, titleView.center.z, true);
  rig.setZoom(21, true);
  // Ранний вечер: тени от букв уже длинные, но поле ещё зелёное, а не серое.
  rig.night = 0.08;
  inGlade = false;
  showScene('title');
}

/**
 * Уход с заставки. Одной функцией на оба выхода: заставка держит свою камеру,
 * свой туман и поле травы, и забытая при выходе она остаётся в сцене — что
 * и случилось при отладочном входе ?tier, где заставка минуется.
 */
function leaveTitle(): void {
  titleView?.dispose();
  titleView = null;
  startScreen.setVisible(false);
}

/** Свободная клетка рядом с героем — с неё начинается выбор места. */
function siteNearHero(): Cell {
  if (raid === null) return { x: 0, z: 0 };
  const hx = Math.round(raid.hero.x);
  const hz = Math.round(raid.hero.z);
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const c = { x: hx + dx, z: hz + dz };
    if (siteBlock(raid.loc, pitched, raid.hero, c) === 'ok') return c;
  }
  return { x: hx, z: hz };
}

/**
 * Режим выбора места. Подсветка показывается сразу, а не по первому касанию:
 * на телефоне наведения нет, и без неё игрок не понял бы, что от него ждут
 * тапа по земле, а не по кнопке.
 */
function startPlacing(id: BuildingId): void {
  if (raid === null) return;
  placing = id;
  hud.setHint(PITCH_HINT[id] ?? '');
  const c = siteNearHero();
  raidView?.showSite(id, c.x, c.z, siteBlock(raid.loc, pitched, raid.hero, c) === 'ok');
}

/** Тап по земле в режиме выбора места. */
function tryPlace(cell: Cell): void {
  if (placing === null || raid === null) return;
  const ok = siteBlock(raid.loc, pitched, raid.hero, cell) === 'ok';
  raidView?.showSite(placing, cell.x, cell.z, ok);
  // Отказ не молчит и не двигает кадр: красное пятно остаётся под пальцем,
  // и следующий тап игрок делает уже зная, почему прошлый не сработал.
  if (!ok) {
    play('deny');
    return;
  }

  raidView?.place(placing, cell.x, cell.z);
  play('build');
  pitched.push(cell);
  // Палатка встаёт из принесённого: бруски уходят из сумки на глазах,
  // на той же полосе, в которую их только что клали. Ради этой секунды
  // сбор в прологе и заведён — «здание стоит принесённого» показывается
  // до лагеря, а не объясняется в нём.
  //
  // Тратится не больше, чем собрано: пролог показывает цену, а не запирает
  // за ней. Запирать умеет лагерная экономика (§20.3), и там цена настоящая.
  // Оба здания лагеря стоят дерева, и оба берут не больше, чем собрано:
  // пролог показывает цену, но за неё не запирает (§16.1). Запирает лагерная
  // экономика (§20.3), и там цена настоящая.
  const price = placing === 'hq' ? TENT_WOOD : KITCHEN_WOOD;
  const paid = Math.min(price, raid.bag.wood);
  raid.bag.wood -= paid;
  raid.bagTotal -= paid;
  const next = PITCH_ORDER[PITCH_ORDER.indexOf(placing) + 1];
  if (next === undefined) {
    placing = null;
    raidView?.hideSite();
    // Остаток сумки в лагерь пока не сдаётся: за него встанет второй уровень
    // палатки, и дерево обязано лежать там, где игрок его видит, — в полосе
    // рюкзака, а не в невидимых закромах.
    persist();
    // Лагерь встал — единственное настоящее созвучие игры (§18.3).
    play('levelup');
    onboarding.set('upgrade');
    showOnb(onboarding.step);
    return;
  }
  startPlacing(next);
}

/* ---------- вырубка (§13.3) ---------- */

/** Бросить инструмент: игрок ушёл или того, по чему били, не стало. */
function stopChopping(): void {
  chop = null;
  mine = null;
  raidView?.hideWork();
}

/**
 * Тап по дереву. Отказ здесь бывает только один — полный рюкзак: «далеко»
 * не отказ, а дорога, и её герой проходит сам.
 */
function startChopping(cell: Cell): void {
  if (raid === null) return;
  const block = chopBlock(raid, cell);
  if (block !== 'ok' && block !== 'far') {
    play('deny');
    say(CHOP_DENY[block]);
    return;
  }
  chop = aimChop(raid, cell);
  raidView?.showMarker(cell.x, cell.z);
}

/**
 * Тик работы. Звук замаха играется здесь, а падение слышно ухом вылазки
 * (`raidAudio`): оно и так озвучивает прибавку в рюкзаке, и второй звук
 * на то же событие нарушил бы §18.1.
 */
function stepChopping(dt: number): void {
  if (raid === null || chop === null) return;
  const step = stepChop(raid, chop, dt);
  if (step.stopped !== null) {
    play('deny');
    say(CHOP_DENY[step.stopped]);
    stopChopping();
    return;
  }
  // Пока герой в дороге, работы ещё нет: пятно под деревом врало бы о том,
  // что топор уже стучит.
  if (raid.path.length > 0) {
    raidView?.hideWork();
    return;
  }
  raidView?.showWork(chop.cell.x, chop.cell.z, chopProgress(chop));
  if (step.swing) {
    play('build');
    raidView?.hitTree(chop.cell.x, chop.cell.z);
  }
  if (step.felled) {
    // Кромка не открывается никогда (§12.1), и на месте упавшего дерева там
    // встаёт следующее: рубка по краю бесконечна именно этим.
    raidView?.fellTree(chop.cell.x, chop.cell.z, isEdge(raid.loc, chop.cell));
    stopChopping();
  }
}

/* ---------- добыча камня (§13.5) ---------- */

/**
 * Тап по валуну. Жест тот же, что у дерева: герой идёт сам и начинает
 * работать, когда дойдёт. Отказ здесь бывает один — полный рюкзак:
 * «далеко» не отказ, а дорога.
 */
function startMining(cell: Cell): void {
  if (raid === null) return;
  const block = mineBlock(raid.hero, raid.loc.stones, cell, raid.bagTotal < raid.capacity);
  if (block !== 'ok' && block !== 'far') {
    play('deny');
    say(MINE_DENY[block]);
    return;
  }
  chop = null;
  mine = aimMine(raid, cell, commandMove);
  raidView?.showMarker(cell.x, cell.z);
}

/**
 * Тик работы кайлом. Звук замаха играется здесь, а прибавку в рюкзаке
 * озвучивает ухо вылазки (`raidAudio`) — то же правило §18.1, что у рубки.
 */
function stepMining(dt: number): void {
  if (raid === null || mine === null) return;
  const stone = stoneAt(raid.loc.stones, mine.cell);
  const step = stepMine(raid, mine, dt);
  if (step.stopped !== null) {
    play('deny');
    say(MINE_DENY[step.stopped]);
    stopChopping();
    return;
  }
  // Пока герой в дороге, работы ещё нет: пятно врало бы о том, что кайло
  // уже стучит.
  if (raid.path.length > 0) {
    raidView?.hideWork();
    return;
  }
  raidView?.showWork(mine.cell.x, mine.cell.z, mineProgress(mine));
  if (step.swing && stone !== null) raidView?.hitStone(stone.id);
  if (step.taken) {
    if (stone !== null) raidView?.takeStone(stone.id);
    stopChopping();
  }
}

/**
 * Второй акт пролога: лагерь стоит, палатка просит второй уровень.
 *
 * Ни панели, ни кнопки: улучшение случается ровно так же, как подбор, —
 * герой доходит до палатки с деревом, и палатка растёт. Кнопка «Улучшить»
 * здесь ввела бы третий жест раньше, чем игрок освоил первый, а полоса
 * приглашения уже занята постановкой лагеря.
 *
 * Отдых — там же и так же: стоять у лагеря значит отдыхать. Провиант идёт
 * порциями по три (`restTick`), и ждать приходится ровно тому, кто потратил
 * шаги не туда: маршруту по делу провианта хватает (`prologue.rules.ts`).
 */
function stepGladeCamp(dt: number): void {
  if (raid === null) return;
  // Пока лагерь ещё ставится, кадром распоряжается выбор места: его подсказка
  // («Теперь костёр») не должна перебиваться отдыхом.
  if (placing !== null) return;
  const near = nearCamp(pitched, raid.hero);

  if (!upgraded && near && raid.bag.wood >= UPGRADE_WOOD) {
    raid.bag.wood -= UPGRADE_WOOD;
    raid.bagTotal -= UPGRADE_WOOD;
    // Бесплатно и мгновенно, как первая постройка (§20.2): ждать таймер
    // игрок ещё не научился, а «здание стоит принесённого» показывается
    // деревом, которое уходит из сумки на глазах.
    grantLevelOffBooks(camp, 'hq');
    raidView?.setLevel('hq', camp.levels.hq);
    play('levelup');
    upgraded = true;
    // Остаток герой сдаёт в лагерь: пролог кончился, дальше дерево живёт
    // в кладовой, а не в рюкзаке.
    addResources(camp.resources, raid.bag);
    raid.bag = emptyResources();
    raid.bagTotal = 0;
    endGlade();
    return;
  }

  if (near && raid.food < raid.foodMax) restAcc = restTick(restAcc, dt, raid);
  // Отошёл — недостоянные секунды не догоняют героя в лесу.
  else restAcc = 0;

  // Про отдых говорится тому, кто в нём застрял, а не всякому, кто прошёл
  // мимо костра: иначе строка кадра — «сходи за деревом» — не показывается
  // ни разу, ведь после постановки лагеря герой стоит ровно у палатки.
  // Отдых кончается полной полосой или уходом с непустым провиантом:
  // сколько стоять, решает игрок, а не порог.
  if (raid.food <= 0) resting = true;
  else if (raid.food >= raid.foodMax || !near) resting = false;

  // Ветки `upgraded` здесь нет: как только палатка выросла, кадр кончается
  // лагерем (`endGlade`), и строке пролога уже некому показываться.
  const hint = resting
      ? near
        ? 'Отдых · провиант растёт'
        : 'Провиант кончился — отдохните у палатки'
      : ONB_HINT.upgrade ?? '';
  if (hint !== gladeHint) {
    gladeHint = hint;
    hud.setHint(hint);
  }
}

/**
 * Конец пролога. Жильё выросло до второго уровня — и поляна становится тем,
 * чем была всё это время: лагерем.
 *
 * Уводит игрока не выход с поляны, а нижняя строка лагеря: выхода у поляны
 * нет и не заводилось (`prologue.ts` — кромка сплошной лес), а кнопка «В мир»
 * стоит там же, где стояли кнопки всю игру.
 *
 * Раскладка едет с поляны: палатка и костёр остаются на тех клетках, которые
 * выбрал игрок. Иначе выбор места в прологе не значил бы ничего за его
 * пределами — лагерь показал бы раскладку по умолчанию, и игрок не узнал бы
 * места, которое сам и разбил.
 */
function endGlade(): void {
  if (raid !== null) adoptGladeLayout(camp, raid.loc.size, PITCH_ORDER, pitched);
  onboarding.set('world');
  toCamp();
}

/**
 * Пролог (`prologue.ts`). Открывается кнопкой заставки и ведёт не в лагерь,
 * а на поляну: лагеря ещё нет — его разбивают в конце этого кадра.
 *
 * Собирается тем же createRaid, что вылазка, и это не экономия: ходьба, шаг
 * и расход провианта обязаны считаться одинаково, иначе прогулка научит
 * игрока не тому, что его ждёт дальше.
 */
function toGlade(): void {
  leaveTitle();
  leaveWalkSites();
  raidView?.dispose();
  const hero = heroForRaid() ?? roster.heroes[0]!;
  // Раны и опыт в прологе не начисляются никому: драться не с кем.
  raidHero = null;
  const seed = debugSeed ?? ((Math.random() * 1e9) | 0);
  raid = createRaid({
    seed,
    tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    followers: followersOf(hero),
    loc: generateGlade(seed),
    food: gladeFood(),
    // Сумка пролога — своя, как и провиант: Склада ещё нет (`prologue.ts`).
    capacity: gladeCapacity(),
    // Выхода с поляны нет, и кольцо выхода не рисуется: пролог кончается
    // не возвращением, а вторым уровнем жилья — и открывшимся лагерем.
    evacOpen: false,
    // Подбор бесплатен, голод раны не грызёт: провиант здесь — шаги, а нуль
    // провианта — повод отдохнуть у лагеря, а не проиграть (`prologue.ts`).
    containerFood: 0,
    hunger: false,
    // Ставку событие подбора не называет: полоса риска на поляне скрыта
    // до кадра `bait`, и слово «под угрозой» шло впереди механики.
    risk: false,
    // Поляна стоит на поверхности, и занятые клетки на ней — деревья (§13.3):
    // их рубят, а по краю рубят сколько угодно.
    logging: true,
  });
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'glade', null, null, camp.gear.weapon);
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(20, true);
  // Поляна — на поверхности, и это день. Подземный мрак вылазки здесь
  // спрятал бы лес, ради которого кадр и существует.
  rig.night = 0.12;
  resultShown = false;
  inGlade = true;
  chop = null;
  gladeTaken = -1;
  restAcc = 0;
  upgraded = false;
  resting = false;
  gladeHint = '';
  ear.reset(raid);
  placing = null;
  pitched.length = 0;
  raidView.hideSite();
  // Поляна на поверхности — подложка «Подступы», светлая (§18.4).
  showScene('raid', 0);
  onboarding.apply();
  track({ t: 'raid_start', at: clock.now(), tier: 0, food: raid.foodMax, capacity: raid.capacity });
}

function toCamp(): void {
  leaveTitle();
  leaveWalkSites();
  chop = null;
  campMine = null;
  // §18.4 — подложка вылазки обрывается на выходе, и пульс вместе с ней:
  // в лагере провиант ничего не отсчитывает. Взамен — единственная
  // мелодия игры, и звучит она только здесь: всё это в таблице сцены.
  inGlade = false;
  raidView?.dispose();
  raidView = null;
  raid = null;
  campView.group.visible = true;
  campView.setCamp(camp);
  const c = campView.center;
  // По центру экрана: прежний сдвиг к югу выводил лагерь над панелью, которая
  // занимала нижнюю половину. Панели больше нет — лагерю принадлежит весь экран.
  // Возвращение показывает лагерь целиком: куда игрок уехал камерой
  // в прошлый раз — это состояние осмотра, а не то, что он хочет увидеть,
  // открыв игру.
  campInput.reset();
  rig.lookAt(c.x, c.z, true);
  // Кадр растёт вместе с площадью (§20.4): фиксированный зум либо резал
  // лагерь на Жилье ур. 5, либо оставлял пустое поле на первом.
  rig.setZoom(campArea(camp.levels.hq) * 2.8, true);
  // Лагерь — вечер, а не полдень: тёплый свет и длинные тени читаются лучше
  // на плоском затенении, чем прямое солнце.
  rig.night = 0.22;
  // Стены и ограды, построенные игроком, — часть лагеря: они встают вместе
  // с ним, а не по открытию панели.
  campView.setWalls(wallPieces(wallsOf()));
  campView.setFences(fencePieces(wallsOf()));
  campHero = createCampHero(camp);
  campView.setHero(campHero.x, campHero.z, campHero.facing, campHero.y);
  showScene('camp');
  idleSeconds = 0;
  onboarding.apply();
  persist();
}

/* ---------- ввод ---------- */

/**
 * Ввод лагеря (features/campInput): возить пальцем, приближать щипком,
 * тапать по зданию. Здесь остаётся только то, что делает лагерь с тапом, —
 * жест туда не заглядывает и про здания не знает.
 */
const campInput = bindCampInput({
  canvas: rig.renderer.domElement,
  camera: rig,
  // Пока выбрана карточка стройки, камера не двигается: палец рисует стену.
  active: () => mode === 'camp' && buildTool === null,
  center: () => campView.center,
  area: () => campArea(camp.levels.hq),
  onTap: (clientX, clientY) => campTap(clientX, clientY),
  onTouch: () => {
    idleSeconds = 0;
  },
});

function campTap(clientX: number, clientY: number): void {
  const hit = rig.screenToGround(clientX, clientY);
  if (hit === null) return;
  // Любой тап бросает кайло: игрок занялся чем-то другим. Тап по тому же
  // валуну начнёт работу заново — с нуля, а не с середины, и это честно:
  // отойти и вернуться значит начать сначала.
  stopCampMining();
  const picked = campView.buildingAt(hit.x, hit.z);

  // §20.4 — перестановка бесплатна и мгновенна: она вооружена из карточки,
  // и тогда следующий тап по свободному месту ставит здание.
  if (selected !== null) {
    if (moveSelected(hit.x, hit.z)) {
      selected = null;
      campView.highlight(null);
      return;
    }
    // Отказ обязан быть слышен: молчащий тап читается как непопадание.
    campHud.notify(`${BUILDINGS[selected].name}: здесь не встанет`);
    selected = null;
    campView.highlight(null);
    return;
  }

  // Ярус выбирается раньше здания: тап по верху стены над следом здания
  // иначе открыл бы карточку постройки, которая под стеной.
  const up = rig.screenToGround(clientX, clientY, undefined, WALK * CASTLE_CELL);
  const nav = campNav(camp);
  if (up !== null) {
    const spot = wallSpotOf(Math.round(up.x), Math.round(up.z));
    // Камера смотрит сверху вниз, настил непрозрачен: если луч пересёк его
    // внутри ходибельной клетки, именно настил в этом пикселе и нарисован.
    // Погрешность остаётся у боков башен и зубцов выше настила — тот же класс
    // ошибки, что у зданий на плоскости земли, и чинится он только рейкастом
    // по мешам.
    if (topWalkable(nav.top, spot)) {
      campHud.close();
      campView.highlight(null);
      const why = commandCampMove(camp, campHero, { x: Math.round(up.x), z: Math.round(up.z) }, 'верх');
      if (why === 'нет лестницы') campHud.notify('Наверх — по лестнице');
      return;
    }
  }

  /**
   * Тап по валуну — та же добыча, что в вылазке (§13.5). Рюкзака в лагере
   * нет: камень идёт прямо в кладовую, потому что склад в двух шагах.
   *
   * Валун спрашивается раньше здания, и это не произвол. Здание ловит тап
   * с запасом в клетку вокруг следа (`buildingAt`) — иначе в него трудно
   * попасть пальцем, — а валун ловится ровно своей клеткой. Спроси мы
   * здание первым, камень рядом с Кухней стал бы нетапаемым, и выглядело бы
   * это поломкой. Условие «клетка свободна» держит вторую половину сделки:
   * валун под переставленным зданием (§20.4) карточку не перебивает.
   */
  const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  const free = cell.x >= 0 && cell.z >= 0 && cell.x < nav.area && cell.z < nav.area
    && nav.ground[idx(nav.area, cell.x, cell.z)] === 0;
  const stone = stoneAt(camp.stones, cell);
  if (stone !== null && free && campHero.level === 'земля') {
    campHud.close();
    campView.highlight(null);
    startCampMining(stone, nav);
    return;

  }

  // Лагерь: сцена первая. Тап по зданию открывает его карточку, тап мимо —
  // ведёт героя и закрывает лист, то есть возвращает игроку весь экран.
  campView.highlight(picked);
  if (picked !== null) {
    campHud.openBuilding(picked);
    return;
  }
  campHud.close();
  commandCampMove(camp, campHero, cell);
}

/* ---------- добыча камня в лагере (§13.5) ---------- */

/** Взяться за валун: дойти до него или встать, если кайло уже достаёт. */
function startCampMining(stone: Stone, nav: CampNav): void {
  campMine = { work: startMine(stone), stone };
  if (inReach(campHero, stone)) {
    campHero.path.length = 0;
    return;
  }
  const spot = standNear(campHero, stone, (x, z) =>
    x >= 0 && z >= 0 && x < nav.area && z < nav.area && nav.ground[idx(nav.area, x, z)] === 0);
  commandCampMove(camp, campHero, spot);
}

function stopCampMining(): void {
  campMine = null;
  campView.hideWork();
}

/**
 * Тик работы кайлом в лагере. Отличий от вылазки два, и оба — про место:
 * камень идёт в кладовую, а не в рюкзак, и добытое сразу сохраняется —
 * лагерь переживает перезагрузку, и разобранный валун обязан её пережить
 * тоже.
 */
function stepCampMining(dt: number): void {
  if (campMine === null) return;
  const { work, stone } = campMine;
  const step = stepMineInto(
    campHero,
    campHero.path.length > 0,
    camp.stones,
    work,
    dt,
    camp.resources,
  );
  if (step.stopped !== null) {
    play('deny');
    campHud.notify(MINE_DENY[step.stopped]);
    stopCampMining();
    return;
  }
  if (campHero.path.length > 0) {
    campView.hideWork();
    return;
  }
  campView.showWork(work.cell.x, work.cell.z, mineProgress(work));
  if (step.swing) {
    play('build');
    campView.hitStone(stone.id);
  }
  if (step.taken) {
    campView.takeStone(stone.id);
    campHud.notify(`+${MINE_STONE} · ${RESOURCE_NAME.stone}`);
    campHud.sync(camp, clock.now(), 0);
    play('levelup');
    stopCampMining();
    persist();
  }
}

/* ---------- ввод вылазки ---------- */

const canvas = rig.renderer.domElement;

/**
 * Курсор как источник ветра. Один на игру, а не по одному на сцену: рука
 * у игрока одна, и порыв, посчитанный дважды, разошёлся бы силой между
 * лагерем и вылазкой (render/cursorWind.ts).
 */
const wind = new CursorWind();

/**
 * Шаг ветра и раздача порыва сценам. Кадром, а не событием мыши: скорость
 * курсора — это путь за кадр, а pointermove приходит пачкой по несколько
 * штук на кадр, и посчитанная между ними скорость показывает частоту
 * опроса мыши, а не руку.
 */
/**
 * Ветер от наклона устройства. Отдельный источник, а не второй курсор:
 * на телефоне курсора нет вовсе, и наклон там — единственное, чем игрок
 * трогает картинку. Направление приходит в экранных осях, мировое считает
 * риг: наклон вправо обязан класть траву вправо на экране, а какая это
 * сторона мира — зависит от того, куда игрок повернул камеру.
 */
const tilt = new TiltWind();

function stepWind(dt: number): void {
  wind.step(dt);
  const gust = wind.gust;
  titleView?.setGust(gust);
  raidView?.setGust(gust);
  campView.setGust(gust);

  tilt.step(dt);
  const camera = mode === 'title' && titleView !== null ? titleView.camera : undefined;
  const dir = rig.screenDirToWorld(tilt.x, tilt.y, camera);
  titleView?.setTilt(dir.x, dir.z, tilt.strength);
  raidView?.setTilt(dir.x, dir.z, tilt.strength);
  campView.setTilt(dir.x, dir.z, tilt.strength);
}

addEventListener('deviceorientation', (e) => {
  tilt.feed(e.beta, e.gamma);
});
// Вкладка ушла в фон — замеры перестают приходить, а последний остаётся
// висеть. Поле не должно ждать возвращения лёжа.
addEventListener('visibilitychange', () => {
  if (document.hidden) tilt.stop();
});

/**
 * iOS с тринадцатой версии отдаёт гироскоп только по явному разрешению и
 * только из обработчика жеста. Просим на первом касании — там же, где
 * просыпается звук, и по той же причине: раньше просить не у кого.
 */
type OrientationPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

let tiltAsked = false;

function askTilt(): void {
  if (tiltAsked) return;
  tiltAsked = true;
  const api = DeviceOrientationEvent as unknown as OrientationPermission;
  if (typeof api.requestPermission !== 'function') return;
  void api.requestPermission().catch(() => {
    // Отказ — не поломка: на телефоне без разрешения трава просто стоит
    // ровно, как на любом настольном экране.
  });
}

/**
 * Щелчок по кнопке интерфейса.
 *
 * `SFX.tap` живёт на шине `ui` и звучал ровно в двух местах: канвас и
 * отпускание ползунка в настройках. Все DOM-кнопки игры молчали — лагерь,
 * карта, экран возврата, заставка, — и это слышно рядом со сценой, которая
 * щёлкает: интерфейс кажется неживым. В настройках при этом стоит ползунок
 * громкости «интерфейс», управлявший почти ничем.
 *
 * Слушатель один и делегированный, а не по кнопке в каждой панели. Так
 * не приходится править девять файлов и заводить девятое место, где
 * про звук можно забыть; панель боя (§11.3) при этом не редактируется
 * вовсе — она получает щелчок тем же слушателем.
 *
 * Фаза перехвата: панель может остановить всплытие своего события, но
 * касание уже случилось, и звук отвечает на касание, а не на его судьбу.
 */
app.addEventListener('pointerdown', (e) => {
  const el = e.target;
  if (el instanceof HTMLButtonElement && !el.disabled) play('tap');
}, true);

canvas.addEventListener('pointerdown', (e) => {
  play('tap');
  askTilt();
  idleSeconds = 0;
  // Стройка стен перехватывает палец целиком: пока карточка выбрана,
  // лагерь не крутится и здания не выбираются.
  if (mode === 'camp' && buildTool !== null) {
    stopCampMining();
    const hit = rig.screenToGround(e.clientX, e.clientY);
    if (hit !== null) buildAt(hit, buildTool !== 'стена');
    return;
  }
  if (mode !== 'raid') return;
  const hit = rig.screenToGround(e.clientX, e.clientY);
  if (hit === null) return;
  const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  // Выбор места перебивает ходьбу: провиант кончился, идти всё равно некуда.
  if (placing !== null) {
    tryPlace(cell);
    return;
  }
  if (raid === null || raid.status !== 'running') return;

  // §11.3 — бой перехватывает палец целиком: пока идёт ход, тап значит
  // «шагнуть сюда» или «ударить того», а не «идти по локации».
  if (inBattle(raid)) {
    const battle = raid.battle!;
    const unit = current(battle);
    if (unit === undefined || unit.side !== 'hero') return;
    const want = worldToHex(hit.x, hit.z);

    // Тап по противнику — удар, если достаём. Проверяет поле, а не панель:
    // подсветка и удар обязаны считаться одним правилом.
    const there = unitAt(battle, want);
    if (there !== undefined && there.side !== 'hero') {
      if (targets(battle, raid.loc.size, raid.loc.blocked, unit).includes(there)) {
        commandBattle(raid, { kind: 'attack', target: there.id });
      }
      return;
    }

    const reach = moves(battle, raid.loc.size, raid.loc.blocked, unit);
    const spot = reach.get(hexKey(want));
    if (spot !== undefined) commandBattle(raid, { kind: 'move', to: spot.hex });
    return;
  }
  // Тап по дереву — рубка (§13.3). Жест тот же, что у всего остального:
  // герой идёт сам и начинает работать, когда дойдёт. Второго жеста
  // («выбрать топор», «нажать рубить») здесь нет и быть не должно —
  // в локации их всего один.
  if (raid.logging && treeAt(raid.loc, cell)) {
    startChopping(cell);
    return;
  }
  // Тап по валуну — добыча (§13.5). Спорить с деревом ему не о чем: дерево
  // стоит на занятой клетке, валун лежит на проходимой.
  if (stoneAt(raid.loc.stones, cell) !== null) {
    startMining(cell);
    return;
  }
  stopChopping();
  if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
});

canvas.addEventListener('pointermove', (e) => {
  // Ветер от курсора — во всех трёх сценах: трава лагеря и заставки
  // и есть та, на которую игрок смотрит дольше всего.
  const camera = mode === 'title' && titleView !== null ? titleView.camera : undefined;
  const hit = rig.screenToGround(e.clientX, e.clientY, camera);
  if (hit === null) return;
  // Мазок ведётся, пока палец прижат. Без нажатия мышь только показывает,
  // куда встанет клетка, — на телефоне этого шага просто не будет.
  if (mode === 'camp' && buildTool === 'стена') {
    if (e.buttons !== 0 || stroke !== null) buildAt(hit, false);
    return;
  }
  // §11.3 — в бою наведение показывает, куда можно шагнуть. На телефоне
  // наведения нет, и подсветка там просто не появится: жест от этого
  // не меняется, тап остаётся тапом.
  if (mode === 'raid' && raid !== null && inBattle(raid)) raidView?.setHover(hit.x, hit.z);
  else raidView?.clearHover();

  wind.point(hit.x, hit.z);
  // Лагерь замирает через 20 секунд без касаний. Мышь, ведомая по траве, —
  // такое же касание: на телефоне наведения нет, и батарею это не трогает.
  idleSeconds = 0;

  // Место под здание ведётся наведением, без нажатия: мышь показывает,
  // куда встанет, до того как игрок решится.
  if (mode !== 'raid' || placing === null || raid === null) return;
  const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  raidView?.showSite(placing, cell.x, cell.z, siteBlock(raid.loc, pitched, raid.hero, cell) === 'ok');
});

// Курсор ушёл с холста — ветру не за кем идти. Палец, снятый с экрана,
// тоже уход: на телефоне наведения нет, и вести траву нечем.
canvas.addEventListener('pointerup', (e) => {
  if (mode !== 'camp' || buildTool !== 'стена' || stroke === null) return;
  const hit = rig.screenToGround(e.clientX, e.clientY);
  if (hit !== null) buildAt(hit, true);
});

canvas.addEventListener('pointerleave', () => wind.away());
canvas.addEventListener('pointercancel', () => wind.away());

function moveSelected(x: number, z: number): boolean {
  if (selected === null) return false;
  const ok = moveBuilding(camp, selected, Math.round(x - 0.5), Math.round(z - 0.5));
  if (ok) {
    campView.setCamp(camp);
    persist();
  }
  return ok;
}

addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') rig.rotate(-1);
  if (e.key === 'e' || e.key === 'E') rig.rotate(1);
});
addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  // §9 — точка выхода из сессии. Пишется на уход, а не на закрытие вкладки:
  // события выгрузки на мобильных не гарантированы.
  track({
    t: 'exit',
    at: clock.now(),
    where: returnScreen.visible ? 'return' : mode === 'raid' ? 'raid' : 'camp',
  });
  persist();
});

/**
 * Таймеры отряда и состав. Считается по монотонному времени, поэтому лечение
 * и тренировка идут, пока игра закрыта, — это тот же оффлайн-прогресс, что
 * у стройки (§2). Возвращает true, если что-то изменилось и надо сохранять.
 */
function tickHeroes(now: number): boolean {
  let changed = false;
  for (const done of refreshHeroes(roster, now)) {
    const name = HERO_CLASSES[done.hero.cls].name;
    campHud.notify(
      done.what === 'healed' ? `${name} вылечен` : `${name}: уровень ${done.hero.level}`,
    );
    changed = true;
  }
  // §11.8 — второй герой на Жилье ур. 2, третий на ур. 4.
  let unlocked = syncRoster(roster, camp.levels.hq);
  while (unlocked !== null) {
    campHud.notify(`${HERO_CLASSES[unlocked].name} принят в отряд`);
    changed = true;
    unlocked = syncRoster(roster, camp.levels.hq);
  }
  return changed;
}

/* ---------- цикл ---------- */
let fpsAcc = 0;
let fpsFrames = 0;
let lastRender = performance.now();

// Игра открывается заставкой с одной кнопкой, и сразу за кнопкой начинается
// пролог — поляна, герой и полоса провианта. Правило раскадровки «ни одного
// экрана меню до того, как игрок сыграет» этим не нарушено: меню здесь нет,
// есть одна кнопка, и за ней не лагерь, а локация.
//
// Кадры вылазки по-прежнему открываются в вылазке: они перезапуск не
// переживают, и заставка посреди раскадровки уводила бы игрока из неё.
if (onboarding.step === 'glade' || onboarding.step === 'done') {
  toTitle();
} else if (!onboarding.inRaid || !toRaid(safestNode(clock.now()))) {
  // Вход мог не открыться (сейв от прежних правил) — тогда честно в лагерь,
  // а не в пустой экран.
  toCamp();
}

// Отладочный вход: ?tier=N открывает игру сразу в вылазке нужного яруса,
// ?node=N — в конкретное место сегодняшнего региона. Нужен, чтобы проверять
// вылазку и экран возврата, не проходя лагерь заново.
const today = regionAt(dayAt(clock.now())).nodes;
const debugTier = debugParams.get('tier');
if (debugTier !== null) {
  const t = Number(debugTier);
  const place = today.find((n) => n.tier === t);
  if (place !== undefined) toRaid(place.id);
}
const debugNode = debugParams.get('node');
if (debugNode !== null) {
  const n = Number(debugNode);
  if (today.some((place) => place.id === n)) toRaid(n);
}

/**
 * Ручка к состоянию вылазки для сцен `?tier=N` и `?node=N`. Без неё сцена
 * показывает кадр, но ответить «взялся ли герой за валун и сколько осталось»
 * может только глаз, а восемь секунд у камня незачем высиживать: работа
 * отдаётся живой, и `работа().left` двигается руками.
 */
if (debugTier !== null || debugNode !== null) {
  (window as unknown as { камень: unknown }).камень = {
    rig,
    вылазка: () => raid,
    камни: () => raid?.loc.stones ?? null,
    работа: () => mine,
    рубка: () => chop,
  };
}

/**
 * Отладочные сцены (§6: воспроизводимость). Кадр, который нужно посмотреть,
 * открывается сразу, а не проходом игры до него: чтобы проверить стену
 * в лагере, незачем играть пролог.
 *
 * `?camp` — лагерь как он есть.
 * `?camp=walls` — лагерь с готовым кольцом стен: ворота, башня, лестница.
 *   Ровно та планировка, на которой видно все четыре ответа сразу — ход
 *   поверху, разрыв на башне, проезд под воротами и подъём.
 *
 * Сцены отладочные и живут только в `npm run dev`: в сборку они попадают,
 * но открыть их можно лишь адресом, которого в игре нет.
 */
const debugCamp = debugParams.get('camp');
if (debugCamp !== null) {
  if (debugCamp === 'walls') {
    // Площадь по максимуму и полный карман камня: сцена заведена, чтобы
    // смотреть стену, а не чтобы копить на неё. При Жилье ур. 1 кольцо
    // занимает лагерь целиком, и смотреть внутри нечего.
    // Сцена собирается с нуля каждый раз: `toCamp` сохраняет лагерь, и без
    // сброса второй заход достраивал бы кольцо поверх прежнего.
    camp.walls = emptyWalls();
    camp.levels.hq = 5;
    camp.levels.kitchen = 3;
    camp.levels.storage = 3;
    camp.resources.stone = 200;
    camp.resources.wood = 200;
    // Здания уводятся во двор: при раскладке по умолчанию они стоят по краю
    // площади и кольцо не замыкается — стена на клетку здания не встаёт.
    // Это не подгонка сцены, а то же, что пришлось бы сделать игроку.
    // Координаты чётные: клетка стены — две клетки лагеря, и здание, стоящее
    // не по этой сетке, съедает до четырёх её клеток вместо одной.
    camp.layout.hq = { x: 2, z: 2 };
    camp.layout.kitchen = { x: 6, z: 2 };
    camp.layout.storage = { x: 2, z: 6 };
    camp.layout.forge = { x: 6, z: 6 };
    const walls = wallsOf();
    const site = wallSite();
    // Кольцо ставится мимо зданий: клетка стены — четыре клетки лагеря,
    // и угол площади занят Жильём.
    // Кольцо подаётся обходом, а не списком клеток: мазок соединяет соседние
    // точки лесенкой, и зигзаг залил бы двор целиком.
    const grid = Math.floor(campArea(camp.levels.hq) / CASTLE_CELL);
    raiseWall(walls, site, [
      { x: 0, z: 0 },
      { x: grid - 1, z: 0 },
      { x: grid - 1, z: grid - 1 },
      { x: 0, z: grid - 1 },
      { x: 0, z: 0 },
    ]);
    toggleGate(walls, { x: 1, z: grid - 1 });
    cycleTower(walls, site, { x: grid - 1, z: 0 });
    // Лестница ставится последней и на первую подходящую клетку: ей нужен
    // и свободный двор, и сосед с готовым ходом, а где это совпало —
    // зависит от того, куда встали здания.
    const tops = topsOf();
    for (let z = 1; z < grid - 1 && Object.keys(walls.stairs).length === 0; z++) {
      for (let x = 1; x < grid - 1; x++) {
        if (putStairs(walls, site, { x, z }, tops)) break;
      }
    }
    persist();
  }
  toCamp();
  // Ручка к состоянию сцены. Без неё отладочная сцена показывает кадр,
  // но ответить на вопрос «а герой-то поднялся?» может только глаз.
  // Живёт только вместе с отладочным адресом.
  (window as unknown as { камень: unknown }).камень = {
    camp,
    hero: campHero,
    rig,
    nav: () => campNav(camp),
    tap: (x: number, z: number, level: 'земля' | 'верх' = 'земля') =>
      commandCampMove(camp, campHero, { x, z }, level),
    // §14 и §6.1.8: уровень оружия меняет клинок в руке. Ковать ради проверки
    // незачем — ручка ставит уровень и пересобирает вид тем же путём,
    // которым он пересобирается после настоящей ковки.
    оружие: (level: number) => {
      camp.gear.weapon = Math.max(0, Math.min(MAX_ITEM_LEVEL, level | 0));
      campView.setCamp(camp);
      return camp.gear.weapon;
    },
    // Начатая добыча (§13.5). Отдаётся сама работа, а не снимок: отладочной
    // сцене положено не только показывать состояние, но и двигать его —
    // высиживать восемь секунд у камня незачем.
    работа: () => campMine,
  };
}

/**
 * `?castle` — замок сегодняшнего региона сразу, вместе с гарнизоном
 * (§6.1.6). Смотреть на отряд и на смену стрелка, проходя до замка игру,
 * нельзя: точка замка одна на день, и ждать её — не проверка.
 *
 * Ручка `камень` даёт то, чего не видно глазом: где отряд будет через
 * минуту и когда стрелок выйдет на стену. `камень.смена(t)` переводит часы
 * гарнизона — смена длится минуту, и высиживать её незачем.
 */
if (debugParams.has('castle')) {
  const place = today.find((n) => n.kind === 'замок');
  if (place !== undefined) toRaid(place.id);
  (window as unknown as { камень: unknown }).камень = {
    site: () => castleNow,
    // Начатая добыча (§13.5) и тот, кто её ведёт. Работы не видно глазом,
    // пока пятно не выросло, а вопрос «взялся ли герой за камень» задаётся
    // первым. Отдаётся сама работа, а не её снимок: отладочной сцене положено
    // не только показывать состояние, но и двигать его.
    работа: () => mine,
    герой: () => raid?.hero ?? null,
    garrison: () => (castleNow === null ? null : garrisonOf(castleNow)),
    patrol: (t = 0) => (castleNow === null ? null : patrolAt(garrisonOf(castleNow), t)),
    archer: (t = 0) => (castleNow === null ? null : archerAt(garrisonOf(castleNow), t)),
    // Жильцы двора (§6.1.6.1). Печатается то, чего не видно глазом: кто где
    // сейчас, идёт ли и какой длины у него круг — обход в клетках читать
    // по одной клетке бессмысленно.
    жильцы: (t = 0) => {
      if (castleNow === null) return null;
      const g = garrisonOf(castleNow);
      return dwellersAt(g, t).map((d, i) => ({
        кто: d.look,
        где: [+d.x.toFixed(2), +d.z.toFixed(2)],
        идёт: d.walking,
        круг: +(g.yard[i]?.cycle ?? 0).toFixed(1),
      }));
    },
    смена: (t: number) => raidView?.setWatch(t),
    // Герой и тап по клетке: прозрачность стен (§6.1.6.1) включается тем,
    // что он вошёл во двор, и без ручки к нему сцена этого не показывает —
    // до ворот пришлось бы идти пешком.
    raid: () => raid,
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
    rig,
  };
}

/**
 * `?grave` — кладбище сегодняшнего региона сразу, `?grave=СИД` — с назначенным
 * сидом. Участок вырос до мерки замка (§6.1.7.1), и размер, материал ограды
 * и расстановка могил выводятся из сида: чтобы посмотреть на крупное
 * кладбище, ждать нужной точки на карте — не проверка, а лотерея.
 */
const debugGrave = debugParams.get('grave');
if (debugGrave !== null) {
  const place = today.find((n) => n.kind === 'кладбище');
  const seed = debugGrave === '' ? nodeSeed(dayAt(clock.now()), place?.id ?? 0) : Number(debugGrave);
  leaveTitle();
  toGraveyard(place?.id ?? 0, Number.isFinite(seed) ? seed : 1);
  (window as unknown as { камень: unknown }).камень = {
    rig,
    site: () => graveSite,
    // Размер участка и население — те два числа, ради которых сцена и заведена.
    участок: () => (graveSite === null ? null : {
      локация: graveSite.loc.size,
      привидений: graveSite.loc.enemies.length,
      надгробий: graveSite.marks.length,
      материал: graveSite.material,
    }),
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
  };
}

if (debugParams.has('bench')) {
  installBench({
    rig,
    // Кадр текущего режима, синхронно: тот же путь, что и в render ниже,
    // включая шаг ветра — иначе кадр стенда не стареет и порыв в нём висит
    // вечно, чего в игре не бывает.
    draw: () => {
      stepWind(1 / 60);
      if (mode === 'title' && titleView !== null) {
        titleView.update(performance.now() / 1000);
        rig.lookAt(titleView.center.x, titleView.center.z);
        rig.update(1 / 60, titleView.center.x, titleView.center.z, 12);
        rig.renderWith(titleView.camera);
        return;
      } else if (mode === 'raid' && raid !== null && raidView !== null) {
        raidView.sync(raid, 0, 1 / 60, performance.now(), rig.dayFactor);
        rig.update(1 / 60, raid.hero.x, raid.hero.z, visionRadius(raid.loadout.knowledge, rig.night > 0.5, true));
      }
      rig.render();
    },
    state: () => ({ mode, night: rig.night, sun: rig.sunIntensity, bg: rig.backgroundHex }),
    setGrass: (perTile) => {
      raidView?.setGrassDensity(perTile);
      hud.setGrass(perTile);
    },
    blades: () => raidView?.grassBlades ?? 0,
    cursor: (x, z) => wind.point(x, z),
  });
}

startLoop({
  update: (dt) => {
    const now = clock.now();
    // На заставке не тикает ничего: таймеры стройки досчитываются при входе
    // в лагерь тем же completeIfDue, что и после закрытой вкладки.
    if (mode === 'title') return;
    if (mode === 'raid' && raid !== null) {
      const woundsBefore = raid.hero.hp;
      stepRaid(raid, dt, rig.night > 0.5, raid.loadout.knowledge);
      // Рана обязана быть замечена телом, а не только глазом. Кадр 3
      // онбординга завёл эту тряску ради первой раны; со сменой модели боя
      // (§11.3) удар стал стоить разного числа ран, и молчать про них
      // за пределами раскадровки перестало быть допустимо.
      if (raid.hero.hp < woundsBefore) shake();
      if (sayNext !== null) {
        raid.events.push(sayNext);
        sayNext = null;
      }
      /**
       * Камни кладбища читаются подходом (§6.1.7). Надпись всплывает один раз
       * на камень: пока герой стоит рядом, она не повторяется, а отойдя
       * и вернувшись, он прочтёт её снова. Ничего, кроме строки в HUD,
       * это не делает — кладбище остаётся прогулкой.
       */
      if (graveSite !== null) {
        const read = readEpitaph(graveSite, raid.hero.x, raid.hero.z, readStone);
        readStone = read.last;
        if (read.say !== null) raid.events.push(read.say);
      }
      /**
       * Лавка открывается подходом и гаснет уходом (§13.5) — тем же жестом,
       * что и надпись на камне. Кнопки «закрыть» нет: игрок отходит, и лавки
       * больше нет.
       */
      if (castleNow !== null) {
        const near = atTrader(castleNow, raid.hero.x, raid.hero.z);
        if (near !== tradePanel.visible) tradePanel.setVisible(near);
        if (near) tradePanel.sync(camp);
      }
      // Рубка идёт после шага и до уха: упавшее дерево ложится в рюкзак,
      // а прибавку в рюкзаке ухо озвучивает само (§18.1).
      stepChopping(dt);
      stepMining(dt);
      ear.hear(raid);
      if (inGlade) {
        hud.sync(raid, dt);
        const taken = raid.loc.containers.filter((c) => c.opened).length;
        if (taken !== gladeTaken) {
          gladeTaken = taken;
          // Кольцо переезжает на следующий брусок — и гаснет, когда их нет.
          showOnb(onboarding.step);
        }
        // Полосу рюкзака зажигает первое дерево в нём, а не первый вскрытый
        // брусок: срубленное (§13.3) попадает туда же, и полоса, молчащая
        // на честно добытом дереве, читалась бы как поломка.
        if (raid.bagTotal > 0 && onboarding.step === 'glade') {
          onboarding.set('gather');
          showOnb(onboarding.step);
        }
        // Первый акт кончается тем, что дерева хватает на палатку, — а не
        // вычищенной поляной: брусков семь, а стоит палатка два. Второй повод,
        // нуль провианта, остаётся, пока лагеря нет: отдыхать негде, и кадр
        // обязан кончиться в любом случае.
        //
        // Симуляция при этом не замирает: приглашение висит, а игрок волен
        // собирать дальше и нажать, когда решит остаться.
        // Зовут, когда собран весь лагерь, а не одна палатка: костёр теперь
        // тоже стоит дерева, и приглашение с двумя брусками в сумке обещало бы
        // то, на что не хватит. Ровно сумка — полный рюкзак и есть лагерь.
        const enough = raid.bag.wood >= CAMP_WOOD;
        if (pitched.length === 0 && (enough || raid.food <= 0) && !resultShown) {
          resultShown = true;
          campPrompt.setReason(enough ? 'Дерево собрано' : 'Провиант кончился');
          campPrompt.setVisible(true);
          // Пульс отработал своё: он вёл к этой секунде и молчит после неё.
          stopPulse();
        }
        if (pitched.length > 0) stepGladeCamp(dt);
        return;
      }
      if (onboarding.inRaid) onboarding.drive(raid);
      hud.sync(raid, dt);
      if (raid.status !== 'running' && !resultShown) {
        resultShown = true;
        const result = raidResult(raid);
        // §14.3 — невыстреленное и подобранное возвращается вместе с героем.
        // Провалившийся не возвращает ничего: он и добычу теряет по §11.2,
        // и колчан у него отняли там же.
        if (result.status === 'evacuated') camp.arrows += result.arrowsLeft;
        addResources(camp.resources, result.carried);
        camp.raids += 1;
        finishRaidForHero(raid, result.carriedTotal, result.status === 'evacuated', now);
        for (const id of result.fired) {
          track({ t: 'consumable', at: now, id, phase: 'fire' });
        }
        persist();
        track({
          t: 'raid_end',
          at: now,
          tier: result.tier,
          failed: result.status !== 'evacuated',
          maxBack: result.maxBack,
          locMaxBack: result.locMaxBack,
          carried: result.carriedTotal,
          lost: result.lost,
          steps: result.steps,
          foodLeft: result.foodLeft,
          durationSec: Math.round(result.durationSec),
          cause: result.cause,
          lastHitBy: result.lastHitBy,
          damageTaken: result.damageTaken,
          fights: result.fights,
          kills: result.kills,
        });
        hud.setVisible(false);
        // Кадр 8: в первый раз выбора нет — путь ведёт в лагерь, иначе
        // игрок его не увидит.
        const firstReturn = onboarding.inRaid;
        if (firstReturn) onboarding.set('return');
        returnScreen.show(
          result,
          camp,
          (chose, canBuy) => {
            track({ t: 'return_screen', at: clock.now(), canBuy, chose });
          },
          firstReturn,
          raidNode,
          clock.now(),
        );
      }
      return;
    }

    idleSeconds += dt;
    // Стена кончается тем же тиком, что и здание: слот один, освобождаться
    // он обязан одинаково.
    if (completeWallIfDue(wallsOf(), now) !== null) {
      refreshWalls();
      campHud.notify('Стройка кончена');
      persist();
    }
    const finished = completeIfDue(camp, now);
    if (finished !== null) {
      track({ t: 'build_done', at: now, building: finished, level: camp.levels[finished] });
      play('levelup');
      campHud.notify(`${BUILDINGS[finished].name} готов`);
      persist();
    }
    if (tickHeroes(now)) persist();
    campHud.sync(camp, now, dt);
    rosterPanel.sync(roster, now);
  },

  render: (alpha) => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastRender) / 1000);
    lastRender = now;

    returnScreen.update();
    stepWind(dt);

    if (mode === 'title' && titleView !== null) {
      // Полная частота, а не 30 кадров лагеря: камеру здесь тянут пальцем,
      // и половинная частота читается как залипание, а не как экономия.
      titleView.update(now / 1000);
      rig.lookAt(titleView.center.x, titleView.center.z);
      rig.update(dt, titleView.center.x, titleView.center.z, 12);
      rig.renderWith(titleView.camera);
      return;
    }

    if (mode === 'raid' && raid !== null && raidView !== null) {
      raidView.sync(raid, alpha, dt, now, rig.dayFactor);
      // §11.3 — панель боя живёт вместе с полем. Досягаемость считает поле
      // теми же правилами, которыми применит ход: кнопка, предлагающая
      // невозможное, хуже отсутствующей.
      if (raid.battle !== null) {
        const unit = current(raid.battle);
        const canHit = unit !== undefined && unit.side === "hero"
          && targets(raid.battle, raid.loc.size, raid.loc.blocked, unit).length > 0;
        battleHud.setVisible(true);
        battleHud.sync(raid.battle, canHit);
      } else {
        battleHud.setVisible(false);
      }
      // §11.3 — в бою камера ведёт того, чей ход. Иначе игрок смотрит
      // на героя, пока где-то за краем кадра ходит противник, и решение,
      // ради которого бой сделан пошаговым, принимается вслепую.
      if (raid.battle !== null) {
        const acting = current(raid.battle);
        const at = acting === undefined ? null : hexToWorld(acting.hex);
        if (at !== null) rig.lookAt(at.x, at.z);
        else rig.lookAt(raid.hero.x, raid.hero.z);
      } else {
        rig.lookAt(raid.hero.x, raid.hero.z);
      }
      rig.update(
        dt,
        raid.hero.x,
        raid.hero.z,
        visionRadius(raid.loadout.knowledge, rig.night > 0.5, true),
      );
      rig.render();
    } else {
      // camp.html §3: лагерь идёт на 30 кадрах и замирает через 20 секунд
      // без касаний. Непрерывный цикл на 60 кадрах ради пяти бродящих
      // человечков — худшая сделка по батарее во всей игре.
      if (idleSeconds > 20) return;
      if (now - lastCampFrame < 1000 / 30) return;
      const campDt = Math.min(0.1, (now - lastCampFrame) / 1000);
      lastCampFrame = now;
      // Герой лагеря идёт тем же шагом, что и в вылазке: сначала считается
      // симуляцией, потом ставится в сцену.
      stepCampHero(camp, campHero, campDt);
      stepCampMining(campDt);
      campView.setHero(campHero.x, campHero.z, campHero.facing, campHero.y);
      campView.update(campDt, now, rig.dayFactor);
      const c = campView.center;
      // Тот же кадр, что и в toCamp, плюс то, куда игрок увёз камеру.
      rig.lookAt(c.x + campInput.pan.x, c.z + campInput.pan.z);
      rig.update(campDt, c.x, c.z, 12);
      rig.render();
    }

    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      const blades = raidView?.grassBlades ?? 0;
      hud.setStats(
        `${Math.round(fpsFrames / fpsAcc)} fps · ${rig.drawCalls} draw` +
          (blades > 0 ? ` · ${blades} трав.` : ''),
      );
      fpsAcc = 0;
      fpsFrames = 0;
    }
  },
});
