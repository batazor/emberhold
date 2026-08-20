import * as THREE from 'three';
import { blockingMaterial } from './blocking';
import { buildingGeometry, heroGeometry, villagerGeometry } from './models';
import { BUILDING_ORDER, builtBuildings, campArea, villagerCount } from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { HERO_SPEED } from '../sim/config';
import { FluffyGrass } from './fluffyGrass';

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
 * Артбук рисует модели в своих габаритах — палатка с растяжками почти четыре
 * единицы в ширину. В лагере под здание отведено 2×2 клетки (§20.4), поэтому
 * блокинг приводится к следу здесь, а не пересчётом чисел в самих моделях:
 * так они остаются построчно сверяемыми со страницей артбука.
 */
const BUILDING_SCALE = 0.55;
/** Житель ростом с клетку читается рядом со зданием, а не как игрушка. */
const VILLAGER_SCALE = 0.62;

export class CampView {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<BuildingId, THREE.Group>();
  private readonly villagers: Villager[] = [];
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private hero!: THREE.Mesh;
  private site: THREE.Mesh | null = null;
  private area = 6;
  private builtLevels = '';

  /** Один материал на все модели артбука: цвет приходит вершинами (§6.1). */
  private readonly blocking = this.track(blockingMaterial());

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
  }

  private groundMesh!: THREE.InstancedMesh;
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
    const y = -0.02;

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

  /** Герой в лагере — та же модель, что уходит в вылазку (артбук, 04). */
  private buildHero(): void {
    this.hero = new THREE.Mesh(this.track(heroGeometry('ranger')), this.blocking);
    this.hero.castShadow = true;
    this.hero.scale.setScalar(VILLAGER_SCALE);
    this.group.add(this.hero);
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
    // Площадь изменилась — трава отступает с новых клеток.
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
      const mesh = new THREE.Mesh(this.track(villagerGeometry()), this.blocking);
      mesh.scale.setScalar(VILLAGER_SCALE);
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
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.buildings.clear();
    this.villagers.length = 0;
  }
}
