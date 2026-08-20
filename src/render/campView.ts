import * as THREE from 'three';
import { BUILDING_ORDER, builtBuildings, campArea, villagerCount } from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { HERO_SPEED } from '../sim/config';
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

const BUILDING_COLOR: Record<BuildingId, number> = {
  hq: 0x8a7a5c,
  kitchen: 0x8d6a4a,
  storage: 0x6f6a58,
  // Кузница — единственная холодная постройка: сталь опознаётся раньше формы
  // (buildart.html §05).
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

  update(dt: number, now: number): void {
    this.rebuildBuildings();

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
    this.groundMesh.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.buildings.clear();
    this.villagers.length = 0;
  }
}
