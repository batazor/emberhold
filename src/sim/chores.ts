/**
 * Рутина жильцов лагеря: видимая работа, которая ничего не платит.
 *
 * До неё жильцы сидели у костра с инструментом в руке, и строка карточки
 * «носит дерево» оставалась строкой: носил он его только в невидимой
 * бухгалтерии отлучки (`residents.ts`). Рутина делает то, что уже записано,
 * видимым — и **ровно ничего больше**: она не добывает ни бруска и не тратит
 * ни секунды чужого времени. Экономика жильца целиком остаётся в `workDone`
 * с его потолком (§20.3, отставание от игрока минимум в сто раз), и любой
 * ресурс, появившийся из этого модуля, был бы второй зарплатой за ту же
 * работу. Поэтому здесь нет ни рюкзака, ни склада — только дорога, стоянки
 * и лицо, повёрнутое к делу.
 *
 * **Кадр — функция времени**, как обходы двора (`garrison.ts`): один маршрут
 * и одно `t` дают одно положение, сколько бы раз их ни спросили. На этом
 * держится и отладочная перемотка, и правило-тесты, которым не нужен рендер.
 *
 * **Кто работает — решает та же экономика.** Отдыхающий сидит у костра
 * (приказ «отдыхать» — это отложенный инструмент), безкрышный сидит тоже:
 * `workDone` не начисляет ему ничего, и жилец, бодро таскающий брёвна без
 * прибавки на складе, обещал бы то, чего не происходит. Рутина видна ровно
 * у тех, у кого идёт невидимая работа.
 *
 * **Куда ходят.** Носящий дерево — к кромке леса: она не кончается (§13.3),
 * и его дерево никогда не упадёт — рубка настоящая только у игрока. Носящий
 * камень — вдоль кромки: камень внизу (§13.4), на поляне его нет, и махать
 * киркой тут не по чему — он ходит с ношей, как и назван. Оба возвращаются
 * к костру: склада в кадре поляны нет, а огонь — то место, которое лагерь
 * читает домом.
 *
 * **Домой с ношей, обратно налегке.** Половина круга с бревном на руках —
 * это и есть всё объяснение, зачем он ходил: строка карточки «носит дерево»
 * перестаёт быть обещанием ровно в ту секунду, когда в руках появляется
 * бревно. Ноша берётся на рабочей стоянке и кладётся дома, и обе подмены
 * приходятся на разворот, где подмены не видно.
 *
 * **Встреча назначается, а не случается.** Работники разбиты на пары,
 * и паре выдан **общий круг и общая фаза** — значит домой они приходят
 * в одну секунду каждый раз, а стоянка у костра удлинена ровно на разговор
 * (`CHAT_SECONDS`). Ловить сближение по расстоянию было бы вторым способом
 * считать движение и потребовало бы памяти; назначенная встреча оставляет
 * кадр чистой функцией времени и заодно ставит разговор туда, где ему
 * место, — к огню, а не посреди тропы.
 */
import { DWELLER_SPEED } from './garrison';
import { findPath } from './pathfinding';
import { keepApart } from './crowd';
import type { Body } from './crowd';
import { idx } from './grid';
import { mulberry32, randInt } from '../core/rng';
import type { Rng } from '../core/rng';
// Время на разговор берётся у того, кто его считает: сколько длится обмен
// репликами, знает `talk.ts`, а маршрут обязан выделить ровно столько же.
import { CHAT_SECONDS } from './talk';
import type { Cell } from './types';
import type { Resident } from './residents';

/**
 * Стоянка у костра: сгрузил и перевёл дух. Короче рабочей — дом на этом
 * маршруте не цель, а разворот.
 */
export const UNLOAD_PAUSE = 4;

/**
 * Стоянка у дерева — столько носящий дерево машет топором. Двадцать секунд
 * против четырёх у костра: рутина обязана читаться работой с отлучками
 * домой, а не прогулкой с остановками, — та же пропорция, что у ремесленника
 * двора (`CRAFT_REST` против `DWELLER_STAND`).
 */
export const CHOP_PAUSE = 20;

/**
 * Стоянка носящего камень у кромки. Вдвое короче рубки: его работа — дорога
 * (он «ходит вниз»), и стоять ему положено меньше, чем ходить.
 */
export const LOOK_PAUSE = 8;

/** Врозь — минимум клеток между рабочими точками двух жильцов: у каждого
 *  своё дерево. Меньше двух — и двое рубят один ствол с двух сторон. */
