import * as THREE from 'three';
import { blockingMaterial } from './blocking';
import { ENEMY_HEIGHT, buildingGeometry, enemyGeometry, enemyParts, heroGeometry, heroParts } from './models';
import { Drifting } from './drifting';
import { CASTLE_SCALE, castleGeometry, castleMaterial } from './castle';
import { FENCE_SCALE, fenceGeometry, graveyardGeometry, graveyardMaterial } from './graveyard';
import type { GraveyardPartModelName } from './graveyard';
import type { CastlePartModelName } from './castle';
import type { CastleSite } from '../sim/castleSite';
import type { GraveSite } from '../sim/graveSite';
import { Fire } from './fire';
import { fireOf } from './models';
import { Rigged } from './rigged';
import type { BuildingId } from '../sim/camp';
import { ENEMY_STATS } from '../sim/enemies';
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
const rateFor = (speed: number, scale: number): number =>
  Math.min(MAX_RATE, speed / Math.max(1e-3, SLIDE * scale));
const walkRate = (kind: EnemyKind, scale: number): number =>
  rateFor(ENEMY_STATS[kind].speed, scale);

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
  /** Раны на прошлом кадре: по их уменьшению и запускается клип урона. */
  wounds: number;
  /** Одиночный клип доигрывает до конца и только потом отпускает состояние. */
  busy: boolean;
}

export class RaidView {
  readonly group = new THREE.Group();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly containerMeshes = new Map<number, THREE.Mesh>();
  private hero!: THREE.Group;
  /** Есть у класса с моделью набора; у примитивных классов остаётся null. */
  private heroRig: Rigged | null = null;
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
  /** Пятно работы под деревом. Заводится в первую же рубку, а не на входе:
   *  в вылазке его не будет никогда. */
  private chopMark: THREE.Mesh | null = null;
  /** Рубит ли герой прямо сейчас — этим он и отличается от стоящего. */
  private chopping = false;
  /** Переиспользуемые слоты толчка: аллокация каждый кадр тут не нужна. */
  private readonly pushers: { x: number; z: number; strength: number }[] = [];
  /** Порыв от курсора. Считает его main — источник ветра один на игру. */
  private gust: Gust | null = null;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  /** Один материал на все модели артбука: цвет приходит вершинами (§6.1). */
  private readonly blocking = this.track(blockingMaterial());

  constructor(
    private readonly loc: GameLocation,
    private readonly heroClass: HeroClassId = 'ranger',
    grassPerTile = 24,
    private readonly flavor: RaidFlavor = 'mine',
    /** Площадка замка (§6.1.6): без неё вкус «замок» рисовать нечем. */
    private readonly keep: CastleSite | null = null,
    /** Участок кладбища (§6.1.7): то же самое для вкуса «кладбище». */
    private readonly grave: GraveSite | null = null,
    /** §14 — уровень оружия: он выбирает клинок в руке (§6.1.8). */
    private readonly weapon = 0,
  ) {
    this.buildGround();
    this.buildGrass(grassPerTile);
    this.buildWalls();
    if (this.keep !== null) this.buildCastle(this.keep);
    if (this.grave !== null) this.buildGraveyard(this.grave);
    if (flavor !== 'glade') this.buildEvac();
    this.buildContainers();
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
  private bareCells(): ReadonlySet<number> {
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
    this.heroRig?.replay();
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
  showChop(x: number, z: number, share: number): void {
    if (this.chopMark === null) {
      this.chopMark = new THREE.Mesh(
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
      this.chopMark.rotation.x = -Math.PI / 2;
      this.group.add(this.chopMark);
    }
    this.chopMark.visible = true;
    this.chopMark.position.set(x, 0.06, z);
    this.chopMark.scale.setScalar(Math.max(0.08, share));
    // Пятно и клип — одно состояние: пока пятно растёт, герой машет топором,
    // а не стоит в покое рядом с работающим индикатором.
    this.chopping = true;
  }

  hideChop(): void {
    if (this.chopMark !== null) this.chopMark.visible = false;
    this.chopping = false;
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

      const { root: lifeRoot, fill } = this.buildLifeBar(ENEMY_STATS[e.kind].wounds);
      rig.root.add(lifeRoot);

      this.enemyViews.set(e.id, {
        rig,
        base: this.blocking,
        hot: hotOf(e.kind),
        life: fill,
        lifeRoot,
        facing: 0,
        wounds: e.wounds,
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
    const hx = lerp(hero.prevX, hero.x, alpha);
    const hz = lerp(hero.prevZ, hero.z, alpha);
    this.hero.position.set(hx, 0, hz);

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
      if (heroWalking) this.heroRig.play('ходьба', rateFor(HERO_SPEED, this.heroRig.root.scale.y));
      // Рубка — тот же клип удара, растянутый под замах (§13.3): топор
      // обязан входить в ствол ровно тогда, когда стучит звук.
      else if (this.chopping) this.heroRig.play('удар', STRIKE / SWING_SECONDS);
      else this.heroRig.play('покой');
    }

    for (const e of this.loc.enemies) {
      const view = this.enemyViews.get(e.id);
      if (view === undefined) continue;
      view.rig.update(dt);

      if (e.wounds <= 0) {
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

      const ex = lerp(e.prevX, e.x, alpha);
      const ez = lerp(e.prevZ, e.z, alpha);
      const walking = e.x !== e.prevX || e.z !== e.prevZ;
      view.rig.root.position.set(ex, 0, ez);
      view.rig.setMaterial(e.telegraph > 0 ? view.hot : view.base);

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
      if (e.wounds < view.wounds) {
        view.rig.play('урон');
        view.busy = true;
      } else if (e.telegraph > 0 && view.rig.state !== 'удар') {
        view.rig.play('удар', ATTACK_RATE[e.kind]);
        view.busy = true;
      } else if (!view.busy) {
        if (walking) view.rig.play('ходьба', walkRate(e.kind, view.rig.root.scale.y));
        else view.rig.play('покой');
      }
      view.wounds = e.wounds;

      // Полоска показывается, когда есть что показывать: спящий и целый
      // противник её не носит, иначе локация превращается в приборную панель.
      const share = e.wounds / ENEMY_STATS[e.kind].wounds;
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
      if (e.wounds <= 0) continue;
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
    this.grass?.dispose();
    this.fire.dispose();
    this.grass = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    // Скелет у каждой особи свой, и три не освобождает его вместе с группой.
    for (const view of this.enemyViews.values()) view.rig.dispose();
    this.heroRig?.dispose();
    this.heroRig = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.enemyViews.clear();
    this.containerMeshes.clear();
  }
}
