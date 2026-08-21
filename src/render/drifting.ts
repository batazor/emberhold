import * as THREE from 'three';
import type { RigClipName } from './rig.data';

/**
 * Тело без скелета: те же состояния §17.1, что у `Rigged`, но играются они
 * трансформом, а не костями.
 *
 * Заведено ради привидения (§6.1.7). Модель набора не скинована — костей
 * в ней нет вовсе, — и это не потеря, а свойство: **привидение не ходит,
 * оно плывёт**. Ноги, которые нечем переставлять, ему и не нужны; вместо
 * походки у него покачивание, вместо замаха — отклон назад и рывок вперёд,
 * вместо падения — оседание в землю.
 *
 * Поверхность класса намеренно повторяет `Rigged`: вылазка ведёт противника
 * одним и тем же кодом, и знать, у кого есть скелет, ей незачем.
 */

/** Сколько длится состояние, которое играется один раз. */
const ONCE: Partial<Record<RigClipName, number>> = {
  'удар': 0.42,
  'урон': 0.3,
  'падение': 0.68,
};

/** Размах покачивания в долях роста и его период в секундах. */
const BOB = 0.06;
const BOB_SECONDS = 2.4;

export class Drifting {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  /** Внутренний узел: покачивание не должно спорить с положением на клетке. */
  private readonly inner = new THREE.Group();
  private current: RigClipName = 'покой';
  /** Время внутри текущего состояния. */
  private at = 0;
  private time = 0;
  private readonly lift: number;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, height: number) {
    this.lift = height;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.inner.add(this.mesh);
    this.root.add(this.inner);
  }

  play(state: RigClipName, _rate = 1): void {
    if (this.current === state) return;
    this.current = state;
    this.at = 0;
  }

  replay(): void {
    this.at = 0;
  }

  get state(): RigClipName | null {
    return this.current;
  }

  get finished(): boolean {
    const span = ONCE[this.current];
    return span === undefined ? false : this.at >= span;
  }

  setMaterial(material: THREE.Material): void {
    this.mesh.material = material;
  }

  update(dt: number): void {
    this.at += dt;
    this.time += dt;

    // Покачивание идёт всегда: привидение не стоит на земле ни в одном
    // из состояний, и остановленное оно читалось бы как поставленная фигурка.
    const bob = Math.sin((this.time / BOB_SECONDS) * Math.PI * 2) * BOB * this.lift;
    const span = ONCE[this.current] ?? 1;
    const t = Math.min(1, this.at / span);

    if (this.current === 'падение') {
      // Оседание: вниз и в точку. Держится на последнем кадре, как «падение»
      // у скелета, — противник ещё на полу, пока вылазка не уберёт его.
      this.inner.position.y = bob - this.lift * t;
      this.inner.scale.setScalar(Math.max(0.05, 1 - t));
      this.inner.rotation.x = 0;
      return;
    }

    this.inner.scale.setScalar(1);
    if (this.current === 'удар') {
      // Отклон назад на первой трети замаха и рывок вперёд на остатке:
      // телеграф §17.3 обязан читаться позой, а не только цветом.
      const lean = t < 0.34 ? -t / 0.34 : -(1 - (t - 0.34) / 0.66) + (t - 0.34) / 0.66;
      this.inner.rotation.x = lean * 0.4;
      this.inner.position.y = bob + Math.max(0, lean) * 0.12 * this.lift;
      return;
    }
    if (this.current === 'урон') {
      this.inner.rotation.x = Math.sin(t * Math.PI) * 0.5;
      this.inner.position.y = bob;
      return;
    }
    // Покой и ходьба: разница в наклоне вперёд, а не в ногах.
    this.inner.rotation.x = this.current === 'ходьба' ? 0.14 : 0;
    this.inner.position.y = bob;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
