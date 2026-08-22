import './style.css';
import { Clock, formatDuration } from './core/clock';
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
  stopPulse,
} from './core/audio';
import {
  BUILDINGS,
  BUILD_SECONDS,
  campArea,
  campOrigin,
  completeIfDue,
  craftGear,
  buyArrows,
  gearBlock,
  moveBuilding,
  speedup,
  setOffhand,
  speedupCost,
  startUpgrade,
  upgradeBlock,
  UPGRADE_REASON,
  GEAR_REASON,
} from './sim/camp';
import type { BuildingId, CampState } from './sim/camp';
import { GEAR, MAX_ITEM_LEVEL, OFFHAND, gearMods } from './sim/gear';
import type { GearSlot, Offhand } from './sim/gear';
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
  RAID_REASON,
  TRAIN_REASON,
} from './sim/heroes';
import type { HeroClassId, HeroLoadout, HeroState, Roster } from './sim/heroes';
import { HAND_SIZE, deal, draftReady } from './sim/draft';
import type { DraftCardId } from './sim/draft';
import { ONB_HINT, firstTapCell, grantLevelOffBooks, reveal } from './sim/onboarding';
import type { OnbStep } from './sim/onboarding';
import {
  adoptGladeLayout,
  firstGladeCell,
  generateGlade,
  gladeCapacity,
  gladeFood,
  nearCamp,
  packGlade,
  unpackGlade,
  restTick,
  CAMP_WOOD,
  KITCHEN_WOOD,
  TENT_WOOD,
  UPGRADE_WOOD,
  siteBlock,
  chestSiteNear,
} from './sim/prologue';
import {
  CHEST_BONUS,
  CHEST_REASON,
  adoptChest,
  buildChest,
  chestBlock,
  chestFits,
  chestSpot,
  stash,
} from './sim/chests';

/** Одна строка на все потери у потолка кладовой (§13.6): канал события. */
const STORE_FULL = 'Кладовая полна — часть добычи пропала';
import {
  aimChop,
  chopBlock,
  chopProgress,
  isEdge,
  stepChop,
  treeAt,
  CHOP_REASON,
} from './sim/logging';
import type { Chop } from './sim/logging';
import {
  aimMine,
  mineBlock,
  mineProgress,
  standNear,
  startMine,
  stepMine,
  stepMineInto,
  stoneAt,
  MINE_REASON,
} from './sim/stones';
import type { Stone } from './sim/stones';
import { distanceField, idx } from './sim/grid';
import { inReach } from './sim/work';
import type { Work } from './sim/work';
import { refusal } from './sim/reason';
import { commandMove, createRaid, raidResult, stepRaid, useSkill } from './sim/raid';
import type { RaidState } from './sim/raid';
import { BUY_REASON, CONSUMABLES, buyBlock, buyConsumable, refundConsumable } from './sim/consumables';
import type { ConsumableId } from './sim/consumables';
import { RESOURCE_NAME, emptyResources, spend } from './sim/resources';
import { adoptRaw, load, rawSave, save, wipe } from './sim/save';
import { cloudOnSignIn, cloudPull, cloudPush, cloudUser, cloudWipe } from './core/cloud';
import { AuthCard } from './ui/authCard';
import {
  KIND,
  SHIFT_SEC,
  WAKE_AT,
  dayAt,
  lootMul,
  nightAt,
  nodeSeed,
  regionAt,
  shiftAt,
  worldAt,
} from './sim/world';
import type { WorldNode } from './sim/world';
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
  emptyWalls,
  gateBlock,
  nextTowerLevel,
  cycleFence,
  fenceMaterial,
  fencePieces,
  lampBlock,
  lampSpots,
  razeWall,
  roadSpots,
  stairsBlock,
  startTower,
  startWall,
  raiseWall,
  strokeFit,
  toggleGate,
  putStairs,
  cycleTower,
  wallPieces,
  wallPrice,
  wallSeconds,
  wallSpotOf,
  type WallSite,
  type WallTool,
  WALL_REASON,
} from './sim/campWalls';
import type { StartBlock } from './sim/campWalls';
import type { Spot } from './sim/castle';
import { FENCE } from './sim/fence';
import { atTrader, generateCastleSite, type CastleSite } from './sim/castleSite';
import {
  GUEST_REASON,
  GUEST_TERM_COST,
  GUEST_WORK,
  advanceGuest,
  castleGuestAt,
  guestBlock,
  guestPitch,
  startGuestMeet,
} from './sim/castleGuest';
import type { CastleGuest, GuestMeet } from './sim/castleGuest';
import { archerAt, dwellersAt, garrisonOf, patrolAt } from './sim/garrison';
import { generateGraveSite, readEpitaph } from './sim/graveSite';
import { generateTrailSite, type TrailSite } from './sim/trailSite';
import { askOf, dealBlock, makeDeal, worthOf } from './sim/trade';
import { TradePanel } from './ui/tradePanel';
import type { GraveSite } from './sim/graveSite';
import { events, loadTelemetry, track } from './sim/telemetry';
import type { Cell, EnemyKind, GameLocation, Tier } from './sim/types';
import { CampView } from './render/campView';
import { CursorWind } from './render/cursorWind';
import { TiltWind } from './render/tiltWind';
import { RaidView } from './render/raidView';
import { SceneRig } from './render/scene';
import { TitleView } from './render/titleView';
import { WheelView } from './render/wheelView';
import { streetScene } from './render/village';
import { CampHud } from './ui/campHud';
import { HeroCard } from './ui/heroCard';
import { ReturnScreen } from './ui/returnScreen';
import { StatsPanel } from './ui/statsPanel';
import { CampPrompt } from './ui/campPrompt';
import { SettingsMenu } from './ui/settings';
import { Hud } from './ui/hud';
import { BattleHud } from './ui/battleHud';
import { commandBattle, inBattle, partyByUnit } from './sim/raid';
import { current, moves, targets, unitAt } from './sim/battle';
import { worldToHex, hexKey, hexToWorld } from './sim/hex';
import { mulberry32 } from './core/rng';
import { DraftScreen } from './ui/draftScreen';
import { StartScreen } from './ui/startScreen';
import { chronicle } from './sim/chronicle';
import {
  SORTIE_REASON,
  freeHero,
  reportOf,
  sortieBlock,
  sortieDue,
  ticketOf,
} from './sim/sortie';
import { installBench } from './features/bench';
import { FanControl, installFan } from './features/fan';
import type { FanPerson } from './features/fan';
import { bindCampInput } from './features/campInput';
import { createDirector } from './features/onboarding';
import { MeetPanel } from './ui/meetPanel';
import type { MeetPanelCallbacks } from './ui/meetPanel';
import { advance, answerSelf, generateSettler, giftOf, setHeroName, startMeet } from './sim/settler';
import {
  TENT_REASON,
  admit,
  assignWork,
  buildTent,
  collectWork,
  hasRoof,
  homeless,
  residentState,
  roofs,
  tentBlock,
  tentFits,
  tentSpot,
} from './sim/residents';
import { RESIDENT_TOOL, guardHeight } from './render/models';
import { choreAt, choresAt, choresOf } from './sim/chores';
import type { Chore } from './sim/chores';
import { chatAt, phraseAt } from './sim/talk';
import type { Talker } from './sim/talk';
import { Bubbles } from './render/bubbles';
import { WorkBars } from './render/workbar';
import type { WorkItem } from './render/workbar';
import type { Bubble } from './render/bubbles';
import { DWELLER_SPEED } from './sim/garrison';
import { ResidentCard } from './ui/residentCard';
import type { DwellerLook } from './sim/garrison';
import type { MeetState, SelfAnswer, Settler } from './sim/settler';
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
  awaySec: startedAt - (loaded.watermark > 0 ? loaded.watermark : startedAt),
  timerLeftSec:
    camp.construction === null ? null : Math.max(0, camp.construction.endsAt - startedAt),
});

/**
 * Жильцы работали, пока нас не было (`sim/residents.ts`). Считается от той
 * же отметки, что и всё офлайновое, — стройка рядом заканчивается по ней же.
 *
 * Прибавка не молчит: она проговаривается строкой на входе в лагерь, потому
 * что иначе ответ на вопрос знакомства меняет число, которого игрок
 * не видел, — то есть не меняет ничего.
 */
const awaySec = loaded.watermark > 0 ? Math.max(0, startedAt - loaded.watermark) : 0;
const worked = collectWork(camp, awaySec);
/** Сказать о наработанном один раз за сессию, а не на каждый вход в лагерь. */
let workShown = false;

const finishedOffline = completeIfDue(camp, startedAt); // стройка могла закончиться без нас
if (finishedOffline !== null) {
  track({ t: 'build_done', at: startedAt, building: finishedOffline, level: camp.levels[finishedOffline] });
}

let mode: 'title' | 'camp' | 'raid' = 'title';
let raid: RaidState | null = null;
let titleView: TitleView | null = null;
/** Колесо призов — оверлей поверх карты, в риг не входит (`wheelView.ts`). */
let wheelView: WheelView | null = null;
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
/**
 * Сундук пролога (`chests.ts`): встаёт рядом с палаткой в момент её
 * постановки, в лагерь принимается в `endGlade` тем же переносом, что
 * здания. В глейдовых координатах, пока пролог идёт.
 */
let gladeChest: Cell | null = null;
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

/** Что сейчас написано в строке подсказки пролога. Сравнение затем, чтобы
 *  не переписывать одну и ту же строку шестьдесят раз в секунду. */
let gladeHint = '';
let resultShown = false;
/** camp.html: лагерь замирает через 20 секунд без касаний. */
let idleSeconds = 0;
let lastCampFrame = 0;
let selected: BuildingId | null = null;
/** Кнопка «Палатка» вооружила выбор места: следующий тап ставит палатку. */
let placingTent = false;
/** Кнопка «Сундук» (`chests.ts`) вооружила выбор места — тем же жестом. */
let placingChest = false;

/**
 * Отладка, а не механика — как ползунок «Ночь». Плотность травы меряется
 * ползунком и задаётся в адресе (?grass=N), чтобы замер повторялся.
 */
const debugParams = new URLSearchParams(location.search);
/**
 * `?кадры` — цикл на таймере вместо rAF: отладка, а не механика (§6).
 * В скрытой панели браузер не зовёт rAF вовсе, время игры стоит, и ни одну
 * отладочную сцену нельзя проверить инструментом без окна на переднем
 * плане. Таймер медленнее и неровнее rAF — в игре ему делать нечего,
 * поэтому ручка адресная, как все отладочные сцены.
 */
if (debugParams.has('кадры')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
let grassPerTile = Number(debugParams.get('grass') ?? 24);
if (!Number.isFinite(grassPerTile)) grassPerTile = 24;
grassPerTile = Math.max(0, Math.min(64, Math.round(grassPerTile)));
/**
 * Отладка `?пух`: на поляне сеется трава заставки (FluffyGrass) вместо
 * клеточной травы вылазки — примерка, как пролог выглядит с лугом титула.
 */
const debugFluffy = debugParams.has('пух');
const seedParam = Number(debugParams.get('seed'));
const debugSeed = Number.isFinite(seedParam) && debugParams.has('seed') ? seedParam | 0 : null;

/**
 * Ночь адресом (§6.2.5). Раньше её задавал только ползунок в игровом HUD,
 * и замер на конкретной темноте нельзя было повторить, не подвинув его
 * рукой на то же место.
 */
const nightParam = Number(debugParams.get('night'));
const debugNight = debugParams.has('night') && Number.isFinite(nightParam)
  ? Math.max(0, Math.min(1, nightParam / 100))
  : null;

/**
 * Минута смены, с которой начать (§24). Ручка к расписанию, а не только
 * к свету: `?night=` красит небо, но жильцы по нему не ложатся — они спят
 * по часам, и без сдвига часов увидеть отбой можно было только высидев
 * его. §6 требует ровно обратного: «отладочная сцена отматывает часы
 * и получает нужный кадр сразу», — и у гарнизона такая ручка есть
 * (`камень.смена`), а у лагеря не было.
 *
 * Сдвигаются часы **лагеря целиком**: и небо, и маршруты, и сон. Двигать
 * что-то одно значило бы развести их — то самое, от чего §24 ушёл, переводя
 * границы фаз в секунды.
 *
 * Смена — сорок минут: `?смена=27` ставит кадр на отбой, `?смена=0` —
 * на подъём. Сейв она не трогает: сдвиг живёт в адресе и умирает вместе
 * с вкладкой.
 */
const shiftParam = Number(debugParams.get('смена'));
const debugShift = debugParams.has('смена') && Number.isFinite(shiftParam)
  ? shiftParam * 60 - ((clock.now() - WAKE_AT) % SHIFT_SEC + SHIFT_SEC) % SHIFT_SEC
  : 0;

/**
 * Отладочный ряд в вылазке. Собирается только по адресу: ручка к состоянию
 * не живёт в игровом экране, а `?grass=` в адресе — уже просьба её показать.
 */
const debugHud = debugParams.has('debug') || debugParams.has('grass') || debugParams.has('night');

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

/** Пузыри реплик жильцов (§23.5): слой один на игру, живёт он только
 *  в лагере на поляне — остальные кадры чистят его каждый рендер. */
const bubbles = new Bubbles(rig);

/** Полосы прогресса над стройкой и инструментом (`render/workbar.ts`):
 *  слой один на игру, наполняет его каждый рендер `syncWorkBars`. */
const workBars = new WorkBars(rig);

/**
 * Ночь сцены. Заданная адресом перебивает сценарную: замер на конкретной
 * темноте обязан повторяться, а не подгоняться ползунком на то же место.
 * Без `?night=` ведёт себя ровно как присваивание, которым была.
 */
const setNight = (value: number): void => {
  rig.night = debugNight ?? value;
};
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
}, debugHud ? { night: debugNight ?? 1, grass: grassPerTile } : null);

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
    enterNode(node);
  },
  onSortie: (node) => sendSortie(node),
  onCraft: (slot) => forge(slot),
  // §20.4 — карточка вооружает перестановку, дальше игрок бьёт по клетке.
  onMove: (id) => {
    selected = id;
    campView.highlight(selected);
    // Вооружённых жестов не бывает двух разом — то же правило, что у палатки.
    placingTent = false;
    placingChest = false;
    hidePlacingSpot();
    campHud.notify(`${BUILDINGS[id].name}: коснитесь свободного места`);
  },
  onWalls: () => openWalls(),
  /**
   * §14.3 — пачка стрел. Колчан наполняется только здесь: в вылазке стрелы
   * тратятся, донесённое возвращается в лагерь, а взяться им больше неоткуда.
   * До этой кнопки колчан начинался пустым и мог только убывать — Лучник
   * всегда дрался со штрафом пустого колчана.
   */
  onBuyArrows: () => {
    const cap = gearMods(camp.gear, camp.offhand).arrows;
    if (!buyArrows(camp, cap)) {
      campHud.notify('Стрелы: не хватает железа или колчан полон');
      return;
    }
    campHud.notify(`Стрелы ${camp.arrows} / ${cap}`);
    persist();
  },
  onOffhand: (hand) => swapOffhand(hand),
  /**
   * Задание «поставить палатку» (`sim/residents.ts`). Кнопка не ставит,
   * а вооружает: место выбирает игрок следующим тапом — тем же жестом,
   * каким переставляются здания (§20.4). Первая версия ставила сама,
   * и палатка вставала в клетку под визуальным свесом шатра Жилья:
   * игрок платил пять дерева и видел палатку, выросшую из чужой.
   * Отказ звучит так же, как виден (§18.3).
   */
  onTent: () => {
    const why = tentBlock(camp);
    if (why !== 'ok') {
      play('deny');
      campHud.notify(TENT_REASON[why]);
      return;
    }
    // Палатка и перестановка держат один палец: вооружённых жестов
    // не бывает двух разом.
    selected = null;
    campView.highlight(null);
    placingChest = false;
    placingTent = true;
    campHud.notify('Палатка: коснитесь свободного места');
    // Пятно — сразу, на предложенной клетке: на телефоне наведения нет,
    // и без него игрок не понял бы, какого размера след он выбирает.
    const spot = tentSpot(camp);
    if (spot !== null) showPlacingSpot(spot);
  },
  /**
   * Сундук (`chests.ts`) — тот же жест, что палатка: карточка вооружает
   * палец, место выбирает игрок. Отказ звучит так же, как виден (§18.3).
   */
  onChest: () => {
    const why = chestBlock(camp);
    if (why !== 'ok') {
      play('deny');
      campHud.notify(CHEST_REASON[why]);
      return;
    }
    selected = null;
    campView.highlight(null);
    placingTent = false;
    placingChest = true;
    campHud.notify('Сундук: коснитесь свободного места');
    // То же пятно, что у палатки, — след у них один.
    const spot = chestSpot(camp);
    if (spot !== null) showPlacingSpot(spot);
  },
  /**
   * Лист накрывает сцену, а веер рисуется поверх всего своим слоем —
   * и стоял ровно на карточке места в «Карте региона», споря с ней
   * за палец и за глаз. Пока лист открыт, выбирать героя всё равно
   * нечем и незачем; закрылся — веер возвращается тем же состоянием,
   * каким его держит сцена. Диалог и смена сцены распоряжаются веером
   * сами (`dialogHud`, `showScene`): пока панель лагеря спрятана, лист
   * закрывается программно на переходах, и веер здесь не трогается.
   * Гвард по видимости панели, а не по `inGladeCamp`: лагерей два
   * (поляна и площадка отладочных адресов), лист и веер есть в обоих.
   */
  onSheet: (open) => {
    if (!campHud.visible) return;
    heroFan.setVisible(!open && !quietFrame());
  },
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
  buildPanel.update(wallsOf(), clock.now(), camp.resources);
  campHud.notify('Стены: выберите карточку, дальше жест по земле');
}

