/**
 * Правила ввода лагеря. Проверяется машина жеста: где кончается тап и
 * начинается протяг, что делает второй палец, куда уезжает камера и где
 * она упирается. Раньше это жило в main и не проверялось ничем — руками
 * такое ловится только на телефоне и только случайно.
 *
 * Канвас и рига подменены: жест объявляет их портами и ничего не знает
 * ни про DOM, ни про three.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bindCampInput } from './index';
import type { Camera, PointerLike, Surface, WheelLike } from './index';

type Event = PointerLike & WheelLike;
type Listener = (e: Event) => void;

/** Канвас: копит подписки и раздаёт события. */
class Surf implements Surface {
  private readonly listeners = new Map<string, Listener[]>();
  readonly captured: number[] = [];
  /** Браузер вправе отказать в захвате — жест обязан это пережить. */
  capture: 'ok' | 'throws' = 'ok';

  addEventListener(
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    listener: (e: PointerLike) => void,
  ): void;
  addEventListener(type: 'wheel', listener: (e: WheelLike) => void, options: { passive: false }): void;
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  setPointerCapture(pointerId: number): void {
    if (this.capture === 'throws') throw new Error('нет захвата');
    this.captured.push(pointerId);
  }

  private fire(type: string, e: Event): void {
    for (const l of this.listeners.get(type) ?? []) l(e);
  }

  private at(id: number, x: number, y: number): Event {
    return { pointerId: id, clientX: x, clientY: y, deltaY: 0, preventDefault: () => {} };
  }

  down(id: number, x: number, y: number): void {
    this.fire('pointerdown', this.at(id, x, y));
  }
  move(id: number, x: number, y: number): void {
    this.fire('pointermove', this.at(id, x, y));
  }
  up(id: number, x: number, y: number): void {
    this.fire('pointerup', this.at(id, x, y));
  }
  wheel(deltaY: number): { prevented: boolean } {
    let prevented = false;
    this.fire('wheel', {
      pointerId: 0,
      clientX: 0,
      clientY: 0,
      deltaY,
      preventDefault: () => {
        prevented = true;
      },
    });
    return { prevented };
  }
}

/** Рига: земля под пикселем считается по простому масштабу. */
class Cam implements Camera {
  /** Пикселей на клетку. */
  static readonly SCALE = 10;
  looked: { x: number; z: number } | null = null;
  zoomLevel = 100;
  readonly zoomSet: number[] = [];
  readonly zoomStep: number[] = [];

  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    return { x: clientX / Cam.SCALE, z: clientY / Cam.SCALE };
  }
  lookAt(x: number, z: number): void {
    this.looked = { x, z };
  }
  setZoom(value: number): void {
    this.zoomSet.push(value);
  }
  zoom(delta: number): void {
    this.zoomStep.push(delta);
  }
}

/** Стенд: лагерь в центре координат, ввод включён. */
function stand(opts: { active?: boolean; area?: number } = {}) {
  const canvas = new Surf();
  const camera = new Cam();
  const taps: { x: number; y: number }[] = [];
  let touches = 0;
  const input = bindCampInput({
    canvas,
    camera,
    active: () => opts.active ?? true,
    center: () => ({ x: 0, z: 0 }),
    area: () => opts.area ?? 40,
    onTap: (x, y) => taps.push({ x, y }),
    onTouch: () => {
      touches += 1;
    },
  });
  return { canvas, camera, input, taps, touched: () => touches };
}

