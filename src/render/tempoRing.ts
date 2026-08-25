/**
 * Кольцо резонанса (§13.11): слабая точка на добыче и сжимающийся ореол.
 *
 * Устройство — то же, что у полос прогресса (`workbar.ts`), и по тем же
 * причинам: точка мира проецируется ортокамерой сцены, а сами круги — HTML
 * поверх канвы, потому что цвет и мера у них словарные (§6.2), и рисовать
 * их текстурой значило бы завести второй словарь.
 *
 * Одно отличие, и оно принципиальное: слой ловит палец. Канва под зоной
 * не получает тап вовсе, поэтому вердикт места выносится здесь — попал
 * в круг, мимо круга или по самой добыче в центре — и уходит наверх одним
 * словом (`TempoAim`). Судить время и ступени слой не берётся: это дело
 * симуляции (`sim/tempo.ts`), у которой пикселей нет.
 */
import * as THREE from 'three';
import type { SceneRig } from './scene';
import type { TempoAim, TempoBeat } from '../sim/tempo';

/** Радиус зоны — куда клики считаются игрой, а не миром. */
const ZONE_R = 74;

/** Радиус круга слабой точки. С палец: меткость, а не пиксель-хантинг. */
const SPOT_R = 20;

/** Насколько точка отъезжает от центра при смещении (u, v) = 1. */
const RANGE = 48;

/** Центральный пятак — это тап по самой добыче: разгон, а не промах. */
const DEAD_R = 26;

/** Откуда сжимается ореол: во столько раз шире круга он рождается. */
const HALO_FROM = 2.1;

/** Кадр резонанса: где кольцо висит и что на нём происходит. */
export interface TempoView {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Слабая точка и сжатие ореола (0 — родился, 1 — совпал); null — точки нет. */
  readonly spot: { u: number; v: number; closing: number } | null;
  /** Множитель — им подписано кольцо. */
  readonly boost: number;
}

export class TempoRing {
  private readonly layer: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly spot: HTMLDivElement;
  private readonly halo: HTMLDivElement;
  private readonly mul: HTMLDivElement;
  private readonly point = new THREE.Vector3();
  private beatTimer: ReturnType<typeof setTimeout> | null = null;
  private shownMul = '';

  constructor(
    private readonly rig: SceneRig,
    onBeat: (aim: TempoAim) => void,
    parent: HTMLElement = document.body,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'temporing';
    this.zone = document.createElement('div');
    this.zone.className = 'temporing-zone';
    this.spot = document.createElement('div');
    this.spot.className = 'temporing-spot';
    this.halo = document.createElement('div');
    this.halo.className = 'temporing-halo';
    this.mul = document.createElement('div');
    this.mul.className = 'chip temporing-mul';
    this.spot.appendChild(this.halo);
    this.zone.appendChild(this.spot);
    this.zone.appendChild(this.mul);
    this.layer.appendChild(this.zone);
    parent.appendChild(this.layer);

    // Вердикт места: круг первым — он может лежать и на центральном пятаке,
    // и тогда тап по нему обязан читаться попаданием, а не разгоном.
    this.zone.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const box = this.zone.getBoundingClientRect();
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      if (this.spot.style.display !== 'none') {
        const sx = dx - Number(this.spot.dataset['x'] ?? 0);
        const sy = dy - Number(this.spot.dataset['y'] ?? 0);
        if (Math.hypot(sx, sy) <= SPOT_R) return onBeat('spot');
        if (Math.hypot(dx, dy) > DEAD_R) return onBeat('wide');
      }
      onBeat(null);
    });
  }

  /**
   * Показать кадр. Слой один и кольцо одно: работа, по которой кликают,
   * бывает только одна — вторая её сменяет, а не стоит рядом.
   */
  sync(view: TempoView | null): void {
    if (view === null) {
      this.zone.style.display = 'none';
      return;
    }
    this.point.set(view.x, view.y, view.z).project(this.rig.camera);
    if (Math.abs(this.point.x) > 1 || Math.abs(this.point.y) > 1) {
      this.zone.style.display = 'none';
      return;
    }
    const w = this.rig.renderer.domElement.clientWidth;
    const h = this.rig.renderer.domElement.clientHeight;
    this.zone.style.display = '';
    this.zone.style.left = `${((this.point.x + 1) / 2) * w - ZONE_R}px`;
    this.zone.style.top = `${((1 - this.point.y) / 2) * h - ZONE_R}px`;

    // Палец зона ловит только с открытой точкой: без неё клики по добыче
    // и земле рядом принадлежат канве — разгону и ходьбе.
    if (view.spot === null) {
      this.spot.style.display = 'none';
      delete this.zone.dataset['live'];
    } else {
      this.zone.dataset['live'] = '';
      const x = view.spot.u * RANGE;
      const y = view.spot.v * RANGE;
      this.spot.style.display = '';
      this.spot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // Пиксели смещения нужны и хиттесту — он living в другом обработчике,
      // и парсить их из transform значило бы читать строку, которую сам же
      // и собрал.
      this.spot.dataset['x'] = x.toFixed(1);
      this.spot.dataset['y'] = y.toFixed(1);
      const scale = HALO_FROM - (HALO_FROM - 1) * view.spot.closing;
      this.halo.style.transform = `scale(${scale.toFixed(3)})`;
      this.halo.style.opacity = view.spot.closing >= 1 ? '0' : '';
    }

    const mul = view.boost === 1 ? '' : `×${(Math.round(view.boost * 10) / 10)}`;
    if (this.shownMul !== mul) {
      this.shownMul = mul;
      this.mul.textContent = mul;
      this.mul.style.display = mul === '' ? 'none' : '';
    }
  }

  /** Отозваться на клик: цвет подписи коротко называет вердикт. */
  beat(kind: TempoBeat): void {
    this.zone.dataset['beat'] = kind;
    if (this.beatTimer !== null) clearTimeout(this.beatTimer);
    this.beatTimer = setTimeout(() => {
      delete this.zone.dataset['beat'];
      this.beatTimer = null;
    }, 400);
  }

  dispose(): void {
    if (this.beatTimer !== null) clearTimeout(this.beatTimer);
    this.layer.remove();
  }
}