/** Перерисовать стены и обновить счётчики панели. */
function refreshWalls(): void {
  campView.setWalls(wallPieces(wallsOf()));
  campView.setFences(fencePieces(wallsOf()));
  campView.setRoads(roadSpots(wallsOf()));
  campView.setLamps(lampSpots(wallsOf()));
  buildPanel.update(wallsOf(), clock.now(), camp.resources);
}

/** Тап или мазок по земле в режиме стройки. Возвращает: жест обработан. */
function buildAt(ground: { x: number; z: number }, finished: boolean): boolean {
  if (buildTool === null) return false;
  // Мазок приходит в мире — стена считается в клетках площадки (§16.1).
  const hit = campLocal(ground);
  const walls = wallsOf();
  const site = wallSite();
  const spot = wallSpotOf(Math.round(hit.x), Math.round(hit.z));
  // Слот один на лагерь: стена и улучшение здания спорят за одно и то же.
  const busy = camp.construction !== null;

  if (buildTool === 'стена' || buildTool === 'ограда' || buildTool === 'дорога') {
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
          ? `Здесь ${tool === 'ограда' ? 'ограде' : tool === 'дорога' ? 'дороге' : 'стене'} не встать`
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
    if (nextTowerLevel(walls, spot) === null) return finishWall('top');
    return finishWall(startTower(walls, site, camp.resources, spot, clock.now(), busy));
  }
  if (buildTool === 'фонарь') {
    const why = lampBlock(walls, wallSite(), spot);
    if (why !== 'ok') return finishWall(why, 'Фонарь');
    return finishWall(startWall(walls, camp.resources, 'фонарь', [spot], clock.now(), busy));
  }
  if (buildTool === 'ворота') {
    const why = gateBlock(walls, spot);
    if (why !== 'ok') return finishWall(why, 'Ворота');
    return finishWall(startWall(walls, camp.resources, 'ворота', [spot], clock.now(), busy));
  }
  if (buildTool === 'лестница') {
    const tops = topsOf();
    const why = stairsBlock(walls, site, spot, tops);
    if (why !== 'ok') return finishWall(why, 'Лестница');
    return finishWall(startWall(walls, camp.resources, 'лестница', [spot], clock.now(), busy));
  }

  // Снос мгновенный и с возвратом камня: сносить — не строить, и трогать
  // планировку не должно стоить дороже, чем не трогать её.
  if (!razeWall(walls, spot, camp.resources)) return finishWall('empty');
  play('build');
  buildPanel.setNote(null);
  refreshWalls();
  campHud.sync(camp, clock.now(), 0);
  persist();
  return true;
}

/**
 * Общий хвост стройки: отказ называет причину, успех занимает слот.
 *
 * Слова берутся из `WALL_REASON` (§23.3), а не собираются здесь: раньше
 * причина сама была текстом, и один случай — «слот занят» — переписывался
 * по дороге в панель, потому что фрагментом он читался, а строкой нет.
 */
function finishWall(result: StartBlock, subject?: string): boolean {
  if (result !== 'ok') {
    play('deny');
    const reason = WALL_REASON[result];
    buildPanel.setNote(subject === undefined ? reason : refusal(subject, reason));
    return true;
  }
  play('build');
  buildPanel.setNote(null);
  buildPanel.update(wallsOf(), clock.now(), camp.resources);
  campHud.sync(camp, clock.now(), 0);
  persist();
  return true;
}

/**
 * Отряд у большого пальца (§11.8). Веер заменил список: кем идти — вопрос,
 * который задают каждый заход в лагерь, а список отвечал на него двумя
 * касаниями через лист. Лицо под пальцем отвечает одним.
 *
 * **Карточка показывает выбранного, а не ведущего.** Тапнуть по лечащемуся
 * можно, повести им — нет; иначе «сколько ему ещё лечиться» негде прочитать.
 */
let shownHero = roster.active;

const heroCard = new HeroCard(app, {
  onTrain: (index) => {
    const hero = roster.heroes[index];
    if (hero === undefined) return;
    const block = trainBlock(roster, hero, camp.levels.yard);
    if (block !== 'ok') {
      campHud.notify(refusal(HERO_CLASSES[hero.cls].name, TRAIN_REASON[block]));
      return;
    }
    startTraining(roster, hero, clock.now(), camp.levels.yard);
    track({ t: 'train_start', at: clock.now(), cls: hero.cls, level: hero.level });
    persist();
  },
  // §14.2 — тот же выбор, что в «Припасах»: вход второй, рука одна.
  onOffhand: (hand) => swapOffhand(hand),
});

/**
 * §14.2 — переложить предмет в левой руке. Бесплатно и без таймера.
 * Входов два — «Припасы» и разбор героя, — а рука и слова о ней одни.
 */
function swapOffhand(hand: Offhand): void {
  if (!setOffhand(camp, hand)) return;
  campHud.notify(`В левой руке: ${OFFHAND[hand].name.toLowerCase()}`);
  persist();
}

const heroFan = new FanControl({
  parent: app,
  reserve: () => campHud.bands(),
  // Лица берутся из отряда, а не хранятся: состав растёт с Жильём (§11.8),
  // и второй список героев рядом с первым разошёлся бы с ним молча.
  // Лица берутся из отряда и из жильцов: как только в лагере больше одного
  // человека, веер и есть тот список, по которому переключаются и приказывают.
  people: () => [
    ...roster.heroes.map((hero): FanPerson => {
      const block = raidBlock(hero);
      return {
        name: HERO_CLASSES[hero.cls].name,
        kind: 'герой',
        look: hero.cls,
        seed: hero.id,
        state: hero.status,
        busy: block !== 'ok',
        asking: false,
      };
    }),
    ...camp.residents.map((r, i): FanPerson => ({
      name: r.name,
      kind: 'жилец',
      look: r.look,
      seed: r.seed,
      state: hasRoof(camp, i) ? residentState(r) : 'без крыши',
      busy: false,
      asking: false,
    })),
  ],
  onPick: (index) => {
    // Хвост веера — жильцы: тап по лицу открывает карточку с приказами.
    if (index >= roster.heroes.length) {
      shownResident = index - roster.heroes.length;
      heroCard.setVisible(false);
      residentCard.sync(camp, shownResident);
      residentCard.showMenu();
      // На поляне лицо не только открывает карточку — оно передаёт ведение:
      // тап по земле теперь ведёт этого жильца, тап по дереву — рубка.
      controlResident(shownResident);
      return;
    }
    const hero = roster.heroes[index];
    if (hero === undefined) return;
    // Меню открывается на любом, даже на том, кем сейчас не пойти; полный
    // разбор за ним — по команде «О персонаже».
    shownHero = index;
    residentCard.setVisible(false);
    heroCard.showMenu();
    controlHero();
    const block = raidBlock(hero);
    if (block !== 'ok') {
      campHud.notify(refusal(HERO_CLASSES[hero.cls].name, RAID_REASON[block]));
      heroCard.sync(roster, shownHero, clock.now(), camp.levels.yard, camp.gear, camp.offhand);
      return;
    }
    selectHero(roster, index);
    heroCard.sync(roster, shownHero, clock.now(), camp.levels.yard, camp.gear, camp.offhand);
    persist();
  },
});

/** Какой жилец в карточке. Отдельно от героя: списки разные, карточки тоже. */
let shownResident = 0;

/**
 * Карточка жильца: приказ меняет занятие на месте, бесплатно и мгновенно —
 * как перестановка зданий (§20.4). Сохраняется той же persist, что и всякая
 * перемена лагеря.
 */
const residentCard = new ResidentCard(app, {
  onOrder: (index, order) => {
    if (!assignWork(camp, index, order)) return;
    play('pick');
    residentCard.sync(camp, index);
    // Приказ виден рукой сразу: площадка лагеря пересоберёт жильца сама
    // (подпись `rebuildBuildings`), а сидящему на поляне предмет меняется
    // на месте — пересадка вернула бы ведомого жильца к костру.
    const r = camp.residents[index];
    if (r !== undefined) {
      raidView?.setResidentTool(index, r.rest ? null : RESIDENT_TOOL[r.answer]);
    }
    // Приказ меняет и маршрут: вставший к делу выходит на тропу, отпущенный
    // отдыхать с неё сходит. Без ведомого жильцы пересаживаются целиком;
    // при ведомом — только перекладываются тропы, к новым местам остальные
    // доходят ногами (`glide`), а сам ведомый остаётся в руке игрока.
    if (inGladeCamp) {
      if (controlled === -1) seatResidents();
      else planChores();
    }
    persist();
  },
  // §14.2 — механика едина с героем: рука одна на лагерь, вход третий.
  onOffhand: (hand) => swapOffhand(hand),
});

/**
 * Знакомство у прогалины. Панель заводится рядом с остальными, а обработчики
 * приезжают позже: разговор существует только там, где есть поселенец,
 * и держать его логику в общем месте значило бы делать вид, что он есть
 * всегда.
 */
let meetOn: MeetPanelCallbacks | null = null;
const meetPanel = new MeetPanel(app, {
  onName: (name) => meetOn?.onName(name),
  onAnswer: (answer) => meetOn?.onAnswer(answer),
  onAdvance: () => meetOn?.onAdvance(),
  onInvite: () => meetOn?.onInvite(),
});

/**
 * Знакомство (§16.1). Состояние живёт здесь, а не в сейве: не приглашённый
 * человек сидит у палатки каждый вход заново — знакомство не сгорает от
 * того, что мимо прошли. Приглашённый вписан в жильцов (`residents.ts`),
 * и это единственное, что переживает перезагрузку.
 */
let meetSettler: Settler | null = null;
let meet: MeetState | null = null;
/** Где сидит; null — в этом кадре встречи нет. */
let meetAt: Cell | null = null;
let meetShown = false;

/**
 * Свободная клетка с чистыми соседями в кольце 2–4 от точки. Прогалина
 * обязана быть прогалиной: первый же назначенный сдвиг посадил поселенца
 * в ёлку, и снаружи это читалось не «сидит», а «его нет».
 */
function sitSpotNear(at: Cell, loc: GameLocation, taken?: (x: number, z: number) => boolean): Cell | null {
  const n = loc.size;
  const openAround = (x: number, z: number): boolean => {
    // Сидеть в следе палатки — то же, что в ёлке: человек и здание рендерятся
    // друг в друге. Постройки в blocked не пишутся, их называет вызывающий.
    if (taken !== undefined && taken(x, z)) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
        if (loc.blocked[cz * n + cx] !== 0) return false;
      }
    }
    return true;
  };
  for (let r = 2; r <= 4; r++) {
    for (let z = at.z - r; z <= at.z + r; z++) {
      for (let x = at.x - r; x <= at.x + r; x++) {
        if (Math.round(Math.hypot(x - at.x, z - at.z)) !== r || !openAround(x, z)) continue;
        return { x, z };
      }
    }
  }
  return null;
}

/**
 * Разговор знакомства: кадры листает игрок, приглашение кладёт дар в кошелёк
 * и вписывает человека в жильцы. Общий у настоящей встречи в лагере и
 * отладочного кадра `?встреча`: разговор один, сцен у него две.
 */
function meetCallbacks(): MeetPanelCallbacks {
  const redraw = (): void => {
    if (meetSettler === null || meet === null) return;
    meetPanel.show(meetSettler, meet);
    setHint('');
  };
  const step = (): void => {
    if (meet === null) return;
    advance(meet);
    redraw();
    // Клавиатура открывается по жесту игрока и только на своём кадре:
    // дёргать её на каждой перерисовке нельзя.
    if (meet.step === 'ты') meetPanel.focusName();
  };
  return {
    onName: (raw) => {
      if (meet === null || meetSettler === null) return;
      setHeroName(meet, raw, meetSettler.offeredName);
      step();
    },
    onAnswer: (answer: SelfAnswer) => {
      if (meet === null) return;
      answerSelf(meet, answer);
      play('pick');
      step();
    },
    onAdvance: step,
    onInvite: () => {
      if (meet === null) return;
      meet.invited = true;
      // Дар кладётся в кошелёк лагеря той же тратой, что и всякая другая:
      // крохи обязаны быть видны в полосе, иначе слово «возьми» ничем
      // не подтверждено.
      const gift = giftOf(meet);
      if (gift !== null) {
        // Через кладовую (`stash`): дар — приток извне, и потолок §13.6
        // для него не исключение. Крохи в переполненный лагерь не влезают.
        stash(camp, gift.resources);
        persist();
      }
      // Он остаётся в лагере независимо от того, есть ли крыша: запирать
      // знакомство за ценой значило бы отменять само знакомство
      // (`residents.ts`). Нехватка крыши станет заданием, а не отказом.
      if (meetSettler !== null && meet.answer !== null) {
        // Сид приходит вместе с человеком: с каким лицом сидел на прогалине,
        // с таким и войдёт в лагерь.
        admit(camp, {
          name: meetSettler.name,
          look: meetSettler.look,
          seed: meetSettler.seed,
          answer: meet.answer,
          rest: false,
        });
        persist();
      }
      play('build');
      // Встаёт и идёт к герою: вставание не прерывается ходьбой (§17.1).
      if (raid !== null) raidView?.callSettler(raid.hero.x, raid.hero.z);
      advance(meet);
      meetPanel.hide();
      dialogHud(false);
      // Кэш подсказки поляны сравнивает со своим прошлым значением, а оно
      // не менялось: без сброса подсказка не вернулась бы никогда.
      gladeHint = '';
    },
  };
}

/**
 * Кем водит лагерь (§16.1): −1 — герой, иначе номер жильца. Симуляция одна
 * на всех: при передаче управления позиция героя паркуется, и raid.hero
 * временно ходит ногами жильца — те же тапы, та же дорога, та же рубка.
 */
let controlled = -1;
let parkedHero: { x: number; z: number } | null = null;

function controlResident(idx: number): void {
  if (!inGladeCamp || raid === null || raidView === null || controlled === idx) return;
  const at = raidView.residentAt(idx);
  if (at === null) return;
  stopChopping();
  if (controlled === -1) parkedHero = { x: raid.hero.x, z: raid.hero.z };
  raid.hero.x = raid.hero.prevX = at.x;
  raid.hero.z = raid.hero.prevZ = at.z;
  raid.path.length = 0;
  raidView.setHeroParked(true);
  // Ношу рутины жилец складывает, переходя в руку игрока: дальше он рубит
  // по указке, а не несёт своё, и бревно в свободной руке обещало бы
  // прибавку, которой от этой рубки не будет.
  raidView.setResidentLoad(idx, null);
  carried[idx] = false;
  controlled = idx;
}

function controlHero(): void {
  if (!inGladeCamp || raid === null || controlled === -1) return;
  stopChopping();
  // Жилец остаётся стоять, где остановился, и сам возвращается к делу:
  // рутина ведёт его к маршруту шагом (`glide` в driveResident), а сидевший
  // так и стоит до следующего входа в лагерь — потом сядет (`seatResidents`).
  if (parkedHero !== null) {
    raid.hero.x = raid.hero.prevX = parkedHero.x;
    raid.hero.z = raid.hero.prevZ = parkedHero.z;
  }
  raid.path.length = 0;
  raidView?.setHeroParked(false);
  controlled = -1;
  parkedHero = null;
}

