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
  archeryQuiverBonus,
  buildingFits,
  campQuiverCapacity,
  campArea,
  campOrigin,
  completeIfDue,
  craftGear,
  buyArrows,
  gearBlock,
  moveBuilding,
  speedup,
  setOffhand,
  claimDailyCoins,
  coinsOf,
  earnCoins,
  speedupCost,
  startUpgrade,
  upgradeBlock,
  UPGRADE_REASON,
  GEAR_REASON,
  watchtowerVision,
} from './sim/camp';
import type { BuildingId, CampState } from './sim/camp';
import { FOOD_COST } from './sim/config';
import {
  completeResearchIfDue,
  grantResearchNotes,
  researchBagBonus,
  researchContainerDiscount,
  researchFoodBonus,
  researchInfirmaryBonus,
  researchScoutingBonus,
  startResearch,
} from './sim/research';
import { GEAR, MAX_ITEM_LEVEL, OFFHAND } from './sim/gear';
import type { GearSlot, Offhand } from './sim/gear';
import {
  HERO_CLASSES,
  MAX_HERO_LEVEL,
  MAX_SKILL_LEVEL,
  SKILLS,
  activeHero,
  applyRaidOutcome,
  firstReady,
  loadout,
  raidBlock,
  refreshHeroes,
  selectHero,
  skillEffect,
  spendSkill,
  spendStat,
  startTraining,
  syncRoster,
  stats,
  trainBlock,
  trainCap,
  trainPerLevel,
  xpToNext,
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
  storeCapacity,
} from './sim/chests';
import {
  CLAIM_REASON,
  GIFT_ARROWS,
  claimBlock,
  claimed,
  dayOf,
  emptyDaily,
  giftAt,
  giftLoot,
  giftTier,
  guestSeed,
} from './sim/daily';

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
  mineYield,
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
import type { ResourceKind } from './sim/resources';
import { claimSupplyBox, supplyClaimSeed } from './sim/lootboxClaim';
import { adoptRaw, load, rawSave, save, wipe } from './sim/save';
import {
  cloudCamp,
  cloudAcceptClanInvite,
  cloudAcceptGameReferral,
  cloudClanInvite,
  cloudClanInvitePreview,
  cloudGameReferral,
  cloudCampLikeStates,
  cloudCamps,
  cloudEnsureClan,
  cloudNeighbours,
  cloudLanguage,
  cloudOnSignIn,
  cloudSetLanguage,
  cloudPull,
  cloudPush,
  cloudSortieClaim,
  cloudSortieStart,
  cloudTime,
  cloudTelegramSignIn,
  cloudToggleCampLike,
  cloudUser,
  cloudWheel,
  cloudWorldSnapshot,
  cloudVisits,
  cloudWipe,
} from './core/cloud';
import {
  clanInviteLink,
  clanInviteStartToken,
  gameReferralStartToken,
  gameReferralLink,
  initPlatform,
  platformKind,
  shareClanInvite,
  shareGameInvite,
} from './core/platform';
import { AuthCard } from './ui/authCard';
import { StorePanel } from './ui/storePanel';
import { campDecorStyle, campFireStyle, clanHeraldry } from './core/cosmetics';
import {
  DAY_SEC,
  KIND,
  SHIFT_SEC,
  WAKE_AT,
  dayAt,
  installWorldSnapshot,
  liveVisits,
  lootMul,
  nightAt,
  nodeSeed,
  regionAt,
  shiftAt,
  worldAt,
} from './sim/world';
import type { Visit, WorldNode } from './sim/world';
import { worldUnlock } from './sim/worldUnlock';
import { campLevel, campPower } from './sim/standing';
import type { LiveCamp } from './sim/standing';
import { BuildPanel, type BuildCategory } from './ui/buildPanel';
import { ResearchPanel, researchNameMessage } from './ui/researchPanel';
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
  acceptMinotaurQuest,
  claimMinotaurRelic,
  completeMinotaurQuest,
  generateMinotaurCastle,
  makeMinotaurTrade,
  minotaurResourceText,
  minotaurTradeRewardText,
  type MinotaurCastleSite,
} from './sim/minotaurCastle';
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
import { generateGraveSite, readEpitaph, stepGraveNpcs } from './sim/graveSite';
import { generateTrailSite, type TrailSite } from './sim/trailSite';
import {
  caravanEncounter,
  caravanSurvivor,
  clearCaravanApproach,
  hearAboutCaravan,
  rescueCaravaner,
  settleSupply,
  startRoadStory,
} from './sim/roadStory';
import type { SupplyRoute } from './sim/roadStory';
import {
  activeRoadMission,
  completeRoadMission as recordRoadMission,
  reportBridgeShortfall,
  settleBridge,
  startBridgeStory,
} from './sim/roadBridge';
import type { RoadMissionAction } from './sim/roadBridge';
import { ROAD_MISSION_COPY } from './ui/roadStoryCopy';
import { DEAL_REASON, askOf, dealBlock, makeDeal, marketKey, pruneBought, stockOf, worthOf } from './sim/trade';
import type { Stock } from './sim/trade';
import { TradePanel } from './ui/tradePanel';
import { MinotaurPanel } from './ui/minotaurPanel';
import type { GraveSite } from './sim/graveSite';
import { events, loadTelemetry, setTelemetrySink, track } from './sim/telemetry';
import { analyticsIdentify, startAnalytics } from './core/analytics';
import type { Cell, EnemyKind, GameLocation, Tier } from './sim/types';
import { CampView } from './render/campView';
import { FarmView } from './render/farmView';
import { SignpostLayer } from './render/signposts';
import { gearIcon } from './render/gearIcon';
import { giftIcon } from './render/giftIcon';
import { CursorWind } from './render/cursorWind';
import { RewardBurst } from './render/rewardBurst';
import { TiltWind } from './render/tiltWind';
import { RaidView } from './render/raidView';
import { SceneRig } from './render/scene';
import { TitleView } from './render/titleView';
import { WheelView } from './render/wheelView';
import { streetScene } from './render/village';
import { CampHud } from './ui/campHud';
import type { FlyTarget } from './ui/campHud';
import { VisitCampHud } from './ui/visitCampHud';
import { CampLocations, FarmOnboarding } from './ui/farmOnboarding';
import type { CampLocation } from './ui/farmOnboarding';
import { SignEditor } from './ui/signEditor';
import {
  SIGN_COST,
  SIGN_MAX_PER_LOCATION,
  emptySignpostDecor,
  type SignLocation,
} from './sim/signposts';
import { FARM_CROP_TEXT, FarmCropPicker } from './ui/farmCrops';
import { FarmBuildPanel } from './ui/farmBuildPanel';
import { gameDuration, gameMessage, gameText } from './i18n/game';
import { gameMessages } from './i18n/gameMessages';
import { resourceMessage } from './i18n/gameData';
import { HeroCard } from './ui/heroCard';
import { ReturnScreen } from './ui/returnScreen';
import type { ReturnProgress } from './ui/returnScreen';
import { StatsPanel } from './ui/statsPanel';
import { ClanPanel } from './ui/clanPanel';
import { ClanInvitePanel } from './ui/clanInvitePanel';
import { ClanBuildBar } from './ui/clanBuildBar';
import { MailButton } from './ui/mail';
import {
  CLAN_BUILDINGS,
  CLAN_BUILD_REASON,
  advanceClanConstruction,
  assignClanBuilder,
  clanBuildBlock,
  clanBuilderIds,
  clanCanAfford,
  clanResourceShortage,
  ensureClanLocation,
  foundClan,
  joinClan,
  neighboursOpen,
  placeClanBuilding,
} from './sim/clan';
import type { ClanBuildingKind } from './sim/clan';
import { CampPrompt } from './ui/campPrompt';
import { SettingsMenu } from './ui/settings';
import { Hud } from './ui/hud';
import { BattleHud } from './ui/battleHud';
import { battleForecast, commandBattle, inBattle, partyByUnit } from './sim/raid';
import { current, moves, targets, unitAt } from './sim/battle';
import { worldToHex, hexKey, hexToWorld } from './sim/hex';
import { mulberry32 } from './core/rng';
import { DraftScreen } from './ui/draftScreen';
import { StartScreen } from './ui/startScreen';
import { chronicle } from './sim/chronicle';
import {
  ACHIEVEMENTS,
  earnAchievement,
  markAchievementsSeen,
  reconcileAchievements,
  type AchievementDef,
  type AchievementId,
} from './sim/achievements';
import { AchievementToast } from './ui/achievementToast';
import { debugGet, debugHas, debugSceneOpen } from './debug/routes';
import {
  SORTIE_REASON,
  freeHero,
  reportOf,
  sortieBlock,
  sortieDue,
  ticketOf,
} from './sim/sortie';
import type { Report, Sortie } from './sim/sortie';
import { installBench } from './features/bench';
import { FanControl, installFan } from './features/fan';
import type { FanPerson } from './features/fan';
import { installAvatarLab } from './features/avatarLab';
import { bindCampInput } from './features/campInput';
import { createDirector } from './features/onboarding';
import {
  HIRE_REASON,
  advanceHire,
  woodsmenOf,
  hireBlock,
  hireWoodsman,
  nextWoodsmanPrice,
  startHireTalk,
  woodsmanPostAt,
} from './sim/woodsman';
import type { WoodsmanPost, WoodsmanTalk } from './sim/woodsman';
import { MeetPanel } from './ui/meetPanel';
import type { MeetPanelCallbacks } from './ui/meetPanel';
import { advance, answerSelf, generateSettler, giftOf, setHeroName, startMeet } from './sim/settler';
import {
  TENT_REASON,
  admit,
  assignSchedule,
  assignWork,
  collectHunts,
  buildTent,
  collectWork,
  RESIDENT_WORK,
  hasRoof,
  homeless,
  recallHunt,
  residentLook,
  residentUuid,
  residentPhaseAt,
  residentState,
  roofs,
  startHunt,
  tentBlock,
  tentFits,
  tentSpot,
} from './sim/residents';
import { payUpkeep, workingAfter } from './sim/upkeep';
import { PICK_REASON, bushAt, localsOf, localsTook, pickKey, ripe, startPick, stepPickInto, worldBlock, worldRipe } from './sim/berries';
import type { Locals } from './sim/berries';
// §13.8 — местные у своих кустов: маршруты им кладёт та же рутина,
// что водит добытчика поляны (`sim/chores.ts`).
import { gatherersOf } from './sim/gatherers';
import type { Gatherer } from './sim/gatherers';
import type { Bush } from './sim/berries';
import { RESIDENT_TOOL, RESIDENT_WORK_CLIP, guardHeight } from './render/models';
import { choreAt, choresAt, choresOf } from './sim/chores';
import type { Chore } from './sim/chores';
import { chatAt, phraseAt } from './sim/talk';
import type { Talker } from './sim/talk';
import { Bubbles } from './render/bubbles';
import { WorkBars } from './render/workbar';
import type { WorkItem } from './render/workbar';
import { startTempo, stepTempo, tempoBeat, tempoBoost, tempoSpotNow } from './sim/tempo';
import type { TempoAim } from './sim/tempo';
import { TempoRing } from './render/tempoRing';
// Кадру `?water` хватает трёх кирпичей рендера: группа, плоскость и инстансы.
import * as THREE from 'three';
import { waterGeometry, waterMaterial, waterUniforms } from './render/water';
import { PALETTE } from './render/palette';
import type { Bubble } from './render/bubbles';
import { DWELLER_SPEED } from './sim/garrison';
import { ResidentCard } from './ui/residentCard';
import { ResidentManager } from './ui/residentManager';
import { CharacterPage } from './features/character';
import type { CharacterSubject, PersonTab } from './features/character';
import type { DwellerLook } from './sim/garrison';
import type { MeetState, SelfAnswer, Settler } from './sim/settler';
import { panelsFor, soundFor } from './features/scene';
import type { Scene } from './features/scene';
import { createRaidEar } from './features/raidAudio';
import {
  FARM_CONVOY_IRON,
  FARM_FOOD_GOAL,
  FARM_CROPS,
  FARM_DEFAULT_CROP,
  FARM_STARTING_PLOT_COUNT,
  advanceFarmOnboarding,
  emptyFarmPlots,
  emptyFarmStory,
  chooseFarmCaretaker,
  completeFarmConstruction,
  farmPlantBlock,
  farmPlotReadyAt,
  farmPlotPhase,
  farmStatus,
  gatherFarmFood,
  harvestFarmPlot,
  plantFarmPlot,
  repeatReadyFarmPlots,
  selectFarmCrop,
  supplyFarmConvoy,
  startFarmConstruction,
  startFarmOnboarding,
  syncFarmStory,
} from './sim/farm';
import { collectResidentFarmHarvest } from './sim/farmResidents';
import {
  simulatedCamp,
  simulatedCampRows,
  type InspectableCamp,
} from './sim/neighbourCamps';

const app = document.getElementById('app');
if (app === null) throw new Error('нет #app');
initPlatform();

/* ---------- состояние ---------- */
/**
 * Время спрашивается до всего остального (§6). Порядок здесь важнее, чем
 * кажется: офлайновый догон — законченная стройка, наработанное жильцами,
 * восстановленные локации — считается один раз, прямо на этих строках,
 * от `clock.now()`. Спросить сервер после догона значило бы починить часы,
 * когда по ним уже начислили.
 *
 * Ожидание короткое и с потолком: игра обязана открываться без сети ровно
 * как открывалась. Не ответил за секунду — идём на локальных, и это видно
 * в `clock.synced`.
 */
const [serverNow, initialWorld] = await Promise.all([
  Promise.race([cloudTime(), new Promise<null>((done) => setTimeout(() => done(null), 1000))]),
  Promise.race([cloudWorldSnapshot(), new Promise<null>((done) => setTimeout(() => done(null), 1000))]),
]);
const initialWorldInstalled = initialWorld !== null && installWorldSnapshot(initialWorld);
const loaded = load();
const clock = new Clock(loaded.watermark);
if (serverNow !== null) clock.sync(serverNow);
let camp: CampState = loaded.camp;
const roster: Roster = loaded.roster;
// Завершённый старый сейв продолжает историю без повторного розыгрыша обоза.
startBridgeStory(camp);

// §20.5 — монеты за вход: десять в сутки, один раз. Считается здесь, а не
// в лагере: заход в игру — это заход, независимо от того, дошёл ли игрок
// до лагеря в эту сессию. Сутки мировые (§27), поэтому перевод телефона
// вперёд второй десятки не даёт.
const gotCoins = claimDailyCoins(camp, dayAt(clock.now()));

loadTelemetry();
// §9 — те же события уходят наружу. Сток ставится до первого `track`, иначе
// `session_start` — единственное событие, которое случается ровно один раз
// за сессию, — уедет в буфер и никуда больше.
setTelemetrySink(startAnalytics());
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
/**
 * §13.7 — сперва лагерь съел и сжёг, потом наработал. Порядок обязателен:
 * голодный не работает, и посчитать работу до раздачи еды значило бы
 * заплатить за смену, которой не было.
 */
const upkeep = payUpkeep(camp, awaySec);
const clanWorkersOffline = clanBuilderIds(camp);
advanceClanConstruction(camp, startedAt);
const workingResidents = workingAfter(camp, upkeep.hungry);
const worked = collectWork(
  camp,
  awaySec,
  workingResidents,
  startedAt,
  clanWorkersOffline,
);
const farmHarvestOffline = collectResidentFarmHarvest(
  camp,
  loaded.watermark > 0 ? loaded.watermark : startedAt,
  startedAt,
  workingResidents,
  clanWorkersOffline,
);
// Охотники не получают одновременно обычную зарплату: сначала считается
// отлучка с живым билетом, затем дозревший билет возвращает их в лагерь.
const huntReportsOffline = collectHunts(camp, startedAt);
// Старый сейв со вторым жителем получает новую цель при первом запуске этой
// версии. Оффлайн-работа выше к ней не относится: задания тогда ещё не было.
startFarmOnboarding(camp);
/** Сказать о наработанном один раз за сессию, а не на каждый вход в лагерь. */
let workShown = false;

const finishedOffline = completeIfDue(camp, startedAt); // стройка могла закончиться без нас
completeFarmConstruction(camp, startedAt);
syncFarmStory(camp, dayAt(startedAt));
if (finishedOffline !== null) {
  track({ t: 'build_done', at: startedAt, building: finishedOffline, level: camp.levels[finishedOffline] });
}

let mode: Scene = 'title';
/** Публичный снимок, который сейчас открыт без права менять его. */
let visitingCamp: InspectableCamp | null = null;
let visitedLikePending = false;
let campLocation: CampLocation = 'camp';
/** Отдельная опушка клана использует ходьбу поляны, но не личный лагерь. */
let inClanCamp = false;
/** Какое клановое здание глава сейчас размещает. */
let clanPlacing: ClanBuildingKind | null = null;
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
/**
 * Выбранное место палатки до отдельного действия «построить». В этот момент
 * сцена показывает каркас с половиной полотна из Kenney Survival Kit; клетка
 * уже занята, но дерево ещё в сумке и костёр ставить рано.
 */
let tentUnderConstruction: Cell | null = null;
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
/** §13.8 — сбор ягод в лагере: та же пара «работа и цель», что у кайла. */
let campPick: { work: Work; bush: Bush } | null = null;
/** §13.8 — сбор в местах мира: место, узел и работа по нему. */
let worldPick: { place: string; bush: Bush; work: Work } | null = null;
/**
 * Резонанс жилы (§13.11): одна серия на игру. К работе она не привязана
 * нарочно — серия умирает временем, и перескочить с валуна на соседний,
 * не потеряв разгона, можно ровно настолько, насколько хватит полки.
 */
const tempo = startTempo();
/**
 * Свой поток случайности с назначенным сидом: точки — кадр, мировые сиды
 * им не сдвинуть, а одинаковая последовательность от запуска к запуску
 * делает жалобу «точка встала в угол» воспроизводимой.
 */
const tempoRng = mulberry32(0x7e5017);

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
let lastFarmStatusSecond = -1;
let lastClanWorkCheck = startedAt;
let selected: BuildingId | null = null;
/** Кнопка «Палатка» вооружила выбор места: следующий тап ставит палатку. */
let placingTent = false;
/** Кнопка «Сундук» (`chests.ts`) вооружила выбор места — тем же жестом. */
let placingChest = false;
/** Кнопка декора вооружает следующий тап по земле в лагере или на ферме. */
let placingSign: SignLocation | null = null;

/**
 * Отладка, а не механика — как ползунок «Ночь». Плотность травы меряется
 * ползунком и задаётся в адресе (?grass=N), чтобы замер повторялся.
 */
const debugParams = new URLSearchParams(location.search);
/**
 * `?frames` — цикл на таймере вместо rAF: отладка, а не механика (§6).
 * В скрытой панели браузер не зовёт rAF вовсе, время игры стоит, и ни одну
 * отладочную сцену нельзя проверить инструментом без окна на переднем
 * плане. Таймер медленнее и неровнее rAF — в игре ему делать нечего,
 * поэтому ручка адресная, как все отладочные сцены.
 */
if (debugHas(debugParams, 'frames')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
let grassPerTile = Number(debugParams.get('grass') ?? 24);
if (!Number.isFinite(grassPerTile)) grassPerTile = 24;
grassPerTile = Math.max(0, Math.min(64, Math.round(grassPerTile)));
/**
 * Отладка `?fluffy`: на поляне сеется трава заставки (FluffyGrass) вместо
 * клеточной травы вылазки — примерка, как пролог выглядит с лугом титула.
 */
const debugFluffy = debugHas(debugParams, 'fluffy');
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
 * (`debug.watch`), а у лагеря не было.
 *
 * Сдвигаются часы **лагеря целиком**: и небо, и маршруты, и сон. Двигать
 * что-то одно значило бы развести их — то самое, от чего §24 ушёл, переводя
 * границы фаз в секунды.
 *
 * Смена — сорок минут: `?shift=27` ставит кадр на отбой, `?shift=0` —
 * на подъём. Сейв она не трогает: сдвиг живёт в адресе и умирает вместе
 * с вкладкой.
 */
const shiftParam = Number(debugGet(debugParams, 'shift'));
const debugShift = debugHas(debugParams, 'shift') && Number.isFinite(shiftParam)
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

/** Один кольцевой пул на все награды: сцены меняются, draw call остаётся один. */
const rewardBurst = new RewardBurst();
rig.world.add(rewardBurst.mesh);

const showReward = (
  kind: ResourceKind,
  x: number,
  z: number,
  amount = 1,
  y = 0.58,
): void => rewardBurst.burst({ x, y, z, kind, amount });

/** Пузыри реплик жильцов (§23.5): слой один на игру, живёт он только
 *  в лагере на поляне — остальные кадры чистят его каждый рендер. */
const bubbles = new Bubbles(rig);

/** Полосы прогресса над стройкой и инструментом (`render/workbar.ts`):
 *  слой один на игру, наполняет его каждый рендер `syncWorkBars`. */
const workBars = new WorkBars(rig);

/** Кольцо резонанса (§13.11): слой один на игру, наполняет его каждый
 *  рендер `syncTempoRing`, а клики по зоне судит `beatTempo`. */
const tempoRing = new TempoRing(rig, (aim) => beatTempo(aim));

/**
 * Ночь сцены. Заданная адресом перебивает сценарную: замер на конкретной
 * темноте обязан повторяться, а не подгоняться ползунком на то же место.
 * Без `?night=` ведёт себя ровно как присваивание, которым была.
 */
const setNight = (value: number): void => {
  rig.night = debugNight ?? value;
};
const campView = new CampView(camp);
let billingAppearance = {
  fire: campFireStyle(null),
  decor: campDecorStyle(null),
  heraldry: clanHeraldry(null),
};

const applyBillingAppearance = (): void => {
  if (visitingCamp !== null) {
    campView.setAppearance({ fire: 'standard', decor: 'none', heraldry: 'plain' });
    return;
  }
  campView.setAppearance(billingAppearance);
  if (raidView === null || raid === null || (!inGladeCamp && !inClanCamp)) return;
  if (inClanCamp) {
    const center = raid.loc.evac;
    raidView.setCampAppearance(
      { fire: 'standard', decor: 'none', heraldry: billingAppearance.heraldry },
      { x: center.x - 3, z: center.z - 3 }, 6, center,
    );
    return;
  }
  const origin = campOrigin(camp);
  const hq = { x: origin.x + camp.layout.hq.x, z: origin.z + camp.layout.hq.z };
  raidView.setCampAppearance(billingAppearance, origin, campArea(camp.levels.hq), hq);
};
rig.world.add(campView.group);
const farmView = new FarmView();
rig.world.add(farmView.group);
const signpostLayer = new SignpostLayer();
rig.world.add(signpostLayer.group);

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
const achievementToast = new AchievementToast(app);

const visitCampHud = new VisitCampHud(
  app,
  () => leaveVisitedCamp(),
  () => void toggleVisitedCampLike(),
);

let residentManager: ResidentManager | null = null;
let storePanel: StorePanel | null = null;

let researchPanel: ResearchPanel;
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
  onResearch: () => {
    campHud.close();
    researchPanel.show(camp, clock.now());
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
  onVisitCamp: (id) => visitNeighbourCamp(id),
  onAppearance: (owner) => storePanel?.open(owner),
  onCraft: (slot) => forge(slot),
  // §20.4 — карточка вооружает перестановку, дальше игрок бьёт по клетке.
  onMove: (id) => {
    selected = id;
    campView.highlight(selected);
    // Вооружённых жестов не бывает двух разом — то же правило, что у палатки.
    placingTent = false;
    placingChest = false;
    hidePlacingSpot();
    const at = camp.layout[id];
    campView.showBuildingSpot(at.x, at.z, true);
    campHud.notify(`${BUILDINGS[id].name}: коснитесь свободного места`);
  },
  onConstruction: () => {
    if (campLocation === 'farm') openFarmConstruction();
    else openConstructionCatalog();
  },
  onWalls: (category) => openWalls(category),
  /**
   * §14.3 — пачка стрел. Колчан наполняется только здесь: в вылазке стрелы
   * тратятся, донесённое возвращается в лагерь, а взяться им больше неоткуда.
   * До этой кнопки колчан начинался пустым и мог только убывать — Лучник
   * всегда дрался со штрафом пустого колчана.
   */
  onBuyArrows: () => {
    const cap = campQuiverCapacity(camp);
    if (!buyArrows(camp, cap)) {
      campHud.notify('Стрелы: не хватает железа или колчан полон');
      return;
    }
    campHud.notify(`Стрелы ${camp.arrows} / ${cap}`);
    persist();
  },
  onOffhand: (hand) => swapOffhand(hand),
  /**
   * §30 — задание про клан. Кнопка не заводит клан, а спрашивает имя:
   * заведённый одним тапом клан назывался бы сам собой, а имя — это
   * единственное, что у него сейчас есть.
   */
  onClan: () => clanPanel.open(camp.clan),
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
    campView.hideBuildingSpot();
    placingChest = false;
    placingTent = true;
    campHud.notify('Палатка: коснитесь свободного места');
    // Пятно — сразу, на предложенной клетке: на телефоне наведения нет,
    // и без него игрок не понял бы, какого размера след он выбирает.
    const spot = tentSpot(camp);
    if (spot !== null) showPlacingSpot(spot);
  },
  /**
   * Пойти и добыть то, чего не хватает (§13.3, §13.7).
   *
   * **Дерево герой берёт сам.** Лагерь стоит в лесу, лес поляны рубится
   * (§13.3), и «не хватает дерева» здесь — не тупик, а невыполненная работа
   * на десять секунд. Кнопка делает ровно то, что сделал бы тап по дереву:
   * ведёт героя к ближайшему стволу и ставит его рубить. Ближайший —
   * не к центру поляны, а **к самому герою**: за деревом ходят ногами,
   * и дальний ствол стоил бы дороги, которую игрок не просил.
   *
   * **Пищу берёт добытчик.** §13.7 держит правило «пища не выпадает
   * в находках вовсе»: её приносит жилец с приказом «Добывать пищу»,
   * и другого источника в лагере нет. Приказ ставится первому, кто может
   * работать; кому ставить — решает панель (`syncFoodTask`), а не эта
   * функция: она выполняет, а не выбирает.
   */
  onGather: (kind) => {
    if (kind === 'food') {
      const at = camp.residents.findIndex(
        (r) => r.hunt === undefined && !(r.answer === 'кормим' && !r.rest),
      );
      if (at < 0 || !assignWork(camp, at, 'кормим')) {
        play('deny');
        campHud.notify('Добывать пищу некому — ягоды растут в местах мира');
        return;
      }
      play('build');
      campHud.notify(`${camp.residents[at]!.name}: добывать пищу`);
      // Тот же пересбор, что у приказа из карточки: инструмент в руке
      // и маршрут рутины обязаны смениться сразу, а не к следующему заходу.
      refreshResidentAssignment(at);
      return;
    }
    // Кадр, в котором лес не рубится (площадка отладки, §6.2.5), отвечает
    // картой, а не отказом: дерево в мире есть всегда, а «здесь нечего
    // рубить» — это ровно то задание без выхода, ради которого кнопка
    // и заведена.
    if (raid === null || !raid.logging) {
      campHud.notify('Дерево растёт в местах мира');
      campHud.openSheet('tiers');
      return;
    }
    // Ближайшее дерево к герою: поляна — кольцо леса вокруг площадки,
    // и стволов у любого лагеря больше, чем нужно. Ищется перебором
    // по локации, а не по снимку: срубленное уже не стоит.
    let goal: Cell | null = null;
    let best = Infinity;
    for (let z = 0; z < raid.loc.size; z++) {
      for (let x = 0; x < raid.loc.size; x++) {
        if (!treeAt(raid.loc, { x, z })) continue;
        const d = Math.hypot(raid.hero.x - x, raid.hero.z - z);
        if (d >= best) continue;
        best = d;
        goal = { x, z };
      }
    }
    if (goal === null) {
      play('deny');
      campHud.notify(CHOP_REASON.gone);
      return;
    }
    campHud.close();
    startChopping(goal);
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
    campView.hideBuildingSpot();
    placingTent = false;
    placingChest = true;
    campHud.notify('Сундук: коснитесь свободного места');
    // То же пятно, что у палатки, — след у них один.
    const spot = chestSpot(camp);
    if (spot !== null) showPlacingSpot(spot);
  },
  onResidents: () => residentManager?.show(camp, clock.now()),
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
  /** §29 — подарок за вход. Считает и зачисляет лагерь, а не панель. */
  onClaimGift: () => claimGift(),
  onAchievementsSeen: () => {
    if (markAchievementsSeen(camp)) persist();
  },
  // Значок вещи §14 рисует запечённая геометрия; панелям слой рендера
  // не виден, поэтому картинка приходит к ним отсюда (`scripts/arch.ts`).
  gearIcon: (kind, level) => gearIcon(kind, level),
  // §29.4 — та же дорога у картинок подарка: бревно, валун и слиток берутся
  // из тех же наборов, которыми набран лагерь.
  giftIcon: (name) => giftIcon(name),
});

