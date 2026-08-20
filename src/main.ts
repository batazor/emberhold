import './style.css';
import { Clock } from './core/clock';
import { startLoop } from './core/loop';
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
import {
  ONB_HINT,
  firstTapCell,
  grantFirstBuilding,
  isRaidStep,
  nextRaidStep,
  openEvacWhenEarned,
  reveal,
  scriptWound,
} from './sim/onboarding';
import type { OnbStep } from './sim/onboarding';
import { commandMove, createRaid, raidResult, stepRaid, useSkill } from './sim/raid';
import type { RaidState } from './sim/raid';
import { CONSUMABLES, buyConsumable, refundConsumable } from './sim/consumables';
import type { ConsumableId } from './sim/consumables';
import { addResources } from './sim/resources';
import { load, save } from './sim/save';
import { loadTelemetry, track } from './sim/telemetry';
import type { Tier } from './sim/types';
import { CampView } from './render/campView';
import { RaidView } from './render/raidView';
import { SceneRig } from './render/scene';
import { CampHud } from './ui/campHud';
import { RosterPanel } from './ui/rosterPanel';
import { ReturnScreen } from './ui/returnScreen';
import { StatsPanel } from './ui/statsPanel';
import { Hud } from './ui/hud';

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

/**
 * Кадр онбординга (`onboarding.html`, §16). Пока он не 'done', игра идёт
 * по раскадровке: открывается сразу в вылазке, показывает по одной полосе
 * за раз и приводит в лагерь только после первой эвакуации.
 */
let onb: OnbStep = loaded.onboarding;
/** Время начала кадра — им разводятся открытия, идущие от одного события. */
let stepAt = 0;
/** Сколько контейнеров вскрыто в первой вылазке: кадры 4 и 6 считают по ним. */
let onbLooted = 0;
/** Скриптовая рана кадра 3 выдаётся ровно один раз. */
let onbWounded = false;
/** С чего начали: по этому числу видно, что героя задели по-настоящему. */
let onbStartWounds = 0;

let mode: 'camp' | 'raid' = 'camp';
let raid: RaidState | null = null;
/** Герой, который сейчас в локации: раны и опыт зачисляются ему. */
let raidHero: HeroState | null = null;
let raidView: RaidView | null = null;
let resultShown = false;
/** camp.html: лагерь замирает через 20 секунд без касаний. */
let idleSeconds = 0;
let lastCampFrame = 0;
let selected: BuildingId | null = null;

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
  onSkill: () => {
    if (raid === null) return;
    if (useSkill(raid)) track({ t: 'skill', at: clock.now(), skill: raid.loadout.skill, tier: raid.loc.tier });
  },
});

const campHud = new CampHud(app, {
  onUpgrade: (id) => {
    // Кадр 9: первое здание вырастает на глазах — бесплатно и без таймера
    // (§20.2, §20.3). Ожиданию и ценнику учит уже вторая постройка.
    if (onb === 'build' && id === 'kitchen') {
      if (grantFirstBuilding(camp, 'kitchen')) {
        track({
          t: 'build_done',
          at: clock.now(),
          building: 'kitchen',
          level: camp.levels.kitchen,
        });
        setOnb('tier');
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
    if (onb === 'tier') setOnb('done');
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
  save(camp, roster, clock.watermark, onb);
}

/**
 * Смена кадра — единственное место, где онбординг что-то показывает или
 * прячет. Полосы включаются здесь, а не в цикле: сравнивать состояние
 * каждый тик значило бы драться с игроком за видимость элементов.
 */
function applyOnb(): void {
  hud.setReveal(reveal(onb));
  hud.setHint(ONB_HINT[onb] ?? '');
  campHud.setOnboarding(onb);
  // Точка тапа нужна ровно в первом кадре: дальше игрок уже знает жест.
  if (onb === 'move' && raid !== null) {
    const cell = firstTapCell(raid.loc, raid.hero);
    if (cell !== null) raidView?.showHint(cell.x, cell.z);
  } else {
    raidView?.hideHint();
  }
}

function setOnb(step: OnbStep): void {
  if (onb === step) return;
  onb = step;
  stepAt = clock.now();
  applyOnb();
  track({ t: 'onboarding', at: clock.now(), step });
  persist();
}

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
    if (onb === 'return') setOnb('build');
    toCamp();
  },
});

function beginUpgrade(id: BuildingId): boolean {
  const now = clock.now();
  if (!startUpgrade(camp, id, now)) {
    campHud.notify(`${BUILDINGS[id].name}: ${upgradeReason(camp, id)}`);
    return false;
  }
  const toLevel = camp.levels[id] + 1;
  track({ t: 'build_start', at: now, building: id, toLevel, seconds: BUILD_SECONDS[toLevel] ?? 0 });
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

/* ---------- переходы между сценами ---------- */
function toRaid(tier: Tier): boolean {
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
    seed: (Math.random() * 1e9) | 0,
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
    evacOpen: !isRaidStep(onb),
  });
  // §21 — купленное уходит в вылазку и не возвращается: сгорает независимо
  // от того, пригодилось или нет. Копить нечего.
  camp.loadout = [];
  persist();
  raidView = new RaidView(raid.loc);
  rig.world.add(raidView.group);
  campView.group.visible = false;
  rig.lookAt(raid.hero.x, raid.hero.z, true);
  rig.setZoom(18, true);
  rig.night = 1;
  resultShown = false;
  mode = 'raid';
  hud.setVisible(true);
  campHud.setVisible(false);
  rosterPanel.setVisible(false);
  statsPanel.setVisible(false);
  returnScreen.hide();
  // Счётчики первой вылазки обнуляются вместе с ней: перезапуск возвращает
  // игрока к первому кадру, а не к середине раскадровки.
  if (isRaidStep(onb)) {
    onbLooted = 0;
    onbWounded = false;
    onbStartWounds = raid.hero.wounds;
    stepAt = clock.now();
  }
  applyOnb();
  track({ t: 'raid_start', at: clock.now(), tier, food: raid.foodMax, capacity: raid.capacity });
  // §11.8 — ротация меряется здесь: сменил героя или дождался лечения.
  track({ t: 'hero_pick', at: clock.now(), cls: hero.cls, level: hero.level, rotated });
  return true;
}

