import './style.css';
import { Clock } from './core/clock';
import { startLoop } from './core/loop';
import {
  BUILDINGS,
  BUILD_SECONDS,
  completeIfDue,
  moveBuilding,
  speedup,
  speedupCost,
  startUpgrade,
  TIER_KITCHEN_GATE,
  tierBlock,
  upgradeBlock,
} from './sim/camp';
import type { BuildingId, CampState } from './sim/camp';
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
import { commandMove, createRaid, raidResult, stepRaid, useSkill } from './sim/raid';
import type { RaidState } from './sim/raid';
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
    // Отказ обязан быть слышен: молчащая кнопка читается как поломка.
    beginUpgrade(id);
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
  onRaid: (tier) => toRaid(tier),
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

const statsPanel = new StatsPanel(app);

function persist(): void {
  save(camp, roster, clock.watermark);
}

const returnScreen = new ReturnScreen(app, {
  onBuild: (id) => {
    beginUpgrade(id);
    returnScreen.hide();
    toCamp();
  },
  onRaid: (tier) => {
    returnScreen.hide();
    toRaid(tier);
  },
  onCamp: () => {
    returnScreen.hide();
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
function toRaid(tier: Tier): void {
  // Кнопка уже заблокирована, но вход закрыт и здесь: ярус не должен
  // открываться в обход Кухни ни через отладку, ни через сохранение
  // от прежней сборки.
  if (tierBlock(camp, tier) !== 'ok') {
    campHud.notify(`Ярус ${tier}: нужна Кухня ур. ${TIER_KITCHEN_GATE[tier]}`);
    return;
  }
  // §3 — в вылазку идёт один герой, и он обязан быть свободен.
  const hero = heroForRaid();
  if (hero === null) {
    campHud.notify('Все герои заняты — ждём лечения или тренировки');
    return;
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
  });
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
  track({ t: 'raid_start', at: clock.now(), tier, food: raid.foodMax, capacity: raid.capacity });
  // §11.8 — ротация меряется здесь: сменил героя или дождался лечения.
  track({ t: 'hero_pick', at: clock.now(), cls: hero.cls, level: hero.level, rotated });
}

function toCamp(): void {
  raidView?.dispose();
  raidView = null;
  raid = null;
  campView.group.visible = true;
  campView.setCamp(camp);
  const c = campView.center;
  // Смещение к югу: панель занимает нижнюю половину экрана, и лагерь
  // выводится над ней, а не под неё.
  rig.lookAt(c.x + 4.5, c.z + 4.5, true);
  rig.setZoom(17, true);
  // Лагерь — вечер, а не полдень: тёплый свет и длинные тени читаются лучше
  // на плоском затенении, чем прямое солнце.
  rig.night = 0.22;
  mode = 'camp';
  idleSeconds = 0;
  hud.setVisible(false);
  campHud.setVisible(true);
  rosterPanel.setVisible(true);
  statsPanel.setVisible(true);
  persist();
}

/* ---------- ввод ---------- */
rig.renderer.domElement.addEventListener('pointerdown', (e) => {
  const hit = rig.screenToGround(e.clientX, e.clientY);
  if (hit === null) return;
  idleSeconds = 0;

  if (mode === 'raid') {
    if (raid === null || raid.status !== 'running') return;
    const cell = { x: Math.round(hit.x), z: Math.round(hit.z) };
    if (commandMove(raid, cell)) raidView?.showMarker(cell.x, cell.z);
    return;
  }

  // §20.4 — перестановка бесплатна и мгновенна. Тап по зданию берёт его,
  // тап по свободной клетке ставит. Жители на тап не откликаются намеренно.
  const picked = campView.buildingAt(hit.x, hit.z);
  if (selected === null) {
    selected = picked;
  } else {
    const moved = moveSelected(hit.x, hit.z);
    selected = moved ? null : picked;
  }
  campView.highlight(selected);
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

toCamp();

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
      hud.sync(raid, dt);
      if (raid.status !== 'running' && !resultShown) {
        resultShown = true;
        const result = raidResult(raid);
        addResources(camp.resources, result.carried);
        camp.raids += 1;
        finishRaidForHero(raid, result.carriedTotal, result.status === 'evacuated', now);
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
        returnScreen.show(result, camp, (chose, canBuy) => {
          track({ t: 'return_screen', at: clock.now(), canBuy, chose });
        });
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
      rig.lookAt(c.x + 4.5, c.z + 4.5);
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
