import * as THREE from 'three';
import { mulberry32, pick, randInt } from '../core/rng';
import { bakedGeometry, bakedMaterial } from './baked';
import type { Part } from './baked';
import { VILLAGE_MODELS } from './village.data';
import type { VillagePartModelName } from './village.data';
import { MATERIAL, VILLAGE_PALETTE } from './palette';

/**
 * Генератор городских домов (§6.1) на словаре Medieval Village MegaKit.
 * Первый набор, из которого игра собирает постройку **планом**, а не берёт
 * куском и не растягивает: дом описывается пролётом, глубиной и этажами,
 * а генератор раскладывает по этому плану стены, углы, крышу и трубу.
 *
 * Всё, что можно померить, меряется по запечённой геометрии, а не пишется
 * числом: ширину клетки даёт стена, высоту этажа — она же, свес крыши — сама
 * крыша. Числами объявлено только то, что числом и является: сетка пролётов
 * набора (крыши нарезаны под 4 и 6 метров) и рост человека двух миров.
 *
 * Дом собирается в единицах набора дверью в +Z и приводится к игре одним
 * масштабом в самом конце: разбросанные по частям множители — то, чем
 * болеют такие генераторы, и лечится это одной точкой пересчёта.
 */

/* ---------- масштаб ---------- */

/**
 * Человек игры — 1,51 единицы: замер heroGeometry('knight'), и рядом с ним
 * жильцы двора приводятся к тому же росту. Человек набора — 1,8 метра,
 * обычный рост персонажей Quaternius. Дом, сведённый по человеку, стоит
 * рядом с героем в своём масштабе: дверь 2,3 м набора становится дверью
 * в 1,9 единицы — городская, выше человека, как ей и положено.
 * Что замер 1,51 не разъехался с кодом героя, сторожит village.rules.ts.
 */
export const GAME_HUMAN = 1.51;
const KIT_HUMAN = 1.8;
export const VILLAGE_SCALE = GAME_HUMAN / KIT_HUMAN;

/* ---------- сетка набора: что объявлено, а что измерено ---------- */

const WALL = VILLAGE_MODELS['Wall_Plaster_Straight'];

/** Ширина клетки стены — из геометрии стены, не из головы. */
const CELL = WALL.max[0] - WALL.min[0];
/** Высота этажа — верх стены. */
const FLOOR = WALL.max[1];

/** Пролёты, под которые набор нарезал крыши и фронтоны. */
export const SPANS = [4, 6] as const;
export type Span = (typeof SPANS)[number];

/** Глубины, на которые у пролёта есть черепица (шаг набора — 2 м). */
export const DEPTHS: Readonly<Record<Span, readonly number[]>> = {
  4: [4, 6, 8],
  6: [6, 8, 10],
};

/* ---------- план дома ---------- */

/** Чем закрыта клетка стены. */
export type Bay = 'глухая' | 'окно' | 'дверь' | 'фахверк';

export interface HouseSpec {
  readonly span: Span;
  /** Глубина в метрах набора — одна из DEPTHS[span]. */
  readonly depth: number;
  readonly floors: 1 | 2;
  /** Штукатурка или кирпич — материал всех стен дома. */
  readonly material: 'штукатурка' | 'кирпич';
  /** Клетка фасада с дверью, 0…span/CELL-1. */
  readonly door: number;
  /**
   * Заполнение стен по этажам: [этаж][сторона][клетка].
   * Стороны в порядке фасад (+Z), зад (−Z), лево (−X), право (+X).
   */
  readonly bays: readonly (readonly (readonly Bay[])[])[];
  /** Смещение трубы вдоль конька, клетки от центра. */
  readonly chimney: number;
}

/** Стены по материалам: вопрос клетки — «чем закрыта», ответ — модель. */
const WALLS: Record<HouseSpec['material'], Record<Exclude<Bay, 'фахверк'>, VillagePartModelName>> = {
  'штукатурка': {
    'глухая': 'Wall_Plaster_Straight',
    'окно': 'Wall_Plaster_Window_Wide_Round',
    'дверь': 'Wall_Plaster_Door_Round',
  },
  'кирпич': {
    'глухая': 'Wall_UnevenBrick_Straight',
    'окно': 'Wall_UnevenBrick_Window_Wide_Round',
    'дверь': 'Wall_UnevenBrick_Door_Round',
  },
};

/**
 * Случайный дом из сида. Правила заполнения — не эстетика, а читаемость:
 * дверь одна и на первом этаже; фасад окон не жалеет, зад глух чаще, чем
 * смотрит; фахверк — примета штукатурки, у кирпича его не бывает.
 */