/* ---------- рутина жильцов (§6.1.15) ---------- */

/**
 * Часы лагеря на поляне: по ним идут маршруты рутины, сон и очередь реплик.
 *
 * Свои часы тут стояли до §24 и были неправы: рутина начиналась с нуля
 * на каждый вход, и игрок всегда заставал одну и ту же минуту дня, а лагерь
 * не жил, пока на него не смотрят. Теперь это те же часы, что у неба
 * и у мира, — и жилец спит ровно тогда, когда темно.
 */
const campTime = (): number => clock.now() + debugShift;

/**
 * Палатки жильцов в кадре поляны. Зовётся при входе и после каждой постройки:
 * место палатки выбрано тапом игрока (`pitchTentAt`), и сцена узнаёт о нём
 * отсюда.
 *
 * Клетки палаток не закрываются для маршрутов здесь, а закрываются в
 * `planChores` — тем же проходом, что и следы построек: маска рутины
 * собирается в одном месте, и второй её сборщик разошёлся бы с первым молча.
 *
 * Жильцы пересаживаются следом, и это не запас: новая палатка даёт крышу
 * тому, у кого её не было, а с крышей он выходит на тропу (§6.1.15).
 * Пересадка — тот же путь, каким приказ карточки переводит жильца
 * с занятия на занятие; при ведомом она откладывается, чтобы не вынимать
 * человека из руки игрока.
 */
function placeTents(): void {
  if (!inGladeCamp || raidView === null) return;
  const o = campOrigin(camp);
  raidView.setTents(camp.tents.map((t) => ({ x: o.x + t.x, z: o.z + t.z })));
  raidView.setChests(camp.chests.map((c) => ({ x: o.x + c.x, z: o.z + c.z })));
  // Костры гостей — тем же вызовом и в тех же координатах поляны.
  raidView.setFires((camp.fires ?? []).map((f) => ({ x: o.x + f.x, z: o.z + f.z })));
  if (controlled === -1) seatResidents();
  else planChores();
}

/**
 * Тап выбора места палатки — в клетках площадки. След палатки 1×1, и её
 * клетка лежит центром в целых координатах — палец показывает середину
 * клетки, значит клетка ближайшая целая. У перестановки зданий вычитается
 * полклетки, но там след 2×2: палец показывает середину следа, а данные
 * держат его угловую клетку. Жест разряжается любым исходом:
 * вооружённый палец, переживший промах, ставил бы палатки по каждому
 * следующему тапу.
 */
function pitchTentAt(x: number, z: number): void {
  placingTent = false;
  hidePlacingSpot();
  const spot = buildTent(camp, { x: Math.round(x), z: Math.round(z) });
  if (spot === null) {
    play('deny');
    campHud.notify('Палатка: здесь не встанет');
    return;
  }
  play('build');
  campView.setCamp(camp);
  // Тот же вид, что и на площадке, — на поляне. Раньше здесь стоял только
  // `campView`, спрятанный в этой сцене, и палатка за пять дерева
  // не появлялась нигде: задание §16.1 закрывалось молча.
  placeTents();
  persist();
}

/**
 * Пятно 1×1 под вооружённый палец (палатка или сундук) — в клетках площадки.
 * Показывается сразу при вооружении, ведётся наведением и гаснет любым
 * исходом: то же правило, что у пятна зданий в прологе (`showSite`).
 */
function showPlacingSpot(at: { x: number; z: number }): void {
  const ok = placingTent ? tentFits(camp, at.x, at.z) : chestFits(camp, at.x, at.z);
  if (inGladeCamp) {
    const o = campOrigin(camp);
    raidView?.showSpot(o.x + at.x, o.z + at.z, ok);
  } else {
    campView.showSpot(at.x, at.z, ok);
  }
}

function hidePlacingSpot(): void {
  raidView?.hideSpot();
  campView.hideSpot();
}

/**
 * Тап выбора места сундука (`chests.ts`) — те же правила, что у палатки:
 * след 1×1, клетка ближайшая целая, жест разряжается любым исходом.
 */
function placeChestAt(x: number, z: number): void {
  placingChest = false;
  hidePlacingSpot();
  const spot = buildChest(camp, { x: Math.round(x), z: Math.round(z) });
  if (spot === null) {
    play('deny');
    campHud.notify('Сундук: здесь не встанет');
    return;
  }
  play('build');
  campView.setCamp(camp);
  placeTents();
  persist();
}

/** Маршруты рутины, по одному на жильца; null — сидит у костра. */
let chores: (Chore | null)[] = [];

/** Маска проходимости рутины: лес поляны плюс следы построек в кадре. */
let choreMask: Uint8Array | null = null;

/** Где сидят сидящие: идущие обходят их, а не толкают. */
let seatedBodies: { x: number; z: number }[] = [];

/**
 * У кого сейчас полны руки. Кэш, а не запрос каждый кадр: ноша меняется
 * дважды за круг, а кадров в круге пять тысяч, и пересобирать меш на каждом
 * значило бы платить за предмет, который не менялся.
 */
let carried: (boolean | undefined)[] = [];

/** Кто сейчас спит в палатке: кадр рендера про это знает от тика рутины,
 *  а не спрашивает расписание второй раз своими руками. */
let sleeping: boolean[] = [];

/**
 * Маршруты пересобираются с посадкой и с приказом карточки: кто идёт,
 * а кто сидит, решает та же экономика, что начисляет работу (`workDone`), —
 * отдыхающий и безкрышный маршрута не получают.
 */
function planChores(): void {
  // Тропы переложены — про ношу в руках известно заново: кэш чистится
  // вместе с маршрутами, иначе первый же тик сочтёт руки полными по памяти
  // о прошлой раскладке.
  carried = [];
  sleeping = [];
  if (raid === null) {
    chores = [];
    choreMask = null;
    return;
  }
  const o = campOrigin(camp);
  const size = raid.loc.size;
  const mask = Uint8Array.from(raid.loc.blocked);
  // Следы построек в кадре: снимок поляны их не знает — здания встали
  // после него, — а жилец, идущий сквозь палатку, читается привидением.
  for (const id of PITCH_ORDER) {
    const p = camp.layout[id];
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const x = o.x + p.x + dx;
        const z = o.z + p.z + dz;
        if (x >= 0 && z >= 0 && x < size && z < size) mask[idx(size, x, z)] = 1;
      }
    }
  }
  // Палатки жильцов и сундуки — след 1×1, и сквозь них тоже не ходят.
  // Костры гостей — тем же правилом: сквозь огонь не ходят тем более.
  for (const t of [...camp.tents, ...camp.chests, ...(camp.fires ?? [])]) {
    const x = o.x + t.x;
    const z = o.z + t.z;
    if (x >= 0 && z >= 0 && x < size && z < size) mask[idx(size, x, z)] = 1;
  }
  // Сидящий гость знакомства — тоже не проход.
  if (meetAt !== null) mask[idx(size, meetAt.x, meetAt.z)] = 1;
  choreMask = mask;
  const fire = { x: o.x + camp.layout.kitchen.x + 1, z: o.z + camp.layout.kitchen.z + 1 };
  chores = choresOf(
    {
      size,
      blocked: mask,
      fire,
      // Сид — якорь лагеря, как у поселенца знакомства: тот же лагерь —
      // те же тропы, и после перезахода никто не меняет дорогу.
      seed: (o.x * 73 + o.z * 131) ^ 0x0c40,
      // Палатки в клетках локации: жилец спит в своей, а какая его —
      // говорит номер, тот же, что у `hasRoof` и в веере.
      tents: camp.tents.map((t) => ({ x: o.x + t.x, z: o.z + t.z })),
    },
    camp.residents,
    (i) => hasRoof(camp, i),
  );
}

/** О чём кому говорить (`sim/talk.ts`): положение перекрывает занятие. */
const campTalkers = (): Talker[] =>
  camp.residents.map((r, i) => ({
    seed: r.seed,
    mood: !hasRoof(camp, i) ? 'без крыши' : r.rest ? 'отдых' : r.answer,
  }));

/**
 * Жильцы в кадре. Кто при деле — стоит на своём маршруте (дальше его водит
 * рутина), остальные сидят у костра лицом к огню — те же люди, что в веере.
 * Места ищутся тем же правилом, что у поселенца знакомства: свободная
 * клетка с чистыми соседями, мимо следов построек и мимо сидящего гостя.
 */
function seatResidents(): void {
  if (raid === null || raidView === null) return;
  planChores();
  const o = campOrigin(camp);
  const fire = { x: o.x + camp.layout.kitchen.x + 1, z: o.z + camp.layout.kitchen.z + 1 };
  const busy: Cell[] = [];
  const taken = (x: number, z: number): boolean => {
    if (meetAt !== null && x === meetAt.x && z === meetAt.z) return true;
    if (busy.some((c) => c.x === x && c.z === z)) return true;
    return PITCH_ORDER.some((id) => {
      const p = camp.layout[id];
      return x >= o.x + p.x && x <= o.x + p.x + 1 && z >= o.z + p.z && z <= o.z + p.z + 1;
    });
  };
  seatedBodies = [];
  const list = camp.residents.map((r, i) => {
    const chore = chores[i];
    if (chore !== undefined && chore !== null) {
      const at = choreAt(chore, campTime());
      return {
        look: r.look,
        tool: RESIDENT_TOOL[r.answer],
        x: at.x,
        z: at.z,
        facing: at.facing,
        seated: false,
      };
    }
    // Список обязан остаться той же длины, что жильцы: номера в нём — те же,
    // что в веере и в driveResident, и выпавший сдвинул бы всех за собой.
    // Не нашлось места у костра — жилец встаёт за огонь, а не исчезает.
    const sit = sitSpotNear(fire, raid!.loc, taken) ?? { x: fire.x + i, z: fire.z + 2 };
    busy.push(sit);
    seatedBodies.push({ x: sit.x + 0.5, z: sit.z + 0.5 });
    return {
      look: r.look,
      // Инструмент занятия — и у костра: топор у дерева, кирка у камня,
      // у отдыхающего руки пустые (§6.1.14).
      ...(r.rest ? {} : { tool: RESIDENT_TOOL[r.answer] }),
      x: sit.x + 0.5,
      z: sit.z + 0.5,
      facing: Math.atan2(fire.x - (sit.x + 0.5), fire.z - (sit.z + 0.5)),
      seated: true,
    };
  });
  raidView.setResidents(list);
}

/**
 * Кто что говорит сейчас — по строке на жильца, null — молчит.
 *
 * **Разговор двоих старше присказки.** Пара сходится у костра по расписанию
 * маршрута (`sim/chores.ts`), а очередь присказок про это расписание
 * не знает вовсе; совпади они — в кадре висели бы два пузыря там, где голос
 * обязан быть один. Поэтому пока пара стоит вместе, присказки молчат все,
 * включая паузу в конце разговора: молчание после последней реплики — часть
 * разговора, а не свободная секунда.
 *
 * Чистая функция часов лагеря, как и всё остальное здесь: зовут её и тик,
 * и кадр, и оба получают одно и то же.
 */
function campSpeech(): (string | null)[] {
  const talkers = campTalkers();
  const out: (string | null)[] = camp.residents.map(() => null);
  let chatting = false;
  chores.forEach((c, i) => {
    // Пара разбирается один раз — со стороны младшего номера: он же и первый
    // говорящий, `who === 0`.
    if (c === null || c.partner === null || c.partner < i) return;
    // Ведомого игроком в разговоре нет: его устами ходит игрок, и напарник
    // остался бы говорить с телом, которое водит чужая рука.
    if (i === controlled || c.partner === controlled) return;
    const at = choreAt(c, campTime());
    if (at.talk === null || at.hidden) return;
    chatting = true;
    const first = talkers[i];
    const second = talkers[c.partner];
    if (first === undefined || second === undefined) return;
    const line = chatAt(first, second, at.talk.since, at.talk.round);
    if (line !== null) out[line.who === 0 ? i : c.partner] = line.text;
  });
  if (chatting) return out;
  camp.residents.forEach((_, i) => {
    if (i === controlled) return;
    out[i] = phraseAt(talkers, i, campTime());
  });
  return out;
}

/**
 * Тик рутины: маршруты — чистая функция часов лагеря, разведённая телами
 * вокруг сидящих, героя и гостя. Ведомого игроком не трогаем: его позиция
 * принадлежит руке (§16.1).
 */
function stepChores(dt: number): void {
  if (raid === null || raidView === null || chores.length === 0) return;
  const now = campTime();
  const pinned = [{ x: raid.hero.x, z: raid.hero.z }, ...seatedBodies];
  if (meetAt !== null) pinned.push({ x: meetAt.x + 0.5, z: meetAt.z + 0.5 });
  const size = raid.loc.size;
  const free = (x: number, z: number): boolean => {
    const cx = Math.round(x);
    const cz = Math.round(z);
    if (cx < 0 || cz < 0 || cx >= size || cz >= size) return false;
    return choreMask === null || choreMask[idx(size, cx, cz)] === 0;
  };
  const frames = choresAt(chores, now, pinned, free);
  const speech = campSpeech();
  frames.forEach((f, i) => {
    if (f === null || i === controlled) return;
    // Спящий уходит из кадра целиком (§24): его не водят, не поворачивают
    // и не заставляют говорить. Ведомый игроком не спит вовсе — рука
    // игрока сильнее расписания.
    raidView!.setResidentHidden(i, f.hidden);
    sleeping[i] = f.hidden;
    if (f.hidden) return;
    const talking = !f.walking && !f.working && speech[i] !== null;
    raidView!.driveResident(i, f.x, f.z, f.walking, f.working, dt, {
      speed: DWELLER_SPEED,
      workClip: 'рубит',
      talking,
      glide: true,
    });
    // Лицо стоянки — к делу: рубящий смотрит на ствол, говорящий —
    // на напарника, вернувшийся — на огонь.
    if (!f.walking) raidView!.faceResident(i, f.facing, dt);
    // Ноша меняется дважды за круг — и ровно тогда её и перекладывают.
    if (f.carrying !== carried[i]) {
      carried[i] = f.carrying;
      raidView!.setResidentLoad(i, f.carrying ? camp.residents[i]?.answer ?? null : null);
    }
  });
}

/**
 * Реплики кадра: слова над головами. Кто говорит — решает `campSpeech`,
 * здесь остаётся то, чего симуляция не знает: где у говорящего макушка.
 */
function campBubbles(): void {
  if (raidView === null) {
    bubbles.clear();
    return;
  }
  const said: Bubble[] = [];
  campSpeech().forEach((text, i) => {
    if (text === null) return;
    // Спящего не слышно: пузырь над пустым местом читался бы голосом
    // из палатки, а жильцы во сне не разговаривают.
    if (sleeping[i] === true) return;
    const at = raidView!.residentAt(i);
    if (at === null) return;
    const seated = chores[i] === undefined || chores[i] === null;
    // Якорь — над макушкой: сидящему ниже, чем стоящему.
    said.push({ x: at.x, y: guardHeight() * (seated ? 0.75 : 1.05) + 0.3, z: at.z, text });
  });
  bubbles.sync(said);
}

/**
 * Посадить поселенца у лагеря (§16.1): после первой вылазки, пока в лагере
 * нет жильцов. Каждый вход — заново: человек пришёл знакомиться, а не
 * мелькнуть один раз.
 */
function seatSettler(door: Cell): void {
  meetAt = null;
  meetShown = false;
  if (raid === null || raidView === null) return;
  if (camp.raids < 1 || camp.residents.length > 0) return;
  const o0 = campOrigin(camp);
  const sit = sitSpotNear(door, raid.loc, (x, z) =>
    PITCH_ORDER.some((id) => {
      const p = camp.layout[id];
      return x >= o0.x + p.x && x <= o0.x + p.x + 1 && z >= o0.z + p.z && z <= o0.z + p.z + 1;
    }));
  if (sit === null) return;
  // Человек выводится из якоря лагеря: тот же лагерь — тот же человек,
  // и «а тот ли это был» перестаёт быть вопросом к памяти.
  const o = campOrigin(camp);
  meetSettler = generateSettler((o.x * 73 + o.z * 131) ^ 0x5eed);
  meet = startMeet(meetSettler);
  meetAt = sit;
  raidView.putSettler(
    meetSettler.look,
    sit.x + 0.5,
    sit.z + 0.5,
    Math.atan2(raid.hero.x - (sit.x + 0.5), raid.hero.z - (sit.z + 0.5)),
  );
  meetOn = meetCallbacks();
}

