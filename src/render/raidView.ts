import * as THREE from 'three';
import { blockingMaterial } from './blocking';
import {
  ENEMY_HEIGHT,
  buildingGeometry,
  enemyGeometry,
  enemyParts,
  dwellerParts,
  guardParts,
  heroGeometry,
  heroParts,
  residentLoad,
} from './models';
import { toolGeometry } from './tools';
import type { ToolModelName } from './tools';
import type { SelfAnswer } from '../sim/settler';
import { Drifting } from './drifting';
import { CASTLE_SCALE, castleGeometry, castleMaterial } from './castle';
import { LAMP_OF, lampGlowMaterial, lampLight, lampParts, propsMaterial, roadGeometry, setLampsNight } from './props';
import { roadPieces } from '../sim/roads';
import { FENCE_SCALE, fenceGeometry, graveyardGeometry, graveyardMaterial } from './graveyard';
import type { GraveyardPartModelName } from './graveyard';
import type { CastlePartModelName } from './castle';
import type { CastleSite } from '../sim/castleSite';
import {
  ARCHER_SPEED,
  PATROL_SPEED,
  SQUAD,
  DWELLER_SPEED,
  archerAt,
  dwellersAt,
  garrisonOf,
  patrolAt,
  type Garrison,
} from '../sim/garrison';
import type { DwellerLook } from '../sim/garrison';
import type { GraveSite } from '../sim/graveSite';
import type { TrailSite } from '../sim/trailSite';
import { Fire } from './fire';
import { fireOf } from './models';
import { Rigged } from './rigged';
import { RIG_CLIPS } from './rig.data';
import { HexGrid } from './hexGrid';
import { current, moves, targets } from '../sim/battle';
import type { BattlePlay } from '../sim/battle';
import { followSpots } from '../sim/raid';
import { hexToWorld, worldToHex } from '../sim/hex';
import type { Hex } from '../sim/hex';
import type { BuildingId } from '../sim/camp';
import { ENEMY_STATS } from '../sim/enemies';
import { inYard } from '../sim/castleSite';
import { HERO_SPEED } from '../sim/config';
import { SWING_SECONDS } from '../sim/logging';
import { idx } from '../sim/grid';
import type { Cell, EnemyKind, GameLocation, RaidState } from '../sim/types';
import type { HeroClassId } from '../sim/heroes';
import { forestMaterial } from './forest';
import type { ForestModelName } from './forest';
import { STUMP, STUMP_HEIGHT, WOODS, cellHash, treeGeometry, treeStand, type Tree } from './woods';
import type { Gust } from './cursorWind';
import { RESOURCE_MODEL, resourceGeometry, resourceMaterial } from './resources';
import { Grass, tileNoise } from './grass';
import type { Pusher } from './grass';
import { FluffyGrass } from './fluffyGrass';
import { PALETTE } from './palette';

/**
 * Вид вылазки: строит меши из состояния и синхронизирует их каждый кадр.
 * Симуляция об этом модуле не знает — она не импортирует three (DESIGN §6).
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Камни стены вылазки: под землёй лес не растёт (§12.1). */
const RAID_ROCKS: readonly ForestModelName[] = [
  'Rock_1_D_Color1',
  'Rock_1_E_Color1',
  'Rock_1_G_Color1',
  'Rock_2_D_Color1',
  'Rock_3_G_Color1',
  'Rock_3_H_Color1',
];

/**
 * Стены поляны из пролога — деревья. Список общий с лагерем и живёт
 * в `woods.ts`: герой выходит из этого леса и в нём же встаёт лагерем,
 * и разными породами это выглядело бы как два разных места.
 */
const GLADE_TREES = WOODS;

/**
 * Чем застроены непроходимые клетки. Копи и поляна отличаются ровно этим
 * и точкой выхода: правила ходьбы, камера и трава у них общие.
 */
export type RaidFlavor = 'mine' | 'glade' | 'castle' | 'grave' | 'trail';

/**
 * Деревья кладбища — хвоя и осенняя хвоя набора (§6.1.7). Список свой,
 * а не общий с поляной, и это решение: у лагеря и пролога лес один, потому
 * что герой выходит из него и в нём же встаёт лагерем; кладбище стоит
 * в другом месте, и другая порода по краю говорит об этом без подписи.
 */
const GRAVE_TREES: readonly GraveyardPartModelName[] = [
  'pine',
  'pine-crooked',
  'pine-fall',
  'pine-fall-crooked',
];

/** Пеньки по краю участка: вырубленный когда-то лес, и по нему ходят. */
const GRAVE_STUMPS: readonly GraveyardPartModelName[] = ['trunk', 'trunk-long'];

/**
 * Рост отметок участка в клетках локации. Числа не назначены на глаз:
 * герой — 1,38, и надгробие по пояс это 0,8, крест в рост человека — 1,3,
 * склеп выше героя вдвое. Гроб лежит, и рост у него толщина.
 */
const MARK_HEIGHT: Record<string, number> = {
  'grave': 0.14,
  'gravestone-bevel': 0.7,
  'gravestone-round': 0.75,
  'gravestone-cross': 1.15,
  'cross': 1.3,
  'crypt': 2.4,
  'coffin': 0.45,
};

/**
 * Шатёр рисуется в габаритах артбука — почти четыре единицы в ширину.
 * Тот же коэффициент, что в лагере (`campView.ts`): здание не имеет права
 * выглядеть по-разному в двух сценах, иначе это два разных здания.
 */
const BUILDING_SCALE = 0.55;

/** Во сколько раз палатка жильца меньше здания. То же число, что на площадке
 *  (`campView.ts`): след у неё 1×1 против 2×2, и размер здесь не украшение,
 *  а то же число, которым считается место. */
const TENT_LOOK = 0.5;

/**
 * Высота добычи на клетке. Октаэдр, которым она рисовалась до набора, был
 * 0,52 в поперечнике, и модели приведены к нему же: подмена не должна сдвинуть
 * ни тень, ни то, с какого расстояния добыча читается.
 */
const CONTAINER_HEIGHT = 0.52;

/**
 * Рост валуна (§13.4) в клетках локации: герою по колено. Выше — и камень
 * стал бы стеной, которую почему-то можно обойти; ниже — щебнем, по которому
 * не бьют. Пенёк просеки ровно такой же (0,42), и это не совпадение: обе
 * вещи занимают место на полу, но не в силуэте локации.
 */
const STONE_HEIGHT = 0.42;

/**
 * Замеры клипов (`npm run clips`, каталог набора анимаций) — по ним клип
 * подгоняется под механику, а не наоборот.
 *
 * `SLIDE` — сколько единиц набора проходит нога за секунду в клипе ходьбы;
 * `STRIKE` — когда в клипе удара приходится сам удар.
 */
const SLIDE = 1.71;
const STRIKE = 0.583;

/**
 * Растяжение клипа удара: удар обязан прийтись ровно на конец замаха (§17.3),
 * иначе телеграф врёт. У мага замах вдвое длиннее, и клип у него медленнее.
 */
const ATTACK_RATE: Record<EnemyKind, number> = {
  minion: STRIKE / ENEMY_STATS.minion.telegraph,
  warrior: STRIKE / ENEMY_STATS.warrior.telegraph,
  mage: STRIKE / ENEMY_STATS.mage.telegraph,
  // У привидения клипа нет вовсе: замах играется трансформом (`drifting.ts`)
  // и длится ровно столько, сколько назначено телеграфу. Растягивать нечего.
  ghost: 1,
};

/**
 * Растяжение клипа ходьбы: шаг клипа обязан совпасть со скоростью §17.4,
 * иначе ноги едут по полу.
 *
 * Потолок здесь не от лени. Замер показал расхождение самой игры: падальщик
 * ростом 0,95 клетки бежит 2,2 клетки в секунду — больше двух своих ростов, —
 * и честное растяжение вышло бы многократным. Семикратная ходьба читается как дрожь,
 * поэтому клип ускоряется втрое, а остаток скольжения остаётся видимым долгом:
 * либо скорость, либо рост назначены неверно, и решать это балансом, а не
 * множителем в рендере.
 */
const MAX_RATE = 3;

/**
 * До чего гаснут стены замка, пока герой во дворе. Не до нуля: замок обязан
 * остаться постройкой, по которой ходят, а не пропасть — сквозь стену должно
 * быть видно, что она стена.
 */
const CASTLE_FADE = 0.45;
const rateFor = (speed: number, scale: number): number =>
  Math.min(MAX_RATE, speed / Math.max(1e-3, SLIDE * scale));
const walkRate = (kind: EnemyKind, scale: number): number =>
  rateFor(ENEMY_STATS[kind].speed, scale);

/**
 * §17.6 — весь удар героя обязан уложиться в половину интервала атаки,
 * иначе два удара подряд накладываются друг на друга.
 */
const HERO_SWING_SECONDS = 0.6;

/**
 * §17.6 отводит падению 680 мс, клип набора длится 800. Растягиваем клип,
 * а не правим раздел: смерть не должна тормозить темп, и это решение
 * механики, а не длина чужого клипа.
 */
const FALL_RATE = 0.8 / 0.68;

/** §17.1 — вспышка урона. Короче не заметят, длиннее сольётся со следующим
 *  ударом. Не клип: она ложится поверх того, что герой делает сейчас. */
const FLASH_SECONDS = 0.15;

/**
 * Темп показа боя (§11.3). Симуляция решает все ходы противников за один тик —
 * и это правильно: пошаговость не должна заставлять ждать решения. Но смотреть
 * мгновенный бой нечего, поэтому рендер проигрывает протокол (`BattlePlay`)
 * в своём темпе, ход за ходом. Числа — про читаемость, а не про механику:
 * ни одно из них не влияет на то, чем бой кончится.
 */
/** Секунд на гекс шага. Быстрее ходьбы мира: шаг в бою — перестановка фигуры,
 *  а не прогулка, и три гекса не должны стоить трёх секунд ожидания. */
const PLAY_HEX_SECONDS = 0.17;
/** Замах до попадания и отход после. В сумме меньше секунды на удар:
 *  раунд с тремя противниками обязан укладываться в пару секунд. */
const PLAY_IMPACT_SECONDS = 0.32;
const PLAY_RECOVER_SECONDS = 0.34;
/** Стойка блока: короткая пауза, чтобы жест был виден, — саму позу боец
 *  держит дальше сам (клип «блок» держит последний кадр). */
const PLAY_GUARD_SECONDS = 0.45;
/** Когда стрела сходит с тетивы и сколько летит на гекс. */
const PLAY_RELEASE_SECONDS = 0.24;
const PLAY_FLIGHT_PER_HEX = 0.06;
/** Выпад атакующего к цели (в клетках) и отдача цели от удара. */
const PLAY_LUNGE = 0.26;
const PLAY_BUMP = 0.16;
const PLAY_BUMP_SECONDS = 0.18;

/** Активный ход показа: что играется и сколько уже. */
interface PlayNow {
  readonly play: BattlePlay;
  t: number;
  /** Полная длительность; для удара внутри неё лежит момент попадания. */
  readonly dur: number;
  readonly impact: number;
  /** Попадание уже показано: реакция цели играется один раз. */
  landed: boolean;
  /** Мировые точки пути шага. */
  readonly points: readonly { x: number; z: number }[] | null;
}

/** Сколько ствол дрожит после замаха (§13.3). Короче клипа удара: дрожь —
 *  ответ на удар, а не отдельное событие. */
const SHAKE_SECONDS = 0.32;

/**
 * Сколько падает срубленное дерево. Дольше падения противника (680 мс,
 * §17.1): у ствола длиннее плечо, а мгновенное исчезновение читалось бы
 * не рубкой, а пропажей.
 */
const FALL_SECONDS = 0.9;


interface EnemyView {
  /**
   * Тело противника. У ярусных это скелет набора, у привидения — то же самое
   * без костей (`drifting.ts`): вылазка ведёт обоих одним кодом и не знает,
   * кто из них чем анимирован.
   */
  readonly rig: Rigged | Drifting;
  readonly base: THREE.MeshLambertMaterial;
  readonly hot: THREE.MeshLambertMaterial;
  /** Полоска жизни: заполнение отдельным спрайтом, чтобы расти слева. */
  readonly life: THREE.Sprite;
  readonly lifeRoot: THREE.Object3D;
  /** Куда смотрит модель. Хранится отдельно, потому что поворот сглаживается,
   *  а симуляция направления противника не держит: ей оно не нужно. */
  facing: number;
  /** Стойкость на прошлом кадре: по её убыли запускается клип урона. */
  hp: number;
  /** Одиночный клип доигрывает до конца и только потом отпускает состояние. */
  busy: boolean;
  /** Секунды, оставшиеся вспышке урона (§17.1). */
  flash: number;
}

