/**
 * Полосы прогресса над работой: стройка, рубка, добыча.
 *
 * До них прогресс жил в двух местах, и оба молчали в кадре: у стройки —
 * полоса в карточке здания, которую надо открыть, у рубки — растущее пятно
 * под ногами, которое читается меткой места, а не ходом работы. Вопрос
 * «сколько осталось» задают, глядя на работающего, и отвечать на него
 * обязана та же точка кадра.
 *
 * Устройство — то же, что у пузырей реплик (`bubbles.ts`), и по тем же
 * причинам: точка мира проецируется ортокамерой сцены, а сама полоса —
 * HTML поверх канвы, потому что коробку ей даёт словарь панелей (`.bar`),
 * и рисовать её второй раз текстурой значило бы завести второй словарь.
 */
import * as THREE from 'three';
import type { SceneRig } from './scene';

/** Работа кадра: где она идёт и какая её доля сделана (0…1). */
export interface WorkItem {
  readonly x: number;
  /** Высота якоря — над работой, в единицах мира. */
  readonly y: number;
  readonly z: number;
  readonly share: number;
  /**
   * Остаток словами — под полосой. Нужен долгой работе: стройка §20.2 идёт
   * минуты и часы, и полоса на ней глазом неподвижна — без цифр она
   * читается не «идёт», а «застряла». У рубки остатка нет: восемь секунд
   * видно самой полосой.
   */
  readonly left?: string;
}

export class WorkBars {
  private readonly layer: HTMLDivElement;
  private readonly pool: { el: HTMLDivElement; fill: HTMLElement; left: HTMLElement }[] = [];
  private readonly point = new THREE.Vector3();

  constructor(private readonly rig: SceneRig, parent: HTMLElement = document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'workbars';
    parent.appendChild(this.layer);
  }

  /**
   * Показать работы кадра. Список пересобирается целиком, как у пузырей:
   * работ единицы — стройка да инструмент в руках, — и дифф дороже пересбора.
   */
  sync(items: readonly WorkItem[]): void {
    // Счёт работ на слое — для отладочных сцен: кадр живёт только на видимой
    // вкладке, и «была ли полоса» иначе можно спросить только у глаза.
    this.layer.dataset['n'] = String(items.length);
    while (this.pool.length < items.length) {
      const el = document.createElement('div');
      el.className = 'workbar';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.appendChild(fill);
      const left = document.createElement('span');
      el.appendChild(bar);
      el.appendChild(left);
      this.layer.appendChild(el);
      this.pool.push({ el, fill, left });
    }
    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i]!;
      const item = items[i];
      if (item === undefined) {
        slot.el.style.display = 'none';
        continue;
      }
      this.point.set(item.x, item.y, item.z).project(this.rig.camera);
      // За кадром не показываем — то же правило, что у пузырей: ортокамера
      // проецирует и то, что за краем, а полоса у рамки врала бы о месте.
      if (Math.abs(this.point.x) > 1 || Math.abs(this.point.y) > 1) {
        slot.el.style.display = 'none';
        continue;
      }
      const w = this.rig.renderer.domElement.clientWidth;
      const h = this.rig.renderer.domElement.clientHeight;
      slot.el.style.display = '';
      slot.el.style.left = `${((this.point.x + 1) / 2) * w}px`;
      slot.el.style.top = `${((1 - this.point.y) / 2) * h}px`;
      slot.fill.style.width = `${(Math.max(0, Math.min(1, item.share)) * 100).toFixed(1)}%`;
      const left = item.left ?? '';
      if (slot.left.textContent !== left) slot.left.textContent = left;
    }
  }

  /** Спрятать всё: сцена ушла, показывать ход работы не над чем. */
  clear(): void {
    for (const slot of this.pool) slot.el.style.display = 'none';
  }

  dispose(): void {
    this.layer.remove();
  }
}