researchPanel = new ResearchPanel(app, {
  onStart: (id) => {
    const now = clock.now();
    if (!startResearch(camp, id, now)) return;
    campHud.notify(gameText(gameMessage('{name}: исследование началось', '{name}: research started'), {
      name: gameText(researchNameMessage(id)),
    }));
    researchPanel.sync(camp, now);
    persist();
  },
  onClose: () => undefined,
});

/** Любая правка поручения сразу перестраивает людей в живой сцене лагеря. */
function refreshResidentAssignment(index: number): void {
  const r = camp.residents[index];
  if (r !== undefined) raidView?.setResidentTool(index, r.rest || r.hunt !== undefined ? null : RESIDENT_TOOL[r.answer]);
  if (inGladeCamp) {
    if (controlled === -1) seatResidents();
    else planChores();
  }
  residentManager?.sync(camp, clock.now(), true);
  persist();
}

residentManager = new ResidentManager(app, {
  onWork: (index, order) => {
    if (!assignWork(camp, index, order)) return;
    play('pick');
    refreshResidentAssignment(index);
  },
  onSchedule: (index, schedule) => {
    if (!assignSchedule(camp, index, schedule)) return;
    play('pick');
    refreshResidentAssignment(index);
  },
  onHunt: (index) => {
    if (!startHunt(camp, index, clock.now())) {
      play('deny');
      return;
    }
    play('pick');
    const r = camp.residents[index];
    if (r !== undefined) campHud.notify(`${r.name}: ушёл на охоту на 5 часов`);
    refreshResidentAssignment(index);
  },
  onRecall: (index) => {
    const name = camp.residents[index]?.name;
    if (!recallHunt(camp, index)) return;
    play('pick');
    if (name !== undefined) campHud.notify(`${name}: вернулся без добычи`);
    refreshResidentAssignment(index);
  },
});

const farmOnboarding = new FarmOnboarding(app, {
  onAdvance: () => {
    if (!advanceFarmOnboarding(camp)) return;
    syncFarmUi();
    persist();
  },
  onOpenFarm: () => {
    advanceFarmOnboarding(camp);
    switchCampLocation('farm');
    persist();
  },
});

const signEditor = new SignEditor(app);

const campLocations = new CampLocations(app, {
  onSelect: (location) => switchCampLocation(location),
  onSign: () => armSignpost(),
});

const signDecor = () => (camp.signposts ??= emptySignpostDecor());

function syncSignposts(): void {
  if (mode === 'camp') {
    if (campLocation === 'farm') signpostLayer.setPlayers(signDecor().farm);
    else signpostLayer.setPlayers(signDecor().camp, campOrigin(camp));
    return;
  }
  if (mode === 'raid' && raid !== null && !inGlade) {
    const region = regionAt(dayAt(clock.now()));
    const node = region.nodes[raidNode];
    if (node !== undefined) {
      signpostLayer.setWorldNode(region, node, raid.loc.evac);
      return;
    }
  }
  signpostLayer.clear();
}

function armSignpost(): void {
  if (mode !== 'camp') return;
  if (camp.resources.wood < SIGN_COST) {
    play('deny');
    campHud.notify(gameText(gameMessage('Указатель: нужно {count} ед. дерева', 'Signpost: {count} wood required'), {
      count: SIGN_COST,
    }));
    return;
  }
  buildPanel.setVisible(false);
  buildTool = null;
  // Указатель ставят в лагере и на хозяйстве; клановая площадка (§30) —
  // не место игрока, и своей таблички у неё нет.
  placingSign = campLocation === 'clan' ? 'camp' : campLocation;
  campHud.close();
  campHud.notify(gameText(gameMessage('Указатель: выберите место, затем напишите текст', 'Signpost: choose a spot, then write the text')));
}

function placeSignpostAt(ground: { x: number; z: number }): void {
  const location = placingSign;
  placingSign = null;
  if (location === null) return;
  const local = location === 'camp' ? campLocal(ground) : ground;
  const x = Math.round(local.x);
  const z = Math.round(local.z);
  const size = location === 'camp' ? campArea(camp.levels.hq) : 10;
  if (x < 0 || z < 0 || x >= size || z >= size) {
    play('deny');
    campHud.notify(gameText(gameMessage('Указатель: выберите место внутри локации', 'Signpost: choose a spot within this location')));
    return;
  }
  const signs = signDecor()[location];
  const existing = signs.findIndex((s) => s.x === x && s.z === z);
  if (existing < 0 && signs.length >= SIGN_MAX_PER_LOCATION) {
    play('deny');
    campHud.notify(gameText(gameMessage('Указателей уже {count} — отредактируйте один из них', 'You already have {count} signposts—edit one of them'), {
      count: SIGN_MAX_PER_LOCATION,
    }));
    return;
  }
  const before = existing < 0 ? '' : signs[existing]!.text;
  signEditor.open(before, (text) => {
    if (text === null) return;
    // Камера лагеря и фермы начинает с юго-востока: лицевая сторона доски
    // встречает первый кадр, а не стоит к нему ребром. Поворот камеры позже
    // всё равно покажет обратную подпись — рендер рисует её с двух сторон.
    const sign = { x, z, text, turn: Math.PI / 4 };
    if (existing >= 0) signs[existing] = sign;
    else {
      spend(camp.resources, { wood: SIGN_COST });
      signs.push(sign);
    }
    play('build');
    campHud.notify(existing >= 0
      ? gameText(gameMessage('Указатель изменён: «{text}»', 'Signpost updated: “{text}”'), { text })
      : gameText(gameMessage('Указатель построен: «{text}»', 'Signpost built: “{text}”'), { text }));
    campHud.sync(camp, clock.now(), 0);
    syncSignposts();
    persist();
  });
}

const farmCropPicker = new FarmCropPicker(app, {
  onSelect: (crop) => {
    const changed = selectFarmCrop(camp, crop);
    syncFarmUi();
    campHud.notify(gameText(gameMessage('{crop} выбрана для следующего посева', '{crop} selected for the next planting'), {
      crop: gameText(FARM_CROP_TEXT[crop].name),
    }));
    if (changed) persist();
  },
  onReturn: () => {
    const now = clock.now();
    const ready = (camp.farm?.plots ?? []).flatMap((plot, index) =>
      plot !== null && now >= farmPlotReadyAt(plot)
        ? [{ index, amount: FARM_CROPS[plot.crop].harvestFood }]
        : []);
    const result = repeatReadyFarmPlots(camp, now);
    if (result.harvested === 0) {
      play('deny');
      return;
    }
    play('pick');
    for (const item of ready) {
      const at = farmView.plotCenter(item.index);
      if (at !== null) showReward('food', at.x, at.z, item.amount, at.y);
    }
    farmView.sync(camp.farm, now);
    syncFarmUi();
    campHud.notify(gameText(gameMessage('Собрано {harvested} · посеяно {replanted} · пища +{food}', 'Harvested {harvested} · replanted {replanted} · food +{food}'), {
      harvested: result.harvested,
      replanted: result.replanted,
      food: result.netFood,
    }));
    persist();
  },
  onCaretaker: (caretaker) => {
    if (!chooseFarmCaretaker(camp, caretaker)) return;
    play('levelup');
    syncFarmUi();
    campHud.notify(gameText(gameMessage('Смотритель хозяйства выбран', 'Farm caretaker chosen')));
    persist();
  },
  onConvoy: () => {
    if (!supplyFarmConvoy(camp)) {
      play('deny');
      syncFarmUi();
      return;
    }
    play('levelup');
    const message = camp.roadStory?.route === 'work'
      ? gameMessage('Работники минотавра приняли провиант · железо +{iron}', 'The minotaur’s workers took the provisions · iron +{iron}')
      : camp.roadStory?.route === 'force'
        ? gameMessage('Охраняемый обоз ушёл с провиантом · железо +{iron}', 'The guarded convoy left with provisions · iron +{iron}')
        : gameMessage('Торговый обоз ушёл с провиантом · железо +{iron}', 'The trade convoy left with provisions · iron +{iron}');
    startBridgeStory(camp);
    syncFarmUi();
    syncRoadStoryTask();
    campHud.sync(camp, clock.now(), 0);
    campHud.notify(gameText(message, { iron: FARM_CONVOY_IRON }));
    persist();
  },
});

const farmBuildPanel = new FarmBuildPanel(app, {
  onBuild: (id) => {
    const now = clock.now();
    if (!startFarmConstruction(camp, id, now)) {
      play('deny');
      farmBuildPanel.sync(camp, now);
      return;
    }
    play('build');
    farmBuildPanel.sync(camp, now);
    farmView.sync(camp.farm, now);
    campHud.sync(camp, now, 0);
    campHud.notify(gameText(gameMessage('Стройка огорода началась', 'Farm construction started')));
    persist();
  },
  onDone: () => {
    farmBuildPanel.setVisible(false);
    farmCropPicker.setVisible(campLocation === 'farm');
  },
});

/**
 * Забрать сегодняшний подарок (§29).
 *
 * Всё, что здесь есть сверх счёта, — три способа выдачи, и каждый идёт
 * тем же путём, каким эта вещь появляется в игре обычно: ресурсы —
 * через кладовую (§13.6), стрелы — в колчан по его вместимости (§14.3),
 * сундук — на свободную клетку площадки, как ставит его пролог. Человек
 * не выдаётся вовсе: подарок только обещает его, а приходит он сам,
 * знакомством (§29.2).
 *
 * День берётся серверными часами (§27): переводом телефона вперёд второй
 * подарок больше не достаётся.
 */
