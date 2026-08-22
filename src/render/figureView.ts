import * as THREE from 'three';
import { PALETTE } from './palette';
import { blockingMaterial } from './blocking';
import { heroGeometry, residentGeometry } from './models';
import type { HeroClassId } from '../sim/heroes';
import type { DwellerLook } from '../sim/garrison';

/**
 * Фигура на странице персонажа — та же модель, что ходит по лагерю, только
 * стоит смирно и поворачивается пальцем.
 *
 * Живёт в `render/`, а не рядом со страницей: слой интерфейса не знает
 * про three (`scripts/arch.ts`), и знать не должен — фигура это модель,
 * а не панель. Собирает их вместе `features/character`.
 *
 * **Почему свой рендерер, а не общий риг.** У `SceneRig` (`render/scene.ts`)
 * мир вылазки: туман, тени, ортокамера, привязанная к клетке, и цикл, который
 * крутит лагерь. Здесь одна модель в коробке 260×340 и никакой сцены вокруг.
 * Тащить их друг в друга значило бы учить риг разбору персонажа ради
 * единственного кадра — тем же доводом обходится колесо призов
 * (`render/wheelView.ts`), и здесь он тот же.
 *
 * **Камера — игровая, 45°/30°.** Человек на странице обязан выглядеть так же,
 * как под пальцем в лагере: разбор про того же самого, и другой ракурс
 * сделал бы из него другого. Поворот перетаскиванием добавлен поверх — иначе
 * спину видно негде, а вещи в спину как раз и надевают.
 *
 * **Кадр рисуется по требованию.** Модель неподвижна, и держать
 * requestAnimationFrame под открытым экраном значило бы жечь батарею ради
 * неизменной картинки: кадр идёт на открытие, на поворот и на смену человека.
 */
export type FigureModel =
  | { readonly kind: 'герой'; readonly cls: HeroClassId; readonly weapon: number }
  | { readonly kind: 'жилец'; readonly look: DwellerLook };

/** Наклон камеры игры (§6.1): те же 30° над горизонтом. */
const ELEVATION = (30 * Math.PI) / 180;

/** Азимут по умолчанию — те же 45°, с которых игрок смотрит на лагерь. */
const AZIMUTH = (45 * Math.PI) / 180;

/** Сколько радиан на пиксель протяжки. Полный оборот — примерно ширина окна. */
const TURN_PER_PX = 0.012;

/** Высота коробки камеры в единицах мира: человек 1,51 и немного воздуха. */
const FRUSTUM = 2.1;

export class Figure {
  readonly el: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  private readonly material = blockingMaterial();
  private readonly pivot = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  /** Кто нарисован: смена человека пересобирает меш, поворот — нет. */
  private key = '';
  private azimuth = AZIMUTH;
  private dragAt: number | null = null;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'ch-figure';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.el, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Свет тот же по смыслу, что в игре: небо сверху, солнце сбоку. Теней
    // нет — ронять их некуда, пола на странице не существует.
    this.scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x2b2519, 1.4));
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
    sun.position.set(-4, 6, 3);
    this.scene.add(sun, this.pivot);

    this.el.addEventListener('pointerdown', (e) => {
      this.dragAt = e.clientX;
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.dragAt === null) return;
      this.azimuth += (e.clientX - this.dragAt) * TURN_PER_PX;
      this.dragAt = e.clientX;
      this.draw();
    });
    const drop = (): void => {
      this.dragAt = null;
    };
    this.el.addEventListener('pointerup', drop);
    this.el.addEventListener('pointercancel', drop);
  }

  /** Вернуть фигуру в игровой ракурс: кнопка «сброс» под ней. */
  reset(): void {
    this.azimuth = AZIMUTH;
    this.draw();
  }

  /** Показать этого человека. Тот же — ничего не пересобирает. */
  show(model: FigureModel, width: number, height: number): void {
    const key =
      model.kind === 'герой' ? `герой:${model.cls}:${model.weapon}` : `жилец:${model.look}`;
    if (key !== this.key) {
      this.key = key;
      if (this.mesh !== null) {
        this.pivot.remove(this.mesh);
        this.mesh.geometry.dispose();
      }
      const geometry =
        model.kind === 'герой'
          ? heroGeometry(model.cls, model.weapon)
          : residentGeometry(model.look);
      // Геометрия набора стоит основанием на нуле — фигуру нужно опустить
      // на полвысоты, иначе камера смотрит человеку в живот.
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.position.y = box === null ? 0 : -(box.max.y + box.min.y) / 2;
      this.pivot.add(this.mesh);
    }
    this.size(width, height);
    this.draw();
  }

  private size(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    const w = FRUSTUM * (width / Math.max(1, height));
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = FRUSTUM / 2;
    this.camera.bottom = -FRUSTUM / 2;
    this.camera.updateProjectionMatrix();
  }

  private draw(): void {
    const dist = 12;
    const y = Math.sin(ELEVATION) * dist;
    const r = Math.cos(ELEVATION) * dist;
    this.camera.position.set(Math.sin(this.azimuth) * r, y, Math.cos(this.azimuth) * r);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.mesh !== null) this.mesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
