/**
 * Правила значков карты (`worldMap.ts`).
 *
 * Проверяется не «красиво ли» — это решает глаз на карте и в `world.html`, —
 * а три обещания, которые ломаются молча: значки видов не сливаются друг
 * с другом, значок сидит в границах своего узла и не наступает на чужие
 * каналы, и рисунок масштабируется радиусом, а не пикселями.
 *
 * Замер вместо взгляда: канвас в Node не рисуется, поэтому значок
 * прослушивается — подставной контекст записывает вызовы пути, и сравниваются
 * записи, а не картинки.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { KIND } from '../sim/world';
import type { NodeKind } from '../sim/world';
import { NODE_ICON, drawCampTent } from './worldMap';

type Op = readonly (string | number)[];

/** Записать путь значка: каждый вызов контекста — строка с аргументами. */
function trace(draw: (ctx: CanvasRenderingContext2D) => void): Op[] {
  const ops: Op[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, prop: string) =>
        (...args: number[]): void => {
          ops.push([prop, ...args.map((v) => Math.round(v * 1e6) / 1e6)]);
        },
    },
  ) as CanvasRenderingContext2D;
  draw(ctx);
  return ops;
}

const KINDS = Object.keys(KIND) as NodeKind[];

/** Как далеко от центра узла заходит запись пути, в долях радиуса. */
function reach(ops: Op[], r: number): number {
  let out = 0;
  for (const [op, ...args] of ops) {
    if (op === 'moveTo' || op === 'lineTo') {
      out = Math.max(out, Math.abs(args[0] as number), Math.abs(args[1] as number));
    } else if (op === 'arc') {
      const [cx, cy, rad] = args as number[];
      out = Math.max(out, Math.abs(cx!) + rad!, Math.abs(cy!) + rad!);
    } else if (op === 'rect') {
      const [bx, by, bw, bh] = args as number[];
      out = Math.max(out, Math.abs(bx!), Math.abs(by!), Math.abs(bx! + bw!), Math.abs(by! + bh!));
    }
  }
  return out / r;
}

describe('Значки карты', () => {
  /**
   * Виды различимы силуэтом. Если два вида дают одну запись, форма перестаёт
   * быть каналом (§4.2), и карта возвращается к легенде, которой у неё нет.
   */
  test('значки видов не сливаются друг с другом', () => {
    const seen = new Map<string, string>();
    for (const kind of KINDS) {
      const key = JSON.stringify(trace((ctx) => NODE_ICON[kind](ctx, 0, 0, 100)));
      const twin = seen.get(key);
      assert.equal(twin, undefined, `${kind} и ${twin} нарисованы одинаково`);
      seen.set(key, kind);
    }
    const tent = JSON.stringify(trace((ctx) => drawCampTent(ctx, 0, 0, 100)));
    assert.equal(seen.get(tent), undefined, 'палатка лагеря совпала со значком узла');
  });

  /**
   * Значок сидит в узле. Каналы узла разложены по местам (§4.2): глиф события
   * в левом верху на 1,3r, флаг клана в правом от 0,95r. Значок, вылезший
   * за 1,02r, наступает на чужой канал — и читается как он.
   */
  test('значок не выходит за кольцо узла', () => {
    for (const kind of KINDS) {
      const out = reach(trace((ctx) => NODE_ICON[kind](ctx, 0, 0, 100)), 100);
      assert.ok(out <= 1.02, `${kind}: значок достаёт до ${out.toFixed(2)}r`);
    }
    const tent = reach(trace((ctx) => drawCampTent(ctx, 0, 0, 100)), 100);
    assert.ok(tent <= 1, `палатка вылезла из кольца лагеря: ${tent.toFixed(2)}r`);
  });

  /**
   * Рисунок выводится из радиуса, а не из пикселей: карта живёт на любом
   * экране, и константа в пикселях сломала бы значок молча — только на узком.
   */
  test('значок масштабируется радиусом', () => {
    for (const kind of KINDS) {
      const big = trace((ctx) => NODE_ICON[kind](ctx, 0, 0, 100));
      const half = trace((ctx) => NODE_ICON[kind](ctx, 0, 0, 50));
      // Делятся длины, но не углы: у дуги масштабом живут центр и радиус,
      // а развёртка в радианах от размера не зависит.
      const scaled = big.map(([op, ...args]) => [
        op,
        ...args.map((v, i) => (op === 'arc' && i >= 3 ? v : (v as number) / 2)),
      ]);
      assert.deepEqual(half, scaled, `${kind}: значок не в долях радиуса`);
    }
  });

  /** Тот же вызов — та же запись: значок не зависит ни от чего, кроме входа. */
  test('значок детерминирован', () => {
    for (const kind of KINDS) {
      assert.deepEqual(
        trace((ctx) => NODE_ICON[kind](ctx, 7, 11, 13)),
        trace((ctx) => NODE_ICON[kind](ctx, 7, 11, 13)),
        `${kind}: значок поплыл между вызовами`,
      );
    }
  });
});
