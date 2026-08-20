import * as THREE from 'three';
import { blockingMaterial } from './blocking';
import { enemyGeometry, heroGeometry } from './models';
import { ENEMY_STATS } from '../sim/enemies';
import { idx } from '../sim/grid';
import type { Enemy, EnemyKind, GameLocation, RaidState } from '../sim/types';
import type { HeroClassId } from '../sim/heroes';
import { Grass, tileNoise } from './grass';
import type { Pusher } from './grass';
import { PALETTE } from './palette';

/**
 * Вид вылазки: строит меши из состояния и синхронизирует их каждый кадр.
 * Симуляция об этом модуле не знает — она не импортирует three (DESIGN §6).
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface EnemyView {
  readonly mesh: THREE.Mesh;
  readonly base: THREE.MeshLambertMaterial;
  readonly hot: THREE.MeshLambertMaterial;
}

export class RaidView {
  readonly group = new THREE.Group();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly containerMeshes = new Map<number, THREE.Mesh>();
  private hero!: THREE.Group;
  private marker!: THREE.Mesh;
  /** Точка тапа из кадра 1 онбординга: единственная подсказка, которая
   *  показывает жест вместо того, чтобы называть его словами. */
  private hintRing!: THREE.Mesh;
  private evacRing!: THREE.Mesh;
  private grass: Grass | null = null;
  /** Переиспользуемые слоты толчка: аллокация каждый кадр тут не нужна. */
  private readonly pushers: { x: number; z: number; strength: number }[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  /** Один материал на все модели артбука: цвет приходит вершинами (§6.1). */
  private readonly blocking = this.track(blockingMaterial());

  constructor(
    private readonly loc: GameLocation,
    private readonly heroClass: HeroClassId = 'ranger',
    grassPerTile = 24,
  ) {
    this.buildGround();
    this.buildGrass(grassPerTile);
    this.buildRocks();
    this.buildEvac();
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
    this.grass = new Grass(this.loc, perTile);
    this.group.add(this.grass.mesh);
  }

  /** Отладочный орган управления, как ползунок «Ночь»: это замер, не механика. */
  setGrassDensity(perTile: number): void {
    this.grass?.setDensity(perTile);
  }

  get grassBlades(): number {
    return this.grass?.blades ?? 0;
  }

  private buildRocks(): void {
    const { size, blocked } = this.loc;
    let count = 0;
    for (let i = 0; i < blocked.length; i++) if (blocked[i]) count++;

    const geo = this.track(new THREE.DodecahedronGeometry(0.62, 0));
    const mat = this.track(new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true }));
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let i = 0;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        if (!blocked[idx(size, x, z)]) continue;
        const v = ((Math.sin(x * 3.1 + z * 7.7) * 1000) % 1 + 1) % 1;
        const s = 0.75 + v * 0.6;
        dummy.position.set(x + (v - 0.5) * 0.2, s * 0.35 - 0.1, z + (v - 0.5) * 0.15);
        dummy.rotation.set(v * 3, v * 6.28, v * 2);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    this.group.add(mesh);
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

  private buildContainers(): void {
    const geo = this.track(new THREE.OctahedronGeometry(0.26, 0));
    const mat = this.track(
      // Без emissive: светящаяся добыча видна за пределами круга света и
      // обесценивает обзор из §11.4. Подсветку жилы даёт карта «Чутьё на жилу».
      new THREE.MeshLambertMaterial({ color: PALETTE.loot, flatShading: true }),
    );
    for (const c of this.loc.containers) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.position.set(c.x, 0.45, c.z);
      this.group.add(mesh);
      this.containerMeshes.set(c.id, mesh);
    }
  }

  /**
   * Противники — модели артбука (раздел 04). Различаются силуэтом раньше,
   * чем цветом: за пределами фонаря цвет пропадает первым.
   *
   * Геометрия и материалы общие на вид, а не на особь: на ярусе 3 их девять,
   * и девять одинаковых материалов — это девять лишних состояний GPU.
   */
  private buildEnemies(): void {
    const shapes = new Map<EnemyKind, THREE.BufferGeometry>();
    const hots = new Map<EnemyKind, THREE.MeshLambertMaterial>();
    const shapeOf = (kind: EnemyKind): THREE.BufferGeometry => {
      const found = shapes.get(kind);
      if (found !== undefined) return found;
      const made = this.track(enemyGeometry(kind));
      shapes.set(kind, made);
      return made;
    };
    // §17.3: замах обязан быть виден заранее. Пока клипов нет, телеграф —
    // эмиссия материала; с анимацией это станет клипом замаха.
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
      const mesh = new THREE.Mesh(shapeOf(e.kind), this.blocking);
      mesh.castShadow = true;
      mesh.position.set(e.x, 0, e.z);
      this.group.add(mesh);
      this.enemyViews.set(e.id, { mesh, base: this.blocking, hot: hotOf(e.kind) });
    }
  }

  /**
   * Герой — модель своего класса (артбук, 04). Фонарь остаётся отдельным
   * мешем без тумана: он источник света в кадре, а не деталь силуэта.
   */
  private buildHero(): void {
    this.hero = new THREE.Group();
    const body = new THREE.Mesh(this.track(heroGeometry(this.heroClass)), this.blocking);
    body.castShadow = true;
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
  sync(state: RaidState, alpha: number, dt: number, time: number): void {
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
    this.hero.children[0]!.position.y =
      0.6 + (state.path.length > 0 ? Math.sin(time / 90) * 0.04 : 0);

    for (const e of this.loc.enemies) {
      const view = this.enemyViews.get(e.id);
      if (view === undefined) continue;
      if (e.wounds <= 0) {
        view.mesh.visible = false;
        continue;
      }
      view.mesh.position.set(
        lerp(e.prevX, e.x, alpha),
        0.45 + Math.sin(time / 420 + e.id) * 0.04,
        lerp(e.prevZ, e.z, alpha),
      );
      view.mesh.material = e.telegraph > 0 ? view.hot : view.base;
      view.mesh.rotation.y += dt * (e.awake ? 2.5 : 0.5);
      this.scaleByWounds(view.mesh, e);
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

    this.syncGrass(hx, hz, time);

    const ringMat = this.evacRing.material as THREE.MeshBasicMaterial;
    ringMat.opacity = 0.5 + Math.sin(time / 400) * 0.25;
    this.evacRing.scale.setScalar(1 + Math.sin(time / 400) * 0.05);

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
      slots.push({ x: e.x, z: e.z, strength: e.kind === 'golem' ? 1.4 : 0.9 });
    }
    this.grass.update(time / 1000, slots as readonly Pusher[]);
  }

  /** Раны видны на силуэте: подранок ниже. Полоски здоровья в игре нет (§11.3). */
  private scaleByWounds(mesh: THREE.Mesh, e: Enemy): void {
    const max = ENEMY_STATS[e.kind].wounds;
    mesh.scale.setScalar(0.7 + 0.3 * (e.wounds / max));
  }

  dispose(): void {
    this.grass?.dispose();
    this.grass = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.enemyViews.clear();
    this.containerMeshes.clear();
  }
}