/**
 * Разговор случается там, где игрок стоит: панель открывается, когда герой
 * подошёл к сидящему, и гаснет, когда отошёл, — кнопки «закрыть» нет.
 */
function syncMeet(): void {
  if (raid === null || meet === null || meetSettler === null || meetAt === null) return;
  if (meet.invited) return;
  const near =
    Math.hypot(raid.hero.x - (meetAt.x + 0.5), raid.hero.z - (meetAt.z + 0.5)) <= 2.5;
  if (near && !meetShown) {
    meetShown = true;
    dialogHud(true);
    meetPanel.show(meetSettler, meet);
  } else if (!near && meetShown) {
    meetShown = false;
    meetPanel.hide();
    dialogHud(false);
  }
}

/**
 * Диалогу — весь низ. На время разговора панели лагеря и веер гаснут:
 * «Назваться» не должен драться с «В мир» за нижнюю кромку. Действует
 * только в лагере на поляне: отладочный кадр `?встреча` живёт в сцене
 * вылазки, где панелей лагеря и так нет.
 */
function dialogHud(on: boolean): void {
  if (!inGladeCamp) return;
  const quiet = quietFrame();
  campHud.setVisible(!on);
  heroFan.setVisible(!on && !quiet);
  // Карточки диалог только закрывает: их открывает тап по лицу, и после
  // разговора они сами не возвращаются.
  if (on) {
    heroCard.setVisible(false);
    residentCard.setVisible(false);
  }
}

/**
 * §20.1 — ковка. В отличие от стройки, она мгновенна и не занимает слот:
 * это и есть то действие, которое экран возврата предлагает, пока идёт таймер.
 */
function forge(slot: GearSlot): boolean {
  const block = gearBlock(camp, slot);
  // Причина спрашивается до попытки, а не после отказа: `'не вышло'` стояло
  // здесь ровно затем, чтобы объяснить случай, которого не бывает (§23.3).
  if (block !== 'ok') {
    campHud.notify(refusal(GEAR[slot].name, GEAR_REASON[block]));
    return false;
  }
  craftGear(camp, slot);
  const level = camp.gear[slot];
  track({ t: 'craft', at: clock.now(), slot, toLevel: level });
  // Раскадровка кончается здесь: игрок сковал первое, что обещала Мастерская.
  if (onboarding.step === 'craft') onboarding.set('done');
  campHud.notify(`${GEAR[slot].name} ур. ${level}`);
  persist();
  return true;
}

/**
 * §19 — экран сборов. Выбор обязателен и необратим: карта уходит в вылазку
 * тем же вызовом, каким игрок её нажал, и нигде не сохраняется.
 */
const draftScreen = new DraftScreen(app, {
  onChoose: (id) => {
    track({ t: 'draft', at: clock.now(), card: id });
    toRaid(pendingNode, id);
  },
});

/** Куда игрок собрался, пока выбирает карту. */
let pendingNode = 0;

/** Кнопка «Играть» ведёт сюда — и карточка входа после успеха тоже. */
const enterGame = (): void => (onboarding.step === 'glade' ? toGlade() : toCamp());

const startScreen = new StartScreen(app, {
  // До лагеря игрок доходит сам: кнопка открывает поляну, а лагерь
  // появляется в конце пролога как его результат. Но сперва — сессия:
  // заставка встречает всех, а карточка входа проявляется по «Играть»,
  // и только когда входить действительно нужно.
  onPlay: () => {
    if (hasSession) enterGame();
    else authCard.show();
  },
});

// Приглашение вселяется в нижнюю панель вылазки, а не приходит отдельным
// слоем: два нижних угла не знали друг о друге и налезали (§6.2.6).
const campPrompt = new CampPrompt(hud.promptSlot, {
  onShown: (visible) => hud.setPrompting(visible),
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
/**
 * «Уйти» закрывает экран, но герой ещё стоит у прилавка: без этого флага
 * подход открыл бы лавку обратно тем же тиком. Сбрасывается уходом ногами.
 */
let tradeLeft = false;

const tradePanel = new TradePanel(app, {
  onDeal: (give, take) => {
    if (!makeDeal(camp, give, take)) {
      // Отказ обязан быть слышен так же, как виден (§18.3).
      play('deny');
      // Потолок кладовой (§13.6) — единственный отказ прилавка, которого
      // не видно по кошельку: про него говорится словами.
      if (dealBlock(camp, give, take) === 'full' && raid !== null) {
        raid.events.push('Кладовая полна — обмену нет места');
      }
      return false;
    }
    play('build');
    // Сделка свободная: телеметрии важны обе оценки — по ним видно,
    // сколько переплачивают сверх спроса торговца.
    track({ t: 'trade', at: clock.now(), offer: 'deal', worth: worthOf(give), ask: askOf(take, (camp.trades ?? 0) - 1) });
    if (raid !== null) raid.events.push(TradePanel.gained(give, take));
    tradePanel.sync(camp);
    persist();
    return true;
  },
  onLeave: () => {
    tradeLeft = true;
    tradePanel.setVisible(false);
  },
});

/**
 * Подсказка гаснет, пока идёт разговор. Две строки внизу разом — это
 * не тесная вёрстка, а два указания сразу, чего раскадровка не разрешает
 * нигде: пока с игроком говорят, решать про ходьбу ему нечего.
 *
 * Гасится в одном месте, а не в трёх вызывающих: подсказку ставят и кадр
 * онбординга, и постановка лагеря, и цикл поляны, и договориться им между
 * собой не о чем — забыл бы первый же новый.
 */
const setHint = (text: string): void => hud.setHint(meetPanel.visible ? '' : text);

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
    // Облачную строку тоже стереть — иначе сейв воскреснет при следующем
    // входе. Но не дольше пары секунд: без сети «Новая игра» обязана
    // работать, как работала без облака.
    void Promise.race([cloudWipe(), new Promise((done) => setTimeout(done, 2000))]).finally(() =>
      location.reload(),
    );
  },
});

/**
 * Ворота облака. Сессия спрашивается заранее, но молча: заставка с травой
 * и названием встречает всех, а карточка входа проявляется по «Играть» —
 * и только если входить действительно нужно. После входа — сверка с
 * облаком: чужой сейв свежее — кадр перезагрузится уже на нём, иначе
 * игра продолжается тем же нажатием, которым началась.
 */
let hasSession = false;
void cloudUser().then((email) => {
  hasSession = email !== null;
});
const authCard = new AuthCard(app);
// Ссылка из письма открывает свою вкладку уже вошедшей; эта узнаёт
// о сессии через хранилище — карточка снимается, «Играть» снова играет.
cloudOnSignIn(() => {
  if (hasSession) return;
  hasSession = true;
  authCard.hide();
  void syncCloud();
});

const statsPanel = new StatsPanel(app);

function buy(id: ConsumableId): boolean {
  const block = buyBlock(camp, id);
  if (block !== 'ok') {
    campHud.notify(refusal(CONSUMABLES[id].name, BUY_REASON[block]));
    return false;
  }
  buyConsumable(camp, id);
  track({ t: 'consumable', at: clock.now(), id, phase: 'buy' });
  campHud.notify(`${CONSUMABLES[id].name} — в вылазку`);
  persist();
  return true;
}

/**
 * Кадры, открытые отладочным адресом, в сейв не пишут. Тестовый лагерь,
 * записанный поверх настоящего, при следующем входе читается как «меня
 * перенесло в чужой лагерь» — второй лагерь существует чисто для тестов
 * и границу сохранения не пересекает.
 */
const DEBUG_SCENE_PARAMS = ['tier', 'node', 'тест', 'castle', 'grave', 'тропа', 'встреча', 'город', 'бой', 'колесо'] as const;
const debugScene = DEBUG_SCENE_PARAMS.some((k) => debugParams.has(k));

function persist(): void {
  if (wiped || debugScene) return;
  save(camp, roster, clock.watermark, onboarding.step);
  pushCloud();
}

/* ---------- облачная копия сейва (§6) ---------- */

/**
 * Облако — копия, не источник: игра стартует с localStorage, как раньше,
 * и живёт без сети. На входе один вопрос: не свежее ли облачная строка
 * здешней — тогда её принесли с другого устройства, она ложится в хранилище
 * и кадр перезагружается уже на ней. Сверка по отметке часов, а не по
 * «кто позже записал»: перевод часов не должен решать, чей лагерь настоящий.
 *
 * Пуш включается только после этой сверки: отдать старый локальный сейв
 * до неё значило бы затереть в облаке свежий.
 */
let cloudReady = false;
let cloudTimer: ReturnType<typeof setTimeout> | null = null;

/** Отложка на несколько секунд: persist() зовётся на каждом событии,
 *  а облаку хватает последнего состояния, не каждого. */
function pushCloud(): void {
  if (!cloudReady || cloudTimer !== null) return;
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    const raw = rawSave();
    if (raw !== null) void cloudPush(raw, clock.watermark);
  }, 3000);
}

// Свёрнутая вкладка — последний шанс дожать отложенное: таймеры там не идут.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !cloudReady || wiped || debugScene) return;
  if (cloudTimer !== null) {
    clearTimeout(cloudTimer);
    cloudTimer = null;
  }
  const raw = rawSave();
  if (raw !== null) void cloudPush(raw, clock.watermark);
});

/**
 * Сверка с облаком — на входе, если сессия жива, и сразу после входа
 * с карточки. Отвечает, принят ли облачный сейв: принятый перезагружает
 * кадр, и продолжать нажатие «Играть» тогда не нужно.
 */
async function syncCloud(): Promise<boolean> {
  if (debugScene) return false; // тестовые кадры границу сохранения не пересекают
  const remote = await cloudPull();
  if (remote !== null && remote.watermark > clock.watermark && adoptRaw(remote.raw)) {
    location.reload();
    return true;
  }
  cloudReady = true;
  pushCloud();
  return false;
}
void syncCloud();

/**
 * Показ кадра — единственное место, где онбординг что-то показывает или
 * прячет. Полосы включаются здесь, а не в цикле: сравнивать состояние
 * каждый тик значило бы драться с игроком за видимость элементов.
 */
function showOnb(step: OnbStep, restore = false): void {
  hud.setReveal(reveal(step));
  setHint(ONB_HINT[step] ?? '');
  campHud.setOnboarding(step, restore);
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
  onGuard: () => {
    if (raid !== null && raidView?.battleBusy() !== true) commandBattle(raid, { kind: 'guard' });
  },
  onWait: () => {
    if (raid !== null && raidView?.battleBusy() !== true) commandBattle(raid, { kind: 'wait' });
  },
});

/** Ударить того, кого достаём. Если целей несколько — самого израненного:
 *  добить дешевле, чем начать нового, и это же правило у бота. */