export function houseSpecOf(seed: number): HouseSpec {
  const rng = mulberry32(seed);
  const span = pick(rng, SPANS);
  const depth = pick(rng, DEPTHS[span]);
  const floors: 1 | 2 = rng() < 0.65 ? 2 : 1;
  const material = rng() < 0.6 ? 'штукатурка' : 'кирпич';
  const front = Math.round(span / CELL);
  const side = Math.round(depth / CELL);
  const door = randInt(rng, front);

  const bay = (chance: number, timber: number): Bay => {
    const roll = rng();
    if (roll < chance) return 'окно';
    if (material === 'штукатурка' && roll < chance + timber) return 'фахверк';
    return 'глухая';
  };
  const row = (cells: number, chance: number, timber = 0): Bay[] => {
    const out: Bay[] = [];
    for (let i = 0; i < cells; i++) out.push(bay(chance, timber));
    return out;
  };

  const bays: Bay[][][] = [];
  for (let f = 0; f < floors; f++) {
    const facade = f === 0
      ? row(front, 0.75).map((b, i): Bay => (i === door ? 'дверь' : b))
      : row(front, 0.65, 0.25);
    bays.push([facade, row(front, 0.25, 0.15), row(side, 0.4, 0.15), row(side, 0.4, 0.15)]);
  }

  return { span, depth, floors, material, door, bays, chimney: randInt(rng, side - 1) - Math.floor((side - 1) / 2) };
}

/* ---------- раскладка плана в детали ---------- */

export interface PlacedPart {
  readonly model: VillagePartModelName;
  /** Матрица 4×4 по столбцам, в единицах набора. */
  readonly matrix: readonly number[];
}

/** Матрица «поворот вокруг Y, потом перенос». */
const at = (x: number, y: number, z: number, ry = 0): readonly number[] => {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
};

/**
 * Разложить дом в детали. Дом стоит подошвой на y = 0, серединой в нуле,
 * фасад смотрит в +Z; конёк крыши идёт вдоль Z.
 *
 * Стены ставятся серединой клетки и разворачиваются рельефом наружу:
 * у модели стены брус и наличники выступают в −Z, поэтому стена, глядящая
 * наружу стороной +Z, повёрнута на π. Дверное полотно навешивается
 * на петлю у левого косяка — ось петли модель держит в своём нуле.
 */
export function housePlanOf(spec: HouseSpec): readonly PlacedPart[] {
  const parts: PlacedPart[] = [];
  const front = Math.round(spec.span / CELL);
  const side = Math.round(spec.depth / CELL);
  const halfW = spec.span / 2;
  const halfD = spec.depth / 2;
  const walls = WALLS[spec.material];

  const wallOf = (b: Bay): VillagePartModelName =>
    b === 'фахверк' ? 'Wall_Plaster_WoodGrid' : walls[b];

  for (let f = 0; f < spec.floors; f++) {
    const y = f * FLOOR;
    const rows = spec.bays[f]!;
    // Фасад и зад: клетки идут по X, стена смотрит наружу по Z.
    for (let i = 0; i < front; i++) {
      const x = -halfW + CELL / 2 + i * CELL;
      const facade = rows[0]![i]!;
      parts.push({ model: wallOf(facade), matrix: at(x, y, halfD, Math.PI) });
      if (facade === 'окно') parts.push({ model: 'Window_Wide_Round1', matrix: at(x, y, halfD, Math.PI) });
      if (facade === 'дверь') {
        // Петля — у левого косяка проёма, если смотреть с улицы.
        const leaf = VILLAGE_MODELS['Door_1_Round'];
        const opening = leaf.max[0] - leaf.min[0];
        parts.push({ model: 'Door_1_Round', matrix: at(x + opening / 2, y, halfD, Math.PI) });
      }
      const back = rows[1]![i]!;
      parts.push({ model: wallOf(back), matrix: at(x, y, -halfD, 0) });
      if (back === 'окно') parts.push({ model: 'Window_Wide_Round1', matrix: at(x, y, -halfD, 0) });
    }
    // Бока: клетки идут по Z, стена повёрнута рельефом наружу — у модели
    // наружная сторона −Z, поэтому левой стене достаётся +π/2, правой −π/2.
    for (let i = 0; i < side; i++) {
      const z = -halfD + CELL / 2 + i * CELL;
      const left = rows[2]![i]!;
      parts.push({ model: wallOf(left), matrix: at(-halfW, y, z, Math.PI / 2) });
      if (left === 'окно') parts.push({ model: 'Window_Wide_Round1', matrix: at(-halfW, y, z, Math.PI / 2) });
      const right = rows[3]![i]!;
      parts.push({ model: wallOf(right), matrix: at(halfW, y, z, -Math.PI / 2) });
      if (right === 'окно') parts.push({ model: 'Window_Wide_Round1', matrix: at(halfW, y, z, -Math.PI / 2) });
    }
    // Углы: брус на каждом стыке стен.
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      parts.push({ model: 'Corner_Exterior_Wood', matrix: at(sx * halfW, y, sz * halfD, 0) });
    }
  }

  // Крыша: черепица набора нарезана ровно под план, конёк вдоль Z.
  const roofTop = spec.floors * FLOOR;
  const roof = `Roof_RoundTiles_${spec.span}x${spec.depth}` as VillagePartModelName;
  parts.push({ model: roof, matrix: at(0, roofTop, 0, 0) });
  // Фронтоны затыкают торцы под скатами; задний повёрнут на улицу спиной.
  const gable = `Roof_Front_Brick${spec.span}` as VillagePartModelName;
  parts.push({ model: gable, matrix: at(0, roofTop, halfD, Math.PI) });
  parts.push({ model: gable, matrix: at(0, roofTop, -halfD, 0) });
  // Труба садится на скат у конька: подошва ниже конька на половину
  // своей высоты, чтобы низ ушёл в крышу, а не повис над ней.
  const chimney = VILLAGE_MODELS['Prop_Chimney2'];
  const ridge = roofTop + VILLAGE_MODELS[roof].max[1];
  parts.push({
    model: 'Prop_Chimney2',
    matrix: at(0, ridge - (chimney.max[1] - chimney.min[1]) / 2, spec.chimney * CELL, 0),
  });

  return parts;
}

