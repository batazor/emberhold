import * as THREE from 'three';
import { blockingMaterial } from './blocking';
import { buildingGeometry, dwellerParts, heroGeometry, heroParts } from './models';
import { Rigged } from './rigged';
import { CAMP_SPEED } from '../sim/campWalk';
import type { HeroClassId } from '../sim/heroes';
import { Fire } from './fire';
import { BUILDING_ORDER, builtBuildings, campArea, campOrigin } from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import type { Gust } from './cursorWind';
import { FluffyGrass } from './fluffyGrass';
import { forestMaterial } from './forest';
import { WOODS, forest as forestTree, treeGeometry, type Tree } from './woods';
import { CASTLE_SCALE, castleGeometry, castleMaterial } from './castle';
import { fenceGeometry, graveyardMaterial } from './graveyard';
import type { GraveyardPartModelName } from './graveyard';
import type { FencePiece } from '../sim/fence';
import type { CastlePartModelName } from './castle';
import { CASTLE_CELL, type Piece, type Spot } from '../sim/castle';
import { PALETTE } from './palette';

/**
 * Сцена лагеря по camp.html: герой стоит у Жилья, стройка видна по площадке.
 *
 * Жителей-примитивов в сцене больше нет. Они были первым шагом — коробками,
 * которые показывали, что лагерь растёт, — и держались ровно до того дня,
 * когда у героя появилась настоящая модель: рядом с ней коробки читались
 * не фоном, а недоделкой. Жители вернутся персонажами того же набора
 * (§6.1.4), а пока герой в лагере один.
 */

/**
 * Артбук рисует модели в своих габаритах — палатка с растяжками почти четыре
 * единицы в ширину. В лагере под здание отведено 2×2 клетки (§20.4), поэтому
 * блокинг приводится к следу здесь, а не пересчётом чисел в самих моделях:
 * так они остаются построчно сверяемыми со страницей артбука.
 */
const BUILDING_SCALE = 0.55;
/** Житель ростом с клетку читается рядом со зданием, а не как игрушка. */
const VILLAGER_SCALE = 0.62;

/**
 * Растяжение клипа ходьбы — то же правило и то же число, что в вылазке
 * (`raidView.ts`): шаг клипа обязан совпасть со скоростью, иначе ноги едут
 * по полу. `SLIDE` — сколько единиц набора проходит нога за секунду в клипе,
 * замер лежит в каталоге анимаций (`npm run clips`).
 *
 * Масштаб входит в делитель, потому что клип живёт в единицах модели:
 * уменьшенная фигура за тот же кадр проходит меньше, и без поправки
 * житель лагеря семенил бы вдвое чаще героя вылазки при одной скорости.
 */
const SLIDE = 0.855;
const MAX_RATE = 3;
const walkRate = (speed: number, scale: number): number =>
  Math.min(MAX_RATE, speed / Math.max(1e-3, SLIDE * scale));

/**
 * Насколько должен сдвинуться герой за кадр, чтобы считаться идущим.
 * Не ноль: положение приходит из симуляции числами с плавающей точкой,
 * и стоящий на месте иначе дёргался бы между «идёт» и «стоит».
 */
const WALK_EPS = 1e-4;

/**
 * Лес вокруг поляны (§6.1, набор KayKit Forest). Лагерь стоит на поляне
 * с нулевого кадра онбординга — деревья не добавляют миру ничего нового,
 * они делают видимым то, что уже сказано. Растут они только за площадью
 * лагеря, поэтому рост Жилья читается ещё и как отступающий лес.
 */
const CAMP_TREES = WOODS;
const CAMP_ROCKS: readonly Tree[] = [forestTree('Rock_1_G_Color1'), forestTree('Rock_3_H_Color1')];

/** Уровень земли вокруг площадки: луг из buildMeadow, на нём же стоит лес. */
const MEADOW_Y = -0.02;

/** Рост валуна (§13.4) в клетках: герою по колено — то же число, что
 *  в вылазке (`raidView.ts`), иначе это два разных камня. */
const STONE_HEIGHT = 0.42;
/** Сколько секунд камень оседает после замаха. */
const STONE_SHAKE = 0.18;


/**
 * Во сколько палатка меньше здания. Не подобрано на глаз: след палатки 1×1,
 * след здания 2×2, и половина — это ровно то же отношение, каким они
 * считаются в симуляции.
 */
const TENT_LOOK = 0.5;

