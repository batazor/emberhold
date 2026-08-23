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
 * и паре выдан **общий круг** — значит домой они приходят в одну секунду
 * каждый раз, а стоянка у костра удлинена ровно на разговор
 * (`CHAT_SECONDS`). Ловить сближение по расстоянию было бы вторым способом
 * считать движение и потребовало бы памяти; назначенная встреча оставляет
 * кадр чистой функцией времени и заодно ставит разговор туда, где ему
 * место, — к огню, а не посреди тропы.
 *
 * **Круги укладываются в смену, и ночью жилец спит (§24).** Расписания
 * своего у рутины нет: она берёт его у неба — сколько смены светло
 * и сколько темно, считает `world.ts`, и жилец ложится ровно тогда, когда
 * темнеет. Число кругов подобрано так, чтобы последний кончился к темноте,
 * а остаток времени ушёл в рабочую стоянку: у кого тропа короче, тот дольше
 * рубит. Ночью тот, у кого есть крыша, доходит до палатки и **пропадает
 * из кадра**; у кого крыши нет — тому тропы не дали вовсе, и он сидит
 * у костра, где сидел. Ночь ничего не платит и ничего не запирает (§24.1):
 * `workDone` её не замечает, и сон не становится второй зарплатой.
 *
 * Личной фазы поэтому больше нет ни у кого: на рассвете лагерь выходит
 * разом. Один момент в смене, когда видно, что он проснулся, дороже ровного
 * размазывания выходов по утру, — а разъезжаются жильцы всё равно сразу,
 * потому что тропы у них разной длины.
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
// Расписание берётся у неба (§24): жилец спит ровно ту фазу смены, которую
// показывает тёмной `nightAt`. Свои числа тут были бы вторыми сутками.
import { AWAKE_SEC, SHIFT_SEC, SLEEP_SEC, WAKE_AT } from './world';
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
  /** Один круг в секундах — ход плюс все стоянки. */
  readonly circuit: number;
  /** Сколько кругов до сна. Все вместе они и есть бодрствование смены. */
  readonly laps: number;
  /** Номер напарника по разговору; null — ходит и молчит. */
  readonly partner: number | null;
  /**
   * Дорога ко сну: от дома до порога палатки. Пусто — спать негде, и жилец
   * коротает ночь у огня там же, где стоял днём.
   */
  readonly bed: readonly Cell[];
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
  /**
   * Спит в палатке, и потому его не видно вовсе. Не «стоит внутри», а именно
   * скрыт: тело, оставленное на клетке палатки, торчало бы сквозь неё, а
   * положенное рядом читалось бы спящим на земле при живой крыше.
   */
  readonly hidden: boolean;
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
  /**
   * Палатки по номерам жильцов: у кого крыша, тот в ней и спит. Связь
   * та же, что у `hasRoof` (`residents.ts`) и у площадки лагеря, — номер,
   * потому что больше их ничто не связывает. Короче списка жильцов —
   * значит последним крыши не досталось, и ночуют они у огня.
   */
  readonly tents: readonly Cell[];
  /**
   * §13.8 — ягодные кусты площадки. Необязательные: сцены, которых кусты
   * ещё не касались, отдают рутину без них, и добытчик тогда ходит к кромке
   * леса, как все. Куст — не препятствие, поэтому в `blocked` его нет:
   * к нему подходят вплотную и садятся рядом.
   */
  readonly bushes?: readonly Cell[];
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
/**
 * §13.8 — клетки, с которых достают до куста. Кустов мало и они наперечёт,
 * поэтому правило проще лесного: каждый сосед куста, по которому можно
 * пройти, годится, а дальше выбор качается тем же сидом, что у леса.
 */
function bushSpots(site: ChoreSite): { spot: Cell; tree: Cell }[] {
  const { size, blocked } = site;
  const out: { spot: Cell; tree: Cell }[] = [];
  for (const bush of site.bushes ?? []) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = bush.x + dx;
      const z = bush.z + dz;
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      if (blocked[idx(size, x, z)]) continue;
      out.push({ spot: { x, z }, tree: { x: bush.x, z: bush.z } });
    }
  }
  return out;
}

