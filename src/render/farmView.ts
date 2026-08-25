import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MATERIAL, PALETTE } from './palette';
import { FARM_CROPS, farmPlotIsActive, farmPlotReadyAt } from '../sim/farm';
import type { FarmCropId, FarmState } from '../sim/farm';

interface FarmCropView {
  readonly group: THREE.Group;
  readonly produce: readonly THREE.Object3D[];
}

interface FarmPlotView {
  readonly x: number;
  readonly crops: Readonly<Record<FarmCropId, FarmCropView>>;
  readonly blocked: THREE.Group;
}

const BARN_MODEL_URL = `${import.meta.env.BASE_URL}assets/farm/barn.glb`;
const BARN_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/farm/barn.webp`;
const FARMHOUSE_MODEL_URL = `${import.meta.env.BASE_URL}assets/farm/farmhouse.glb`;
const FARMHOUSE_TEXTURE_URL = `${import.meta.env.BASE_URL}assets/farm/farmhouse.webp`;

/**
 * Первый вид Фермы: шесть длинных грядок — те же шесть слотов симуляции.
 * Геометрия не хранит состояние: при входе и в кадре она читает `FarmState`,
 * поэтому перезагрузка и офлайновое дозревание выглядят одинаково.
 */
export class FarmView {
  readonly group = new THREE.Group();
  readonly center = { x: 6.5, z: 4.5 };
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly plots: FarmPlotView[] = [];
  private readonly fence = new THREE.Group();
  private readonly well = new THREE.Group();
  private barn: THREE.Object3D | null = null;
  private farmhouse: THREE.Object3D | null = null;
  private barnLoading: Promise<void> | null = null;
  private farmhouseLoading: Promise<void> | null = null;
  private disposed = false;

  constructor() {
    this.group.add(this.fence, this.well);
    this.buildGround();
    this.buildBeds();
    this.buildFence();
    this.buildFarmProps();
    this.group.visible = false;
  }

  private geometry<T extends THREE.BufferGeometry>(value: T): T {
    this.geometries.push(value);
    return value;
  }

  private material<T extends THREE.Material>(value: T): T {
    this.materials.push(value);
    return value;
  }

  private box(
    size: [number, number, number],
    color: number,
    at: [number, number, number],
    parent: THREE.Object3D = this.group,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geometry(new THREE.BoxGeometry(...size)),
      this.material(new THREE.MeshLambertMaterial({ color })),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildGround(): void {
    this.box([14, 0.35, 10], PALETTE.grassBase, [6.5, -0.2, 4.5]);
    // Тропа связывает вход с сараем и делит поле на читаемые участки.
    this.box([1.1, 0.06, 8.6], MATERIAL['солома'], [4.5, 0.01, 4.7]);
  }

  private buildBeds(): void {
    const soil = MATERIAL['земля'];
    const green = MATERIAL['трава'];
    const leaf = MATERIAL['хвоя'];
    const stemGeo = this.geometry(new THREE.CylinderGeometry(0.025, 0.035, 0.28, 5));
    const leafGeo = this.geometry(new THREE.ConeGeometry(0.12, 0.25, 5));
    const turnipGeo = this.geometry(new THREE.SphereGeometry(0.13, 6, 5));
    const turnipCapGeo = this.geometry(new THREE.SphereGeometry(0.09, 6, 5));
    const barleyStemGeo = this.geometry(new THREE.CylinderGeometry(0.014, 0.022, 0.48, 5));
    const barleyHeadGeo = this.geometry(new THREE.ConeGeometry(0.055, 0.2, 5));
    const barrierGeo = this.geometry(new THREE.BoxGeometry(0.65, 0.1, 0.15));
    const stemMat = this.material(new THREE.MeshLambertMaterial({ color: green }));
    const leafMat = this.material(new THREE.MeshLambertMaterial({ color: leaf }));
    const turnipMat = this.material(new THREE.MeshLambertMaterial({ color: MATERIAL['кожа'] }));
    const turnipCapMat = this.material(new THREE.MeshLambertMaterial({ color: MATERIAL['сукно'] }));
    const barleyMat = this.material(new THREE.MeshLambertMaterial({ color: MATERIAL['латунь'] }));
    const barrierMat = this.material(new THREE.MeshLambertMaterial({ color: MATERIAL['дерево-тень'] }));

    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const x = 4.5 + side * (1.45 + row * 0.72);
        this.box([0.48, 0.14, 6.4], soil, [x, 0, 4.7]);
        const turnip = new THREE.Group();
        const barley = new THREE.Group();
        const blocked = new THREE.Group();
        const turnips: THREE.Object3D[] = [];
        const barleyHeads: THREE.Object3D[] = [];
        for (let z = 2; z <= 7.4; z += 0.9) {
          const stem = new THREE.Mesh(stemGeo, stemMat);
          stem.position.set(x, 0.2, z);
          const crown = new THREE.Mesh(leafGeo, leafMat);
          crown.position.set(x, 0.43, z);
          crown.rotation.y = (row + z) * 0.7;
          crown.castShadow = true;
          const root = new THREE.Mesh(turnipGeo, turnipMat);
          root.position.set(x, 0.15, z + 0.05);
          root.scale.set(0.9, 1.05, 0.9);
          root.castShadow = true;
          const cap = new THREE.Mesh(turnipCapGeo, turnipCapMat);
          cap.position.set(x, 0.22, z + 0.05);
          cap.scale.set(1, 0.5, 1);
          turnips.push(root, cap);
          turnip.add(stem, crown, root, cap);

          for (const offset of [-0.09, 0.08]) {
            const straw = new THREE.Mesh(barleyStemGeo, barleyMat);
            straw.position.set(x + offset, 0.29, z + offset * 0.7);
            straw.rotation.z = offset * 0.7;
            const head = new THREE.Mesh(barleyHeadGeo, barleyMat);
            head.position.set(x + offset * 1.4, 0.58, z + offset * 0.7);
            head.rotation.z = offset * 1.5;
            head.castShadow = true;
            barleyHeads.push(head);
            barley.add(straw, head);
          }
        }
        // Три крестовины читаются как временно закрытая полоса, а не как
        // ещё одна пустая грядка, которую игра почему-то не принимает.
        for (const z of [2.2, 4.7, 7.2]) {
          for (const angle of [-0.42, 0.42]) {
            const barrier = new THREE.Mesh(barrierGeo, barrierMat);
            barrier.position.set(x, 0.17, z);
            barrier.rotation.y = angle;
            barrier.castShadow = true;
            blocked.add(barrier);
          }
        }
        turnip.visible = false;
        barley.visible = false;
        blocked.visible = false;
        this.group.add(turnip, barley, blocked);
        this.plots.push({
          x,
          crops: {
            turnip: { group: turnip, produce: turnips },
            barley: { group: barley, produce: barleyHeads },
          },
          blocked,
        });
      }
    }
  }

  /** Какая грядка лежит под точкой земли; полосы нарочно щедрее геометрии для пальца. */
  plotAt(point: Readonly<{ x: number; z: number }>): number | null {
    if (point.z < 1.35 || point.z > 7.95) return null;
    let nearestIndex: number | null = null;
    let nearestDistance = Infinity;
    for (let index = 0; index < this.plots.length; index += 1) {
      const plot = this.plots[index]!;
      const distance = Math.abs(point.x - plot.x);
      if (distance <= 0.34 && distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    return nearestIndex;
  }

  /** Мировой якорь награды над грядкой; индекс тот же, что у симуляции. */
  plotCenter(index: number): { x: number; y: number; z: number } | null {
    const plot = this.plots[index];
    return plot === undefined ? null : { x: plot.x, y: 0.62, z: 4.7 };
  }

  /** Рост только меняет показ; момент созревания решает `sim/farm.ts`. */
  sync(farm: FarmState | undefined, now: number): void {
    const structures = farm?.story.structures;
    this.fence.visible = structures?.fence === true;
    this.well.visible = structures?.well === true;
    if (this.group.visible && structures?.barn === true) this.ensureBarn();
    if (this.group.visible && structures?.farmhouse === true) this.ensureFarmhouse();
    if (this.barn !== null) this.barn.visible = structures?.barn === true;
    if (this.farmhouse !== null) this.farmhouse.visible = structures?.farmhouse === true;
    this.plots.forEach((view, index) => {
      const plot = farm?.plots[index] ?? null;
      view.blocked.visible = farm !== undefined && plot === null && !farmPlotIsActive(farm, index);
      for (const cropView of Object.values(view.crops)) cropView.group.visible = false;
      if (farm === undefined || plot === null) {
        return;
      }
      const ready = now >= farmPlotReadyAt(plot);
      const progress = ready
        ? 1
        : Math.max(0, Math.min(1, (now - plot.plantedAt) / FARM_CROPS[plot.crop].growSeconds));
      const cropView = view.crops[plot.crop];
      cropView.group.visible = true;
      cropView.group.scale.set(1, 0.25 + progress * 0.75, 1);
      for (const produce of cropView.produce) produce.visible = ready;
    });
  }

  private buildFence(): void {
    const wood = MATERIAL['дерево'];
    for (let x = 0; x <= 13; x++) {
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 0], this.fence);
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 9], this.fence);
    }
    for (let z = 1; z < 9; z++) {
      this.box([0.09, 0.65, 0.09], wood, [0, 0.3, z], this.fence);
      this.box([0.09, 0.65, 0.09], wood, [13, 0.3, z], this.fence);
    }
    this.box([13, 0.1, 0.1], wood, [6.5, 0.48, 0], this.fence);
    this.box([13, 0.1, 0.1], wood, [6.5, 0.48, 9], this.fence);
    this.box([0.1, 0.1, 9], wood, [0, 0.48, 4.5], this.fence);
    this.box([0.1, 0.1, 9], wood, [13, 0.48, 4.5], this.fence);
  }

  private buildFarmProps(): void {
    const dark = MATERIAL['дерево-тень'];
    // Бочки и ящики дают масштабу хозяйственный, а не декоративный смысл.
    this.box([0.55, 0.55, 0.55], MATERIAL['солома'], [6.2, 0.27, 8.1]);
    const barrel = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.32, 0.32, 0.65, 10)),
      this.material(new THREE.MeshLambertMaterial({ color: dark })),
    );
    barrel.position.set(2.9, 0.32, 8.1);
    barrel.castShadow = true;
    this.group.add(barrel);

    // Колодец появляется отдельной стадией и одновременно открывает ещё две
    // грядки. Простая геометрия остаётся в палитре игры; здания идут из пака.
    const stone = MATERIAL['камень'];
    const ring = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.58, 0.65, 0.58, 12, 1, true)),
      this.material(new THREE.MeshLambertMaterial({ color: stone, side: THREE.DoubleSide })),
    );
    ring.position.set(8.35, 0.3, 3.1);
    ring.castShadow = true;
    this.well.add(ring);
    this.box([0.1, 1.25, 0.1], dark, [7.85, 0.72, 3.1], this.well);
    this.box([0.1, 1.25, 0.1], dark, [8.85, 0.72, 3.1], this.well);
    this.box([1.25, 0.1, 0.1], dark, [8.35, 1.27, 3.1], this.well);
  }

  /**
   * Амбар из Farmhouse Pack грузится только при первом входе на ферму.
   */
  private ensureBarn(): void {
    if (this.barnLoading !== null || this.disposed) return;
    this.barnLoading = this.loadBuilding(BARN_MODEL_URL, BARN_TEXTURE_URL, 1.6, 4.5, 8.05, Math.PI / 2)
      .then((scene) => { this.barn = scene; })
      .catch((error: unknown) => console.warn(`Не удалось загрузить амбар ${BARN_MODEL_URL}`, error));
  }

  private ensureFarmhouse(): void {
    if (this.farmhouseLoading !== null || this.disposed) return;
    this.farmhouseLoading = this.loadBuilding(FARMHOUSE_MODEL_URL, FARMHOUSE_TEXTURE_URL, 2.2, 10.3, 6.9, 0)
      .then((scene) => { this.farmhouse = scene; })
      .catch((error: unknown) => console.warn(`Не удалось загрузить дом ${FARMHOUSE_MODEL_URL}`, error));
  }

  private async loadBuilding(
    modelUrl: string,
    textureUrl: string,
    height: number,
    x: number,
    z: number,
    rotation: number,
  ): Promise<THREE.Object3D | null> {
    const [{ scene }, map] = await Promise.all([
      new GLTFLoader().loadAsync(modelUrl),
      new THREE.TextureLoader().loadAsync(textureUrl),
    ]);
      if (this.disposed) {
        map.dispose();
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        return null;
      }
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.anisotropy = 4;
      this.textures.push(map);
      const material = this.material(new THREE.MeshLambertMaterial({ map }));
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const previous = child.material;
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
        this.geometries.push(child.geometry);
        if (Array.isArray(previous)) previous.forEach((value) => value.dispose());
        else previous.dispose();
      });
      scene.updateMatrixWorld(true);
      const initial = new THREE.Box3().setFromObject(scene);
      const size = initial.getSize(new THREE.Vector3());
      scene.scale.setScalar(height / Math.max(size.y, 0.001));
      scene.rotation.y = rotation;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      scene.position.set(x - center.x, -box.min.y, z - center.z);
      this.group.add(scene);
      return scene;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
