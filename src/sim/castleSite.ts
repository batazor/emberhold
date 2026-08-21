/**
 * Площадка замка — локация мировой карты (§4), собранная конструктором стен
 * (§6.1.6). Пока по ней только ходят: ни добычи, ни противников здесь нет,
 * и это состояние объявлено, а не забыто — локация показывает постройку,
 * а чем её наполнить, решается отдельно.
 *
 * Устройство простое и всё выводится из сида:
 *
 * 1. `generateCastle` даёт план — кольцо стен, двор, ворота, донжон.
 * 2. План раскладывается по клеткам локации с шагом `CASTLE_CELL`: клетка
 *    набора — четыре клетки локации, потому что стена обязана быть выше
 *    героя вдвое, а не вровень с ним.
 * 3. Вокруг — поле, вокруг поля — лес. Лес держит границу локации: рамка
 *    и так не вскрывается никогда, и честнее, когда её видно деревьями.
 * 4. Выход — снаружи, перед воротами. Войти в замок можно только через
 *    них, и это не декорация: проверяется волной по проходимым клеткам.
 *
 * Занятость клетки берётся у деталей, а не назначается: стена, башня
 * и лестница — сплошные, ворота проезжие, знамёна и мощение двора не мешают
 * никому. Список сплошных ролей — единственное, что здесь объявлено.
 */
import { distanceField, idx } from './grid';
import { STONES, scatterStones } from './stones';
import { CASTLE_CELL, generateCastle, type Castle, type Piece, type Role, type Spot } from './castle';
import type { Cell, GameLocation } from './types';

/** Поле между лесом и стеной: место, где замок видно целиком. */
export const FIELD = 4;
/** Толщина леса по краю локации. */
export const WOOD = 3;

/**
 * Роли, которые занимают клетку. Ворота в списке нет намеренно: под аркой
 * проезжают, и если её закрыть, замок станет коробкой без входа.
 */
const SOLID: ReadonlySet<Role> = new Set<Role>(['стена', 'угол', 'башня', 'лестница']);

export interface CastleSite {
  readonly loc: GameLocation;
  readonly castle: Castle;
  /** Где стоит клетка (0, 0) плана — в клетках локации. */
  readonly at: Spot;
  /** Клетки леса: рендеру они деревья, симуляции — просто занятые клетки. */
  readonly trees: readonly Spot[];
  /** Ворота в клетках локации — сюда приходят снаружи. */
  readonly gate: Cell;
  /**
   * Где стоит торговец (§13.5). Во дворе, а не у ворот: двор достижим только
   * через них (`castleSite.rules.ts`), и обмен поэтому стоит прогулки внутрь,
   * а не одного шага от выхода. `null` — двора у этого плана не нашлось.
   */
  readonly trader: Cell | null;
}

/**
 * Насколько близко надо подойти, чтобы торговец заговорил. Тот же порядок,
 * что у чтения эпитафий на кладбище (§6.1.7): точность тапа на телефоне
 * кончается раньше терпения.
 */
export const TRADER_REACH = 2.2;

/** Стоит ли герой у торговца. */
export function atTrader(site: CastleSite, x: number, z: number): boolean {
  const t = site.trader;
  if (t === null) return false;
  return (t.x - x) ** 2 + (t.z - z) ** 2 <= TRADER_REACH * TRADER_REACH;
}

/**
 * Стоит ли клетка во дворе — внутри кольца стен. Нужна не генерации,
 * а кадру: стена в две клетки высотой при камере в 30° прячет за собой
 * около четырёх с половиной клеток земли (`ELEVATION` в `render/scene.ts`
 * экспортируется ровно ради таких замеров), и замер по ста двадцати сидам
 * дал **четверть двора, на которой герой скрыт целиком**, и ещё треть,
 * на которой скрыт наполовину. Пока во дворе было пусто, это ничего
 * не значило; с жителями (§6.1.6.1) кадр обязан показывать двор.
 *
 * Функция здесь, а не в рендере, по общему правилу: считается это чистыми
 * данными и проверяется без браузера.
 */
export function inYard(site: { at: Spot; castle: Castle }, cell: Cell): boolean {
  const px = Math.floor((cell.x - site.at.x) / CASTLE_CELL);
  const pz = Math.floor((cell.z - site.at.z) / CASTLE_CELL);
  if (px < 0 || pz < 0) return false;
  return site.castle.yard.some((s) => s.x === px && s.z === pz);
}

/** Клетка локации, в которую попадает деталь плана. */
export const spotAt = (site: { at: Spot }, piece: { x: number; z: number }): Cell => ({
  x: site.at.x + piece.x * CASTLE_CELL,
  z: site.at.z + piece.z * CASTLE_CELL,
});

/**
 * Площадка по сиду. Размер локации — от размера замка, а не наоборот:
 * замок «произвольного размера» и есть то, ради чего локация существует.
 */