/** Насколько далеко за поляну уходит лес, в клетках. */
const FOREST_DEPTH = 5;
/** Полоса между поляной и первым деревом: иначе лес закрывает крайние здания. */
const FOREST_GAP = 2;

/** Детерминированный шум по координате — тот же приём, что у земли. */
const noise = (x: number, z: number): number =>
  (((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) + 1) % 1;

export class CampView {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<BuildingId, THREE.Group>();
  /** Палатки жильцов: без имени, потому что различать их нечем и незачем —
   *  тап по палатке ничего не открывает. */
  private readonly tents: THREE.Group[] = [];
  /**
   * Жильцы лагеря. Со скелетом — как все прочие тела игры: пока герой в лагере
   * стоял неподвижной геометрией, неподвижными держались и они, чтобы
   * анимированный жилец не сделал героя рядом с собой хуже, чем он есть.
   * Теперь риг у обоих, и держаться этого правила больше не за что.
   */
  private readonly folk: Rigged[] = [];
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  /** Тело героя: риг, если у класса есть модель набора, иначе примитив. */
  private hero!: THREE.Object3D;
  private heroRig: Rigged | null = null;
  /** Кем сейчас ведут отряд (§11.8): в лагере стоит тот же, кто пойдёт. */
  private heroClass: HeroClassId = 'archer';
  /** Где герой был на прошлом кадре — по этому и видно, идёт он или стоит. */
  private heroWas = { x: 0, z: 0 };
  /** Уровень оружия, которым собран клинок в руке: ниже он же и сверяется. */
  private heroWeapon = 0;
  /** Где герой стоит: мировые координаты, их ведёт симуляция. */
  private heroAt = { x: 0, y: 0, z: 0 };
  private heroFacing = 0;
  private site: THREE.Mesh | null = null;
  /** Свет костра. Один на лагерь: горит тот огонь, что стоит у кухни. */
  private readonly fire = new Fire();
  private area = 6;
  private builtLevels = '';
  /** Валуны лагеря (§13.4): по мешу на камень — их единицы, и каждый дрожит
   *  от удара и исчезает поодиночке. */
  private readonly stones = new Map<number, THREE.Mesh>();
  private readonly stoneHits = new Map<number, number>();
  private stoneMat: THREE.MeshLambertMaterial | null = null;
  /** Пятно работы под валуном. Заводится в первый же замах, а не на входе. */
  private workMark: THREE.Mesh | null = null;

  /** Один материал на все модели артбука: цвет приходит вершинами (§6.1). */
  private readonly blocking = this.track(blockingMaterial());

  constructor(private camp: CampState) {
    this.moveToOrigin();
    this.buildGround();
    this.buildMeadow();
    this.buildHero();
    this.group.add(this.fire.group);
    this.rebuildBuildings();
    this.buildStones();
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private buildGround(): void {
    // Одна InstancedMesh на всю землю — бюджет из camp.html: 1 вызов.
    const max = 10;
    const geo = this.track(new THREE.BoxGeometry(1, 0.4, 1));
    const mat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const mesh = new THREE.InstancedMesh(geo, mat, max * max);
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let i = 0;
    for (let z = 0; z < max; z++) {
      for (let x = 0; x < max; x++) {
        const v = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
        dummy.position.set(x, -0.2 - v * 0.03, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.setHSL(0.1, 0.2, 0.36 + v * 0.05);
        mesh.setColorAt(i, color);
        i++;
      }
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    this.groundMesh = mesh;
    this.group.add(mesh);
    // Своей подстилки у леса нет: земля под ним — луг из buildMeadow,
    // и деревья стоят на его уровне (MEADOW_Y).
    this.group.add(this.forest);
  }

  private groundMesh!: THREE.InstancedMesh;
  private readonly forest = new THREE.Group();
  private forestMat: THREE.MeshLambertMaterial | null = null;

  /**
   * Лес за поляной. Пересобирается вместе с площадью: деревья стоят там, где
   * лагеря ещё нет, и отступают на клетку с каждым уровнем Жилья.
   */
  private buildForest(area: number): void {
    for (const child of [...this.forest.children]) child.removeFromParent();
    this.forestMat ??= this.track(forestMaterial());

    const models: readonly Tree[] = [...CAMP_TREES, ...CAMP_ROCKS];
    const spots: number[][] = models.map(() => []);

    for (let z = -FOREST_DEPTH; z < 10 + FOREST_DEPTH; z++) {
      for (let x = -FOREST_DEPTH; x < 10 + FOREST_DEPTH; x++) {
        const clear =
          x >= -FOREST_GAP && z >= -FOREST_GAP && x < area + FOREST_GAP && z < area + FOREST_GAP;
        if (clear) continue;
        const n = noise(x, z);
        if (n > 0.5) continue; // просветы: сплошная стена читается как забор
        // Камни редки — это лес, а не осыпь.
        const model = n < 0.05 ? CAMP_TREES.length + (z & 1) : Math.floor(n * 40) % CAMP_TREES.length;
        spots[model]!.push(x, z);
      }
    }

    const dummy = new THREE.Object3D();
    for (let m = 0; m < models.length; m++) {
      const list = spots[m]!;
      if (list.length === 0) continue;
      const tree = m < CAMP_TREES.length;
      const mesh = new THREE.InstancedMesh(
        treeGeometry(models[m]!, 1),
        this.forestMat,
        list.length / 2,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i += 2) {
        const x = list[i]!;
        const z = list[i + 1]!;
        const n = noise(z, x);
        const size = tree ? 1.9 + n * 1.1 : 0.5 + n * 0.5;
        dummy.position.set(x + (n - 0.5) * 0.8, MEADOW_Y, z + (noise(x + 7, z) - 0.5) * 0.8);
        dummy.rotation.set(0, n * 6.28, 0);
        dummy.scale.set(size * (0.9 + n * 0.2), size, size * (0.9 + n * 0.2));
        dummy.updateMatrix();
        mesh.setMatrixAt(i / 2, dummy.matrix);
      }
      this.forest.add(mesh);
    }
  }

  private meadow: FluffyGrass | null = null;

  /**
   * Луг вокруг лагеря — та же трава, что на заставке. Растёт снаружи
   * площадки, а не на ней: площадка застраивается и переставляется (§20.4),
   * и трава под Жильём торчала бы сквозь него.
   *
   * Уровень луга — вровень с крышкой площадки, а не ниже: опущенный луг
   * превращал лагерь в висящую плиту с чёрным ребром. Вровень трава
   * подходит к клеткам вплотную, а опущенные клетки за границей площади
   * прячутся под ним.
   */
  private buildMeadow(): void {
    // Радиус — по видимой земле, а не по площадке: при ортокамере в 30°
    // полоса земли уходит вглубь на две высоты кадра, и круг поменьше
    // обрывался краем в нижней части экрана.
    const RADIUS = 30;
    const RINGS = 26;
    const SEGMENTS = 72;
    const cx = 5;
    const cz = 5;
    const y = MEADOW_Y;

    const position: number[] = [];
    const index: number[] = [];
    for (let ring = 0; ring <= RINGS; ring++) {
      const r = (ring / RINGS) * RADIUS;
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const a = (seg / SEGMENTS) * Math.PI * 2;
        position.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      }
    }
    for (let ring = 0; ring < RINGS; ring++) {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const next = (seg + 1) % SEGMENTS;
        const a = ring * SEGMENTS + seg;
        const b = ring * SEGMENTS + next;
        const c = (ring + 1) * SEGMENTS + seg;
        const d = (ring + 1) * SEGMENTS + next;
        index.push(a, b, c, b, d, c);
      }
    }

    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      geo,
      this.track(new THREE.MeshLambertMaterial({ color: 0x4f6b45 })),
    );
    terrain.receiveShadow = true;
    this.group.add(terrain);

    this.meadow = new FluffyGrass(terrain, {
      fieldSize: RADIUS * 2,
      count: 11000,
      scale: 4,
      // Запрет читает текущую площадь: она растёт с Жильём, и после роста
      // луг пересевается (rebuildBuildings).
      reject: (x, z) => {
        const edge = this.area - 0.5 + 0.7;
        return x > -1.2 && x < edge && z > -1.2 && z < edge;
      },
    });
    this.group.add(this.meadow.group);
  }

  /**
   * Герой в лагере — та же модель, что уходит в вылазку (артбук, 04),
   * и с тем же скелетом: лагерь был единственным местом игры, где человек
   * ездил по земле не переставляя ног.
   *
   * Классу без модели набора достаётся неподвижный примитив — скелета у него
   * нет, и выдумывать его нечем. Правило то же, что в вылазке.
   */
  private buildHero(): void {
    this.heroWeapon = this.camp.gear.weapon;
    this.heroRig?.dispose();
    this.heroRig = null;
    const parts = heroParts(this.heroClass, this.heroWeapon);
    if (parts === null) {
      const mesh = new THREE.Mesh(this.track(heroGeometry(this.heroClass, this.heroWeapon)), this.blocking);
      mesh.castShadow = true;
      this.hero = mesh;
    } else {
      this.heroRig = new Rigged(parts, this.blocking);
      this.hero = this.heroRig.root;
      this.heroRig.play('покой');
    }
    this.hero.scale.setScalar(VILLAGER_SCALE);
    this.group.add(this.hero);
  }

  /**
   * Кем ведут отряд. Пока веера не было, в лагере всегда стоял Лучник —
   * класс был вписан в сцену числом, а ведущего выбирали в списке. Теперь
   * ведущего меняют лицом под пальцем (§11.8), и лагерь обязан показывать
   * того, кто пойдёт: иначе выбор виден только в карточке, а на площадке
   * стоит кто-то другой.
   */
  setHeroClass(cls: HeroClassId): void {
    if (cls === this.heroClass) return;
    this.heroClass = cls;
    this.hero.removeFromParent();
    this.buildHero();
  }

  /**
   * Выкованное видно там же, где ковалось. Клинок §14 меняется только по ковке,
   * поэтому геометрия пересобирается по уровню, а не каждый кадр: у моделей
   * набора свой кэш, и второй раз тот же уровень ничего не стоит.
   */
  private rebuildHero(): void {
    if (this.camp.gear.weapon === this.heroWeapon) return;
    // С ригом клинок висит на кости кисти, и менять его пересборкой всей
    // особи незачем — но собрать заново дешевле, чем держать здесь второй
    // путь: ковка случается раз в несколько минут, а не каждый кадр.
    this.hero.removeFromParent();
    this.buildHero();
  }

  /**
   * §6.1: стадии роста — замена меша, а не отдельный рисунок. Пока моделей нет,
   * стадия выражена габаритом и надстройками: силуэт обязан читаться без цифр.
   */
  /**
   * Модель здания из артбука (`src/render/models.ts`). Уровень читается
   * силуэтом: палатка → сруб → камень, — поэтому стадия это другая модель,
   * а не та же коробка выше ростом.
   *
   * Масштаб приводит блокинг к следу здания: артбук рисует модели в своих
   * габаритах, а в лагере под здание отведено 2×2 клетки (§20.4).
   */
  private makeBuilding(id: BuildingId, level: number): THREE.Group {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(this.track(buildingGeometry(id, level)), this.blocking);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(BUILDING_SCALE);
    g.add(mesh);
    return g;
  }

  /**
   * Пересобирает постройки, только если что-то изменилось.
   *
   * Положение входит в подпись наравне с уровнем. Раньше подпись состояла
   * из одних уровней, и перестановка (§20.4) уровня не меняет — вид оставлял
   * здание на прежнем месте, пока кто-нибудь не позовёт setCamp. Здание,
   * переехавшее в данных и оставшееся на экране, читается как призрак,
   * поэтому условие должно совпадать с тем, что рисуется, а не с тем,
   * что обычно меняется.
   */
  rebuildBuildings(): void {
    const signature = BUILDING_ORDER.map((id) => {
      const p = this.camp.layout[id];
      return `${id}${this.camp.levels[id]}@${p.x},${p.z}`;
    }).join('|');
    // Палатки входят в подпись наравне со зданиями и по той же причине:
    // поставленная и не нарисованная палатка — это оплаченное и невидимое.
    const withTents =
      `${signature}|т${this.camp.tents.map((t) => `${t.x},${t.z}`).join(';')}` +
      `|ж${this.camp.residents.map((r) => r.look).join(';')}`;
    const area = campArea(this.camp.levels.hq);
    if (withTents === this.builtLevels && area === this.area) return;
    this.builtLevels = withTents;
    this.area = area;

    for (const [, g] of this.buildings) g.removeFromParent();
    this.buildings.clear();
    for (const g of this.tents) g.removeFromParent();
    this.tents.length = 0;
    for (const rig of this.folk) {
      rig.root.removeFromParent();
      rig.dispose();
    }
    this.folk.length = 0;

    // Уровень 0 — это пустое место, а не здание нулевого размера: Мастерская
    // до Жилья ур. 2 не рисуется вовсе.
    for (const id of builtBuildings(this.camp)) {
      const g = this.makeBuilding(id, this.camp.levels[id]);
      const pos = this.camp.layout[id];
      g.position.set(pos.x + 0.5, 0, pos.z + 0.5);
      this.group.add(g);
      this.buildings.set(id, g);
    }

    // Палатки жильцов (`sim/residents.ts`). Модель — то же Жильё первого
    // уровня: палатка и есть Жильё, только чужая, и рисовать её другим
    // мешем значило бы сказать, что это другое жильё. Меньше она потому,
    // что след у неё 1×1 против 2×2 у зданий, — размер здесь не украшение,
    // а то же число, которым считается место.
    for (const t of this.camp.tents) {
      const g = this.makeBuilding('hq', 1);
      g.scale.setScalar(TENT_LOOK);
      g.position.set(t.x + 0.5, 0, t.z + 0.5);
      this.group.add(g);
      this.tents.push(g);
    }

    /*
     * Жильцы. Каждый стоит у своей палатки — той, что под тем же номером:
     * палатка вмещает одного (`residents.ts`), и номер — это всё, чем они
     * связаны.
     *
     * У кого палатки ещё нет, тот стоит **у костра**. Это не запасное место,
     * а то же задание, сказанное картинкой: пока крыши нет, человек в лагере
     * есть, и видно, что ему негде. Если Кухни почему-то не оказалось,
     * он встаёт у Жилья — пустого места в лагере не бывает.
     */
    const fire = this.camp.levels.kitchen > 0 ? this.camp.layout.kitchen : this.camp.layout.hq;
    this.camp.residents.forEach((r, i) => {
      const tent = this.camp.tents[i];
      const rig = new Rigged(dwellerParts(r.look), this.blocking);
      rig.root.scale.setScalar(VILLAGER_SCALE);
      // Шаг в сторону от следа: стоящий ровно в центре клетки палатки
      // оказывается внутри неё, и снаружи это читается пропавшим жильцом.
      // Обе точки лежат **за** следом, а не в нём. У костра это особенно
      // важно: след Кухни 2×2, и шаг в 1,6 клетки оставлял жильца внутри
      // него — сегодня это сходит с рук только потому, что костёр низкий,
      // а на выросшей Кухне он оказался бы в стене.
      const at = tent === undefined
        ? { x: fire.x + 1, z: fire.z + 2.6 }
        : { x: tent.x + 0.5, z: tent.z + 1.1 };
      // Ноги на земле. Раньше здесь стояло 0.55 — начало старой модели,
      // у которой точка отсчёта была в поясе. Модели давно ставятся
      // основанием на ноль, а число осталось: жилец висел над площадкой
      // на 0,55 клетки — больше половины собственного роста. Глазом это
      // читалось не «парит», а «стоит на чём-то невидимом», потому и дожило
      // до замера.
      rig.root.position.set(at.x, 0, at.z);
      // Лицом к костру: люди в лагере смотрят на огонь, а не в лес.
      rig.root.rotation.y = Math.atan2(fire.x + 1 - at.x, fire.z + 1 - at.z);
      rig.play('покой');
      this.group.add(rig.root);
      this.folk.push(rig);
    });

    // Земля показывает ровно текущую площадь: рост Жилья виден как рост лагеря.
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) {
        const inside = x < area && z < area;
        dummy.position.set(x, inside ? -0.2 : -1.4, z);
        dummy.scale.setScalar(inside ? 1 : 0.98);
        dummy.updateMatrix();
        this.groundMesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    this.groundMesh.instanceMatrix.needsUpdate = true;
    // Площадь изменилась — лес и трава отступают с новых клеток вместе.
    this.buildForest(area);
    this.meadow?.replant();
  }

  setCamp(camp: CampState): void {
    this.camp = camp;
    this.moveToOrigin();
    this.builtLevels = '';
    this.rebuildBuildings();
    this.rebuildHero();
    this.buildStones();
  }

  /* ---------- валуны (§13.4) ---------- */

  /**
   * Камни на площадке. Порода та же, что у леса вокруг, и это то же решение,
   * что в вылазке: валун обязан читаться частью места, а не предметом,
   * который сюда принесли.
   *
   * Рисуются все, включая те, что лежат за нынешней кромкой площади:
   * площадь растёт с Жильём (§20.4), и камень за кромкой — не ошибка,
   * а тот, до которого лагерь ещё не дорос. Пока он в лесу, до него просто
   * не доходят.
   */
  private buildStones(): void {
    for (const mesh of this.stones.values()) mesh.removeFromParent();
    this.stones.clear();
    this.stoneHits.clear();
    this.stoneMat ??= this.track(forestMaterial());
    for (const stone of this.camp.stones) {
      if (stone.taken) continue;
      const n = noise(stone.x * 3.1, stone.z * 7.7);
      const model = CAMP_ROCKS[Math.floor(n * CAMP_ROCKS.length) % CAMP_ROCKS.length]!;
      // Геометрия живёт в общем кэше forest.ts и переживает вид: её не track.
      const mesh = new THREE.Mesh(treeGeometry(model, STONE_HEIGHT * (0.85 + n * 0.4)), this.stoneMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(stone.x + (n - 0.5) * 0.2, MEADOW_Y - 0.02, stone.z + (n - 0.5) * 0.16);
      mesh.rotation.y = n * 6.28;
      this.group.add(mesh);
      this.stones.set(stone.id, mesh);
    }
  }

  /** Замах пришёлся в валун: камень оседает под ударом. */
  hitStone(id: number): void {
    if (this.stones.has(id)) this.stoneHits.set(id, 0);
  }

  /** Валун разбит: камень уходит из кадра совсем. */
  takeStone(id: number): void {
    const mesh = this.stones.get(id);
    if (mesh === undefined) return;
    mesh.removeFromParent();
    this.stones.delete(id);
    this.stoneHits.delete(id);
  }

  /** Работа кайлом: пятно под валуном растёт вместе с ней. */
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
  }

  hideWork(): void {
    if (this.workMark !== null) this.workMark.visible = false;
  }

  /** Дрожь валуна — кадрами, как и в вылазке. */
  private syncStones(dt: number): void {
    for (const [id, t] of [...this.stoneHits]) {
      const mesh = this.stones.get(id);
      if (mesh === undefined) {
        this.stoneHits.delete(id);
        continue;
      }
      const next = t + dt;
      if (next >= STONE_SHAKE) {
        this.stoneHits.delete(id);
        mesh.position.y = MEADOW_Y - 0.02;
        continue;
      }
      this.stoneHits.set(id, next);
      mesh.position.y = MEADOW_Y - 0.02 - Math.sin((next / STONE_SHAKE) * Math.PI) * 0.06;
    }
  }

  /** Порыв от курсора; null — ветра нет (render/cursorWind.ts). */
  setGust(gust: Gust | null): void {
    this.meadow?.setGust(gust);
  }

  /** Ветер от наклона устройства (render/tiltWind.ts). */
  setTilt(x: number, z: number, strength: number): void {
    this.meadow?.setTilt(x, z, strength);
  }

  update(dt: number, now: number, day = 1): void {
    this.rebuildBuildings();
    this.syncStones(dt);
    this.meadow?.update(now / 1000);
    // Трава FluffyGrass сама себе освещение, поэтому время суток ей
    // передаётся числом: иначе вечерний лагерь стоит в полуденной траве.
    this.meadow?.setLight(0.35 + day * 0.65);

    // Герой стоит там, куда пришёл. Раньше он каждый кадр возвращался
    // к Жилью — и лагерь был единственным местом игры, где не ходят.
    // `heroAt.y` — ярус: на стене герой стоит выше ровно на измеренную
    // высоту настила. Слагаемого 0.55 здесь больше нет — оно поднимало
    // фигуру над землёй (см. `buildFolk`).
    this.hero.position.set(this.heroAt.x, this.heroAt.y, this.heroAt.z);
    this.hero.rotation.y = this.heroFacing;

    // Ноги переставляются, только когда человек вправду сдвинулся. Клип
    // выбирается по пройденному за кадр, а не по наличию пути: путь бывает
    // и у стоящего — он упёрся в стену или ждёт конца поворота.
    const moved = Math.hypot(this.heroAt.x - this.heroWas.x, this.heroAt.z - this.heroWas.z);
    this.heroWas.x = this.heroAt.x;
    this.heroWas.z = this.heroAt.z;
    const rig = this.heroRig;
    if (rig !== null) {
      // Тик миксера — безусловно и первым: без него клип не играется вовсе,
      // и герой остаётся в позе привязки, то есть стоит навытяжку с видом
      // «анимация сломана».
      rig.update(dt);
      if (moved > WALK_EPS) rig.play('ходьба', walkRate(CAMP_SPEED, VILLAGER_SCALE));
      else rig.play('покой');
    }
    // Жильцы стоят, но кадр у них обязан стареть: дыхание покоя — тоже клип.
    for (const man of this.folk) man.update(dt);

    this.syncSite(now);
    this.syncFire(now, day);
  }

  /**
   * Кухня и есть костёр лагеря: где у неё горит огонь, решает модель,
   * а `FireLight` ставит туда свет и гасит его на стадии без открытого огня.
   */
  private syncFire(now: number, day: number): void {
    const pos = this.camp.layout.kitchen;
    this.fire.set('kitchen', this.camp.levels.kitchen, pos.x + 0.5, pos.z + 0.5, BUILDING_SCALE);
    this.fire.update(now, day);
  }

  /** Площадка стройки — единственное, что мигает в лагере всегда. */
  private syncSite(now: number): void {
    const c = this.camp.construction;
    if (c === null) {
      if (this.site !== null) {
        this.site.removeFromParent();
        this.site = null;
      }
      return;
    }
    if (this.site === null) {
      this.site = new THREE.Mesh(
        this.track(new THREE.RingGeometry(1.0, 1.25, 24)),
        this.track(
          new THREE.MeshBasicMaterial({ color: 0xe2a33c, transparent: true, opacity: 0.6, fog: false }),
        ),
      );
      this.site.rotation.x = -Math.PI / 2;
      this.group.add(this.site);
    }
    const p = this.camp.layout[c.building];
    this.site.position.set(p.x + 0.5, 0.06, p.z + 0.5);
    (this.site.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(now / 380) * 0.25;
  }

  /** Тап по зданию — для перестановки (§20.4). */
  buildingAt(x: number, z: number): BuildingId | null {
    for (const id of builtBuildings(this.camp)) {
      const p = this.camp.layout[id];
      if (x >= p.x - 0.2 && x <= p.x + 2.2 && z >= p.z - 0.2 && z <= p.z + 2.2) return id;
    }
    return null;
  }

  highlight(id: BuildingId | null): void {
    for (const [bid, g] of this.buildings) {
      g.position.y = bid === id ? 0.12 : 0;
    }
  }

  /* ---------- стены лагеря (§12, §6.1.6) ---------- */

  /** Всё построенное игроком: одна группа, чтобы снести её одним движением. */
  private readonly walls = new THREE.Group();
  /** Призрак мазка: плоские пятна под пальцем, пока стену ведут. */
  private readonly ghost = new THREE.Group();
  private wallSignature = '';
  private readonly fences = new THREE.Group();
  private fenceSignature = '';

  /**
   * Мировая точка клетки стены. Клетка стены — квадрат `CASTLE_CELL` клеток
   * лагеря, и ноль детали стоит в его середине; поэтому к углу прибавляется
   * половина клетки лагеря, а не половина клетки стены.
   */
  private static at(spot: { x: number; z: number }): { x: number; z: number } {
    return { x: spot.x * CASTLE_CELL + 0.5, z: spot.z * CASTLE_CELL + 0.5 };
  }

  /**
   * Перестроить стены. Детали приходят готовым списком из `campWalls.ts`:
   * рендер не решает, что где стоит, — он ставит то, что решила симуляция.
   *
   * Подпись нужна, чтобы не пересобирать сцену на каждом кадре: стена меняется
   * тапом игрока, а кадров между тапами шестьдесят в секунду.
   */
  setWalls(pieces: readonly Piece[]): void {
    const signature = pieces.map((p) => `${p.model}${p.x},${p.z},${p.y},${p.turn}`).join('|');
    if (signature === this.wallSignature) return;
    this.wallSignature = signature;

    this.walls.clear();
    if (this.walls.parent === null) this.group.add(this.walls);
    if (pieces.length === 0) return;

    const byModel = new Map<string, Piece[]>();
    for (const piece of pieces) {
      const list = byModel.get(piece.model) ?? [];
      list.push(piece);
      byModel.set(piece.model, list);
    }

    const mat = this.track(castleMaterial());
    const dummy = new THREE.Object3D();
    for (const [model, list] of byModel) {
      const mesh = new THREE.InstancedMesh(
        castleGeometry(model as CastlePartModelName),
        mat,
        list.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const piece = list[i]!;
        const at = CampView.at(piece);
        dummy.position.set(at.x, piece.y * CASTLE_SCALE, at.z);
        dummy.rotation.set(0, (piece.turn * Math.PI) / 2, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      this.walls.add(mesh);
    }
  }

  /**
   * Перестроить ограду (§6.1.7). Тот же способ, что у стены, и та же подпись
   * против лишних пересборок; разница одна и она в координате: пролёт ограды
   * стоит **между** клетками, и `x` у него бывает половинным. Формула места
   * от этого не меняется — она и так переводит клетку стены в клетки лагеря
   * умножением, — и это единственная причина, по которой рендер ограды
   * не завёл своей арифметики.
   */
  setFences(pieces: readonly FencePiece[]): void {
    const signature = pieces.map((p) => `${p.model}${p.x},${p.z},${p.turn}`).join('|');
    if (signature === this.fenceSignature) return;
    this.fenceSignature = signature;

    this.fences.clear();
    if (this.fences.parent === null) this.group.add(this.fences);
    if (pieces.length === 0) return;

    const byModel = new Map<string, FencePiece[]>();
    for (const piece of pieces) {
      const list = byModel.get(piece.model) ?? [];
      list.push(piece);
      byModel.set(piece.model, list);
    }

    const mat = this.track(graveyardMaterial());
    const dummy = new THREE.Object3D();
    for (const [model, list] of byModel) {
      const mesh = new THREE.InstancedMesh(
        fenceGeometry(model as GraveyardPartModelName),
        mat,
        list.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const piece = list[i]!;
        const at = CampView.at(piece);
        dummy.position.set(at.x, MEADOW_Y, at.z);
        dummy.rotation.set(0, (piece.turn * Math.PI) / 2, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      this.fences.add(mesh);
    }
  }

  /**
   * Призрак стройки: плоские пятна на клетках, куда встанет стена. Зелёное —
   * встанет, красное — нет. Те же два цвета, что у места под здание:
   * «хорошо» и «плохо» обязаны говорить одним цветом во всей игре.
   */
  showWallGhost(cells: readonly { spot: Spot; ok: boolean }[]): void {
    this.ghost.clear();
    if (this.ghost.parent === null) this.group.add(this.ghost);
    for (const { spot, ok } of cells) {
      const plane = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(CASTLE_CELL * 0.92, CASTLE_CELL * 0.92)),
        this.track(new THREE.MeshBasicMaterial({
          color: ok ? PALETTE.siteOk : PALETTE.siteNo,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        })),
      );
      plane.rotation.x = -Math.PI / 2;
      const at = CampView.at(spot);
      plane.position.set(at.x, 0.07, at.z);
      this.ghost.add(plane);
    }
  }

  hideWallGhost(): void {
    this.ghost.clear();
  }

  /** Куда пришёл герой. Клетка — то же, что и в вылазке, плюс полклетки. */
  setHero(x: number, z: number, facing: number, y = 0): void {
    this.heroAt.x = x;
    this.heroAt.z = z;
    this.heroAt.y = y;
    this.heroFacing = facing;
  }

  get center(): { x: number; z: number } {
    const o = campOrigin(this.camp);
    return { x: o.x + this.area / 2, z: o.z + this.area / 2 };
  }

  /**
   * Площадка стоит на якоре (§16.1): вся сцена лагеря живёт в клетках
   * площади, и якорь применяется один раз — сдвигом группы, а не правкой
   * каждой координаты. Центр и тапы пересчитывает тот, кто ходит в мир.
   */
  private moveToOrigin(): void {
    const o = campOrigin(this.camp);
    this.group.position.set(o.x, 0, o.z);
  }

  dispose(): void {
    this.group.removeFromParent();
    // Скелеты освобождаются поимённо: у рига свои буферы, и общий обход
    // `disposables` про них не знает.
    this.heroRig?.dispose();
    this.heroRig = null;
    for (const man of this.folk) man.dispose();
    this.folk.length = 0;
    this.meadow?.dispose();
    this.fire.dispose();
    this.meadow = null;
    this.groundMesh.dispose();
    // Геометрия леса общая на страницу (кэш forest.ts) — освобождаются только
    // буферы экземпляров.
    for (const mesh of this.forest.children) {
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    for (const mesh of this.stones.values()) mesh.removeFromParent();
    this.stones.clear();
    this.stoneHits.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.buildings.clear();
  }
}