/* ---------- геометрия ---------- */

/**
 * Собрать дом в одну геометрию игры. Одна на дом: город из десятков домов
 * рисуется десятками мешей, а не тысячами деталей.
 */
export function houseGeometry(spec: HouseSpec, scale = VILLAGE_SCALE): THREE.BufferGeometry {
  const parts: Part[] = housePlanOf(spec).map((p) => ({
    model: VILLAGE_MODELS[p.model],
    palette: VILLAGE_PALETTE,
    matrix: p.matrix,
  }));
  return bakedGeometry(parts, { scale, shift: [0, 0, 0] });
}

/* ---------- улица ---------- */

export interface PlacedHouse {
  readonly spec: HouseSpec;
  /** Середина дома в единицах игры. */
  readonly x: number;
  readonly z: number;
  /** Поворот дома: фасад смотрит на улицу. */
  readonly ry: number;
}

/**
 * Улица: дома в два порядка фасадами друг к другу, ширина проезда — клетка
 * набора с обеих сторон. Раскладка одномерная нарочно: город игры — это
 * прежде всего улица, и вопрос генератора — «читается ли порядок домов»,
 * а не «умеем ли мы кварталы». Кварталы складываются из улиц позже.
 */
export function streetOf(seed: number, houses: number): readonly PlacedHouse[] {
  const rng = mulberry32(seed);
  const out: PlacedHouse[] = [];
  /** Ширина проезда между порядками — две клетки набора в единицах игры. */
  const road = 2 * CELL * VILLAGE_SCALE;
  const gap = CELL * VILLAGE_SCALE / 2;
  let along = [0, 0];
  for (let i = 0; i < houses; i++) {
    const rowAt = rng() < 0.5 ? 0 : 1;
    const spec = houseSpecOf(seed * 1000 + i);
    const w = spec.span * VILLAGE_SCALE;
    const d = spec.depth * VILLAGE_SCALE;
    const x = along[rowAt]! + w / 2;
    out.push({
      spec,
      x,
      z: (rowAt === 0 ? 1 : -1) * (road / 2 + d / 2),
      ry: rowAt === 0 ? Math.PI : 0,
    });
    along[rowAt] = x + w / 2 + gap;
  }
  return out;
}

/** Улица, собранная в сцену: дома, земля под ними и уборка за собой. */
export interface StreetScene {
  readonly group: THREE.Group;
  readonly street: readonly PlacedHouse[];
  /** Середина застройки — куда смотреть камере. */
  readonly center: readonly [number, number];
  readonly dispose: () => void;
}

/**
 * Улица одной группой. Дом — один меш: город из десятков домов рисуется
 * десятками вызовов, а не тысячами деталей. Земля своя, потому что кадр
 * улицы живёт без лагеря и его луга.
 */
export function streetScene(seed: number, houses = 10): StreetScene {
  const group = new THREE.Group();
  const street = streetOf(seed, houses);
  const material = bakedMaterial();
  const geometries: THREE.BufferGeometry[] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const h of street) {
    const geometry = houseGeometry(h.spec);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(h.x, 0, h.z);
    mesh.rotation.y = h.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const w = (h.spec.span / 2) * VILLAGE_SCALE;
    x0 = Math.min(x0, h.x - w);
    x1 = Math.max(x1, h.x + w);
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0 + 30, 60),
    new THREE.MeshLambertMaterial({ color: MATERIAL['трава'] }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((x0 + x1) / 2, -0.02, 0);
  ground.receiveShadow = true;
  geometries.push(ground.geometry);
  group.add(ground);
  return {
    group,
    street,
    center: [(x0 + x1) / 2, 0],
    dispose: () => {
      for (const g of geometries) g.dispose();
      material.dispose();
      (ground.material as THREE.Material).dispose();
    },
  };
}