export function choresOf(
  site: ChoreSite,
  residents: readonly Resident[],
  roofed: (i: number) => boolean,
): (Chore | null)[] {
  const spots = treeSpots(site);
  /**
   * §13.8 — добытчик пищи ходит к кусту, а не к кромке леса. Это первое
   * место, где занятие жильца видно маршрутом, а не только строкой карточки:
   * дровосек уходит к деревьям, добытчик — к ягодам, и разница читается
   * с одного взгляда на поляну.
   *
   * Если кустов на площадке нет, он идёт к кромке вместе со всеми: рутина
   * не имеет права остановиться из-за того, что грядку ещё не посадили.
   */
  const berry = bushSpots(site);
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
    /** Дорога от дома к порогу палатки; пусто — крыши нет. */
    readonly bed: Cell[];
  }

  /**
   * Дорога ко сну: от места у костра до **порога** палатки, а не до неё
   * самой. Клетка палатки занята (её закрывает та же маска, что и следы
   * построек), и путь внутрь искать нечего: жилец доходит до двери
   * и пропадает. Крыши нет — дороги нет, и ночь он сидит там, где стоял.
   */
  const bedPath = (from: Cell, tent: Cell | undefined): Cell[] => {
    if (tent === undefined) return [];
    let best: Cell[] = [];
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const door = { x: tent.x + dx, z: tent.z + dz };
      if (door.x < 0 || door.z < 0 || door.x >= site.size || door.z >= site.size) continue;
      if (site.blocked[idx(site.size, door.x, door.z)] !== 0) continue;
      if (door.x === from.x && door.z === from.z) return [{ ...from }];
      const leg = findPath(site.size, site.blocked, from, door);
      if (leg.length === 0) continue;
      if (best.length === 0 || leg.length < best.length) best = [{ ...from }, ...leg.map((c) => ({ x: c.x, z: c.z }))];
    }
    return best;
  };
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
    const mine = r.answer === 'кормим' && berry.length > 0 ? berry : spots;
    const near = [...mine].sort((a, b) => dist(a.spot, base) - dist(b.spot, base));
    const pool = near.slice(0, Math.max(8, near.length / 4));
    const pickSpot = (away: readonly Cell[], tries: number): { spot: Cell; tree: Cell } | null => {
      for (let k = 0; k < tries; k++) {
        const cand = pool[randInt(rng, pool.length)];
        if (cand === undefined) return null;
        if (away.every((c) => dist(c, cand.spot) >= APART)) return cand;
      }
      return pool[randInt(rng, pool.length)] ?? null;
    };

    // Дорога ко сну прикладывается при укладке в список: она зависит
    // от места у костра, а его выбирает та же ветка, что и тропу.
    let built: Omit<Draft, 'bed'> | null = null;
    /**
     * §13.8 — добытчик пищи ходит кругом дровосека: пришёл, сел у куста,
     * вернулся с ношей. Круг камнетёса ему не годится — тот высматривает
     * породу с двух углов кромки и работой это не считается (`working: false`),
     * а сбор ягод — работа: рендер обязан играть труд, иначе жилец
     * прогуливается у куста и приносит пищу неизвестно откуда.
     */
    if (r.answer === 'строим' || r.answer === 'кормим') {
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
    drafts[i] = { ...built, bed: bedPath(base, site.tents[i]) };
  });

  /**
   * Сведение круга — и всё расписание разом.
   *
   * **Круги укладываются в бодрствование смены.** Число кругов подбирается
   * так, чтобы последний кончился ровно к темноте, а остаток времени уходит
   * в рабочую стоянку: у кого тропа короче, тот дольше рубит. Отдай эти
   * секунды дому — и он стоял бы у огня втрое дольше соседа, а это со
   * стороны не «работает медленнее», а «бездельничает».
   *
   * Отсюда же встреча пары: обоим выдан **один и тот же круг**, значит домой
   * они приходят в одну и ту же секунду каждый раз. Ловить сближение
   * по расстоянию значило бы завести память о том, кто с кем уже поговорил;
   * общий круг оставляет кадр чистой функцией времени.
   *
   * Личной фазы ни у кого нет, и это решение: на рассвете лагерь выходит
   * разом. Один момент в смене, когда видно, что он проснулся, дороже
   * ровного размазывания выходов по утру — а разъезжаются жильцы всё равно
   * сразу, потому что тропы у них разной длины.
   */
  const settle = (d: Draft, mate: number | null, longest: number, beside: Cell | null): Chore | null => {
    const talks = mate !== null;
    const base = longest + (talks ? CHAT_SECONDS : 0);
    // Круг длиннее целой смены не укладывается в неё ни разу: такой жилец
    // остаётся у костра, чем ложился бы спать посреди дороги.
    if (base <= 0 || base > AWAKE_SEC) return null;
    const laps = Math.max(1, Math.min(Math.round(AWAKE_SEC / base), Math.floor(AWAKE_SEC / base)));
    const circuit = AWAKE_SEC / laps;
    // Добавка **личная**, а не общая на пару: у напарников тропы разной
    // длины, и одинаковая добавка оставила бы им разные круги — то есть
    // развела бы по времени ровно тех, кого круг сводит.
    const pad = circuit - d.alone - (talks ? CHAT_SECONDS : 0);
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
      circuit,
      laps,
      partner: mate,
      bed: d.bed,
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
      out[i] = settle(d, null, d.alone, null);
      return;
    }
    const longest = Math.max(d.alone, other.alone);
    out[i] = settle(d, mate, longest, other.spot);
    out[mate] = settle(other, i, longest, d.spot);
  });
  return out;
}

