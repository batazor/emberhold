import * as THREE from 'three';
import { bakedGeometry, fitOf } from './baked';
import { FOX_MODELS, FOX_SLOTS } from './fox.data';
import { FOX_PALETTE } from './palette';
import type { RigClipName } from './rig.data';

if (FOX_PALETTE.length !== FOX_SLOTS.length) {
  throw new Error(`палитра лисы рассинхронизирована: слотов ${FOX_SLOTS.length}, цветов ${FOX_PALETTE.length}`);
}

const HEIGHT = 0.72;
let cached: THREE.BufferGeometry | null = null;

export function foxGeometry(): THREE.BufferGeometry {
  if (cached === null) cached = bakedGeometry([{ model: FOX_MODELS.fox, palette: FOX_PALETTE }], fitOf(FOX_MODELS.fox, HEIGHT));
  return cached;
}

const ONCE: Partial<Record<RigClipName, number>> = { удар: 0.42, урон: 0.3, падение: 0.68 };

/** Лёгкая анимация поверх запечённой позы: модель сохраняет свой силуэт,
 * а бег, укус и падение читаются трансформом без загрузки рига в рантайм. */
export class FoxRig {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly inner = new THREE.Group();
  private current: RigClipName = 'покой';
  private at = 0;
  private time = 0;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(foxGeometry(), material);
    this.mesh.castShadow = true;
    this.inner.add(this.mesh);
    this.root.add(this.inner);
  }

  play(state: RigClipName, _rate = 1): void {
    if (this.current === state) return;
    this.current = state;
    this.at = 0;
  }
  replay(): void { this.at = 0; }
  get state(): RigClipName { return this.current; }
  get finished(): boolean {
    const span = ONCE[this.current];
    return span !== undefined && this.at >= span;
  }
  setMaterial(material: THREE.Material): void { this.mesh.material = material; }
  update(dt: number): void {
    this.at += dt;
    this.time += dt;
    const span = ONCE[this.current] ?? 1;
    const t = Math.min(1, this.at / span);
    this.inner.position.set(0, 0, 0);
    this.inner.rotation.set(0, 0, 0);
    this.inner.scale.setScalar(1);
    if (this.current === 'падение') {
      this.inner.rotation.z = -Math.PI * 0.48 * t;
      this.inner.position.y = -0.18 * t;
    } else if (this.current === 'удар') {
      this.inner.rotation.x = Math.sin(t * Math.PI) * 0.28;
      this.inner.position.z = Math.sin(t * Math.PI) * 0.18;
    } else if (this.current === 'урон') {
      this.inner.rotation.z = Math.sin(t * Math.PI) * 0.35;
    } else if (this.current === 'ходьба') {
      this.inner.position.y = Math.abs(Math.sin(this.time * Math.PI * 4)) * 0.045;
      this.inner.rotation.x = 0.06;
    } else {
      const breath = Math.sin(this.time * Math.PI * 1.5) * 0.012;
      this.inner.scale.set(1, 1 + breath, 1 - breath * 0.5);
    }
  }
  dispose(): void { /* геометрия общая и живёт до конца приложения */ }
}