function heroAttack(): void {
  if (raid === null || raid.battle === null) return;
  // Пока показ дочитывает прошлые ходы, новые не принимаются.
  if (raidView?.battleBusy() === true) return;
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
    enterNode(node);
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
  const block = upgradeBlock(camp, id);
  if (block !== 'ok') {
    // Отказ обязан быть слышен так же, как виден (§18.3).
    play('deny');
    campHud.notify(refusal(BUILDINGS[id].name, UPGRADE_REASON[block]));
    return false;
  }
  startUpgrade(camp, id, now);
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
    // §11.8 — Лазарет сокращает простой. Уровень читается здесь, а не внутри
    // отряда: расписание героя — его дело, а цена времени — дело лагеря.
    camp.levels.infirmary,
  );
  if (outcome.levels > 0) campHud.notify(`${name}: уровень ${hero.level}`);
  if (outcome.healSec > 0) {
    track({ t: 'heal_start', at: now, cls: hero.cls, wounds: outcome.wounds, seconds: outcome.healSec });
    // Здание называется только построенное. Прежде строка звала в Лазарет,
    // которого в игре не было вовсе; теперь он есть — но у того, кто его
    // не поставил, строка обязана остаться про время, а не про постройку.
    const where = camp.levels.infirmary > 0 ? `${BUILDINGS.infirmary.name}: ` : 'в строю через ';
    campHud.notify(
      `${name} ранен — ${where}${HeroCard.healText(outcome.wounds, camp.levels.infirmary)}`,
    );
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
/**
 * Кадры 9 и 10 показывают ровно одно действие: отряд и данные ждут.
 * Ждут — пока в лагере нет жильцов: как только человек принят, веер —
 * это уже не «данные», а люди, которым переключаются и приказывают,
 * и прятать их кадром значило бы прятать самих жильцов.
 */
const quietFrame = (): boolean =>
  (onboarding.step === 'build' || onboarding.step === 'craft') && camp.residents.length === 0;

function showScene(scene: Scene, tier: Tier = 0): void {
  // Панель стройки живёт только в лагере: оставшись открытой, она вооружала бы
  // палец поверх вылазки.
  if (scene !== 'camp' && buildPanel.visible) {
    buildPanel.setVisible(false);
    buildTool = null;
    campView.hideWallGhost();
  }
  const panels = panelsFor(scene, quietFrame());
  hud.setVisible(panels.hud);
  campHud.setVisible(panels.campHud);
  heroFan.setVisible(panels.roster);
  // Карточки героя и жильца не переживают смену сцены: их открывает тап
  // по лицу, а не сцена.
  heroCard.setVisible(false);
  residentCard.setVisible(false);
  statsPanel.setVisible(panels.stats);
  // §25 — хроника пересобирается на каждом показе заставки: к этому моменту
  // телеметрия уже пополнилась тем, чем кончилась прошлая сессия.
  if (panels.startScreen) startScreen.setChronicle(chronicle(events()));
  startScreen.setVisible(panels.startScreen);
  campPrompt.setVisible(panels.campPrompt);
  if (!panels.returnScreen) returnScreen.hide();

  const sound = soundFor(scene, tier);
  if (sound.ambient === null) stopAmbient();
  else startAmbient(sound.ambient);
  startCampTune(sound.campTune);
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
 * §19 — экран сборов встаёт между выбором точки и входом. Врезан здесь,
 * а не внутри `toRaid`: раздача обязана случиться **до** того, как вылазка
 * создана, — карта меняет её числа на входе, и подмешать их потом значило бы
 * пересобирать локацию под уже показанный игроку выбор.
 *
 * Прогулки (замок, кладбище) сюда не попадают: в них нечего добывать, и
 * карта, меняющая добычу и ставку, не значила бы там ничего.
 */
function enterNode(node: number): boolean {
  const now = clock.now();
  const day = dayAt(now);
  const place = regionAt(day).nodes[node];
  if (place === undefined || place.kind !== 'вылазка') return toRaid(node);
  if (!draftReady(camp, place.tier)) return toRaid(node);

  // Сид раздачи — от места и дня: перезаход в то же место в ту же смену даёт
  // ту же руку, и переброс через выход-вход невозможен (§19.1).
  const hand = deal(camp, place.tier, mulberry32(nodeSeed(day, node) ^ 0x19d7a));
  if (hand.length < HAND_SIZE) return toRaid(node);

  campHud.close();
  pendingNode = node;
  draftScreen.show(hand);
  return true;
}

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

/**
 * Место дня — или отказ, если регион пересобрался, пока панель была открыта.
 * Строка одна на обоих звавших: ручной вход и отправка (§26) упираются
 * в одну и ту же причину, а две её формулировки разошлись бы молча (§23.3).
 */
function placeAt(day: number, node: number): WorldNode | null {
  const place = regionAt(day).nodes[node];
  if (place === undefined) {
    campHud.notify('Регион пересобрался — выберите место заново');
    return null;
  }
  return place;
}

/**
 * §26 — отряд уходит в место без игрока. Билет собирается здесь, потому что
 * только здесь известны обе стороны: лагерь (`camp`) и отряд (`roster`).
 * Сам поход не считается ни секунды: он чистая функция от билета и будет
 * пересчитан на возвращении.
 */
function sendSortie(node: number): void {
  const now = clock.now();
  const day = dayAt(now);
  const place = placeAt(day, node);
  if (place === null) return;
  const block = sortieBlock(camp.sortie ?? null, roster, place.tier);
  const hero = freeHero(roster);
  if (block !== 'ok' || hero === null) {
    campHud.notify(block === 'ok' ? SORTIE_REASON.hero : SORTIE_REASON[block]);
    return;
  }
  const state = worldAt(now, camp.visits)[node];
  camp.sortie = ticketOf(
    node,
    place.tier,
    nodeSeed(day, node),
    hero,
    {
      // Лагерь и место замораживаются на выходе (§26): достроенный за время
      // пути Склад не имеет права менять поход, который уже идёт.
      kitchen: camp.levels.kitchen,
      storage: camp.levels.storage,
      loot: lootMul(state?.rich ?? 0),
      event: state?.event ?? null,
      gear: { ...camp.gear },
      offhand: camp.offhand,
      arrows: camp.arrows,
    },
    now,
  );
  hero.status = 'raid';
  hero.busyUntil = camp.sortie.endsAt;
  // Заход тратит богатство места — чужой заход и свой, ручной и нет (§4).
  camp.visits.push({ node, shift: shiftAt(now) });
  campHud.close();
  campHud.notify('Отряд ушёл');
  persist();
}

/**
 * §26 — отряд вернулся. Зовётся тиком лагеря, поэтому досчитывается и после
 * закрытой вкладки: тем же способом, что и стройка (`completeIfDue`).
 */
function collectSortie(now: number): boolean {
  const ticket = camp.sortie;
  if (!sortieDue(ticket, now) || ticket == null) return false;
  camp.sortie = null;
  const hero = roster.heroes.find((h) => h.id === ticket.hero) ?? null;
  if (hero === null) return true;
  const report = reportOf(ticket, hero);
  if (stash(camp, report.carried) > 0) campHud.notify(STORE_FULL);
  // §14.3 — выстреленное уходит из лагеря, донесённое возвращается.
  camp.arrows = Math.max(0, camp.arrows - report.arrowsSpent);
  hero.status = 'ready';
  hero.busyUntil = null;
  // Раны и опыт считает лагерь той же функцией, что и после ручной вылазки:
  // второй способ вернуть героя разошёлся бы с первым молча.
  applyRaidOutcome(
    hero,
    report.hpLeft,
    report.total,
    ticket.tier,
    !report.failed,
    now,
    camp.levels.infirmary,
  );
  track({
    t: 'sortie',
    at: now,
    tier: ticket.tier,
    failed: report.failed,
    carried: report.total,
    seconds: ticket.endsAt - ticket.startedAt,
  });
  campHud.notify(report.text);
  return true;
}

/**
 * Колесо призов — оверлей поверх карты, сцену рига не трогает. Исход
 * рождается здесь, из сида дня и места, а не из угла остановки: колесо
 * в `wheelView.ts` лишь довозит анимацию до готового ответа — иначе
 * результат зависел бы от кадровой частоты рендера.
 *
 * Замок суточный: карточка карты запирает кнопку той же проверкой,
 * а эта — на случай входа мимо карточки (отладка, гонка смены дня).
 */
function toWheel(seed: number): boolean {
  const day = dayAt(clock.now());
  if (camp.wheelDay === day) {
    campHud.notify('Колесо уже крутили сегодня — новая прокрутка завтра');
    return false;
  }
  // Колесо открывается с карты, а карта доступна и из прогулок: чужие
  // флаги сцены снимаются здесь, как у всех входов (см. leaveWalkSites).
  leaveWalkSites();
  const answer = 1 + Math.floor(mulberry32(seed ^ 0x5b1e)() * 10);
  wheelView?.dispose();
  wheelView = new WheelView(answer, {
    onClaim: (crystals) => {
      // Приз — приток извне, и потолок кладовой (§13.6) для него не
      // исключение: что не влезло, о том говорится.
      if (stash(camp, { crystal: crystals }) > 0) campHud.notify(STORE_FULL);
      camp.wheelDay = day;
      persist();
      campHud.notify(`Выпало ${crystals} — кристаллы уже в лагере`);
      closeWheel();
    },
    onLeave: () => closeWheel(),
  });
  return true;
}

function closeWheel(): void {
  wheelView?.dispose();
  wheelView = null;
}

/**
 * Вылазка в место на карте (§4). Ярус, ставка и богатство названы до входа
 * карточкой карты — сюда приходит уже принятое решение.
 */
function toRaid(node: number, chosen: DraftCardId | null = null): boolean {
  // Место и его богатство берутся на момент входа, а не на момент открытия
  // панели: панель могла провисеть полчаса, а смена мира — сорок минут.
  const now = clock.now();
  const day = dayAt(now);
  const place = placeAt(day, node);
  leaveTitle();
  inGlade = false;
  inGladeCamp = false;
  chop = null;
  campPrompt.setVisible(false);
  if (place === null) return false;
  // Замок (§6.1.6) — не вылазка: там нечего добывать и не с кем драться,
  // и заход в него не тратит ни богатство места, ни героя.
  if (place.kind === 'замок') return toCastle(node, nodeSeed(day, node));
  // Кладбище (§6.1.7) — та же прогулка, но населённая: добычи нет,
  // а привидения есть.
  if (place.kind === 'кладбище') return toGraveyard(node, nodeSeed(day, node));
  // Тропа (§6.1.17) — прогулка длинная: ход через лес, который проходят,
  // а не рассматривают. Добычи и противников нет — пока.
  if (place.kind === 'тропа') return toTrail(node, nodeSeed(day, node));
  // Колесо призов — аттракцион: одна прокрутка в день, кристаллы по сектору.
  if (place.kind === 'призы') return toWheel(nodeSeed(day, node));
  const tier = place.tier;
  // §3 — в вылазку идёт один герой, и он обязан быть свободен.
  const hero = heroForRaid();
  if (hero === null) {
    campHud.notify('Все герои заняты — лечатся или тренируются');
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
    // §19 — карта сборов. Тратится на текущую вылазку и не хранится.
    draft: chosen,
    // Первая вылазка держит выход закрытым до первой добычи (см. onboarding).
    evacOpen: !onboarding.inRaid,
  });
  // Из лагеря уходит взятое, а не вместимость: с §14.3 это разные числа —
  // колчан может быть шире, чем запас, который в него влез.
  camp.arrows = Math.max(0, camp.arrows - raid.arrows);
  // §21 — купленное уходит в вылазку и не возвращается: сгорает независимо
  // от того, пригодилось или нет. Копить нечего.
  camp.loadout = [];
  // Заход тратит богатство места — и чужой, и свой. Это единственная дельта,
  // которую мир хранит (§4): кланы и восстановление считаются функцией.
  camp.visits.push({ node, shift: shiftAt(now) });
  persist();
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'mine', null, null, null, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(18, true);
  setNight(1);
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
 * Гость у стен замка (`sim/castleGuest.ts`) и его разговор. Состояние живёт
 * при сцене, а не в сейве, — тем же правилом, что знакомство пролога:
 * не приглашённый сидит у своей палатки каждый заход заново, а приглашённый
 * вписан в жильцов, и это единственное, что переживает перезагрузку
 * (плюс сид замка в `camp.guests`, чтобы тот же замок не отдал его дважды).
 */
let castleGuest: CastleGuest | null = null;
let guestMeet: GuestMeet | null = null;
let guestShown = false;

/**
 * Разговор с гостем: кадры листает игрок, приглашение вписывает человека
 * в жильцы и переносит его хозяйство. Палатка достаётся лагерю бесплатно —
 * гость принёс свою, — а место ей и костру выбирает он сам (`guestPitch`).
 */
function guestCallbacks(): MeetPanelCallbacks {
  const redraw = (): void => {
    if (castleGuest === null || guestMeet === null) return;
    meetPanel.showGuest(castleGuest, guestMeet);
    setHint('');
  };
  return {
    onName: () => {},
    onAnswer: () => {},
    onAdvance: () => {
      if (guestMeet === null) return;
      advanceGuest(guestMeet);
      redraw();
    },
    onInvite: () => {
      if (castleGuest === null || guestMeet === null || castleNow === null) return;
      // Уговор сперва оплачивается, потом заключается: отказ называет,
      // чего не хватает, — той же полосой, что отказы обмена рядом (§13.5).
      const block = guestBlock(camp, castleGuest);
      if (block !== 'ok') {
        play('deny');
        raid?.events.push(GUEST_REASON[block]);
        return;
      }
      spend(camp.resources, GUEST_TERM_COST[castleGuest.term]);
      guestMeet.invited = true;
      // Сид замка — до всего остального: даже если места в лагере нет,
      // этот гость уже позван и второй раз у стен не сядет.
      (camp.guests ??= []).push(castleNow.loc.seed);
      // Что он ищет, тем и займётся (`GUEST_WORK`) — сид лица приходит
      // с человеком, как у поселенца знакомства.
      admit(camp, {
        name: castleGuest.who.name,
        look: castleGuest.who.look,
        seed: castleGuest.who.seed,
        answer: GUEST_WORK[castleGuest.seek],
        rest: false,
      });
      const pitch = guestPitch(camp, castleGuest.who.seed);
      if (pitch !== null) {
        camp.tents.push(pitch.tent);
        if (pitch.fire !== null) (camp.fires ??= []).push(pitch.fire);
      }
      persist();
      play('build');
      // Хозяйство он сворачивает с собой: у стен не остаётся ни палатки,
      // ни костра — они уже в лагере, на месте, которое он выбрал.
      raidView?.setTents([]);
      raidView?.setFires([]);
      // Встаёт и идёт к герою — тем же зовом, что поселенец пролога.
      if (raid !== null) raidView?.callSettler(raid.hero.x, raid.hero.z);
      advanceGuest(guestMeet);
      meetPanel.hide();
    },
  };
}

/**
 * Разговор с гостем открывается подходом и гаснет уходом — тем же жестом,
 * что лавка торговца (§13.5) и знакомство пролога: кнопки «закрыть» нет.
 */
function syncGuestMeet(): void {
  if (raid === null || castleGuest === null || guestMeet === null) return;
  if (guestMeet.invited) return;
  const near =
    Math.hypot(
      raid.hero.x - (castleGuest.sit.x + 0.5),
      raid.hero.z - (castleGuest.sit.z + 0.5),
    ) <= 2.5;
  if (near && !guestShown) {
    guestShown = true;
    meetOn = guestCallbacks();
    meetPanel.showGuest(castleGuest, guestMeet);
    setHint('');
  } else if (!near && guestShown) {
    guestShown = false;
    meetPanel.hide();
  }
}

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

/** Тропа, пока по ней идут: ручка отладочной сцены `?тропа`. */
let trailSite: TrailSite | null = null;

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
  trailSite = null;
  tradePanel.setVisible(false);
  // Гость живёт при сцене замка: сцены нет — нет ни гостя, ни разговора.
  castleGuest = null;
  guestMeet = null;
  if (guestShown) meetPanel.hide();
  guestShown = false;
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
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'grave', null, site, null, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Ниже, чем в замке: ограда не прячет участок, и подниматься над ней,
  // чтобы заглянуть внутрь, не нужно — через неё и так видно.
  rig.setZoom(22, true);
  // Сумерки: кладбище стоит на поверхности, но не полдень же на нём.
  setNight(0.45);
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
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'castle', site, null, null, camp.gear.weapon, mateClasses(raid));
  // Гость у стен (`sim/castleGuest.ts`): выводится из сида площадки, а живёт
  // ли ещё здесь — решает лагерь. Позванный не сидит у стен второй раз,
  // и тёзка живущего не садится вовсе: `admit` различает людей именем,
  // и второго человека с тем же именем игра завести не может.
  const guest = castleGuestAt(site);
  if (
    guest !== null &&
    !(camp.guests ?? []).includes(site.loc.seed) &&
    !camp.residents.some((r) => r.name === guest.who.name)
  ) {
    castleGuest = guest;
    guestMeet = startGuestMeet();
    raidView.setTents([guest.tent]);
    raidView.setFires([guest.fire]);
    raidView.putSettler(
      guest.who.look,
      guest.sit.x + 0.5,
      guest.sit.z + 0.5,
      Math.atan2(guest.fire.x - (guest.sit.x + 0.5), guest.fire.z - (guest.sit.z + 0.5)),
    );
  }
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Замок выше всего, что игра показывала до сих пор: с высоты вылазки
  // стена закрывала бы двор целиком.
  rig.setZoom(26, true);
  // День: замок стоит на поверхности, и подземный мрак спрятал бы его.
  setNight(0.1);
  resultShown = false;
  ear.reset(raid);
  showScene('raid', 0);
  return true;
}

/**
 * Тропа (§6.1.17). Собирается тем же `createRaid`, что все прогулки: ходьба,
 * шаг и камера обязаны считаться одинаково везде.
 *
 * Как у замка — ни добычи, ни противников, ни голода, и выход открыт сразу:
 * уйти можно с любого шага, потому что уходить не от чего. Герой не занимается
 * той же причиной, что на прогулках-участках: заход не обязан снимать
 * с ротации того, кто просто прошёлся.
 */
function toTrail(node: number, seed: number): boolean {
  const hero = heroForRaid() ?? roster.heroes[0]!;
  chop = null;
  const site = generateTrailSite(seed);
  leaveWalkSites();
  trailSite = site;
  raidNode = node;
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
    // §13.3 — на тропе рубят: лес вокруг и есть то, что здесь добывают.
    // Кромка не открывается никогда (`logging.ts`), так что просека
    // расширяется, но локацию не вскрывает.
    logging: true,
  });
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'trail', null, null, site, camp.gear.weapon, mateClasses(raid));
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Ниже всех сцен игры, ниже даже вылазки: рассматривать здесь нечего,
  // а теснота просеки, стена стволов и «конца не видно» читаются только
  // с близкой камеры — высокая раскрывала карту и отменяла длину.
  rig.setZoom(15, true);
  // Лесная тень: светлее сумерек кладбища, темнее двора замка — под кронами
  // не полдень, но и не вечер.
  setNight(0.2);
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
  setNight(0.08);
  inGlade = false;
  inGladeCamp = false;
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

/**
 * Годна ли клетка под след 2×2 — `siteBlock` плюс сундук пролога:
 * про сундук (`chests.ts`, след 1×1) проверка симуляции не знает,
 * и костёр мог бы накрыть его молча.
 */
function pitchOk(cell: Cell): boolean {
  if (raid === null) return false;
  if (siteBlock(raid.loc, pitched, raid.hero, cell) !== 'ok') return false;
  const c = gladeChest;
  return c === null || c.x < cell.x || c.x >= cell.x + 2 || c.z < cell.z || c.z >= cell.z + 2;
}

/** Свободная клетка рядом с героем — с неё начинается выбор места. */
function siteNearHero(): Cell {
  if (raid === null) return { x: 0, z: 0 };
  const hx = Math.round(raid.hero.x);
  const hz = Math.round(raid.hero.z);
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const c = { x: hx + dx, z: hz + dz };
    if (pitchOk(c)) return c;
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
  setHint(PITCH_HINT[id] ?? '');
  const c = siteNearHero();
  raidView?.showSite(id, c.x, c.z, pitchOk(c));
}

/** Тап по земле в режиме выбора места. */
function tryPlace(cell: Cell): void {
  if (placing === null || raid === null) return;
  const ok = pitchOk(cell);
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
  // Вместе с палаткой встаёт её кладовая — первый сундук (`chests.ts`).
  // Бесплатно и здесь, а не в лагере: прибавка к рюкзаку показывается
  // в кадре, где игрок только что познакомился с рюкзаком. Сейв, начатый
  // до сундуков, уже получил свой при чтении — второго не полагается.
  if (placing === 'hq' && camp.chests.length === 0 && gladeChest === null) {
    const spot = chestSiteNear(raid.loc, pitched, raid.hero, cell);
    if (spot !== null) {
      gladeChest = spot;
      raidView?.setChests([spot]);
      raid.events.push(`Сундук у палатки: кладовая +${CHEST_BONUS}`);
    }
  }
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
    say(CHOP_REASON[block]);
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
    say(CHOP_REASON[step.stopped]);
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
    // В лагере рюкзака нет (§13.5): дерево идёт прямо в кладовую, просека
    // пишется в снимок поляны — срубленное обязано пережить перезагрузку.
    if (inGladeCamp) {
      if (stash(camp, raid.bag) > 0) campHud.notify(STORE_FULL);
      raid.bag = emptyResources();
      raid.bagTotal = 0;
      camp.glade = packGlade(raid.loc);
      campHud.sync(camp, clock.now(), 0);
      persist();
    }
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
    say(MINE_REASON[block]);
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
    say(MINE_REASON[step.stopped]);
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
    // в кладовой, а не в рюкзаке. Через `stash`: в свежую кладовую горстка
    // пролога влезает всегда, но второго входа мимо потолка не бывает.
    stash(camp, raid.bag);
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
    setHint(hint);
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
  // Кадр не меняется вовсе: то, что на экране в момент третьего бруска, —
  // это и есть лагерь. Сцена, камера, зум, свет, лес и герой остаются как
  // стоят; подменяется только нижний интерфейс — панель лагеря вместо полос
  // вылазки. Отдельная сцена лагеря (CampView) осталась старым сейвам без
  // снимка поляны и отладочным адресам — «второй лагерь чисто для тестов».
  if (raid !== null) {
    adoptGladeLayout(camp, raid.loc.size, PITCH_ORDER, pitched);
    camp.glade = packGlade(raid.loc);
    // Сундук пролога — тем же переносом, что здания: где встал, там и стоит,
    // якорь площадки уже посчитан. Не встал на поляне вовсе (лес вплотную) —
    // примется у Жилья: прибавку к рюкзаку молча терять нельзя.
    if (camp.chests.length === 0) {
      const o = campOrigin(camp);
      adoptChest(camp, gladeChest === null
        ? { x: -1, z: -1 }
        : { x: gladeChest.x - o.x, z: gladeChest.z - o.z });
    }
  }
  onboarding.set('world');
  inGlade = false;
  inGladeCamp = true;
  showScene('camp');
  campHud.showWalls(false);
  idleSeconds = 0;
  onboarding.apply();
  persist();
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
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'glade', null, null, null, camp.gear.weapon, [], debugFluffy);
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(20, true);
  // Поляна — на поверхности, и это день. Подземный мрак вылазки здесь
  // спрятал бы лес, ради которого кадр и существует.
  setNight(0.12);
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
  gladeChest = null;
  raidView.hideSite();
  // Поляна на поверхности — подложка «Подступы», светлая (§18.4).
  showScene('raid', 0);
  onboarding.apply();
  // §9 — поляна не пишет `raid_start`. Она сцена вылазки по устройству, но не
  // вылазка по смыслу: выхода нет, добычи нет, кончается она постройкой лагеря
  // и `raid_end` не пишет никогда. Начало без конца перекашивало выборку —
  // «Вылазок» считало то, что не заканчивалось.
}

