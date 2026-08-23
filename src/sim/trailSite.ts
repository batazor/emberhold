/**
 * Лесная тропа — третья прогулка мировой карты (§4, §6.1.17). Как замок
 * и кладбище, это **место, по которому ходят**: ни добычи, ни противников
 * здесь нет, и это объявленное состояние, а не забытый шаг. Дальше на тропе
 * поселятся засады и охота — и поселятся отдельными записанными решениями,
 * а не молчаливым дополнением к этой прогулке.
 *
 * От двух первых прогулок тропа отличается формой, и форма здесь — решение.
 * Замок и кладбище — участки: их видно целиком с одного места, и весь смысл
 * захода — рассмотреть. Тропа **длинная и ветвится**: ход в разы длиннее
 * своей ширины, виляет, раздваивается и заводит в тупики — дальний конец
 * из начала не виден, и смысл захода — пройти и не свернуть не туда.
 * Это первая локация, где «сколько ещё осталось» игрок чувствует ногами,
 * а отвилки — готовые места будущих засад и охоты: свернуть с хода уже
 * есть куда, осталось поселить туда причину сворачивать.
 *
 * Сетка локации при этом остаётся квадратной (`GameLocation.size` — одно
 * число, и весь код игры считает из него): длинный ход **вырезан внутри
 * квадрата** — просека, а всё вокруг неё глухой лес. Вводить в `GameLocation`
 * вторую сторону ради одной локации значило бы править `grid.ts`, генератор
 * копей и обе волны — цена не за форму, а за представление формы, которого
 * игрок не видит.
 *
 * Всё выводится из сида: длина хода, куда он виляет, где развилки и куда
 * ведут тупики. Одна и та же точка карты собирается одной и той же тропой
 * весь день (§4).
 */
import { mulberry32, randInt, type Rng } from '../core/rng';
import { distanceField, idx } from './grid';
import type { Stone } from './stones';
import type { Cell, Enemy, GameLocation } from './types';
import { enemyStats } from './enemies';

/** Толщина леса по краю локации: та же рамка, что у кладбища. */
export const WOOD = 3;

/**
 * Полуширина просеки главного хода: осевая ±2 — открытых клеток пять.
 * Уже — и два героя не разойдутся с деревом, шире — и тропа станет поляной,
 * вытянутой в нитку: длина читается только рядом с теснотой.
 */
export const CLEAR_HALF = 2;

/** Полуширина грунта главного хода: осевая ±1. По краю просеки остаётся
 *  травяная обочина — без неё грунт упирается прямо в стволы и читается
 *  дном оврага. */
export const DIRT_HALF = 1;

/**
 * Насколько главный ход уходит от осевой поперёк. Ограничен не ради красоты,
 * а ради формы: правило `trailSite.rules.ts` меряет, что ход длиннее своей
 * ширины минимум вдвое, и весь размах виляния вместе с отвилками входит
 * в ширину.
 */
export const SPAN = 4;

/**
 * Насколько дальше хода дотягиваются отвилки. Внешние ряды — их земля:
 * главный ход туда не заходит никогда, и тупику всегда есть куда упереться,
 * не слившись с просекой. Первая раздача давала отвилкам ту же полосу, что
 * ходу, и все попытки упирались в запрет слияния — ход, вильнув, успевал
 * занять всё, куда отвилок мог бы вырасти.
 */
export const BRANCH_SPAN = SPAN + 5;

/**
 * Устье развилки: в этом радиусе от неё просека хода и просека отвилка
 * сливаются по праву — это и есть развилка. За устьем отвилок держится
 * от любой чужой просеки дальше слияния, поэтому единственная дверь
 * тупика — устье, и это доказуемо волной: `trailSite.rules.ts` закрывает
 * устье и меряет, что конец отвилка стал недостижим.
 */
export const MOUTH = 6;

/**
 * Длина хода в клетках — от входа до дальнего конца по оси. Первые тропы
 * были 24–31, и на кадре это читалось длинным участком, а не дорогой:
 * конец угадывался за два экрана. Цена длины — лес: клетки квадрата вне
 * просеки застроены деревьями, и потолок держит их число в тысячах, где
 * инстансы ещё дёшевы, — рост дальше этого — вопрос замера кадра, а не вкуса.
 */