export function generateCastleSite(seed: number): CastleSite {
  const castle = generateCastle(seed);
  const plan = Math.max(castle.width, castle.depth) * CASTLE_CELL;
  const size = plan + 2 * (FIELD + WOOD);
  const at: Spot = {
    x: WOOD + FIELD + Math.floor((plan - castle.width * CASTLE_CELL) / 2),
    z: WOOD + FIELD + Math.floor((plan - castle.depth * CASTLE_CELL) / 2),
  };

  const blocked = new Uint8Array(size * size);

  // Лес по периметру. Он же рамка локации: край карты обязан оставаться
  // стеной, и здесь эта стена — деревья.
  const trees: Spot[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (x >= WOOD && z >= WOOD && x < size - WOOD && z < size - WOOD) continue;
      blocked[idx(size, x, z)] = 1;
      trees.push({ x, z });
    }
  }

  // Детали замка. Клетка набора — квадрат `CASTLE_CELL` на `CASTLE_CELL`,
  // и занимает он весь квадрат: стена в клетку — это сплошной блок,
  // а не панель по ребру.
  const gatePiece: Piece | undefined = castle.pieces.find((p) => p.role === 'ворота');
  for (const piece of castle.pieces) {
    if (!SOLID.has(piece.role)) continue;
    const base = spotAt({ at }, piece);
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) {
        const x = base.x + dx;
        const z = base.z + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        blocked[idx(size, x, z)] = 1;
      }
    }
  }

  const gate: Cell = gatePiece === undefined
    ? { x: at.x + castle.gate.x * CASTLE_CELL, z: at.z + castle.gate.z * CASTLE_CELL }
    : spotAt({ at }, gatePiece);

  /**
   * Выход — снаружи, напротив ворот. Наружу смотрит та сторона ворот,
   * с которой нет двора: двор известен планом, и гадать не приходится.
   */
  const yard = new Set(castle.yard.map((s) => `${s.x}:${s.z}`));
  const out = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].find(([dx, dz]) => !yard.has(`${castle.gate.x + dx!}:${castle.gate.z + dz!}`)
    && !castle.ring.some((s) => s.x === castle.gate.x + dx! && s.z === castle.gate.z + dz!)) ?? [0, 1];

  const evac: Cell = {
    x: Math.max(WOOD, Math.min(size - WOOD - 1, gate.x + out[0]! * (FIELD - 1) + (out[0] === 0 ? 0 : 0))),
    z: Math.max(WOOD, Math.min(size - WOOD - 1, gate.z + out[1]! * (FIELD - 1))),
  };
  // Точка выхода обязана быть свободной: она же место, куда игрок приходит.
  blocked[idx(size, evac.x, evac.z)] = 0;

  /**
   * Валуны (§13.5) — в поле между лесом и стеной, и только там. Двор
   * не завален камнем по той же причине, по которой замок вообще стоит
   * на карте: внутрь заходят смотреть на постройку, и обломки под ногами
   * читались бы как разрушение, которого игра не обещала. В поле же камень
   * читается как то, из чего стену и сложили.
   */
  const keep = { x: at.x, z: at.z, w: castle.width * CASTLE_CELL, d: castle.depth * CASTLE_CELL };
  const stones = scatterStones(
    seed ^ 0x4b41,
    size,
    blocked,
    STONES.castle,
    (x, z) =>
      (x < keep.x || z < keep.z || x >= keep.x + keep.w || z >= keep.z + keep.d)
      && !(x === evac.x && z === evac.z),
  );

  /*
   * Торговец — в глубине двора, дальше всех от ворот. Ближняя к воротам
   * клетка сделала бы обмен придорожным ларьком: игрок вошёл бы под арку,
   * поменял и вышел, и замок остался бы тем же коридором, каким был.
   * Дальняя заставляет пройти двор — то есть увидеть постройку, ради которой
   * место и заведено.
   */
  let trader: Cell | null = null;
  let far = -1;
  for (const spot of castle.yard) {
    const cell = spotAt({ at }, spot);
    // Середина клетки набора: деталь занимает CASTLE_CELL клеток локации.
    const c: Cell = { x: cell.x + (CASTLE_CELL >> 1), z: cell.z + (CASTLE_CELL >> 1) };
    if (c.x < 0 || c.z < 0 || c.x >= size || c.z >= size) continue;
    if (blocked[idx(size, c.x, c.z)]) continue;
    const d = (c.x - gate.x) ** 2 + (c.z - gate.z) ** 2;
    if (d > far) { far = d; trader = c; }
  }

  const loc: GameLocation = {
    seed,
    tier: 0,
    size,
    blocked,
    evac,
    containers: [],
    stones,
    enemies: [],
    backSteps: distanceField(size, blocked, evac),
  };
  return { loc, castle, at, trees, gate, trader };
}