const APART = 3;

/** Остановка маршрута: где, сколько, куда смотреть и работа ли это. */
interface Stop {
  /** Индекс вершины `path`. */
  readonly at: number;
  readonly pause: number;
  /** Куда смотреть, пока стоит; null — куда пришёл. */
  readonly facing: number | null;
  /** Рабочая стоянка: рендер играет труд, а не покой. */
  readonly working: boolean;
  /** Отсюда жилец уходит с ношей: здесь он её и взял. */
  readonly takes?: boolean;
  /** Стоянка разговора: напарник стоит рядом и в это же время. */
  readonly talk?: boolean;
}

/** Маршрут одного жильца: замкнутая ломаная со стоянками, как `YardWalk`. */
export interface Chore {
  readonly path: readonly Cell[];
  readonly stops: readonly Stop[];
  /** Полный круг в секундах — ход плюс все стоянки. */
  readonly cycle: number;
  /** Сдвиг начала: жильцы вышли не строем, а кто когда. */
  readonly phase: number;
  /** Номер напарника по разговору; null — ходит и молчит. */
  readonly partner: number | null;
}

/** Где жилец на момент `t`: рендеру хватает этих чисел. */
export interface ChoreFrame extends Body {
  readonly facing: number;
  readonly walking: boolean;
  readonly working: boolean;
  /**
   * Руки полны: домой жилец идёт с ношей, обратно налегке. Это и есть весь
   * круг, сказанный без подписи, — «носит дерево» наконец что-то носит.
   */
  readonly carrying: boolean;
  /**
   * Идёт разговор с напарником: сколько секунд назад он начался и какая
   * это по счёту встреча. Слова по этим двум числам выдаёт `sim/talk.ts` —
   * маршрут назначает время и место, а не реплики.
   */
  readonly talk: { readonly since: number; readonly round: number } | null;
}

/**
 * Площадка рутины. Маска проходимости приходит готовой — лес поляны вместе
 * со следами построек, — потому что «что стоит на площадке» знает сцена,
 * а не этот модуль: ему важно лишь, где пройти нельзя.
 */
export interface ChoreSite {
  readonly size: number;
  readonly blocked: Uint8Array;
  /** Клетка костра: дом маршрута. */
  readonly fire: Cell;
  readonly seed: number;
}

/**
 * Клетки, с которых достают до леса: проходимая рядом с занятой. Кромка
 * предпочтительнее нутра — её деревья не кончаются, и рубящий у кромки
 * не спорит с игроком за конкретный ствол, — поэтому кандидаты с рамки
 * идут первыми, а внутренние берутся только когда до рамки не добраться.
 */
function treeSpots(site: ChoreSite): { spot: Cell; tree: Cell }[] {
  const { size, blocked } = site;
  const rim: { spot: Cell; tree: Cell }[] = [];
  const inner: { spot: Cell; tree: Cell }[] = [];
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (blocked[idx(size, x, z)]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const tx = x + dx;
        const tz = z + dz;
        if (!blocked[idx(size, tx, tz)]) continue;
        const edge = tx <= 0 || tz <= 0 || tx >= size - 1 || tz >= size - 1;
        (edge ? rim : inner).push({ spot: { x, z }, tree: { x: tx, z: tz } });
        break;
      }
    }
  }
  return rim.length > 0 ? rim : inner;
}

/** Расстояние по прямой между клетками — для «врозь» и «поближе». */
const dist = (a: Cell, b: Cell): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Точка выхода: свободная клетка возле костра. У каждого своя — двое,
 * выходящие с одной, разводились бы телами каждый круг на одном месте.
 *
 * `mate` — место напарника, если оно уже выбрано: тогда берётся ближайшая
 * к нему свободная клетка, а не любая. Разговор через весь лагерь читался
 * бы перекличкой; полтора шага — это и есть расстояние, на котором стоят
 * двое говорящих, и обеспечено оно тем же порогом «врозь», что и всегда.
 */