export const LEN_MIN = 44;
export const LEN_MAX = 60;

/**
 * Сколько отвилков у тропы. Не меньше двух: одна развилка — случайность,
 * две — свойство места. Не больше четырёх: гуще — и главный ход перестаёт
 * читаться главным, а тропа становится лабиринтом, которого не обещала.
 */
export const FORKS_MIN = 2;
export const FORKS_MAX = 4;

/** Короче четырёх клеток отвилок не тупик, а карман просеки. */
export const BRANCH_MIN = 4;
const BRANCH_MAX = 13;

/** Отвилок: где отходит от хода и по каким клеткам идёт до тупика. */
export interface TrailBranch {
  readonly from: Cell;
  readonly line: readonly Cell[];
}

export interface TrailSite {
  readonly loc: GameLocation;
  /**
   * Клетки утоптанного грунта. Рендеру они голая земля: трава на ходу
   * не растёт, и тропа читается цветом и вытоптанностью, а не подписью.
   */
  readonly path: readonly Cell[];
  /** Длина хода в клетках — от входа до дальнего конца по оси. */
  readonly length: number;
  /** Осевая главного хода — клетка за клеткой, от входа. */
  readonly spine: readonly Cell[];
  /** Отвилки: каждый кончается тупиком в лесу, а не вторым выходом. */
  readonly branches: readonly TrailBranch[];
  /**
   * Дальний конец хода — второй выход. У дороги два конца, и оба выходы:
   * тропа, которую можно пройти только назад, была бы не дорогой,
   * а карманом. Сим знает один `evac` (вход), второй конец сторожит
   * сцена — и рисует над ним тот же луч.
   */
  readonly exit: Cell;
}

/** Есть ли в `cells` клетка ближе `r` по Чебышёву. Списки здесь короткие —
 *  сотня клеток осевой, — и перебор дешевле любой структуры. */
const near = (cells: readonly Cell[], x: number, z: number, r: number): boolean =>
  cells.some((c) => Math.abs(c.x - x) <= r && Math.abs(c.z - z) <= r);

/**
 * Тропа по сиду. Размер локации — от длины хода: ход и есть то, ради чего
 * локация существует, ровно как участок у кладбища.
 */
