import './style.css';
import { Clock } from './core/clock';
import { startLoop } from './core/loop';
import {
  bindPageAudio,
  play,
  startAmbient,
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
  TIER_KITCHEN_GATE,
  tierBlock,
  upgradeBlock,
} from './sim/camp';
import type { BuildingId, CampState } from './sim/camp';
import { GEAR } from './sim/gear';
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
import type { HeroState, Roster } from './sim/heroes';
import { ONB_HINT, firstTapCell, grantFirstBuilding, reveal } from './sim/onboarding';
import type { OnbStep } from './sim/onboarding';
import { firstGladeCell, generateGlade, gladeFood, siteBlock } from './sim/prologue';
import { commandMove, createRaid, raidResult, stepRaid, useSkill } from './sim/raid';
import type { RaidState } from './sim/raid';
import { CONSUMABLES, buyConsumable, refundConsumable } from './sim/consumables';
import type { ConsumableId } from './sim/consumables';
import { addResources } from './sim/resources';
import { load, save, wipe } from './sim/save';
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
import { DevMenu } from './ui/devMenu';
import { Hud } from './ui/hud';
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
let raidView: RaidView | null = null;
/**
 * Идёт пролог. Отдельного режима у него нет: поляна ходится теми же
 * правилами, что вылазка, и отличается тем, чем кадр кончается — не
 * эвакуацией, а нулём провианта.
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
    // Кадр 9: первое здание вырастает на глазах — бесплатно и без таймера
    // (§20.2, §20.3). Ожиданию и ценнику учит уже вторая постройка.
    if (onboarding.step === 'build' && id === 'kitchen') {
      if (grantFirstBuilding(camp, 'kitchen')) {
        track({
          t: 'build_done',
          at: clock.now(),
          building: 'kitchen',
          level: camp.levels.kitchen,
        });
        onboarding.set('tier');
        play('levelup');
        campHud.notify(`${BUILDINGS.kitchen.name} ур. ${camp.levels.kitchen}`);
      }
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
  onRaid: (tier) => {
    // Вторая вылазка — конец раскадровки: дальше игра работает как обычно.
    if (onboarding.step === 'tier') onboarding.set('done');
    toRaid(tier);
  },
  onCraft: (slot) => forge(slot),
  // §20.4 — карточка вооружает перестановку, дальше игрок бьёт по клетке.
  onMove: (id) => {
    selected = id;
    campView.highlight(selected);
    campHud.notify(`${BUILDINGS[id].name}: коснитесь свободного места`);
  },
});

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
  'hq-cap': 'выше Штаба нельзя',
  'slot-busy': 'слот занят другой стройкой',
  resources: 'не хватает ресурсов',
  ok: 'не вышло',
};

function upgradeReason(state: CampState, id: BuildingId): string {
  return BLOCK_REASON[upgradeBlock(state, id)] ?? 'не вышло';
}

const GEAR_REASON: Record<string, string> = {
  'no-forge': 'нужна Кузница',
  max: 'лучше не бывает',
  'forge-cap': 'Кузница не тянет выше',
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

// Только в разработке: в продакшен-сборке ветка вырезается целиком.
if (import.meta.env.DEV) {
  new DevMenu(app, {
    onNewGame: () => {
      wiped = true;
      wipe();
      location.reload();
    },
  });
}

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
  // Точка тапа нужна ровно в первом кадре: дальше игрок уже знает жест.
  if (step === 'glade' && raid !== null) {
    const cell = firstGladeCell(raid.loc, raid.hero);
    if (cell !== null) raidView?.showHint(cell.x, cell.z);
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

/** Кадр 3: экран коротко дёргается. Рана обязана быть замечена телом. */
function shake(): void {
  const canvas = rig.renderer.domElement;
  canvas.classList.remove('shake');
  // Пересчёт стилей между снятием и возвратом класса — иначе вторая
  // анимация подряд не запускается вовсе.
  void canvas.offsetWidth;
  canvas.classList.add('shake');
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
  onRaid: (tier) => {
    returnScreen.hide();
    toRaid(tier);
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
    state.hero.wounds,
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
  // Кадры 9 и 10 показывают ровно одно действие: отряд и данные ждут.
  const quiet = onboarding.step === 'build' || onboarding.step === 'tier';
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

function toRaid(tier: Tier): boolean {
  leaveTitle();
  inGlade = false;
  campPrompt.setVisible(false);
  // Кнопка уже заблокирована, но вход закрыт и здесь: ярус не должен
  // открываться в обход Кухни ни через отладку, ни через сохранение
  // от прежней сборки.
  if (tierBlock(camp, tier) !== 'ok') {
    campHud.notify(`Ярус ${tier}: нужна Кухня ур. ${TIER_KITCHEN_GATE[tier]}`);
    return false;
  }
  // §3 — в вылазку идёт один герой, и он обязан быть свободен.
  const hero = heroForRaid();
  if (hero === null) {
    campHud.notify('Все герои заняты — ждём лечения или тренировки');
    return false;
  }
  const rotated = hero !== activeHero(roster);
  if (rotated) selectHero(roster, roster.heroes.indexOf(hero));
  hero.status = 'raid';
  raidHero = hero;

  raidView?.dispose();
  raid = createRaid({
    // ?seed=N повторяет ту же локацию: §6 — воспроизводимость багов и замеров.
    seed: debugSeed ?? ((Math.random() * 1e9) | 0),
    tier,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
    loadout: loadout(hero),
    // §14 — снаряжение складывается поверх класса: класс отвечает «кем идём»,
    // снаряжение — «с чем».
    gear: camp.gear,
    // §21 — расходники: что взято в эту вылазку и сгорит на выходе.
    consumables: camp.loadout,
    // Первая вылазка держит выход закрытым до первой добычи (см. onboarding).
    evacOpen: !onboarding.inRaid,
  });
  // §21 — купленное уходит в вылазку и не возвращается: сгорает независимо
  // от того, пригодилось или нет. Копить нечего.
  camp.loadout = [];
  persist();
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile);
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
  track({ t: 'raid_start', at: clock.now(), tier, food: raid.foodMax, capacity: raid.capacity });
  // §11.8 — ротация меряется здесь: сменил героя или дождался лечения.
  track({ t: 'hero_pick', at: clock.now(), cls: hero.cls, level: hero.level, rotated });
  return true;
}

/**
 * Заставка. Показывается на холодном старте и больше нигде: возврат из
 * вылазки ведёт на экран возврата (§20.1), а не сюда — между вылазкой
 * и тратой добычи ничего вставлять нельзя.
 */
function toTitle(): void {
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
  const next = PITCH_ORDER[PITCH_ORDER.indexOf(placing) + 1];
  if (next === undefined) {
    placing = null;
    raidView?.hideSite();
    // Лагерь встал — единственное настоящее созвучие игры (§18.3).
    play('levelup');
    hud.setHint('Лагерь разбит');
    return;
  }
  startPlacing(next);
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
    loc: generateGlade(seed),
    food: gladeFood(),
    // Выхода с поляны нет, и кольцо эвакуации не рисуется: уйти можно
    // только тем, что провиант кончился.
    evacOpen: false,
  });
  raidView = new RaidView(raid.loc, raid.loadout.cls, grassPerTile, 'glade');
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
  // лагерь на Штабе ур. 5, либо оставлял пустое поле на первом.
  rig.setZoom(campArea(camp.levels.hq) * 2.8, true);
  // Лагерь — вечер, а не полдень: тёплый свет и длинные тени читаются лучше
  // на плоском затенении, чем прямое солнце.
  rig.night = 0.22;
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
  active: () => mode === 'camp',
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

  // Лагерь: сцена первая. Тап по зданию открывает его карточку, тап мимо
  // закрывает лист — то есть возвращает игроку весь экран с лагерем.
  campView.highlight(picked);
  if (picked === null) campHud.close();
  else campHud.openBuilding(picked);
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