function claimGift(): void {
  const day = dayAt(clock.now());
  const state = camp.daily ?? emptyDaily();
  if (claimBlock(state, day) !== 'ok') {
    play('deny');
    campHud.notify(CLAIM_REASON.today);
    return;
  }
  const gift = giftAt(state.taken);
  let said = '';
  // Куда подарок долетит на глазах (§29.4). Пусто у встречи: человек
  // приходит сам, и его прилёт — это он сам, а не значок над полосой.
  const flight: FlyTarget[] = [];
  switch (gift.id) {
    case 'ресурсы': {
      const loot = giftLoot(gift, giftTier(camp.levels.kitchen), state.taken);
      // Летит только то, что вправду легло. Полная кладовая (§13.6) режет
      // приток, и значок, долетевший до числа, которое не изменилось, —
      // это обещание вместо ответа.
      const before = { ...camp.resources };
      if (stash(camp, loot) > 0) campHud.notify(STORE_FULL);
      said = (Object.entries(loot) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(', ');
      flight.push(
        ...(Object.keys(loot) as ResourceKind[]).filter((k) => (camp.resources[k] ?? 0) > (before[k] ?? 0)),
      );
      break;
    }
    case 'стрелы': {
      const cap = campQuiverCapacity(camp);
      const before = camp.arrows;
      camp.arrows = Math.min(cap, camp.arrows + GIFT_ARROWS);
      said = `стрелы ${camp.arrows} / ${cap}`;
      // Полный колчан — тот же случай, что полная кладовая: лететь незачем.
      if (camp.arrows > before) flight.push('quiver');
      break;
    }
    case 'сундук': {
      // Даром и на свободное место: спрашивать за подарок клетку значило бы
      // требовать жеста за то, что дают. Места нет — подарок не пропадает,
      // а говорит об этом; взятым он при этом считается, иначе игрок
      // упрётся в тот же день назавтра.
      const spot = chestSpot(camp);
      if (spot === null) {
        // Слова те же, что у платного сундука: причина одна, и вторая
        // её формулировка разошлась бы с первой молча (§23.3).
        play('deny');
        campHud.notify(CHEST_REASON.area);
        return;
      }
      adoptChest(camp, spot);
      said = `сундук, кладовая ${storeCapacity(camp)}`;
      flight.push('store');
      break;
    }
    case 'встреча': {
      // Обещание, а не жилец: человек приходит к костру сам, и знакомство
      // с ним такое же, как первое (§29.2).
      camp.guestPromised = true;
      // Садится он сразу, если игрок стоит в лагере: «к костру кто-то идёт»
      // и пустое место у костра — это обещание, не выполненное на глазах.
      if (inGladeCamp && campDoor !== null) seatSettler(campDoor);
      said = 'к костру кто-то идёт';
      break;
    }
  }
  camp.daily = claimed(state, day);
  play('gift');
  persist();
  campHud.notify(`Подарок ${dayOf(state.taken) + 1}-го дня: ${said}`);
  // Полёт идёт последним и ничего не решает: подарок уже в лагере, а панель
  // уже знает об этом. Он показывает, **куда** тот лёг, — и потому считается
  // от карточки, которую игрок только что нажал, к числу, которое от этого
  // изменилось.
  campHud.sync(camp, clock.now(), 0);
  campHud.flyGift(flight);
}

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
  onBuildings: () => {
    openConstructionCatalog();
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

function openConstructionCatalog(): void {
  farmBuildPanel.setVisible(false);
  buildPanel.setVisible(false);
  buildTool = null;
  stroke = null;
  campView.hideWallGhost();
  campHud.openConstruction();
}

function openFarmConstruction(): void {
  buildPanel.setVisible(false);
  buildTool = null;
  stroke = null;
  campView.hideWallGhost();
  campHud.close();
  farmCropPicker.setVisible(false);
  farmBuildPanel.sync(camp, clock.now());
  farmBuildPanel.setVisible(true);
}

function openWalls(category: BuildCategory = 'defense'): void {
  buildPanel.setCategory(category);
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
  const busy = camp.construction !== null || camp.farm?.story.construction != null;

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
  onAbout: (index) => openCharacter({ kind: 'герой', index }),
});

/**
 * Кого показывает страница персонажа (`features/character`), и показывает ли
 * вообще. Один экран на героя и жильца, поэтому и указатель один: два поля
 * рядом разошлись бы первым же случаем, когда открыты оба.
 */
let about: { readonly kind: 'герой' | 'жилец'; readonly index: number } | null = null;

function openCharacter(who: { readonly kind: 'герой' | 'жилец'; readonly index: number }): void {
  about = who;
  characterPage.setVisible(true);
  syncCharacter();
}

function closeCharacter(): void {
  about = null;
  characterPage.setVisible(false);
}

/**
 * Что страница показывает про этого человека. Собирается здесь, а не в самой
 * странице: разбор читает и ростер, и лагерь, и часы, а страница про игру
 * знать не обязана — ей достаточно того, что нарисовать.
 *
 * У жильца пустуют уровень, опыт и характеристики, и это не пропуск: игра их
 * не считает (§11.7 — показанное число обязано на что-то влиять). Страница
 * говорит об этом словами, а не подставляет ноль.
 */
function characterPeople(): PersonTab[] {
  return [
    ...roster.heroes.map((hero) => ({
      key: `герой:${hero.id}`,
      name: HERO_CLASSES[hero.cls].name,
      look: hero.cls,
      seed: hero.id,
    })),
    ...camp.residents.map((r) => ({
      key: `жилец:${r.seed}:${r.name}`,
      name: r.name,
      look: residentLook(r),
      seed: r.seed,
    })),
  ];
}

/** Перелистнуть страницу на другое лицо, не закрывая её. */
function pickCharacter(key: string): void {
  const hero = roster.heroes.findIndex((h) => `герой:${h.id}` === key);
  if (hero >= 0) {
    openCharacter({ kind: 'герой', index: hero });
    return;
  }
  const resident = camp.residents.findIndex((r) => `жилец:${r.seed}:${r.name}` === key);
  if (resident >= 0) openCharacter({ kind: 'жилец', index: resident });
}

function characterSubject(): CharacterSubject | null {
  if (about === null) return null;
  const now = clock.now();
  if (about.kind === 'герой') {
    const hero = roster.heroes[about.index];
    if (hero === undefined) return null;
    const def = HERO_CLASSES[hero.cls];
    const s = stats(hero);
    const skill = SKILLS[def.skill];
    const block = trainBlock(roster, hero, camp.levels.yard);
    return {
      key: `герой:${hero.id}`,
      name: def.name,
      kind: 'герой',
      look: hero.cls,
      seed: hero.id,
      status: heroStatusLine(hero, now),
      good: hero.status === 'ready' && hero.wounds === 0,
      level: hero.level,
      xp: hero.xp / xpToNext(hero.level),
      xpText: hero.level >= MAX_HERO_LEVEL ? 'максимум' : `${hero.xp} / ${xpToNext(hero.level)} опыта`,
      // «Сила» не показывается: её не читает ни бой, ни обзор, ни генератор
      // (§11.7), и строка о ней была бы враньём на целый экран.
      stats: [
        { name: 'Атака', key: 'attack', value: s.attack },
        { name: 'Защита', key: 'defense', value: s.defense },
        { name: 'Знание', key: 'knowledge', value: s.knowledge },
        { name: 'Ловкость', key: 'agility', value: s.agility },
      ],
      points: hero.statPoints,
      note: `${def.strong}, ${def.weak}`,
      skill: {
        name: skill.name,
        level: hero.skillLevel,
        max: MAX_SKILL_LEVEL,
        points: hero.skillPoints,
        effect: skillEffect(skill.id, hero.skillLevel),
      },
      train: {
        text:
          hero.status === 'training'
            ? `Тренируется · ${formatDuration(Math.max(0, (hero.busyUntil ?? now) - now))}`
            : block === 'ok'
              ? `Тренировать · ${formatDuration(trainPerLevel(camp.levels.yard))} · до ур. ${trainCap(roster)}`
              : TRAIN_REASON[block],
        disabled: block !== 'ok',
      },
      gear: camp.gear,
      offhand: camp.offhand,
      raid: {
        loadout: loadout(hero),
        storageLevel: camp.levels.storage,
        capacityBonus: researchBagBonus(camp),
        visionBonus: watchtowerVision(camp.levels.watchtower) + researchScoutingBonus(camp),
        quiverBonus: archeryQuiverBonus(camp.levels.archery),
      },
      model: { kind: 'герой', cls: hero.cls, weapon: camp.gear.weapon },
      people: characterPeople(),
    };
  }
  const r = camp.residents[about.index];
  if (r === undefined) return null;
  const roofed = hasRoof(camp, about.index);
  const carry = RESOURCE_NAME[RESIDENT_WORK[r.answer]].toLowerCase();
  return {
    key: `жилец:${r.seed}:${r.name}`,
    name: r.name,
    kind: 'жилец',
    look: residentLook(r),
    seed: r.seed,
    status: roofed ? residentState(r) : 'без крыши',
    good: roofed,
    level: null,
    xp: -1,
    xpText: null,
    stats: [],
    points: 0,
    note: `Занятие: носит ${carry} — прибавка в кладовую, пока есть крыша`,
    skill: null,
    train: null,
    gear: null,
    offhand: camp.offhand,
    raid: null,
    // Инструмент — тот же, что у жильца в кадре (§6.1.14): занятие видно
    // по руке, и разбор обязан показывать ту же руку, а не пустую.
    model: { kind: 'жилец', look: residentLook(r), tool: r.rest ? null : RESIDENT_TOOL[r.answer] },
    people: characterPeople(),
  };
}

/** Строка состояния героя — та же, что в карточке, но считается здесь один раз. */
function heroStatusLine(hero: HeroState, now: number): string {
  if (hero.status === 'ready') return hero.wounds > 0 ? `ран ${hero.wounds}` : 'готов';
  if (hero.busyUntil === null) return hero.status === 'raid' ? 'в вылазке' : hero.status;
  const left = formatDuration(Math.max(0, hero.busyUntil - now));
  const what =
    hero.status === 'healing' ? 'лечится' : hero.status === 'training' ? 'тренируется' : 'в вылазке';
  return `${what} · ${left}`;
}

function syncCharacter(): void {
  const subject = characterSubject();
  if (subject === null) {
    closeCharacter();
    return;
  }
  characterPage.sync(subject);
}

const characterPage = new CharacterPage(app, {
  // §11.7 — очко ложится по тапу и сразу видно в строке: решение игрока,
  // а не автоматика класса.
  onSpend: (key) => {
    const hero = about?.kind === 'герой' ? roster.heroes[about.index] : undefined;
    if (hero === undefined || !spendStat(hero, key)) return;
    syncCharacter();
    persist();
  },
  onSkill: () => {
    const hero = about?.kind === 'герой' ? roster.heroes[about.index] : undefined;
    if (hero === undefined || !spendSkill(hero)) return;
    campHud.notify(`${SKILLS[HERO_CLASSES[hero.cls].skill].name}: уровень ${hero.skillLevel}`);
    syncCharacter();
    persist();
  },
  onTrain: () => {
    const hero = about?.kind === 'герой' ? roster.heroes[about.index] : undefined;
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
  onPick: (key) => pickCharacter(key),
  onClose: () => closeCharacter(),
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
      look: residentLook(r),
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
      heroCard.sync(roster, shownHero, clock.now());
      return;
    }
    selectHero(roster, index);
    heroCard.sync(roster, shownHero, clock.now());
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
  onAbout: (index) => openCharacter({ kind: 'жилец', index }),
});

/**
 * Знакомство у прогалины. Панель заводится рядом с остальными, а обработчики
 * приезжают позже: разговор существует только там, где есть поселенец,
 * и держать его логику в общем месте значило бы делать вид, что он есть
 * всегда.
 */
let meetOn: MeetPanelCallbacks | null = null;
/** Сидящий у костра — обещанный подарком гость (§29.2), а не первый поселенец. */
let meetIsGuest = false;
/**
 * Клетка у входа в палатку — то место, откуда садят пришедшего. Запоминается
 * входом в лагерь: обещанный гость (§29.2) обязан прийти в ту же минуту,
 * когда подарок взят, а не после следующей загрузки сцены.
 */
let campDoor: Cell | null = null;
const meetPanel = new MeetPanel(app, {
  onName: (name) => meetOn?.onName(name),
  onAnswer: (answer) => meetOn?.onAnswer(answer),
  onAdvance: () => meetOn?.onAdvance(),
  onInvite: () => meetOn?.onInvite(),
  onRoadInvite: () => inviteRoadSurvivor(),
  onBridgeDecision: (route) => decideBridge(route),
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
 * отладочного кадра `?meet`: разговор один, сцен у него две.
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
      // Обещание закрыто человеком, а не подарком: гаснет оно на приглашении,
      // а не на выдаче, — до этой минуты у костра кто-то сидит и ждёт.
      if (meetIsGuest) {
        camp.guestPromised = false;
        persist();
      }
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
        syncFarmUi();
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
  if (camp.residents.length > 0) grantAchievement('first-shelter', clock.now());
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
/** Последнее окно личного расписания: смена окна пересаживает людей один раз. */
let residentPhases: ReturnType<typeof residentPhaseAt>[] = [];

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
  residentPhases = camp.residents.map((r) => residentPhaseAt(r, campTime()));
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
      // §13.8 — кусты в клетках локации: к ним ходит добытчик пищи.
      bushes: (camp.bushes ?? []).map((b) => ({ x: o.x + b.x, z: o.z + b.z })),
    },
    camp.residents.map((r, i) => ({
      ...r,
      // `choresOf` знает только работа/покой; личное расписание превращает
      // сон, еду, свободное время и охоту в честный покой для маршрута.
      rest: r.rest || residentPhases[i] !== 'работа',
    })),
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
        look: residentLook(r),
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
      look: residentLook(r),
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
  residentPhases.forEach((phase, i) => {
    const hidden = phase === 'сон' || phase === 'охота';
    raidView!.setResidentHidden(i, hidden);
    sleeping[i] = hidden;
  });
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
  const now = campTime();
  const phases = camp.residents.map((r) => residentPhaseAt(r, now));
  if (phases.some((phase, i) => phase !== residentPhases[i])) {
    seatResidents();
    return;
  }
  if (raid === null || raidView === null || chores.length === 0) return;
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
      // Клип занятия, а не один на всех: §13.8 записал, что добытчик у куста
      // сидит на корточках, а поляна до сих пор заставляла его рубить ягоды.
      // Веер лагеря (`campView`) играл правильный клип, кадр поляны — нет,
      // и это было два ответа на один вопрос.
      workClip: RESIDENT_WORK_CLIP[camp.residents[i]?.answer ?? 'строим'],
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
  meetIsGuest = false;
  if (raid === null || raidView === null) return;
  // Двое приходят к лагерю по разным поводам: первый — потому что лагерь
  // встал (§16.1), второй — потому что его пообещал седьмой день первой
  // недели (§29.2). Первый важнее: он часть кривой первых минут, и подменять
  // его подарочным гостем значило бы отменять знакомство ради подарка.
  const first = camp.raids >= 1 && camp.residents.length === 0;
  const promised = camp.guestPromised === true;
  if (!first && !promised) return;
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
  // У обещанного гостя своё лицо: тот же якорь, но с числом уже живущих.
  // Без этого второй пришедший оказался бы двойником первого — тем же
  // человеком, с тем же именем, во второй раз. Считает сид `sim/daily.ts`:
  // то же лицо рисует карточка седьмого дня, и формула у них обязана быть
  // одна (§29.2).
  meetIsGuest = !first;
  meetSettler = generateSettler(guestSeed(o, meetIsGuest ? camp.residents.length : 0));
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
 * только в лагере на поляне: отладочный кадр `?meet` живёт в сцене
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
    closeCharacter();
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
  // Первая ковка не открывает пророчество и не делает героя особенным:
  // она лишь показывает зависимость лагеря от дорогого привозного железа.
  // С этого хозяйственного вопроса начинается первая глава.
  // В старом сейве вещь уже могла быть выкована до появления этой главы.
  // Поэтому «первая» здесь означает первую успешную ковку после того, как
  // сюжетное поле стало доступно, а не только буквальный первый уровень вещи.
  if (startRoadStory(camp)) {
    campHud.notify(gameText(gameMessage(
      'Первое железо обошлось лагерю дорого',
      'The camp paid dearly for its first iron',
    )));
    syncRoadStoryTask();
  }
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
    else if (platformKind() === 'telegram') {
      void platformAuth.then((signedIn) => {
        if (signedIn) {
          hasSession = true;
          enterGame();
          return;
        }
        authCard.showTelegram(cloudTelegramSignIn, () => {
          hasSession = true;
          enterGame();
        });
      });
    } else authCard.show();
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
/** Подход, а не каждый кадр рядом: отчёт о недостаче ждёт нового визита. */
let traderWasNear = false;

/**
 * Прилавок торговца (§13.5). Ничего не хранит: пища на нём — ровно та, что
 * местные сняли с кустов этой площадки за сутки (§13.8), минус уже
 * выкупленное. `null` — торговца рядом нет.
 */
function traderStock(): Stock | null {
  if (castleNow === null) return null;
  const supply = localsTook(
    castleNow.loc.seed, castleNow.bushes, localsOf(castleNow.gate, castleNow.bushes), clock.now(),
  );
  return stockOf(supply, camp.bought ?? {}, castleNow.loc.seed, clock.now());
}

/** Одна ведущая строка первой главы; кнопка всегда ведёт на карту мира. */
function syncRoadStoryTask(): void {
  const step = camp.roadStory?.step;
  let text = step === 'return-to-trader'
    ? gameText(gameMessage('Расспросите торговца о поставках железа', 'Ask the trader about iron supplies'))
    : step === 'find-caravan'
      ? gameText(gameMessage('Осмотрите лесную дорогу', 'Search the forest road'))
      : step === 'settle-supply'
        ? gameText(gameMessage('Решите вопрос с дорогой у минотавра', 'Settle the road dispute with the minotaur'))
        : step === undefined && camp.farm?.unlocked === true && camp.farm.story.day >= 8
          ? gameText(gameMessage('Скуйте первую вещь и откройте дорогу для обозов', 'Forge your first item and reopen the caravan road'))
          : step === 'done' && camp.farm?.story.day === 15 && camp.roadStory?.convoySupplied !== true
            ? gameText(gameMessage('Снарядите первый обоз на Ферме', 'Supply the first convoy at the Farm'))
            : null;
  if (text === null) {
    const bridge = camp.bridgeStory;
    const mission = activeRoadMission(camp, dayAt(clock.now()));
    text = mission !== null
      ? gameText(ROAD_MISSION_COPY[mission.id].objective)
      : bridge?.step === 'shortfall'
        ? gameText(gameMessage('Поговорите с торговцем о первом обозе', 'Ask the trader about the first caravan'))
        : bridge?.step === 'find-crew'
          ? gameText(gameMessage('Найдите старую заставу на Тропе', 'Find the old tollhouse on the Trail'))
          : null;
  }
  campHud.setStoryTask(text);
}

/** Сделки, охота и проход через Тропу выдают награду одним путём. */
function completeBridgeMission(action: RoadMissionAction): boolean {
  const mission = recordRoadMission(camp, dayAt(clock.now()), action);
  if (mission === null) return false;
  const reward = mission.reward;
  if (reward.kind === 'coins') {
    camp.coins = (camp.coins ?? 0) + reward.amount;
  } else if (stash(camp, { [reward.kind]: reward.amount }) > 0) {
    campHud.notify(STORE_FULL);
  }
  const rewardName = reward.kind === 'coins'
    ? gameText(gameMessage('Монеты', 'Coins'))
    : gameText(resourceMessage[reward.kind]);
  const line = gameText(gameMessage(
    'Дорожное поручение выполнено · {reward} +{amount}',
    'Road mission complete · {reward} +{amount}',
  ), { reward: rewardName, amount: reward.amount });
  raid?.events.push(line);
  if (raid === null) campHud.notify(line);
  syncRoadStoryTask();
  persist();
  return true;
}

/** Закончить главу одним из трёх сыгранных, а не выбранных в меню исходов. */
function finishRoadStory(route: SupplyRoute, line: string): void {
  if (!settleSupply(camp, route)) return;
  startBridgeStory(camp);
  raid?.events.push(line);
  syncRoadStoryTask();
  persist();
}

const tradePanel = new TradePanel(app, {
  onDeal: (give, take) => {
    const stock = traderStock();
    const block = dealBlock(camp, give, take, stock);
    if (!makeDeal(camp, give, take, stock)) {
      // Отказ обязан быть слышен так же, как виден (§18.3).
      play('deny');
      // Слова у отказа свои (`DEAL_REASON`, §23.3). Молчали прежде все,
      // кроме потолка кладовой; пустой прилавок молчать не может тем более —
      // по кошельку его не видно.
      if (block !== 'ok' && raid !== null) raid.events.push(DEAL_REASON[block]);
      return false;
    }
    play('build');
    // Унесённое с прилавка пишется в самоистекающий список: сам запас
    // не хранится, хранится только рука игрока — как у кустов (§13.8).
    if (castleNow !== null && (take.food ?? 0) > 0) {
      const log = pruneBought(camp.bought ?? {}, clock.now());
      const key = marketKey(castleNow.loc.seed, clock.now());
      log[key] = (log[key] ?? 0) + (take.food ?? 0);
      camp.bought = log;
    }
    // Сделка свободная: телеметрии важны обе оценки — по ним видно,
    // сколько переплачивают сверх спроса торговца.
    track({ t: 'trade', at: clock.now(), offer: 'deal', worth: worthOf(give), ask: askOf(take, (camp.trades ?? 0) - 1) });
    if (raid !== null) raid.events.push(TradePanel.gained(give, take));
    completeBridgeMission('trade');
    tradePanel.sync(camp, traderStock());
    persist();
    return true;
  },
  onLeave: () => {
    tradeLeft = true;
    tradePanel.setVisible(false);
  },
});

let minotaurLeft = false;
const minotaurPanel = new MinotaurPanel(app, {
  onFight: () => {
    const enemy = minotaurNow?.minotaur;
    if (enemy === null || enemy === undefined || enemy.hp <= 0) return;
    for (const defender of minotaurNow?.loc.enemies ?? []) {
      defender.peaceful = false;
      defender.awake = true;
    }
    minotaurPanel.hide();
    if (raid !== null) raid.events.push('Минотавр и два каменных голема принимают вызов');
  },
  onTrade: (id) => {
    const deal = makeMinotaurTrade(camp, id);
    if (deal === null) {
      play('deny');
      raid?.events.push('Не хватает ресурсов для обмена');
      return;
    }
    play('build');
    const tradeBonus = Object.values(camp.minotaurRelics ?? {}).includes('golem-heart') ? 1 : 0;
    const tradeReward = minotaurTradeRewardText(deal, tradeBonus);
    raid?.events.push(
      `${RESOURCE_NAME[deal.costKind]} −${deal.costAmount}, получено: ${tradeReward}`,
    );
    finishRoadStory('trade', gameText(gameMessage(
      'Поставки возобновлены по торговому договору',
      'Supplies resumed under a trade agreement',
    )));
    minotaurPanel.sync(camp);
    persist();
  },
  onQuest: (id) => {
    if (minotaurNow === null) return;
    const seed = minotaurNow.loc.seed;
    const key = String(seed >>> 0);
    const existing = camp.minotaurQuests?.[key];
    if (existing === undefined || existing.completed) {
      const quest = acceptMinotaurQuest(camp, seed, id);
      raid?.events.push(`Заказ принят: ${quest.title} · ${minotaurResourceText(quest.kind, quest.amount)}`);
    } else if (completeMinotaurQuest(camp, seed)) {
      const bonus = Object.values(camp.minotaurRelics ?? {}).includes('golden-horn') ? 1.2 : 1;
      raid?.events.push(`Заказ выполнен: монеты +${Math.round(existing.reward * bonus)}, репутация +${existing.reputation ?? 1}`);
      finishRoadStory('work', gameText(gameMessage(
        'Работа принята — обозам снова разрешено проходить',
        'The work is accepted — caravans may use the road again',
      )));
      play('build');
    } else if (!existing.completed) {
      raid?.events.push('Для выполнения заказа ресурсов пока не хватает');
      play('deny');
    }
    minotaurPanel.sync(camp);
    persist();
  },
  onLeave: () => {
    minotaurLeft = true;
    minotaurPanel.hide();
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
 * Низ вылазки уступает разговору (§6.2.6). Панель разговора — пятый слой
 * в том же нижнем углу, и о кнопках вылазки она не знает: две коробки
 * налезали друг на друга, и первым это ловилось глазом, а не правилом.
 *
 * Считается по видимости панели, а не по числу открывших: разговоров
 * четыре — знакомство, гость, лесник и минотавр, — и договориться между
 * собой они не смогли бы, как и не смогли бы с подсказкой (`setHint`).
 */
const syncTalking = (): void => hud.setTalking(meetPanel.visible);

/**
 * Настройки (§18.5). Живут во всех сборках, а не только в дев: громкость
 * нужна игроку, а не разработчику. «Новая игра» переехала сюда же из
 * дев-меню — сейв переживает перезагрузку, и стереть его из консоли нельзя:
 * игра тут же запишет его обратно.
 */
const statsPanel = new StatsPanel(app);

/**
 * §30 — почта и клан. Значок почты живёт в углу рядом с шестернёй и включается
 * слоем соседей; окно клана открывает строка задания.
 */
const mailButton = new MailButton(app);
storePanel = new StorePanel(app, {
  onState: (state) => {
    campHud.setCosmetics(state.personal.equipped, state.clan?.equipped ?? 'default');
    billingAppearance = {
      fire: campFireStyle(state.personal.fire),
      decor: campDecorStyle(state.personal.decor),
      heraldry: clanHeraldry(state.clan?.heraldry),
    };
    applyBillingAppearance();
  },
  hq: () => camp.levels.hq,
  at: () => clock.now(),
});
const clanPanel = new ClanPanel(app, {
  onFound: (name) => {
    if (!foundClan(camp, name, clock.now())) {
      play('deny');
      return;
    }
    play('build');
    campHud.notify(`Клан «${camp.clan?.name ?? name}» основан`);
    void cloudEnsureClan(camp.clan?.name ?? name);
    persist();
    campHud.sync(camp, clock.now(), 0);
    syncFarmUi();
  },
  onInvite: async () => {
    const token = await cloudClanInvite();
    if (token === null) {
      play('deny');
      campHud.notify(gameText(gameMessages.clanInviteCreateFailed));
      return;
    }
    const link = clanInviteLink(token);
    const result = await shareClanInvite(
      link,
      gameText(gameMessage('Вступай в мой клан «{name}» в Emberhold', 'Join my clan “{name}” in Emberhold'), {
        name: camp.clan?.name ?? '',
      }),
    );
    if (result === 'failed') {
      play('deny');
      campHud.notify(gameText(gameMessages.clanInviteShareFailed));
    } else campHud.notify(gameText(result === 'copied'
      ? gameMessages.clanInviteCopied
      : gameMessages.clanInviteChooseRecipient));
  },
});

const pendingClanInvite = clanInviteStartToken();
let clanInviteHandled = pendingClanInvite === null;
let clanInviteOpening = false;
const clanInvitePanel = new ClanInvitePanel(app, {
  onAccept: async (token) => {
    const membership = await cloudAcceptClanInvite(token);
    if (membership === null || !joinClan(
      camp,
      membership.name,
      membership.createdAt,
      membership.role === 'leader',
    )) {
      play('deny');
      campHud.notify(gameText(gameMessages.clanInviteJoinFailed));
      return false;
    }
    play('build');
    persist();
    campHud.sync(camp, clock.now(), 0);
    syncFarmUi();
    void storePanel.refresh();
    campHud.notify(gameText(gameMessages.clanInviteJoined, { name: membership.name }));
    return true;
  },
});

async function openPendingClanInvite(): Promise<void> {
  if (clanInviteHandled || clanInviteOpening || !hasSession || pendingClanInvite === null) return;
  clanInviteOpening = true;
  const preview = await cloudClanInvitePreview(pendingClanInvite);
  clanInviteOpening = false;
  clanInviteHandled = true;
  if (preview === null) clanInvitePanel.invalid();
  else clanInvitePanel.open(pendingClanInvite, preview);
}

const pendingGameReferral = gameReferralStartToken();
let gameReferralHandled = pendingGameReferral === null;
let gameReferralOpening = false;
async function acceptPendingGameReferral(): Promise<void> {
  if (gameReferralHandled || gameReferralOpening || !hasSession || pendingGameReferral === null) return;
  gameReferralOpening = true;
  const accepted = await cloudAcceptGameReferral(pendingGameReferral);
  gameReferralOpening = false;
  // A valid request is terminal even when it is an old/self referral. Network
  // failure stays retryable through the normal sign-in callback.
  if (accepted !== null) gameReferralHandled = true;
}

const clanBuildBar = new ClanBuildBar(app, {
  onSelect: (kind) => selectClanBuilding(kind),
  onBuilder: (residentId, assigned) => {
    if (!assignClanBuilder(camp, residentId, assigned, clock.now())) {
      play('deny');
      return;
    }
    clanBuildBar.sync(camp, clanPlacing, inClanCamp);
    persist();
  },
});

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
  // §9 — летопись открывается из настроек: своей кнопки на экране у неё нет.
  onStats: () => statsPanel.open(camp, clock.now()),
  onInvite: async () => {
    const token = await cloudGameReferral();
    if (token === null) {
      play('deny');
      campHud.notify(gameText(gameMessages.referralCreateFailed));
      return;
    }
    const result = await shareGameInvite(
      gameReferralLink(token),
      gameText(gameMessages.referralShareText),
    );
    if (result === 'failed') {
      play('deny');
      campHud.notify(gameText(gameMessages.referralShareFailed));
    } else campHud.notify(gameText(result === 'copied'
      ? gameMessages.referralCopied
      : gameMessages.referralChooseRecipient));
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
const platformAuth = cloudTelegramSignIn();
void platformAuth.then(() => cloudUser()).then((identity) => {
  hasSession = identity !== null;
  // §9 — с этого мига события пишутся на человека, а не на устройство:
  // иначе один игрок с телефона и с ноутбука считается двумя.
  if (identity !== null) analyticsIdentify(identity);
  if (identity !== null) void syncLanguage();
  if (identity !== null) void openPendingClanInvite();
  if (identity !== null) void acceptPendingGameReferral();
});

/**
 * Язык и аккаунт (§6.2.7). Спрошенный один раз на регистрации, он обязан
 * приезжать вместе с лагерем на любое устройство — иначе игрок отвечает
 * на один и тот же вопрос заново с каждого телефона.
 *
 * Кто кого перебивает: **облако старше устройства**. Устройство помнит
 * последний выбор в этом браузере, облако — выбор человека; чужой браузер
 * с чужим умолчанием иначе молча переучивал бы аккаунт. Пустая строка
 * в облаке — не спор, а первый вход: туда уезжает то, что выбрано здесь.
 */
async function syncLanguage(): Promise<void> {
  const api = window.EmberholdLanguage;
  if (api === undefined) return;
  const saved = await cloudLanguage();
  if (saved === null) {
    await cloudSetLanguage(api.current);
    return;
  }
  if (saved !== api.current) api.set(saved);
}

// Выбор языка в настройках или на карточке регистрации уезжает в облако
// сразу: второй раз о нём не спросят ни здесь, ни на другом устройстве.
addEventListener('emberhold-language-changed', () => {
  const api = window.EmberholdLanguage;
  if (api !== undefined) void cloudSetLanguage(api.current);
  syncFarmUi();
  residentManager?.sync(camp, clock.now(), true);
  if (residentCard.visible) residentCard.sync(camp, shownResident);
  heroCard.sync(roster, shownHero, clock.now());
});
const authCard = new AuthCard(app);
// Ссылка из письма открывает свою вкладку уже вошедшей; эта узнаёт
// о сессии через хранилище — карточка снимается, «Играть» снова играет.
cloudOnSignIn(() => {
  if (hasSession) return;
  hasSession = true;
  authCard.hide();
  void cloudUser().then((email) => {
    if (email !== null) analyticsIdentify(email);
  });
  void syncLanguage();
  void syncCloud();
  void openPendingClanInvite();
  void acceptPendingGameReferral();
});

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
const debugScene = debugSceneOpen(debugParams);

function persist(): void {
  if (wiped || debugScene) return;
  save(camp, roster, clock.watermark, onboarding.step);
  pushCloud();
}

/** Очередь HUD получает честный порядковый номер даже при миграции пачкой. */
function showAchievements(defs: readonly AchievementDef[]): void {
  if (defs.length === 0) return;
  const total = ACHIEVEMENTS.filter((def) => camp.achievements?.earned[def.id] !== undefined).length;
  const before = Math.max(0, total - defs.length);
  defs.forEach((def, index) => achievementToast.show(def, before + index + 1));
}

/** Единственная точка выдачи: состояние сначала, HUD затем, сохранение зовёт событие. */
function grantAchievement(id: AchievementId, now: number): boolean {
  const def = earnAchievement(camp, id, now);
  if (def === null) return false;
  showAchievements([def]);
  return true;
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

/** Что из меток уже в облаке: гонять список без изменений — пустая сеть. */
let sentVisits = '';

/** Отложка на несколько секунд: persist() зовётся на каждом событии,
 *  а облаку хватает последнего состояния, не каждого. */
function pushCloud(): void {
  if (!cloudReady || cloudTimer !== null) return;
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    const raw = rawSave();
    if (raw !== null) void cloudPush(raw, clock.watermark);
    // Метки мира (§4) — отдельной таблицей: их читают все, блоб — только хозяин.
    const live = liveVisits(camp.visits, clock.watermark).map((v) => ({ node: v.node, shift: v.shift }));
    const key = JSON.stringify(live);
    if (key !== sentVisits) {
      sentVisits = key;
      void cloudVisits(live);
    }
    pushCamp();
  }, 3000);
}

/**
 * Метки живых соседей (§30.6). Держатся в памяти и **не едут в сохранение**:
 * это чужие дельты, а сейв хранит только свои (§4). Пустой список — честный
 * ответ и без сети, и без соседей: мир тогда показывается ровно таким, каким
 * показывался до облака.
 */
let neighbours: Visit[] = [];
/**
 * Лагеря живых соседей (§30.7) — та же память и тот же срок жизни.
 * Пока сервер пуст, два снимка разработки не дают соседскому слою исчезнуть.
 */
let liveCamps: LiveCamp[] = simulatedCampRows();
campHud.setCamps(liveCamps);
statsPanel.setCamps(liveCamps);
/** Когда спрашивали в последний раз. Ноль — не спрашивали ни разу. */
let neighboursAt = 0;
/** Последний запрос общей карты и запрос в полёте. Карта публичная, поэтому
 * этот контур не зависит ни от входа, ни от сверки облачного сейва. */
let globalWorldAt = initialWorldInstalled ? clock.now() : 0;
let globalWorldPending = false;
/** Что уже отдано в общую таблицу: гонять строку без изменений — пустая сеть. */
let sentCamp = '';

/**
 * Подтянуть атомарный снимок карты. Минута — только срок обнаружения границы:
 * сами события шестичасовые, регион суточный, а лишний запрос здесь дешевле
 * отдельного клиентского таймера, который мог проспать в фоновой вкладке.
 */
function refreshGlobalWorld(now: number, force = false): void {
  if (debugScene || globalWorldPending) return;
  if (!force && now - globalWorldAt < 60) return;
  globalWorldAt = now;
  globalWorldPending = true;
  void cloudWorldSnapshot().then((snapshot) => {
    if (snapshot === null || !installWorldSnapshot(snapshot)) return;
    const at = clock.now();
    campHud.refreshWorld(at);
    returnScreen.setNeighbours(neighbours);
  }).finally(() => {
    globalWorldPending = false;
  });
}

/**
 * Спросить сервер о чужих заходах. Обновляется **сменами, а не секундами**:
 * богатство локации считается сменами (`world.ts`), и данные, которые
 * меняются реже, чем шкала, спрашивать чаще шкалы незачем. Возвращение
 * в лагерь спрашивает вне очереди — но не чаще минуты: сцена меняется
 * тапом, а сеть от этого зависеть не должна.
 *
 * Ответ фильтруется тем же `liveVisits`, что и свои метки: заходы прошлых
 * суток относятся к другому региону, а чужая строка, которую не подмёл крон
 * (§28), обязана отваливаться на чтении, а не портить сегодняшнюю карту.
 */
function refreshNeighbours(now: number, force = false): void {
  if (debugScene || !cloudReady) return;
  const fresh = now - neighboursAt;
  if (!force ? fresh < SHIFT_SEC : fresh < 60) return;
  neighboursAt = now;
  void cloudNeighbours().then((rows) => {
    neighbours = liveVisits(
      rows.map((r) => ({ node: r.node, shift: r.shift })),
      clock.now(),
    );
    campHud.setNeighbours(neighbours);
    returnScreen.setNeighbours(neighbours);
  });
  // Лагеря — тем же вопросом и тем же сроком: обе половины соседского слоя
  // отвечают на один вопрос «кто ещё есть», и спрашивать их врозь значило бы
  // показать заходы соседа раньше, чем самого соседа.
  void cloudCamps().then(async (rows) => {
    // Настоящие игроки целиком вытесняют демо: на живом сервере фикстуры
    // не притворяются аккаунтами. Пустой ответ возвращает их для разработки.
    liveCamps = rows.length > 0 ? rows : await cloudCampLikeStates(simulatedCampRows());
    campHud.setCamps(liveCamps);
    statsPanel.setCamps(liveCamps);
  });
}

/**
 * Отдать свою строку в общую таблицу (§30.7). Считается на месте тем же
 * правилом, каким читается чужая: таблица, в которой своё число считается
 * иначе, чем чужое, ничего не сравнивает.
 *
 * Отправляется вместе с сейвом и только при изменении: сила меняется
 * постройкой и ковкой, то есть редко, а строка без изменений — пустая сеть.
 */
function pushCamp(): void {
  const row = {
    clan: camp.clan?.name ?? null,
    power: campPower(camp),
    level: campLevel(camp),
    folk: 1 + camp.residents.length,
  };
  const key = JSON.stringify(row);
  if (key === sentCamp) return;
  sentCamp = key;
  void cloudCamp(row);
}

// Свёрнутая вкладка — последний шанс дожать отложенное: таймеры там не идут.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Вернулись. Монотонный счётчик браузера сон вкладки считает по-разному
    // (а ноутбук мог и уснуть), поэтому серверная отметка подтверждается —
    // молча и без ожидания: не ответил, значит идём на прежней привязке.
    if (!debugScene) void cloudTime().then((now) => now !== null && clock.sync(now));
    refreshGlobalWorld(clock.now(), true);
    return;
  }
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
  // Первый вопрос про соседей — сразу за сверкой: до неё сессии могло
  // не быть вовсе, и спрашивать было не от чьего имени.
  refreshNeighbours(clock.now(), true);
  return false;
}
void syncCloud();

/**
 * Показ кадра — единственное место, где онбординг что-то показывает или
 * прячет. Полосы включаются здесь, а не в цикле: сравнивать состояние
 * каждый тик значило бы драться с игроком за видимость элементов.
 */
function showOnb(step: OnbStep): void {
  hud.setReveal(reveal(step));
  setHint(ONB_HINT[step] ?? '');
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
 * потребность в ротации. Опыт начисляется за побеждённых врагов и итог
 * вылазки, а не за время в локации: иначе выгодно бродить, а не решать.
 */
function finishRaidForHero(
  state: RaidState,
  carried: number,
  evacuated: boolean,
  now: number,
): ReturnProgress | null {
  const hero = raidHero;
  raidHero = null;
  if (hero === null) return null;

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
    camp.levels.infirmary + researchInfirmaryBonus(camp),
    state.combatXp,
  );
  if (outcome.xp > 0) campHud.notify(`${name}: +${outcome.xp} опыта`);
  if (outcome.levels > 0) {
    campHud.notify(`${name}: уровень ${hero.level} · +${outcome.levels} очк. навыка`);
  }
  if (outcome.healSec > 0) {
    track({ t: 'heal_start', at: now, cls: hero.cls, wounds: outcome.wounds, seconds: outcome.healSec });
    // Здание называется только построенное. Прежде строка звала в Лазарет,
    // которого в игре не было вовсе; теперь он есть — но у того, кто его
    // не поставил, строка обязана остаться про время, а не про постройку.
    const where = camp.levels.infirmary > 0 ? `${BUILDINGS.infirmary.name}: ` : 'в строю через ';
    campHud.notify(
      `${name} ранен — ${where}${HeroCard.healText(outcome.wounds, camp.levels.infirmary + researchInfirmaryBonus(camp))}`,
    );
  }
  return { xp: outcome.xp, levels: outcome.levels, level: hero.level };
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

function syncFarmUi(): void {
  const now = clock.now();
  const advanced = syncFarmStory(camp, dayAt(now));
  farmOnboarding.sync(camp);
  campLocations.sync(camp, campLocation, now);
  farmCropPicker.sync(camp, now);
  farmBuildPanel.sync(camp, now);
  farmView.sync(camp.farm, now);
  syncRoadStoryTask();
  if (advanced) {
    campHud.notify(gameText(gameMessage('Огород: открыт день {day} из 15', 'Farm: day {day} of 15 unlocked'), {
      day: camp.farm?.story.day ?? 1,
    }));
    persist();
  }
}

/** Первая строка Фермы отвечает на «что здесь сейчас делать». */
function farmEntryHint(now: number): string {
  const status = farmStatus(camp.farm, now);
  if (status.ready > 0) {
    return gameText(gameMessage('Урожай готов: {count} · коснитесь спелой грядки', 'Harvest ready: {count} · touch a ripe garden bed'), {
      count: status.ready,
    });
  }
  if (status.growing > 0 && status.nextReadyAt !== null) {
    return gameText(gameMessage('Растёт: {count} · ближайший урожай через {time}', 'Growing: {count} · next harvest in {time}'), {
      count: status.growing,
      time: gameDuration(Math.max(60, status.nextReadyAt - now)),
    });
  }
  const crop = camp.farm?.selectedCrop ?? FARM_DEFAULT_CROP;
  const balance = FARM_CROPS[crop];
  return gameText(gameMessage('Выбрано: {crop} · {time} · {seed} → {harvest} ед. пищи', 'Selected: {crop} · {time} · {seed} → {harvest} food'), {
    crop: gameText(FARM_CROP_TEXT[crop].name),
    time: gameDuration(balance.growSeconds),
    seed: balance.seedFood,
    harvest: balance.harvestFood,
  });
}

/** Сменить соседнюю локацию, не превращая Ферму в место мировой карты. */
function switchCampLocation(next: CampLocation): void {
  if (mode !== 'camp') return;
  if (next === 'clan') {
    if (camp.clan == null) {
      play('deny');
      return;
    }
    toClanCamp();
    return;
  }
  if (inClanCamp) {
    toCamp();
    if (next === 'farm') switchCampLocation('farm');
    return;
  }
  const farm = camp.farm;
  if (next === 'farm' && farm?.unlocked !== true) {
    play('deny');
    return;
  }
  campLocation = next;
  placingSign = null;
  const onFarm = next === 'farm';
  if (!onFarm) farmBuildPanel.setVisible(false);
  if (onFarm) {
    buildPanel.setVisible(false);
    farmBuildPanel.setVisible(false);
    buildTool = null;
    selected = null;
    campView.hideBuildingSpot();
    placingTent = false;
    placingChest = false;
    stopCampMining();
    campView.highlight(null);
    campView.hideWallGhost();
    hidePlacingSpot();
  }
  farmView.group.visible = onFarm;
  farmCropPicker.setVisible(onFarm);
  campView.group.visible = !onFarm && !inGladeCamp;
  if (inGladeCamp && raidView !== null) raidView.group.visible = !onFarm;
  campHud.close();
  heroCard.setVisible(false);
  residentCard.setVisible(false);
  closeCharacter();
  heroFan.setVisible(!onFarm && !quietFrame());
  if (onFarm) {
    const now = clock.now();
    farmView.sync(camp.farm, now);
    rig.lookAt(farmView.center.x, farmView.center.z, true);
    rig.setZoom(18, true);
    setNight(0.18);
    campHud.notify(farmEntryHint(now));
  } else if (inGladeCamp && raid !== null) {
    rig.lookAt(raid.hero.x, raid.hero.z, true);
    rig.setZoom(20, true);
  } else {
    const c = campView.center;
    rig.lookAt(c.x, c.z, true);
    rig.setZoom(campArea(camp.levels.hq) * 2.8, true);
  }
  idleSeconds = 0;
  syncSignposts();
  syncFarmUi();
}

function showScene(scene: Scene, tier: Tier = 0): void {
  if (scene !== 'visit') visitCampHud.hide();
  if (scene !== 'camp') {
    campLocation = 'camp';
    inClanCamp = false;
    clanPlacing = null;
    clanBuildBar.setVisible(false);
    farmView.group.visible = false;
    farmCropPicker.setVisible(false);
    farmBuildPanel.setVisible(false);
  }
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
  farmOnboarding.setVisible(scene === 'camp');
  campLocations.setVisible(scene === 'camp');
  syncFarmUi();
  // Карточки героя и жильца не переживают смену сцены: их открывает тап
  // по лицу, а не сцена. Страница персонажа уходит с ними: она о человеке
  // лагеря, а сцена сменилась.
  heroCard.setVisible(false);
  residentCard.setVisible(false);
  closeCharacter();
  // §30.6 — вернулись в лагерь: чужие заходы могли случиться, пока игрок
  // был в вылазке, и карта откроется уже с ними.
  if (scene === 'camp') refreshNeighbours(clock.now(), true);
  // §30 — почта в углу видна во всех сценах, как шестерня рядом: она про
  // связь с соседями, а не про то, где сейчас герой. Открытый ящик со сценой
  // всё же уходит — окно поверх вылазки было бы окном поверх боя.
  mailButton.setShown(neighboursOpen(camp));
  mailButton.close();
  clanPanel.close();
  // Сводка закрывается со сменой сцены: она смотрит на игру со стороны,
  // и её незачем нести из лагеря в вылазку.
  statsPanel.close();
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
  syncSignposts();
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
  const state = worldAt(now, camp.visits, neighbours)[node];
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
      quiverBonus: archeryQuiverBonus(camp.levels.archery),
      scouting: watchtowerVision(camp.levels.watchtower) + researchScoutingBonus(camp),
      foodBonus: researchFoodBonus(camp),
      capacityBonus: researchBagBonus(camp),
      containerFood: Math.max(0, FOOD_COST.container - researchContainerDiscount(camp)),
    },
    now,
  );
  // Билет уезжает на сервер: там он и полежит до возвращения, и там же
  // назначается срок. Отправка при этом не ждёт сети — отряд уходит сразу,
  // а серверный срок, если он придёт, поправит местный. Без сессии всё
  // остаётся как было: поход считает клиент (см. collectSortie).
  const ticket = camp.sortie;
  // Отладочные кадры границу сохранения не пересекают (`persist`) — и границу
  // сервера тоже: тестовый билет, легший в облако, при следующем входе
  // вернулся бы отрядом, которого игрок никуда не посылал.
  if (!debugScene) void cloudSortieStart(ticket, hero).then((answer) => {
    if (answer === null || camp.sortie !== ticket) return;
    camp.sortie = { ...ticket, endsAt: answer.endsAt };
    const same = roster.heroes.find((h) => h.id === ticket.hero);
    if (same !== undefined && same.status === 'raid') same.busyUntil = answer.endsAt;
    persist();
  });
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
  /*
   * Добычу называет сервер (§26): он хранил билет и считал по нему тем же
   * кодом. Отказ — не беда и не обман: без сессии, без сети и в отладочном
   * кадре поход досчитывается здесь, ровно как считался до облака.
   *
   * Билет закрыт выше, до ответа: вкладка, закрытая посреди запроса, обязана
   * потерять отчёт, а не выдать его дважды.
   */
  void cloudSortieClaim<Report>().then((answer) =>
    applySortie(ticket, hero, answer?.report ?? reportOf(ticket, hero), clock.now()),
  );
  return true;
}

/** Что лагерь делает с отчётом — свой он или серверный, безразлично. */
function applySortie(ticket: Sortie, hero: HeroState, report: Report, now: number): void {
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
    camp.levels.infirmary + researchInfirmaryBonus(camp),
  );
  if (!report.failed) grantResearchNotes(camp);
  track({
    t: 'sortie',
    at: now,
    tier: ticket.tier,
    failed: report.failed,
    carried: report.total,
    seconds: ticket.endsAt - ticket.startedAt,
  });
  campHud.notify(report.text);
  campHud.suggestWorld('Отряд вернулся: выберите место');
  // Отчёт пришёл асинхронно — состояние обязано лечь в сейв здесь, а не ждать
  // следующего действия игрока: закрытая вкладка потеряла бы добычу похода.
  persist();
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
function toWheel(seed: number, node: number): boolean {
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
      // Замок — серверный (§6): «крутили сегодня» лежало в сейве игрока,
      // то есть игрок сам был себе судьёй. Спрашивается на выдаче, а не
      // на открытии: колесо крутится и без сети, а вот приз без ответа
      // сервера не начисляется дважды за сутки.
      void cloudWheel(node).then((got) => {
        if (got?.repeat !== true) return;
        // Сервер помнит сегодняшнюю прокрутку — значит эта вторая.
        // Приз не выдаётся, а замок чинится: сейв разошёлся с сервером.
        camp.wheelDay = got.day;
        persist();
      });
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
  if (place === null) return false;
  // Карточка — не единственная защита условия. Вход проверяет то же чистое
  // правило повторно: вызов из другой панели или устаревший кадр карты не
  // должны открыть особое место в обход показанного прогресса. Отладочные
  // адреса условие снимают намеренно — они заведены для прямого входа.
  const unlock = worldUnlock(place.kind, camp, roster);
  if (!debugScene && unlock !== null && !unlock.unlocked) {
    campHud.notify('Закрыто');
    return false;
  }
  leaveTitle();
  inGlade = false;
  inGladeCamp = false;
  chop = null;
  campPrompt.setVisible(false);
  // Замок (§6.1.6) — не вылазка: там нечего добывать и не с кем драться,
  // и заход в него не тратит ни богатство места, ни героя.
  if (place.kind === 'замок') return toCastle(node, nodeSeed(day, node));
  if (place.kind === 'замок минотавра') return toMinotaurCastle(node, nodeSeed(day, node));
  // Кладбище (§6.1.7) — та же прогулка, но населённая: добычи нет,
  // а привидения есть.
  if (place.kind === 'кладбище') return toGraveyard(node, nodeSeed(day, node));
  // Тропа (§6.1.17) — прогулка длинная: ход через лес, который проходят,
  // а не рассматривают. Добычи и противников нет — пока.
  if (place.kind === 'тропа') return toTrail(node, nodeSeed(day, node));
  // Колесо призов — аттракцион: одна прокрутка в день, кристаллы по сектору.
  if (place.kind === 'призы') return toWheel(nodeSeed(day, node), node);
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

  const state = worldAt(now, camp.visits, neighbours)[node];
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
    // §22.6б — первые заходы на ярус встречают тела уровнем ниже.
    visit: camp.tierRaids[tier],
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
    quiverBonus: archeryQuiverBonus(camp.levels.archery),
    scouting: watchtowerVision(camp.levels.watchtower) + researchScoutingBonus(camp),
    foodBonus: researchFoodBonus(camp),
    capacityBonus: researchBagBonus(camp),
    containerFood: Math.max(0, FOOD_COST.container - researchContainerDiscount(camp)),
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
/** Особый замок: хозяин, сундук и разговор живут одной сценой. */
let minotaurNow: MinotaurCastleSite | null = null;

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
      syncFarmUi();
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
 * Пост лесника у стен замка (`sim/woodsman.ts`, §6.1.6.3) и разговор с ним.
 * Живёт при сцене, как гость: пост выводится из сида замка заново на каждом
 * заходе, а переживает заход только нанятый — он вписан в жильцов лагеря.
 * Хранить «нанят здесь» незачем: лесника нанимают сколько угодно раз,
 * и второй у того же замка — не ошибка, а следующая цена.
 */
let woodsmanPost: WoodsmanPost | null = null;
let woodsmanTalk: WoodsmanTalk | null = null;
let woodsmanShown = false;
/**
 * Что показано в панели найма сейчас: кадр, цена и отказ. Панель
 * перерисовывается на смену этой строки, а не каждый кадр: монеты меняются
 * не только наймом (§20.5 — их дают за вход), и панель, застывшая на «монет
 * не хватает» после того, как они появились, врала бы игроку.
 */
let woodsmanShownKey = '';

/**
 * Разговор с лесником: кадры листает игрок, наём списывает монеты
 * (§20.5) и вписывает человека в жильцы. Палатку он с собой не приносит —
 * в отличие от гостя, у которого хозяйство своё: лесник нанят, а не позван,
 * и крышу ему обязан дать наниматель.
 */
function woodsmanCallbacks(): MeetPanelCallbacks {
  const redraw = (): void => {
    if (woodsmanPost === null || woodsmanTalk === null) return;
    const price = nextWoodsmanPrice(camp);
    const block = hireBlock(camp);
    woodsmanShownKey = `${woodsmanTalk.step}:${price}:${block}`;
    meetPanel.showWoodsman(woodsmanPost, woodsmanTalk, price, block);
    setHint('');
  };
  return {
    onName: () => {},
    onAnswer: () => {},
    onAdvance: () => {
      if (woodsmanTalk === null) return;
      advanceHire(woodsmanTalk);
      redraw();
    },
    onInvite: () => {
      if (woodsmanPost === null || woodsmanTalk === null) return;
      const block = hireBlock(camp);
      if (block !== 'ok') {
        play('deny');
        raid?.events.push(HIRE_REASON[block]);
        return;
      }
      const price = nextWoodsmanPrice(camp);
      const hired = hireWoodsman(camp, woodsmanPost);
      if (hired === null) {
        play('deny');
        return;
      }
      woodsmanTalk.hired = true;
      syncFarmUi();
      persist();
      play('build');
      raid?.events.push(`${hired.name} нанят · монеты −${price}`);
      // Хозяйство поста сворачивается вместе с ним: наняли человека —
      // у стен не остаётся ни его, ни палатки, ни мишени.
      raidView?.clearWoodsman();
      advanceHire(woodsmanTalk);
      meetPanel.hide();
      woodsmanShown = false;
    },
  };
}

/**
 * Разговор с лесником открывается подходом и гаснет уходом — тем же жестом,
 * что лавка торговца (§13.5) и стоянка гостя (§6.1.6.2).
 */
function syncWoodsmanTalk(): void {
  if (raid === null || woodsmanPost === null || woodsmanTalk === null) return;
  if (woodsmanTalk.hired) {
    if (woodsmanShown) {
      woodsmanShown = false;
      meetPanel.hide();
    }
    return;
  }
  const near =
    Math.hypot(
      raid.hero.x - woodsmanPost.stand.x,
      raid.hero.z - woodsmanPost.stand.z,
    ) <= 2.5;
  if (!near) {
    if (woodsmanShown) {
      woodsmanShown = false;
      woodsmanShownKey = '';
      meetPanel.hide();
    }
    return;
  }
  const price = nextWoodsmanPrice(camp);
  const block = hireBlock(camp);
  const key = `${woodsmanTalk.step}:${price}:${block}`;
  if (woodsmanShown && key === woodsmanShownKey) return;
  woodsmanShown = true;
  woodsmanShownKey = key;
  meetOn = woodsmanCallbacks();
  meetPanel.showWoodsman(woodsmanPost, woodsmanTalk, price, block);
  setHint('');
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

/** Тропа, пока по ней идут: ручка отладочной сцены `?trail`. */
let trailSite: TrailSite | null = null;
/** Сюжетный обоз существует только на Тропе и только пока человека не позвали. */
let roadSurvivorAt: Cell | null = null;
let roadSurvivor: Settler | null = null;
/** `?trail&caravan`: точка визуальной проверки, не состояние игры. */
let debugCaravanAt: Cell | null = null;
let roadSurvivorShown = false;

/** Подход к выжившему открывает тот же нижний разговор, что другие встречи. */
function syncRoadSurvivor(): void {
  if (raid === null || roadSurvivorAt === null || roadSurvivor === null) return;
  const caravan = camp.roadStory?.step === 'find-caravan';
  const bridge = camp.bridgeStory?.step === 'find-crew';
  if (!caravan && !bridge) return;
  const near = Math.hypot(
    raid.hero.x - roadSurvivorAt.x,
    raid.hero.z - roadSurvivorAt.z,
  ) <= 2.5;
  if (near && !roadSurvivorShown) {
    roadSurvivorShown = true;
    if (bridge) meetPanel.showBridgeCrew(roadSurvivor, camp);
    else meetPanel.showRoadSurvivor(roadSurvivor);
    setHint('');
  } else if (!near && roadSurvivorShown) {
    roadSurvivorShown = false;
    meetPanel.hide();
  }
}

/** У заставы выбирают устройство работы, а не «правильную» реплику. */
function decideBridge(route: SupplyRoute): void {
  if (raid === null || !settleBridge(camp, route, dayAt(clock.now()))) {
    play('deny');
    return;
  }
  const line = route === 'work'
    ? gameMessage('Артель получает лес и отвечает за настил', 'The crew gets timber and takes responsibility for the decking')
    : route === 'trade'
      ? gameMessage('Дорожный сбор признан платой за содержание моста', 'The road toll is recognized as payment for bridge upkeep')
      : gameMessage('Лагерь выставляет свою охрану у переправы', 'The camp stations its own guards at the crossing');
  raid.events.push(gameText(line));
  play('build');
  roadSurvivorShown = false;
  meetPanel.hide();
  syncRoadStoryTask();
  persist();
}

/** Человек уходит в лагерь, а рассказ о нападении переводит цель к дороге. */
function inviteRoadSurvivor(): void {
  if (
    camp.roadStory?.step !== 'find-caravan' ||
    roadSurvivor === null ||
    raid === null
  ) return;
  const caravaner = {
    name: roadSurvivor.name,
    look: roadSurvivor.look,
    seed: roadSurvivor.seed,
    answer: 'кормим' as const,
    rest: false,
  };
  if (!admit(camp, caravaner)) {
    play('deny');
    raid.events.push(gameText(gameMessage(
      'В лагере уже есть человек с таким именем',
      'Someone with that name already lives in camp',
    )));
    return;
  }
  const admitted = camp.residents.find((resident) =>
    resident.name === caravaner.name && resident.seed === caravaner.seed
  );
  rescueCaravaner(camp, admitted === undefined
    ? undefined
    : { id: residentUuid(admitted), name: admitted.name });
  syncFarmUi();
  raid.events.push(gameText(gameMessage(
    '{name} идёт в лагерь · у повозки уцелел мешок зерна',
    '{name} heads to camp · a sack of grain survived by the wagon',
  ), { name: roadSurvivor.name }));
  play('build');
  raidView?.callSettler(raid.hero.x, raid.hero.z);
  roadSurvivorShown = false;
  roadSurvivorAt = null;
  roadSurvivor = null;
  meetPanel.hide();
  syncRoadStoryTask();
  persist();
}

/**
 * §13.8 — куст места под пальцем: чем сцена отвечает на тап и по чему считает
 * полноту узла. Одна функция на все три ответа (кадр, тап, отказ) намеренно:
 * три копии этой четвёрки разошлись бы молча, и первым разошёлся бы тот,
 * кто решает, есть ли на кусте ягоды.
 *
 * `locals` — люди места. У замка это ворота и размах поля; **у кладбища
 * их нет вовсе**, и это не пропуск: живых там не живёт, там привидения
 * (§6.1.7.1), а привидение ягод не собирает. Пока «местные» были безымянным
 * множителем формулы, кладбищенский дичок обирал никто — формула объявляла
 * его пустым, а показать было некого.
 */
function walkSite(): {
  place: string;
  bushes: readonly Bush[];
  locals: Locals | null;
  seed: number;
} | null {
  if (castleNow !== null) {
    return {
      place: 'замок',
      bushes: castleNow.bushes,
      locals: localsOf(castleNow.gate, castleNow.bushes),
      seed: castleNow.loc.seed,
    };
  }
  if (graveSite !== null) {
    return { place: 'кладбище', bushes: graveSite.bushes, locals: null, seed: graveSite.loc.seed };
  }
  return null;
}

/**
 * §13.8 — местные у своих кустов: круги и то, что у них в руках. Живут при
 * сцене места, как гарнизон: заход считает их один раз, уход выбрасывает.
 */
let gatherers: Gatherer[] = [];
let gatherLoad: (boolean | undefined)[] = [];

/**
 * Расставить местных. Кого выпустить, решает формула (`takenBushes`), а не
 * эта функция: она только переводит её ответ в тела.
 *
 * Тела берутся у жильцов сцены (`setResidents`) — тех самых, которыми
 * поляна показывает рутину лагеря. В замке и на кладбище список пуст,
 * и второй набор скелетов ради тех же людей был бы вторым способом
 * поставить человека на клетку.
 */
function seatGatherers(site: CastleSite, locals: Locals | null): void {
  gatherers = [];
  gatherLoad = [];
  if (raidView === null || locals === null) return;
  const now = clock.now();
  gatherers = gatherersOf(
    {
      seed: site.loc.seed,
      size: site.loc.size,
      blocked: site.loc.blocked,
      bushes: site.bushes,
      locals,
    },
    now,
  );
  raidView.setResidents(
    gatherers.map((g) => {
      const at = choreAt(g.chore, now);
      // Инструмента нет: ягоды рвут руками (§13.8), и топор в руке
      // собирателя обещал бы дровосека.
      return { look: 'поселенец' as DwellerLook, x: at.x, z: at.z, facing: at.facing, seated: false };
    }),
  );
}

/**
 * Тик местных. Устройство — `stepChores` поляны до буквы, и это то же самое
 * устройство: маршрут — чистая функция часов, тела разведены вокруг героя.
 * Разница ровно в двух вещах: сидящих у места нет (расталкивать некого),
 * и ночи у места нет (§24 читается по небу, а неба тут нет).
 */
function stepGatherers(dt: number): void {
  if (raid === null || raidView === null || gatherers.length === 0) return;
  const size = raid.loc.size;
  const free = (x: number, z: number): boolean => {
    const cx = Math.round(x);
    const cz = Math.round(z);
    if (cx < 0 || cz < 0 || cx >= size || cz >= size) return false;
    return raid!.loc.blocked[idx(size, cx, cz)] === 0;
  };
  const frames = choresAt(
    gatherers.map((g) => g.chore),
    clock.now(),
    [{ x: raid.hero.x, z: raid.hero.z }],
    free,
  );
  frames.forEach((f, i) => {
    if (f === null) return;
    raidView!.driveResident(i, f.x, f.z, f.walking, f.working, dt, {
      speed: DWELLER_SPEED,
      // Сидит на корточках: у куста не рубят и не кайлят (§13.8).
      workClip: RESIDENT_WORK_CLIP['кормим'],
      glide: true,
    });
    if (!f.walking) raidView!.faceResident(i, f.facing, dt);
    // Домой с горстью, обратно налегке — та же половина круга, что у рутины
    // поляны, и то же объяснение, зачем он ходил.
    if (f.carrying !== gatherLoad[i]) {
      gatherLoad[i] = f.carrying;
      raidView!.setResidentLoad(i, f.carrying ? 'кормим' : null);
    }
  });
}

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
  minotaurNow = null;
  minotaurLeft = false;
  minotaurPanel.hide();
  graveSite = null;
  // §13.8 — местные живут при сцене места: сцены нет, и ходить некому.
  gatherers = [];
  gatherLoad = [];
  readStone = null;
  trailSite = null;
  roadSurvivorAt = null;
  roadSurvivor = null;
  if (roadSurvivorShown) meetPanel.hide();
  roadSurvivorShown = false;
  tradePanel.setVisible(false);
  traderWasNear = false;
  // Гость живёт при сцене замка: сцены нет — нет ни гостя, ни разговора.
  castleGuest = null;
  guestMeet = null;
  if (guestShown) meetPanel.hide();
  guestShown = false;
  // Пост лесника — тем же правилом: он стоит у стен, а не в игре.
  woodsmanPost = null;
  woodsmanTalk = null;
  if (woodsmanShown) meetPanel.hide();
  woodsmanShown = false;
  woodsmanShownKey = '';
}

function toMinotaurCastle(node: number, seed: number): boolean {
  const hero = heroForRaid();
  if (hero === null) {
    campHud.notify('Для встречи с минотавром нужен свободный герой');
    return false;
  }
  const defeated = (camp.minotaurVictories ?? []).includes(seed >>> 0);
  const claimed = (camp.minotaurClaims ?? []).includes(seed >>> 0);
  const site = generateMinotaurCastle(seed, defeated, claimed);
  leaveWalkSites();
  minotaurNow = site;
  raidNode = node;
  hero.status = 'raid';
  raidHero = hero;
  chop = null;
  raidView?.dispose();
  raid = createRaid({
    seed, tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero), followers: followersOf(hero),
    loc: site.loc, evacOpen: true, containerFood: 0, hunger: false,
    gear: camp.gear, offhand: camp.offhand,
  });
  raidView = new RaidView(
    raid.loc, raid.loadout.cls, grassPerTile, 'castle', site, null, null,
    camp.gear.weapon, mateClasses(raid), false,
  );
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(24, true);
  setNight(0.25);
  resultShown = false;
  ear.reset(raid);
  showScene('raid', 0);
  return true;
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
  // §13.8 — полнота кустов места считается формулой от сида и часов;
  // сцена её не знает и получает готовый ответ.
  raidView = new RaidView(
    raid.loc, raid.loadout.cls, grassPerTile, 'grave', null, site, null,
    camp.gear.weapon, mateClasses(raid), false,
    // §13.8 — на кладбище обирать некому: живых там не живёт (§6.1.7.1),
    // и полнота дичка держится на одном созревании.
    (bush) => worldRipe(site.loc.seed, 'кладбище', bush, null, camp.picks ?? {}, clock.now()),
  );
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
  // §13.8 — люди замка: ворота, от которых они ходят, и размах поля, которым
  // мерится «далеко». Считается один раз на заход: кусты за прогулку
  // не переезжают.
  const locals = localsOf(site.gate, site.bushes);
  raidView = new RaidView(
    raid.loc, raid.loadout.cls, grassPerTile, 'castle', site, null, null,
    camp.gear.weapon, mateClasses(raid), false,
    (bush) => worldRipe(site.loc.seed, 'замок', bush, locals, camp.picks ?? {}, clock.now()),
  );
  // Обираемые узлы получают тех, кто их обирает: формула сказала, кадр
  // показал, и второго мнения о том же кусте не заведено.
  seatGatherers(site, locals);
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
  /**
   * Пост лесника (§6.1.6.3). В отличие от гостя, условий у него нет: он
   * стоит у каждого замка и каждый раз, потому что это услуга, а не находка,
   * и редкостью цена ему не служит — ценой служит цена.
   */
  woodsmanPost = woodsmanPostAt(site);
  if (woodsmanPost !== null) {
    woodsmanTalk = startHireTalk();
    raidView.putWoodsman('лесник', woodsmanPost);
  }
  hud.setGrass(grassPerTile);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  // Замок выше всего, что игра показывала до сих пор: с высоты вылазки
  // стена закрывала бы двор целиком.
  rig.setZoom(26, true);
  // Поверхность: замок живёт теми же сутками, что лагерь, чтобы фонари
  // зажигались ночью, а не по отладочной постоянной.
  setNight(nightAt(campTime()));
  resultShown = false;
  ear.reset(raid);
  showScene('raid', 0);
  return true;
}

/**
 * Тропа (§6.1.17). Собирается тем же `createRaid`, что все прогулки: ходьба,
 * шаг и камера обязаны считаться одинаково везде.
 *
 * В отличие от прежней прогулки, в тупиках живут лисы и с них снимают добычу;
 * голода всё ещё нет, а выход открыт сразу: охота здесь добровольна. Герой не занимается
 * той же причиной, что на прогулках-участках: заход не обязан снимать
 * с ротации того, кто просто прошёлся.
 */
function toTrail(node: number, seed: number): boolean {
  const hero = heroForRaid() ?? roster.heroes[0]!;
  chop = null;
  const site = generateTrailSite(seed);
  const roadEncounter = camp.roadStory?.step === 'find-caravan' || camp.bridgeStory?.step === 'find-crew'
    ? caravanEncounter(site)
    : null;
  if (roadEncounter !== null) clearCaravanApproach(site, roadEncounter);
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
  if (camp.roadStory?.step === 'find-caravan') {
    const encounter = roadEncounter!;
    roadSurvivorAt = encounter.survivor;
    roadSurvivor = caravanSurvivor(seed, new Set(camp.residents.map((r) => r.name)));
    // Разбросанные ящики — остаток обоза. Существующая модель хранилища
    // говорит это без новой иконки или подписи поверх леса.
    raidView.setChests(encounter.cargo);
    raidView.setBrokenCaravan(encounter.wagon, encounter.survivor);
    raidView.putSettler(
      roadSurvivor.look,
      encounter.survivor.x,
      encounter.survivor.z,
      0,
    );
  } else if (camp.bridgeStory?.step === 'find-crew') {
    const encounter = roadEncounter!;
    roadSurvivorAt = encounter.survivor;
    roadSurvivor = caravanSurvivor(
      seed ^ 0x6d6f7374,
      new Set(camp.residents.map((r) => r.name)),
    );
    // Ящики у заставы обозначают инструмент и припасы артели.
    raidView.setChests(encounter.cargo.slice(0, 2));
    raidView.putSettler(
      roadSurvivor.look,
      encounter.survivor.x,
      encounter.survivor.z,
      0,
    );
  }
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
  if (camp.roadStory?.step === 'find-caravan') {
    raid.events.push(gameText(gameMessage(
      'На боковой дороге видны брошенные ящики',
      'Abandoned crates are visible down a side road',
    )));
  } else if (camp.bridgeStory?.step === 'find-crew') {
    raid.events.push(gameText(gameMessage(
      'У старой заставы ждёт дорожная артель',
      'A road crew is waiting at the old tollhouse',
    )));
  }
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

  // Выбор клетки и стройка палатки — два разных действия. После первого
  // остаётся видимая строительная стадия; только тап по ней натянет полотно,
  // спишет дерево и поведёт дальше к костру.
  if (placing === 'hq') {
    raidView?.place('hq', cell.x, cell.z, 1, true);
    play('build');
    pitched.push(cell);
    tentUnderConstruction = cell;
    placing = null;
    raidView?.hideSite();
    setHint('Коснитесь каркаса, чтобы построить палатку');
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
  const price = KITCHEN_WOOD;
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

/**
 * Завершить палатку после выбора места. Строительная версия заменяется
 * готовой тем же мешем `placed.hq`, поэтому ни след, ни раскладка не прыгают.
 */
function finishTent(): void {
  if (raid === null || tentUnderConstruction === null) return;
  const cell = tentUnderConstruction;
  tentUnderConstruction = null;

  const paid = Math.min(TENT_WOOD, raid.bag.wood);
  raid.bag.wood -= paid;
  raid.bagTotal -= paid;
  raidView?.setLevel('hq', 1);
  play('build');

  // Кладовая появляется вместе с готовой палаткой, не рядом с недостроенным
  // каркасом: бонус рюкзака — результат стройки, а не выбора клетки.
  if (camp.chests.length === 0 && gladeChest === null) {
    const spot = chestSiteNear(raid.loc, pitched, raid.hero, cell);
    if (spot !== null) {
      gladeChest = spot;
      raidView?.setChests([spot]);
      raid.events.push(`Сундук у палатки: кладовая +${CHEST_BONUS}`);
    }
  }

  startPlacing('kitchen');
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
  // §13.11 — резонанс умножает только секунды работы: дорога к дереву,
  // таймеры лагеря и всё остальное идёт своим временем.
  const step = stepChop(raid, chop, dt * tempoBoost(tempo, clock.now()));
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
    showReward('wood', chop.cell.x, chop.cell.z, 1, 0.72);
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
/**
 * §13.8 — сбор ягод в местах мира. Отличий от лагеря два, и оба про место:
 * пища идёт в кладовую лагеря напрямую (в рюкзак её класть нельзя — это
 * не добыча вылазки), а сорванное пишется в самоистекающий список
 * (`camp.picks`), потому что узлы мест не хранятся вовсе.
 */
function startWorldPicking(place: string, bush: Bush, locals: Locals | null, seed: number): void {
  if (raid === null) return;
  /**
   * §13.8 — отказ называет ту же причину, что кадр. «Ягоды ещё не поспели»,
   * сказанное над кустом, от которого местный уносит горсть, было бы третьим
   * мнением о том же узле: формула считает, собиратель показывает, а строка
   * говорила бы своё.
   */
  const block = worldBlock(seed, place, bush, locals, camp.picks ?? {}, clock.now());
  if (block !== 'ok') {
    play('deny');
    say(PICK_REASON[block]);
    return;
  }
  chop = null;
  mine = null;
  worldPick = { place, bush, work: startPick(bush) };
  commandMove(raid, bush);
  raidView?.showMarker(bush.x, bush.z);
}

function stepWorldPicking(dt: number): void {
  if (raid === null || worldPick === null) return;
  const { place, bush, work } = worldPick;
  const foodBefore = camp.resources.food;
  const step = stepPickInto(
    raid.hero,
    raid.path.length > 0,
    [bush],
    work,
    // §13.11 — резонанс умножает и сбор: аппарат работы общий (work.ts),
    // и выключенная у куста игра читалась бы поломкой, а не решением.
    dt * tempoBoost(tempo, clock.now()),
    camp.resources,
    clock.now(),
  );
  if (step.stopped !== null) {
    play('deny');
    say(
      step.stopped === 'gone' || step.stopped === 'ok'
        ? PICK_REASON['пусто']
        : MINE_REASON[step.stopped],
    );
    worldPick = null;
    raidView?.hideWork();
    return;
  }
  if (raid.path.length > 0) {
    raidView?.hideWork();
    return;
  }
  raidView?.showWork(work.cell.x, work.cell.z, mineProgress(work));
  if (step.swing) play('build');
  if (step.taken) {
    // Узел места не хранится — хранится то, что его тронули (§13.8).
    camp.picks = { ...(camp.picks ?? {}), [pickKey(place, bush.id)]: clock.now() };
    if (gatherFarmFood(camp, step.food)) syncFarmUi();
    const gained = camp.resources.food - foodBefore;
    showReward('food', work.cell.x, work.cell.z, gained);
    say(`+${gained} · ${RESOURCE_NAME.food}`);
    play('levelup');
    worldPick = null;
    raidView?.hideWork();
    raidView?.refreshBushes();
    persist();
  }
}

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
  // §13.11 — резонанс умножает секунды кайла тем же правилом, что у топора.
  const step = stepMine(raid, mine, dt * tempoBoost(tempo, clock.now()));
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
    showReward('stone', mine.cell.x, mine.cell.z, stone === null ? 1 : mineYield(stone));
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
  // Пока лагерь ещё ставится, кадром распоряжается выбор места или отдельная
  // стройка палатки: их подсказки не должны перебиваться отдыхом, а три
  // бруска в сумке не должны случайно засчитаться улучшением недостроя.
  if (placing !== null || tentUnderConstruction !== null) return;
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
  grantAchievement('first-camp', clock.now());
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
  tentUnderConstruction = null;
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

/**
 * Наработанное за отлучку — первым и один раз, общий у обеих сцен лагеря.
 *
 * §20.5 — монеты за вход говорятся здесь же и той же строкой. Отдельным
 * всплытием они стали бы вторым сообщением подряд об одном и том же:
 * «пока вас не было» и «за вход» — это оба про то, что дал заход.
 */
function notifyWorked(): void {
  if (workShown) return;
  /**
   * §13.7 — содержание говорит первым, и говорит только когда есть что
   * сказать. Строка молчит про съеденное в срок: расход, идущий как надо,
   * событием не является (§23.1), а вот голод и погасший костёр — являются.
   */
  const trouble: string[] = [];
  if (upkeep.hungry > 0) trouble.push(`голодных ${upkeep.hungry}`);
  if (upkeep.dark) trouble.push('костёр погас');
  const parts: string[] = [];
  if (worked.length > 0) {
    parts.push(worked.map((w) => `${RESOURCE_NAME[w.kind]} ${w.n}`).join(' · '));
  }
  if (farmHarvestOffline.food > 0) {
    parts.push(
      gameText(gameMessage('{names}: собран урожай с {plots} грядок · пища +{food} · помощь +{bonus}', '{names}: harvested {plots} beds · food +{food} · helper bonus +{bonus}'), {
        names: farmHarvestOffline.helpers.join(', '),
        plots: farmHarvestOffline.plots,
        food: farmHarvestOffline.food,
        bonus: farmHarvestOffline.bonus,
      }),
    );
  }
  for (const report of huntReportsOffline) {
    parts.push(report.foxes === 0
      ? `${report.name}: охота без добычи`
      : `${report.name}: лис ${report.foxes}, мясо ${report.meat}, шкур ${report.pelts}`);
  }
  if (gotCoins > 0) parts.push(`монеты ${gotCoins}`);
  if (parts.length === 0 && trouble.length === 0) return;
  workShown = true;
  if (parts.length > 0) campHud.notify(`Пока вас не было: ${parts.join(' · ')}`);
  if (trouble.length > 0) campHud.notify(`В лагере кончилась пища: ${trouble.join(', ')}`);
}

/**
 * Вход в лагерь. Тел у него два. Нормальная игра — поляна: лагерь стоит там,
 * где кончился пролог, и сцена не подменяется никогда (`toGladeCamp`).
 * Площадка CampView — язык старых сейвов без снимка поляны и отладочных
 * адресов: второй лагерь существует чисто для тестов (`toPadCamp`).
 */
function toCamp(): void {
  visitingCamp = null;
  visitCampHud.hide();
  campLocation = 'camp';
  inClanCamp = false;
  clanPlacing = null;
  clanBuildBar.setVisible(false);
  farmView.group.visible = false;
  // Снятие прошлой сцены повторится в теле — и пусть: вызов идемпотентен,
  // а правило арх-теста «каждый to* начинается с уборки» дороже одной строки.
  leaveWalkSites();
  if (camp.glade !== undefined) toGladeCamp();
  else toPadCamp();
  const reconciled = reconcileAchievements(camp, clock.now());
  if (reconciled.length > 0) {
    showAchievements(reconciled);
    persist();
  }
  syncRoadStoryTask();
  applyBillingAppearance();
}

/**
 * Открыть публичный снимок соседа. Сейчас такие снимки есть у двух
 * детерминированных аккаунтов разработки; сетевые строки без снимка карту
 * показывают, но кнопку входа не получают.
 */
function visitNeighbourCamp(id: string): void {
  const snapshot = simulatedCamp(id);
  if (snapshot === null) {
    play('deny');
    return;
  }
  const publicRow = liveCamps.find((row) => row.id === id);
  const target: InspectableCamp = {
    ...snapshot,
    likes: publicRow?.likes ?? snapshot.likes ?? 0,
    liked: publicRow?.liked ?? snapshot.liked ?? false,
  };

  leaveTitle();
  leaveWalkSites();
  visitingCamp = target;
  campLocation = 'camp';
  inGlade = false;
  inGladeCamp = false;
  inClanCamp = false;
  clanPlacing = null;
  clanBuildBar.setVisible(false);
  farmView.group.visible = false;
  farmCropPicker.setVisible(false);
  raidView?.dispose();
  raidView = null;
  raid = null;

  campView.group.visible = true;
  campView.setAppearance({ fire: 'standard', decor: 'none', heraldry: 'plain' });
  campView.setCamp(target.camp);
  const walls = target.camp.walls ?? emptyWalls();
  campView.setWalls(wallPieces(walls));
  campView.setFences(fencePieces(walls));
  campView.setRoads(roadSpots(walls));
  campView.setLamps(lampSpots(walls));
  const guest = createCampHero(target.camp);
  campView.setHeroClass(activeHero(roster).cls);
  campView.setHero(guest.x, guest.z, guest.facing, guest.y);

  campInput.reset();
  const center = campView.center;
  rig.lookAt(center.x, center.z, true);
  rig.setZoom(campArea(target.camp.levels.hq) * 2.8, true);
  setNight(0.22);
  showScene('visit');
  visitCampHud.show(target);
  idleSeconds = 0;
}

/** Один и тот же итог раздаётся гостевому HUD, карте и обоим лидербордам. */
function applyCampLike(id: string, liked: boolean, likes: number): void {
  liveCamps = liveCamps.map((row) => row.id === id ? { ...row, liked, likes } : row);
  if (visitingCamp?.id === id) visitingCamp = { ...visitingCamp, liked, likes };
  campHud.setCamps(liveCamps);
  statsPanel.setCamps(liveCamps);
}

async function toggleVisitedCampLike(): Promise<void> {
  const target = visitingCamp;
  if (target === null || visitedLikePending) return;
  const beforeLiked = target.liked === true;
  const beforeLikes = target.likes ?? 0;
  const nextLiked = !beforeLiked;
  const nextLikes = Math.max(0, beforeLikes + (nextLiked ? 1 : -1));

  visitedLikePending = true;
  applyCampLike(target.id, nextLiked, nextLikes);
  visitCampHud.setLike(nextLiked, nextLikes, true);
  const saved = await cloudToggleCampLike(target.id);
  visitedLikePending = false;
  if (saved === null) {
    applyCampLike(target.id, beforeLiked, beforeLikes);
    if (visitingCamp?.id === target.id) visitCampHud.setLike(beforeLiked, beforeLikes, false, true);
    play('deny');
    return;
  }
  applyCampLike(target.id, saved.liked, saved.likes);
  if (visitingCamp?.id === target.id) visitCampHud.setLike(saved.liked, saved.likes);
  play('tap');
}

/** Возврат идёт именно на карту, а не просто во двор своего лагеря. */
function leaveVisitedCamp(): void {
  if (mode !== 'visit') return;
  visitingCamp = null;
  visitCampHud.hide();
  toCamp();
  campHud.openSheet('tiers');
}

function clanSiteNearHero(kind: ClanBuildingKind): Cell {
  if (raid === null) return { x: 0, z: 0 };
  const hx = Math.round(raid.hero.x);
  const hz = Math.round(raid.hero.z);
  for (let radius = 1; radius < 8; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const cell = { x: hx + dx, z: hz + dz };
        if (clanBuildBlock(camp, kind, cell, raid.hero) === 'ok') return cell;
      }
    }
  }
  return { x: hx, z: hz };
}

function selectClanBuilding(kind: ClanBuildingKind | null): void {
  if (!inClanCamp || raid === null) return;
  const location = ensureClanLocation(camp);
  if (kind !== null && location !== null && !clanCanAfford(location, kind)) {
    clanPlacing = null;
    raidView?.hideSite();
    clanBuildBar.setReason(clanResourceShortage(camp, kind));
    clanBuildBar.sync(camp, null, true);
    play('deny');
    return;
  }
  clanPlacing = kind;
  clanBuildBar.setReason(kind === null ? '' : 'Коснитесь свободного места на опушке');
  clanBuildBar.sync(camp, clanPlacing, true);
  if (kind === null) {
    raidView?.hideSite();
    return;
  }
  const cell = clanSiteNearHero(kind);
  const ok = clanBuildBlock(camp, kind, cell, raid.hero) === 'ok';
  raidView?.showSite(CLAN_BUILDINGS[kind].model, cell.x, cell.z, ok);
}

function tryPlaceClanBuilding(cell: Cell): void {
  if (!inClanCamp || raid === null || clanPlacing === null) return;
  const kind = clanPlacing;
  const block = placeClanBuilding(camp, kind, cell, raid.hero, clock.now());
  raidView?.showSite(CLAN_BUILDINGS[kind].model, cell.x, cell.z, block === 'ok');
  if (block !== 'ok') {
    play('deny');
    clanBuildBar.setReason(block === 'resources'
      ? clanResourceShortage(camp, kind)
      : CLAN_BUILD_REASON[block]);
    return;
  }
  play('build');
  clanPlacing = null;
  clanBuildBar.setReason(`${CLAN_BUILDINGS[kind].name}: стройка начата — нужны рабочие`);
  clanBuildBar.sync(camp, null, true);
  persist();
}

/**
 * Вход на отдельную опушку клана. Постройки восстанавливаются из состояния
 * клана и не подменяются зданиями личного лагеря главы.
 */
function toClanCamp(): void {
  leaveTitle();
  leaveWalkSites();
  const location = ensureClanLocation(camp);
  if (location === null) return;
  chop = null;
  campMine = null;
  campPick = null;
  buildPanel.setVisible(false);
  buildTool = null;
  selected = null;
  campView.hideBuildingSpot();
  placingTent = false;
  placingChest = false;
  raidView?.dispose();

  const blocked = unpackGlade(location.glade);
  const start = { x: location.glade.size >> 1, z: location.glade.size >> 1 };
  const loc: GameLocation = {
    seed: location.seed,
    tier: 0,
    size: location.glade.size,
    blocked,
    evac: start,
    containers: [],
    stones: [],
    enemies: [],
    backSteps: distanceField(location.glade.size, blocked, start),
  };
  const hero = heroForRaid() ?? roster.heroes[0]!;
  raidHero = null;
  raid = createRaid({
    seed: location.seed,
    tier: 0,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    followers: [],
    loc,
    food: gladeFood(),
    capacity: gladeCapacity(),
    evacOpen: false,
    containerFood: 0,
    hunger: false,
    risk: false,
    // Лес пока часть места, а не источник личного склада.
    logging: false,
  });
  raidView = new RaidView(
    raid.loc, raid.loadout.cls, grassPerTile, 'glade', null, null, null,
    camp.gear.weapon, [], debugFluffy,
  );
  rig.world.add(raidView.group);
  for (const building of location.buildings) {
    raidView.place(CLAN_BUILDINGS[building.kind].model, building.x, building.z);
  }
  if (location.construction !== null) {
    raidView.showSite(
      CLAN_BUILDINGS[location.construction.kind].model,
      location.construction.x,
      location.construction.z,
      true,
    );
  }
  campView.group.visible = false;
  farmView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(20, true);
  setNight(nightAt(campTime()));
  inGlade = false;
  inGladeCamp = false;
  inClanCamp = true;
  campLocation = 'clan';
  controlled = -1;
  parkedHero = null;
  resultShown = false;
  ear.reset(raid);
  showScene('camp');
  // На клановой опушке личные стройка, склад и веер не действуют.
  farmOnboarding.setVisible(false);
  campHud.setVisible(false);
  heroFan.setVisible(false);
  clanBuildBar.sync(camp, clanPlacing, true);
  applyBillingAppearance();
  syncFarmUi();
  persist();
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
  campPick = null;
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
  campDoor = door;
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
  campPick = null;
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
  if ((worked.length > 0 || farmHarvestOffline.food > 0) && !workShown) {
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
  active: () =>
    (mode === 'camp' || mode === 'visit') && campLocation === 'camp' &&
    buildTool === null && placingSign === null && !inGladeCamp,
  center: () => campView.center,
  area: () => campArea((visitingCamp?.camp ?? camp).levels.hq),
  // В гостевом режиме тот же жест двигает камеру, но тап ничего не меняет.
  onTap: (clientX, clientY) => {
    if (mode === 'camp') campTap(clientX, clientY);
  },
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
  // §13.11 — тап по клетке идущей работы подбадривает её и кайло не бросает:
  // резонанс и просит кликать по тому, что добывают.
  const beatCell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  const beatAt = campHero.path.length === 0
    ? campMine?.work.cell ?? campPick?.work.cell ?? null
    : null;
  if (beatAt !== null && beatAt.x === beatCell.x && beatAt.z === beatCell.z) {
    beatTempo(null, true);
    return;
  }
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
      campView.hideBuildingSpot();
      return;
    }
    // Отказ обязан быть слышен: молчащий тап читается как непопадание.
    campHud.notify(`${BUILDINGS[selected].name}: здесь не встанет`);
    selected = null;
    campView.highlight(null);
    campView.hideBuildingSpot();
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
  /**
   * §13.8 — тап по кусту. Спрашивается раньше валуна и здания по тому же
   * правилу, что валун: куст ловится ровно своей клеткой, а здание — с запасом,
   * и иначе куст у Склада был бы нетапаемым.
   */
  const bush = bushAt(camp.bushes ?? [], cell);
  if (bush !== null && free && campHero.level === 'земля') {
    if (!ripe(bush, clock.now())) {
      campHud.notify(PICK_REASON['зелёный']);
      return;
    }
    campHud.close();
    campView.highlight(null);
    startCampPicking(bush, nav);
    return;
  }

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
/**
 * §13.8 — сбор ягод в лагере. Всё, кроме награды и клипа, — тот же аппарат,
 * что у кайла: работа по клетке, замахи, остановка по причине. Второй копии
 * этих восьми секунд заводить нельзя (`work.ts` про это и написан).
 */
function startCampPicking(bush: Bush, nav: CampNav): void {
  campPick = { work: startPick(bush), bush };
  if (inReach(campHero, bush)) {
    campHero.path.length = 0;
    return;
  }
  const spot = standNear(campHero, bush, (x, z) =>
    x >= 0 && z >= 0 && x < nav.area && z < nav.area && nav.ground[idx(nav.area, x, z)] === 0);
  commandCampMove(camp, campHero, spot);
}

function stopCampPicking(): void {
  campPick = null;
  campView.hideWork();
}

/**
 * Тик сбора. Отличий от кайла три, и все три — про пищу: она идёт в кладовую
 * мимо потолка (§13.7, места не занимает), куст не исчезает, а созревает,
 * и время сбора пишется в сохранение — обобранный куст обязан пережить
 * перезагрузку так же, как разбитый валун.
 */
function stepCampPicking(dt: number): void {
  if (campPick === null) return;
  const { work, bush } = campPick;
  const foodBefore = camp.resources.food;
  const step = stepPickInto(
    campHero,
    campHero.path.length > 0,
    camp.bushes ?? [],
    work,
    // §13.11 — то же правило, что у сбора в местах мира.
    dt * tempoBoost(tempo, clock.now()),
    camp.resources,
    clock.now(),
  );
  if (step.stopped !== null) {
    play('deny');
    // «Пусто» — свой отказ куста (обобрали, пока шли); остальные причины
    // общие с кайлом, и слова у них те же.
    campHud.notify(
      step.stopped === 'gone' || step.stopped === 'ok'
        ? PICK_REASON['пусто']
        : MINE_REASON[step.stopped],
    );
    stopCampPicking();
    return;
  }
  if (campHero.path.length > 0) {
    campView.hideWork();
    return;
  }
  campView.showWork(work.cell.x, work.cell.z, mineProgress(work));
  if (step.swing) play('build');
  if (step.taken) {
    // Куст остаётся стоять — гаснут только ягоды (§13.8): пустая ветка
    // и есть «приходи позже», сказанное кадром.
    campView.pickBush(clock.now());
    if (gatherFarmFood(camp, step.food)) syncFarmUi();
    const gained = camp.resources.food - foodBefore;
    const origin = campOrigin(camp);
    showReward('food', origin.x + work.cell.x, origin.z + work.cell.z, gained);
    campHud.notify(`+${gained} · ${RESOURCE_NAME.food}`);
    campHud.sync(camp, clock.now(), 0);
    play('levelup');
    stopCampPicking();
    persist();
  }
  void bush;
}

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
  campPick = null;
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
    // §13.11 — резонанс общий у вылазки и лагеря, как сам аппарат работы.
    dt * tempoBoost(tempo, clock.now()),
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
    const gained = camp.resources.stone - stoneBefore;
    const origin = campOrigin(camp);
    showReward('stone', origin.x + work.cell.x, origin.z + work.cell.z, gained);
    campHud.notify(`+${gained} · ${RESOURCE_NAME.stone}`);
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
  if (mode === 'camp' && campLocation === 'camp') {
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
  if (
    (mode === 'raid' || (inGladeCamp && campLocation === 'camp')) &&
    raid !== null && raid.path.length === 0
  ) {
    if (chop !== null) items.push({ x: chop.cell.x, y: 1.9, z: chop.cell.z, share: chopProgress(chop) });
    if (mine !== null) items.push({ x: mine.cell.x, y: 1.1, z: mine.cell.z, share: mineProgress(mine) });
  }
  if (
    mode === 'camp' && campLocation === 'camp' && !inGladeCamp &&
    campMine !== null && campHero.path.length === 0
  ) {
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

/* ---------- резонанс жилы (§13.11) ---------- */

/**
 * Клетка работы, по которой стучат прямо сейчас, — мировыми координатами
 * кадра. Условия те же, что у полос работ: пока герой в дороге, работы нет,
 * и кольцо над клеткой обещало бы игру, в которую ещё не сыграть.
 */
function tempoWorkCell(): { x: number; z: number } | null {
  if (
    (mode === 'raid' || (inGladeCamp && campLocation === 'camp')) &&
    raid !== null && raid.path.length === 0
  ) {
    return chop?.cell ?? mine?.cell ?? worldPick?.work.cell ?? null;
  }
  if (
    mode === 'camp' && campLocation === 'camp' && !inGladeCamp &&
    campHero.path.length === 0
  ) {
    const work = campMine?.work ?? campPick?.work ?? null;
    if (work === null) return null;
    const o = campOrigin(camp);
    return { x: o.x + work.cell.x, z: o.z + work.cell.z };
  }
  return null;
}

/**
 * Клик резонанса. Вердикт места уже вынесен — зоной кольца или обработчиком
 * тапа, — здесь к нему добавляется вердикт времени (`sim/tempo.ts`), звук
 * и вспышка подписи. `muted` — у тапов с канвы щелчок уже сыгран общим
 * обработчиком, и второй нарушил бы §18.1.
 */
function beatTempo(aim: TempoAim, muted = false): void {
  const beat = tempoBeat(tempo, clock.now(), tempoRng, aim);
  tempoRing.beat(beat);
  if (beat === 'perfect') play('levelup');
  else if (beat === 'good') play('pick');
  else if (beat === 'miss') play('deny');
  else if (beat === 'ring') play('tick');
  else if (!muted) play('tap');
}

/**
 * Кадр резонанса. Точка живёт своим таймером (`stepTempo` перебрасывает
 * просроченную), а кольцо пересобирается каждый рендер из того же состояния,
 * которым считается работа, — своего состояния у кадра нет, и врать ему
 * не из чего: кончилась работа — кончилось и кольцо, тем же кадром.
 */
function syncTempoRing(): void {
  const now = clock.now();
  stepTempo(tempo, now, tempoRng);
  const cell = tempoWorkCell();
  tempoRing.sync(cell === null ? null : {
    x: cell.x,
    y: 0.6,
    z: cell.z,
    spot: tempoSpotNow(tempo, now),
    boost: tempoBoost(tempo, now),
  });
}

/* ---------- ввод вылазки ---------- */

const canvas = rig.renderer.domElement;

type GameCursor =
  | 'pointer'
  | 'move'
  | 'attack'
  | 'chop'
  | 'mine'
  | 'harvest'
  | 'build'
  | 'interact'
  | 'pickup'
  | 'blocked';

/** Pickup is a walk target, but its cursor promises what happens on arrival. */
function pickupCursorAt(state: RaidState, cell: { x: number; z: number }): GameCursor | null {
  const container = state.loc.containers.find(
    (candidate) => !candidate.opened && candidate.x === cell.x && candidate.z === cell.z,
  );
  if (container === undefined) return null;
  const locks = container.lockedBy === undefined
    ? []
    : Array.isArray(container.lockedBy) ? container.lockedBy : [container.lockedBy];
  const locked = locks.length > 0 && state.loc.enemies.some(
    (enemy) => locks.includes(enemy.kind) && enemy.hp > 0,
  );
  const full = container.supply !== true && state.bagTotal >= state.capacity;
  return locked || full ? 'blocked' : 'pickup';
}

/**
 * Курсор меняется только при смене смысла. Pointermove приходит чаще кадра,
 * и повторная запись в dataset на каждом событии заставляла бы браузер снова
 * сопоставлять CSS, хотя картинка осталась той же.
 */
function setGameCursor(next: GameCursor): void {
  if (canvas.dataset.cursor !== next) canvas.dataset.cursor = next;
}

setGameCursor('pointer');

/** Какое действие совершит следующий щелчок в этой точке сцены. */
function gameCursorAt(hit: { x: number; z: number }): GameCursor {
  if (mode === 'title') return 'pointer';

  if (mode === 'visit') return 'move';

  if (mode === 'camp' && campLocation === 'farm') {
    const plot = farmView.plotAt(hit);
    if (plot === null) return 'move';
    const phase = farmPlotPhase(camp, plot, clock.now());
    return phase === 'empty' || phase === 'ready' ? 'harvest' : 'blocked';
  }

  if (mode === 'camp' && campLocation === 'clan' && inClanCamp) {
    if (clanPlacing === null || raid === null) return 'move';
    const cell = { x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) };
    return clanBuildBlock(camp, clanPlacing, cell, raid.hero) === 'ok' ? 'build' : 'blocked';
  }

  if (mode === 'camp' && buildTool !== null) return 'build';
  if (mode === 'camp' && placingSign !== null) return 'build';

  if (inGladeCamp && raid !== null) {
    const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
    const origin = campOrigin(camp);
    if (placingTent || placingChest) {
      const x = Math.round(hit.x) - origin.x;
      const z = Math.round(hit.z) - origin.z;
      const ok = placingTent ? tentFits(camp, x, z) : chestFits(camp, x, z);
      return ok ? 'build' : 'blocked';
    }
    const pickup = pickupCursorAt(raid, cell);
    if (pickup !== null) return pickup;
    const resident = raidView === null ? null : raidView.residentNear(hit.x, hit.z);
    if (resident !== null) return 'interact';
    if (camp.chests.some((c) => origin.x + c.x === cell.x && origin.z + c.z === cell.z)) {
      return 'interact';
    }
    for (const id of PITCH_ORDER) {
      const p = camp.layout[id];
      if (Math.hypot(cell.x - (origin.x + p.x + 0.5), cell.z - (origin.z + p.z + 0.5)) <= 1.9) {
        return 'interact';
      }
    }
    if (raid.logging && treeAt(raid.loc, cell)) {
      return raid.bagTotal < raid.capacity ? 'chop' : 'blocked';
    }
    return 'move';
  }

  if (mode === 'camp') {
    const local = campLocal(hit);
    const cell = { x: Math.round(local.x), z: Math.round(local.z) };
    if (placingTent || placingChest) {
      const ok = placingTent
        ? tentFits(camp, cell.x, cell.z)
        : chestFits(camp, cell.x, cell.z);
      return ok ? 'build' : 'blocked';
    }
    if (selected !== null) {
      const x = Math.round(local.x - 0.5);
      const z = Math.round(local.z - 0.5);
      return buildingFits(camp, selected, x, z) ? 'build' : 'blocked';
    }
    const bush = bushAt(camp.bushes ?? [], cell);
    const stone = stoneAt(camp.stones, cell);
    if (bush !== null || stone !== null) {
      const nav = campNav(camp);
      const free = cell.x >= 0 && cell.z >= 0 && cell.x < nav.area && cell.z < nav.area
        && nav.ground[idx(nav.area, cell.x, cell.z)] === 0 && campHero.level === 'земля';
      if (bush !== null) return free && ripe(bush, clock.now()) ? 'harvest' : 'blocked';
      if (stone !== null) return free ? 'mine' : 'blocked';
    }
    if (campView.residentAt(local.x, local.z) !== null) return 'interact';
    if (camp.chests.some((c) => c.x === cell.x && c.z === cell.z)) return 'interact';
    if (campView.buildingAt(local.x, local.z) !== null) return 'interact';
    return 'move';
  }

  if (mode !== 'raid' || raid === null || raid.status !== 'running') return 'pointer';

  const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
  if (placing !== null) {
    const site = { x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) };
    return pitchOk(site) ? 'build' : 'blocked';
  }
  if (tentUnderConstruction !== null) {
    const center = { x: tentUnderConstruction.x + 0.5, z: tentUnderConstruction.z + 0.5 };
    if (Math.hypot(hit.x - center.x, hit.z - center.z) <= 1.9) return 'build';
  }

  if (inBattle(raid)) {
    if (raidView?.battleBusy() === true) return 'blocked';
    const battle = raid.battle!;
    const unit = current(battle);
    if (unit === undefined || unit.side !== 'hero') return 'blocked';
    const want = worldToHex(hit.x, hit.z);
    const there = unitAt(battle, want);
    if (there !== undefined && there.side !== 'hero') {
      return targets(battle, raid.loc.size, raid.loc.blocked, unit).includes(there)
        ? 'attack'
        : 'blocked';
    }
    return moves(battle, raid.loc.size, raid.loc.blocked, unit).has(hexKey(want))
      ? 'move'
      : 'blocked';
  }

  const pickup = pickupCursorAt(raid, cell);
  if (pickup !== null) return pickup;

  if (raid.logging && treeAt(raid.loc, cell)) {
    return raid.bagTotal < raid.capacity ? 'chop' : 'blocked';
  }
  const site = walkSite();
  if (site !== null) {
    const bush = bushAt(site.bushes, cell);
    if (bush !== null) {
      return worldBlock(site.seed, site.place, bush, site.locals, camp.picks ?? {}, clock.now()) === 'ok'
        ? 'harvest'
        : 'blocked';
    }
  }
  if (stoneAt(raid.loc.stones, cell) !== null) {
    return raid.bagTotal < raid.capacity ? 'mine' : 'blocked';
  }
  return 'move';
}

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
  if (mode === 'camp' && placingSign !== null) {
    const hit = rig.screenToGround(e.clientX, e.clientY);
    if (hit !== null) placeSignpostAt(hit);
    return;
  }
  // Огород принимает один прямой жест: пустую грядку засевает, готовую
  // собирает, растущая называет остаток. Жесты скрытого лагеря сюда не идут.
  if (mode === 'camp' && campLocation === 'farm') {
    const hit = rig.screenToGround(e.clientX, e.clientY);
    const plot = hit === null ? null : farmView.plotAt(hit);
    if (plot === null) {
      campHud.notify(gameText(gameMessage('Коснитесь грядки у дорожки', 'Touch a garden bed by the path')));
      return;
    }
    const now = clock.now();
    const phase = farmPlotPhase(camp, plot, now);
    if (phase === 'locked') {
      play('deny');
      campHud.notify(gameText(gameMessage('Эта грядка откроется с развитием фермы', 'This garden bed will unlock as the farm grows')));
      return;
    }
    if (phase === 'empty') {
      const crop = camp.farm?.selectedCrop ?? FARM_DEFAULT_CROP;
      const balance = FARM_CROPS[crop];
      const block = farmPlantBlock(camp, plot, crop);
      if (block === 'food') {
        play('deny');
        campHud.notify(gameText(gameMessage('Для посева нужно {food} ед. пищи', 'Planting requires {food} food'), {
          food: balance.seedFood,
        }));
        return;
      }
      if (!plantFarmPlot(camp, plot, crop, now)) {
        play('deny');
        return;
      }
      play('pick');
      campHud.notify(gameText(gameMessage('{crop} посеян · урожай через {time}', '{crop} planted · harvest in {time}'), {
        crop: gameText(FARM_CROP_TEXT[crop].name),
        time: gameDuration(Math.max(60, farmPlotReadyAt(camp.farm!.plots[plot]!) - now)),
      }));
      farmView.sync(camp.farm, now);
      syncFarmUi();
      persist();
      return;
    }
    if (phase === 'growing') {
      const planted = camp.farm?.plots[plot];
      if (planted !== null && planted !== undefined) {
        campHud.notify(gameText(gameMessage('Урожай через {time}', 'Harvest in {time}'), {
          time: gameDuration(Math.max(60, farmPlotReadyAt(planted) - now)),
        }));
      }
      return;
    }
    const gathered = harvestFarmPlot(camp, plot, now);
    if (gathered > 0) {
      play('pick');
      const at = farmView.plotCenter(plot);
      if (at !== null) showReward('food', at.x, at.z, gathered, at.y);
      campHud.notify(`+${gathered} · ${RESOURCE_NAME.food}`);
      farmView.sync(camp.farm, now);
      syncFarmUi();
      persist();
    }
    return;
  }
  // Клановая опушка — самостоятельное место: здесь пока есть только ходьба,
  // а жесты и панели личного лагеря не должны менять его из-за общего вида.
  if (mode === 'camp' && campLocation === 'clan' && inClanCamp) {
    if (raid === null) return;
    const hit = rig.screenToGround(e.clientX, e.clientY);
    if (hit === null) return;
    if (clanPlacing !== null) {
      tryPlaceClanBuilding({ x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) });
      return;
    }
    const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
    if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
    return;
  }
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
    // §13.11 — тап по клетке идущей рубки подбадривает её, а не перезапускает.
    const beatAt = raid.path.length === 0 ? chop?.cell ?? mine?.cell ?? null : null;
    if (beatAt !== null && beatAt.x === cell.x && beatAt.z === cell.z) {
      beatTempo(null, true);
      return;
    }
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
  // После выбора места следующий осмысленный тап — по строительной версии
  // палатки. Запас вокруг следа такой же, как у готовых зданий на поляне:
  // на телефоне не требуется попадать в тонкую стойку каркаса.
  if (tentUnderConstruction !== null) {
    const center = { x: tentUnderConstruction.x + 0.5, z: tentUnderConstruction.z + 0.5 };
    if (Math.hypot(hit.x - center.x, hit.z - center.z) <= 1.9) {
      finishTent();
      return;
    }
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
  // §13.11 — тап по клетке идущей работы подбадривает её, а не перезапускает:
  // без этой ветки второй клик начинал бы те же тридцать замахов заново.
  const beatAt = raid.path.length === 0
    ? chop?.cell ?? mine?.cell ?? worldPick?.work.cell ?? null
    : null;
  if (beatAt !== null && beatAt.x === cell.x && beatAt.z === cell.z) {
    beatTempo(null, true);
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
  /**
   * §13.8 — тап по кусту места. Спрашивается раньше валуна по тому же
   * правилу, что в лагере: куст ловится ровно своей клеткой.
   */
  const site = walkSite();
  if (site !== null) {
    const bush = bushAt(site.bushes, cell);
    if (bush !== null) {
      startWorldPicking(site.place, bush, site.locals, site.seed);
      return;
    }
  }
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
  if (hit === null) {
    setGameCursor('pointer');
    return;
  }
  setGameCursor(gameCursorAt(hit));
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
  if (mode === 'camp' && selected !== null) {
    const at = campLocal(hit);
    const x = Math.round(at.x - 0.5);
    const z = Math.round(at.z - 0.5);
    campView.showBuildingSpot(x, z, buildingFits(camp, selected, x, z));
  }
  if (inClanCamp && clanPlacing !== null && raid !== null) {
    const cell = { x: Math.round(hit.x - 0.5), z: Math.round(hit.z - 0.5) };
    const ok = clanBuildBlock(camp, clanPlacing, cell, raid.hero) === 'ok';
    raidView?.showSite(CLAN_BUILDINGS[clanPlacing].model, cell.x, cell.z, ok);
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

canvas.addEventListener('pointerleave', () => {
  wind.away();
  setGameCursor('pointer');
});
canvas.addEventListener('pointercancel', () => {
  wind.away();
  setGameCursor('pointer');
});

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
  const leftAt = clock.now();
  track({
    t: 'exit',
    at: leftAt,
    where: returnScreen.visible ? 'return' : mode === 'raid' ? 'raid' : 'camp',
    sec: Math.max(0, leftAt - startedAt),
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
// `?shield` даёт отладочному бою щит максимального уровня: телеграфы
// Заслона должны быть проверяемы из одной и той же точки баланса.
if (debugParams.has('shield')) {
  camp.offhand = 'shield';
  camp.gear.torch = Math.max(camp.gear.torch, 3);
}
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
 * Отладочный кадр `?battle` (§6: воспроизводимость): пошаговый бой сразу,
 * не проходя вылазку до драки. Открывает вылазку — ярус можно задать
 * через `?tier=N`, иначе берётся первый боевой узел, — и ставит героя
 * вплотную к противнику: контакт завязывается первым же тиком.
 * Значение выбирает вид: `?battle=mage`, `?battle=warrior`,
 * `?battle=minotaur`, `?battle=golem`, `?battle=skeleton`.
 */
const debugBattleKind = debugGet(debugParams, 'battle');
if (debugBattleKind !== null) {
  if (raid === null) {
    const place = today.find((n) => n.kind === 'вылазка' && n.tier >= 1) ?? today.find((n) => n.kind === 'вылазка');
    if (place !== undefined) toRaid(place.id);
  }
  // `toRaid` пишет модульную переменную; поток типов через вызов этого
  // не видит, поэтому ссылка перечитывается явно.
  const fightRaid = raid as RaidState | null;
  if (fightRaid !== null) {
    const KIND_BY_NAME: Record<string, EnemyKind> = {
      skeleton: 'minion',
      warrior: 'warrior',
      mage: 'mage',
      minotaur: 'minotaur',
      golem: 'stone-golem',
    };
    const want = KIND_BY_NAME[debugBattleKind];
    const foes = fightRaid.loc.enemies.filter((e) => e.hp > 0);
    const target = foes.find((e) => want !== undefined && e.kind === want) ?? foes[0];
    if (target !== undefined) {
      // Отладочное имя — гарантия кадра, а не пожелание генератору:
      // если в этой локации нужного вида нет, первый враг играет его роль.
      if (want !== undefined) Object.assign(target, { kind: want });
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
    // Ручка к состоянию — тем же приёмом, что `?tier` (`debug`).
    (window as unknown as { battle: unknown }).battle = {
      raid: () => raid,
      field: () => raid?.battle ?? null,
      busy: () => raidView?.battleBusy() ?? false,
      // Внутренности показа — поля приватные для кода, но не для отладки.
      play: () => (raidView as unknown as { playNow: unknown } | null)?.playNow ?? null,
      queue: () => (raidView as unknown as { battlePlays: unknown[] } | null)?.battlePlays.length ?? 0,
    };
  }
}

/**
 * Ручка к состоянию вылазки для сцен `?tier=N` и `?node=N`. Без неё сцена
 * показывает кадр, но ответить «взялся ли герой за валун и сколько осталось»
 * может только глаз, а восемь секунд у камня незачем высиживать: работа
 * отдаётся живой, и `debug.work().left` двигается руками.
 */
if (debugTier !== null || debugNode !== null) {
  (window as unknown as { debug: unknown }).debug = {
    rig,
    raid: () => raid,
    stones: () => raid?.loc.stones ?? null,
    work: () => mine,
    chop: () => chop,
    // §13.11 — резонанс: состояние живьём и клик без пикселей. Три быстрых
    // `beat(null)` из консоли открывают точку, `beat('spot')` берёт ступень —
    // окно «3 за 0,9 с» иначе проверяется только пальцем.
    tempo: () => tempo,
    beat: (aim: TempoAim = null) => beatTempo(aim),
  };
}

/**
 * Отладочные сцены (§6: воспроизводимость). Кадр, который нужно посмотреть,
 * открывается сразу, а не проходом игры до него: чтобы проверить стену
 * в лагере, незачем играть пролог.
 *
 * `?test` — лагерь как он есть. Имя нарочно не «camp»: лагерь — то, что
 *   игрок разбивает в прологе, а это чисто тестовый кадр.
 * `?test=walls` — лагерь с готовым кольцом стен: ворота, башня, лестница.
 *   Ровно та планировка, на которой видно все четыре ответа сразу — ход
 *   поверху, разрыв на башне, проезд под воротами и подъём.
 * `?test=farm-intro|farm-goal|farm-reward|farm-return` — состояния огорода.
 *   Текст и адаптивную раскладку можно проверять без прохождения пролога.
 *   Последнее открывает финальную стадию: шесть полос, все постройки и праздник.
 * `?test=character` — экран героя с опытом и свободным очком умения.
 * `?test=return` — насыщенный итог боя с опытом и новым уровнем.
 * `?test=research` — личное дерево зрелого лагеря с запасом Записей.
 * `?test=cosmetics` — личный и клановый знаки на настоящей глобальной карте.
 * `?test=road-trader|road-trail|road-minotaur` — три карточки первой главы.
 *
 * Сцены отладочные и живут только в `npm run dev`: в сборку они попадают,
 * но открыть их можно лишь адресом, которого в игре нет.
 */
const debugCamp = debugGet(debugParams, 'test');
let debugAchievementToast: AchievementDef | null = null;
if (debugCamp !== null) {
  if (debugCamp === 'cosmetics') {
    if (camp.clan == null) foundClan(camp, 'Артель Знака', clock.now());
    campHud.setCosmetics('watchfire', 'banner_tower');
    billingAppearance = { fire: 'ghostfire', decor: 'wayfarer', heraldry: 'sun' };
    applyBillingAppearance();
    const collection = debugGet(debugParams, 'collection');
    if (collection === 'player' || collection === 'clan') storePanel?.open(collection);
  } else if (debugCamp === 'walls') {
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
  if (debugCamp === 'achievements') {
    const now = clock.now();
    earnAchievement(camp, 'first-camp', now - DAY_SEC);
    debugAchievementToast = earnAchievement(camp, 'first-return', now);
    if (camp.achievements !== undefined) camp.achievements.seen = ['first-camp'];
  }
  if (
    debugCamp === 'farm-intro' || debugCamp === 'farm-goal' ||
    debugCamp === 'farm-reward' || debugCamp === 'farm-return'
  ) {
    const reward = debugCamp === 'farm-reward' || debugCamp === 'farm-return';
    const returnAction = debugCamp === 'farm-return';
    camp.farm = {
      foodAtStart: 18,
      gatheredFood: reward ? FARM_FOOD_GOAL : debugCamp === 'farm-goal' ? 14 : 0,
      step: reward ? 'reward' : debugCamp === 'farm-goal' ? 'goal' : 'intro',
      unlocked: reward,
      activePlots: returnAction ? 6 : FARM_STARTING_PLOT_COUNT,
      selectedCrop: FARM_DEFAULT_CROP,
      plots: emptyFarmPlots(),
      story: emptyFarmStory(),
    };
    if (returnAction) {
      const now = clock.now();
      const farm = camp.farm;
      farm.story.day = 15;
      farm.story.startedDay = dayAt(now);
      farm.story.harvestedFood = 70;
      for (const id of ['fence', 'well', 'barn', 'plots', 'farmhouse'] as const) {
        farm.story.structures[id] = true;
      }
      farm.plots[0] = { plantedAt: now - FARM_CROPS.turnip.growSeconds, crop: 'turnip' };
      farm.plots[3] = { plantedAt: now - FARM_CROPS.barley.growSeconds, crop: 'barley' };
      farm.plots[1] = { plantedAt: now - FARM_CROPS.turnip.growSeconds / 2, crop: 'turnip' };
    }
    // Готовая ферма показывает не только культуры, но и связь с поручением:
    // один настоящий помощник делает строку карточки проверяемой глазом.
    if (reward && camp.residents.length === 0) {
      admit(camp, {
        name: 'Тихон',
        look: 'поселенец',
        seed: 33,
        answer: 'кормим',
        rest: false,
      });
      buildTent(camp);
    }
    if (returnAction) {
      const helper = camp.residents.find((resident) => resident.answer === 'кормим');
      camp.roadStory = {
        step: 'done',
        route: 'trade',
        ...(helper === undefined
          ? { caravanerName: 'Тихон' }
          : { caravanerId: residentUuid(helper), caravanerName: helper.name }),
      };
    }
  }
  if (
    debugCamp === 'road-trader' ||
    debugCamp === 'road-trail' ||
    debugCamp === 'road-minotaur'
  ) {
    camp.roadStory = {
      step: debugCamp === 'road-trader'
        ? 'return-to-trader'
        : debugCamp === 'road-trail'
          ? 'find-caravan'
          : 'settle-supply',
    };
  }
  if (debugCamp === 'staff') {
    camp.foxesCaught = 10;
    const staff = [
      { name: 'Гита', look: 'поселенец' as const, seed: 11, answer: 'строим' as const },
      { name: 'Руна', look: 'поселенец' as const, seed: 22, answer: 'ходим' as const },
      { name: 'Тихон', look: 'поселенец' as const, seed: 33, answer: 'кормим' as const },
    ];
    for (const resident of staff) {
      admit(camp, { ...resident, rest: false });
      buildTent(camp);
    }
  }
  if (debugCamp === 'research') {
    camp.levels.hq = 5;
    camp.levels.archive = 2;
    camp.research.notes = 24;
    camp.research.levels['crop-rotation'] = 2;
    camp.research.levels['road-provisions'] = 1;
    camp.research.levels.cartography = 1;
  }
  // Площадка напрямую, мимо маршрутизатора: второй лагерь существует
  // чисто для тестов, и сейв с поляной не должен уводить кадр отладки.
  toPadCamp();
  if (debugCamp === 'achievements') {
    campHud.openAchievements();
    if (debugAchievementToast !== null) achievementToast.show(debugAchievementToast, 2);
  }
  if (
    debugCamp === 'road-trader' ||
    debugCamp === 'road-trail' ||
    debugCamp === 'road-minotaur'
  ) syncRoadStoryTask();
  if (debugCamp === 'character') {
    const hero = roster.heroes[0]!;
    hero.level = 2;
    hero.xp = 90;
    hero.statPoints = 2;
    hero.skillPoints = 1;
    openCharacter({ kind: 'герой', index: 0 });
  }
  if (debugCamp === 'return') {
    const sample = createRaid({ seed: 73, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    sample.status = 'evacuated';
    sample.bag.stone = 12;
    sample.bag.iron = 5;
    sample.bag.crystal = 2;
    sample.bagTotal = 19;
    sample.maxBack = 18;
    sample.elapsed = 154;
    sample.fights = 3;
    sample.kills = 4;
    sample.damageTaken = 7;
    sample.combatXp = 118;
    returnScreen.show(
      raidResult(sample),
      camp,
      () => {},
      false,
      0,
      clock.now(),
      { xp: 166, levels: 1, level: 3 },
    );
  }
  if (debugCamp === 'research') researchPanel.show(camp, clock.now());
  // Ручка к состоянию сцены. Без неё отладочная сцена показывает кадр,
  // но ответить на вопрос «а герой-то поднялся?» может только глаз.
  // Живёт только вместе с отладочным адресом.
  const DEBUG_CAMP_LEVEL = { ground: 'земля', top: 'верх' } as const;
  const DEBUG_RESIDENT_ORDER = {
    build: 'строим',
    walk: 'ходим',
    feed: 'кормим',
    rest: 'отдых',
  } as const;
  const DEBUG_GUEST_ANSWER = {
    build: 'строим',
    walk: 'ходим',
  } as const;
  type DebugCampLevel = keyof typeof DEBUG_CAMP_LEVEL;
  type DebugResidentOrder = keyof typeof DEBUG_RESIDENT_ORDER;
  type DebugGuestAnswer = keyof typeof DEBUG_GUEST_ANSWER;
  (window as unknown as { debug: unknown }).debug = {
    camp,
    hero: campHero,
    rig,
    nav: () => campNav(camp),
    tap: (x: number, z: number, level: DebugCampLevel = 'ground') =>
      commandCampMove(camp, campHero, { x, z }, DEBUG_CAMP_LEVEL[level] ?? 'земля'),
    // §14 и §6.1.8: уровень оружия меняет клинок в руке. Ковать ради проверки
    // незачем — ручка ставит уровень и пересобирает вид тем же путём,
    // которым он пересобирается после настоящей ковки.
    weapon: (level: number) => {
      camp.gear.weapon = Math.max(0, Math.min(MAX_ITEM_LEVEL, level | 0));
      campView.setCamp(camp);
      return camp.gear.weapon;
    },
    // Начатая добыча (§13.5). Отдаётся сама работа, а не снимок: отладочной
    // сцене положено не только показывать состояние, но и двигать его —
    // высиживать восемь секунд у камня незачем.
    work: () => campMine,
    // Жильцы и палатки (`residents.ts`) числами: строка задания говорит,
    // чего не хватает, но не говорит, кто в лагере и кто что ответил.
    residents: () => ({
      people: camp.residents.map((r) => `${r.name} (${r.look}, ${residentState(r)})`),
      roofs: roofs(camp),
      homeless: homeless(camp),
      tents: camp.tents.length,
      tent: tentReason(camp),
    }),
    // Приказ из консоли: смотреть, как топор сменяется киркой или ложится
    // на отдых, можно без карточки — тем же `assignWork`, что и кнопка.
    order: (index: number, order: DebugResidentOrder) => {
      const local = DEBUG_RESIDENT_ORDER[order];
      if (local === undefined || !assignWork(camp, index, local)) return 'not an order';
      persist();
      const r = camp.residents[index]!;
      return `${r.name}: ${residentState(r)}`;
    },
    // Поставить палатку: цена списывается, место выбирается тем же правилом,
    // что и в игре.
    tent: () => {
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
    frame: () => campHud.sync(camp, clock.now(), 0),
    /**
     * Часы §6: по серверному времени они идут или по здешнему. Вопрос
     * невидимый — таймеры выглядят одинаково в обоих случаях, — а ответ
     * на него нужен: без сервера лагерь верит системным часам.
     * `расхождение` — насколько врут часы машины, в секундах.
     */
    clock: () => ({
      server: clock.synced,
      now: clock.now(),
      drift: clock.now() - Date.now() / 1000,
    }),
    // Отлучка руками: ждать полчаса, чтобы посмотреть на прибавку, —
    // не проверка. Кладёт ровно то же, что положила бы загрузка.
    away: (seconds: number) => {
      const done = collectWork(camp, seconds, undefined, undefined, clanBuilderIds(camp));
      campHud.sync(camp, clock.now(), 0);
      syncFarmUi();
      persist();
      return done.map((w) => `${RESOURCE_NAME[w.kind]} ${w.n}`);
    },
    /**
     * Чужие лагеря из ниоткуда (§30.7). Завести шесть аккаунтов, чтобы
     * посмотреть, как кромка выглядит с соседями, — не проверка. Ручка
     * кладёт ровно то, что положил бы ответ сервера.
     */
    neighbours: (count = 3) => {
      liveCamps = Array.from({ length: count }, (_, i) => ({
        id: `гость-${i}`,
        clan: i % 2 === 0 ? `Артель ${i + 1}` : null,
        power: 30 + i * 45,
        level: 2 + (i % 4),
        folk: 1 + (i % 5),
        likes: Math.max(0, count - i - 1),
        liked: false,
      }));
      campHud.setCamps(liveCamps);
      statsPanel.setCamps(liveCamps);
      return liveCamps.length;
    },
    /**
     * Чужие метки из ниоткуда (§30.6). Заводить второй аккаунт, чтобы
     * посмотреть, как выработанная соседями точка выглядит на карте, —
     * не проверка, а лотерея: сосед должен ещё и сходить в ту же точку
     * в то же окно. Ручка кладёт ровно то, что положил бы ответ сервера.
     *
     * Без номера точки — самая щадящая из сегодняшних (`safestNode`): та же,
     * куда игру пускает первая вылазка, и она есть в любой день.
     */
    visit: (node?: number, visits = 1) => {
      const at = shiftAt(clock.now());
      const spot = node ?? safestNode(clock.now());
      for (let i = 0; i < visits; i++) neighbours.push({ node: spot, shift: at - i });
      campHud.setNeighbours(neighbours);
      returnScreen.setNeighbours(neighbours);
      return worldAt(clock.now(), camp.visits, neighbours)[spot];
    },
    // Гость из ниоткуда: проверять палатки, каждый раз проходя знакомство,
    // — не проверка. Имя раздаётся по счёту, потому что повтор не принимается.
    guest: (answer: DebugGuestAnswer = 'build') => {
      const local = DEBUG_GUEST_ANSWER[answer];
      if (local === undefined) return 'not an answer';
      admit(camp, {
        name: `Guest ${camp.residents.length + 1}`,
        look: 'поселенец',
        seed: camp.residents.length + 1,
        answer: local,
        rest: false,
      });
      syncFarmUi();
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
 * Ручка `debug` даёт то, чего не видно глазом: где отряд будет через
 * минуту и когда стрелок выйдет на стену. `debug.watch(t)` переводит часы
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
  (window as unknown as { debug: unknown }).debug = {
    site: () => castleNow,
    // Начатая добыча (§13.5) и тот, кто её ведёт. Работы не видно глазом,
    // пока пятно не выросло, а вопрос «взялся ли герой за камень» задаётся
    // первым. Отдаётся сама работа, а не её снимок: отладочной сцене положено
    // не только показывать состояние, но и двигать его.
    work: () => mine,
    hero: () => raid?.hero ?? null,
    // §13.11 — резонанс над той же добычей: состояние живьём и клик без
    // пикселей, ровно как в сценах `?tier=N`.
    tempo: () => tempo,
    beat: (aim: TempoAim = null) => beatTempo(aim),
    garrison: () => (castleNow === null ? null : garrisonOf(castleNow)),
    patrol: (t = 0) => (castleNow === null ? null : patrolAt(garrisonOf(castleNow), t)),
    archer: (t = 0) => (castleNow === null ? null : archerAt(garrisonOf(castleNow), t)),
    // Жильцы двора (§6.1.6.1). Печатается то, чего не видно глазом: кто где
    // сейчас, идёт ли и какой длины у него круг — обход в клетках читать
    // по одной клетке бессмысленно.
    dwellers: (t = 0) => {
      if (castleNow === null) return null;
      const g = garrisonOf(castleNow);
      return dwellersAt(g, t).map((d, i) => ({
        who: d.look,
        at: [+d.x.toFixed(2), +d.z.toFixed(2)],
        walking: d.walking,
        cycle: +(g.yard[i]?.cycle ?? 0).toFixed(1),
      }));
    },
    watch: (t: number) => raidView?.setWatch(t),
    /**
     * Пост лесника (§6.1.6.3): где он встал и во что обойдётся следующий.
     * Наём отдаётся ручкой вместе с монетами: копить сотню входами, чтобы
     * посмотреть кадр лагеря, — не проверка, а ожидание (§6.2.5 — отладка
     * живёт в отладочной сцене и только в ней).
     */
    woodsman: () => (woodsmanPost === null ? null : {
      tent: [woodsmanPost.tent.x, woodsmanPost.tent.z],
      target: [woodsmanPost.target.x, woodsmanPost.target.z],
      stand: [woodsmanPost.stand.x, woodsmanPost.stand.z],
      who: woodsmanPost.who.name,
      price: nextWoodsmanPrice(camp),
      coins: coinsOf(camp),
      hired: woodsmenOf(camp),
    }),
    /** Монеты в кошелёк: цена лесника — десять дней входов (§20.5),
     *  и копить их ради проверки кадра значило бы не проверять его вовсе. */
    coins: (n = 500) => {
      earnCoins(camp, n);
      return coinsOf(camp);
    },
    hire: () => {
      if (woodsmanPost === null) return null;
      earnCoins(camp, nextWoodsmanPrice(camp));
      const who = hireWoodsman(camp, woodsmanPost);
      if (who !== null) {
        raidView?.clearWoodsman();
        if (woodsmanTalk !== null) woodsmanTalk.hired = true;
      }
      return who;
    },
    /**
     * §13.8 — местные у кустов: кто вышел, к какому узлу и где он сейчас.
     * Печатается вместе с ответом формулы про тот же узел — вопрос
     * «разошлись ли кадр и число» задаётся ровно об этом, и отвечать
     * на него глазом по кадру нечестно.
     */
    gatherers: (t = clock.now()) =>
      gatherers.map((g) => {
        const at = choreAt(g.chore, t);
        return {
          bush: [g.bush.id, g.bush.x, g.bush.z],
          at: [+at.x.toFixed(2), +at.z.toFixed(2)],
          walking: at.walking,
          working: at.working,
          carrying: at.carrying,
          cycle: +g.chore.circuit.toFixed(1),
          // Формула про тот же узел: полон ли он для игрока.
          ripe: castleNow === null
            ? null
            : worldRipe(castleNow.loc.seed, 'замок', g.bush, localsOf(castleNow.gate, castleNow.bushes), camp.picks ?? {}, t),
        };
      }),
    /**
     * Прилавок торговца (§13.5). Глазом его видно только у самого прилавка,
     * а вопрос «сколько сегодня принесли местные» задаётся раньше, чем герой
     * дойдёт. Ручка отвечает на него сразу — и принимает время, потому что
     * запас суточный: `counter(86400)` показывает завтрашний.
     */
    counter: (shift = 0) => {
      if (castleNow === null) return null;
      const at = clock.now() + shift;
      const supply = localsTook(castleNow.loc.seed, castleNow.bushes, localsOf(castleNow.gate, castleNow.bushes), at);
      return {
        brought: supply,
        bought: (camp.bought ?? {})[marketKey(castleNow.loc.seed, at)] ?? 0,
        left: stockOf(supply, camp.bought ?? {}, castleNow.loc.seed, at),
        bushes: castleNow.bushes.length,
      };
    },
    // Гость у стен (`castleGuest.ts`): кто, откуда, что ищет и где сидит.
    // Ждать замка с гостем — лотерея, а тут видно и «гостя сегодня нет».
    guest: () =>
      castleGuest === null
        ? null
        : {
            who: castleGuest.who,
            origin: castleGuest.origin,
            seek: castleGuest.seek,
            term: castleGuest.term,
            block: guestBlock(camp, castleGuest),
            tent: castleGuest.tent,
            fire: castleGuest.fire,
            sit: castleGuest.sit,
            step: guestMeet?.step ?? null,
          },
    // Герой и тап по клетке: прозрачность стен (§6.1.6.1) включается тем,
    // что он вошёл во двор, и без ручки к нему сцена этого не показывает —
    // до ворот пришлось бы идти пешком.
    raid: () => raid,
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
    rig,
  };
}

/** `?minotaur=СИД` — прямая сцена особого замка для проверки разговора и боя. */
const debugMinotaur = debugParams.get('minotaur');
if (debugMinotaur !== null) {
  const place = today.find((n) => n.kind === 'замок минотавра');
  const seed = debugMinotaur === '' ? null : Number(debugMinotaur);
  leaveTitle();
  toMinotaurCastle(
    place?.id ?? 0,
    seed !== null && Number.isFinite(seed) ? seed : nodeSeed(dayAt(clock.now()), place?.id ?? 0),
  );
  // Разговор проверяется сразу: пеший путь через ворота уже стережёт замок.
  const localRaid = raid as RaidState | null;
  const localSite = minotaurNow as MinotaurCastleSite | null;
  if (localRaid !== null && localSite?.minotaur != null) {
    localRaid.hero.x = localSite.minotaur.x + 1;
    localRaid.hero.z = localSite.minotaur.z;
    localRaid.hero.prevX = localRaid.hero.x;
    localRaid.hero.prevZ = localRaid.hero.z;
    rig.lookAt(localRaid.hero.x, localRaid.hero.z, true);
  }
  (window as unknown as { debug: unknown }).debug = {
    site: () => minotaurNow,
    raid: () => raid,
    hero: () => raid?.hero ?? null,
    talk: () => minotaurNow?.minotaur ?? null,
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
    rig,
  };
}

/**
 * `?meet` — прогалина и сидящий поселенец. Сцена заведена под один
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

if (debugHas(debugParams, 'meet')) {
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
  (window as unknown as { debug: unknown }).debug = {
    rig,
    raid: () => raid,
    settler: () => raidView?.settlerAt() ?? null,
    // Зов: встаёт и идёт к герою. Ходьба ждёт конца клипа — оборванное
    // вставание и есть тот рывок, который сцена проверяет.
    call: () => raidView?.callSettler(raid!.hero.x, raid!.hero.z),
    place: (look: DwellerLook = 'поселенец') =>
      raidView?.putSettler(look, satAt.x, satAt.z, Math.atan2(raid!.hero.x - satAt.x, raid!.hero.z - satAt.z)),
    // Разговор целиком: кто он, на каком кадре стоим, как назвался игрок
    // и что досталось. Глазом из панели видно только текущую строку.
    meet: () => (meet === null ? null : {
      who: meetSettler,
      step: meet.step,
      hero: meet.heroName,
      answer: meet.answer,
      invited: meet.invited,
      gift: giftOf(meet),
      wallet: { ...camp.resources },
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
  (window as unknown as { debug: unknown }).debug = {
    rig,
    site: () => graveSite,
    // Размер участка и население — те два числа, ради которых сцена и заведена.
    plot: () => (graveSite === null ? null : {
      size: graveSite.loc.size,
      ghosts: graveSite.loc.enemies.length,
      graves: graveSite.marks.length,
      material: graveSite.material,
    }),
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
  };
}

/**
 * `?trail` — лесная тропа сегодняшнего региона сразу, `?trail=СИД` — с
 * назначенным сидом (§6.1.17). Длина, виляние спины и грунт выводятся
 * из сида: чтобы посмотреть на длинную тропу, ждать нужной точки
 * на карте — не проверка, а лотерея.
 */
const debugTrail = debugGet(debugParams, 'trail');
if (debugTrail !== null) {
  const place = today.find((n) => n.kind === 'тропа');
  const seed = debugTrail === '' ? nodeSeed(dayAt(clock.now()), place?.id ?? 0) : Number(debugTrail);
  if (debugParams.has('caravan')) camp.roadStory = { step: 'find-caravan' };
  if (debugParams.has('bridge')) {
    camp.roadStory = { step: 'done', route: 'work' };
    camp.bridgeStory = { step: 'find-crew', completed: 2, lastDay: dayAt(clock.now()) - 1 };
    camp.resources.wood = Math.max(camp.resources.wood, 20);
    camp.coins = Math.max(camp.coins ?? 0, 10);
  }
  leaveTitle();
  toTrail(place?.id ?? 0, Number.isFinite(seed) ? seed : 1);
  // `?trail&caravan` прыгает сразу к месту аварии: длинную тропу
  // проверяет отдельная ручка, а здесь важны масштаб и силуэт реквизита.
  if (debugParams.has('caravan') && trailSite !== null) {
    debugCaravanAt = caravanEncounter(trailSite).wagon;
    rig.lookAt(debugCaravanAt.x, debugCaravanAt.z, true);
    rig.setZoom(10, true);
  }
  // `?trail&bridge` открывает сам выбор у артели: отладочная сцена нужна
  // для проверки длинной реплики, трёх кнопок и их цены одним кадром.
  const bridgeDebugRaid = raid as RaidState | null;
  if (debugParams.has('bridge') && trailSite !== null && bridgeDebugRaid !== null) {
    const at = caravanEncounter(trailSite).survivor;
    bridgeDebugRaid.hero.x = at.x;
    bridgeDebugRaid.hero.z = at.z;
    bridgeDebugRaid.path = [];
    rig.lookAt(at.x, at.z, true);
    rig.setZoom(10, true);
  }
  (window as unknown as { debug: unknown }).debug = {
    rig,
    site: () => trailSite,
    // Длина, ветвление и обочина — числа, ради которых сцена и заведена:
    // тропа обещает быть длиннее ширины и вести в тупики, и это видно ручкой.
    trail: () => (trailSite === null ? null : {
      size: trailSite.loc.size,
      length: trailSite.length,
      ground: trailSite.path.length,
      branches: trailSite.branches.length,
      stones: trailSite.loc.stones.length,
      foxes: trailSite.loc.enemies.filter((e) => e.kind === 'fox').length,
    }),
    tap: (x: number, z: number) => (raid === null ? null : commandMove(raid, { x, z })),
  };
}

/**
 * `?wheel` — колесо призов сразу, `?wheel=СИД` — с назначенным сидом.
 * Сид решает сектор: проверять, что колесо довозит до каждого из десяти,
 * перебором дней на карте — не проверка, а лотерея про лотерею.
 * Сейв ручка не пишет: `persist()` глушится любым отладочным кадром.
 */
const debugWheel = debugGet(debugParams, 'wheel');
if (debugWheel !== null) {
  const seed = debugWheel === ''
    ? nodeSeed(dayAt(clock.now()), today.find((n) => n.kind === 'призы')?.id ?? 0)
    : Number(debugWheel);
  leaveTitle();
  toWheel(Number.isFinite(seed) ? seed : 1, 0);
  (window as unknown as { debug: unknown }).debug = {
    // Ответ пересчитан той же формулой: ручка обязана говорить, куда колесо
    // обязано довезти, чтобы расхождение было видно числом, а не на глаз.
    answer: () => 1 + Math.floor(mulberry32((Number.isFinite(seed) ? seed : 1) ^ 0x5b1e)() * 10),
    // Нутро сцены: скрытая панель превью замораживает rAF, и «застряло»
    // от «крутится» снаружи не отличить — ручка отличает числом.
    wheel: () => wheelView,
  };
}

/**
 * `?town` — улица генератора домов (§6.1, набор Medieval Village MegaKit),
 * `?town=СИД` — с назначенным сидом. Города в игре ещё нет, и сцена заведена
 * под один вопрос: читается ли порядок домов — пролёты, этажи, материалы
 * и крыши, собранные планом (`render/village.ts`), — раньше, чем городу
 * появится место на карте. Ждать этого места, чтобы посмотреть на дом,
 * было бы не проверкой, а лотереей.
 *
 * Ручка `debug.town(seed)` пересобирает улицу на месте: сравнивать два сида
 * перезагрузкой значило бы терять кадр, на который смотришь.
 */
const debugTown = debugGet(debugParams, 'town');
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
  (window as unknown as { debug: unknown }).debug = {
    rig,
    town: (seed: number) => show(seed),
    // Спецификации домов улицы: пролёт, глубина, этажи, материал — то,
    // чего не прочитать глазом, если дом загородил соседа.
    houses: () => town?.street.map((h) => ({ ...h.spec, x: +h.x.toFixed(1), z: +h.z.toFixed(1) })) ?? null,
  };
}

/**
 * `?water` — пруд и ручей шейдера воды (`render/water.ts`), `?water=СИД` —
 * с назначенным сидом. Сцена заведена под один вопрос: читается ли вода
 * водой — полосы, гребни и дыхание формы, — и отвечать на него в замке
 * значило бы каждый раз идти к его рву мимо гарнизона и боёв. Ни героя,
 * ни игры в кадре нет: вода приносит свою землю, как улица `?town`.
 *
 * Ручка `debug.water(seed)` пересобирает берега на месте; `debug.time(s)`
 * двигает воду руками — скрытая панель превью замораживает rAF, и «стоит»
 * от «движется» иначе не отличить (`debug/routes.ts` про это молчит, но
 * колесо `?wheel` живёт с той же оговоркой). Смотреть при свете —
 * `?water=СИД&night=0`: ночь кадра иначе решают часы лагеря.
 */
const debugWaterScene = debugGet(debugParams, 'water');
if (debugWaterScene !== null) {
  toPadCamp();
  campView.group.visible = false;
  const waterSceneTime = waterUniforms();
  let pool: { group: THREE.Group; dispose: () => void } | null = null;
  const showWater = (seed: number): number => {
    if (pool !== null) {
      rig.world.remove(pool.group);
      pool.dispose();
    }
    const rng = mulberry32(seed ^ 0x77a7e5);
    const group = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];
    // Земля своя, как у улицы: ровный луг, на котором воду видно целиком.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: PALETTE.grassBase }),
    );
    disposables.push(ground.geometry, ground.material);
    group.add(ground);

    // Пруд — эллипс с рваным берегом: порог дышит шумом от сида. Клетка
    // без зазора: гладь обязана сложиться в одну поверхность — ровно то,
    // что кадр и проверяет; зазор — свойство рва, а не воды.
    const pond: { x: number; z: number }[] = [];
    const rx = 5 + rng() * 3;
    const rz = 4 + rng() * 3;
    for (let z = -10; z <= 10; z++) {
      for (let x = -10; x <= 10; x++) {
        const edge = (x / rx) ** 2 + (z / rz) ** 2;
        if (edge <= 1 + (rng() - 0.5) * 0.35) pond.push({ x, z });
      }
    }
    // Ручей — блуждание от края луга к пруду, клетка игрового ручья (0,94).
    // Сдвиг заполняет обе клетки своего ряда: диагональный шов — разрыв
    // ленты. Последний отрезок идёт по прямой до берега: ручей, повисший
    // посреди луга, читался бы багом, а не рекой.
    const stream: { x: number; z: number }[] = [];
    let sx = Math.round((rng() - 0.5) * 16);
    const bank = -Math.round(rz);
    for (let z = -21; z < bank; z++) {
      stream.push({ x: sx, z });
      if (rng() < 0.34) {
        const next = sx + (rng() < 0.5 ? 1 : -1);
        stream.push({ x: next, z });
        sx = next;
      }
    }
    for (; sx !== 0; sx += sx > 0 ? -1 : 1) stream.push({ x: sx, z: bank });
    const pour = (cells: readonly { x: number; z: number }[], size: number, opacity: number): void => {
      const geometry = waterGeometry(size, 3);
      const material = waterMaterial(waterSceneTime, opacity);
      disposables.push(geometry, material);
      const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
      const at = new THREE.Object3D();
      cells.forEach((cell, i) => {
        at.position.set(cell.x, 0.03, cell.z);
        at.updateMatrix();
        mesh.setMatrixAt(i, at.matrix);
      });
      mesh.renderOrder = 1;
      group.add(mesh);
    };
    pour(pond, 1, 0.82);
    pour(stream, 0.94, 0.84);
    rig.world.add(group);
    rig.lookAt(0, -4, true);
    rig.setZoom(30, true);
    pool = { group, dispose: () => disposables.forEach((d) => d.dispose()) };
    return seed;
  };
  const firstWater = Number(debugWaterScene);
  showWater(debugWaterScene === '' || !Number.isFinite(firstWater) ? 1 : firstWater);
  // Времени кадра хватает интервала: rAF тут ничего не двигает, вода — весь кадр.
  setInterval(() => {
    waterSceneTime['uWaterTime']!.value = performance.now() / 1000;
  }, 16);
  (window as unknown as { debug: unknown }).debug = {
    rig,
    water: (seed: number) => showWater(seed),
    time: (s: number) => {
      waterSceneTime['uWaterTime']!.value = s;
      return s;
    },
  };
}

/**
 * `?fan` — дуга аватаров под большой палец (`features/fan`).
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
if (debugHas(debugParams, 'fan')) {
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
          look: residentLook(r),
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

/** `?avatars` — матрица всех видов и сидов генератора SVG-лиц. */
if (debugHas(debugParams, 'avatars')) installAvatarLab();

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

function stepClanConstruction(now: number): void {
  if (now - lastClanWorkCheck < 30) return;
  lastClanWorkCheck = now;
  const result = advanceClanConstruction(camp, now);
  if (result.worked <= 0) return;
  if (result.completed !== null) {
    const location = camp.clan?.location;
    const building = location?.buildings.find((item) => item.kind === result.completed);
    if (inClanCamp && building !== undefined) {
      raidView?.hideSite();
      raidView?.place(CLAN_BUILDINGS[building.kind].model, building.x, building.z);
    }
    clanBuildBar.setReason(`${CLAN_BUILDINGS[result.completed].name} построен`);
    play('levelup');
  }
  clanBuildBar.sync(camp, clanPlacing, inClanCamp);
  persist();
}

/**
 * Тик систем лагеря: таймеры стройки, отряд, панель. Общий у обеих сцен
 * лагеря — площадки и поляны (§16.1): лагерь один, сцен у него две.
 */
function stepCampSystems(dt: number, now: number): void {
    idleSeconds += dt;
    stepClanConstruction(now);
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
    const farmFinished = completeFarmConstruction(camp, now);
    if (farmFinished !== null) {
      play('levelup');
      campHud.notify(gameText(gameMessage('Стройка огорода завершена', 'Farm construction completed')));
      syncFarmUi();
      persist();
    }
    const researched = completeResearchIfDue(camp, now);
    if (researched !== null) {
      play('levelup');
      campHud.notify(gameText(gameMessage('{name}: изучено', '{name}: researched'), {
        name: gameText(researchNameMessage(researched)),
      }));
      persist();
    }
    // §26 — отряд возвращается тем же тиком, что и стройка: слот освобождается
    // одинаково, и досчитывается он после закрытой вкладки так же.
    if (collectSortie(now)) persist();
    const hunts = collectHunts(camp, now);
    if (hunts.length > 0) {
      for (const report of hunts) {
        campHud.notify(report.foxes === 0
          ? `${report.name}: вернулся без лис`
          : `${report.name}: лис ${report.foxes} · мясо ${report.meat} · шкур ${report.pelts}`);
        if (report.lost > 0) campHud.notify(STORE_FULL);
      }
      if (inGladeCamp && controlled === -1) seatResidents();
      residentManager?.sync(camp, now, true);
      persist();
    }
    if (tickHeroes(now)) persist();
    // На смене мировых суток завершённое вчера поручение сменяется новым.
    syncRoadStoryTask();
    campHud.sync(camp, now, dt);
    if (researchPanel.visible) researchPanel.sync(camp, now);
    refreshNeighbours(now);
    // §30 — почта зажигается тем же порогом, что и вся остальная связь
    // с соседями: до второго жильца ящику неоткуда взяться.
    mailButton.setShown(neighboursOpen(camp));
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
    heroCard.sync(roster, shownHero, now);
    residentCard.setBottom(campHud.bands().bottom + 6);
    // Крыша могла появиться или пропасть, пока карточка открыта.
    if (residentCard.visible) residentCard.sync(camp, shownResident);
    residentManager?.sync(camp, now);
    // Таймеры Плаца и Лазарета идут и под открытой страницей: разбор обязан
    // считать то же, что карточка, а не застывать на кадре открытия.
    if (characterPage.visible) syncCharacter();
}

startLoop({
  update: (dt) => {
    const now = clock.now();
    refreshGlobalWorld(now);
    // На заставке не тикает ничего: таймеры стройки досчитываются при входе
    // в лагерь тем же completeIfDue, что и после закрытой вкладки.
    if (mode === 'title') return;
    // Публичный снимок неподвижен и не имеет права продвигать ни чужие
    // таймеры, ни хозяйство хозяина. Стареет только счётчик покоя рендера.
    if (mode === 'visit') {
      idleSeconds += dt;
      return;
    }
    if (inClanCamp && raid !== null) {
      stepRaid(raid, dt, false, 0);
      raid.food = raid.foodMax;
      stepClanConstruction(now);
      return;
    }
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
      if (raidView !== null) raidView.onHeavyImpact = shake;
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
        if (raid.battle === null && raid.status === 'running') {
          stepGraveNpcs(graveSite, raid.elapsed, raid.hero);
        }
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
        const arrived = near && !traderWasNear;
        if (arrived) {
          if (hearAboutCaravan(camp)) {
            raid.events.push(gameText(gameMessage(
              'Торговец: «Последний обоз с железом не пришёл»',
              'Trader: “The last iron caravan never arrived”',
            )));
            syncRoadStoryTask();
            persist();
          } else if (reportBridgeShortfall(camp)) {
            raid.events.push(gameText(gameMessage(
              'Торговец: «В обозе недостача. Ответ знает артель»',
              'Trader: “The caravan is short. The road crew knows why.”',
            )));
            syncRoadStoryTask();
            persist();
          } else {
            completeBridgeMission('visit-trader');
          }
        }
        traderWasNear = near;
        const show = near && !tradeLeft;
        if (show !== tradePanel.visible) tradePanel.setVisible(show);
        if (show) tradePanel.sync(camp, traderStock());
        // Гость у стен: разговор тем же жестом подхода, что лавка выше.
        syncGuestMeet();
        // Пост лесника (§6.1.6.3) — тем же жестом и в том же кадре.
        syncWoodsmanTalk();
      }
      if (trailSite !== null) syncRoadSurvivor();
      // Разговор открылся или закрылся — низ вылазки уступает или
      // возвращается. Спрашивается панель, а не открывший её кадр.
      syncTalking();
      if (minotaurNow !== null) {
        const enemy = minotaurNow.minotaur;
        const alive = enemy !== null && enemy.hp > 0;
        const near = alive && Math.hypot(raid.hero.x - enemy.x, raid.hero.z - enemy.z) <= 3;
        if (!near) minotaurLeft = false;
        const talking = near && enemy.peaceful === true && !minotaurLeft;
        if (talking) {
          if (!minotaurPanel.visible) minotaurPanel.show(camp, minotaurNow.loc.seed);
        } else if (minotaurPanel.visible) {
          minotaurPanel.hide();
        }

        const seed = minotaurNow.loc.seed >>> 0;
        const defendersDown = minotaurNow.loc.enemies.every((defender) => defender.hp <= 0);
        if (enemy !== null && defendersDown && !(camp.minotaurVictories ?? []).includes(seed)) {
          (camp.minotaurVictories ??= []).push(seed);
          raid.events.push('Минотавр повержен — золотой сундук теперь можно открыть');
          finishRoadStory('force', gameText(gameMessage(
            'Стража разбита — дорога снова открыта для обозов',
            'The guards are defeated — caravans can use the road again',
          )));
          persist();
        }
        if (minotaurNow.goldenChest.opened && !(camp.minotaurClaims ?? []).includes(seed)) {
          (camp.minotaurClaims ??= []).push(seed);
          const relic = claimMinotaurRelic(camp, seed);
          raid.events.push(`Золотой сундук: редкий предмет «${relic.name}» · ${relic.effect}`);
          persist();
        }
      }
      // §13.8 — местные ходят к своим кустам на тех же часах, что кусты
      // считаются: одно место — одно время.
      stepGatherers(dt);
      // Рубка идёт после шага и до уха: упавшее дерево ложится в рюкзак,
      // а прибавку в рюкзаке ухо озвучивает само (§18.1).
      stepChopping(dt);
      stepMining(dt);
      stepWorldPicking(dt);
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
        completeBridgeMission('cross-trail');
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
        const counts = raidHero !== null && minotaurNow === null;
        // §14.3 — невыстреленное и подобранное возвращается вместе с героем.
        // Провалившийся не возвращает ничего: он и добычу теряет по §11.2,
        // и колчан у него отняли там же.
        if (result.status === 'evacuated') camp.arrows += result.arrowsLeft;
        // §13.6 — потолок кладовой: не поместившееся пропадает, и об этом
        // говорится. Молчаливая потеря добычи хуже самой потери.
        if (stash(camp, result.carried) > 0) campHud.notify(STORE_FULL);
        const supplyClaim = counts && result.supplyBox
          ? claimSupplyBox(camp, supplyClaimSeed(result.seed, camp.raids + 1))
          : null;
        if ((supplyClaim?.overflow ?? 0) > 0) campHud.notify(STORE_FULL);
        if (raid.foxesCaught > 0) {
          camp.foxesCaught = (camp.foxesCaught ?? 0) + raid.foxesCaught;
          if (trailSite !== null) completeBridgeMission('hunt-trail');
        }
        if (counts) {
          camp.raids += 1;
          // §22.6б — ярус взрослеет заходами: смягчение входа кончается.
          camp.tierRaids[result.tier] += 1;
          if (result.status === 'evacuated') grantResearchNotes(camp);
          if (result.status === 'evacuated' && result.carriedTotal > 0) {
            grantAchievement('first-return', now);
          }
        }
        const progression = finishRaidForHero(
          raid,
          result.carriedTotal,
          result.status === 'evacuated',
          now,
        );
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
          guardTurns: result.guardTurns,
          guardPrevented: result.guardPrevented,
          shieldPushes: result.shieldPushes,
          intercepts: result.intercepts,
          dodges: result.dodges,
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
          progression,
          supplyClaim,
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
    rewardBurst.update(dt);
    // Пузыри живут над теми, кто говорит: в лагере на поляне — жильцы,
    // в замке — постовые у ворот. Любой другой кадр чистит слова со сценой.
    if (inGladeCamp && campLocation === 'camp') campBubbles();
    else if (mode === 'raid' && castleNow !== null && raidView !== null) bubbles.sync(raidView.garrisonBubbles());
    else bubbles.clear();
    // Полосы прогресса — каждый кадр и в любой сцене: список сам пустеет
    // там, где работ нет, и чистить его отдельной веткой не нужно.
    syncWorkBars();
    // Кольцо резонанса (§13.11) — тем же правилом: нет работы — нет кольца.
    syncTempoRing();
    if (mode === 'camp' && camp.farm !== undefined) {
      const farmSecond = Math.floor(clock.now());
      if (farmSecond !== lastFarmStatusSecond) {
        lastFarmStatusSecond = farmSecond;
        syncFarmUi();
      }
    }

    if (mode === 'title' && titleView !== null) {
      // Полная частота, а не 30 кадров лагеря: камеру здесь тянут пальцем,
      // и половинная частота читается как залипание, а не как экономия.
      titleView.update(now / 1000);
      rig.lookAt(titleView.center.x, titleView.center.z);
      rig.update(dt, titleView.center.x, titleView.center.z, 12);
      rig.renderWith(titleView.camera);
      return;
    }

    if (mode === 'visit' && visitingCamp !== null) {
      if (idleSeconds > 20) return;
      if (now - lastCampFrame < 1000 / 30) return;
      const campDt = Math.min(0.1, (now - lastCampFrame) / 1000);
      lastCampFrame = now;
      campView.update(campDt, now, rig.dayFactor);
      const c = campView.center;
      rig.lookAt(c.x + campInput.pan.x, c.z + campInput.pan.z);
      rig.update(campDt, c.x, c.z, 12);
      rig.render();
    } else if (mode === 'camp' && campLocation === 'farm') {
      if (idleSeconds > 20) return;
      if (now - lastCampFrame < 1000 / 30) return;
      const farmDt = Math.min(0.1, (now - lastCampFrame) / 1000);
      lastCampFrame = now;
      const c = farmView.center;
      farmView.sync(camp.farm, clock.now());
      rig.lookAt(c.x, c.z);
      rig.update(farmDt, c.x, c.z, 12);
      rig.render();
    } else if ((mode === 'raid' || inGladeCamp || inClanCamp) && raid !== null && raidView !== null) {
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
      if (inGladeCamp || inClanCamp || castleNow !== null) setNight(nightAt(campTime()));
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
        const preview = raidView === null
          ? battleForecast(raid)
          : raidView.battlePreview(raid);
        battleHud.sync(raid.battle, canHit, partyByUnit(raid), battleBusy, preview);
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
      } else if (debugCaravanAt !== null) {
        rig.lookAt(debugCaravanAt.x, debugCaravanAt.z);
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
      raidView.updateOcclusion(dt, rig.camera);
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
      stepCampPicking(campDt);
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
      campView.updateOcclusion(campDt, rig.camera);
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
