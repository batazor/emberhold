import * as THREE from 'three';
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

/**
 * Первый вид Фермы: шесть длинных грядок — те же шесть слотов симуляции.
 * Геометрия не хранит состояние: при входе и в кадре она читает `FarmState`,
 * поэтому перезагрузка и офлайновое дозревание выглядят одинаково.
 */
export class FarmView {
  readonly group = new THREE.Group();
  readonly center = { x: 4.5, z: 4.5 };
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly plots: FarmPlotView[] = [];

  constructor() {
    this.buildGround();
    this.buildBeds();
    this.buildFence();
    this.buildShed();
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
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geometry(new THREE.BoxGeometry(...size)),
      this.material(new THREE.MeshLambertMaterial({ color })),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildGround(): void {
    this.box([10, 0.35, 10], PALETTE.grassBase, [4.5, -0.2, 4.5]);
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

  /** Рост только меняет показ; момент созревания решает `sim/farm.ts`. */
  sync(farm: FarmState | undefined, now: number): void {
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
    for (let x = 0; x <= 9; x++) {
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 0]);
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 9]);
    }
    for (let z = 1; z < 9; z++) {
      this.box([0.09, 0.65, 0.09], wood, [0, 0.3, z]);
      this.box([0.09, 0.65, 0.09], wood, [9, 0.3, z]);
    }
    this.box([9, 0.1, 0.1], wood, [4.5, 0.48, 0]);
    this.box([9, 0.1, 0.1], wood, [4.5, 0.48, 9]);
    this.box([0.1, 0.1, 9], wood, [0, 0.48, 4.5]);
    this.box([0.1, 0.1, 9], wood, [9, 0.48, 4.5]);
  }

  private buildShed(): void {
    const wall = MATERIAL['дерево-свет'];
    const dark = MATERIAL['дерево-тень'];
    this.box([2.2, 1.55, 1.8], wall, [4.5, 0.78, 8.05]);
    this.box([0.65, 1.2, 0.08], dark, [4.5, 0.58, 7.1]);
    const roof = this.box([2.65, 0.18, 2.15], dark, [4.5, 1.68, 8.05]);
    roof.rotation.z = 0.08;
    // Бочки и ящики дают масштабу хозяйственный, а не декоративный смысл.
    this.box([0.55, 0.55, 0.55], MATERIAL['солома'], [6.2, 0.27, 8.1]);
    const barrel = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.32, 0.32, 0.65, 10)),
      this.material(new THREE.MeshLambertMaterial({ color: dark })),
    );
    barrel.position.set(2.9, 0.32, 8.1);
    barrel.castShadow = true;
    this.group.add(barrel);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