export class RaidView {
  readonly group = new THREE.Group();
  private readonly enemyViews = new Map<number, EnemyView>();
  /**
   * Жильцы двора (§6.1.6.1). Держатся отдельно от противников, потому что
   * ими и не являются: ни полоски жизни, ни замаха, ни клипа падения —
   * жилец только ходит и стоит.
   */
  private readonly dwellerViews: { rig: Rigged; facing: number }[] = [];
  /**
   * Материал замка. Держится отдельной ссылкой затем, чтобы гасить стены,
   * пока герой во дворе (§6.1.6.1): иначе кадр показывает стену вместо того,
   * ради чего в замок заходят.
   */
  private castleMat: THREE.MeshLambertMaterial | null = null;
  private castleFade = 1;
  private readonly containerMeshes = new Map<number, THREE.Mesh>();
  private hero!: THREE.Group;
  /** Есть у класса с моделью набора; у примитивных классов остаётся null. */
  private heroRig: Rigged | null = null;
  /**
   * Что герой делал на прошлом кадре. Симуляция боевых событий не рассылает —
   * звук их тоже вычитает из состояния (§18.3), — поэтому и рендер сравнивает
   * состояние с прошлым кадром, а не ждёт уведомления.
   */
  private heroWas = { wounds: 0, cooldown: 0 };
  /** Одиночный клип героя доигрывает до конца и только потом отпускает
   *  состояние. Удар, прерванный шагом на середине замаха, читается как
   *  рывок, а не как удар (§17.1). */
  private heroBusy = false;
  /** Секунды, оставшиеся вспышке урона (§17.1). */
  private heroFlash = 0;
  /**
   * §11.7 — остальные бойцы отряда. Ведущий рисуется отдельно (`hero`):
   * у него своя анимация боя и своя вспышка, и сваливать его в общий список
   * значило бы дублировать всё это на каждого.
   */
  private readonly mates: THREE.Group[] = [];
  private readonly mateRigs: Rigged[] = [];
  /**
   * §11.7 — точки, куда встанет отряд. Показывают то же, что считает
   * симуляция: место берётся у неё, а не рисуется приблизительно, — иначе
   * точка обещает одно, а боец встаёт в другое.
   */
  private marks: THREE.InstancedMesh | null = null;
  /** §11.3 — гекс-сетка поля боя. Вне боя её нет. */
  private readonly hexGrid = new HexGrid();
  /**
   * Гекс под пальцем. Ведётся наведением, а не нажатием: на телефоне
   * наведения нет, и там подсветка просто не появится — жест от этого
   * не меняется, тап остаётся тапом.
   */
  private hoverHex: Hex | null = null;
  /**
   * §11.3 — показ боя. Очередь протокола (`RaidState.plays`) и текущий ход:
   * пока они не пусты, положение и клипы бойцов ведёт показ, а не симуляция —
   * та уже всё решила и ушла вперёд.
   */
  private readonly battlePlays: BattlePlay[] = [];
  private playNow: PlayNow | null = null;
  /** Где каждый боец стоит по показу. Симуляция уже переставила фигуры,
   *  а тела остаются здесь, пока очередь до них не дойдёт. */
  private readonly restHex = new Map<number, Hex>();
  /** Стойкость по показу: полоска тикает ударом на экране, а не тиком сима. */
  private readonly shownHp = new Map<number, number>();
  /** Кто на экране уже упал: падение играется в момент удара, один раз. */
  private readonly shownDead = new Set<number>();
  /** Куда бойцу смотреть по показу; нет записи — правило кадра (на героя). */
  private readonly battleFacing = new Map<number, number>();
  /** Отдача от удара: затухающий сдвиг тела цели. */
  private readonly bumps = new Map<number, { dx: number; dz: number; left: number }>();
  /** Позиции бойцов на этот кадр — считает показ, читают циклы тел. */
  private readonly battlePosNow = new Map<number, { x: number; z: number }>();
  /** Шёл ли бой на прошлом кадре — чтобы поймать завязку и развязку. */
  private battleWas = false;
  /** Ведущий на поле — его номер нужен и после закрытия поля, пока показ
   *  доигрывает последний удар. */
  private heroUnitId: number | null = null;
  /** Стрела в полёте. Лениво: в вылазке без стрелков её нет. */
  private arrowMesh: THREE.Mesh | null = null;
  /** Рана ведущего дошла до экрана — main дёргает тряску кадра отсюда,
   *  а не тиком симуляции: тряска раньше удара читалась бы как сбой. */
  onHeroHit: (() => void) | null = null;
  /**
   * Пеньки просеки (§13.3). Один InstancedMesh на всю локацию, заведённый
   * заранее и пустой: срубить можно каждое внутреннее дерево, но не сразу,
   * и заводить меш на каждый пенёк значило бы платить вызовом отрисовки
   * за каждое движение топора.
   */
  private stumps: THREE.InstancedMesh | null = null;
  private stumpCount = 0;
  private marker!: THREE.Mesh;
  /** Точка тапа из кадра 1 онбординга: единственная подсказка, которая
   *  показывает жест вместо того, чтобы называть его словами. */
  private hintRing!: THREE.Mesh;
  /** На поляне выхода нет, и кольца тоже: показывать некуда (§12.1). */
  /** Кольца выходов. Обычно одно; у тропы два — по выходу на конец хода. */
  private readonly evacRings: THREE.Mesh[] = [];
  /** Здания, поставленные в конце пролога. До него их нет вовсе. */
  private readonly placed = new Map<BuildingId, THREE.Mesh>();
  /** Свет поставленного костра. Тот же, что потом горит в лагере. */
  private readonly fire = new Fire();
  /** Плафоны фонарей замка: один материал на все, ночь поднимает эмиссию. */
  private lampGlow: THREE.MeshLambertMaterial | null = null;
  /** Огоньки фонарей — по точечному на столб, ночь зажигает их разом. */
  private readonly lampLights: THREE.PointLight[] = [];
  /** Пятно под курсором в режиме выбора места и призрак здания над ним. */
  private site: THREE.Mesh | null = null;
  private ghost: THREE.Mesh | null = null;
  private grass: Grass | null = null;
  /** Трава заставки вместо клеточной — отладочный кадр `?пух`. */
  private meadow: FluffyGrass | null = null;
  /** Клетки, выкошенные постройкой или рубкой, — запрет пересева луга. */
  private readonly mowed = new Set<number>();
  /** Где какое дерево стоит (§13.3): клетка → экземпляр в своём меше.
   *  Заполняется только лесной локацией — камень не рубят. */
  private readonly trees = new Map<number, { mesh: THREE.InstancedMesh; at: number; turn: number }>();
  /** Клетки, дрожащие после замаха, и сколько они уже дрожат. */
  private readonly shaken = new Map<number, number>();
  /** Падающие стволы. `regrow` — кромка: на её место встаёт следующее дерево. */
  private readonly falling: { key: number; t: number; regrow: boolean }[] = [];
  /** Пятно работы под тем, по чему бьют. Заводится в первый же замах,
   *  а не на входе: в вылазке без валунов его не будет никогда. */
  private workMark: THREE.Mesh | null = null;
  /** Работает ли герой прямо сейчас — этим он и отличается от стоящего. */
  private working = false;
  /** Валуны (§13.4): по одному мешу на камень — их единицы, и меш на каждый
   *  дешевле, чем поиск экземпляра в общем буфере на каждый удар. */
  private readonly stoneMeshes = new Map<number, THREE.Mesh>();
  /** Валуны, дрожащие после замаха, и сколько они уже дрожат. */
  private readonly stoneHits = new Map<number, number>();
  /**
   * Гарнизон замка (§6.1.6): отряд на тропе и стрелок на стене. Считает их
   * симуляция — здесь только тела, повороты и клипы. Часы свои и с нуля:
   * `performance.now()` растёт от загрузки страницы, и на нём вторая ходка
   * в замок начиналась бы с середины чужой смены.
   */
  private garrison: Garrison | null = null;
  private readonly squad: { rig: Rigged; facing: number }[] = [];
  /**
   * Поселенец у прогалины: сидит, пока его не позвали. Отдельным полем,
   * а не в `dwellerViews`, потому что живёт он не от времени, как жильцы
   * замка, а от одного события — и второго такого в кадре не бывает.
   */
  private settler: {
    rig: Rigged;
    facing: number;
    /** Куда идти, когда встал. `null` — ещё сидит или уже пришёл. */
    goal: { x: number; z: number } | null;
    /** Сколько осталось вставать: клип не прерывается ходьбой. */
    rising: number;
  } | null = null;
  private archer: { rig: Rigged; facing: number } | null = null;
  private watch = 0;
  /** Переиспользуемые слоты толчка: аллокация каждый кадр тут не нужна. */
  private readonly pushers: { x: number; z: number; strength: number }[] = [];
  /** Порыв от курсора. Считает его main — источник ветра один на игру. */
  private gust: Gust | null = null;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  /** Один материал на все модели артбука: цвет приходит вершинами (§6.1). */
  private readonly blocking = this.track(blockingMaterial());
  /**
   * §17.1 — вспышка урона. Цветом, а не яркостью, разводится с телеграфом:
   * красное `PALETTE.telegraph` значит «сейчас ударят», белый иней —
   * «уже ударили». Две вещи, которые игрок обязан различать мгновенно,
   * одинаковым цветом разной силы не различаются.
   */
  private readonly hurtFlash = this.track(
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: PALETTE.hurt,
      emissiveIntensity: 1.6,
    }),
  );

  constructor(
    private readonly loc: GameLocation,
    private readonly heroClass: HeroClassId = 'archer',
    grassPerTile = 24,
    private readonly flavor: RaidFlavor = 'mine',
    /** Площадка замка (§6.1.6): без неё вкус «замок» рисовать нечем. */
    private readonly keep: CastleSite | null = null,
    /** Участок кладбища (§6.1.7): то же самое для вкуса «кладбище». */
    private readonly grave: GraveSite | null = null,
    /** Тропа (§6.1.17): без неё вкусу «тропа» нечем отличить грунт от травы. */
    private readonly trail: TrailSite | null = null,
    /** §14 — уровень оружия: он выбирает клинок в руке (§6.1.8). */
    private readonly weapon = 0,
    /** §11.7 — классы остальных бойцов отряда, в порядке цепочки. */
    private readonly mateClasses: readonly HeroClassId[] = [],
    /** Отладка `?пух`: трава заставки (FluffyGrass) вместо клеточной. */
    private readonly fluffy = false,
  ) {
    this.buildGround();
    this.buildGrass(grassPerTile);
    this.buildWalls();
    if (this.keep !== null) this.buildCastle(this.keep);
    if (this.keep !== null) this.buildGarrison(this.keep);
    if (this.grave !== null) this.buildGraveyard(this.grave);
    if (flavor !== 'glade') this.buildEvac(this.loc.evac);
    // §6.1.17 — у дороги два конца, и дальний тоже выход: над ним тот же луч.
    if (this.trail !== null) this.buildEvac(this.trail.exit);
    this.buildContainers();
    this.buildStones();
    this.buildEnemies();
    this.buildHero();
    this.buildMarker();
    this.buildHintRing();
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** Земля — одна InstancedMesh на всю сетку: одна draw call вместо size². */
  private buildGround(): void {
    const { size, tier } = this.loc;
    const geo = this.track(new THREE.BoxGeometry(1, 0.5, 1));
    const mat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const mesh = new THREE.InstancedMesh(geo, mat, size * size);
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    // Грунт тропы (§6.1.17): вытоптанные клетки рыжее и светлее земли.
    // Тропа читается цветом и голой землёй — подписи у неё нет.
    const dirt = this.trail === null
      ? null
      : new Set(this.trail.path.map((c) => idx(size, c.x, c.z)));
    let i = 0;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        // Детерминированный шум по координате: без RNG, чтобы вид не зависел
        // от порядка вызовов и совпадал при том же сиде. Тот же шум читает
        // трава — иначе травинки повиснут над просевшими клетками.
        const v = tileNoise(x, z);
        dummy.position.set(x, -0.25 - v * 0.04, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Земля темнеет с ярусом — глубина читается без цифр (§6.1).
        if (dirt !== null && dirt.has(i)) color.setHSL(0.08, 0.31, 0.37 + v * 0.05);
        else color.setHSL(PALETTE.groundHue - tier * 0.022, 0.24 - tier * 0.04, 0.34 - tier * 0.05 + v * 0.05);
        mesh.setColorAt(i, color);
        i++;
      }
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);

    const backdrop = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(400, 400)),
      this.track(new THREE.MeshBasicMaterial({ color: PALETTE.backdrop })),
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.set(size / 2, -1.2, size / 2);
    this.group.add(backdrop);
  }

  private buildGrass(perTile: number): void {
    if (this.fluffy) {
      this.buildMeadow();
      return;
    }
    this.grass = new Grass(this.loc, perTile, undefined, this.bareCells());
    this.group.add(this.grass.mesh);
  }

  /**
   * Отладочный кадр `?пух`: тот же луг, что на заставке и в лагере.
   * Сэмплеру нужна поверхность — плоскость по полю, запечённая лежащей
   * прямо в геометрии (сэмплер читает локальные координаты и матрицу меша
   * не применяет); в сцену она не добавляется, земля уже нарисована кубами.
   */
  private buildMeadow(): void {
    const { size } = this.loc;
    const geo = this.track(
      new THREE.PlaneGeometry(size, size)
        .rotateX(-Math.PI / 2)
        .translate((size - 1) / 2, 0, (size - 1) / 2),
    );
    const terrain = new THREE.Mesh(geo, this.track(new THREE.MeshLambertMaterial()));
    const bare = this.bareCells();
    // Плотность — как у лагеря (~3 кустика на клетку): кустик впятеро
    // крупнее травинки вылазки, и полная плотность травы тут не нужна.
    this.meadow = new FluffyGrass(terrain, {
      fieldSize: size,
      count: size * size * 4,
      scale: 4,
      // Прижат к земле: луг титульной высоты прятал герою ноги, а поляна —
      // кадр игровой, герой и добыча обязаны читаться.
      height: 0.15,
      // Порыв от курсора втрое слабее титульного — по росту прижатого луга.
      gust: 1 / 3,
      // И пятно порыва втрое уже: полный радиус на игровом поле — полполя.
      gustRadius: 1 / 3,
      // Фоновая волна тоже втрое спокойнее титульной.
      wind: 1 / 3,
      reject: (x, z) => {
        const cell = idx(size, Math.round(x), Math.round(z));
        return bare.has(cell) || this.mowed.has(cell);
      },
    });
    this.group.add(this.meadow.group);
  }

  /** Клетка выкошена: у клеточной травы — точечно, лугу — пересев. */
  private clearGrassCell(x: number, z: number): void {
    this.grass?.clearCell(x, z);
    if (this.meadow !== null) {
      this.mowed.add(idx(this.loc.size, x, z));
      this.meadow.replant();
    }
  }

  /**
   * Где траву не сеют. Пусто везде, кроме кладбища: там весь участок
   * за оградой — **между могилами не растёт**. Иначе трава закрывает
   * надгробия, и участок читается лугом с камнями.
   *
   * Границы участка берутся у самой ограды, а не назначаются: клетка
   * набора это `FENCE_SCALE` клеток локации, и внутренность — прямоугольник
   * между крайними её деталями.
   */
  /**
   * Клетки, на которых трава не растёт. Два хозяина: ограда кладбища и замок.
   *
   * У замка это не украшение кадра, а то же, чем земля отличается от поля:
   * **двор — это утоптанная земля, а не луг.** Трава внутри стен читалась
   * заброшенностью — как раз обратным тому, что говорят гарнизон и жильцы.
   * Гасится не прямоугольник плана, а ровно то, что замок занимает: клетки
   * двора и клетки, на которых стоят детали. Прямоугольником вышли бы лысины
   * снаружи — у замков с вырезанными углами план не совпадает со следом.
   */
  private bareCells(): ReadonlySet<number> {
    // Грунт тропы — те же клетки, что тонирует земля: вытоптано — значит
    // и не заросло. Трава на обочине остаётся — ею тропа и отличается
    // от дна оврага.
    if (this.trail !== null) {
      return new Set(this.trail.path.map((c) => idx(this.loc.size, c.x, c.z)));
    }
    const keep = this.keep;
    if (keep !== null) {
      const out = new Set<number>();
      const mark = (px: number, pz: number): void => {
        for (let dz = 0; dz < CASTLE_SCALE; dz++) {
          for (let dx = 0; dx < CASTLE_SCALE; dx++) {
            const x = keep.at.x + px * CASTLE_SCALE + dx;
            const z = keep.at.z + pz * CASTLE_SCALE + dz;
            if (x < 0 || z < 0 || x >= this.loc.size || z >= this.loc.size) continue;
            out.add(idx(this.loc.size, x, z));
          }
        }
      };
      for (const spot of keep.castle.yard) mark(spot.x, spot.z);
      // Только основание: ярусы башни и шапка ворот стоят выше нуля
      // и на вопрос «что под ними на земле» не отвечают.
      for (const piece of keep.castle.pieces) if (piece.y === 0) mark(piece.x, piece.z);
      return out;
    }
    const site = this.grave;
    if (site === null) return new Set();
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const piece of site.fence) {
      x0 = Math.min(x0, piece.x);
      z0 = Math.min(z0, piece.z);
      x1 = Math.max(x1, piece.x);
      z1 = Math.max(z1, piece.z);
    }
    if (!Number.isFinite(x0)) return new Set();
    const at = (v: number): number => site.at.x + v * FENCE_SCALE;
    const atZ = (v: number): number => site.at.z + v * FENCE_SCALE;
    const out = new Set<number>();
    for (let z = Math.floor(atZ(z0)); z <= Math.ceil(atZ(z1)); z++) {
      for (let x = Math.floor(at(x0)); x <= Math.ceil(at(x1)); x++) {
        if (x < 0 || z < 0 || x >= this.loc.size || z >= this.loc.size) continue;
        out.add(idx(this.loc.size, x, z));
      }
    }
    return out;
  }

  /** Отладочный орган управления, как ползунок «Ночь»: это замер, не механика. */
  setGrassDensity(perTile: number): void {
    this.grass?.setDensity(perTile);
  }

  get grassBlades(): number {
    return this.meadow?.blades ?? this.grass?.blades ?? 0;
  }

  /**
   * Стены — модели из набора (§6.1). Раньше здесь стоял додекаэдр: одна форма
   * на всю локацию, и стена читалась как ряд одинаковых шариков. Вариантов
   * шесть, выбор — от координаты клетки, поэтому камень на месте не прыгает
   * между заходами и локация остаётся выводимой из сида.
   *
   * В прологе те же клетки заняты деревьями: поляна — единственная локация
   * на поверхности, и стена у неё лесная.
   */
  private buildWalls(): void {
    const { size, blocked } = this.loc;
    // У кладбища лес свой — из набора кладбища, и ставит его buildGraveyard.
    if (this.flavor === 'grave') return;
    // Тропа стоит в том же лесу, что поляна и лагерь: она рядом с ними
    // на поверхности, и другая порода говорила бы «другое место» зря.
    const tree = this.flavor === 'glade' || this.flavor === 'castle' || this.flavor === 'trail';
    const models: readonly Tree[] = tree
      ? GLADE_TREES
      : RAID_ROCKS.map((model) => ({ set: 'forest', model }) as const);
    const cells: number[][] = models.map(() => []);
    // У замка занятых клеток два рода: лес по краю и сам замок. Лесом
    // засаживается только лес — иначе деревья выросли бы сквозь стену.
    const wood = this.keep === null
      ? null
      : new Set(this.keep.trees.map((s) => idx(size, s.x, s.z)));
    // Стоит ли клетка у просеки: рядом с ходом стволы обязаны стоять стеной —
    // граница читается, — и прореживается только глубь.
    const nearOpen = (cx: number, cz: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          if (!blocked[idx(size, nx, nz)]) return true;
        }
      }
      return false;
    };
    // Сухостой тропы: глубь леса дышит, а клетка остаётся занятой честно.
    const snags: number[] = [];
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const at = idx(size, x, z);
        if (!blocked[at]) continue;
        if (wood !== null && !wood.has(at)) continue;
        // Глубь леса тропы разрежена: сплошной строй крон читался стеной
        // до горизонта. Кроны остаются на четырёх клетках из десяти, треть
        // остального — пеньки старой вырубки, прочее — тёмный подлесок.
        // Первый ряд у просеки прореживание не трогает — просвет у самой
        // тропы читался бы проходом, которого нет. Пробовался и сухостой
        // в рост: масса голых стволов читалась завалом брёвен, а не лесом.
        //
        // Записанный долг: клетка подлеска занята симуляцией, но пуста
        // глазу, и прорубившийся вглубь получит дерево с пустого места.
        // До просеки такие клетки не достают на два ряда, и добраться
        // туда можно только срубив видимый ряд.
        if (this.trail !== null && !nearOpen(x, z) && (x * 3 + z * 7) % 10 >= 4) {
          if ((x * 5 + z * 11) % 3 === 0) snags.push(x, z);
          continue;
        }
        cells[cellHash(x * 5.1, z * 9.3, models.length)]!.push(x, z);
      }
    }

    const mat = this.track(forestMaterial());
    for (let v = 0; v < models.length; v++) {
      const list = cells[v]!;
      if (list.length === 0) continue;
      // Геометрия живёт в общем кэше forest.ts и переживает вид: её не track.
      const mesh = new THREE.InstancedMesh(treeGeometry(models[v]!, 1), mat, list.length / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i += 2) {
        const x = list[i]!;
        const z = list[i + 1]!;
        const at = treeStand(x, z, tree, 0);
        mesh.setMatrixAt(i / 2, at);
        // Дерево, которое можно срубить, обязано быть найдено по клетке:
        // симуляция говорит «клетка освободилась», а рендеру надо знать,
        // какой из экземпляров какого меша на ней стоит (§13.3).
        if (tree) this.trees.set(idx(size, x, z), { mesh, at: i / 2, turn: 0 });
      }
      this.group.add(mesh);
    }

    // Пеньки старой вырубки — те же, что остаются от срубленного дерева.
    // Рубятся как дерево: клетка занята, топор её открывает (§13.3),
    // поэтому каждый числится в `this.trees` наравне с кронами.
    if (snags.length > 0) {
      const mesh = new THREE.InstancedMesh(
        treeGeometry(STUMP, STUMP_HEIGHT),
        mat,
        snags.length / 2,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < snags.length; i += 2) {
        const x = snags[i]!;
        const z = snags[i + 1]!;
        mesh.setMatrixAt(i / 2, treeStand(x, z, true, 0));
        this.trees.set(idx(size, x, z), { mesh, at: i / 2, turn: 0 });
      }
      this.group.add(mesh);
    }
  }

  /* ---------- вырубка (§13.3) ---------- */

  /* Матрица дерева на клетке — общая с лагерем: `treeStand` (woods.ts). */

  /** Поставить дереву матрицу и сказать three, что буфер поменялся. */
  private static put(mesh: THREE.InstancedMesh, at: number, m: THREE.Matrix4): void {
    mesh.setMatrixAt(at, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Замах пришёлся в дерево: ствол вздрагивает. Дрожь — единственное, чем
   * рендер отвечает на удар до падения, и без неё десять замахов читаются
   * как зависание.
   */
  hitTree(x: number, z: number): void {
    // Топор вошёл в ствол — с этого мгновения идёт следующий замах.
    // Только если герой действительно рубит: с приходом боевого удара
    // безусловный replay перезапускал бы боевой замах на каждом стуке
    // по дереву, и удар по противнику не доигрывал бы никогда.
    if (this.working) this.heroRig?.replay();
    const key = idx(this.loc.size, x, z);
    if (!this.trees.has(key)) return;
    this.shaken.set(key, 0);
  }

  /**
   * Дерево падает. `regrow` — кромка: там за упавшим стоит следующее, и оно
   * встаёт, как только первое легло. Внутреннее дерево уходит совсем,
   * клетка под ним уже освобождена симуляцией.
   */
  fellTree(x: number, z: number, regrow: boolean): void {
    const key = idx(this.loc.size, x, z);
    const tree = this.trees.get(key);
    if (tree === undefined) return;
    this.shaken.delete(key);
    this.falling.push({ key, t: 0, regrow });
  }

  /**
   * Пенёк на клетке. Ёмкость меша — все внутренние деревья локации: больше
   * пеньков, чем было деревьев, не бывает, и пересобирать меш на ходу
   * не приходится ни разу.
   */
  private addStump(x: number, z: number): void {
    if (this.stumps === null) {
      const room = Math.max(1, this.trees.size + this.stumpCount + 1);
      const mesh = new THREE.InstancedMesh(
        treeGeometry(STUMP, STUMP_HEIGHT),
        this.track(forestMaterial()),
        room,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Пустой меш: экземпляры выключены нулевым масштабом, пока пенька нет.
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < room; i++) mesh.setMatrixAt(i, zero);
      this.stumps = mesh;
      this.group.add(mesh);
    }
    if (this.stumpCount >= this.stumps.count) return;
    const dummy = new THREE.Object3D();
    // Тот же детерминированный сдвиг, что у дерева: пенёк обязан остаться
    // там, где стоял ствол, а не в центре клетки.
    const t = ((Math.sin(x * 3.1 + z * 7.7) * 1000) % 1 + 1) % 1;
    dummy.position.set(x + (t - 0.5) * 0.22, -0.04, z + (t - 0.5) * 0.18);
    dummy.rotation.set(0, t * 6.28, 0);
    dummy.updateMatrix();
    RaidView.put(this.stumps, this.stumpCount, dummy.matrix);
    this.stumpCount++;
  }

  /** Работа топором: пятно под деревом растёт вместе с ней. 0 — работы нет. */
  showWork(x: number, z: number, share: number): void {
    if (this.workMark === null) {
      this.workMark = new THREE.Mesh(
        this.track(new THREE.CircleGeometry(0.44, 20)),
        this.track(
          new THREE.MeshBasicMaterial({
            color: PALETTE.siteOk,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            fog: false,
          }),
        ),
      );
      this.workMark.rotation.x = -Math.PI / 2;
      this.group.add(this.workMark);
    }
    this.workMark.visible = true;
    this.workMark.position.set(x, 0.06, z);
    this.workMark.scale.setScalar(Math.max(0.08, share));
    // Пятно и клип — одно состояние: пока пятно растёт, герой машет,
    // а не стоит в покое рядом с работающим индикатором.
    this.working = true;
  }

  hideWork(): void {
    if (this.workMark !== null) this.workMark.visible = false;
    this.working = false;
  }

  /** Дрожь после замаха и падение — оба живут кадрами, а не тиками симуляции. */
  private syncTrees(dt: number): void {
    for (const [key, t] of [...this.shaken]) {
      const tree = this.trees.get(key);
      if (tree === undefined) {
        this.shaken.delete(key);
        continue;
      }
      const next = t + dt;
      const base = treeStand(key % this.loc.size, (key / this.loc.size) | 0, true, tree.turn);
      if (next >= SHAKE_SECONDS) {
        this.shaken.delete(key);
        RaidView.put(tree.mesh, tree.at, base);
        continue;
      }
      this.shaken.set(key, next);
      // Затухающий кивок: удар отдаёт в крону, а не раскачивает ствол.
      const lean = Math.sin((next / SHAKE_SECONDS) * Math.PI * 3) * 0.05 * (1 - next / SHAKE_SECONDS);
      RaidView.put(tree.mesh, tree.at, base.clone().multiply(new THREE.Matrix4().makeRotationX(lean)));
    }

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const fall = this.falling[i]!;
      const tree = this.trees.get(fall.key);
      if (tree === undefined) {
        this.falling.splice(i, 1);
        continue;
      }
      fall.t += dt;
      const x = fall.key % this.loc.size;
      const z = (fall.key / this.loc.size) | 0;
      const share = Math.min(1, fall.t / FALL_SECONDS);
      if (share < 1) {
        // Ускорение к земле: ствол трогается медленно и обрушивается в конце.
        const base = treeStand(x, z, true, tree.turn);
        const angle = (Math.PI / 2) * share * share;
        RaidView.put(tree.mesh, tree.at, base.multiply(new THREE.Matrix4().makeRotationX(angle)));
        continue;
      }
      this.falling.splice(i, 1);
      if (fall.regrow) {
        const turn = tree.turn + 1;
        this.trees.set(fall.key, { ...tree, turn });
        RaidView.put(tree.mesh, tree.at, treeStand(x, z, true, turn));
      } else {
        this.trees.delete(fall.key);
        RaidView.put(tree.mesh, tree.at, new THREE.Matrix4().makeScale(0, 0, 0));
        // На месте упавшего остаётся пенёк. До набора кладбища просеке
        // нечем было отличаться от места, где дерева не было никогда,
        // а §13.3 обещает именно просеку: «падает один раз и оставляет
        // после себя просеку». Кромка пенька не получает — там за упавшим
        // сразу встаёт следующее дерево, и пеньку негде стоять.
        this.addStump(x, z);
      }
    }
  }

  /**
   * Замок (§6.1.6). Деталей в кадре под сотню, а моделей два десятка, поэтому
   * рисуется он одной InstancedMesh на модель: сто мешей стоили бы сто вызовов
   * отрисовки за то же изображение.
   *
   * Ни одного смещения здесь не подбирается. Клетка плана переводится
   * в клетки локации умножением на масштаб, поворот берётся у детали как
   * есть, высота яруса — из плана: всё это уже посчитано конструктором,
   * и вторая копия этих правил в рендере разошлась бы с первой молча.
   */
  private buildCastle(site: CastleSite): void {
    const byModel = new Map<string, typeof site.castle.pieces[number][]>();
    for (const piece of site.castle.pieces) {
      // Мощение двора не рисуется: под замком уже лежит земля локации,
      // и вторая плита поверх неё дала бы z-fighting, а не пол.
      if (piece.role === 'двор') continue;
      const list = byModel.get(piece.model) ?? [];
      list.push(piece);
      byModel.set(piece.model, list);
    }

    const mat = this.track(castleMaterial());
    this.castleMat = mat;
    const dummy = new THREE.Object3D();
    for (const [model, list] of byModel) {
      // Геометрия живёт в общем кэше castle.ts и переживает вид: её не track.
      const mesh = new THREE.InstancedMesh(
        castleGeometry(model as CastlePartModelName),
        mat,
        list.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const piece = list[i]!;
        // Ноль детали стоит в центре её клетки набора, а клетка набора
        // покрывает CASTLE_SCALE клеток локации: центр квадрата смещён
        // на полклетки от его угла.
        dummy.position.set(
          site.at.x + piece.x * CASTLE_SCALE + (CASTLE_SCALE - 1) / 2,
          piece.y * CASTLE_SCALE,
          site.at.z + piece.z * CASTLE_SCALE + (CASTLE_SCALE - 1) / 2,
        );
        dummy.rotation.set(0, (piece.turn * Math.PI) / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      this.group.add(mesh);
    }

    this.buildRoads(site);
  }

  /**
   * Дорога замка и её фонари (§6.1.12). Клетки и форма плиток приходят
   * из симуляции (`castleSite.ts` решает где, `roads.ts` — что ставить);
   * рендер только расставляет готовое — тем же способом, что детали стен.
   */
  private buildRoads(site: CastleSite): void {
    const pieces = roadPieces(site.roads);
    if (pieces.length > 0) {
      const mat = this.track(propsMaterial());
      const byTile = new Map<string, typeof pieces>();
      for (const piece of pieces) {
        const list = byTile.get(piece.tile) ?? [];
        list.push(piece);
        byTile.set(piece.tile, list);
      }
      const dummy = new THREE.Object3D();
      for (const [tile, list] of byTile) {
        const { geometry, turn, lift } = roadGeometry('камень', tile as typeof pieces[number]['tile']);
        const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
        // Плита лежит на земле и тени не отбрасывает: ей не с чего.
        mesh.receiveShadow = true;
        for (let i = 0; i < list.length; i++) {
          const piece = list[i]!;
          dummy.position.set(
            site.at.x + piece.x * CASTLE_SCALE + (CASTLE_SCALE - 1) / 2,
            0.01 + lift,
            site.at.z + piece.z * CASTLE_SCALE + (CASTLE_SCALE - 1) / 2,
          );
          dummy.rotation.set(0, ((piece.turn + turn) * Math.PI) / 2, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        this.group.add(mesh);
      }
    }

    if (site.lamps.length > 0) {
      const parts = lampParts(LAMP_OF['камень']);
      const postMat = this.track(propsMaterial());
      this.lampGlow = this.track(lampGlowMaterial());
      for (const cell of site.lamps) {
        const lamp = new THREE.Group();
        const post = new THREE.Mesh(parts.post, postMat);
        post.castShadow = true;
        const glow = new THREE.Mesh(parts.glow, this.lampGlow);
        const light = lampLight();
        light.position.set(parts.lampAt[0], parts.lampAt[1], parts.lampAt[2]);
        this.lampLights.push(light);
        lamp.add(post, glow, light);
        lamp.position.set(cell.x, 0, cell.z);
        this.group.add(lamp);
      }
    }
  }

  /**
   * Гарнизон замка (§6.1.6): четверо в обходе и один на стене.
   *
   * Тел ставится пять, и все пять — сразу: скиннованный меш не инстансится,
   * заводить и выбрасывать его в кадре дороже, чем держать погашенным.
   * Стрелок поэтому не рождается и не умирает, а гаснет — снаружи это
   * одно и то же, а в кадре разница в пяти вызовах отрисовки.
   *
   * Персонаж один на всех, а различает их предмет в руке: у обхода меч,
   * у стрелка лук. Скелет при этом у каждого свой — иначе пятеро шагали бы
   * в такт одной ногой.
   */
  /**
   * Посадить поселенца на клетку. Клип «сидит» зациклен, и до зова
   * поселенец не делает больше ничего: он не покой играет, а именно сидит —
   * все прочие в кадре стоят и ходят, и разница видна без подписи.
   */
  /** Жильцы лагеря у костра (§6.1.4): сидят, как сидел поселенец знакомства. */
  private residents: Rigged[] = [];

  /** Палатки жильцов на поляне — по одной на приглашённого под крышей. */
  private tents: THREE.Mesh[] = [];

  /**
   * Ведение передано жильцу (§16.1): герой стоит, где остановился, и сцена
   * его не возит — позиция симуляции в это время принадлежит жильцу.
   */
  private heroParked = false;

  setHeroParked(parked: boolean): void {
    this.heroParked = parked;
  }

  /** Где стоит жилец — чтобы передать ему позицию симуляции без рывка. */
  residentAt(i: number): { x: number; z: number } | null {
    const rig = this.residents[i];
    return rig === undefined
      ? null
      : { x: rig.root.position.x, z: rig.root.position.z };
  }

  /** Сменить инструмент в руке жильца на месте — приказ карточки (§6.1.14). */
  setResidentTool(i: number, tool: ToolModelName | null): void {
    this.residents[i]?.setHeld('handslot.r', tool === null ? null : toolGeometry(tool));
  }

  /**
   * Дать жильцу ношу или забрать её (§6.1.15). Вторая рука, а не первая:
   * в первой инструмент, и подмена его бревном стирала бы занятие ровно
   * тогда, когда оно наконец видно.
   *
   * Зовётся не каждый кадр, а на смене состояния: геометрия общая и лежит
   * в кэше набора, но пересобирать меш шестьдесят раз в секунду ради
   * предмета, который меняется дважды за минуту, незачем.
   */
  setResidentLoad(i: number, answer: SelfAnswer | null): void {
    this.residents[i]?.setHeld('handslot.l', answer === null ? null : residentLoad(answer));
  }

  /**
   * Кто из жильцов под пальцем: тап по человеку — то же, что тап по его
   * лицу в веере. Радиус — половина клетки: человек ловится собой,
   * а не запасом палатки рядом.
   */
  residentNear(x: number, z: number): number | null {
    let best: number | null = null;
    let bestD = 0.55;
    this.residents.forEach((rig, i) => {
      const d = Math.hypot(rig.root.position.x - x, rig.root.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Вести жильца: позиция приходит из симуляции — рукой игрока (§16.1) или
   * маршрутом рутины (`sim/chores.ts`), — а клип выбирается по делу.
   *
   * `glide` — догнать цель шагом, а не встать в неё. Нужен рутине в двух
   * швах: приказ карточки перекладывает маршрут, а возврат ведения оставляет
   * жильца там, где игрок его бросил, — в обоих случаях цель оказывается
   * в стороне, и телепорт читался бы сбоем. Ведомому игроком `glide`
   * не ставится: его позиция и есть симуляция, отставать ей не от чего.
   *
   * Клип труда у рутины — рабочий цикл занятия (`рубит`): «удар»
   * синхронизирован со звуком и дрожью цели (§17.3), а у рутины цели нет —
   * её замах ничего не валит.
   */
  driveResident(
    i: number,
    x: number,
    z: number,
    walking: boolean,
    working: boolean,
    dt: number,
    opts?: { speed?: number; workClip?: 'удар' | 'рубит'; talking?: boolean; glide?: boolean },
  ): void {
    const rig = this.residents[i];
    if (rig === undefined) return;
    const speed = opts?.speed ?? HERO_SPEED;
    let tx = x;
    let tz = z;
    if (opts?.glide === true) {
      const px = rig.root.position.x;
      const pz = rig.root.position.z;
      const far = Math.hypot(x - px, z - pz);
      // Догоняет в 1,8 шага: заведомо быстрее цели, но всё ещё ногами.
      const step = speed * 1.8 * dt;
      if (far > Math.max(step, 0.08)) {
        tx = px + ((x - px) / far) * step;
        tz = pz + ((z - pz) / far) * step;
        walking = true;
        working = false;
      }
    }
    const dx = tx - rig.root.position.x;
    const dz = tz - rig.root.position.z;
    if (Math.hypot(dx, dz) > 1e-4) {
      rig.root.rotation.y = RaidView.turnTo(rig.root.rotation.y, Math.atan2(dx, dz), dt);
    }
    rig.root.position.set(tx, 0, tz);
    if (walking) rig.play('ходьба', rateFor(speed, rig.root.scale.y));
    else if (working) {
      if (opts?.workClip === 'рубит') rig.play('рубит');
      else rig.play('удар', STRIKE / SWING_SECONDS);
    } else if (opts?.talking === true) rig.play('разговор');
    else rig.play('покой');
  }

  /** Довернуть стоящего жильца: лицо стоянки — к делу, а не куда пришёл. */
  faceResident(i: number, facing: number, dt: number): void {
    const rig = this.residents[i];
    if (rig === undefined) return;
    rig.root.rotation.y = RaidView.turnTo(rig.root.rotation.y, facing, dt);
  }

  /**
   * Убрать жильца из кадра на ночь (§24) — он спит в палатке. Тело гасится,
   * а не выбрасывается: скиннованный меш не инстансится, и заводить его
   * заново каждое утро дороже, чем держать погашенным, — то же решение,
   * что у стрелка на стене.
   */
  setResidentHidden(i: number, hidden: boolean): void {
    const rig = this.residents[i];
    if (rig !== undefined) rig.root.visible = !hidden;
  }

  /**
   * Поставить жильцов. Список пересобирается целиком: жильцов единицы,
   * и следить за диффом здесь дороже, чем посадить заново.
   */
  setResidents(
    list: readonly {
      look: DwellerLook;
      tool?: ToolModelName;
      x: number;
      z: number;
      facing: number;
      /** false — жилец на маршруте рутины: стоит, а водит его driveResident. */
      seated?: boolean;
    }[],
  ): void {
    for (const rig of this.residents) rig.dispose();
    this.residents = list.map((r) => {
      // Инструмент занятия (§6.1.14) — и у сидящего тоже: чем человек занят,
      // видно у костра так же, как на площадке лагеря.
      const rig = new Rigged(dwellerParts(r.look, r.tool), this.blocking);
      rig.root.position.set(r.x, 0, r.z);
      rig.root.rotation.y = r.facing;
      rig.play(r.seated === false ? 'покой' : 'сидит');
      this.group.add(rig.root);
      return rig;
    });
  }

  putSettler(look: DwellerLook, x: number, z: number, facing = 0): void {
    this.settler?.rig.dispose();
    const rig = new Rigged(dwellerParts(look), this.blocking);
    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = facing;
    rig.play('сидит');
    this.group.add(rig.root);
    this.settler = { rig, facing, goal: null, rising: 0 };
  }

  /**
   * Позвать: встаёт и идёт. Ходьба не начинается, пока клип вставания
   * не доигран — оборванное вставание читается как рывок, а это ровно то,
   * ради чего клип и взят вместо подмены позы.
   */
  callSettler(toX: number, toZ: number): void {
    if (this.settler === null) return;
    this.settler.rig.play('встаёт');
    this.settler.rising = RIG_CLIPS['встаёт'].duration;
    this.settler.goal = { x: toX, z: toZ };
  }

  /** Где он сейчас: отладочной сцене нужно число, а не глаз. */
  settlerAt(): { x: number; z: number; state: string | null } | null {
    if (this.settler === null) return null;
    const p = this.settler.rig.root.position;
    return { x: +p.x.toFixed(3), z: +p.z.toFixed(3), state: this.settler.rig.state };
  }

  private syncSettler(dt: number): void {
    const s = this.settler;
    if (s === null) return;
    // Тик миксера — первым и безусловно. Сидит он или идёт, кадр обязан
    // стареть: без этого клип не играется вовсе, и поселенец остаётся
    // в позе привязки — то есть стоит навытяжку с видом «анимация сломана».
    s.rig.update(dt);
    if (s.rising > 0) {
      s.rising -= dt;
      return;
    }
    if (s.goal === null) return;
    const dx = s.goal.x - s.rig.root.position.x;
    const dz = s.goal.z - s.rig.root.position.z;
    const far = Math.hypot(dx, dz);
    if (far < 0.08) {
      s.goal = null;
      s.rig.play('покой');
      return;
    }
    const step = Math.min(far, DWELLER_SPEED * dt);
    s.rig.root.position.x += (dx / far) * step;
    s.rig.root.position.z += (dz / far) * step;
    s.facing = RaidView.turnTo(s.facing, Math.atan2(dx, dz), dt);
    s.rig.root.rotation.y = s.facing;
    s.rig.play('ходьба', rateFor(DWELLER_SPEED, s.rig.root.scale.y));
  }

  private buildGarrison(site: CastleSite): void {
    this.garrison = garrisonOf(site);
    for (let i = 0; i < SQUAD; i++) {
      const rig = new Rigged(guardParts('дозор'), this.blocking);
      this.group.add(rig.root);
      this.squad.push({ rig, facing: 0 });
    }
    // Стрелку выходить некуда — не заводим и тела: замок без единой
    // проходимой клетки верха возможен только вместе с новым набором,
    // но молча рисовать его стоящим в воздухе нельзя.
    if (this.garrison.runs.length > 0) {
      const rig = new Rigged(guardParts('стрелок'), this.blocking);
      rig.root.visible = false;
      this.group.add(rig.root);
      this.archer = { rig, facing: 0 };
    }

    // Жильцы двора (§6.1.6.1) — тем же порядком и по той же причине: свой
    // скелет каждому, иначе двое с одним шагали бы нога в ногу.
    for (const walk of this.garrison.yard) {
      const rig = new Rigged(dwellerParts(walk.look), this.blocking);
      this.group.add(rig.root);
      this.dwellerViews.push({ rig, facing: 0 });
    }
  }

  /**
   * Гарнизон на кадре. Положение и направление приходят числами из
   * симуляции, здесь остаётся то, что умеет только рендер: разворот за кадр,
   * а не рывком (§17.2), и клип под скорость (§17.4).
   */
  private syncGarrison(dt: number): void {
    if (this.garrison === null) return;
    this.watch += dt;

    const men = patrolAt(this.garrison, this.watch);
    for (let i = 0; i < this.squad.length; i++) {
      const view = this.squad[i]!;
      const man = men[i]!;
      view.rig.update(dt);
      view.rig.root.position.set(man.x, 0, man.z);
      view.facing = RaidView.turnTo(view.facing, man.facing, dt);
      view.rig.root.rotation.y = view.facing;
      // Рыцарь то идёт, то стоит: клип берётся у симуляции, а не назначается
      // раз навсегда. Стоящий с клипом ходьбы шаркал бы на месте.
      if (man.walking) view.rig.play('ходьба', rateFor(PATROL_SPEED, view.rig.root.scale.y));
      else view.rig.play('покой', 1);
    }

    // Жильцы идут на тех же часах, что и гарнизон: одна локация — одно время,
    // и отладочная перемотка `setWatch` двигает всех разом.
    const folk = dwellersAt(this.garrison, this.watch);
    for (let i = 0; i < this.dwellerViews.length; i++) {
      const view = this.dwellerViews[i]!;
      const man = folk[i];
      if (man === undefined) continue;
      view.rig.update(dt);
      view.rig.root.position.set(man.x, 0, man.z);
      view.facing = RaidView.turnTo(view.facing, man.facing, dt);
      view.rig.root.rotation.y = view.facing;
      if (man.walking) view.rig.play('ходьба', rateFor(DWELLER_SPEED, view.rig.root.scale.y));
      else view.rig.play('покой');
    }

    if (this.archer === null) return;
    const watchman = archerAt(this.garrison, this.watch);
    this.archer.rig.root.visible = watchman !== null;
    if (watchman === null) return;
    this.archer.rig.update(dt);
    this.archer.rig.root.position.set(watchman.x, watchman.y, watchman.z);
    // Стрелок на стене разворачивается на месте — там, где ход поворачивает,
    // и там, где он встал лицом наружу. Сглаживание то же, что у всех.
    this.archer.facing = RaidView.turnTo(this.archer.facing, watchman.facing, dt);
    this.archer.rig.root.rotation.y = this.archer.facing;
    this.archer.rig.play(
      watchman.walking ? 'ходьба' : 'покой',
      watchman.walking ? rateFor(ARCHER_SPEED, this.archer.rig.root.scale.y) : 1,
    );
  }

  /**
   * Перевести часы гарнизона. Смена стрелка идёт минутами, и ждать её,
   * чтобы посмотреть на неё, — не проверка, а высиживание: отладочная сцена
   * (§6) отматывает часы и получает нужный кадр сразу.
   */
  setWatch(seconds: number): void {
    this.watch = seconds;
  }

  /** Разворот за кадр, а не рывком (§17.2). Тот же счёт, что у героя. */
  private static turnTo(facing: number, want: number, dt: number): number {
    let spin = want - facing;
    while (spin > Math.PI) spin -= Math.PI * 2;
    while (spin < -Math.PI) spin += Math.PI * 2;
    return facing + spin * Math.min(1, dt * 8);
  }

  /**
   * Кладбище (§6.1.7). Три слоя, и каждый ставится своим способом, потому
   * что приводятся они по-разному.
   *
   * **Ограда** — модуль: её деталь стоит на линии между клетками набора,
   * и координата у неё бывает половинной. Отсюда и смещение на полклетки:
   * ноль детали стоит в центре её клетки набора, а клетка набора покрывает
   * `FENCE_SCALE` клеток локации.
   *
   * **Могилы, склеп и гроб** — предметы: у них никакой сетки нет, они стоят
   * в клетке локации и приводятся высотой.
   *
   * **Лес и пеньки** по краю — тоже предметы, и порода у них своя, чтобы
   * кладбище не читалось той же поляной, с которой начинается игра.
   */
  private buildGraveyard(site: GraveSite): void {
    const mat = this.track(graveyardMaterial());
    const dummy = new THREE.Object3D();

    const byModel = new Map<string, { x: number; z: number; y: number; turn: number }[]>();
    const push = (model: string, x: number, z: number, y: number, turn: number): void => {
      const list = byModel.get(model) ?? [];
      list.push({ x, z, y, turn });
      byModel.set(model, list);
    };

    // Ограда: половина клетки — это половина `FENCE_SCALE` клеток локации.
    for (const piece of site.fence) {
      push(
        piece.model,
        site.at.x + piece.x * FENCE_SCALE + (FENCE_SCALE - 1) / 2,
        site.at.z + piece.z * FENCE_SCALE + (FENCE_SCALE - 1) / 2,
        0,
        piece.turn,
      );
    }
    for (const mark of site.marks) push(mark.model, mark.x, mark.z, 0, mark.turn);

    for (const [model, list] of byModel) {
      const fence = site.fence.some((p) => p.model === model);
      // Геометрия живёт в общем кэше graveyard.ts и переживает вид: её не track.
      const geo = fence
        ? fenceGeometry(model as GraveyardPartModelName)
        : graveyardGeometry(model as GraveyardPartModelName, MARK_HEIGHT[model] ?? 0.8);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const at = list[i]!;
        dummy.position.set(at.x, at.y, at.z);
        dummy.rotation.set(0, (at.turn * Math.PI) / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      this.group.add(mesh);
    }

    /**
     * Лес и пеньки ставятся тем же `standAt`, что лес поляны, — и потому
     * приводятся к высоте **единица**, а не к своей: разброс роста задаёт
     * матрица, и второй масштаб поверх неё сделал бы из ёлок башни.
     */
    const stand = (
      list: readonly { x: number; z: number }[],
      models: readonly GraveyardPartModelName[],
      tree: boolean,
    ): void => {
      const buckets: { x: number; z: number }[][] = models.map(() => []);
      for (const s of list) buckets[cellHash(s.x * 5.1, s.z * 9.3, models.length)]!.push(s);
      for (let v = 0; v < models.length; v++) {
        const bucket = buckets[v]!;
        if (bucket.length === 0) continue;
        const mesh = new THREE.InstancedMesh(graveyardGeometry(models[v]!, 1), mat, bucket.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i]!;
          mesh.setMatrixAt(i, treeStand(s.x, s.z, tree, 0));
        }
        this.group.add(mesh);
      }
    };
    stand(site.trees, GRAVE_TREES, true);
    // Пенёк — не дерево: у него свой разброс роста, вдвое ниже камня.
    stand(site.stumps, GRAVE_STUMPS, false);
  }

  /**
   * Здание на клетку. Отдельной сцены под лагерь не открывается: поляна,
   * по которой игрок ходил, и есть место, где он остался, — уводить его
   * на другую карту значило бы обесценить прогулку, которая эту карту
   * только что показала.
   *
   * Трава на клетках следа выкашивается: под зданием её быть не должно.
   *
   * `x, z` — угловая клетка следа 2×2, и меш встаёт в его середину:
   * клетка мира лежит центром в целых координатах (земля, деревья и тела
   * стоят в целых), след занимает клетки `[p, p+2)`, значит его мировая
   * середина — `p + 0.5`. Раньше меш стоял в самой угловой клетке, и здание
   * накрывало соседей слева и сверху, свободных по данным, — палатка жильца
   * садилась туда по правилам и оказывалась «под шатром».
   */
  place(id: BuildingId, x: number, z: number, level = 1): void {
    if (this.placed.has(id)) return;
    const mesh = new THREE.Mesh(this.track(buildingGeometry(id, level)), this.blocking);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(BUILDING_SCALE);
    mesh.position.set(x + 0.5, 0, z + 0.5);
    this.placed.set(id, mesh);
    this.group.add(mesh);
    // Костёр ставится горящим: огонь, который не светит, читается как макет
    // костра. Палатка света не даёт — `FireLight` знает это по модели.
    // Условие здесь, а не в свете: палатка ставится после костра только
    // в чужом порядке, но гасить чужой огонь она не должна и тогда.
    if (fireOf(id, 1) !== null) {
      this.fire.set(id, 1, x + 0.5, z + 0.5, BUILDING_SCALE);
      this.group.add(this.fire.group);
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      this.clearGrassCell(x + dx, z + dz);
    }
  }

  /**
   * Палатки жильцов (`sim/residents.ts`) на поляне.
   *
   * До этого их тут не было вовсе, и это был не выбор, а пропуск: `onTent`
   * пересобирал `campView` — площадку, которая в кадре поляны спрятана, —
   * и палатка, стоившая пяти дерева, не появлялась нигде. Игрок платил
   * по заданию §16.1, слышал стук стройки и видел ровно то же, что до него.
   *
   * Модель и масштаб — те же, что на площадке: палатка и есть Жильё, только
   * чужая, а меньше она потому, что след у неё 1×1 против 2×2 у зданий.
   * Второй мешью она сказала бы, что это другое жильё.
   *
   * Список пересобирается целиком: палаток единицы, и следить за диффом
   * дороже, чем поставить заново.
   */
  setTents(list: readonly { x: number; z: number }[]): void {
    for (const mesh of this.tents) mesh.removeFromParent();
    this.tents = list.map((t) => {
      const mesh = new THREE.Mesh(this.track(buildingGeometry('hq', 1)), this.blocking);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.setScalar(BUILDING_SCALE * TENT_LOOK);
      // След палатки 1×1 — клетка `t`, а клетка мира лежит центром в целых
      // координатах: жилец, спящий в клетке палатки, стоит ровно в `t`,
      // и меш обязан стоять там же, а не на пол клетки наискось.
      mesh.position.set(t.x, 0, t.z);
      this.group.add(mesh);
      this.clearGrassCell(t.x, t.z);
      return mesh;
    });
  }

  /**
   * Здание выросло на уровень. Геометрия пересобирается той же функцией,
   * что и в лагере: стадия роста — свойство модели, а не сцены (§6.1).
   *
   * На уровнях 1–2 стадия одна и та же (`stageOf`), и палатка ур. 2 выглядит
   * как палатка ур. 1. Это не забытая модель, а решение §6.1 «стадий меньше,
   * чем уровней»: подделывать рост масштабом здесь было бы враньём.
   */
  setLevel(id: BuildingId, level: number): void {
    const mesh = this.placed.get(id);
    if (mesh === undefined) return;
    mesh.geometry = this.track(buildingGeometry(id, level));
    // Огонь переезжает вместе со стадией: у кухни он на разных стадиях
    // стоит в разных местах, а на каменной уходит под трубу.
    if (fireOf(id, level) !== null) {
      this.fire.set(id, level, mesh.position.x, mesh.position.z, BUILDING_SCALE);
    }
  }

  /**
   * Место под здание: пятно на земле и полупрозрачный силуэт над ним.
   * Зелёное — можно, красное — нельзя. Силуэт нужен затем, что пятно
   * показывает след, а вопрос у игрока другой — «что тут встанет».
   *
   * `x, z` — угловая клетка следа 2×2, как у `place`: пятно накрывает след
   * целиком, а не одну клетку, — именно эти четыре клетки станут занятыми
   * в лагере (`campBlocked`, маска рутины), и врать меньшим пятном значило
   * бы показывать след 1×1, которого в данных нет.
   */
  showSite(id: BuildingId, x: number, z: number, ok: boolean): void {
    if (this.site === null) {
      this.site = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(1.94, 1.94)),
        this.track(
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, fog: false }),
        ),
      );
      this.site.rotation.x = -Math.PI / 2;
      this.group.add(this.site);
    }
    if (this.ghost === null || this.ghost.userData['id'] !== id) {
      this.ghost?.removeFromParent();
      this.ghost = new THREE.Mesh(
        this.track(buildingGeometry(id, 1)),
        this.track(
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, fog: false }),
        ),
      );
      this.ghost.userData['id'] = id;
      this.ghost.scale.setScalar(BUILDING_SCALE);
      this.group.add(this.ghost);
    }
    const color = ok ? PALETTE.siteOk : PALETTE.siteNo;
    (this.site.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.site.visible = true;
    this.ghost.visible = true;
    this.site.position.set(x + 0.5, 0.05, z + 0.5);
    this.ghost.position.set(x + 0.5, 0, z + 0.5);
  }

  hideSite(): void {
    if (this.site !== null) this.site.visible = false;
    if (this.ghost !== null) this.ghost.visible = false;
  }

  private buildEvac(at: Cell): void {
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({ color: PALETTE.evac, transparent: true, opacity: 0.7, fog: false }),
    );
    const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(1.2, 0.08, 8, 36)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.06, at.z);
    this.evacRings.push(ring);

    // Луч виден сквозь туман (fog: false) — точка выхода обязана читаться
    // с любой глубины, иначе решение «назад» принимается вслепую.
    const beam = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.5, 1.15, 26, 16, 1, true)),
      this.track(
        new THREE.MeshBasicMaterial({
          color: PALETTE.evac,
          transparent: true,
          opacity: 0.085,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      ),
    );
    beam.position.set(at.x, 13, at.z);
    this.group.add(ring, beam);
  }

  /**
   * Контейнеры — добыча набора KayKit Resource Bits (§6.1.5). Что лежит внутри,
   * видно до вскрытия: камень — серые обломки, дерево — бревно, железо — штабель
   * слитков. Вид выпадает по ярусу при генерации (§13), поэтому показать его —
   * значит показать уже решённое, а не подсказать будущее.
   *
   * Кристалла в наборе нет — самоцветы автор оставил платному тарифу, — и у него
   * остаётся октаэдр, которым до этого рисовались все четыре. Заглушкой он при
   * этом быть перестал: кристалл и есть октаэдр.
   *
   * Геометрия и материал общие на вид, а не на контейнер: на ярусе 3 их пять,
   * и пять одинаковых материалов — это пять лишних состояний GPU.
   */
  private buildContainers(): void {
    const gem = this.track(new THREE.OctahedronGeometry(0.26, 0));
    const gemMat = this.track(
      // Без emissive: светящаяся добыча видна за пределами круга света и
      // обесценивает обзор из §11.4. Подсветку жилы даёт карта «Чутьё на жилу».
      new THREE.MeshLambertMaterial({ color: PALETTE.loot, flatShading: true }),
    );
    const baked = this.track(resourceMaterial());
    for (const c of this.loc.containers) {
      const name = RESOURCE_MODEL[c.kind];
      const mesh = name === null
        ? new THREE.Mesh(gem, gemMat)
        : new THREE.Mesh(this.track(resourceGeometry(name, CONTAINER_HEIGHT)), baked);
      mesh.castShadow = true;
      // Добыча лежит на земле, как лежала бы брошенная: парящая и крутящаяся
      // читается игровой пиктограммой, а обломки, бревно и слитки — часть
      // места. Поворот — детерминированный по id, чтобы кучки не легли
      // по линейке. Кристалл — центрированный октаэдр без основания:
      // приподнят и чуть утоплен остриём в землю, стоит, а не парит.
      mesh.position.set(c.x, name === null ? 0.2 : 0, c.z);
      mesh.rotation.y = tileNoise(c.id, c.id * 7 + 3) * Math.PI * 2;
      this.group.add(mesh);
      this.containerMeshes.set(c.id, mesh);
    }
  }

  /**
   * Валуны (§13.4) — те же камни набора, из которых сложена стена вылазки
   * (§6.1.1), но ростом по колено. Это решение, а не экономия на моделях:
   * камень на полу обязан читаться как отколовшийся от стены, а не как
   * предмет чужого происхождения. У замка и в лагере стены из камня нет,
   * и там та же порода говорит другое — из этого стену и сложили.
   *
   * Меш на валун, а не общий буфер: их единицы, зато каждый дрожит от удара
   * и исчезает поодиночке, а искать экземпляр в общем буфере пришлось бы
   * на каждом замахе.
   */
  private buildStones(): void {
    if (this.loc.stones.length === 0) return;
    const mat = this.track(forestMaterial());
    for (const stone of this.loc.stones) {
      if (stone.taken) continue;
      // Порода и разворот выведены из координаты — тот же приём, что у стены:
      // локация обязана совпадать сама с собой между заходами.
      const t = ((Math.sin(stone.x * 3.1 + stone.z * 7.7) * 1000) % 1 + 1) % 1;
      const model = RAID_ROCKS[Math.floor(t * RAID_ROCKS.length) % RAID_ROCKS.length]!;
      const mesh = new THREE.Mesh(
        // Геометрия живёт в общем кэше forest.ts и переживает вид: её не track.
        treeGeometry({ set: 'forest', model }, STONE_HEIGHT * (0.85 + t * 0.4)),
        mat,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(stone.x + (t - 0.5) * 0.2, -0.04, stone.z + (t - 0.5) * 0.16);
      mesh.rotation.y = t * 6.28;
      this.group.add(mesh);
      this.stoneMeshes.set(stone.id, mesh);
    }
  }

  /**
   * Замах пришёлся в валун: камень вздрагивает. Как и у дерева, это
   * единственное, чем рендер отвечает на удар до конца работы, — без дрожи
   * десять замахов читаются как зависание.
   */
  hitStone(id: number): void {
    this.heroRig?.replay();
    if (this.stoneMeshes.has(id)) this.stoneHits.set(id, 0);
  }

  /** Валун разбит: камень уходит из кадра совсем. */
  takeStone(id: number): void {
    const mesh = this.stoneMeshes.get(id);
    if (mesh === undefined) return;
    mesh.removeFromParent();
    this.stoneMeshes.delete(id);
    this.stoneHits.delete(id);
  }

  /** Дрожь валуна — кадрами, как и у дерева. */
  private syncStones(dt: number): void {
    for (const [id, t] of [...this.stoneHits]) {
      const mesh = this.stoneMeshes.get(id);
      if (mesh === undefined) {
        this.stoneHits.delete(id);
        continue;
      }
      const next = t + dt;
      if (next >= SHAKE_SECONDS) {
        this.stoneHits.delete(id);
        mesh.position.y = -0.04;
        continue;
      }
      this.stoneHits.set(id, next);
      // Камень не кивает, как крона, а оседает: удар идёт вниз, а не вбок.
      mesh.position.y = -0.04 - Math.sin((next / SHAKE_SECONDS) * Math.PI) * 0.06;
    }
  }

  /**
   * Противники — три скелета набора KayKit Skeletons (§6.1.3, каталог —
   * `enemyart.html`). Различаются силуэтом раньше, чем цветом: за пределами
   * фонаря цвет пропадает первым, и разводят их снаряжение и рост,
   * а не оттенок кости.
   *
   * Геометрия и материалы общие на вид, а не на особь: на ярусе 3 их девять,
   * и девять одинаковых материалов — это девять лишних состояний GPU. Для
   * набора это уже не мелочь: одна модель — пять тысяч треугольников.
   */
  private buildEnemies(): void {
    const hots = new Map<EnemyKind, THREE.MeshLambertMaterial>();
    // §17.3: замах обязан быть виден заранее. Клип замаха его и показывает,
    // но на пяти сантиметрах экрана одного движения мало — эмиссия остаётся.
    const hotOf = (kind: EnemyKind): THREE.MeshLambertMaterial => {
      const found = hots.get(kind);
      if (found !== undefined) return found;
      const made = this.track(
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          emissive: PALETTE.telegraph,
          emissiveIntensity: 1.2,
        }),
      );
      hots.set(kind, made);
      return made;
    };

    for (const e of this.loc.enemies) {
      // Геометрия и материал общие на вид, скелет — свой: пятеро с одним
      // скелетом махали бы одновременно.
      const rig = e.kind === 'ghost'
        ? new Drifting(enemyGeometry('ghost'), this.blocking, ENEMY_HEIGHT.ghost)
        : new Rigged(enemyParts(e.kind), this.blocking);
      rig.root.position.set(e.x, 0, e.z);
      this.group.add(rig.root);

      const { root: lifeRoot, fill } = this.buildLifeBar(ENEMY_STATS[e.kind].hp);
      rig.root.add(lifeRoot);

      this.enemyViews.set(e.id, {
        rig,
        base: this.blocking,
        hot: hotOf(e.kind),
        life: fill,
        lifeRoot,
        facing: 0,
        hp: e.hp,
        flash: 0,
        busy: false,
      });
    }
  }

  /**
   * Полоска жизни противника. У героя здоровье остаётся ранами без полоски
   * (§11.3) — это про него и сказано; противник же раньше показывал состояние
   * масштабом меша, а сжимающийся скелет читается как «сдувается», а не
   * как «ранен».
   *
   * Спрайты, а не плоскости: камера поворачивается, и полоску пришлось бы
   * доворачивать руками каждый кадр.
   */
  private buildLifeBar(wounds: number): { root: THREE.Object3D; fill: THREE.Sprite } {
    const root = new THREE.Object3D();
    // Ширина от числа ран: у мага их пять, и полоска обязана это показывать
    // без цифр — иначе «много ран» ничем не отличается от «одна».
    const width = 0.5 + 0.12 * (wounds - 1);

    const back = new THREE.Sprite(
      this.track(new THREE.SpriteMaterial({ color: PALETTE.backdrop, depthTest: false })),
    );
    back.scale.set(width + 0.06, 0.14, 1);
    back.renderOrder = 2;

    const fill = new THREE.Sprite(
      this.track(new THREE.SpriteMaterial({ color: PALETTE.siteOk, depthTest: false })),
    );
    fill.center.set(0, 0.5);
    fill.position.x = -width / 2;
    fill.scale.set(width, 0.08, 1);
    fill.renderOrder = 3;
    fill.userData.width = width;

    root.add(back, fill);
    root.visible = false;
    return { root, fill };
  }

  /**
   * Герой — модель своего класса (артбук, 04). Фонарь остаётся отдельным
   * мешем без тумана: он источник света в кадре, а не деталь силуэта.
   */
  private buildHero(): void {
    this.hero = new THREE.Group();
    // Герой стоит на том же риге, что противники (§6.1.4), и клипы у них общие.
    // Классу без модели набора достаётся неподвижный примитив — у него скелета
    // нет, и выдумывать его нечем.
    const parts = heroParts(this.heroClass, this.weapon);
    let body: THREE.Object3D;
    if (parts === null) {
      const mesh = new THREE.Mesh(this.track(heroGeometry(this.heroClass, this.weapon)), this.blocking);
      mesh.castShadow = true;
      body = mesh;
    } else {
      this.heroRig = new Rigged(parts, this.blocking);
      body = this.heroRig.root;
    }
    const lantern = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.08, 8, 6)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffcf90, fog: false })),
    );
    lantern.position.set(0.28, 0.7, 0.1);
    this.hero.add(body, lantern);
    this.group.add(this.hero);

    // Остальные — те же модели своих классов, но без фонаря: свет в кадре
    // один, и три источника читались бы как три костра.
    for (const cls of this.mateClasses) {
      const parts = heroParts(cls, this.weapon);
      const mate = new THREE.Group();
      if (parts === null) {
        const mesh = new THREE.Mesh(this.track(heroGeometry(cls, this.weapon)), this.blocking);
        mesh.castShadow = true;
        mate.add(mesh);
      } else {
        const rig = new Rigged(parts, this.blocking);
        this.mateRigs.push(rig);
        mate.add(rig.root);
      }
      mate.visible = false;
      this.mates.push(mate);
      this.group.add(mate);
    }

    // Точки построения. Инстансинг: их столько же, сколько бойцов, и заводить
    // меш на каждую значило бы платить вызовом отрисовки за точку.
    const marks = new THREE.InstancedMesh(
      this.track(new THREE.CircleGeometry(0.18, 16)),
      this.track(new THREE.MeshBasicMaterial({
        color: PALETTE.siteOk, transparent: true, opacity: 0.5, fog: false, depthTest: false,
      })),
      8,
    );
    marks.renderOrder = 3;
    marks.count = 0;
    this.marks = marks;
    this.group.add(marks);
  }

  private buildMarker(): void {
    this.marker = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.26, 0.36, 20)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, fog: false })),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.07;
    this.marker.visible = false;
    this.group.add(this.marker);
    this.group.add(this.hexGrid.group);
  }

  private buildHintRing(): void {
    this.hintRing = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.3, 0.46, 24)),
      this.track(
        new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.9, fog: false }),
      ),
    );
    this.hintRing.rotation.x = -Math.PI / 2;
    this.hintRing.visible = false;
    this.group.add(this.hintRing);
  }

  /**
   * §11.7 — остальные бойцы и точки, куда они встанут.
   *
   * Место точки берётся у симуляции (`followSpots`), а не рисуется рядом
   * с ведущим: точка, обещающая одно, пока боец встаёт в другое, хуже
   * отсутствующей — игрок перестаёт ей верить и считает клетки сам.
   */
  private syncParty(state: RaidState, alpha: number, dt: number): void {
    const spots = followSpots(state);

    for (let i = 0; i < this.mates.length; i++) {
      const mate = this.mates[i]!;
      // Ведущий рисуется отдельно, поэтому остальные идут со сдвигом.
      const f = state.party[i + 1];
      if (f === undefined || f.hp <= 0) {
        mate.visible = false;
        continue;
      }
      mate.visible = true;
      // §11.3 — в бою положение ведёт показ: тело идёт по протоколу,
      // а не к решённому симуляцией гексу.
      const shown = this.battlePosNow.get(-1 - f.id);
      const x = shown === undefined ? lerp(f.prevX, f.x, alpha) : lerp(mate.position.x, shown.x, Math.min(1, dt * 12));
      const z = shown === undefined ? lerp(f.prevZ, f.z, alpha) : lerp(mate.position.z, shown.z, Math.min(1, dt * 12));
      mate.position.set(x, 0, z);

      // Разворот тот же, что у ведущего (§17.2): за кадр, а не мгновенно.
      const face = shown === undefined ? f.facing : this.battleFacing.get(-1 - f.id) ?? f.facing;
      let turn = face - mate.rotation.y;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      mate.rotation.y += turn * Math.min(1, dt * 8);

      const rig = this.mateRigs[i];
      if (rig !== undefined) {
        rig.update(dt);
        // В бою клипами распоряжается показ; вне боя — ходьба как раньше.
        if (shown === undefined) {
          const walking = Math.hypot(f.x - f.prevX, f.z - f.prevZ) > 1e-4;
          if (walking) rig.play('ходьба', rateFor(HERO_SPEED, rig.root.scale.y));
          else rig.play('покой');
        }
      }
    }

    // Точки показываются только на ходу и только тем, кто ещё идёт: стоящий
    // отряд в разметке не нуждается, и точка под ногами читается как мусор.
    const marks = this.marks;
    if (marks === null) return;
    const moving = state.path.length > 0 && state.battle === null;
    let n = 0;
    if (moving) {
      // Поворот кладётся в матрицу инстанса, а не на сам меш: у повёрнутой
      // сетки сдвиг инстанса считался бы в её местных осях, и точки уехали бы
      // вверх вместо пола.
      const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      const m = new THREE.Matrix4();
      for (let i = 0; i < state.party.length && n < 8; i++) {
        const f = state.party[i]!;
        if (f.hp <= 0) continue;
        const to = spots[i]!;
        if (Math.hypot(to.x - f.x, to.z - f.z) < 0.05) continue;
        m.makeTranslation(to.x, 0.06, to.z).multiply(flat);
        marks.setMatrixAt(n++, m);
      }
      marks.instanceMatrix.needsUpdate = true;
    }
    marks.count = n;
  }

  /**
   * §11.3 — идёт ли показ боя: очередь протокола ещё не дочитана. Пока идёт,
   * панель боя молчит и тапы по полю не принимаются — игрок не должен ходить
   * в бой, которого ещё не увидел.
   */
  battleBusy(): boolean {
    return this.playNow !== null || this.battlePlays.length > 0;
  }

  /** Кого сейчас показывают: камера ведёт ходящего на экране, а не того,
   *  до кого симуляция уже досчитала очередь. Вне показа — null. */
  battleFocus(): { x: number; z: number } | null {
    const now = this.playNow;
    if (now === null) return null;
    return this.battlePosNow.get(now.play.unit) ?? null;
  }

  /** Тело бойца на поле по его номеру. Отрицательные — свои (§11.7). */
  private battleRigOf(
    state: RaidState,
    id: number,
  ): { rig: Rigged | Drifting | null; enemy?: EnemyView } | null {
    if (id >= 0) {
      const view = this.enemyViews.get(id);
      return view === undefined ? null : { rig: view.rig, enemy: view };
    }
    const f = state.party.find((p) => -1 - p.id === id);
    if (f === undefined) return null;
    if (f === state.hero) return { rig: this.heroRig };
    const rig = this.mateRigs[state.party.indexOf(f) - 1];
    return { rig: rig ?? null };
  }

  /** Начать ход показа: клип, разворот и длительность — по виду хода. */
  private beginPlay(state: RaidState, play: BattlePlay): PlayNow {
    const rig = this.battleRigOf(state, play.unit)?.rig ?? null;
    const scale = rig === null ? 1 : rig.root.scale.y;

    if (play.kind === 'move') {
      const points = play.path.map((h) => hexToWorld(h));
      const dur = Math.max(PLAY_HEX_SECONDS, (points.length - 1) * PLAY_HEX_SECONDS);
      // Темп клипа — под темп показа, а не под скорость мира: фигура идёт
      // гекс за PLAY_HEX_SECONDS, и ноги обязаны успевать за ней.
      rig?.play('ходьба', rateFor(1 / PLAY_HEX_SECONDS, scale));
      return { play, t: 0, dur, impact: 0, landed: true, points };
    }

    if (play.kind === 'strike') {
      const steps = Math.hypot(
        hexToWorld(play.at).x - hexToWorld(play.from).x,
        hexToWorld(play.at).z - hexToWorld(play.from).z,
      );
      const impact = play.ranged
        ? PLAY_RELEASE_SECONDS + Math.max(0.08, steps * PLAY_FLIGHT_PER_HEX)
        : PLAY_IMPACT_SECONDS;
      // Разворот к цели — до замаха: удар в спину без поворота читается
      // как сбой, а не как приём.
      const from = hexToWorld(play.from);
      const to = hexToWorld(play.at);
      this.battleFacing.set(play.unit, Math.atan2(to.x - from.x, to.z - from.z));
      if (rig !== null) {
        // Замах растягивается так, чтобы попадание клипа совпало с моментом
        // попадания показа, — тот же приём, что у телеграфа (§17.3).
        rig.play(play.ranged ? 'выстрел' : 'удар', play.ranged ? 1 : STRIKE / PLAY_IMPACT_SECONDS);
        rig.replay();
      }
      return { play, t: 0, dur: impact + PLAY_RECOVER_SECONDS, impact, landed: false, points: null };
    }

    // Блок: короткая пауза на жест, позу дальше держит сам клип (`hold`).
    if (rig !== null) {
      rig.play('блок');
      rig.replay();
    }
    return { play, t: 0, dur: PLAY_GUARD_SECONDS, impact: 0, landed: true, points: null };
  }

  /** Попадание дошло до экрана: реакция цели, вспышка, полоска, падение. */
  private landStrike(state: RaidState, play: BattlePlay & { kind: 'strike' }): void {
    this.shownHp.set(play.target, play.hpAfter);
    const body = this.battleRigOf(state, play.target);
    if (body === null) return;

    if (play.dodged) {
      // Уворот (§11.3): удар прошёл мимо — ни вспышки, ни раны, ни отдачи
      // по линии удара. Цель коротко смещается вбок и возвращается: уход
      // с линии виден телом, а не подписью.
      const from = hexToWorld(play.from);
      const at = hexToWorld(play.at);
      const d = Math.hypot(at.x - from.x, at.z - from.z) || 1;
      this.bumps.set(play.target, {
        dx: (at.z - from.z) / d,
        dz: -(at.x - from.x) / d,
        left: PLAY_BUMP_SECONDS,
      });
      return;
    }

    if (body.enemy !== undefined) {
      body.enemy.flash = FLASH_SECONDS;
      body.enemy.hp = play.hpAfter;
    } else {
      this.heroFlash = FLASH_SECONDS;
      // Рана своего отдаёт в кадр: тряску дёргает показ, а не тик симуляции.
      this.onHeroHit?.();
    }

    const rig = body.rig;
    if (play.killed) {
      this.shownDead.add(play.target);
      if (rig !== null && rig.state !== 'падение') rig.play('падение', FALL_RATE);
      if (body.enemy !== undefined) body.enemy.lifeRoot.visible = false;
      return;
    }
    if (play.blocked) {
      // Держит: поза блока уже стоит, жест повторяется — удар принят щитом.
      if (rig !== null && rig.state === 'блок') rig.replay();
    } else if (rig !== null) {
      if (rig.state === 'урон') rig.replay();
      else rig.play('урон');
    }
    // Отдача: цель сдвигается от удара и возвращается на место.
    const from = hexToWorld(play.from);
    const at = hexToWorld(play.at);
    const d = Math.hypot(at.x - from.x, at.z - from.z) || 1;
    this.bumps.set(play.target, {
      dx: (at.x - from.x) / d,
      dz: (at.z - from.z) / d,
      left: PLAY_BUMP_SECONDS,
    });
  }

  /** Ход показа кончился: фигура доходит до места, следующий — из очереди. */
  private finishPlay(now: PlayNow): void {
    if (now.play.kind === 'move') {
      const last = now.play.path[now.play.path.length - 1];
      if (last !== undefined) this.restHex.set(now.play.unit, last);
    }
  }

  /** Стоящий в бою: покой или держимый блок. Ходящих ведёт `beginPlay`. */
  private battleIdle(rig: Rigged | Drifting, guarding: boolean): void {
    const st = rig.state;
    if (st === 'падение') return;
    if (guarding) {
      if (st !== 'блок') rig.play('блок');
      return;
    }
    if (st !== 'покой' && (st === 'ходьба' || st === 'блок' || rig.finished)) rig.play('покой');
  }

  /** Стрела (или снаряд мага) в полёте — от выпуска до попадания. */
  private syncArrow(): void {
    const now = this.playNow;
    const flying =
      now !== null
      && now.play.kind === 'strike'
      && now.play.ranged
      && !now.landed
      && now.t >= PLAY_RELEASE_SECONDS;
    if (!flying) {
      if (this.arrowMesh !== null) this.arrowMesh.visible = false;
      return;
    }
    const play = now.play as BattlePlay & { kind: 'strike' };
    if (this.arrowMesh === null) {
      const geo = new THREE.BoxGeometry(0.05, 0.05, 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8dfc0, fog: false });
      this.arrowMesh = new THREE.Mesh(geo, mat);
      this.disposables.push(geo, mat);
      this.group.add(this.arrowMesh);
    }
    const from = hexToWorld(play.from);
    const to = hexToWorld(play.at);
    const f = Math.min(1, (now.t - PLAY_RELEASE_SECONDS) / Math.max(1e-3, now.impact - PLAY_RELEASE_SECONDS));
    this.arrowMesh.visible = true;
    this.arrowMesh.position.set(lerp(from.x, to.x, f), 0.95, lerp(from.z, to.z, f));
    this.arrowMesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    // Стрела своя — светлая, снаряд противника — цвета замаха: красное
    // в игре значит «удар» (§17.3), и летящее в героя оно значит то же.
    (this.arrowMesh.material as THREE.MeshBasicMaterial).color.setHex(
      play.unit >= 0 ? PALETTE.telegraph : 0xe8dfc0,
    );
  }

  /**
   * Показ боя (§11.3). Вычитывает протокол (`RaidState.plays`) и проигрывает
   * его ход за ходом: разворот, шаг по гексам, замах, попадание, падение.
   * Симуляция уже всё решила — здесь решается только, когда это увидят.
   *
   * Протокол переживает поле: смертельный удар закрывает бой тем же тиком,
   * и его падение доигрывается уже при `battle === null`.
   */
  private stepBattlePlays(state: RaidState, dt: number): void {
    const battle = state.battle;
    if (state.plays.length > 0) this.battlePlays.push(...state.plays.splice(0));

    const active = battle !== null || this.battleBusy();
    if (!active) {
      if (this.battleWas) {
        // Развязка дочитана: мир снова источник правды о положении.
        this.restHex.clear();
        this.shownHp.clear();
        this.shownDead.clear();
        this.battleFacing.clear();
        this.bumps.clear();
        this.battlePosNow.clear();
        this.heroUnitId = null;
        if (this.arrowMesh !== null) this.arrowMesh.visible = false;
        this.battleWas = false;
      }
      return;
    }

    if (!this.battleWas && battle !== null) {
      // Завязка: фигуры встают там, где их застал контакт. Стойки берутся
      // из протокола, если ходы успели решиться тем же тиком, что открыл бой.
      this.restHex.clear();
      this.shownHp.clear();
      this.shownDead.clear();
      this.battleFacing.clear();
      for (const u of battle.units) {
        this.restHex.set(u.id, u.hex);
        this.shownHp.set(u.id, u.hp);
        if (u.side === 'hero' && this.heroUnitId === null) this.heroUnitId = u.id;
        if (u.hp <= 0) this.shownDead.add(u.id);
      }
      const seen = new Set<number>();
      for (const p of this.battlePlays) {
        if (seen.has(p.unit)) continue;
        seen.add(p.unit);
        if (p.kind === 'move' && p.path[0] !== undefined) this.restHex.set(p.unit, p.path[0]);
        else if (p.kind === 'strike') this.restHex.set(p.unit, p.from);
      }
      this.battleWas = true;
    }

    // Очередной ход — как только прошлый дочитан.
    if (this.playNow === null && this.battlePlays.length > 0) {
      this.playNow = this.beginPlay(state, this.battlePlays.shift()!);
    }
    const now = this.playNow;
    if (now !== null) {
      now.t += dt;
      if (now.play.kind === 'strike' && !now.landed && now.t >= now.impact) {
        now.landed = true;
        this.landStrike(state, now.play);
      }
      if (now.t >= now.dur) {
        this.finishPlay(now);
        this.playNow = null;
      }
    }

    for (const [id, b] of this.bumps) {
      b.left -= dt;
      if (b.left <= 0) this.bumps.delete(id);
    }

    // Позиции по показу: стойка, шаг по пути, выпад атакующего, отдача цели.
    this.battlePosNow.clear();
    for (const [id, hex] of this.restHex) {
      const p = hexToWorld(hex);
      let x = p.x;
      let z = p.z;
      const cur = this.playNow;
      if (cur !== null && cur.play.unit === id) {
        if (cur.play.kind === 'move' && cur.points !== null && cur.points.length > 1) {
          const s = Math.min(1, cur.t / cur.dur) * (cur.points.length - 1);
          const i = Math.min(cur.points.length - 2, Math.floor(s));
          const f = s - i;
          const a = cur.points[i]!;
          const b = cur.points[i + 1]!;
          x = lerp(a.x, b.x, f);
          z = lerp(a.z, b.z, f);
          this.battleFacing.set(id, Math.atan2(b.x - a.x, b.z - a.z));
        } else if (cur.play.kind === 'strike' && !cur.play.ranged) {
          // Выпад: к цели до попадания, назад после. Позиция, а не клип, —
          // клип удара про руки, выпад про то, кого именно бьют.
          const from = hexToWorld(cur.play.from);
          const to = hexToWorld(cur.play.at);
          const d = Math.hypot(to.x - from.x, to.z - from.z) || 1;
          const phase = cur.t < cur.impact
            ? cur.t / cur.impact
            : Math.max(0, 1 - (cur.t - cur.impact) / Math.max(1e-3, cur.dur - cur.impact));
          x += ((to.x - from.x) / d) * PLAY_LUNGE * phase;
          z += ((to.z - from.z) / d) * PLAY_LUNGE * phase;
        }
      }
      const bump = this.bumps.get(id);
      if (bump !== undefined) {
        const k = (bump.left / PLAY_BUMP_SECONDS) * PLAY_BUMP;
        x += bump.dx * k;
        z += bump.dz * k;
      }
      this.battlePosNow.set(id, { x, z });
    }

    this.syncArrow();

    // Клипы стоящих: у кого нет активного хода — покой или держимый блок.
    if (battle !== null) {
      for (const u of battle.units) {
        if (this.shownDead.has(u.id)) continue;
        if (this.playNow !== null && this.playNow.play.unit === u.id) continue;
        const rig = this.battleRigOf(state, u.id)?.rig;
        if (rig != null) this.battleIdle(rig, u.guarding);
      }
    } else {
      for (const id of this.restHex.keys()) {
        if (this.shownDead.has(id)) continue;
        if (this.playNow !== null && this.playNow.play.unit === id) continue;
        const rig = this.battleRigOf(state, id)?.rig;
        if (rig != null) this.battleIdle(rig, false);
      }
    }
  }

  /**
   * §11.3 — что показывает сетка. Роли считает поле боя теми же правилами,
   * которыми потом применит ход: рендер не вправе показать досягаемость,
   * отличную от настоящей, — иначе подсветка врёт, а игрок винит себя.
   */
  private syncGrid(state: RaidState): void {
    const battle = state.battle;
    if (battle === null) {
      this.hexGrid.hide();
      return;
    }
    const unit = current(battle);
    if (unit === undefined) {
      this.hexGrid.hide();
      return;
    }
    // Пока показ дочитывает чужие ходы, сетка отмечает того, кто ходит
    // на экране: подсвечивать возможности героя раньше, чем он увидел бой,
    // значит звать его ходить вслепую.
    if (this.battleBusy()) {
      const acting = this.playNow?.play.unit;
      const at = acting === undefined ? undefined : this.restHex.get(acting);
      this.hexGrid.show({ move: [], stand: at === undefined ? [] : [at], target: [], hover: [] });
      return;
    }
    // Сетка показывается только на ходу героя. На чужом ходу она молчит:
    // подсвечивать чужие возможности — значит просить игрока читать то,
    // на что он всё равно не влияет.
    if (unit.side !== 'hero') {
      this.hexGrid.show({ move: [], stand: [unit.hex], target: [], hover: [] });
      return;
    }
    const { size, blocked } = this.loc;
    const move: Hex[] = [...moves(battle, size, blocked, unit).values()].map((s) => s.hex);
    const target: Hex[] = targets(battle, size, blocked, unit).map((u) => u.hex);
    // Наведение показывается только там, куда можно: подсвеченный гекс,
    // на который нельзя шагнуть, обещает ход, которого не будет.
    const key = this.hoverHex === null ? null : `${this.hoverHex.q},${this.hoverHex.r}`;
    const onTarget = target.some((h) => `${h.q},${h.r}` === key);
    const canGo = move.some((h) => `${h.q},${h.r}` === key);
    const hover = this.hoverHex !== null && (canGo || onTarget) ? [this.hoverHex] : [];
    this.hexGrid.show({ move, stand: [unit.hex], target, hover });
  }

  /**
   * Куда ведёт палец. Рендер только запоминает: что с этим делать, решает
   * сетка, а можно ли туда — поле боя.
   */
  setHover(x: number, z: number): void {
    this.hoverHex = worldToHex(x, z);
  }

  clearHover(): void {
    this.hoverHex = null;
  }

  /** Подсветить клетку. Кольцо пульсирует, пока кадр не сменится: статичное
   *  пятно на полу читается как декорация, а не как приглашение. */
  showHint(x: number, z: number): void {
    this.hintRing.visible = true;
    this.hintRing.position.set(x, 0.08, z);
  }

  hideHint(): void {
    this.hintRing.visible = false;
  }

  showMarker(x: number, z: number): void {
    this.marker.visible = true;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.marker.position.set(x, 0.07, z);
  }

  /** alpha — доля между прошлым и текущим тиком симуляции (см. core/loop). */
  sync(state: RaidState, alpha: number, dt: number, time: number, day = 0): void {
    // Костёр мерцает и в прологе, и в вылазке: день приходит числом, потому
    // что поляна — это поверхность, а вылазка — ночь под землёй.
    this.fire.update(time, day);
    // Фонари замка живут тем же днём: гаснут к полудню, горят к ночи.
    if (this.lampGlow !== null) setLampsNight(1 - day, this.lampGlow, this.lampLights);
    if (this.hintRing.visible) {
      const pulse = 1 + Math.sin(time / 260) * 0.16;
      this.hintRing.scale.setScalar(pulse);
      (this.hintRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + (pulse - 1) * 1.6;
    }
    const { hero } = state;
    // §11.3 — в бою положение живёт у показа, а не в мире: симуляция уже
    // решила ходы, и тела идут по протоколу (`stepBattlePlays`), ход за ходом.
    this.stepBattlePlays(state, dt);
    const heroShown = this.heroUnitId === null ? undefined : this.battlePosNow.get(this.heroUnitId);
    const hx = heroShown === undefined
      ? lerp(hero.prevX, hero.x, alpha)
      : lerp(this.hero.position.x, heroShown.x, Math.min(1, dt * 12));
    const hz = heroShown === undefined
      ? lerp(hero.prevZ, hero.z, alpha)
      : lerp(this.hero.position.z, heroShown.z, Math.min(1, dt * 12));
    if (!this.heroParked) this.hero.position.set(hx, 0, hz);

    this.syncGrid(state);
    this.syncParty(state, alpha, dt);

    const heroFace = this.heroUnitId === null
      ? hero.facing
      : this.battleFacing.get(this.heroUnitId) ?? hero.facing;
    let turn = heroFace - this.hero.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    // §17.2: разворот не мгновенный, 120–150 мс — иначе читается как рывок.
    if (!this.heroParked) this.hero.rotation.y += turn * Math.min(1, dt * 8);
    // Герой на риге ходит клипом, примитивный — прежним покачиванием: у него
    // ног нет, и качать его — единственное, чем ход отличается от стойки.
    const heroWalking = state.path.length > 0;
    if (this.heroParked) {
      // Стоит и ждёт: симуляция в это время водит жильца, не его.
      this.heroRig?.update(dt);
      this.heroRig?.play('покой');
    } else if (this.heroRig === null) {
      this.hero.children[0]!.position.y = 0.6 + (heroWalking ? Math.sin(time / 90) * 0.04 : 0);
    } else if (this.battleWas) {
      // §11.3 — в бою клипы героя ведёт показ (`stepBattlePlays`): замах,
      // урон и падение приходят протоколом в момент показа, а не тиком
      // симуляции, которая уже решила весь раунд. Здесь остаются вспышка
      // и книга прошлого кадра — чтобы выход из боя не сыграл рану заново.
      this.heroRig.update(dt);
      this.heroWas = { wounds: state.hero.hp, cooldown: state.hero.cooldown };
      if (this.heroFlash > 0) {
        this.heroFlash = Math.max(0, this.heroFlash - dt);
        this.heroRig.setMaterial(this.heroFlash > 0 ? this.hurtFlash : this.blocking);
      }
    } else {
      this.heroRig.update(dt);

      // Бой событий не рассылает, и рендер вычитает их из состояния — тем же
      // приёмом, что и звук (§18.3). Удар ловится скачком отката вверх: вниз
      // он тикает сам, вверх прыгает ровно в момент удара.
      const struck = state.hero.cooldown > this.heroWas.cooldown + 0.01;
      const hurt = state.hero.hp < this.heroWas.wounds;

      // §17.1 — урон не клип, а вспышка 150 мс поверх текущего. У героя раны
      // считаны штуками (§11.3), и каждая обязана быть замечена.
      if (hurt) this.heroFlash = FLASH_SECONDS;

      if (this.heroBusy && this.heroRig.finished) this.heroBusy = false;

      if (state.status === 'failed') {
        // Падение держится до конца кадра: смерть — единственное состояние,
        // из которого не выходят.
        if (this.heroRig.state !== 'падение') this.heroRig.play('падение', FALL_RATE);
      } else if (struck && !this.working) {
        // Удар растягивается так, чтобы уложиться в §17.6: 600 мс при
        // интервале 1,2 с. Иначе два удара подряд накладываются друг на друга.
        this.heroRig.play('удар', STRIKE / HERO_SWING_SECONDS);
        this.heroRig.replay();
        this.heroBusy = true;
      } else if (hurt && !this.heroBusy) {
        // Клип урона — только когда герой не в замахе: удар, оплаченный
        // откатом, не должен визуально отменяться.
        this.heroRig.play('урон');
        this.heroBusy = true;
      } else if (!this.heroBusy) {
        if (heroWalking) this.heroRig.play('ходьба', rateFor(HERO_SPEED, this.heroRig.root.scale.y));
        // Рубка — тот же клип удара, растянутый под замах (§13.3): топор
        // обязан входить в ствол ровно тогда, когда стучит звук.
        else if (this.working) this.heroRig.play('удар', STRIKE / SWING_SECONDS);
        else this.heroRig.play('покой');
      }

      if (this.heroFlash > 0) {
        this.heroFlash = Math.max(0, this.heroFlash - dt);
        this.heroRig.setMaterial(this.heroFlash > 0 ? this.hurtFlash : this.blocking);
      }

      this.heroWas = { wounds: state.hero.hp, cooldown: state.hero.cooldown };
    }

    /**
     * Стены гаснут, пока герой во дворе. Замер: стена в две клетки при камере
     * в 30° прячет за собой около четырёх с половиной клеток земли, и на
     * четверти двора герой оказывается скрыт целиком, на трети — наполовину.
     * До жителей (§6.1.6.1) прятать во дворе было некого, и свойство
     * не значило ничего.
     *
     * Гаснет весь замок, а не ближняя стена: детали едут одной `InstancedMesh`
     * на модель с общим материалом, и погасить одну из них значило бы завести
     * второй материал и делить детали по нему каждый кадр. А главное — гаснет
     * он ровно тогда, когда игрок внутри, то есть когда смотреть снаружи уже
     * незачем. Тень стена при этом отбрасывает прежнюю: стена не исчезла,
     * её просто видно насквозь.
     */
    if (this.castleMat !== null && this.keep !== null) {
      const inside = inYard(this.keep, { x: Math.round(hero.x), z: Math.round(hero.z) });
      const goal = inside ? CASTLE_FADE : 1;
      this.castleFade += (goal - this.castleFade) * Math.min(1, dt * 5);
      const mat = this.castleMat;
      const clear = this.castleFade < 0.995;
      if (mat.transparent !== clear) {
        mat.transparent = clear;
        mat.needsUpdate = true;
      }
      mat.opacity = this.castleFade;
    }

    for (const e of this.loc.enemies) {
      const view = this.enemyViews.get(e.id);
      if (view === undefined) continue;
      view.rig.update(dt);

      if (e.hp <= 0) {
        // Падение — клип, а не мгновенное исчезновение: §17.1 отводит на него
        // 680 мс, и всё это время противник ещё на полу.
        if (view.rig.state !== 'падение') {
          view.rig.play('падение');
          view.rig.setMaterial(view.base);
          view.lifeRoot.visible = false;
        } else if (view.rig.finished) {
          view.rig.root.visible = false;
        }
        continue;
      }

      // §11.3 — в бою положение ведёт показ (`stepBattlePlays`): тело идёт
      // по протоколу, а не к гексу, который симуляция уже решила.
      const shown = this.battlePosNow.get(e.id);
      const inShow = shown !== undefined;
      const ex = inShow
        ? lerp(view.rig.root.position.x, shown.x, Math.min(1, dt * 12))
        : lerp(e.prevX, e.x, alpha);
      const ez = inShow
        ? lerp(view.rig.root.position.z, shown.z, Math.min(1, dt * 12))
        : lerp(e.prevZ, e.z, alpha);
      const walking = inShow
        ? Math.hypot(shown.x - ex, shown.z - ez) > 0.02
        : e.x !== e.prevX || e.z !== e.prevZ;
      view.rig.root.position.set(ex, 0, ez);
      // Порядок важен: вспышка попадания перебивает телеграф. Замах длится
      // четверть секунды и дольше, вспышка — 150 мс, и если телеграф выиграет,
      // попадание в момент чужого замаха станет невидимым.
      view.flash = Math.max(0, view.flash - dt);
      view.rig.setMaterial(
        view.flash > 0 ? this.hurtFlash : e.telegraph > 0 ? view.hot : view.base,
      );

      // Спящий смотрит, куда стоял; проснувшийся — на героя; в показе боя —
      // куда велит протокол: на цель удара или по ходу шага. Разворот тот же,
      // что у героя (§17.2): за кадр, а не мгновенно.
      const look = inShow
        ? this.battleFacing.get(e.id) ?? Math.atan2(hx - ex, hz - ez)
        : walking
          ? Math.atan2(e.x - e.prevX, e.z - e.prevZ)
          : e.awake ? Math.atan2(hx - ex, hz - ez) : view.facing;
      let spin = look - view.facing;
      while (spin > Math.PI) spin -= Math.PI * 2;
      while (spin < -Math.PI) spin += Math.PI * 2;
      view.facing += spin * Math.min(1, dt * 8);
      view.rig.root.rotation.y = view.facing;

      // Состояния §17.1. Одиночный клип доигрывает до конца: удар, прерванный
      // шагом на середине замаха, читается как рывок, а не как удар.
      // В показе боя клипами распоряжается протокол (`stepBattlePlays`):
      // замах, урон и падение играются в момент показа, а стойкость на экране
      // тикает ударом, который игрок видит, — не тиком, который уже прошёл.
      if (view.busy && view.rig.finished) view.busy = false;
      if (inShow) {
        view.hp = this.shownHp.get(e.id) ?? e.hp;
      } else {
        if (e.hp < view.hp) {
          view.rig.play('урон');
          view.busy = true;
          // §17.1 — клип урона показывает, что попали; вспышка показывает,
          // что попали именно сейчас. У мага пять ран, и без неё «попал»
          // от «не достал» на пяти сантиметрах экрана не отличить.
          view.flash = FLASH_SECONDS;
        } else if (e.telegraph > 0 && view.rig.state !== 'удар') {
          view.rig.play('удар', ATTACK_RATE[e.kind]);
          view.busy = true;
        } else if (!view.busy) {
          if (walking) view.rig.play('ходьба', walkRate(e.kind, view.rig.root.scale.y));
          else view.rig.play('покой');
        }
        view.hp = e.hp;
      }

      // Полоска показывается, когда есть что показывать: спящий и целый
      // противник её не носит, иначе локация превращается в приборную панель.
      const share = (inShow ? this.shownHp.get(e.id) ?? e.hp : e.hp) / ENEMY_STATS[e.kind].hp;
      view.lifeRoot.visible = (e.awake || share < 1) && !this.shownDead.has(e.id);
      view.lifeRoot.position.y = ENEMY_HEIGHT[e.kind] / view.rig.root.scale.y + 0.4;
      view.life.scale.x = (view.life.userData.width as number) * share;
      (view.life.material as THREE.SpriteMaterial).color.setHex(
        share > 0.5 ? PALETTE.siteOk : PALETTE.siteNo,
      );
    }

    for (const c of this.loc.containers) {
      const mesh = this.containerMeshes.get(c.id);
      if (mesh === undefined) continue;
      // Вся добыча лежит неподвижно (см. buildContainers): циклу осталось
      // только прятать вскрытое.
      mesh.visible = !c.opened;
    }

    this.syncTrees(dt);
    this.syncStones(dt);
    this.syncGarrison(dt);
    this.syncSettler(dt);
    // Тик миксера жильцов: без него клип не играется, и человек сидит
    // в позе привязки — то есть стоит навытяжку со сломанным видом.
    for (const rig of this.residents) rig.update(dt);
    this.syncGrass(hx, hz, time);

    for (const ring of this.evacRings) {
      const ringMat = ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.5 + Math.sin(time / 400) * 0.25;
      ring.scale.setScalar(1 + Math.sin(time / 400) * 0.05);
    }

    if (this.marker.visible) {
      const mat = this.marker.material as THREE.MeshBasicMaterial;
      mat.opacity -= dt * (state.path.length > 0 ? 0.3 : 1.6);
      if (mat.opacity <= 0) this.marker.visible = false;
    }
  }

  /**
   * Трава расступается под тем, кто рядом. Врагов берём ближних и живых:
   * шейдер считает фиксированное число слотов, и тратить их на тех, кого
   * не видно в круге света (§11.4), незачем.
   */
  private syncGrass(hx: number, hz: number, time: number): void {
    if (this.meadow !== null) {
      // Луг заставки не расступается под ногами — у него только волна
      // и порыв от курсора, как на титуле.
      this.meadow.update(time / 1000);
      this.meadow.setGust(this.gust);
      return;
    }
    if (this.grass === null) return;
    const slots = this.pushers;
    slots.length = 0;
    slots.push({ x: hx, z: hz, strength: 1.2 });
    for (const e of this.loc.enemies) {
      if (slots.length >= 6) break;
      if (e.hp <= 0) continue;
      const dx = e.x - hx;
      const dz = e.z - hz;
      if (dx * dx + dz * dz > 64) continue;
      slots.push({ x: e.x, z: e.z, strength: e.kind === 'mage' ? 1.4 : 0.9 });
    }
    this.grass.update(time / 1000, slots as readonly Pusher[], this.gust);
  }

  /** Порыв от курсора; null — ветра нет (render/cursorWind.ts). */
  setGust(gust: Gust | null): void {
    this.gust = gust;
  }

  /** Ветер от наклона устройства (render/tiltWind.ts). */
  setTilt(x: number, z: number, strength: number): void {
    this.grass?.setTilt(x, z, strength);
    this.meadow?.setTilt(x, z, strength);
  }

  dispose(): void {
    this.hexGrid.dispose();
    this.grass?.dispose();
    this.meadow?.dispose();
    this.fire.dispose();
    this.grass = null;
    this.meadow = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    // Скелет у каждой особи свой, и три не освобождает его вместе с группой.
    for (const view of this.enemyViews.values()) view.rig.dispose();
    this.settler?.rig.dispose();
    this.settler = null;
    for (const view of this.dwellerViews) view.rig.dispose();
    this.dwellerViews.length = 0;
    for (const view of this.squad) view.rig.dispose();
    this.squad.length = 0;
    this.archer?.rig.dispose();
    this.archer = null;
    this.heroRig?.dispose();
    this.heroRig = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.enemyViews.clear();
    this.containerMeshes.clear();
    this.stoneMeshes.clear();
    this.stoneHits.clear();
  }
}
