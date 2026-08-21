/**
 * Кладбище — вторая локация мировой карты, собранная на готовом наборе
 * (§4, §6.1.7). Как и замок, это **место, по которому ходят**: ни добычи,
 * ни контейнеров здесь нет, и это объявленное состояние, а не забытый шаг.
 *
 * От замка кладбище отличается двумя вещами, и обе — решения, а не отделка.
 *
 * 1. **Ограда вместо стены.** Она ниже головы, через неё видно, и внутрь
 *    видно снаружи — участок читается целиком ещё до входа. Стена замка
 *    ровно наоборот: она прячет двор, и потому в замок заходят узнать,
 *    что внутри.
 * 2. **Здесь кто-то есть.** Привидение (§15, `enemies.ts`) — единственный
 *    противник, которого не бывает в вылазке. Оно медленнее героя, и уйти
 *    от него можно шагом: на кладбище нечего добывать, поэтому противник,
 *    от которого нельзя уйти, сделал бы прогулку сделкой с отрицательной
 *    ценой. Привидение делает не опасным, а **населённым**.
 *
 * Всё выводится из сида: размер участка, материал ограды, где ворота,
 * как стоят могилы и где висят привидения. Одна и та же точка карты
 * собирается одним и тем же кладбищем весь день (§4).
 */
import { mulberry32, randInt, type Rng } from '../core/rng';
import { ENEMY_STATS } from './enemies';
import { FENCE_CELL, FENCE_MATERIALS, buildFence, type FenceMaterial, type FencePiece } from './fence';
import { distanceField, idx } from './grid';
import type { Spot } from './castle';
import type { Cell, Enemy, GameLocation } from './types';

/** Поле между лесом и оградой: место, с которого участок видно целиком. */
export const FIELD = 3;
/** Толщина леса по краю локации. Лес и здесь держит границу локации. */
export const WOOD = 3;

/** Сколько привидений населяют участок. Меньше двух — пусто, больше четырёх —
 *  прогулка превращается в бой, которого локация не обещала. */
const GHOSTS_MIN = 2;
const GHOSTS_MAX = 4;

/** Надгробия. Первое — насыпь без камня: по ней ходят, остальные обходят. */
const MOUND = 'grave';
const STONES = ['gravestone-cross', 'gravestone-round', 'gravestone-bevel', 'cross'] as const;

/** Отметка на участке: модель, клетка локации и четверть поворота. */
export interface GraveMark {
  readonly model: string;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  /** Занимает ли клетку. Насыпь не занимает: через могилу переступают. */
  readonly solid: boolean;
}

export interface GraveSite {
  readonly loc: GameLocation;
  readonly material: FenceMaterial;
  /** Детали ограды в клетках набора; координаты бывают половинными. */
  readonly fence: readonly FencePiece[];
  /** Где стоит клетка (0, 0) плана — в клетках локации. */
  readonly at: Spot;
  /** Могилы, надгробия и склеп — в клетках локации. */
  readonly marks: readonly GraveMark[];
  /** Клетки леса: рендеру они деревья, симуляции — занятые клетки. */
  readonly trees: readonly Spot[];
  /** Пеньки: вырубленный когда-то край, по нему ходят. */
  readonly stumps: readonly Spot[];
  /** Проезд в клетках локации — сюда приходят снаружи. */
  readonly gate: Cell;
}

/** Клетка локации, в которую попадает клетка плана. */
export const spotAt = (site: { at: Spot }, plan: { x: number; z: number }): Cell => ({
  x: Math.round(site.at.x + plan.x * FENCE_CELL),
  z: Math.round(site.at.z + plan.z * FENCE_CELL),
});

/** Периметр участка по часовой стрелке — цепь, из которой строится ограда. */
function ringOf(w: number, d: number): Spot[] {
  const out: Spot[] = [];
  for (let x = 0; x < w; x++) out.push({ x, z: 0 });
  for (let z = 1; z < d; z++) out.push({ x: w - 1, z });
  for (let x = w - 2; x >= 0; x--) out.push({ x, z: d - 1 });
  for (let z = d - 2; z >= 1; z--) out.push({ x: 0, z });
  return out;
}

/**
 * Кладбище по сиду. Размер локации — от размера участка: участок и есть то,
 * ради чего локация существует.
 */