/** Лагерь на поляне (§16.1): сцена пролога и есть сцена лагеря. */
let inGladeCamp = false;

/** Наработанное за отлучку — первым и один раз, общий у обеих сцен лагеря. */
function notifyWorked(): void {
  if (worked.length === 0 || workShown) return;
  workShown = true;
  campHud.notify(`Пока вас не было: ${worked.map((w) => `${RESOURCE_NAME[w.kind]} ${w.n}`).join(' · ')}`);
}

/**
 * Вход в лагерь. Тел у него два. Нормальная игра — поляна: лагерь стоит там,
 * где кончился пролог, и сцена не подменяется никогда (`toGladeCamp`).
 * Площадка CampView — язык старых сейвов без снимка поляны и отладочных
 * адресов: второй лагерь существует чисто для тестов (`toPadCamp`).
 */
function toCamp(): void {
  // Снятие прошлой сцены повторится в теле — и пусть: вызов идемпотентен,
  // а правило арх-теста «каждый to* начинается с уборки» дороже одной строки.
  leaveWalkSites();
  if (camp.glade !== undefined) toGladeCamp();
  else toPadCamp();
}

/**
 * Лагерь на поляне: та же локация, что в прологе, — из снимка в сейве
 * (`camp.glade`), с палаткой и костром на клетках, которые выбрал игрок.
 * Вызывается на загрузке и на возврате из вылазки; в момент конца пролога
 * не вызывается вовсе — там сцена уже стоит и не трогается (`endGlade`).
 */
function toGladeCamp(): void {
  leaveTitle();
  leaveWalkSites();
  chop = null;
  campMine = null;
  raidView?.dispose();
  const glade = camp.glade!;
  const blocked = unpackGlade(glade);
  const o = campOrigin(camp);
  const hq = { x: o.x + camp.layout.hq.x, z: o.z + camp.layout.hq.z };
  // Герой встаёт у входа в палатку, а не в её следе: клетка к югу от следа,
  // при занятости — первая свободная по соседям следа.
  let door = { x: hq.x + 1, z: hq.z + 2 };
  if (blocked[idx(glade.size, door.x, door.z)]) {
    outer: for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
        const c = { x: hq.x + dx, z: hq.z + dz };
        if (c.x < 0 || c.z < 0 || c.x >= glade.size || c.z >= glade.size) continue;
        if (!blocked[idx(glade.size, c.x, c.z)]) { door = c; break outer; }
      }
    }
  }
  const loc: GameLocation = {
    seed: 0,
    tier: 0,
    size: glade.size,
    blocked,
    evac: door,
    // Бруски пролога подобраны, валунов на поляне нет (§13.4), врагов тоже:
    // камень и добычу приносят вылазки.
    containers: [],
    stones: [],
    enemies: [],
    backSteps: distanceField(glade.size, blocked, door),
  };
  const hero = heroForRaid() ?? roster.heroes[0]!;
  raidHero = null;
  raid = createRaid({
    seed: 0,
    tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    // В лагере на площадке герой один — на поляне тоже: спутники ходят
    // в вылазку, а не за ведущим по двору. Отряд целиком виден в веере.
    followers: [],
    loc,
    // Провиант в лагере ничего не отсчитывает (§18.4): полосы скрыты
    // сценой 'camp', а запас пополняется каждый тик.
    food: gladeFood(),
    capacity: gladeCapacity(),
    evacOpen: false,
    containerFood: 0,
    hunger: false,
    risk: false,
    // Лес лагеря рубится (§13.3): дерево — сразу в кладовую, просека
    // остаётся в снимке поляны навсегда.
    logging: true,
  });
  controlled = -1;
  parkedHero = null;
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'glade', null, null, null, camp.gear.weapon, [], debugFluffy);
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  // Постройки пролога — на своих клетках поляны. Ставится только то, что
  // игрок видел на поляне: Склад построен по правилам с начала игры, но
  // в кадре его не было — и не появится, пока стройка не станет видимой.
  for (const id of PITCH_ORDER) {
    raidView.place(id, o.x + camp.layout[id].x, o.z + camp.layout[id].z);
    raidView.setLevel(id, camp.levels[id]);
  }
  raidView.hideSite();
  // Палатки — до посадки жильцов: их клетки входят в маску маршрутов,
  // а маску собирает `planChores` внутри `seatResidents`.
  raidView.setTents(camp.tents.map((t) => ({ x: o.x + t.x, z: o.z + t.z })));
  raidView.setChests(camp.chests.map((c) => ({ x: o.x + c.x, z: o.z + c.z })));
  raidView.setFires((camp.fires ?? []).map((f) => ({ x: o.x + f.x, z: o.z + f.z })));
  seatSettler(door);
  bubbles.clear();
  seatResidents();
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(20, true);
  // Свет лагеря идёт по смене мира (§24): в какой час игрок вошёл,
  // такой и застал. Ставится и здесь, и каждый кадр — иначе первый кадр
  // после входа успел бы мигнуть вчерашним значением.
  setNight(nightAt(campTime()));
  resultShown = false;
  inGlade = false;
  inGladeCamp = true;
  placing = null;
  restAcc = 0;
  resting = false;
  gladeHint = '';
  ear.reset(raid);
  notifyWorked();
  showScene('camp');
  campHud.showWalls(false);
  idleSeconds = 0;
  onboarding.apply();
  persist();
}

function toPadCamp(): void {
  leaveTitle();
  leaveWalkSites();
  chop = null;
  campMine = null;
  // §18.4 — подложка вылазки обрывается на выходе, и пульс вместе с ней:
  // в лагере провиант ничего не отсчитывает. Взамен — единственная
  // мелодия игры, и звучит она только здесь: всё это в таблице сцены.
  inGlade = false;
  inGladeCamp = false;
  raidView?.dispose();
  raidView = null;
  raid = null;
  campView.group.visible = true;
  campView.setCamp(camp);
  // Наработанное называется первым и один раз: это то, что уже случилось,
  // и сказать о нём позже задания значило бы отдать строку тому, что ещё
  // только просят. Задание никуда не денется — оно живёт своей строкой
  // и не гаснет через четыре секунды.
  if (worked.length > 0 && !workShown) {
    notifyWorked();
  } else if (homeless(camp) > 0) {
    campHud.notify(
      homeless(camp) === 1 ? 'Гостю негде спать — нужна палатка' : `Без крыши: ${homeless(camp)}`,
    );
  }
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
  setNight(0.22);
  // Стены и ограды, построенные игроком, — часть лагеря: они встают вместе
  // с ним, а не по открытию панели.
  campView.setWalls(wallPieces(wallsOf()));
  campView.setFences(fencePieces(wallsOf()));
  campView.setRoads(roadSpots(wallsOf()));
  campView.setLamps(lampSpots(wallsOf()));
  campHero = createCampHero(camp);
  campView.setHero(campHero.x, campHero.z, campHero.facing, campHero.y);
  showScene('camp');
  campHud.showWalls(true);
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
  // На поляне панорамы нет: жест лагеря-на-поляне — прологовый, тап-ходьба,
  // и камера ходит за героем.
  active: () => mode === 'camp' && buildTool === null && !inGladeCamp,
  center: () => campView.center,
  area: () => campArea(camp.levels.hq),
  onTap: (clientX, clientY) => campTap(clientX, clientY),
  onTouch: () => {
    idleSeconds = 0;
  },
});

/** Тап приходит в мире, лагерь считает в клетках площадки: якорь (§16.1)
 *  вычитается один раз на входе, дальше все координаты — местные. */
function campLocal(p: { x: number; z: number }): { x: number; z: number } {
  const o = campOrigin(camp);
  return { x: p.x - o.x, z: p.z - o.z };
}

function campTap(clientX: number, clientY: number): void {
  const ground = rig.screenToGround(clientX, clientY);
  if (ground === null) return;
  const hit = campLocal(ground);
  // Любой тап бросает кайло: игрок занялся чем-то другим. Тап по тому же
  // валуну начнёт работу заново — с нуля, а не с середины, и это честно:
  // отойти и вернуться значит начать сначала.
  stopCampMining();
  const picked = campView.buildingAt(hit.x, hit.z);

  // Палатка вооружена кнопкой задания: этот тап — выбор места, и целиком
  // он и есть, чем бы ни кончился. Правило то же, что у перестановки ниже:
  // вооружённый жест съедает тап, отказ обязан быть слышен.
  if (placingTent) {
    pitchTentAt(hit.x, hit.z);
    return;
  }
  // Сундук вооружён карточкой Склада — правило то же, что у палатки.
  if (placingChest) {
    placeChestAt(hit.x, hit.z);
    return;
  }

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
  const lifted = rig.screenToGround(clientX, clientY, undefined, WALK * CASTLE_CELL);
  const up = lifted === null ? null : campLocal(lifted);
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

  // Тап по жильцу — его карточка с приказами: человек в кадре и лицо
  // в веере — один список, и открываются они одинаково. Жилец спрашивается
  // раньше здания по той же причине, что валун: здание ловит тап с запасом
  // в клетку, а человек — только собой, и иначе жилец у палатки был бы
  // нетапаемым.
  const resident = campView.residentAt(hit.x, hit.z);
  if (resident !== null) {
    campHud.close();
    campView.highlight(null);
    shownResident = resident;
    heroCard.setVisible(false);
    residentCard.sync(camp, resident);
    residentCard.showMenu();
    return;
  }

  // Тап по сундуку — лист кладовой (§13.6): сундук ловится ровно своей
  // клеткой и спрашивается раньше здания по правилу валуна и жильца —
  // иначе сундук у Склада был бы нетапаемым.
  if (camp.chests.some((c) => c.x === cell.x && c.z === cell.z)) {
    campView.highlight(null);
    campHud.openStore();
    return;
  }

  // Лагерь: сцена первая. Тап по зданию открывает его карточку, тап мимо —
  // ведёт героя и закрывает лист, то есть возвращает игроку весь экран.
  campView.highlight(picked);
  // Карточки людей уступают место любому исходу тапа: листу здания —
  // иначе они висели бы поверх него, — и просто земле: экран возвращается
  // игроку целиком.
  heroCard.setVisible(false);
  residentCard.setVisible(false);
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
  // Сколько именно дал валун, знает только сам тик: награда у валунов
  // разная (3–5), и строка обязана называть настоящее число, а не константу.
  const stoneBefore = camp.resources.stone;
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
    campHud.notify(MINE_REASON[step.stopped]);
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
    campHud.notify(`+${camp.resources.stone - stoneBefore} · ${RESOURCE_NAME.stone}`);
    campHud.sync(camp, clock.now(), 0);
    play('levelup');
    stopCampMining();
    persist();
  }
}

/**
 * Работы текущего кадра — для полос прогресса (`render/workbar.ts`).
 *
 * Собирается каждый рендер из того же состояния, которым работа считается:
 * стройка §20.1 — из слота лагеря, рубка и добыча — из начатой работы.
 * Своего состояния у полос нет, и врать им не из чего: кончилась работа —
 * кончилась и полоса, тем же кадром.
 *
 * Условие «герой дошёл» то же, что у пятна под работой: пока он в дороге,
 * работы ещё нет, и полоса над деревом врала бы о том, что топор стучит.
 */
