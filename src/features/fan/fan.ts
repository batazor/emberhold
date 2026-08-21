/**
 * Веер под большой палец: геометрия дуги, обвод досягаемости и упражнение
 * на промахи. Ни строки про DOM — поэтому всё, что здесь есть, проверяется
 * в Node (`fan.rules.ts`), а не глазом на телефоне.
 *
 * **Зачем вообще дуга.** Отряд открывается до трёх героев (§11.8), но тот же
 * контрол напрашивается на всех людей лагеря разом — жильцов десятки. Вопрос,
 * ради которого веер и собран: со скольких человек дуга перестаёт помещаться
 * под палец и прокрутка становится неизбежной. Ответ — число, и считается
 * оно здесь.
 *
 * **Отсчёт углов.** Ноль — вдоль нижней кромки экрана, `span` — вдоль боковой.
 * Палец в этой четверти и живёт: основание большого пальца лежит в нижнем
 * углу, и всё, до чего он дотягивается не перехватывая телефон, — дуга вокруг
 * этого угла. Слева и справа четверть зеркальна, поэтому рука — параметр,
 * а не константа.
 *
 * **Прокрутка не закольцована, и это решение.** Кольцо отнимает начало
 * и конец, а это единственные два места, которые палец запоминает без глаз:
 * до края докручивают вслепую, до середины — нет. Список упирается в концы.
 */
import { mulberry32 } from '../../core/rng';

/** Четверть: от нижней кромки до боковой. Раствор дуги по умолчанию. */
export const QUADRANT = Math.PI / 2;

/** Нижняя граница удобного нажатия, в CSS-пикселях. */
export const TAP = 44;

export type Hand = 'правая' | 'левая';

/**
 * **Мест на дуге четыре, и это решение, а не следствие радиуса.**
 *
 * Считалось наоборот: сколько влезет при данном радиусе. Замер (`npm run fan`)
 * показал, что «влезает» — величина без дна: на радиусе 300 их десять, только
 * палец до десятого не достаёт. Раз число всё равно упирается в руку, а не
 * в геометрию, оно назначается прямо — четыре, — и радиус обязан быть таким,
 * чтобы четыре не налезли друг на друга (`minRadius`). Пятый человек приходит
 * прокруткой, и это единственный способ, которым он приходит.
 */
export const FITS = 4;

export interface FanShape {
  /** От основания пальца до центра слота, в CSS-пикселях. */
  readonly radius: number;
  /** Поперечник слота. */
  readonly size: number;
  /** Просвет между краями соседних слотов. */
  readonly gap: number;
  /** Раствор дуги в радианах. */
  readonly span: number;
  readonly hand: Hand;
  /** Сколько мест на дуге. */
  readonly fits: number;
}

export const SHAPE: FanShape = {
  radius: 130,
  size: TAP,
  gap: 8,
  span: QUADRANT,
  hand: 'правая',
  fits: FITS,
};

/** Угловой шаг: места разложены по всему раствору, крайние — на концах. */
export const step = (shape: FanShape): number =>
  shape.fits <= 1 ? shape.span : shape.span / (shape.fits - 1);

/**
 * Наименьший радиус, при котором соседи ещё не налезают. Считается от хорды,
 * а не от дуги: два круга поперечником `size` не сходятся ближе `size + gap`
 * **по прямой**, и на малом радиусе разница уже не косметическая.
 */
export function minRadius(shape: FanShape): number {
  const half = Math.sin(step(shape) / 2);
  return half <= 0 ? 0 : (shape.size + shape.gap) / (2 * half);
}

/** Тесно ли: радиус мельче потребного, соседи налезают. */
export const tight = (shape: FanShape): boolean => shape.radius < minRadius(shape) - 1e-9;

/** Сколько человек стоит на дуге разом. */
export const capacity = (shape: FanShape): number => shape.fits;

export interface Slot {
  /** Номер человека в списке. */
  readonly i: number;
  /** Угол от нижней кромки. */
  readonly angle: number;
  /** Смещение от угла экрана: x вправо, y вниз — как на экране. */
  readonly x: number;
  readonly y: number;
}

/**
 * Где сейчас стоят слоты. `offset` — насколько дуга прокручена; слоты,
 * уехавшие за раствор, не возвращаются пустыми, их просто нет в ответе.
 */
export function layout(shape: FanShape, count: number, offset = 0): Slot[] {
  const d = step(shape);
  const side = shape.hand === 'правая' ? -1 : 1;
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * d - offset;
    if (angle < -1e-9 || angle > shape.span + 1e-9) continue;
    out.push({
      i,
      angle,
      x: side * Math.cos(angle) * shape.radius,
      y: -Math.sin(angle) * shape.radius,
    });
  }
  return out;
}

/** Докуда можно докрутить. Ноль означает, что крутить нечего. */
export const maxOffset = (shape: FanShape, count: number): number =>
  Math.max(0, (count - 1) * step(shape) - shape.span);

export const clampOffset = (shape: FanShape, count: number, offset: number): number =>
  Math.min(Math.max(0, offset), maxOffset(shape, count));

/** Нужна ли прокрутка вообще. Пока все помещаются — жеста нет. */
export const scrolls = (shape: FanShape, count: number): boolean => count > shape.fits;