export function generateTrailSite(seed: number): TrailSite {
  const rng: Rng = mulberry32(seed);
  const length = LEN_MIN + randInt(rng, LEN_MAX - LEN_MIN + 1);
  const size = length + 2 * WOOD;
  const center = Math.floor(size / 2);
  const zMin = center - SPAN;
  const zMax = center + SPAN;

  /**
   * Осевая главного хода. Не ломаная вокруг прямой, а ход с коленами:
   * вперёд по оси, время от времени — вбок на одну-четыре клетки. Шаг
   * всегда в соседнюю клетку, поэтому связность хода верна по построению.
   */
  const spine: Cell[] = [];
  let x = WOOD;
  let z = zMin + randInt(rng, zMax - zMin + 1);
  spine.push({ x, z });
  let aside = 0;
  let dir = 1;
  // Колено не только выпадает, но и вынуждается: девять прямых клеток
  // подряд — и ход сворачивает обязательно. Без этого правило виляния
  // держалось бы на удаче сида, а прямая как линейка тропа — коридор.
  let straight = 0;
  while (x < WOOD + length - 1) {
    if (aside > 0) {
      if (z + dir < zMin || z + dir > zMax) {
        aside = 0;
        x++;
      } else {
        z += dir;
        aside--;
      }
    } else if (straight >= 9 || rng() < 0.3) {
      dir = rng() < 0.5 ? -1 : 1;
      if (z + dir < zMin || z + dir > zMax) dir = -dir;
      aside = 1 + randInt(rng, 4);
      straight = 0;
      continue;
    } else {
      x++;
      straight++;
    }
    spine.push({ x, z });
  }

  /**
   * Отвилки. Каждый уходит от хода вбок и кончается тупиком: правило
   * `near` не подпускает его обратно к просеке — отвилок, вернувшийся
   * на ход, был бы срезкой, а срезка отменяет длину, ради которой
   * локация заведена. Отвилки не липнут и друг к другу: слившиеся
   * читались бы одной широкой поляной.
   */
  const branches: TrailBranch[] = [];
  const others: Cell[] = [];
  const usedX: number[] = [];
  const want = FORKS_MIN + randInt(rng, FORKS_MAX - FORKS_MIN + 1);
  /**
   * Просека хода шириной ±2 и просека отвилка шириной ±1 сливаются, когда
   * их осевые ближе четырёх клеток. Слияние где-либо кроме самой развилки —
   * это срезка, и держит это расстояние не проверка после, а запрет шага.
   */
  // Просека хода шириной ±2 и просека отвилка шириной ±1 сливаются, когда
  // их осевые ближе четырёх клеток, — за устьем этого не бывает никогда.
  const MERGE = CLEAR_HALF + 2;
  const bMin = center - BRANCH_SPAN;
  const bMax = center + BRANCH_SPAN;
  /**
   * Кандидаты в развилки — вся осевая, кроме концов, в перетасованном
   * порядке. Перебор, а не жеребьёвка попыток: жеребьёвка на тесном сиде
   * прожигала все попытки о немногих годных клетках и оставляла тропу
   * без развилок. Разнос развилок — правило с отступлением: сперва
   * широкий, а если отвилков меньше обещанного минимума — тесный.
   * Правило `trailSite.rules.ts` держит минимум, и лучше две развилки
   * ближе обычного, чем одна.
   */
  const forks = spine.filter((c) => c.x >= WOOD + 6 && c.x <= WOOD + length - 7);
  for (let i = forks.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const swap = forks[i]!;
    forks[i] = forks[j]!;
    forks[j] = swap;
  }
  for (const gap of [8, 5]) {
    if (gap < 8 && branches.length >= FORKS_MIN) break;
    for (const fork of forks) {
      if (branches.length >= want) break;
      // С осевой полосы отвилку не выбраться из устья: и справа и слева
      // от него ход, и до чистой земли дальше, чем дотягивается устье.
      if (Math.abs(fork.z - center) < 2) continue;
      // Развилки разнесены по ходу: две рядом — одна тройная, а не две.
      if (usedX.some((ux) => Math.abs(ux - fork.x) < gap)) continue;
      // Наружу со своей стороны хода: до внешних рядов оттуда ближе всего,
      // и полосу хода отвилок не пересекает.
      const away = fork.z > center ? 1 : -1;
      const goal = BRANCH_MIN + 2 + randInt(rng, BRANCH_MAX - BRANCH_MIN - 1);
      const line: Cell[] = [];
      let bx = fork.x;
      let bz = fork.z;
      for (let s = 0; s < goal; s++) {
        // Вбок с настойчивостью, изредка вдоль хода — отвилок тоже виляет.
        const drift = rng() < 0.5 ? 1 : -1;
        const steps: readonly (readonly [number, number])[] =
          rng() < 0.6
            ? [[0, away], [drift, 0], [-drift, 0]]
            : [[drift, 0], [0, away], [-drift, 0]];
        let stepped = false;
        for (const [dx, dz] of steps) {
          const nx = bx + dx;
          const nz = bz + dz;
          if (nx < WOOD + 1 || nx > WOOD + length - 2 || nz < bMin || nz > bMax) continue;
          const inMouth = Math.max(Math.abs(nx - fork.x), Math.abs(nz - fork.z)) <= MOUTH;
          if (!inMouth && near(spine, nx, nz, MERGE)) continue;
          if (near(others, nx, nz, MERGE)) continue;
          bx = nx;
          bz = nz;
          line.push({ x: bx, z: bz });
          stepped = true;
          break;
        }
        if (!stepped) break;
      }
      // Конец отвилка обязан выйти из устья и встать в стороне от хода:
      // тупик, кончившийся в просеке или у самой развилки, — не тупик.
      // Хвост подрезается до клетки, с которой это верно.
      while (line.length > 0) {
        const tip = line[line.length - 1]!;
        const inMouth = Math.max(Math.abs(tip.x - fork.x), Math.abs(tip.z - fork.z)) <= MOUTH;
        if (!inMouth && !near(spine, tip.x, tip.z, MERGE)) break;
        line.pop();
      }
      if (line.length < BRANCH_MIN) continue;
      branches.push({ from: fork, line });
      others.push(...line);
      usedX.push(fork.x);
    }
  }

  // Всё, что не просека, — глухой лес. Он же рамка локации: край карты
  // обязан оставаться стеной, и просека рамку не вскрывает никогда —
  // сквозь лес тропы не срезают.
  const blocked = new Uint8Array(size * size).fill(1);
  const dirt = new Set<number>();
  const carve = (cx: number, cz: number, clearR: number, dirtR: number): void => {
    for (let dz = -clearR; dz <= clearR; dz++) {
      for (let dx = -clearR; dx <= clearR; dx++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < WOOD || nz < WOOD || nx >= size - WOOD || nz >= size - WOOD) continue;
        blocked[idx(size, nx, nz)] = 0;
        if (Math.max(Math.abs(dx), Math.abs(dz)) <= dirtR) dirt.add(idx(size, nx, nz));
      }
    }
  };
  for (const c of spine) carve(c.x, c.z, CLEAR_HALF, DIRT_HALF);
  // Отвилок уже главного хода и в просеке, и в грунте: по нему ходят реже,
  // и вытоптан он в одну клетку — какая из дорог главная, видно с развилки.
  for (const b of branches) for (const c of b.line) carve(c.x, c.z, 1, 0);

  const path: Cell[] = [...dirt].map((i) => ({ x: i % size, z: (i / size) | 0 }));

  /**
   * Валуны — по обочине (§13.4): добыча камня без глубины, как во дворе
   * замка. На грунт не встают — ход остаётся ходом, — и разнесены: обочина,
   * а не каменоломня. Число не от площади, а от длины: валуны стоят вдоль
   * хода, и мерить их квадратом значило бы считать лес.
   */
  const verge: Cell[] = [];
  for (let cz = 0; cz < size; cz++) {
    for (let cx = 0; cx < size; cx++) {
      const at = idx(size, cx, cz);
      if (blocked[at] === 0 && !dirt.has(at)) verge.push({ x: cx, z: cz });
    }
  }
  const stones: Stone[] = [];
  const wantStones = 5 + randInt(rng, 4);
  for (let tries = 0; stones.length < wantStones && tries < 200; tries++) {
    const cell = verge[randInt(rng, verge.length)];
    if (cell === undefined) break;
    if (stones.some((s) => Math.abs(s.x - cell.x) <= 3 && Math.abs(s.z - cell.z) <= 3)) continue;
    stones.push({ id: stones.length, x: cell.x, z: cell.z, taken: false });
  }

  // Дальний конец хода: там же, где кончается осевая, — на грунте.
  const exit: Cell = { x: spine[spine.length - 1]!.x, z: spine[spine.length - 1]!.z };

  // Вход — ближний конец хода, на самом грунте. Дальний конец и все тупики
  // глухие: тропа пока никуда не ведёт, и честнее упереть её в лес, чем
  // нарисовать выход, за которым ничего нет.
  const evac: Cell = { x: spine[0]!.x, z: spine[0]!.z };

  // Лисы держатся в тупиках боковых троп: охота требует свернуть с главного
  // хода, а не просто столкнуться со зверем на дороге. На короткой тропе
  // живёт одна, на длинной иногда две; выбор целиком следует из сида.
  const foxCount = Math.min(branches.length, 1 + (rng() < 0.35 ? 1 : 0));
  const enemies: Enemy[] = branches.slice(0, foxCount).map((branch, id) => {
    const at = branch.line[branch.line.length - 1]!;
    return {
      id,
      kind: 'fox',
      level: 1,
      x: at.x,
      z: at.z,
      prevX: at.x,
      prevZ: at.z,
      hp: enemyStats('fox', 1).hp,
      awake: false,
      telegraph: 0,
      cooldown: 0,
      harvested: false,
    };
  });

  const loc: GameLocation = {
    seed,
    tier: 0,
    size,
    blocked,
    evac,
    // Контейнеров нет: добыча здесь требует работы. Валуны стоят на обочине,
    // лес рубится, а лис ради мяса и шкуры ищут в тупиках боковых троп.
    containers: [],
    stones,
    enemies,
    backSteps: distanceField(size, blocked, evac),
  };
  return { loc, path, length, spine, branches, exit };
}
