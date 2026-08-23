import * as THREE from 'three';
import type { RigClipName } from './rig.data';

/**
 * Тело без скелета: те же состояния §17.1, что у `Rigged`, но играются они
 * трансформом, а не костями.
 *
 * Заведено ради нескнинованных моделей. Привидение плывёт и оседает,
 * минотавр тяжело переступает и идёт на таран, голем топает, бьёт сверху
 * и складывается грудой. Профили различаются только показом: правила боя
 * говорят теми же состояниями, которыми позже будут управлять skeletal-клипы.
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

export type DriftingProfile = 'ghost' | 'minotaur' | 'stone-golem';

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

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    height: number,
    private readonly profile: DriftingProfile = 'ghost',
  ) {
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
    const grounded = this.profile !== 'ghost';
    const wave = Math.sin((this.time / BOB_SECONDS) * Math.PI * 2);
    const bob = grounded ? 0 : wave * BOB * this.lift;
    const span = ONCE[this.current] ?? 1;
    const t = Math.min(1, this.at / span);

    // Каждое состояние начинает с чистой позы: позже эти же состояния сможет
    // реализовать скелетный клип, не наследуя случайный наклон прошлого кадра.
    this.inner.position.set(0, bob, 0);
    this.inner.rotation.set(0, 0, 0);
    this.inner.scale.set(1, 1, 1);

    if (this.current === 'падение') {
      // Оседание: вниз и в точку. Держится на последнем кадре, как «падение»
      // у скелета, — противник ещё на полу, пока вылазка не уберёт его.
      if (this.profile === 'stone-golem') {
        this.inner.position.y = -this.lift * 0.35 * t;
        this.inner.scale.set(1 + t * 0.22, Math.max(0.12, 1 - t * 0.88), 1 + t * 0.22);
        this.inner.rotation.x = -0.28 * t;
      } else if (this.profile === 'minotaur') {
        this.inner.position.y = -this.lift * 0.16 * t;
        this.inner.rotation.z = -Math.PI * 0.46 * t;
        this.inner.rotation.x = -0.16 * t;
      } else {
        this.inner.position.y = bob - this.lift * t;
        this.inner.scale.setScalar(Math.max(0.05, 1 - t));
      }
      return;
    }

    if (this.current === 'удар') {
      // Отклон назад на первой трети замаха и рывок вперёд на остатке:
      // телеграф §17.3 обязан читаться позой, а не только цветом.
      const lean = t < 0.34 ? -t / 0.34 : -(1 - (t - 0.34) / 0.66) + (t - 0.34) / 0.66;
      if (this.profile === 'stone-golem') {
        const slam = Math.sin(t * Math.PI);
        this.inner.rotation.x = (t < 0.45 ? -0.5 * (t / 0.45) : 0.72 * slam);
        this.inner.position.y = Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI)) * 0.08 * this.lift;
        this.inner.scale.y = 1 + slam * 0.035;
      } else if (this.profile === 'minotaur') {
        this.inner.rotation.x = lean * 0.58;
        this.inner.position.y = Math.max(0, lean) * 0.08 * this.lift;
        this.inner.scale.set(1 + Math.max(0, lean) * 0.04, 1, 1);
      } else {
        this.inner.rotation.x = lean * 0.4;
        this.inner.position.y = bob + Math.max(0, lean) * 0.12 * this.lift;
      }
      return;
    }
    if (this.current === 'урон') {
      const recoil = Math.sin(t * Math.PI);
      if (this.profile === 'stone-golem') {
        this.inner.rotation.z = recoil * 0.16 * Math.sin(t * Math.PI * 5);
        this.inner.scale.set(1 + recoil * 0.04, 1 - recoil * 0.04, 1);
      } else if (this.profile === 'minotaur') {
        this.inner.rotation.x = recoil * 0.42;
        this.inner.rotation.z = recoil * 0.12;
      } else {
        this.inner.rotation.x = recoil * 0.5;
      }
      return;
    }
    if (this.profile === 'stone-golem') {
      if (this.current === 'ходьба') {
        const stomp = Math.abs(Math.sin(this.time * Math.PI * 3.2));
        this.inner.position.y = stomp * 0.055 * this.lift;
        this.inner.rotation.z = Math.sin(this.time * Math.PI * 3.2) * 0.09;
      } else {
        this.inner.scale.y = 1 + wave * 0.006;
      }
      return;
    }
    if (this.profile === 'minotaur') {
      if (this.current === 'ходьба') {
        this.inner.position.y = Math.abs(Math.sin(this.time * Math.PI * 4)) * 0.035 * this.lift;
        this.inner.rotation.z = Math.sin(this.time * Math.PI * 4) * 0.07;
        this.inner.rotation.x = 0.1;
      } else {
        this.inner.scale.set(1 + wave * 0.008, 1 + wave * 0.015, 1 + wave * 0.008);
        this.inner.rotation.z = wave * 0.012;
      }
      return;
    }
    // Привидение плывёт и в покое, и на ходу.
    this.inner.rotation.x = this.current === 'ходьба' ? 0.14 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