/* ---------- досягаемость ---------- */

/**
 * Обвод большого пальца: докуда он дотягивается в каждом секторе четверти.
 *
 * Досягаемость не назначается числом из статьи, а обводится пальцем на том
 * телефоне, в котором её меряют: «удобная зона» зависит от размера экрана,
 * длины пальца и от того, как держат аппарат, а все три величины отладочной
 * сцене неизвестны. До обвода профиль пуст — и пустой профиль честно
 * не объявляет достижимым ничего.
 */
export const SECTORS = 18;

export interface Reach {
  readonly span: number;
  /** Наибольший радиус, до которого палец дотянулся в этом секторе. */
  readonly ring: number[];
}

export const emptyReach = (span: number = QUADRANT): Reach => ({
  span,
  ring: new Array<number>(SECTORS).fill(0),
});

export const sectorOf = (reach: Reach, angle: number): number =>
  Math.min(SECTORS - 1, Math.max(0, Math.floor((angle / reach.span) * SECTORS)));

/** Записать точку обвода: угол от нижней кромки, радиус от угла экрана. */
export function record(reach: Reach, angle: number, radius: number): void {
  if (angle < 0 || angle > reach.span) return;
  const s = sectorOf(reach, angle);
  if (radius > reach.ring[s]!) reach.ring[s] = radius;
}

export const reachAt = (reach: Reach, angle: number): number => reach.ring[sectorOf(reach, angle)]!;

/** Обводили ли вообще. Без этого «не дотягивается» неотличимо от «не мерили». */
export const calibrated = (reach: Reach): boolean => reach.ring.some((r) => r > 0);

/**
 * Полпикселя запаса. Не косметика: слот, стоящий ровно на обведённом радиусе,
 * иначе гаснет от арифметической пыли — 130.00000000000003 против 130, —
 * и в кадре это читается как «через раз достаёт», то есть как поломка.
 * Палец полпикселя не различает, а замер от них не зависит.
 */
export const REACH_SLACK = 0.5;

export const reached = (reach: Reach, slot: Slot): boolean =>
  Math.hypot(slot.x, slot.y) <= reachAt(reach, slot.angle) + REACH_SLACK;

/* ---------- упражнение ---------- */

/**
 * Упражнение: сцена называет человека, палец его ищет. Считаются промахи
 * и время — это и есть замер, всё остальное на дуге проверяется глазом.
 *
 * Порядок выводится из сида: одно и то же упражнение на пяти и на двадцати
 * людях иначе несравнимо. Два одинаковых задания подряд разведены намеренно —
 * палец уже стоит на месте, и второе время получилось бы не про поиск.
 */
export interface Try {
  readonly want: number;
  /** Кого нажали. −1 — мимо всех. */
  readonly got: number;
  readonly ms: number;
}

export interface Drill {
  readonly order: readonly number[];
  readonly tries: Try[];
}

export function makeDrill(count: number, rounds = 3, seed = 1): Drill {
  // Раскладка жадная, а не «перемешать и починить»: перемешивание разводит
  // повторы только на первый взгляд, а на трёх людях по три раза хвост
  // складывается так, что чинить его уже нечем. Жадный выбор берёт того,
  // у кого осталось больше заданий, — тогда человек, которого просят чаще
  // всех, не копится к концу; ничьи разводит сид.
  const left = new Array<number>(count).fill(rounds);
  const rng = mulberry32(seed);
  const order: number[] = [];
  let prev = -1;
  for (let n = count * rounds; n > 0; n--) {
    let best = -1;
    for (let i = 0; i < count; i++) {
      if (left[i]! <= 0 || i === prev) continue;
      if (best < 0 || left[i]! > left[best]!) best = i;
      else if (left[i]! === left[best]! && rng() < 0.5) best = i;
    }
    // Кандидатов нет только при одном человеке: разводить там нечего.
    if (best < 0) best = prev;
    left[best]!--;
    order.push(best);
    prev = best;
  }
  return { order, tries: [] };
}

/** Кого просят нажать сейчас. null — упражнение кончилось. */
export const target = (drill: Drill): number | null => drill.order[drill.tries.length] ?? null;

export function answer(drill: Drill, got: number, ms: number): void {
  const want = target(drill);
  if (want === null) return;
  drill.tries.push({ want, got, ms });
}

export interface DrillResult {
  readonly заданий: number;
  readonly попаданий: number;
  readonly промахов: number;
  /** Медиана времени по попаданиям, мс. Промахи в неё не входят. */
  readonly медиана: number;
}

export function result(drill: Drill): DrillResult {
  const hits = drill.tries.filter((t) => t.want === t.got);
  const times = hits.map((t) => t.ms).sort((a, b) => a - b);
  const mid =
    times.length === 0
      ? 0
      : times.length % 2 === 1
        ? times[(times.length - 1) / 2]!
        : (times[times.length / 2 - 1]! + times[times.length / 2]!) / 2;
  return {
    заданий: drill.tries.length,
    попаданий: hits.length,
    промахов: drill.tries.length - hits.length,
    медиана: Math.round(mid),
  };
}