function toCamp(): void {
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
  camPan.x = 0;
  camPan.z = 0;
  rig.lookAt(c.x, c.z, true);
  // Кадр растёт вместе с площадью (§20.4): фиксированный зум либо резал
  // лагерь на Штабе ур. 5, либо оставлял пустое поле на первом.
  rig.setZoom(campArea(camp.levels.hq) * 2.8, true);
  // Лагерь — вечер, а не полдень: тёплый свет и длинные тени читаются лучше
  // на плоском затенении, чем прямое солнце.
  rig.night = 0.22;
  mode = 'camp';
  idleSeconds = 0;
  hud.setVisible(false);
  campHud.setVisible(true);
  // Кадры 9 и 10 показывают ровно одно действие: отряд и данные ждут.
  const quiet = onb === 'build' || onb === 'tier';
  rosterPanel.setVisible(!quiet);
  statsPanel.setVisible(!quiet);
  applyOnb();
  persist();
}

/* ---------- ввод ---------- */

/**
 * Камера лагеря. Лагерь растёт до 10×10 (§20.4) и в один экран телефона
 * целиком не влезает, поэтому его можно возить пальцем и приближать щипком.
 *
 * Смещение живёт здесь, а не в SceneRig: рига возит камеру за героем в вылазке,
 * и общее состояние сделало бы «где мы смотрим» зависимым от того, в каком
 * режиме игра. В лагере цель — центр площадки плюс это смещение, и только.
 */
const camPan = { x: 0, z: 0 };
/** Сколько можно отъехать от края площадки, в клетках. */
const PAN_MARGIN = 4;
/** Тап или протяг: ниже порога — это тап, и он открывает карточку. */
const DRAG_SLOP = 8;

const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let downAt: { x: number; y: number } | null = null;
/** Расстояние между пальцами и зум на начало щипка. */
let pinchFrom = 0;
let pinchZoom = 0;

function clampPan(): void {
  const limit = campArea(camp.levels.hq) / 2 + PAN_MARGIN;
  camPan.x = Math.max(-limit, Math.min(limit, camPan.x));
  camPan.z = Math.max(-limit, Math.min(limit, camPan.z));
}

/** Точка под пальцем должна оставаться под пальцем — отсюда разница по земле,
 *  а не пересчёт пикселей в клетки: он зависел бы от азимута и зума. */
function panByDrag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const a = rig.screenToGround(from.x, from.y);
  const b = rig.screenToGround(to.x, to.y);
  if (a === null || b === null) return;
  camPan.x += a.x - b.x;
  camPan.z += a.z - b.z;
  clampPan();
  // Без сглаживания: палец ведёт камеру ровно за собой, а плавность рига
  // нужна там, где цель ставит игра, — за героем в вылазке.
  const c = campView.center;
  rig.lookAt(c.x + camPan.x, c.z + camPan.z, true);
}

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

const canvas = rig.renderer.domElement;

