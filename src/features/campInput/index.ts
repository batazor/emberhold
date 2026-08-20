/**
 * Ввод лагеря: возить пальцем, приближать щипком, тапать по зданию.
 * Лагерь растёт до 10×10 (§20.4) и в один экран телефона целиком не влезает.
 *
 * Фича — только жест: она различает тап и протяг, ведёт щипок и держит
 * смещение камеры в пределах площадки. Что делать с тапом — решает лагерь,
 * и это приходит колбэком: здесь нет ни зданий, ни карточек, ни выбора места.
 *
 * Зависимости объявлены портами, а не типами рендера: камере нужны четыре
 * метода, канвасу — подписка. `SceneRig` подходит под `Camera` как есть,
 * а в Node под тот же порт подходит объект на десять строк — поэтому
 * машина жеста проверяется в `campInput.rules.ts`, без браузера и без three.
 */

/** Что жесту нужно от камеры. SceneRig удовлетворяет этому как есть. */
export interface Camera {
  /** Точка на земле под пикселем экрана; null — мимо земли. */
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null;
  lookAt(x: number, z: number, instant?: boolean): void;
  setZoom(value: number, instant?: boolean): void;
  zoom(delta: number): void;
  readonly zoomLevel: number;
}

/** Событие указателя — ровно то, что жест из него читает. */
export interface PointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Событие колеса — то же самое. */
export interface WheelLike {
  readonly deltaY: number;
  preventDefault(): void;
}

/**
 * Что жесту нужно от канваса. Подписка описана по событиям, а не типом DOM:
 * `HTMLCanvasElement` подходит как есть, а в Node — обычный `EventTarget`.
 */
export interface Surface {
  addEventListener(
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    listener: (e: PointerLike) => void,
  ): void;
  addEventListener(type: 'wheel', listener: (e: WheelLike) => void, options: { passive: false }): void;
  /** Необязателен: без захвата жест ведётся по событиям канваса. */
  setPointerCapture?(pointerId: number): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CampInputHooks {
  readonly canvas: Surface;
  readonly camera: Camera;
  /** Ведёт ли жесты лагерь прямо сейчас: в вылазке и на заставке — нет. */
  readonly active: () => boolean;
  /** Центр площадки: цель камеры — он плюс смещение. */
  readonly center: () => { readonly x: number; readonly z: number };
  /** Сторона площадки в клетках — предел отъезда считается от неё. */
  readonly area: () => number;
  /** Тап по земле: не протяг, не щипок, один палец. */
  readonly onTap: (clientX: number, clientY: number) => void;
  /** Любое касание: лагерь замирает через 20 секунд без них. */
  readonly onTouch: () => void;
}

export interface CampInput {
  /**
   * Смещение камеры от центра площадки, в клетках. Живёт здесь, а не
   * в SceneRig: рига возит камеру за героем в вылазке, и общее состояние
   * сделало бы «где мы смотрим» зависимым от того, в каком режиме игра.
   */
  readonly pan: { readonly x: number; readonly z: number };
  /** Вернуть камеру в центр площадки. */
  reset(): void;
}

/** Сколько можно отъехать от края площадки, в клетках. */
const PAN_MARGIN = 4;
/** Тап или протяг: ниже порога — это тап, и он открывает карточку. */
const DRAG_SLOP = 8;
/** Ниже этого расстояния между пальцами щипок не считается. */
const PINCH_MIN = 8;

export function bindCampInput(hooks: CampInputHooks): CampInput {
  const { canvas, camera } = hooks;
  const pan = { x: 0, z: 0 };
  const pointers = new Map<number, Point>();
  let dragged = false;
  let downAt: Point | null = null;
  /** Расстояние между пальцами и зум на начало щипка. */
  let pinchFrom = 0;
  let pinchZoom = 0;

  const clampPan = (): void => {
    const limit = hooks.area() / 2 + PAN_MARGIN;
    pan.x = Math.max(-limit, Math.min(limit, pan.x));
    pan.z = Math.max(-limit, Math.min(limit, pan.z));
  };

  /** Точка под пальцем должна оставаться под пальцем — отсюда разница по земле,
   *  а не пересчёт пикселей в клетки: он зависел бы от азимута и зума. */
  const panByDrag = (from: Point, to: Point): void => {
    const a = camera.screenToGround(from.x, from.y);
    const b = camera.screenToGround(to.x, to.y);
    if (a === null || b === null) return;
    pan.x += a.x - b.x;
    pan.z += a.z - b.z;
    clampPan();
    // Без сглаживания: палец ведёт камеру ровно за собой, а плавность рига
    // нужна там, где цель ставит игра, — за героем в вылазке.
    const c = hooks.center();
    camera.lookAt(c.x + pan.x, c.z + pan.z, true);
  };

  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (e: PointerLike) => {
    if (!hooks.active()) return;
    hooks.onTouch();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      dragged = false;
    } else if (pointers.size === 2) {
      // Второй палец отменяет тап: щипок — это не промах по зданию.
      dragged = true;
      pinchFrom = spread();
      pinchZoom = camera.zoomLevel;
    }
    // Захват — удобство, а не условие: палец, ушедший за край канваса, должен
    // продолжать вести камеру. Но он же и необязателен, и на отказ браузера
    // жест ломаться не должен.
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* без захвата ведём по событиям канваса */
    }
  });

  canvas.addEventListener('pointermove', (e: PointerLike) => {
    const prev = pointers.get(e.pointerId);
    if (prev === undefined || !hooks.active()) return;
    const cur = { x: e.clientX, y: e.clientY };
    hooks.onTouch();

    if (pointers.size >= 2) {
      pointers.set(e.pointerId, cur);
      const now = spread();
      // Пальцы разъезжаются — кадр сужается: щипок приближает, а не отдаляет.
      if (pinchFrom > PINCH_MIN && now > PINCH_MIN) camera.setZoom((pinchZoom * pinchFrom) / now);
      return;
    }

    if (!dragged && downAt !== null) {
      if (Math.hypot(cur.x - downAt.x, cur.y - downAt.y) < DRAG_SLOP) {
        pointers.set(e.pointerId, cur);
        return;
      }
      dragged = true;
    }
    if (dragged) panByDrag(prev, cur);
    pointers.set(e.pointerId, cur);
  });

  const endPointer = (e: PointerLike): void => {
    if (hooks.active() && pointers.has(e.pointerId) && pointers.size === 1 && !dragged) {
      hooks.onTap(e.clientX, e.clientY);
    }
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      downAt = null;
      dragged = false;
    }
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e: WheelLike) => {
      if (!hooks.active()) return;
      e.preventDefault();
      hooks.onTouch();
      camera.zoom(Math.sign(e.deltaY) * 2);
    },
    { passive: false },
  );

  return {
    pan,
    reset(): void {
      pan.x = 0;
      pan.z = 0;
    },
  };
}