function baseSpot(site: ChoreSite, rng: Rng, taken: Cell[], mate?: Cell): Cell | null {
  const { size, blocked, fire } = site;
  const ring: Cell[] = [];
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const r = Math.hypot(dx, dz);
      if (r < 1.5 || r > 3.5) continue;
      const x = fire.x + dx;
      const z = fire.z + dz;
      if (x <= 0 || z <= 0 || x >= size - 1 || z >= size - 1) continue;
      if (blocked[idx(size, x, z)]) continue;
      if (taken.some((c) => dist(c, { x, z }) < 1.5)) continue;
      ring.push({ x, z });
    }
  }
  if (ring.length === 0) return null;
  if (mate === undefined) return ring[randInt(rng, ring.length)]!;
  return ring.reduce((best, c) => (dist(c, mate) < dist(best, mate) ? c : best));
}

/**
 * Кто с кем разговаривает. Пары — подряд идущие работники: первый со вторым,
 * третий с четвёртым. Считаются **до** маршрутов, а не после, потому что
 * напарник решает, где встать у костра, и выбирать место, не зная,
 * с кем стоишь, значит выбирать его дважды.
 *
 * Нечётному пары не досталось, и это не дефект: он ходит и говорит
 * присказками, как ходили все до разговора.
 */
function pairsOf(
  residents: readonly Resident[],
  works: (i: number) => boolean,
): (number | null)[] {
  const partner: (number | null)[] = residents.map(() => null);
  let waiting: number | null = null;
  for (let i = 0; i < residents.length; i++) {
    if (!works(i)) continue;
    if (waiting === null) {
      waiting = i;
      continue;
    }
    partner[waiting] = i;
    partner[i] = waiting;
    waiting = null;
  }
  return partner;
}

