import * as THREE from 'three';
import { BUILDING_ORDER, builtBuildings, campArea, villagerCount } from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { HERO_SPEED } from '../sim/config';
import { FluffyGrass } from './fluffyGrass';
import { forestGeometry, forestMaterial } from './forest';
import type { ForestModelName } from './forest';
import { PALETTE } from './palette';

/**
 * Сцена лагеря по camp.html: жители ходят и работают, стройка видна по
 * маршрутам, герой стоит у Штаба. Жители — не юниты: тап по ним ничего
 * не делает, и это решение, а не недоделка.
 */
interface Villager {
  readonly mesh: THREE.Mesh;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  /** Секунды работы на месте; пока > 0 — стоит и «работает». */
  working: number;
}

/**
 * Лес вокруг поляны (§6.1, набор KayKit Forest). Лагерь стоит на поляне
 * с нулевого кадра онбординга — деревья не добавляют миру ничего нового,
 * они делают видимым то, что уже сказано. Растут они только за площадью
 * лагеря, поэтому рост Штаба читается ещё и как отступающий лес.
 */
const CAMP_TREES: readonly ForestModelName[] = [
  'Tree_1_A_Color1',
  'Tree_2_B_Color1',
  'Tree_4_A_Color1',
  'Tree_Bare_2_B_Color1',
];
const CAMP_ROCKS: readonly ForestModelName[] = ['Rock_1_G_Color1', 'Rock_3_H_Color1'];

/** Уровень земли вокруг площадки: луг из buildMeadow, на нём же стоит лес. */
const MEADOW_Y = -0.02;

/** Насколько далеко за поляну уходит лес, в клетках. */
const FOREST_DEPTH = 5;
/** Полоса между поляной и первым деревом: иначе лес закрывает крайние здания. */
const FOREST_GAP = 2;

