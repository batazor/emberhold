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
} from './models';
import { Drifting } from './drifting';
import { CASTLE_SCALE, castleGeometry, castleMaterial } from './castle';
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
import type { GraveSite } from '../sim/graveSite';
import { Fire } from './fire';
import { fireOf } from './models';
import { Rigged } from './rigged';
import { HexGrid } from './hexGrid';
import { current, moves, targets } from '../sim/battle';
import { followSpots } from '../sim/raid';
import { hexToWorld, worldToHex } from '../sim/hex';
import type { Hex } from '../sim/hex';
import type { BuildingId } from '../sim/camp';
import { ENEMY_STATS } from '../sim/enemies';
import { inYard } from '../sim/castleSite';
import { HERO_SPEED } from '../sim/config';
import { SWING_SECONDS } from '../sim/logging';
import { idx } from '../sim/grid';
import type { EnemyKind, GameLocation, RaidState } from '../sim/types';
import type { HeroClassId } from '../sim/heroes';
import { forestMaterial } from './forest';
import type { ForestModelName } from './forest';
import { STUMP, STUMP_HEIGHT, WOODS, treeGeometry, type Tree } from './woods';
import type { Gust } from './cursorWind';
import { RESOURCE_MODEL, resourceGeometry, resourceMaterial } from './resources';
import { Grass, tileNoise } from './grass';
import type { Pusher } from './grass';
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
export type RaidFlavor = 'mine' | 'glade' | 'castle' | 'grave';

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
const SLIDE = 0.855;
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
 * ростом 0,72 клетки бежит 2,2 клетки в секунду — три своих роста, — и честное
 * растяжение вышло бы семикратным. Семикратная ходьба читается как дрожь,
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

/** Сколько ствол дрожит после замаха (§13.3). Короче клипа удара: дрожь —
 *  ответ на удар, а не отдельное событие. */
const SHAKE_SECONDS = 0.32;

/**
 * Сколько падает срубленное дерево. Дольше падения противника (680 мс,
 * §17.1): у ствола длиннее плечо, а мгновенное исчезновение читалось бы
 * не рубкой, а пропажей.
 */
const FALL_SECONDS = 0.9;

