import * as THREE from 'three';
import { HEX_R, hexToWorld } from '../sim/hex';
import type { Hex } from '../sim/hex';
import { PALETTE } from './palette';

/**
 * Гекс-сетка поля боя (§11.3). Проступает при завязке контакта и показывает
 * ровно три вещи: где стоит тот, чей ход, куда он дойдёт и кого достанет.
 *
 * **Сетка не рисуется вся.** Показывать её на всю локацию значило бы
 * расчертить местность, которую игрок только что изучал глазами: решётка
 * нужна там, где по ней ходят, и там, где по ней бьют. Всё остальное
 * остаётся местностью.
 *
 * Геометрия пересобирается на смену набора, а не каждый кадр: набор меняется
 * раз в ход, и тридцать контуров по шесть отрезков — это дешевле, чем один
 * инстансинг с его обвязкой.
 */
export type HexRole = 'move' | 'stand' | 'target' | 'hover';

const COLOR: Record<HexRole, number> = {
  // Куда дойду — тем же спокойным цветом, что место под здание (§20.4):
  // игра уже говорит им «сюда можно», и второго словаря заводить не надо.
  move: PALETTE.siteOk,
  // Где стою — светом фонаря: это про героя, а не про землю.
  stand: PALETTE.torch,
  // Кого достану — цветом замаха (§17.3). Красное в игре значит «удар»,
  // и на поле оно значит то же самое.
  target: PALETTE.telegraph,
  // Куда веду палец — цветом добычи: он в игре значит «вот это», и здесь
  // значит то же. Новый цвет тут был бы четвёртым словом об одном и том же.
  hover: PALETTE.loot,
};

/** Высота над полом. Чуть выше метки тапа, чтобы не спорить с ней z-буфером. */
const LIFT = 0.09;

/** Вершины шестиугольника в мировых координатах вокруг центра. */
function corners(center: { x: number; z: number }, scale: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push(new THREE.Vector3(
      center.x + HEX_R * scale * Math.cos(a),
      LIFT,
      center.z + HEX_R * scale * Math.sin(a),
    ));
  }
  return out;
}

export class HexGrid {
  readonly group = new THREE.Group();
  private readonly lines = new Map<HexRole, THREE.LineSegments>();
  /** Что показано сейчас: пересобираем только на изменение. */
  private key = '';

  constructor() {
    for (const role of ['move', 'stand', 'target', 'hover'] as HexRole[]) {
      const material = new THREE.LineBasicMaterial({
        color: COLOR[role],
        transparent: true,
        // Контур хода приглушён, стойка и цель — в полную силу: первый
        // отвечает на «куда можно», вторые на «что сейчас важно».
        opacity: role === 'move' ? 0.45 : 0.95,
        // Без тумана: сетка это разметка, а не предмет в кадре, и гаснуть
        // вместе с дальностью фонаря она не должна.
        fog: false,
        depthTest: false,
      });
      const mesh = new THREE.LineSegments(new THREE.BufferGeometry(), material);
      mesh.renderOrder = 4;
      mesh.visible = false;
      this.lines.set(role, mesh);
      this.group.add(mesh);
    }
  }

  /** Спрятать сетку целиком: вне боя её нет. */
  hide(): void {
    if (this.key === '') return;
    this.key = '';
    for (const mesh of this.lines.values()) mesh.visible = false;
  }

  /**
   * Показать набор. Гексы приходят готовыми ролями, потому что решает их
   * не рендер: «куда дойду» и «кого достану» считает поле боя теми же
   * правилами, которыми потом применит ход.
   */
  show(sets: Readonly<Record<HexRole, readonly Hex[]>>): void {
    const key = (['move', 'stand', 'target', 'hover'] as HexRole[])
      .map((r) => `${r}:${sets[r].map((h) => `${h.q},${h.r}`).join('|')}`)
      .join(';');
    if (key === this.key) return;
    this.key = key;

    for (const role of ['move', 'stand', 'target', 'hover'] as HexRole[]) {
      const mesh = this.lines.get(role)!;
      const hexes = sets[role];
      mesh.visible = hexes.length > 0;
      if (hexes.length === 0) continue;

      const points: number[] = [];
      for (const h of hexes) {
        // Стойка и цель рисуются чуть меньше хода: вложенные контуры
        // читаются как «этот гекс особенный», а совпадающие — как рябь.
        const ring = corners(hexToWorld(h), role === 'move' ? 0.92 : role === 'hover' ? 0.86 : 0.78);
        for (let i = 0; i < 6; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % 6]!;
          points.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
  }

  dispose(): void {
    for (const mesh of this.lines.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