/** Ломаная из отрезков `findPath` с длиной; null — какой-то ноги не нашлось. */
function ringOf(
  site: ChoreSite,
  corners: readonly Cell[],
): { path: Cell[]; ends: number[]; length: number } | null {
  const path: Cell[] = [{ ...corners[0]! }];
  const ends: number[] = [];
  for (let c = 0; c < corners.length; c++) {
    const leg = findPath(site.size, site.blocked, corners[c]!, corners[(c + 1) % corners.length]!);
    if (leg.length === 0) return null;
    path.push(...leg.map((s) => ({ x: s.x, z: s.z })));
    ends.push(path.length - 1);
  }
  // Кольцо кончается, где началось: последняя клетка совпадает с первой.
  path.pop();
  let length = 0;
  for (let k = 0; k < path.length; k++) {
    const a = path[k]!;
    const b = path[(k + 1) % path.length]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return { path, ends: ends.map((v) => v % path.length), length };
}

/** Куда смотреть из `from` на `to` — в радианах игры (atan2 по x/z). */
const faceTo = (from: Cell, to: Cell): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * Маршруты жильцов. По одному на каждого, в порядке списка; null — этот
 * сидит у костра: отдыхает, без крыши или до его дела не дойти.
 *
 * `roofed` приходит снаружи по той же причине, что маска: кто под крышей,
 * считает жильё (`residents.ts`), и вторая копия этого счёта разошлась бы
 * с первой молча.
 */
export function choresOf(
  site: ChoreSite,
  residents: readonly Resident[],
  roofed: (i: number) => boolean,
): (Chore | null)[] {
  const spots = treeSpots(site);
  const takenWork: Cell[] = [];
  const takenBase: Cell[] = [];
  const works = (i: number): boolean => {
    const r = residents[i];
    return r !== undefined && !r.rest && roofed(i);
  };
  const partner = pairsOf(residents, works);

  /** Тропа до сведения пар: круг ещё свой, а не общий с напарником. */
  interface Draft {
    readonly path: Cell[];
    readonly stops: Stop[];
    /** Круг в одиночку — ход и все стоянки, без времени на разговор. */
    readonly alone: number;
    readonly spot: Cell;
    readonly rng: Rng;
  }
  const drafts: (Draft | null)[] = residents.map(() => null);

  residents.forEach((r, i) => {
    if (!works(i)) return;
    // Сид маршрута — сид лица: тот же человек ходит той же дорогой,
    // и после перезахода в лагерь его не подменяет двойник с другой тропой.
    const rng = mulberry32((r.seed ^ site.seed ^ 0xc40e) | 0);
    const mate = partner[i];
    const beside = mate === null ? undefined : drafts[mate]?.spot;
    const base = baseSpot(site, rng, takenBase, beside);
    if (base === null) return;

    // Рабочие точки: ближние к дому предпочтительнее — носильщик ходит
    // по делу, а не через всю поляну, — но выбор качается сидом, чтобы
    // двое не вставали к одному дереву. «Врозь» отпускается, когда точек
    // мало: пусть двое рубят рядом, чем один сидит без дела.
    const near = [...spots].sort((a, b) => dist(a.spot, base) - dist(b.spot, base));
    const pool = near.slice(0, Math.max(8, near.length / 4));
    const pickSpot = (away: readonly Cell[], tries: number): { spot: Cell; tree: Cell } | null => {
      for (let k = 0; k < tries; k++) {
        const cand = pool[randInt(rng, pool.length)];
        if (cand === undefined) return null;
        if (away.every((c) => dist(c, cand.spot) >= APART)) return cand;
      }
      return pool[randInt(rng, pool.length)] ?? null;
    };

    let built: Draft | null = null;
    if (r.answer === 'строим') {
      const work = pickSpot(takenWork, 24);
      if (work !== null) {
        const ring = ringOf(site, [base, work.spot]);
        if (ring !== null) {
          const [toWork, home] = ring.ends;
          built = {
            path: ring.path,
            stops: [
              // У дерева — работа лицом к стволу, и оттуда же он уходит
              // с бревном: ноша берётся там, где сделана работа.
              {
                at: toWork!,
                pause: CHOP_PAUSE,
                facing: faceTo(work.spot, work.tree),
                working: true,
                takes: true,
              },
              // Дома — передышка лицом к огню; с напарником она станет
              // разговором, и лицо повернётся к нему.
              { at: home!, pause: UNLOAD_PAUSE, facing: faceTo(base, site.fire), working: false },
            ],
            alone: ring.length / DWELLER_SPEED + CHOP_PAUSE + UNLOAD_PAUSE,
            spot: base,
            rng,
          };
          takenWork.push(work.spot);
        }
      }
    } else {
      // Носящий камень: два угла кромки и дом. Смотрит со стоянки в лес —
      // туда, где его дорога вниз; кирка остаётся на плече. Породу он
      // набирает на дальней стоянке — оттуда и идёт домой с полными руками.
      const first = pickSpot(takenWork, 24);
      const second = first === null ? null : pickSpot([...takenWork, first.spot], 24);
      if (first !== null && second !== null) {
        const ring = ringOf(site, [base, first.spot, second.spot]);
        if (ring !== null) {
          const [toFirst, toSecond, home] = ring.ends;
          built = {
            path: ring.path,
            stops: [
              { at: toFirst!, pause: LOOK_PAUSE, facing: faceTo(first.spot, first.tree), working: false },
              {
                at: toSecond!,
                pause: LOOK_PAUSE,
                facing: faceTo(second.spot, second.tree),
                working: false,
                takes: true,
              },
              { at: home!, pause: UNLOAD_PAUSE, facing: faceTo(base, site.fire), working: false },
            ],
            alone: ring.length / DWELLER_SPEED + LOOK_PAUSE * 2 + UNLOAD_PAUSE,
            spot: base,
            rng,
          };
          takenWork.push(first.spot, second.spot);
        }
      }
    }
    if (built === null) return;
    takenBase.push(base);
    drafts[i] = built;
  });

  /**
   * Сведение круга. Одиночке круг остаётся свой, паре — общий, и это
   * единственный способ назначить встречу, не заводя памяти: у обоих
   * одинаковые цикл и фаза, значит домой они приходят в одну и ту же
   * секунду каждый круг, и «встретились» перестаёт быть случайностью.
   *
   * Лишнее время достаётся **рабочей стоянке, а не костру**. Тот, у кого
   * тропа короче, дольше рубит — и это читается делом. Отдай эти секунды
   * дому, и он стоял бы у огня втрое дольше напарника: со стороны это
   * не «ждёт», а «бездельничает».
   */
  const settle = (d: Draft, mate: number | null, longest: number, phase: number, beside: Cell | null): Chore => {
    const pad = longest - d.alone;
    const talks = mate !== null;
    return {
      path: d.path,
      stops: d.stops.map((s) => {
        // Дом — вершина 0: кольцо кончается там, где началось.
        if (s.at === 0) {
          return talks && beside !== null
            ? { ...s, pause: s.pause + CHAT_SECONDS, talk: true, facing: faceTo(d.spot, beside) }
            : s;
        }
        return s.takes === true ? { ...s, pause: s.pause + pad } : s;
      }),
      cycle: longest + (talks ? CHAT_SECONDS : 0),
      phase,
      partner: mate,
    };
  };

  const out: (Chore | null)[] = residents.map(() => null);
  drafts.forEach((d, i) => {
    if (d === null || out[i] !== null) return;
    const mate = partner[i];
    const other = mate === null ? null : drafts[mate];
    // Напарник не вышел на тропу — пары нет: разговаривать не с кем,
    // и круг остаётся своим.
    if (mate === null || other === null || other === undefined) {
      // Фаза своя у каждого: вышедшие строем читались бы конвейером, а не
      // жизнью, — то же решение, что фаза шага у гарнизона.
      out[i] = settle(d, null, d.alone, d.rng() * d.alone, null);
      return;
    }
    const longest = Math.max(d.alone, other.alone);
    // Фаза общая — она и есть встреча. Берётся у первого из пары, чтобы
    // не зависеть от порядка обхода.
    const phase = d.rng() * (longest + CHAT_SECONDS);
    out[i] = settle(d, mate, longest, phase, other.spot);
    out[mate] = settle(other, i, longest, phase, d.spot);
  });
  return out;
}

/**
 * Где жилец на момент `t`. Устройство — `walkYard` до буквы: остаток времени
 * в круге съедается отрезками хода и стоянками, и первый недоеденный отрезок
 * называет положение.
 */
export function choreAt(c: Chore, t: number): ChoreFrame {
  let left = c.cycle <= 0 ? 0 : (((t + c.phase) % c.cycle) + c.cycle) % c.cycle;
  // Номер круга: по нему разговор каждой встречи звучит своими словами.
  const round = c.cycle <= 0 ? 0 : Math.floor((t + c.phase) / c.cycle);
  /**
   * Полны ли руки. Не хранится, а выводится заново на каждом вызове: обход
   * всегда начинается с вершины 0 — а это дом сразу после разгрузки, —
   * и потому состояние ноши восстанавливается из одного `t`, как и всё
   * остальное в этом модуле.
   */
  let laden = false;
  for (let i = 0; i < c.path.length; i++) {
    const from = c.path[i]!;
    const to = c.path[(i + 1) % c.path.length]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = Math.hypot(dx, dz);
    const walk = span / DWELLER_SPEED;
    const facing = Math.atan2(dx, dz);
    if (left < walk) {
      const share = span === 0 ? 0 : left / walk;
      return {
        x: from.x + dx * share,
        z: from.z + dz * share,
        facing,
        walking: true,
        working: false,
        carrying: laden,
        talk: null,
      };
    }
    left -= walk;
    const next = (i + 1) % c.path.length;
    const stop = c.stops.find((s) => s.at === next);
    if (stop !== undefined) {
      if (left < stop.pause) {
        return {
          x: to.x,
          z: to.z,
          facing: stop.facing ?? facing,
          walking: false,
          working: stop.working,
          // На рабочей стоянке руки ещё пусты — ношу берут, уходя; дома
          // они ещё полны — её кладут, отворачиваясь от огня. Обе подмены
          // приходятся на разворот, где их и не видно.
          carrying: laden,
          talk: stop.talk === true ? { since: left, round } : null,
        };
      }
      left -= stop.pause;
      if (stop.takes === true) laden = true;
      // Дом — вершина 0, и уходят оттуда налегке.
      if (stop.at === 0) laden = false;
    }
  }
  // Сюда не приходят: сумма отрезков и стоянок и есть цикл. Но вернуть
  // дом честнее, чем ничего.
  const home = c.path[0]!;
  return {
    x: home.x,
    z: home.z,
    facing: 0,
    walking: false,
    working: false,
    carrying: false,
    talk: null,
  };
}

/**
 * Кадр рутины целиком: все идущие разом, разведённые телами. Сидящие
 * и герой приходят снаружи неподвижными точками — идущий обходит их,
 * а не толкает: у сидящего нет ног, чтобы отойти в ответ.
 */
export function choresAt(
  chores: readonly (Chore | null)[],
  t: number,
  pinned: readonly Body[],
  free?: (x: number, z: number) => boolean,
): (ChoreFrame | null)[] {
  const frames = chores.map((c) => (c === null ? null : choreAt(c, t)));
  const moving: ChoreFrame[] = frames.filter((f): f is ChoreFrame => f !== null);
  const bodies: Body[] = [...moving, ...pinned.map((p) => ({ x: p.x, z: p.z }))];
  const fixed = (i: number): boolean => i >= moving.length;
  keepApart(bodies, free === undefined ? { fixed } : { fixed, free });
  return frames;
}
