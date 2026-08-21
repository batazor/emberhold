/**
 * Правила ограды (§6.1.7). Проверяется не то, красива ли ограда, — это решает
 * глаз, — а три обещания, которые модель ограды даёт числами.
 *
 * Первое: **словарь не знает про набор ничего сверх обмера**. Каждое имя
 * детали и каждая прямая сверяются с `catalog.json`, который пишет
 * `npm run models -- --pack=graveyard --write`. Разъехаться молча они
 * не могут: набор обновится — правило упадёт.
 *
 * Второе: **ограда — панель на линии, а не блок в клетку**, и это ровно то,
 * чем она отличается от стены замка. Отличие измеряется, а не объявляется.
 *
 * Третье: **порядок клеток ничего не значит**. Одна и та же ограда
 * из перемешанного списка обязана выйти той же самой — на этом держится
 * и кольцо генератора, и мазок игрока.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { mulberry32 } from '../core/rng';
import { CASTLE_CELL, type Spot } from './castle';
import {
  FENCE,
  FENCE_CELL,
  FENCE_MATERIALS,
  buildFence,
  type FenceMaterial,
} from './fence';

interface CatalogModel {
  readonly name: string;
  readonly size: readonly number[];
  readonly rim: readonly boolean[];
}

const catalog = JSON.parse(
  readFileSync(new URL('../../assets/kenney-graveyard-kit/catalog.json', import.meta.url), 'utf8'),
) as { module: { cell: number }; adopted: readonly string[]; models: readonly CatalogModel[] };

const measured = new Map(catalog.models.map((m) => [m.name, m]));
const adopted = new Set(catalog.adopted);

/** Все имена словаря, по материалам. */
const namesOf = (material: FenceMaterial): string[] => {
  const kind = FENCE[material];
  return [...kind.spans, ...(kind.gate === null ? [] : [kind.gate]), ...(kind.post === null ? [] : [kind.post])];
};

/** Прямоугольное кольцо клеток — самый частый случай и у карты, и у игрока. */
const ring = (w: number, d: number): Spot[] => {
  const out: Spot[] = [];
  for (let x = 0; x < w; x++) out.push({ x, z: 0 });
  for (let z = 1; z < d; z++) out.push({ x: w - 1, z });
  for (let x = w - 2; x >= 0; x--) out.push({ x, z: d - 1 });
  for (let z = d - 2; z >= 1; z--) out.push({ x: 0, z });
  return out;
};

describe('Ограда: словарь сверен с обмером набора', () => {
  for (const material of FENCE_MATERIALS) {
    test(`${material}: каждая деталь есть в наборе и поехала в бандл`, () => {
      for (const name of namesOf(material)) {
        assert.ok(measured.has(name), `«${name}» нет в каталоге набора`);
        assert.ok(adopted.has(name), `«${name}» стоит в словаре, но в бандл не поехал`);
      }
    });

    test(`${material}: пролёт пересекает ровно два противоположных ребра`, () => {
      for (const name of FENCE[material].spans) {
        const rim = measured.get(name)!.rim;
        const along = [rim[0] === true && rim[1] === true, rim[2] === true && rim[3] === true];
        assert.ok(
          along[0] !== along[1],
          `«${name}»: линия ${rim.map((r) => (r === true ? 1 : 0)).join('')} — это не прямая`,
        );
      }
    });

    test(`${material}: пролёт шириной ровно в клетку набора`, () => {
      const cell = catalog.module.cell;
      for (const name of FENCE[material].spans) {
        const size = measured.get(name)!.size;
        const long = Math.max(size[0]!, size[2]!);
        assert.ok(
          Math.abs(long - cell) < 0.02,
          `«${name}»: длина ${long} при клетке ${cell} — пролёт не сомкнётся с соседним`,
        );
      }
    });
  }

  test('деталь ограды — панель, а не блок: она тонкая', () => {
    // Мерка: панель обязана занимать меньше половины клетки поперёк. Без
    // этого «ограда стоит на линии» было бы словом, а не свойством набора.
    for (const material of FENCE_MATERIALS) {
      for (const name of FENCE[material].spans) {
        const size = measured.get(name)!.size;
        const thin = Math.min(size[0]!, size[2]!);
        assert.ok(
          thin < catalog.module.cell / 2,
          `«${name}»: толщина ${thin} — это уже блок в клетку, а не панель`,
        );
      }
    }
  });

  test('сетка ограды та же, что у замка: одна клетка лагеря принимает обе', () => {
    assert.equal(FENCE_CELL, CASTLE_CELL);
  });
});