canvas.addEventListener('pointerdown', (e) => {
  play('tap');
  askTilt();
  idleSeconds = 0;
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
  if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
});

canvas.addEventListener('pointermove', (e) => {
  // Ветер от курсора — во всех трёх сценах: трава лагеря и заставки
  // и есть та, на которую игрок смотрит дольше всего.
  const camera = mode === 'title' && titleView !== null ? titleView.camera : undefined;
  const hit = rig.screenToGround(e.clientX, e.clientY, camera);
  if (hit === null) return;
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
  // §11.8 — второй герой на Штабе ур. 2, третий на ур. 4.
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
} else if (!onboarding.inRaid || !toRaid(0)) {
  // Вход мог не открыться (сейв от прежних правил) — тогда честно в лагерь,
  // а не в пустой экран.
  toCamp();
}

// Отладочный вход: ?tier=N открывает игру сразу в вылазке нужного яруса.
// Нужен, чтобы проверять вылазку и экран возврата, не проходя лагерь заново.
const debugTier = debugParams.get('tier');
if (debugTier !== null) {
  const t = Number(debugTier);
  if (t >= 0 && t <= 3) toRaid(t as Tier);
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
      stepRaid(raid, dt, rig.night > 0.5, raid.loadout.knowledge);
      ear.hear(raid);
      if (inGlade) {
        hud.sync(raid, dt);
        // Кадр кончается ровно на нуле провианта. Голод, который в вылазке
        // отнимает рану через шесть секунд, сюда не успевает и не должен:
        // терять ещё нечего, и учить потерям в прологе не на чем.
        if (raid.food <= 0 && !resultShown) {
          resultShown = true;
          raid.path = [];
          raid.status = 'evacuated';
          raidView?.hideHint();
          campPrompt.setVisible(true);
          // Пульс отработал своё: он вёл к этой секунде и молчит после неё.
          stopPulse();
        }
        return;
      }
      if (onboarding.inRaid) onboarding.drive(raid);
      hud.sync(raid, dt);
      if (raid.status !== 'running' && !resultShown) {
        resultShown = true;
        const result = raidResult(raid);
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
        );
      }
      return;
    }

    idleSeconds += dt;
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
      rig.lookAt(raid.hero.x, raid.hero.z);
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
