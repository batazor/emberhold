import * as THREE from 'three';
import { PALETTE } from './palette';
import { blockingMaterial } from './blocking';
import { dwellerParts, heroGeometry, heroParts, residentGeometry } from './models';
import { Rigged } from './rigged';
import { iconGeometry } from './iconView';
import type { IconName } from './iconView';
import type { ToolModelName } from './tools';
import type { HeroClassId } from '../sim/heroes';
import type { DwellerLook } from '../sim/garrison';

/**
 * Фигура на странице персонажа — тот же человек, что ходит по лагерю,
 * с тем же скелетом, теми же руками и тем же покоем.
 *
 * Живёт в `render/`, а не рядом со страницей: слой интерфейса не знает
 * про three (`scripts/arch.ts`), и знать не должен — фигура это модель,
 * а не панель. Собирает их вместе `features/character`.
 *
 * **Почему свой рендерер, а не общий риг.** У `SceneRig` (`render/scene.ts`)
 * мир вылазки: туман, тени, ортокамера, привязанная к клетке, и цикл, который
 * крутит лагерь. Здесь одна модель в коробке 260×320 и никакой сцены вокруг.
 * Тащить их друг в друга значило бы учить риг разбору персонажа ради
 * единственного кадра — тем же доводом обходится колесо призов
 * (`render/wheelView.ts`).
 *
 * **Скелет, а не неподвижная геометрия.** Разбор смотрят, стоя над лагерем,
 * где этот же человек дышит и переступает; замерший двойник рядом читался бы
 * не как «его карточка», а как «его труп». Клип тот же — `покой`, — и это
 * единственное место страницы, которому нужен кадр каждый тик: пока экран
 * открыт, крутится rAF, с закрытием он останавливается.
 *
 * **Вещь в руке настоящая.** Правая кисть держит то, что человек несёт
 * на самом деле: выкованное оружие своей ступени (§6.1.8) или инструмент
 * занятия. Страница поверх этого кладёт вещь со своей куклы, если у той есть
 * модель, — так перетаскивание видно на самом человеке, а не только в клетке.
 * Чего в наборах нет — шлема, куртки, сапог, кольца, — на фигуре не
 * появляется вовсе; запекание склеивает тело в одну геометрию, и вешать
 * на него нечего.
 *
 * **Камера — игровая, 45°/30°.** Человек на странице обязан выглядеть так же,
 * как под пальцем в лагере: разбор про того же самого, и другой ракурс
 * сделал бы из него другого. Поворот перетаскиванием добавлен поверх — иначе
 * спину видно негде.
 */
export type FigureModel =
  | { readonly kind: 'герой'; readonly cls: HeroClassId; readonly weapon: number }
  | { readonly kind: 'жилец'; readonly look: DwellerLook; readonly tool: ToolModelName | null };

/** Что страница кладёт человеку в руки поверх настоящего. */
export interface FigureHold {
  readonly right: IconName | null;
  readonly left: IconName | null;
}

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
  private readonly clock = new THREE.Clock();
  private rig: Rigged | null = null;
  private still: THREE.Mesh | null = null;
  /** Кто нарисован: смена человека пересобирает особь, поворот — нет. */
  private key = '';
  /** Что в руках поверх настоящего: меняется перетаскиванием, а не человеком. */
  private held = '';
  private azimuth = AZIMUTH;
  private dragAt: number | null = null;
  private frame = 0;

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

  /** Показать этого человека с этими вещами. Тот же — ничего не пересобирает. */
  show(model: FigureModel, hold: FigureHold, width: number, height: number): void {
    const key =
      model.kind === 'герой'
        ? `герой:${model.cls}:${model.weapon}`
        : `жилец:${model.look}:${model.tool ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      this.held = '';
      this.build(model);
    }
    const held = `${hold.right ?? ''}|${hold.left ?? ''}`;
    if (held !== this.held) {
      this.held = held;
      this.hands(model, hold);
    }
    this.size(width, height);
    this.draw();
  }

  /** Крутить кадр, пока страница открыта: покой — это клип, а не поза. */
  start(): void {
    if (this.frame !== 0) return;
    this.clock.getDelta();
    const step = (): void => {
      this.rig?.update(this.clock.getDelta());
      this.draw();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private build(model: FigureModel): void {
    this.rig?.dispose();
    this.rig = null;
    if (this.still !== null) this.pivot.remove(this.still);
    this.still = null;
    this.pivot.clear();

    const parts =
      model.kind === 'герой'
        ? heroParts(model.cls, model.weapon)
        : dwellerParts(model.look, model.tool ?? undefined);
    if (parts === null) {
      // Класс без модели набора остаётся неподвижным примитивом — скелета
      // у него нет, и выдумывать его нечем. Правило то же, что в лагере.
      const geometry =
        model.kind === 'герой' ? heroGeometry(model.cls, model.weapon) : residentGeometry(model.look);
      this.still = new THREE.Mesh(geometry, this.material);
      this.pivot.add(this.still);
    } else {
      this.rig = new Rigged(parts, this.material);
      this.pivot.add(this.rig.root);
      this.rig.play('покой');
    }
    // Человек стоит основанием на нуле, а камера смотрит в центр коробки:
    // без сдвига кадр приходится ему в живот.
    this.pivot.position.y = -FRUSTUM / 2 + 0.15;
  }

  /** Вещь куклы поверх настоящей: пустая рука возвращает то, что несут. */
  private hands(model: FigureModel, hold: FigureHold): void {
    const rig = this.rig;
    if (rig === null) return;
    const real =
      model.kind === 'герой'
        ? null
        : model.tool === null
          ? null
          : dwellerParts(model.look, model.tool).hold?.['handslot.r'] ?? null;
    rig.setHeld(
      'handslot.r',
      hold.right === null
        ? real ?? (model.kind === 'герой' ? heroParts(model.cls, model.weapon)?.hold?.['handslot.r'] ?? null : null)
        : iconGeometry(hold.right),
    );
    rig.setHeld(
      'handslot.l',
      hold.left === null
        ? (model.kind === 'герой' ? heroParts(model.cls, model.weapon)?.hold?.['handslot.l'] ?? null : null)
        : iconGeometry(hold.left),
    );
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
    this.stop();
    this.rig?.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
