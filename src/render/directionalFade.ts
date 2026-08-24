import * as THREE from 'three';

/** Четыре стороны постройки в порядке −x, +x, −z, +z. */
export type FadeSide = 0 | 1 | 2 | 3;

const SIDE: readonly { readonly x: number; readonly z: number }[] = [
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: 0, z: 1 },
];

const smoothstep = (a: number, b: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * К какой стороне центра относится деталь. Угловая деталь достаётся стороне,
 * вдоль которой она дальше от центра: четыре корзины вместо материала на
 * каждый экземпляр сохраняют инстансинг стен.
 */
export function fadeSide(x: number, z: number, centerX: number, centerZ: number): FadeSide {
  const dx = x - centerX;
  const dz = z - centerZ;
  if (Math.abs(dx) > Math.abs(dz)) return dx < 0 ? 0 : 1;
  return dz < 0 ? 2 : 3;
}

/** Целевая прозрачность каждой стороны для данного положения камеры. */
export function fadeGoals(
  cameraX: number,
  cameraZ: number,
  centerX: number,
  centerZ: number,
  clear: number,
  active = true,
): readonly [number, number, number, number] {
  if (!active) return [1, 1, 1, 1];
  const dx = cameraX - centerX;
  const dz = cameraZ - centerZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) return [1, 1, 1, 1];
  const vx = dx / length;
  const vz = dz / length;
  return SIDE.map((side) => {
    const facing = vx * side.x + vz * side.z;
    const share = smoothstep(0.1, 0.8, facing);
    return 1 + (clear - 1) * share;
  }) as [number, number, number, number];
}

/**
 * Четыре общих материала и четыре набора инстансов. Камера гасит только
 * ближнюю сторону постройки; дальняя продолжает писать глубину и тени.
 */
export class DirectionalFade {
  private readonly materials: readonly THREE.MeshLambertMaterial[];
  private readonly meshes: readonly Set<THREE.InstancedMesh>[] = [
    new Set(), new Set(), new Set(), new Set(),
  ];

  constructor(
    material: () => THREE.MeshLambertMaterial,
    private readonly clear = 0.45,
  ) {
    this.materials = [material(), material(), material(), material()];
  }

  material(side: FadeSide): THREE.MeshLambertMaterial {
    return this.materials[side]!;
  }

  add(mesh: THREE.InstancedMesh, side: FadeSide): void {
    this.meshes[side]!.add(mesh);
  }

  clearMeshes(): void {
    for (const meshes of this.meshes) meshes.clear();
  }

  update(
    dt: number,
    camera: THREE.Camera,
    centerX: number,
    centerZ: number,
    active = true,
  ): void {
    const goals = fadeGoals(camera.position.x, camera.position.z, centerX, centerZ, this.clear, active);
    const share = 1 - Math.exp(-Math.max(0, dt) * 7);
    for (let side = 0; side < 4; side += 1) {
      const material = this.materials[side]!;
      material.opacity += (goals[side]! - material.opacity) * share;
      const transparent = material.opacity < 0.995;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.depthWrite = !transparent;
        material.needsUpdate = true;
      }
      for (const mesh of this.meshes[side]!) mesh.castShadow = material.opacity > 0.55;
    }
  }

  dispose(): void {
    this.clearMeshes();
    for (const material of this.materials) material.dispose();
  }
}