canvas.addEventListener('pointerdown', (e) => {
  idleSeconds = 0;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (mode === 'raid') {
    const hit = rig.screenToGround(e.clientX, e.clientY);
    if (hit === null) return;
    if (raid === null || raid.status !== 'running') return;
    const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
    if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
    return;
  }

  if (pointers.size === 1) {
    downAt = { x: e.clientX, y: e.clientY };
    dragged = false;
  } else if (pointers.size === 2) {
    // Второй палец отменяет тап: щипок — это не промах по зданию.
    dragged = true;
    pinchFrom = pointerSpread();
    pinchZoom = rig.zoomLevel;
  }
  // Захват — удобство, а не условие: палец, ушедший за край канваса, должен
  // продолжать вести камеру. Но он же и необязателен, и на отказ браузера
  // жест ломаться не должен.
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* без захвата ведём по событиям канваса */
  }
});

function pointerSpread(): number {
  const [a, b] = [...pointers.values()];
  if (a === undefined || b === undefined) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev === undefined || mode !== 'camp') return;
  const cur = { x: e.clientX, y: e.clientY };
  idleSeconds = 0;

  if (pointers.size >= 2) {
    pointers.set(e.pointerId, cur);
    const spread = pointerSpread();
    // Пальцы разъезжаются — кадр сужается: щипок приближает, а не отдаляет.
    if (pinchFrom > 8 && spread > 8) rig.setZoom((pinchZoom * pinchFrom) / spread);
    return;
  }

  if (!dragged && downAt !== null) {
    if (Math.hypot(cur.x - downAt.x, cur.y - downAt.y) < DRAG_SLOP) {
      pointers.set(e.pointerId, cur);
      return;
    }
    dragged = true;
  }
  if (dragged) panByDrag(prev, cur);
  pointers.set(e.pointerId, cur);
});

function endPointer(e: PointerEvent): void {
  if (mode === 'camp' && pointers.has(e.pointerId) && pointers.size === 1 && !dragged) {
    campTap(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    downAt = null;
    dragged = false;
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode !== 'camp') return;
    e.preventDefault();
    idleSeconds = 0;
    rig.zoom(Math.sign(e.deltaY) * 2);
  },
  { passive: false },
);

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

/**
 * Кадры 1–7 двигаются событиями вылазки, а не секундомером: полоса рюкзака
 * появляется тогда, когда в рюкзаке что-то есть. Пауза участвует только там,
 * где два открытия идут от одного события (добыча → цена возврата → ставка).
 */
function driveOnboarding(state: RaidState): void {
  openEvacWhenEarned(state, onb);
  // Кадр 3: первый противник обязан задеть. Раны показываются до того,
  // как станут опасными, — на нулевом ярусе это ничего не стоит.
  if (onb === 'approach' && !onbWounded && scriptWound(state)) {
    onbWounded = true;
    shake();
  }
  let looted = 0;
  for (const c of state.loc.containers) if (c.opened) looted++;
  onbLooted = looted;

  const next = nextRaidStep(onb, {
    moved: state.steps > 0,
    wounded: onbWounded || state.hero.wounds < onbStartWounds,
    looted: onbLooted,
    sinceStep: clock.now() - stepAt,
  });
  if (next !== null) setOnb(next);
}

/* ---------- цикл ---------- */
let fpsAcc = 0;
let fpsFrames = 0;
let lastRender = performance.now();

// Раскадровка кадра 1: ни одного экрана меню до того, как игрок сыграет.
// Приложение открывается сразу в вылазке, лагерь появляется как награда.
// Вход мог не открыться (сейв от прежних правил) — тогда честно в лагерь,
// а не в пустой экран.
if (!isRaidStep(onb) || !toRaid(0)) toCamp();

// Отладочный вход: ?tier=N открывает игру сразу в вылазке нужного яруса.
// Нужен, чтобы проверять вылазку и экран возврата, не проходя лагерь заново.
const debugTier = new URLSearchParams(location.search).get('tier');
if (debugTier !== null) {
  const t = Number(debugTier);
  if (t >= 0 && t <= 3) toRaid(t as Tier);
}

startLoop({
  update: (dt) => {
    const now = clock.now();
    if (mode === 'raid' && raid !== null) {
      stepRaid(raid, dt, rig.night > 0.5, raid.loadout.knowledge);
      if (isRaidStep(onb)) driveOnboarding(raid);
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
        const firstReturn = isRaidStep(onb);
        if (firstReturn) setOnb('return');
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

    if (mode === 'raid' && raid !== null && raidView !== null) {
      raidView.sync(raid, alpha, dt, now);
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
      campView.update(campDt, now);
      const c = campView.center;
      // Тот же кадр, что и в toCamp, плюс то, куда игрок увёз камеру.
      rig.lookAt(c.x + camPan.x, c.z + camPan.z);
      rig.update(campDt, c.x, c.z, 12);
      rig.render();
    }

    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      hud.setStats(`${Math.round(fpsFrames / fpsAcc)} fps · ${rig.drawCalls} draw`);
      fpsAcc = 0;
      fpsFrames = 0;
    }
  },
});