export function generateGraveSite(seed: number): GraveSite {
  const rng: Rng = mulberry32(seed);
  const w = 4 + randInt(rng, 3);
  const d = 4 + randInt(rng, 3);
  const material = FENCE_MATERIALS[randInt(rng, FENCE_MATERIALS.length)]!;

  const plan = Math.max(w, d) * FENCE_CELL;
  const size = plan + 2 * (FIELD + WOOD);
  const at: Spot = {
    x: WOOD + FIELD + Math.floor((plan - w * FENCE_CELL) / 2),
    z: WOOD + FIELD + Math.floor((plan - d * FENCE_CELL) / 2),
  };

  const blocked = new Uint8Array(size * size);
  const block = (x: number, z: number): void => {
    if (x < 0 || z < 0 || x >= size || z >= size) return;
    blocked[idx(size, x, z)] = 1;
  };

  // Лес по периметру — он же рамка локации: край карты обязан оставаться
  // стеной, и здесь эта стена деревья. Ближний ряд — пеньки: край участка
  // когда-то вырубили, и по нему ходят.
  const trees: Spot[] = [];
  const stumps: Spot[] = [];
  const isWood = (x: number, z: number): boolean =>
    x < WOOD || z < WOOD || x >= size - WOOD || z >= size - WOOD;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (!isWood(x, z)) continue;
      /**
       * Пенёк встаёт вместо дерева только там, где с него есть куда шагнуть:
       * у клетки обязан быть сосед вне леса. Без этого условия угол внутреннего
       * ряда становится проходимым карманом, окружённым стволами, — клеткой,
       * до которой не дойти, и волна от выхода находит её первой же проверкой.
       */
      const open = !isWood(x - 1, z) || !isWood(x + 1, z) || !isWood(x, z - 1) || !isWood(x, z + 1);
      if (open && (x * 7 + z * 13) % 5 === 0) {
        stumps.push({ x, z });
        continue;
      }
      block(x, z);
      trees.push({ x, z });
    }
  }

  // Ограда. Ворота выпадают на прямой стороне: створка в углу упёрлась бы
  // в поворот, а у половины материалов её вовсе нет, и там ворота — проём.
  const ring = ringOf(w, d);
  const straight = ring.filter((s) => (s.x > 0 && s.x < w - 1) || (s.z > 0 && s.z < d - 1));
  const gateSpot = straight[randInt(rng, straight.length)] ?? ring[0]!;
  const gates = new Set([`${gateSpot.x}:${gateSpot.z}`]);
  const fence = buildFence(ring, material, { gates, rng });

  // Ограда занимает свои клетки — иначе она рисунок на земле, а не ограда
  // (§6.1.6). Клетка набора это `FENCE_CELL` клеток локации, и занимает она
  // весь квадрат; клетка ворот остаётся проходимой.
  for (const spot of ring) {
    if (gates.has(`${spot.x}:${spot.z}`)) continue;
    const base = spotAt({ at }, spot);
    for (let dz = 0; dz < FENCE_CELL; dz++) {
      for (let dx = 0; dx < FENCE_CELL; dx++) block(base.x + dx, base.z + dz);
    }
  }

  const gate = spotAt({ at }, gateSpot);

  // Могилы рядами внутри участка. Ряд — через клетку: между рядами ходят,
  // и участок остаётся участком, а не сплошным камнем.
  const marks: GraveMark[] = [];
  const yard = {
    x0: at.x + FENCE_CELL,
    z0: at.z + FENCE_CELL,
    x1: at.x + (w - 1) * FENCE_CELL - 1,
    z1: at.z + (d - 1) * FENCE_CELL - 1,
  };
  for (let z = yard.z0; z <= yard.z1; z += 2) {
    for (let x = yard.x0; x <= yard.x1; x += 2) {
      const roll = rng();
      if (roll < 0.22) continue; // пустое место в ряду: кладбище не склад
      if (roll < 0.55) {
        marks.push({ model: MOUND, x, z, turn: randInt(rng, 2) * 2, solid: false });
        continue;
      }
      marks.push({
        model: STONES[randInt(rng, STONES.length)]!,
        x,
        z,
        turn: randInt(rng, 4),
        solid: true,
      });
      block(x, z);
    }
  }

  // Склеп — один и у дальней от ворот стороны: единственная постройка
  // участка, и её видно от ворот через всю ограду.
  const far: Cell = {
    x: gate.x < at.x + (w * FENCE_CELL) / 2 ? yard.x1 - 1 : yard.x0 + 1,
    z: gate.z < at.z + (d * FENCE_CELL) / 2 ? yard.z1 - 1 : yard.z0 + 1,
  };
  marks.push({ model: 'crypt', x: far.x, z: far.z, turn: randInt(rng, 4), solid: true });
  block(far.x, far.z);
  // Гроб у склепа: он тут и объясняет, зачем склеп открыт.
  const lid: Cell = { x: far.x + (far.x > yard.x0 ? -1 : 1), z: far.z };
  marks.push({ model: 'coffin', x: lid.x, z: lid.z, turn: randInt(rng, 4), solid: false });

  /**
   * Эвакуация — снаружи, перед воротами. Сторона выбирается та, с которой
   * нет участка: внутрь ограды точка выхода не встаёт никогда.
   */
  const outX = gateSpot.x === 0 ? -1 : gateSpot.x === w - 1 ? 1 : 0;
  const outZ = gateSpot.z === 0 ? -1 : gateSpot.z === d - 1 ? 1 : 0;
  const evac: Cell = {
    x: Math.max(WOOD, Math.min(size - WOOD - 1, gate.x + outX * (FIELD - 1))),
    z: Math.max(WOOD, Math.min(size - WOOD - 1, gate.z + outZ * (FIELD - 1))),
  };
  blocked[idx(size, evac.x, evac.z)] = 0;

  /**
   * Ни одной отрезанной клетки. Ряды могил лежат через клетку и сами дорогу
   * не перекрывают, а вот склеп встаёт не в ряд, и угол за ним отрезается —
   * ту же ошибку у замка нашли ногами (§6.1.6), и чинится она так же:
   * не подбором места, а проверкой.
   *
   * Волна идёт от выхода; если свободная клетка ею не задета, убирается
   * ближайшее к ней надгробие — и волна считается заново. Убирать, а не
   * двигать: надгробие стоит в ряду, и сдвинутое оно выпадет из ряда.
   */
  for (let pass = 0; pass < 8; pass++) {
    const reach = distanceField(size, blocked, evac);
    let stuck = -1;
    for (let i = 0; i < size * size; i++) {
      if (blocked[i] === 0 && reach[i]! < 0) {
        stuck = i;
        break;
      }
    }
    if (stuck < 0) break;
    const sx = stuck % size;
    const sz = (stuck / size) | 0;
    const near = marks.findIndex(
      (m) => m.solid && Math.abs(m.x - sx) + Math.abs(m.z - sz) <= 2,
    );
    if (near < 0) {
      // Отрезала не отметка, а ограда: такой клетке внутри участка взяться
      // неоткуда, и молчать об этом нельзя — пусть падает правило.
      break;
    }
    const gone = marks.splice(near, 1)[0]!;
    blocked[idx(size, gone.x, gone.z)] = 0;
  }

  // Привидения — внутри ограды и только там: у кладбища есть край, и за ним
  // их нет. Спят до сближения, как все противники (§15).
  const open: Cell[] = [];
  for (let z = yard.z0; z <= yard.z1; z++) {
    for (let x = yard.x0; x <= yard.x1; x++) {
      if (blocked[idx(size, x, z)] === 0) open.push({ x, z });
    }
  }
  const enemies: Enemy[] = [];
  const count = Math.min(open.length, GHOSTS_MIN + randInt(rng, GHOSTS_MAX - GHOSTS_MIN + 1));
  for (let i = 0; i < count; i++) {
    const cell = open.splice(randInt(rng, open.length), 1)[0];
    if (cell === undefined) break;
    enemies.push({
      id: i,
      kind: 'ghost',
      x: cell.x,
      z: cell.z,
      prevX: cell.x,
      prevZ: cell.z,
      wounds: ENEMY_STATS.ghost.wounds,
      awake: false,
      telegraph: 0,
      cooldown: 0,
    });
  }

  const loc: GameLocation = {
    seed,
    tier: 0,
    size,
    blocked,
    evac,
    containers: [],
    enemies,
    backSteps: distanceField(size, blocked, evac),
  };
  return { loc, material, fence, at, marks, trees, stumps, gate };
}