function syncWorkBars(): void {
  const items: WorkItem[] = [];
  if (mode === 'camp') {
    const c = camp.construction;
    if (c !== null) {
      const o = campOrigin(camp);
      const p = camp.layout[c.building];
      const total = Math.max(1, c.endsAt - c.startedAt);
      const share = (clock.now() - c.startedAt) / total;
      // Обе сцены рисуют здание в середине следа [p, p+2) — в p+0.5:
      // полоса висит над нарисованным, и нарисованное совпадает со следом.
      const at = { x: o.x + p.x + 0.5, z: o.z + p.z + 0.5 };
      // Остаток цифрами — только у стройки: минуты полосой не видны,
      // а восемь секунд рубки видны и без цифр.
      items.push({
        x: at.x,
        y: 1.6,
        z: at.z,
        share,
        left: formatDuration(Math.max(0, c.endsAt - clock.now())),
      });
    }
  }
  if ((mode === 'raid' || inGladeCamp) && raid !== null && raid.path.length === 0) {
    if (chop !== null) items.push({ x: chop.cell.x, y: 1.9, z: chop.cell.z, share: chopProgress(chop) });
    if (mine !== null) items.push({ x: mine.cell.x, y: 1.1, z: mine.cell.z, share: mineProgress(mine) });
  }
  if (mode === 'camp' && !inGladeCamp && campMine !== null && campHero.path.length === 0) {
    const o = campOrigin(camp);
    items.push({
      x: o.x + campMine.work.cell.x,
      y: 1.1,
      z: o.z + campMine.work.cell.z,
      share: mineProgress(campMine.work),
    });
  }
  workBars.sync(items);
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
  // Лагерь на поляне: жест прологовый. Тап по палатке или костру открывает
  // карточку здания, тап мимо — ведёт героя. Ловятся только те здания,
  // которые стоят в кадре (PITCH_ORDER): Склад построен по правилам, но
  // на поляне его не видно, и карточка невидимого читалась бы как поломка.
  if (inGladeCamp) {
    if (raid === null) return;
    const hit = rig.screenToGround(e.clientX, e.clientY);
    if (hit === null) return;
    const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
    const o = campOrigin(camp);
    // Выбор места палатки — раньше людей и зданий: жест вооружён кнопкой
    // задания, и этот тап целиком его. Поляна считает в мире, палатка —
    // в клетках площадки, якорь вычитается здесь же.
    if (placingTent) {
      pitchTentAt(hit.x - o.x, hit.z - o.z);
      return;
    }
    // Сундук — тем же жестом и в тех же клетках площадки, что палатка.
    if (placingChest) {
      placeChestAt(hit.x - o.x, hit.z - o.z);
      return;
    }
    // Тап по сидящему жильцу — его карточка и передача ведения: то же,
    // что тап по лицу в веере. Человек спрашивается раньше палатки:
    // он сидит в её запасе, и иначе тап по нему открывал бы здание.
    const near = raidView === null ? null : raidView.residentNear(hit.x, hit.z);
    if (near !== null) {
      campHud.close();
      shownResident = near;
      heroCard.setVisible(false);
      residentCard.sync(camp, near);
      residentCard.showMenu();
      controlResident(near);
      return;
    }
    // Тап по сундуку — лист кладовой (§13.6): сундук ловится ровно своей
    // клеткой и спрашивается раньше зданий — их запас в клетку накрыл бы его.
    if (camp.chests.some((c) => o.x + c.x === cell.x && o.z + c.z === cell.z)) {
      heroCard.setVisible(false);
      residentCard.setVisible(false);
      campHud.openStore();
      return;
    }
    // Запас в клетку вокруг следа 2×2 — как у площадки: в здание надо
    // попадать пальцем, а не курсором. Побеждает ближайший след, а не первый
    // по списку: палатка и костёр стоят рядом, их запасы пересекаются,
    // и тап у костра не должен открывать палатку — костёр сам по себе.
    let picked: BuildingId | null = null;
    let best = Infinity;
    for (const id of PITCH_ORDER) {
      const p = camp.layout[id];
      const d = Math.hypot(cell.x - (o.x + p.x + 0.5), cell.z - (o.z + p.z + 0.5));
      if (d <= 1.9 && d < best) {
        best = d;
        picked = id;
      }
    }
    // Карточки людей уступают место любому исходу тапа: листу здания —
    // иначе они висели бы поверх него, — и просто земле: экран возвращается
    // игроку целиком.
    heroCard.setVisible(false);
    residentCard.setVisible(false);
    if (picked !== null) {
      campHud.openBuilding(picked);
      return;
    }
    campHud.close();
    // Тап по дереву — рубка (§13.3), тем же жестом, что в прологе: идёт сам
    // и работает, когда дойдёт. Рубит тот, кого ведут, — герой или жилец.
    if (raid.logging && treeAt(raid.loc, cell)) {
      startChopping(cell);
      return;
    }
    if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
    return;
  }
  if (mode !== 'raid') return;
  const hit = rig.screenToGround(e.clientX, e.clientY);
  if (hit === null) return;
  const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  // Выбор места перебивает ходьбу: провиант кончился, идти всё равно некуда.
  if (placing !== null) {
    // Угловая клетка следа 2×2 из точки под пальцем — та же арифметика,
    // что у наведения выше и у перестановки зданий (`moveSelected`).
    tryPlace({ x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) });
    return;
  }
  if (raid === null || raid.status !== 'running') return;

  // §11.3 — бой перехватывает палец целиком: пока идёт ход, тап значит
  // «шагнуть сюда» или «ударить того», а не «идти по локации».
  if (inBattle(raid)) {
    // Пока показ дочитывает прошлые ходы, поле не принимает новых: игрок
    // не должен ходить в бой, которого ещё не увидел.
    if (raidView?.battleBusy() === true) return;
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
  // Вооружённая палатка или сундук: пятно 1×1 едет за мышью, как пятно
  // здания в прологе. На телефоне наведения нет — пятно остаётся на
  // предложенной клетке, показанной при вооружении.
  if (placingTent || placingChest) {
    const o = inGladeCamp ? campOrigin(camp) : { x: 0, z: 0 };
    showPlacingSpot({ x: Math.round(hit.x) - o.x, z: Math.round(hit.z) - o.z });
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
  // Палец показывает середину следа 2×2, данные держат его угловую клетку:
  // полклетки вычитаются, как у перестановки зданий (`moveSelected`).
  const cell = { x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) };
  raidView?.showSite(placing, cell.x, cell.z, pitchOk(cell));
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
 * Отладочный кадр `?бой` (§6: воспроизводимость): пошаговый бой сразу,
 * не проходя вылазку до драки. Открывает вылазку — ярус можно задать
 * через `?tier=N`, иначе берётся первый боевой узел, — и ставит героя
 * вплотную к противнику: контакт завязывается первым же тиком.
 * Значение выбирает вид: `?бой=маг`, `?бой=воин`, `?бой=скелет`.
 */
const debugBattleKind = debugParams.get('бой');
if (debugBattleKind !== null) {
  if (raid === null) {
    const place = today.find((n) => n.kind === 'вылазка' && n.tier >= 1) ?? today.find((n) => n.kind === 'вылазка');
    if (place !== undefined) toRaid(place.id);
  }
  // `toRaid` пишет модульную переменную; поток типов через вызов этого
  // не видит, поэтому ссылка перечитывается явно.
  const fightRaid = raid as RaidState | null;
  if (fightRaid !== null) {
    const KIND_BY_NAME: Record<string, EnemyKind> = { 'скелет': 'minion', 'воин': 'warrior', 'маг': 'mage' };
    const want = KIND_BY_NAME[debugBattleKind];
    const foes = fightRaid.loc.enemies.filter((e) => e.hp > 0);
    const target = foes.find((e) => want !== undefined && e.kind === want) ?? foes[0];
    if (target !== undefined) {
      // Свободная клетка рядом с противником — герой встаёт на неё всем
      // отрядом: расстановку по гексам разведёт сам бой (`placeOn`).
      const { size, blocked } = fightRaid.loc;
      const near = [
        { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
        { x: 1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 },
      ]
        .map((d) => ({ x: Math.round(target.x) + d.x, z: Math.round(target.z) + d.z }))
        .find((c) => c.x >= 0 && c.z >= 0 && c.x < size && c.z < size && blocked[idx(size, c.x, c.z)] === 0);
      if (near !== undefined) {
        for (const f of fightRaid.party) {
          f.x = near.x;
          f.z = near.z;
          f.prevX = near.x;
          f.prevZ = near.z;
        }
        // Будится группа, а не один: кадр заведён смотреть бой, и втягивание
        // соседей (§11.7) — часть того, на что смотрят.
        for (const e of foes) {
          if (Math.hypot(e.x - target.x, e.z - target.z) <= 4.5) e.awake = true;
        }
      }
    }
    // Ручка к состоянию — тем же приёмом, что `?tier` (`камень`).
    (window as unknown as { бой: unknown }).бой = {
      вылазка: () => raid,
      поле: () => raid?.battle ?? null,
      показ: () => raidView?.battleBusy() ?? false,
      // Внутренности показа — поля приватные для кода, но не для отладки.
      ход: () => (raidView as unknown as { playNow: unknown } | null)?.playNow ?? null,
      хвост: () => (raidView as unknown as { battlePlays: unknown[] } | null)?.battlePlays.length ?? 0,
    };
  }
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
 * `?тест` — лагерь как он есть. Имя нарочно не «camp»: лагерь — то, что
 *   игрок разбивает в прологе, а это чисто тестовый кадр.
 * `?тест=walls` — лагерь с готовым кольцом стен: ворота, башня, лестница.
 *   Ровно та планировка, на которой видно все четыре ответа сразу — ход
 *   поверху, разрыв на башне, проезд под воротами и подъём.
 *
 * Сцены отладочные и живут только в `npm run dev`: в сборку они попадают,
 * но открыть их можно лишь адресом, которого в игре нет.
 */
const debugCamp = debugParams.get('тест');
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
  } else {
    // Площадь посередине роста и полный кошелёк: сцена заведена, чтобы
    // тестировать стройку, ковку и палатки, а не копить на них со старта.
    // Жильё нарочно не на потолке: у стройки обязаны оставаться ступени,
    // иначе проверять на этой сцене нечего. Сейв это не трогает —
    // отладочные адреса его не пишут (`persist`).
    camp.levels.hq = 3;
    camp.levels.kitchen = 2;
    camp.levels.storage = 2;
    camp.levels.forge = 1;
    camp.resources.wood = 500;
    camp.resources.stone = 500;
    camp.resources.iron = 100;
    camp.resources.crystal = 50;
  }
  // Площадка напрямую, мимо маршрутизатора: второй лагерь существует
  // чисто для тестов, и сейв с поляной не должен уводить кадр отладки.
  toPadCamp();
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
    // Жильцы и палатки (`residents.ts`) числами: строка задания говорит,
    // чего не хватает, но не говорит, кто в лагере и кто что ответил.
    жильцы: () => ({
      люди: camp.residents.map((r) => `${r.name} (${r.look}, ${residentState(r)})`),
      крыш: roofs(camp),
      'без крыши': homeless(camp),
      палаток: camp.tents.length,
      палатку: tentReason(camp),
    }),
    // Приказ из консоли: смотреть, как топор сменяется киркой или ложится
    // на отдых, можно без карточки — тем же `assignWork`, что и кнопка.
    приказ: (index: number, order: 'строим' | 'ходим' | 'отдых') => {
      if (!assignWork(camp, index, order)) return 'не приказ';
      persist();
      const r = camp.residents[index]!;
      return `${r.name}: ${residentState(r)}`;
    },
    // Поставить палатку: цена списывается, место выбирается тем же правилом,
    // что и в игре.
    палатка: () => {
      const spot = buildTent(camp);
      if (spot === null) return tentReason(camp);
      campView.setCamp(camp);
      persist();
      return spot;
    },
    // Один кадр интерфейса руками. Нужна, потому что вкладка в фоне
    // не получает кадров вовсе (`document.hidden`), а строка задания
    // красится в общем `sync`: без этой ручки её состояние из консоли
    // не проверить, только глазом на переднем окне.
    кадр: () => campHud.sync(camp, clock.now(), 0),
    // Отлучка руками: ждать полчаса, чтобы посмотреть на прибавку, —
    // не проверка. Кладёт ровно то же, что положила бы загрузка.
    отлучка: (seconds: number) => {
      const done = collectWork(camp, seconds);
      campHud.sync(camp, clock.now(), 0);
      persist();
      return done.map((w) => `${RESOURCE_NAME[w.kind]} ${w.n}`);
    },
    // Гость из ниоткуда: проверять палатки, каждый раз проходя знакомство,
    // — не проверка. Имя раздаётся по счёту, потому что повтор не принимается.
    гость: (answer: 'строим' | 'ходим' = 'строим') => {
      admit(camp, {
        name: `Гость ${camp.residents.length + 1}`,
        look: 'поселенец',
        seed: camp.residents.length + 1,
        answer,
        rest: false,
      });
      persist();
      return homeless(camp);
    },
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
 *
 * `?castle=СИД` — с назначенным сидом, как у `?grave`: гость у стен
 * (`castleGuest.ts`) есть у трети замков, и ждать сегодняшнего сида
 * с гостем — не проверка, а лотерея.
 */
const debugCastle = debugParams.get('castle');
if (debugCastle !== null) {
  const place = today.find((n) => n.kind === 'замок');
  if (debugCastle === '') {
    if (place !== undefined) toRaid(place.id);
  } else {
    const seed = Number(debugCastle);
    leaveTitle();
    toCastle(place?.id ?? 0, Number.isFinite(seed) ? seed : 1);
  }
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
    // Гость у стен (`castleGuest.ts`): кто, откуда, что ищет и где сидит.
    // Ждать замка с гостем — лотерея, а тут видно и «гостя сегодня нет».
    гость: () =>
      castleGuest === null
        ? null
        : {
            он: castleGuest.who,
            откуда: castleGuest.origin,
            ищет: castleGuest.seek,
            уговор: castleGuest.term,
            отказ: guestBlock(camp, castleGuest),
            палатка: castleGuest.tent,
            костёр: castleGuest.fire,
            сидит: castleGuest.sit,
            шаг: guestMeet?.step ?? null,
          },
    // Герой и тап по клетке: прозрачность стен (§6.1.6.1) включается тем,
    // что он вошёл во двор, и без ручки к нему сцена этого не показывает —
    // до ворот пришлось бы идти пешком.
    raid: () => raid,
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
    rig,
  };
}

/**
 * `?встреча` — прогалина и сидящий поселенец. Сцена заведена под один
 * вопрос, на который нельзя ответить рассуждением: **читается ли сидящий
 * живым и небоеспособным** — и не дёргается ли он на вставании.
 *
 * Смещение на вставании держит правило (`rigged.rules.ts`): каталог набора
 * обещал до полклетки, на нашем риге вышло 0,083, и круг «сидит → встаёт →
 * покой» возвращает особь в точку старта. Глазом здесь остаётся то, чего
 * число не скажет: читается ли сидящий живым и небоеспособным.
 *
 * Поляна взята готовая (`toGlade`): у неё тот же лес, что у лагеря, и это
 * не экономия, а то же решение, по которому лес у поляны и лагеря один —
 * герой выходит из него и в нём же встаёт лагерем.
 *
 * Чего в сцене нет: ни разговора, ни палаток, ни приглашения как решения.
 * Пока не видно, что сидящий читается, строить на нём нечего.
 */
/**
 * Состояние знакомства живёт рядом со сценой, а не в лагере: пока кадр
 * отладочный, писать его в сохранение нечем и незачем — приглашение ещё
 * ничего не открывает, и палаток под жильцов не существует.
 */
/** Причина словом — для отладочных ручек: они печатают строку, а не код. */
const tentReason = (state: typeof camp): string => {
  const why = tentBlock(state);
  return why === 'ok' ? 'можно' : TENT_REASON[why];
};

if (debugParams.has('встреча')) {
  toGlade();
  const hero = raid!.hero;
  // Клетка ищется свободная, а не назначается смещением: поляна заросшая,
  // и первый же назначенный сдвиг посадил поселенца в ёлку — снаружи это
  // читалось не «сидит», а «его нет». Прогалина обязана быть прогалиной,
  // и на поляне это значит непроходимых клеток вокруг нет.
  const n = raid!.loc.size;
  const openAround = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
        if (raid!.loc.blocked[cz * n + cx] !== 0) return false;
      }
    }
    return true;
  };
  let sitX = Math.round(hero.x);
  let sitZ = Math.round(hero.z);
  // Ближе двух клеток он попадает под героя, дальше четырёх — за кромку
  // кадра, а сцена именно про то, как он читается рядом.
  for (let r = 2; r <= 4 && (sitX === Math.round(hero.x) && sitZ === Math.round(hero.z)); r++) {
    for (let z = Math.round(hero.z) - r; z <= Math.round(hero.z) + r; z++) {
      for (let x = Math.round(hero.x) - r; x <= Math.round(hero.x) + r; x++) {
        if (Math.round(Math.hypot(x - hero.x, z - hero.z)) !== r || !openAround(x, z)) continue;
        sitX = x;
        sitZ = z;
        break;
      }
      if (sitX !== Math.round(hero.x) || sitZ !== Math.round(hero.z)) break;
    }
  }
  // Лицом к герою: сидящий спиной читается брошенной вещью, а не человеком.
  const satAt = { x: sitX + 0.5, z: sitZ + 0.5 };
  // Поселенец выводится из сида поляны: тот же адрес даёт того же человека,
  // и «а тот ли это был» перестаёт быть вопросом к памяти.
  meetSettler = generateSettler(raid!.loc.seed);
  meet = startMeet(meetSettler);
  raidView!.putSettler(meetSettler.look, satAt.x, satAt.z, Math.atan2(hero.x - satAt.x, hero.z - satAt.z));

  meetOn = meetCallbacks();
  meetPanel.show(meetSettler, meet);
  setHint('');
  // Камера сцены наводится сама: разговор идёт в двух клетках, а поляна
  // 24×24, и открывать сцену видом на весь лес значило бы каждый раз
  // доводить её руками из консоли.
  rig.lookAt(satAt.x, satAt.z, true);
  rig.setZoom(9, true);
  (window as unknown as { камень: unknown }).камень = {
    rig,
    raid: () => raid,
    поселенец: () => raidView?.settlerAt() ?? null,
    // Зов: встаёт и идёт к герою. Ходьба ждёт конца клипа — оборванное
    // вставание и есть тот рывок, который сцена проверяет.
    позвать: () => raidView?.callSettler(raid!.hero.x, raid!.hero.z),
    посадить: (look: DwellerLook = 'поселенец') =>
      raidView?.putSettler(look, satAt.x, satAt.z, Math.atan2(raid!.hero.x - satAt.x, raid!.hero.z - satAt.z)),
    // Разговор целиком: кто он, на каком кадре стоим, как назвался игрок
    // и что досталось. Глазом из панели видно только текущую строку.
    знакомство: () => (meet === null ? null : {
      он: meetSettler,
      шаг: meet.step,
      герой: meet.heroName,
      ответ: meet.answer,
      позвал: meet.invited,
      дар: giftOf(meet),
      кошелёк: { ...camp.resources },
    }),
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
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

/**
 * `?тропа` — лесная тропа сегодняшнего региона сразу, `?тропа=СИД` — с
 * назначенным сидом (§6.1.17). Длина, виляние спины и грунт выводятся
 * из сида: чтобы посмотреть на длинную тропу, ждать нужной точки
 * на карте — не проверка, а лотерея.
 */
const debugTrail = debugParams.get('тропа');
if (debugTrail !== null) {
  const place = today.find((n) => n.kind === 'тропа');
  const seed = debugTrail === '' ? nodeSeed(dayAt(clock.now()), place?.id ?? 0) : Number(debugTrail);
  leaveTitle();
  toTrail(place?.id ?? 0, Number.isFinite(seed) ? seed : 1);
  (window as unknown as { камень: unknown }).камень = {
    rig,
    site: () => trailSite,
    // Длина, ветвление и обочина — числа, ради которых сцена и заведена:
    // тропа обещает быть длиннее ширины и вести в тупики, и это видно ручкой.
    тропа: () => (trailSite === null ? null : {
      локация: trailSite.loc.size,
      длина: trailSite.length,
      грунта: trailSite.path.length,
      отвилков: trailSite.branches.length,
      валунов: trailSite.loc.stones.length,
    }),
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
  };
}

/**
 * `?колесо` — колесо призов сразу, `?колесо=СИД` — с назначенным сидом.
 * Сид решает сектор: проверять, что колесо довозит до каждого из десяти,
 * перебором дней на карте — не проверка, а лотерея про лотерею.
 * Сейв ручка не пишет: `persist()` глушится любым отладочным кадром.
 */
const debugWheel = debugParams.get('колесо');
if (debugWheel !== null) {
  const seed = debugWheel === ''
    ? nodeSeed(dayAt(clock.now()), today.find((n) => n.kind === 'призы')?.id ?? 0)
    : Number(debugWheel);
  leaveTitle();
  toWheel(Number.isFinite(seed) ? seed : 1);
  (window as unknown as { камень: unknown }).камень = {
    // Ответ пересчитан той же формулой: ручка обязана говорить, куда колесо
    // обязано довезти, чтобы расхождение было видно числом, а не на глаз.
    ответ: () => 1 + Math.floor(mulberry32((Number.isFinite(seed) ? seed : 1) ^ 0x5b1e)() * 10),
    // Нутро сцены: скрытая панель превью замораживает rAF, и «застряло»
    // от «крутится» снаружи не отличить — ручка отличает числом.
    колесо: () => wheelView,
  };
}

/**
 * `?город` — улица генератора домов (§6.1, набор Medieval Village MegaKit),
 * `?город=СИД` — с назначенным сидом. Города в игре ещё нет, и сцена заведена
 * под один вопрос: читается ли порядок домов — пролёты, этажи, материалы
 * и крыши, собранные планом (`render/village.ts`), — раньше, чем городу
 * появится место на карте. Ждать этого места, чтобы посмотреть на дом,
 * было бы не проверкой, а лотереей.
 *
 * Ручка `камень.город(сид)` пересобирает улицу на месте: сравнивать два сида
 * перезагрузкой значило бы терять кадр, на который смотришь.
 */
const debugTown = debugParams.get('город');
if (debugTown !== null) {
  // Площадка напрямую, мимо маршрутизатора, как у прочих отладочных кадров;
  // лагерь прячется целиком — улица приносит свою землю.
  toPadCamp();
  campView.group.visible = false;
  let town: ReturnType<typeof streetScene> | null = null;
  const show = (seed: number): number => {
    if (town !== null) {
      rig.world.remove(town.group);
      town.dispose();
    }
    town = streetScene(seed, 10);
    rig.world.add(town.group);
    rig.lookAt(town.center[0], town.center[1], true);
    rig.setZoom(34, true);
    return seed;
  };
  const first = Number(debugTown);
  show(debugTown === '' || !Number.isFinite(first) ? 1 : first);
  (window as unknown as { камень: unknown }).камень = {
    rig,
    город: (seed: number) => show(seed),
    // Спецификации домов улицы: пролёт, глубина, этажи, материал — то,
    // чего не прочитать глазом, если дом загородил соседа.
    дома: () => town?.street.map((h) => ({ ...h.spec, x: +h.x.toFixed(1), z: +h.z.toFixed(1) })) ?? null,
  };
}

/**
 * `?веер` — дуга аватаров под большой палец (`features/fan`).
 *
 * Сцена заведена под один вопрос: со скольких человек контрол перестаёт
 * помещаться под палец. Отряд — это трое (§11.8), и трое влезают куда угодно;
 * веер обсуждался как способ брать разом **всех** людей лагеря, а жильцов
 * (`residents.ts`) бывает десятки. Ёмкость дуги сцена считает, промахи мерит
 * упражнением, досягаемость обводится пальцем — назначать её числом
 * из статьи было бы ответом без замера.
 *
 * Люди подаются игрой, а не выдумываются фичой: сперва отряд, потом жильцы
 * лагеря, и лишь дальше выдуманные гости — чтобы длина и вид подписей были
 * теми же, что в игре. Имена в пуле не бесконечны, поэтому повтор получает
 * номер: два «Гиты» на дуге сделали бы задание упражнения двусмысленным.
 */
if (debugParams.has('веер')) {
  // За веером стоит лагерь, а не заставка: размер слота и длина подписи
  // читаются только на настоящем кадре. Сам веер экран забирает — промах
  // по контролу обязан быть промахом по контролу, а не попаданием в лагерь.
  // Площадка напрямую: сцена отладочная, поляна ей ни к чему.
  toPadCamp();
  // Игровой веер на время сцены убирается: два веера на экране — это
  // не замер, а спор двух дуг за один палец.
  heroFan.setVisible(false);
  heroCard.setVisible(false);
  const guests = (n: number): FanPerson[] => {
    const out: FanPerson[] = [];
    for (let i = 0; i < n; i++) {
      const seed = 1000 + i * 7;
      const s = generateSettler(seed);
      out.push({ name: s.name, kind: 'жилец', look: s.look, seed, state: s.look, asking: false });
    }
    return out;
  };
  installFan({
    // Полосы игры веер спрашивает у самой панели: высота нижней строки
    // зависит от безопасной зоны телефона, и списать её числом значило бы
    // разойтись с вёрсткой на первом же аппарате.
    reserve: () => campHud.bands(),
    people: (n: number) => {
      const all: FanPerson[] = [
        ...roster.heroes.map((h) => ({
          name: HERO_CLASSES[h.cls].name,
          kind: 'герой' as const,
          look: h.cls,
          seed: h.id,
          state: h.status,
          asking: false,
        })),
        ...camp.residents.map((r, i) => ({
          name: r.name,
          kind: 'жилец' as const,
          look: r.look,
          seed: 100 + i,
          state: r.answer,
          asking: false,
        })),
        ...guests(n),
      ].slice(0, n);
      // Метка «вопрос» здесь расставлена узором, и это честнее, чем кажется:
      // заполнить её пока нечем — отряд ходит целиком (§11.8), а у жильца
      // состояний, кроме крыши, нет вовсе. Сцена проверяет не «кто спросил»,
      // а видно ли пятно на дуге и не сливается ли оно с соседним слотом.
      const seen = new Map<string, number>();
      return all.map((p, i) => {
        const n2 = (seen.get(p.name) ?? 0) + 1;
        seen.set(p.name, n2);
        return { ...p, name: n2 === 1 ? p.name : `${p.name} ${n2}`, asking: i % 3 === 1 };
      });
    },
  });
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
        rig.update(1 / 60, raid.hero.x, raid.hero.z, raid.vision);
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

/**
 * Тик систем лагеря: таймеры стройки, отряд, панель. Общий у обеих сцен
 * лагеря — площадки и поляны (§16.1): лагерь один, сцен у него две.
 */
function stepCampSystems(dt: number, now: number): void {
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
    // §26 — отряд возвращается тем же тиком, что и стройка: слот освобождается
    // одинаково, и досчитывается он после закрытой вкладки так же.
    if (collectSortie(now)) persist();
    if (tickHeroes(now)) persist();
    campHud.sync(camp, now, dt);
    // §14.3 — колчан показывается только стрелку, а класс живёт в ростере:
    // лагерь про героев не знает, и сказать ему может только тот, кто знает
    // обоих.
    campHud.setRanged(HERO_CLASSES[activeHero(roster).cls].ranged);
    // §26 — карте нужен отряд: есть ли кого отправить, знает ростер.
    campHud.setRoster(roster);
    // Ведущий отмечен на лице, а карточка держит того, кого выбрали.
    heroFan.picked = controlled >= 0 ? roster.heroes.length + controlled : roster.active;
    if (shownHero >= roster.heroes.length) shownHero = roster.active;
    heroFan.draw();
    heroCard.setBottom(campHud.bands().bottom + 6);
    heroCard.sync(roster, shownHero, now, camp.levels.yard, camp.gear, camp.offhand);
    residentCard.setBottom(campHud.bands().bottom + 6);
    // Крыша могла появиться или пропасть, пока карточка открыта.
    if (residentCard.visible) residentCard.sync(camp, shownResident);
}

startLoop({
  update: (dt) => {
    const now = clock.now();
    // На заставке не тикает ничего: таймеры стройки досчитываются при входе
    // в лагерь тем же completeIfDue, что и после закрытой вкладки.
    if (mode === 'title') return;
    if (inGladeCamp && raid !== null) {
      // Лагерь на поляне: ходьба — прологовая, а провиант в лагере ничего
      // не отсчитывает (§18.4) — запас пополняется тем же тиком, что тратит.
      stepRaid(raid, dt, false, 0);
      raid.food = raid.foodMax;
      stepChopping(dt);
      if (controlled >= 0) {
        raidView?.driveResident(
          controlled,
          raid.hero.x,
          raid.hero.z,
          raid.path.length > 0,
          chop !== null,
          dt,
        );
      }
      // Остальные живут сами: маршруты рутины и очередь реплик (§6.1.15).
      stepChores(dt);
      syncMeet();
      stepCampSystems(dt, now);
      return;
    }
    if (mode === 'raid' && raid !== null) {
      const woundsBefore = raid.hero.hp;
      stepRaid(raid, dt, rig.night > 0.5, raid.loadout.knowledge);
      // Рана обязана быть замечена телом, а не только глазом. Кадр 3
      // онбординга завёл эту тряску ради первой раны; со сменой модели боя
      // (§11.3) удар стал стоить разного числа ран, и молчать про них
      // за пределами раскадровки перестало быть допустимо.
      //
      // Раны боя трясут кадр из показа (`onHeroHit`), а не отсюда: симуляция
      // решает раунд мгновенно, и тряска раньше видимого удара читалась бы
      // как сбой. Здесь остаются раны вне боя — голод.
      if (raidView !== null) raidView.onHeroHit = shake;
      if (raid.hero.hp < woundsBefore && raid.battle === null) shake();
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
        if (!near) tradeLeft = false;
        const show = near && !tradeLeft;
        if (show !== tradePanel.visible) tradePanel.setVisible(show);
        if (show) tradePanel.sync(camp);
        // Гость у стен: разговор тем же жестом подхода, что лавка выше.
        syncGuestMeet();
      }
      // Рубка идёт после шага и до уха: упавшее дерево ложится в рюкзак,
      // а прибавку в рюкзаке ухо озвучивает само (§18.1).
      stepChopping(dt);
      stepMining(dt);
      // §6.1.17 — у тропы два конца, и дальний тоже выход. Сим знает один
      // `evac` (вход), второй конец сторожит сцена: та же клетка — тот же
      // уход, с тем же лучом над ней.
      if (
        trailSite !== null &&
        raid.status === 'running' &&
        raid.steps > 0 &&
        raid.hero.x === trailSite.exit.x &&
        raid.hero.z === trailSite.exit.z
      ) {
        raid.status = 'evacuated';
        raid.path = [];
      }
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
        /**
         * §9 — прогулка по замку и кладбищу не вылазка, и в статистику не
         * идёт. Различает их герой: настоящая вылазка идёт кем-то и зачисляет
         * ему раны и опыт, у прогулки `raidHero` пуст с самого входа.
         *
         * Считалось это раньше наоборот: прогулки писали `raid_end` и растили
         * `camp.raids`, не написав начала. Глубина выхода — «цифра важнее
         * остальных» (§11.11) — считалась вместе с ними, а у прогулки глубина
         * бессмысленна: ходить там некуда и не за чем.
         */
        const counts = raidHero !== null;
        // §14.3 — невыстреленное и подобранное возвращается вместе с героем.
        // Провалившийся не возвращает ничего: он и добычу теряет по §11.2,
        // и колчан у него отняли там же.
        if (result.status === 'evacuated') camp.arrows += result.arrowsLeft;
        // §13.6 — потолок кладовой: не поместившееся пропадает, и об этом
        // говорится. Молчаливая потеря добычи хуже самой потери.
        if (stash(camp, result.carried) > 0) campHud.notify(STORE_FULL);
        if (counts) camp.raids += 1;
        finishRaidForHero(raid, result.carriedTotal, result.status === 'evacuated', now);
        for (const id of result.fired) {
          track({ t: 'consumable', at: now, id, phase: 'fire' });
        }
        persist();
        if (counts) track({
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

    stepCampSystems(dt, now);
  },

  render: (alpha) => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastRender) / 1000);
    lastRender = now;

    returnScreen.update();
    stepWind(dt);
    // Пузыри живут только в лагере на поляне: любой другой кадр их чистит,
    // и слова не переживают говорящего при смене сцены.
    if (inGladeCamp) campBubbles();
    else bubbles.clear();
    // Полосы прогресса — каждый кадр и в любой сцене: список сам пустеет
    // там, где работ нет, и чистить его отдельной веткой не нужно.
    syncWorkBars();

    if (mode === 'title' && titleView !== null) {
      // Полная частота, а не 30 кадров лагеря: камеру здесь тянут пальцем,
      // и половинная частота читается как залипание, а не как экономия.
      titleView.update(now / 1000);
      rig.lookAt(titleView.center.x, titleView.center.z);
      rig.update(dt, titleView.center.x, titleView.center.z, 12);
      rig.renderWith(titleView.camera);
      return;
    }

    if ((mode === 'raid' || inGladeCamp) && raid !== null && raidView !== null) {
      /**
       * Небо лагеря поворачивается по смене мира (§24). Значение идёт
       * через `setNight`, а не в `rig.night` напрямую, ровно ради `?night=`:
       * отладочный свет обязан перебивать сценарный, иначе замер на конкретной
       * темноте перестал бы повторяться.
       *
       * Кадр поляны идёт по ветке вылазки — на полной частоте и без
       * замирания, — поэтому ход неба ничего не стоит по батарее. Вылазку
       * это не трогает: под землёй время суток не при чём, там своя тьма.
       */
      if (inGladeCamp) setNight(nightAt(campTime()));
      raidView.sync(raid, alpha, dt, now, rig.dayFactor);
      // §11.3 — панель боя живёт вместе с полем. Досягаемость считает поле
      // теми же правилами, которыми применит ход: кнопка, предлагающая
      // невозможное, хуже отсутствующей.
      const battleBusy = raidView?.battleBusy() === true;
      if (raid.battle !== null) {
        const unit = current(raid.battle);
        const canHit = unit !== undefined && unit.side === "hero"
          && targets(raid.battle, raid.loc.size, raid.loc.blocked, unit).length > 0;
        battleHud.setVisible(true);
        // Пока показ дочитывает прошлые ходы, панель молчит: предлагать ход
        // в бой, которого игрок ещё не увидел, — значит звать ходить вслепую.
        battleHud.sync(raid.battle, canHit, partyByUnit(raid), battleBusy);
      } else {
        battleHud.setVisible(false);
      }
      // §11.3 — в бою камера ведёт того, чей ход. Иначе игрок смотрит
      // на героя, пока где-то за краем кадра ходит противник, и решение,
      // ради которого бой сделан пошаговым, принимается вслепую.
      // Пока идёт показ — камера на том, кто ходит на экране, а не на том,
      // до кого симуляция уже досчитала очередь.
      const focus = raidView?.battleFocus() ?? null;
      if (focus !== null) {
        rig.lookAt(focus.x, focus.z);
      } else if (raid.battle !== null) {
        const acting = current(raid.battle);
        const at = acting === undefined ? null : hexToWorld(acting.hex);
        if (at !== null) rig.lookAt(at.x, at.z);
        else rig.lookAt(raid.hero.x, raid.hero.z);
      } else {
        rig.lookAt(raid.hero.x, raid.hero.z);
      }
      // Число берётся из состояния, а не считается заново: слагаемых у обзора
      // три (§11.4), и своя формула здесь роняла бы фонарь и обвал с экрана.
      rig.update(dt, raid.hero.x, raid.hero.z, raid.vision);
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
      // На площадке стоит тот, кем сейчас ведут отряд (§11.8): его же лицо
      // отмечено кольцом в веере. Смена ведущего обязана быть видна в лагере,
      // а не только в карточке.
      campView.setHeroClass(activeHero(roster).cls);
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
      if (hud.showsStats) hud.setStats(
        `${Math.round(fpsFrames / fpsAcc)} fps · ${rig.drawCalls} draw` +
          (blades > 0 ? ` · ${blades} трав.` : ''),
      );
      fpsAcc = 0;
      fpsFrames = 0;
    }
  },
});