/**
 * Ночь жильца: `s` секунд от темноты. Три отрезка — дойти до палатки,
 * проспать в ней и выйти к рассвету.
 *
 * Спящий **скрыт, а не поставлен внутрь**: тело на клетке палатки торчало бы
 * сквозь неё, а положенное рядом читалось бы спящим на земле при живой
 * крыше — то есть врало бы ровно о том, ради чего ночь и заведена (§24).
 *
 * Крыши нет — нет и дороги: безкрышный работник (такой бывает только
 * мгновение между постройкой палатки и пересадкой) ночует там, где стоял.
 * Обычно же его вовсе нет в этом списке: без крыши тропы не дают.
 */
function sleepAt(c: Chore, s: number): ChoreFrame {
  const home = c.path[0]!;
  const bed = c.bed;
  // Пусто — крыши нет. Одна клетка — крыша есть, а идти до неё некуда:
  // место у костра само оказалось порогом палатки, и жилец скрывается
  // не сходя с него. Считать это «крыши нет» значило бы оставить его
  // ночевать снаружи ровно потому, что палатка близко.
  if (bed.length === 0) {
    return { x: home.x, z: home.z, facing: 0, walking: false, working: false, carrying: false, talk: null, hidden: false };
  }
  let walk = 0;
  for (let i = 0; i + 1 < bed.length; i++) {
    const a = bed[i]!;
    const b = bed[i + 1]!;
    walk += Math.hypot(b.x - a.x, b.z - a.z);
  }
  walk /= DWELLER_SPEED;
  // Ночь короче двух концов дороги не бывает при нынешних числах, но если
  // станет — жилец просто спит на пороге: пропасть по дороге хуже.
  const legs = Math.min(walk, SLEEP_SEC / 2);
  const along = (u: number): ChoreFrame => {
    let left = u * walk;
    for (let i = 0; i + 1 < bed.length; i++) {
      const from = bed[i]!;
      const to = bed[i + 1]!;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const span = Math.hypot(dx, dz) / DWELLER_SPEED;
      if (left < span || i + 2 === bed.length) {
        const share = span === 0 ? 0 : Math.min(1, left / span);
        return {
          x: from.x + dx * share,
          z: from.z + dz * share,
          facing: Math.atan2(dx, dz),
          walking: true,
          working: false,
          carrying: false,
          talk: null,
          hidden: false,
        };
      }
      left -= span;
    }
    const door = bed[bed.length - 1]!;
    return { x: door.x, z: door.z, facing: 0, walking: false, working: false, carrying: false, talk: null, hidden: false };
  };
  if (s < legs) return along(s / legs);
  if (s >= SLEEP_SEC - legs) {
    // Обратно тем же путём: у порога разворачиваются, а не проходят сквозь.
    const back = along(1 - (s - (SLEEP_SEC - legs)) / legs);
    return { ...back, facing: back.facing + Math.PI };
  }
  const door = bed[bed.length - 1]!;
  return { x: door.x, z: door.z, facing: 0, walking: false, working: false, carrying: false, talk: null, hidden: true };
}

/**
 * Где жилец на момент `t`. Устройство — `walkYard` до буквы: остаток времени
 * в круге съедается отрезками хода и стоянками, и первый недоеденный отрезок
 * называет положение.
 */
export function choreAt(c: Chore, t: number): ChoreFrame {
  // Отсчёт — от рассвета: с него встают, и потому с него считается всё
  // остальное. Смена и есть сутки (§24), другого расписания у жильца нет.
  const since = t - WAKE_AT;
  const day = ((since % SHIFT_SEC) + SHIFT_SEC) % SHIFT_SEC;
  if (day >= AWAKE_SEC) return sleepAt(c, day - AWAKE_SEC);
  let left = day % c.circuit;
  // Номер круга: по нему разговор каждой встречи звучит своими словами.
  const round = Math.floor(since / c.circuit);
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
        hidden: false,
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
          hidden: false,
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
    hidden: false,
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