/** Выбор варианта от координаты: без RNG, чтобы вид не зависел от порядка. */
const hash = (a: number, b: number, mod: number): number =>
  Math.floor(((((Math.sin(a + b) * 43758.5453) % 1) + 1) % 1) * mod) % mod;

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
  private evacRing: THREE.Mesh | null = null;
  /** Здания, поставленные в конце пролога. До него их нет вовсе. */
  private readonly placed = new Map<BuildingId, THREE.Mesh>();
  /** Свет поставленного костра. Тот же, что потом горит в лагере. */
  private readonly fire = new Fire();
  /** Пятно под курсором в режиме выбора места и призрак здания над ним. */
  private site: THREE.Mesh | null = null;
  private ghost: THREE.Mesh | null = null;
  private grass: Grass | null = null;
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
    /** §14 — уровень оружия: он выбирает клинок в руке (§6.1.8). */
    private readonly weapon = 0,
    /** §11.7 — классы остальных бойцов отряда, в порядке цепочки. */
    private readonly mateClasses: readonly HeroClassId[] = [],
  ) {
    this.buildGround();
    this.buildGrass(grassPerTile);
    this.buildWalls();
    if (this.keep !== null) this.buildCastle(this.keep);
    if (this.keep !== null) this.buildGarrison(this.keep);
    if (this.grave !== null) this.buildGraveyard(this.grave);
    if (flavor !== 'glade') this.buildEvac();
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
        color.setHSL(PALETTE.groundHue - tier * 0.022, 0.24 - tier * 0.04, 0.34 - tier * 0.05 + v * 0.05);
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
    this.grass = new Grass(this.loc, perTile, undefined, this.bareCells());
    this.group.add(this.grass.mesh);
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
    return this.grass?.blades ?? 0;
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
    const tree = this.flavor === 'glade' || this.flavor === 'castle';
    const models: readonly Tree[] = tree
      ? GLADE_TREES
      : RAID_ROCKS.map((model) => ({ set: 'forest', model }) as const);
    const cells: number[][] = models.map(() => []);
    // У замка занятых клеток два рода: лес по краю и сам замок. Лесом
    // засаживается только лес — иначе деревья выросли бы сквозь стену.
    const wood = this.keep === null
      ? null
      : new Set(this.keep.trees.map((s) => idx(size, s.x, s.z)));
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const at = idx(size, x, z);
        if (!blocked[at]) continue;
        if (wood !== null && !wood.has(at)) continue;
        cells[hash(x * 5.1, z * 9.3, models.length)]!.push(x, z);
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
        const at = RaidView.standAt(x, z, tree, 0);
        mesh.setMatrixAt(i / 2, at);
        // Дерево, которое можно срубить, обязано быть найдено по клетке:
        // симуляция говорит «клетка освободилась», а рендеру надо знать,
        // какой из экземпляров какого меша на ней стоит (§13.3).
        if (tree) this.trees.set(idx(size, x, z), { mesh, at: i / 2, turn: 0 });
      }
      this.group.add(mesh);
    }
  }

  /* ---------- вырубка (§13.3) ---------- */

  /**
   * Матрица дерева на клетке. Всё в ней выведено из координаты — тот же
   * приём, что у выбора модели: лес обязан совпадать сам с собой между
   * заходами. `turn` сдвигает вывод для дерева, вставшего на место
   * срубленного на кромке: рубят там вечно, и стоять на месте упавшего
   * обязан не он сам.
   */
  private static standAt(x: number, z: number, tree: boolean, turn: number): THREE.Matrix4 {
    const dummy = new THREE.Object3D();
    const t = ((Math.sin(x * 3.1 + z * 7.7 + turn * 2.3) * 1000) % 1 + 1) % 1;
    // Дерево ростом с камень читалось бы кустом: тот же размах,
    // что у леса вокруг лагеря, иначе это два разных леса.
    const s = tree ? 1.9 + t * 1.1 : 0.85 + t * 0.55;
    dummy.position.set(x + (t - 0.5) * 0.22, tree ? -0.05 : -0.12, z + (t - 0.5) * 0.18);
    dummy.rotation.set(0, t * 6.28, 0);
    dummy.scale.set(s, s * (tree ? 0.9 + t * 0.25 : 0.8 + t * 0.5), s);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }

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
      const base = RaidView.standAt(key % this.loc.size, (key / this.loc.size) | 0, true, tree.turn);
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
        const base = RaidView.standAt(x, z, true, tree.turn);
        const angle = (Math.PI / 2) * share * share;
        RaidView.put(tree.mesh, tree.at, base.multiply(new THREE.Matrix4().makeRotationX(angle)));
        continue;
      }
      this.falling.splice(i, 1);
      if (fall.regrow) {
        const turn = tree.turn + 1;
        this.trees.set(fall.key, { ...tree, turn });
        RaidView.put(tree.mesh, tree.at, RaidView.standAt(x, z, true, turn));
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
      for (const s of list) buckets[hash(s.x * 5.1, s.z * 9.3, models.length)]!.push(s);
      for (let v = 0; v < models.length; v++) {
        const bucket = buckets[v]!;
        if (bucket.length === 0) continue;
        const mesh = new THREE.InstancedMesh(graveyardGeometry(models[v]!, 1), mat, bucket.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i]!;
          mesh.setMatrixAt(i, RaidView.standAt(s.x, s.z, tree, 0));
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
   * Трава на клетке выкашивается: под зданием её быть не должно.
   */
  place(id: BuildingId, x: number, z: number, level = 1): void {
    if (this.placed.has(id)) return;
    const mesh = new THREE.Mesh(this.track(buildingGeometry(id, level)), this.blocking);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(BUILDING_SCALE);
    mesh.position.set(x, 0, z);
    this.placed.set(id, mesh);
    this.group.add(mesh);
    // Костёр ставится горящим: огонь, который не светит, читается как макет
    // костра. Палатка света не даёт — `FireLight` знает это по модели.
    // Условие здесь, а не в свете: палатка ставится после костра только
    // в чужом порядке, но гасить чужой огонь она не должна и тогда.
    if (fireOf(id, 1) !== null) {
      this.fire.set(id, 1, x, z, BUILDING_SCALE);
      this.group.add(this.fire.group);
    }
    this.grass?.clearCell(x, z);
  }

  /**
   * Здание выросло на уровень. Геометрия пересобирается той же функцией,
   * что и в лагере: стадия роста — свойство модели, а не сцены (§6.1).
   *
   * На уровнях 1–2 стадия одна и та же (`stageOf`), и палатка ур. 2 выглядит
   * как палатка ур. 1. Это не забытая модель, а решение §6.1 «три стадии на
   * шесть уровней»: подделывать рост масштабом здесь было бы враньём.
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
   * показывает клетку, а вопрос у игрока другой — «что тут встанет».
   */
  showSite(id: BuildingId, x: number, z: number, ok: boolean): void {
    if (this.site === null) {
      this.site = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(0.94, 0.94)),
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
    this.site.position.set(x, 0.05, z);
    this.ghost.position.set(x, 0, z);
  }

  hideSite(): void {
    if (this.site !== null) this.site.visible = false;
    if (this.ghost !== null) this.ghost.visible = false;
  }

  private buildEvac(): void {
    const { evac } = this.loc;
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({ color: PALETTE.evac, transparent: true, opacity: 0.7, fog: false }),
    );
    this.evacRing = new THREE.Mesh(this.track(new THREE.TorusGeometry(1.2, 0.08, 8, 36)), ringMat);
    this.evacRing.rotation.x = -Math.PI / 2;
    this.evacRing.position.set(evac.x, 0.06, evac.z);

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
    beam.position.set(evac.x, 13, evac.z);
    this.group.add(this.evacRing, beam);
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
      mesh.position.set(c.x, 0.45, c.z);
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
      const unit = state.battle?.units.find((u) => u.id === -1 - f.id);
      const at = unit === undefined ? null : hexToWorld(unit.hex);
      const x = at === null ? lerp(f.prevX, f.x, alpha) : lerp(mate.position.x, at.x, Math.min(1, dt * 9));
      const z = at === null ? lerp(f.prevZ, f.z, alpha) : lerp(mate.position.z, at.z, Math.min(1, dt * 9));
      mate.position.set(x, 0, z);

      // Разворот тот же, что у ведущего (§17.2): за кадр, а не мгновенно.
      let turn = f.facing - mate.rotation.y;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      mate.rotation.y += turn * Math.min(1, dt * 8);

      const rig = this.mateRigs[i];
      if (rig !== undefined) {
        rig.update(dt);
        const walking = Math.hypot(f.x - f.prevX, f.z - f.prevZ) > 1e-4;
        if (walking) rig.play('ходьба', rateFor(HERO_SPEED, rig.root.scale.y));
        else rig.play('покой');
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
    if (this.hintRing.visible) {
      const pulse = 1 + Math.sin(time / 260) * 0.16;
      this.hintRing.scale.setScalar(pulse);
      (this.hintRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + (pulse - 1) * 1.6;
    }
    const { hero } = state;
    // §11.3 — в бою положение живёт на поле, а не в мире: мир обновится
    // только на выходе. Поэтому бойцы едут к центрам своих гексов, а не
    // интерполируются между тиками, которых больше нет.
    const battle = state.battle;
    const heroUnit = battle?.units.find((u) => u.side === 'hero');
    const heroTarget = heroUnit === undefined ? null : hexToWorld(heroUnit.hex);
    const hx = heroTarget === null
      ? lerp(hero.prevX, hero.x, alpha)
      : lerp(this.hero.position.x, heroTarget.x, Math.min(1, dt * 9));
    const hz = heroTarget === null
      ? lerp(hero.prevZ, hero.z, alpha)
      : lerp(this.hero.position.z, heroTarget.z, Math.min(1, dt * 9));
    this.hero.position.set(hx, 0, hz);

    this.syncGrid(state);
    this.syncParty(state, alpha, dt);

    let turn = hero.facing - this.hero.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    // §17.2: разворот не мгновенный, 120–150 мс — иначе читается как рывок.
    this.hero.rotation.y += turn * Math.min(1, dt * 8);
    // Герой на риге ходит клипом, примитивный — прежним покачиванием: у него
    // ног нет, и качать его — единственное, чем ход отличается от стойки.
    const heroWalking = state.path.length > 0;
    if (this.heroRig === null) {
      this.hero.children[0]!.position.y = 0.6 + (heroWalking ? Math.sin(time / 90) * 0.04 : 0);
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

      const unit = battle?.units.find((u) => u.id === e.id);
      const spot = unit === undefined ? null : hexToWorld(unit.hex);
      const ex = spot === null
        ? lerp(e.prevX, e.x, alpha)
        : lerp(view.rig.root.position.x, spot.x, Math.min(1, dt * 9));
      const ez = spot === null
        ? lerp(e.prevZ, e.z, alpha)
        : lerp(view.rig.root.position.z, spot.z, Math.min(1, dt * 9));
      const walking = spot === null
        ? e.x !== e.prevX || e.z !== e.prevZ
        : Math.hypot(spot.x - ex, spot.z - ez) > 0.02;
      view.rig.root.position.set(ex, 0, ez);
      // Порядок важен: вспышка попадания перебивает телеграф. Замах длится
      // четверть секунды и дольше, вспышка — 150 мс, и если телеграф выиграет,
      // попадание в момент чужого замаха станет невидимым.
      view.flash = Math.max(0, view.flash - dt);
      view.rig.setMaterial(
        view.flash > 0 ? this.hurtFlash : e.telegraph > 0 ? view.hot : view.base,
      );

      // Спящий смотрит, куда стоял; проснувшийся — на героя. Разворот тот же,
      // что у героя (§17.2): за кадр, а не мгновенно.
      const look = walking
        ? Math.atan2(e.x - e.prevX, e.z - e.prevZ)
        : e.awake ? Math.atan2(hx - ex, hz - ez) : view.facing;
      let spin = look - view.facing;
      while (spin > Math.PI) spin -= Math.PI * 2;
      while (spin < -Math.PI) spin += Math.PI * 2;
      view.facing += spin * Math.min(1, dt * 8);
      view.rig.root.rotation.y = view.facing;

      // Состояния §17.1. Одиночный клип доигрывает до конца: удар, прерванный
      // шагом на середине замаха, читается как рывок, а не как удар.
      if (view.busy && view.rig.finished) view.busy = false;
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

      // Полоска показывается, когда есть что показывать: спящий и целый
      // противник её не носит, иначе локация превращается в приборную панель.
      const share = e.hp / ENEMY_STATS[e.kind].hp;
      view.lifeRoot.visible = e.awake || share < 1;
      view.lifeRoot.position.y = ENEMY_HEIGHT[e.kind] / view.rig.root.scale.y + 0.4;
      view.life.scale.x = (view.life.userData.width as number) * share;
      (view.life.material as THREE.SpriteMaterial).color.setHex(
        share > 0.5 ? PALETTE.siteOk : PALETTE.siteNo,
      );
    }

    for (const c of this.loc.containers) {
      const mesh = this.containerMeshes.get(c.id);
      if (mesh === undefined) continue;
      if (c.opened) {
        mesh.visible = false;
        continue;
      }
      mesh.rotation.y += dt * 1.6;
      mesh.position.y = 0.45 + Math.sin(time / 500 + c.id) * 0.08;
    }

    this.syncTrees(dt);
    this.syncStones(dt);
    this.syncGarrison(dt);
    this.syncGrass(hx, hz, time);

    if (this.evacRing !== null) {
      const ringMat = this.evacRing.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.5 + Math.sin(time / 400) * 0.25;
      this.evacRing.scale.setScalar(1 + Math.sin(time / 400) * 0.05);
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
  }

  dispose(): void {
    this.hexGrid.dispose();
    this.grass?.dispose();
    this.fire.dispose();
    this.grass = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    // Скелет у каждой особи свой, и три не освобождает его вместе с группой.
    for (const view of this.enemyViews.values()) view.rig.dispose();
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