describe('Ввод лагеря: тап или протяг', () => {
  test('нажал и отпустил на месте — это тап по зданию', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.up(1, 100, 100);
    assert.deepEqual(s.taps, [{ x: 100, y: 100 }]);
    assert.deepEqual(s.input.pan, { x: 0, z: 0 }, 'тап увёз камеру');
  });

  test('дрожь пальца ниже порога — всё ещё тап, а не протяг', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 104, 103); // 5 пикселей — меньше порога
    s.canvas.up(1, 104, 103);
    assert.equal(s.taps.length, 1, 'дрожь съела тап');
    assert.deepEqual(s.input.pan, { x: 0, z: 0 }, 'дрожь увезла камеру');
  });

  test('протяг выше порога камеру возит и тапом не кончается', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 200, 100);
    s.canvas.up(1, 200, 100);
    assert.deepEqual(s.taps, [], 'протяг открыл карточку');
    // Палец ушёл на 10 клеток вправо — столько же уехала камера влево.
    assert.deepEqual(s.input.pan, { x: -10, z: 0 });
  });

  test('точка под пальцем остаётся под пальцем и на ломаном пути', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 140, 100); // вправо
    s.canvas.move(1, 140, 160); // вниз
    // Итог зависит только от концов пути, а не от того, как его вели.
    assert.deepEqual(s.input.pan, { x: -4, z: -6 });
    assert.deepEqual(s.camera.looked, { x: -4, z: -6 }, 'камера не пошла за смещением');
  });

  test('камера упирается в край площадки, а не улетает в темноту', () => {
    const s = stand({ area: 10 });
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 5000, 5000);
    // Площадка 10 клеток: половина плюс запас в 4 клетки.
    assert.deepEqual(s.input.pan, { x: -9, z: -9 });
    s.canvas.up(1, 5000, 5000);
    s.canvas.down(2, 100, 100);
    s.canvas.move(2, -5000, -5000);
    assert.deepEqual(s.input.pan, { x: 9, z: 9 }, 'предел работает в одну сторону');
  });

  test('возвращение в лагерь ставит камеру в центр', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 300, 300);
    assert.notDeepEqual(s.input.pan, { x: 0, z: 0 });
    s.input.reset();
    assert.deepEqual(s.input.pan, { x: 0, z: 0 });
  });
});

describe('Ввод лагеря: два пальца', () => {
  test('второй палец отменяет тап — щипок не промах по зданию', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.down(2, 200, 100);
    s.canvas.up(2, 200, 100);
    s.canvas.up(1, 100, 100);
    assert.deepEqual(s.taps, [], 'щипок открыл карточку');
  });

  test('пальцы разъезжаются — кадр сужается', () => {
    const s = stand();
    s.camera.zoomLevel = 100;
    s.canvas.down(1, 100, 100);
    s.canvas.down(2, 200, 100); // между пальцами 100
    s.canvas.move(2, 300, 100); // стало 200
    assert.deepEqual(s.camera.zoomSet, [50], 'щипок отдалил вместо приближения');
  });

  test('сведённые в точку пальцы зум не трогают', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.down(2, 103, 100); // 3 пикселя — это не щипок
    s.canvas.move(2, 105, 100);
    assert.deepEqual(s.camera.zoomSet, []);
  });
});

describe('Ввод лагеря: границы', () => {
  test('в вылазке лагерь жестов не слышит — там свой ввод', () => {
    const s = stand({ active: false });
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 300, 300);
    s.canvas.up(1, 300, 300);
    s.canvas.wheel(100);
    assert.deepEqual(s.taps, []);
    assert.deepEqual(s.input.pan, { x: 0, z: 0 });
    assert.deepEqual(s.camera.zoomStep, []);
    assert.equal(s.touched(), 0, 'лагерь проснулся от чужого жеста');
  });

  test('колесо приближает и не листает страницу', () => {
    const s = stand();
    assert.equal(s.canvas.wheel(120).prevented, true, 'страница уехала бы под колесом');
    s.canvas.wheel(-120);
    assert.deepEqual(s.camera.zoomStep, [2, -2]);
  });

  test('касание будит лагерь: он замирает через 20 секунд без них', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    s.canvas.move(1, 140, 100);
    s.canvas.wheel(120);
    assert.equal(s.touched(), 3);
  });

  test('палец захватывается, но отказ браузера жест не ломает', () => {
    const s = stand();
    s.canvas.down(1, 100, 100);
    assert.deepEqual(s.canvas.captured, [1]);

    const t = stand();
    t.canvas.capture = 'throws';
    t.canvas.down(1, 100, 100);
    t.canvas.move(1, 200, 100);
    assert.deepEqual(t.input.pan, { x: -10, z: 0 }, 'без захвата жест умер');
  });
});