/** Детерминированный шум по координате — тот же приём, что у земли. */
const noise = (x: number, z: number): number =>
  (((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) + 1) % 1;

const BUILDING_COLOR: Record<BuildingId, number> = {
  hq: 0x8a7a5c,
  kitchen: 0x8d6a4a,
  storage: 0x6f6a58,
  // Кузница — единственная холодная постройка: сталь опознаётся раньше формы
  // (блокинг в buildart.html, раздел про Кузницу).
  forge: 0x5e5a52,
};

export class CampView {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<BuildingId, THREE.Group>();
  private readonly villagers: Villager[] = [];
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private hero!: THREE.Mesh;
  private site: THREE.Mesh | null = null;
  private area = 6;
  private builtLevels = '';

  constructor(private camp: CampState) {
    this.buildGround();
    this.buildMeadow();
    this.buildHero();
    this.rebuildBuildings();
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
   * лагеря ещё нет, и отступают на клетку с каждым уровнем Штаба.
   */
  private buildForest(area: number): void {
    for (const child of [...this.forest.children]) child.removeFromParent();
    this.forestMat ??= this.track(forestMaterial());

    const models = [...CAMP_TREES, ...CAMP_ROCKS];
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
        forestGeometry(models[m]!, 1),
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
   * и трава под Штабом торчала бы сквозь него.
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
      // Запрет читает текущую площадь: она растёт со Штабом, и после роста
      // луг пересевается (rebuildBuildings).
      reject: (x, z) => {
        const edge = this.area - 0.5 + 0.7;
        return x > -1.2 && x < edge && z > -1.2 && z < edge;
      },
    });
    this.group.add(this.meadow.group);
  }

  private buildHero(): void {
    this.hero = new THREE.Mesh(
      this.track(new THREE.CapsuleGeometry(0.22, 0.44, 4, 10)),
      this.track(new THREE.MeshLambertMaterial({ color: PALETTE.heroCloak, flatShading: true })),
    );
    this.hero.castShadow = true;
    this.group.add(this.hero);
  }

  /**
   * §6.1: стадии роста — замена меша, а не отдельный рисунок. Пока моделей нет,
   * стадия выражена габаритом и надстройками: силуэт обязан читаться без цифр.
   */
  private makeBuilding(id: BuildingId, level: number): THREE.Group {
    const g = new THREE.Group();
    const stage = level <= 2 ? 0 : level <= 4 ? 1 : 2;
    const h = 0.7 + stage * 0.45;
    const w = 1.3 + stage * 0.25;
    const mat = this.track(
      new THREE.MeshLambertMaterial({ color: BUILDING_COLOR[id], flatShading: true }),
    );
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, w)), mat);
    base.position.y = h / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const roof = new THREE.Mesh(
      this.track(new THREE.ConeGeometry(w * 0.82, 0.5 + stage * 0.2, 4)),
      this.track(new THREE.MeshLambertMaterial({ color: 0x53412f, flatShading: true })),
    );
    roof.position.y = h + 0.25 + stage * 0.1;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);

    if (stage >= 1) {
      const tower = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.35, 0.6 + stage * 0.3, 0.35)),
        mat,
      );
      tower.position.set(w * 0.4, h + 0.3, -w * 0.4);
      tower.castShadow = true;
      g.add(tower);
    }
    return g;
  }

  /** Пересобирает постройки, только если изменились уровни или площадь. */
  rebuildBuildings(): void {
    const signature = BUILDING_ORDER.map((id) => `${id}${this.camp.levels[id]}`).join('|');
    const area = campArea(this.camp.levels.hq);
    if (signature === this.builtLevels && area === this.area) return;
    this.builtLevels = signature;
    this.area = area;

    for (const [, g] of this.buildings) g.removeFromParent();
    this.buildings.clear();

    // Уровень 0 — это пустое место, а не здание нулевого размера: Кузница
    // до Штаба ур. 2 не рисуется вовсе.
    for (const id of builtBuildings(this.camp)) {
      const g = this.makeBuilding(id, this.camp.levels[id]);
      const pos = this.camp.layout[id];
      g.position.set(pos.x + 0.5, 0, pos.z + 0.5);
      this.group.add(g);
      this.buildings.set(id, g);
    }

    // Земля показывает ровно текущую площадь: рост Штаба виден как рост лагеря.
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
    this.syncVillagers();
  }

  setCamp(camp: CampState): void {
    this.camp = camp;
    this.builtLevels = '';
    this.rebuildBuildings();
  }

  /** Число жителей выводится из развития лагеря, а не назначается. */
  private syncVillagers(): void {
    const want = villagerCount(this.camp);
    while (this.villagers.length > want) {
      this.villagers.pop()?.mesh.removeFromParent();
    }
    while (this.villagers.length < want) {
      const mesh = new THREE.Mesh(
        this.track(new THREE.CapsuleGeometry(0.15, 0.3, 3, 6)),
        this.track(new THREE.MeshLambertMaterial({ color: 0xc9bfa2, flatShading: true })),
      );
      mesh.castShadow = true;
      const start = this.pickTarget();
      this.villagers.push({ mesh, x: start.x, z: start.z, targetX: start.x, targetZ: start.z, working: 0 });
      this.group.add(mesh);
    }
  }

  /** Стройка видна по маршрутам: треть маршрутов ведёт на площадку. */
  private pickTarget(): { x: number; z: number } {
    const c = this.camp.construction;
    if (c !== null && Math.random() < 1 / 3) {
      const p = this.camp.layout[c.building];
      return { x: p.x + 0.5, z: p.z + 1.6 };
    }
    const built = builtBuildings(this.camp);
    const id = built[Math.floor(Math.random() * built.length)] ?? 'hq';
    const p = this.camp.layout[id];
    const angle = Math.random() * Math.PI * 2;
    return { x: p.x + 0.5 + Math.cos(angle) * 1.3, z: p.z + 0.5 + Math.sin(angle) * 1.3 };
  }

  update(dt: number, now: number, day = 1): void {
    this.rebuildBuildings();
    this.meadow?.update(now / 1000);
    // Трава FluffyGrass сама себе освещение, поэтому время суток ей
    // передаётся числом: иначе вечерний лагерь стоит в полуденной траве.
    this.meadow?.setLight(0.35 + day * 0.65);

    const hqPos = this.camp.layout.hq;
    this.hero.position.set(hqPos.x + 1.9, 0.55, hqPos.z + 0.5);

    for (const v of this.villagers) {
      if (v.working > 0) {
        v.working -= dt;
        // Работа читается движением, а не анимацией: пока клипов нет,
        // житель покачивается на месте.
        v.mesh.position.y = 0.35 + Math.sin(now / 120 + v.x) * 0.03;
        if (v.working <= 0) {
          const t = this.pickTarget();
          v.targetX = t.x;
          v.targetZ = t.z;
        }
        continue;
      }
      const dx = v.targetX - v.x;
      const dz = v.targetZ - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        v.working = 2 + Math.random() * 3; // 2–5 секунд у здания
        continue;
      }
      // Та же скорость, что в вылазке: разный темп читается как ошибка.
      const step = Math.min(dist, HERO_SPEED * dt);
      v.x += (dx / dist) * step;
      v.z += (dz / dist) * step;
      v.mesh.position.set(v.x, 0.35, v.z);
      v.mesh.rotation.y = Math.atan2(dx, dz);
    }

    this.syncSite(now);
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

  /** Тап по зданию — для перестановки (§20.4). Жители не откликаются намеренно. */
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

  get center(): { x: number; z: number } {
    return { x: this.area / 2, z: this.area / 2 };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.meadow?.dispose();
    this.meadow = null;
    this.groundMesh.dispose();
    // Геометрия леса общая на страницу (кэш forest.ts) — освобождаются только
    // буферы экземпляров.
    for (const mesh of this.forest.children) {
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.buildings.clear();
    this.villagers.length = 0;
  }
}