describe('Ограда: конструктор', () => {
  test('кольцо замкнуто: пролётов ровно столько, сколько сторон', () => {
    for (const material of FENCE_MATERIALS) {
      const cells = ring(5, 4);
      const pieces = buildFence(cells, material, { rng: mulberry32(1) });
      const spans = pieces.filter((p) => p.role !== 'столб');
      // У кольца отрезков столько же, сколько клеток: последняя смыкается
      // с первой сама, и особого случая для этого в конструкторе нет.
      assert.equal(spans.length, cells.length, `${material}: кольцо разорвано`);
    }
  });

  test('порядок клеток ничего не значит', () => {
    const cells = ring(5, 4);
    const shuffled = [...cells].reverse();
    for (const material of FENCE_MATERIALS) {
      const a = buildFence(cells, material, { rng: mulberry32(7) });
      const b = buildFence(shuffled, material, { rng: mulberry32(7) });
      const at = (p: { x: number; z: number; turn: number }): string => `${p.x}:${p.z}:${p.turn}`;
      assert.deepEqual(
        a.filter((p) => p.role !== 'столб').map(at).sort(),
        b.filter((p) => p.role !== 'столб').map(at).sort(),
        `${material}: ограда зависит от порядка клеток`,
      );
    }
  });

  test('углы не требуют угловой детали: пролёты смыкаются сами', () => {
    // Уголок из трёх клеток: два отрезка под прямым углом. Деталей ровно два
    // (плюс столб у дерева) — угловой в наборе не берётся вовсе.
    const corner: Spot[] = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
    for (const material of FENCE_MATERIALS) {
      const pieces = buildFence(corner, material, { rng: mulberry32(3) });
      assert.equal(pieces.filter((p) => p.role === 'пролёт').length, 2, `${material}: угол потерян`);
    }
  });

  test('проезд: створка у материала со створкой, проём у материала без неё', () => {
    const cells = ring(5, 4);
    const gates = new Set(['2:0']);
    for (const material of FENCE_MATERIALS) {
      const pieces = buildFence(cells, material, { gates, rng: mulberry32(5) });
      const drive = pieces.filter((p) => p.role === 'проезд');
      if (FENCE[material].gate === null) {
        assert.equal(drive.length, 0, `${material}: проезд обязан быть проёмом`);
        // И проём этот настоящий: у клетки ворот не остаётся ни одного пролёта.
        const near = pieces.filter((p) => p.role === 'пролёт' && Math.abs(p.z - 0) < 0.01
          && Math.abs(p.x - 2) <= 0.5);
        assert.equal(near.length, 0, `${material}: створки нет, а проход закрыт`);
      } else {
        assert.ok(drive.length > 0, `${material}: створка не встала`);
      }
    }
  });

  test('столб есть только у дерева: у трёх других торец панели закрывает стык', () => {
    const corner: Spot[] = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
    for (const material of FENCE_MATERIALS) {
      const posts = buildFence(corner, material, { rng: mulberry32(9) })
        .filter((p) => p.role === 'столб');
      assert.equal(
        posts.length > 0,
        FENCE[material].post !== null,
        `${material}: столбы не совпали со словарём`,
      );
    }
  });

  test('одна клетка — ограды нет: пролёту не на чем стоять', () => {
    for (const material of FENCE_MATERIALS) {
      assert.equal(buildFence([{ x: 0, z: 0 }], material).length, 0);
    }
  });

  test('сторона панели одна на всё кольцо: ограда не гуляет зигзагом', () => {
    // Пролёты вдоль x стоят на одной стороне сверху и снизу кольца — то есть
    // поворот у верхней стороны и у нижней разный. Без этого стена, прижатая
    // к краю клетки, ходила бы то внутрь, то наружу.
    for (const material of FENCE_MATERIALS) {
      const pieces = buildFence(ring(6, 5), material, { rng: mulberry32(11) })
        .filter((p) => p.role === 'пролёт');
      const top = pieces.filter((p) => p.z === 0);
      const bottom = pieces.filter((p) => p.z === 4);
      assert.ok(top.length > 0 && bottom.length > 0);
      assert.equal(new Set(top.map((p) => p.turn)).size, 1, `${material}: верх кольца гуляет`);
      assert.equal(new Set(bottom.map((p) => p.turn)).size, 1, `${material}: низ кольца гуляет`);
      assert.notEqual(
        top[0]!.turn,
        bottom[0]!.turn,
        `${material}: обе стороны прижаты в одну сторону, а не наружу`,
      );
    }
  });
});
