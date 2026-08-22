/**
 * Пузыри реплик: слова человека висят над человеком.
 *
 * Почему не полоса лагеря: полоса — голос игры (§23), и класть в неё речь
 * жильца значило бы выдавать человека за рассказчика — ровно та разница,
 * на которой держится знакомство («при вас говорит человек»). Речь живёт
 * там, где стоит говорящий, — как панель знакомства открывается у сидящего,
 * а не в углу экрана.
 *
 * Почему модуль в `render/`, а не в `ui/`: пузырю нужна камера — точка мира
 * проецируется в экран ортокамерой сцены, — а слой `ui` по архитектуре
 * three не видит. Текст при этом остаётся HTML поверх канвы, а не спрайтом:
 * шрифт, кегль и тень у него общие с интерфейсом, и рисовать буквы второй
 * раз текстурой значило бы завести второй шрифт.
 *
 * Слов здесь нет ни одного: что сказано и когда — решает `sim/talk.ts`,
 * пузырь только ставит готовую строку над готовой точкой.
 */
import * as THREE from 'three';
import type { SceneRig } from './scene';

/** Реплика кадра: где стоит говорящий и что у него на языке. */
export interface Bubble {
  readonly x: number;
  /** Высота якоря — макушка говорящего в единицах мира. */
  readonly y: number;
  readonly z: number;
  readonly text: string;
}

export class Bubbles {
  private readonly layer: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly point = new THREE.Vector3();

  constructor(private readonly rig: SceneRig, parent: HTMLElement = document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'bubbles';
    parent.appendChild(this.layer);
  }

  /**
   * Показать реплики кадра. Список пересобирается целиком, как жильцы
   * в `setResidents`: говорящих единицы, и дифф здесь дороже пересбора.
   * Элементы при этом живут в пуле — пузырь появляется каждые несколько
   * секунд, и наращивать DOM на каждую реплику незачем.
   */
  sync(items: readonly Bubble[]): void {
    while (this.pool.length < items.length) {
      const el = document.createElement('div');
      // Коробка — из словаря панелей (`style.rules.ts`): пузырь это метка.
      el.className = 'chip bubble';
      this.layer.appendChild(el);
      this.pool.push(el);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const el = this.pool[i]!;
      const item = items[i];
      if (item === undefined) {
        el.style.display = 'none';
        continue;
      }
      this.point.set(item.x, item.y, item.z).project(this.rig.camera);
      // За кадром не показываем: ортокамера проецирует и то, что за краем,
      // и пузырь у рамки читался бы речью из-за экрана.
      if (Math.abs(this.point.x) > 1 || Math.abs(this.point.y) > 1) {
        el.style.display = 'none';
        continue;
      }
      const w = this.rig.renderer.domElement.clientWidth;
      const h = this.rig.renderer.domElement.clientHeight;
      if (el.textContent !== item.text) el.textContent = item.text;
      el.style.display = '';
      el.style.left = `${((this.point.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - this.point.y) / 2) * h}px`;
    }
  }

  /** Спрятать всё: сцена ушла, слова договаривать не за кем. */
  clear(): void {
    for (const el of this.pool) el.style.display = 'none';
  }

  dispose(): void {
    this.layer.remove();
  }
}
