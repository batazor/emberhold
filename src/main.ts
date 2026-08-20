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
import { HERO_KNOWLEDGE, visionRadius } from './sim/config';
import { commandMove, createRaid, raidResult, stepRaid } from './sim/raid';
import type { RaidState } from './sim/raid';
import { addResources } from './sim/resources';
import { load, save } from './sim/save';
import { loadTelemetry, track } from './sim/telemetry';
import type { Tier } from './sim/types';
import { CampView } from './render/campView';
import { RaidView } from './render/raidView';
import { SceneRig } from './render/scene';
import { CampHud } from './ui/campHud';
import { ReturnScreen } from './ui/returnScreen';
import { StatsPanel } from './ui/statsPanel';
import { Hud } from './ui/hud';

const app = document.getElementById('app');
if (app === null) throw new Error('нет #app');

/* ---------- состояние ---------- */
const loaded = load();
const clock = new Clock(loaded.watermark);
let camp: CampState = loaded.camp;

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
let raidView: RaidView | null = null;
let resultShown = false;
/** camp.html: лагерь замирает через 20 секунд без касаний. */
let idleSeconds = 0;
let lastCampFrame = 0;
let selected: BuildingId | null = null;

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
    const cost = speedupCost(left);
    if (!speedup(camp, now)) return;
    track({ t: 'speedup', at: now, building: c.building, cost, leftSec: left });
    persist();
  },
  onRaid: (tier) => toRaid(tier),
});

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
  save(camp, clock.watermark);
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

/* ---------- переходы между сценами ---------- */
function toRaid(tier: Tier): void {
  // Кнопка уже заблокирована, но вход закрыт и здесь: ярус не должен
  // открываться в обход Кухни ни через отладку, ни через сохранение
  // от прежней сборки.
  if (tierBlock(camp, tier) !== 'ok') {
    campHud.notify(`Ярус ${tier}: нужна Кухня ур. ${TIER_KITCHEN_GATE[tier]}`);
    return;
  }
  raidView?.dispose();
  raid = createRaid({
    seed: (Math.random() * 1e9) | 0,
    tier,
    kitchenLevel: camp.levels.kitchen,
    storageLevel: camp.levels.storage,
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
  statsPanel.setVisible(false);
  returnScreen.hide();
  track({ t: 'raid_start', at: clock.now(), tier, food: raid.foodMax, capacity: raid.capacity });
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
      stepRaid(raid, dt, rig.night > 0.5, HERO_KNOWLEDGE);
      hud.sync(raid, dt);
      if (raid.status !== 'running' && !resultShown) {
        resultShown = true;
        const result = raidResult(raid);
        addResources(camp.resources, result.carried);
        camp.raids += 1;
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
    campHud.sync(camp, now, dt);
  },

  render: (alpha) => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastRender) / 1000);
    lastRender = now;

    returnScreen.update();

    if (mode === 'raid' && raid !== null && raidView !== null) {
      raidView.sync(raid, alpha, dt, now);
      rig.lookAt(raid.hero.x, raid.hero.z);
      rig.update(dt, raid.hero.x, raid.hero.z, visionRadius(HERO_KNOWLEDGE, rig.night > 0.5, true));
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
