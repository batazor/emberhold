import * as THREE from 'three';
import { MATERIAL } from '../core/palette';
import type { ResourceKind } from '../sim/resources';

const CAPACITY = 128;
const LIFE = 1.05;
const GRAVITY = -5.8;

const COLOR: Readonly<Record<ResourceKind, number>> = {
  stone: MATERIAL['скол'],
  wood: MATERIAL['дерево-свет'],
  iron: MATERIAL['сталь'],
  crystal: MATERIAL['стекло'],
  food: MATERIAL['трава-свет'],
  meat: MATERIAL['краска-алая'],
  pelt: MATERIAL['солома'],
};

interface Particle {
  active: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
}

export interface RewardBurstSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: ResourceKind;
  readonly amount?: number;
}

const particle = (): Particle => ({
  active: false,
  age: 0,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  rx: 0,
  ry: 0,
  spin: 0,
});

/**
 * Общий пул коротких наградных частиц. Геометрия и материал одни на всю
 * игру, а новые награды только перезаписывают слоты кольцевого буфера.
 */
export class RewardBurst {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.TetrahedronGeometry(0.09, 0);
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  private readonly particles = Array.from({ length: CAPACITY }, particle);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private cursor = 0;
  private live = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAPACITY; i += 1) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get activeCount(): number {
    return this.live;
  }

  burst(spec: RewardBurstSpec): void {
    const amount = Math.max(1, spec.amount ?? 1);
    const count = Math.max(6, Math.min(16, 5 + Math.round(Math.sqrt(amount) * 2)));
    for (let i = 0; i < count; i += 1) {
      const at = this.cursor % CAPACITY;
      this.cursor += 1;
      const p = this.particles[at]!;
      if (!p.active) this.live += 1;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.45 + Math.random() * 0.85;
      p.active = true;
      p.age = 0;
      p.x = spec.x + Math.cos(angle) * 0.05;
      p.y = spec.y;
      p.z = spec.z + Math.sin(angle) * 0.05;
      p.vx = Math.cos(angle) * speed;
      p.vy = 1.55 + Math.random() * 0.95;
      p.vz = Math.sin(angle) * speed;
      p.rx = Math.random() * Math.PI;
      p.ry = Math.random() * Math.PI;
      p.spin = (Math.random() - 0.5) * 10;
      this.mesh.setColorAt(at, this.color.setHex(COLOR[spec.kind]));
    }
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    const step = Math.max(0, Math.min(0.08, dt));
    let live = 0;
    for (let i = 0; i < CAPACITY; i += 1) {
      const p = this.particles[i]!;
      if (!p.active) {
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.age += step;
      p.vy += GRAVITY * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.z += p.vz * step;
      p.vx *= 1 - step * 1.8;
      p.vz *= 1 - step * 1.8;
      if (p.age >= LIFE) {
        p.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      live += 1;
      const fade = Math.min(1, (LIFE - p.age) / 0.3);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rx + p.spin * p.age, p.ry + p.spin * p.age * 0.7, p.spin * p.age);
      this.dummy.scale.setScalar(fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.live = live;
    this.mesh.visible = live > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
