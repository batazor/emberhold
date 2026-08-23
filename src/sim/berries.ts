/**
 * §13.8 — ягодный куст: пища, которую добывает сам игрок.
 *
 * Содержание (§13.7) завело у лагеря сток, идущий по часам, и один источник
 * к нему — жильца с приказом «Добывать пищу». Источник этот работает **без
 * игрока**, и потому у пищи не было ни одного жеста: игрок мог только
 * назначить человека и уйти. Куст закрывает ровно эту дыру — он источник,
 * который платится вниманием, как вырубка (§13.3) и валун (§13.4) платятся
 * временем.
 *
 * **Где растут и почему именно там.** Валуны (`stones.ts`) лежат в вылазке,
 * лагере и у замка; кусты — в лагере, у замка и **на кладбище**, а в вылазке
 * их нет вовсе. Разнесено это не для разнообразия:
 *
 *  - в вылазке кустов нет, потому что там всё уже связано провиантом
 *    и рюкзаком (§11), и третья валюта под землёй ломала бы решение
 *    «глубже или назад» ради грядки;
 *  - на кладбище кустов, наоборот, больше всех — это единственное место
 *    мира, где до сих пор нечего было делать (§4: «добывать на прогулке
 *    нечего»), и ягоды дают прогулке причину, не превращая её в вылазку:
 *    пища не покупает ни снаряжения, ни построек.
 *
 * **Чем куст отличается от валуна.** Валун разбивается насовсем, куст
 * созревает снова. Это и делает его источником, а не находкой: у лагеря
 * появляется место, куда возвращаются, а у игрока — причина обойти поляну
 * перед выходом.
 */
import { mulberry32, randInt } from '../core/rng';
import { SWING_SECONDS, inReach, startWork, stepWork } from './work';
import type { Work, WorkBlock, Worker } from './work';
import type { Resources } from './resources';

/**
 * Пищи с одного куста. Вдвое меньше, чем камня с валуна (3–5), и это
 * не про щедрость: паёк рта — треть за такт (§13.7), значит куст кормит
 * лагерь из трёх человек полтора такта. Куст обязан быть подспорьем,
 * а не заменой добытчику, и это проверяется правилом, а не намерением.
 */
export const BERRY_FOOD_MIN = 1;
export const BERRY_FOOD_MAX = 2;

/** Средняя награда — ею правила считают темп ручного сбора. */
export const BERRY_FOOD_AVG = (BERRY_FOOD_MIN + BERRY_FOOD_MAX) / 2;

/**
 * Сколько пищи на этом кусте. Детерминировано клеткой, как награда валуна:
 * тот же куст при повторном заходе отдаст столько же, и «повезло с кустом»
 * не бывает.
 */
export function berryYield(bush: Bush): number {
  const rng = mulberry32((bush.x * 40503151) ^ (bush.z * 29996224) ^ 0x2ab3f1);
  return BERRY_FOOD_MIN + randInt(rng, BERRY_FOOD_MAX - BERRY_FOOD_MIN + 1);
}

/**
 * Замахов на куст. Втрое меньше, чем на валун (30), и это главное число
 * механики: **собирать быстрее, чем добывать**. Ягоды рвут руками, а не
 * кайлом, и цена жеста обязана это говорить — иначе куст читается как
 * валун другого цвета.
 */
export const PICK_SWINGS = 10;

/** Сколько секунд обирается один куст. */
export const PICK_SECONDS = SWING_SECONDS * PICK_SWINGS;

/**
 * За сколько куст родит снова.
 *
 * Два часа — вчетверо дольше рабочего такта жильца (§13.7, 30 минут),
 * и число это выведено из одного требования: **роща не должна кормить
 * лагерь сама.** Четыре куста лагеря по полторы ягоды за два часа дают
 * меньше, чем съедает взрослый лагерь из шести ртов, — значит добытчик
 * остаётся нужен, а обход кустов остаётся подспорьем.
 *
 * Отсюда же и вторая половина сделки: куст созревает дольше рабочего такта,
 * то есть возвращаться к нему чаще, чем раз в смену, незачем. Быстрее —
 * но за внимание, и не вместо человека (§13.3).
 */
export const RIPEN_SECONDS = 7200;

/**
 * Куст на клетке. `pickedAt` — когда обобрали: время, а не флаг, потому что
 * куст созревает. Ноль и `undefined` значат «полный»: сохранения, записанные
 * до кустов, открываются с нетронутой поляной, и это правда.
 */
export interface Bush {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  pickedAt?: number;
}

/** Созрел ли куст к моменту `now` (секунды той же шкалы, что у построек). */
export const ripe = (bush: Bush, now: number): boolean =>
  bush.pickedAt === undefined || now - bush.pickedAt >= RIPEN_SECONDS;

/** Сколько ждать до созревания. Ноль — можно рвать. */
export const ripensIn = (bush: Bush, now: number): number =>
  bush.pickedAt === undefined ? 0 : Math.max(0, RIPEN_SECONDS - (now - bush.pickedAt));

/**
 * Сколько кустов где растёт.
 *
 * Числа назначены владельцем игры, и прежние мои — шесть на кладбище —
 * отменены вместе с доводом, который я под них написал. Причина простая
 * и правильная: **кладбище не грядка.** Один куст у ограды читается как
 * дичок, выросший там, где никто не ходит; шесть превращают прогулку
 * в огород, а место — в источник, каким §4 его не задумывал.
 *
 * У замка их больше — поле перед стеной большое, и три-пять кустов
 * по его краю не спорят ни со стражей, ни с дорогой. Точное число
 * качается сидом: одинаковое на всех заходах читалось бы разметкой.
 *
 * Вылазки в списке нет, и это решение, а не пропуск (см. шапку файла).
 */
export const BUSHES = {
  /** Лагерь на поляне пролога (§16.1). */
  camp: 4,
  /** Поле между лесом и стеной замка: 3–5, число качается сидом. */
  castleMin: 3,
  castleMax: 5,
  /** Кладбище: один дичок у ограды. */
  grave: 1,
} as const;

/** Сколько кустов у замка на этом сиде. */
export const castleBushCount = (seed: number): number =>
  BUSHES.castleMin + randInt(mulberry32(seed ^ 0x5b17), BUSHES.castleMax - BUSHES.castleMin + 1);

/**
 * Рассадить кусты по проходимым клеткам.
 *
 * Свой поток случайности, а не общий с генератором места, — по той же
 * причине, что у валунов: подмешавшись в общий, кусты сдвинули бы всё,
 * что бросается после них, и золотой мастер разошёлся бы на местах,
 * где, кроме кустов, ничего не менялось.
 *
 * Разнос тот же, что у валунов: два куста в соседних клетках читаются
 * как один, и десять замахов игрок платит дважды за одну грядку.
 */
export function scatterBushes(
  seed: number,
  size: number,
  blocked: Uint8Array,
  count: number,
  free: (x: number, z: number) => boolean = () => true,
  /**
   * Держать ли кусты у края карты. В лагере — нет: там своя поляна, и куст
   * посреди неё уместен. В местах мира — да: **дичок растёт там, где
   * не ходят**, а ходят там по дороге, у ворот и между могил. Куст под
   * ногами читался бы посаженным, а посадок в игре нет.
   */
  edge = false,
): Bush[] {
  const rng = mulberry32(seed ^ 0x0b3a17e5);
  const rim = (i: number): number => {
    const x = i % size;
    const z = (i / size) | 0;
    return Math.min(x, z, size - 1 - x, size - 1 - z);
  };
  let open: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (blocked[i]) continue;
    if (!free(i % size, (i / size) | 0)) continue;
    open.push(i);
  }
  /**
   * «У края» считается **среди проходимых**, а не по рамке локации: у замка
   * и кладбища рамка — лес и ограда, по ним не ходят, и абсолютная кромка
   * не оставила бы ни одной клетки. Берём самую внешнюю доступную полосу:
   * ближайшее к рамке проходимое кольцо плюс две клетки вглубь.
   */
  if (edge && open.length > 0) {
    const nearest = Math.min(...open.map(rim));
    open = open.filter((i) => rim(i) <= nearest + EDGE_BAND);
  }

  const bushes: Bush[] = [];
  const apart = (x: number, z: number): boolean =>
    bushes.every((b) => Math.abs(b.x - x) + Math.abs(b.z - z) > 1);

  for (let tries = 0; tries < count * 40 && bushes.length < count; tries++) {
    const cell = open[randInt(rng, open.length)];
    if (cell === undefined) break;
    const x = cell % size;
    const z = (cell / size) | 0;
    if (!apart(x, z)) continue;
    bushes.push({ id: bushes.length, x, z });
  }
  return bushes;
}

/** Ширина кромки, в которой растут дички: две клетки от рамки. Шире —
 *  и «у края» перестаёт читаться, уже — и кустам негде разойтись. */
const EDGE_BAND = 2;

/* ---------- места мира: формула вместо состояния ---------- */

/**
 * §13.8 — **узел места считается функцией сида и часов, а не хранится.**
 *
 * Мир §4 уже так устроен: кланы, богатство и раскладка выводятся из сида
 * и часов, и в сохранении их нет. Кусты мест живут тем же правилом, и это
 * не экономия байтов, а условие масштаба: мест будет много, а сейв,
 * растущий от прогулок, — это сейв, который однажды перестанет открываться.
 *
 * Формула отвечает на два вопроса разом.
 *
 * 1. **Созрел ли куст сам по себе.** Время режется на окна длиной `RIPEN`,
 *    у каждого куста своя фаза от сида: к приходу игрока часть кустов
 *    полна, часть ещё зелена, и картинка меняется между заходами сама.
 * 2. **Не обобрали ли его местные.** У замка и кладбища есть свои люди
 *    (§6.1.6.1), и ближние к воротам кусты они обирают чаще дальних.
 *    Доля занятого — та же функция, только со своим множителем.
 *
 * Чего формула не умеет — помнить руку игрока; для этого есть `PickLog`.
 */
const WILD_PHASES = 4;

/** Окно времени: номер отрезка длиной `RIPEN`. */
const epochOf = (now: number): number => Math.floor(now / RIPEN_SECONDS);

/** Фаза куста: в каком из окон он поспевает. Своя у каждого узла. */
const phaseOf = (seed: number, id: number): number =>
  randInt(mulberry32((seed * 2654435761) ^ (id * 40503) ^ 0x9e37), WILD_PHASES);

/**
 * Полон ли дикий куст к моменту `now`. Каждое окно поспевает своя четверть
 * кустов места — иначе все они пустели бы и полнели разом, и место мигало бы
 * целиком вместо того, чтобы жить.
 */
export function wildRipe(seed: number, bush: Bush, now: number): boolean {
  return epochOf(now) % WILD_PHASES === phaseOf(seed, bush.id);
}

/**
 * Обобрали ли куст местные. Чем ближе к людному месту, тем чаще: доля
 * растёт с близостью к `hub` — воротам замка или калитке кладбища.
 * Считается той же тройкой «сид, узел, окно», поэтому в сохранении
 * не нуждается и у двух игроков с одним сидом совпадает.
 */
export function takenByLocals(
  seed: number,
  bush: Bush,
  hub: { x: number; z: number },
  now: number,
): boolean {
  const near = Math.hypot(bush.x - hub.x, bush.z - hub.z);
  // Вплотную к воротам обирают почти всегда, за десяток клеток — редко.
  const share = Math.max(0.05, Math.min(0.85, 1 - near / 12));
  const roll = mulberry32((seed * 374761393) ^ (bush.id * 668265263) ^ (epochOf(now) * 2246822519))();
  return roll < share;
}

/* ---------- рука игрока: список, который сам себя стирает ---------- */

/**
 * Что игрок обобрал сам. Формула этого знать не может, поэтому запись
 * всё-таки есть — но **самоистекающая**: она живёт ровно `RIPEN` и
 * вычищается при первом же обращении. В покое список пуст, при активной игре
 * в нём десяток чисел, и от прогулок он не растёт.
 */
export type PickLog = Record<string, number>;

/** Ключ узла: место и номер. Место — строка мировой карты (§4). */
export const pickKey = (place: string, id: number): string => `${place}:${id}`;

/** Выбросить всё, что уже созрело обратно. Возвращает новый список. */
export function prunePicks(log: PickLog, now: number): PickLog {
  const kept: PickLog = {};
  for (const [key, at] of Object.entries(log)) {
    if (now - at < RIPEN_SECONDS) kept[key] = at;
  }
  return kept;
}

/**
 * Есть ли на кусте ягоды прямо сейчас: и природа созрела, и местные
 * не успели, и игрок не обобрал. Три условия в одном месте намеренно —
 * иначе кадр, тап и правила разошлись бы в том, что считать полным.
 */
export function worldRipe(
  seed: number,
  place: string,
  bush: Bush,
  hub: { x: number; z: number },
  log: PickLog,
  now: number,
): boolean {
  const mine = log[pickKey(place, bush.id)];
  if (mine !== undefined && now - mine < RIPEN_SECONDS) return false;
  if (!wildRipe(seed, bush, now)) return false;
  return !takenByLocals(seed, bush, hub, now);
}

/** Куст на этой клетке, если он там есть. */
export function bushAt(bushes: readonly Bush[], cell: { x: number; z: number }): Bush | null {
  return bushes.find((b) => b.x === cell.x && b.z === cell.z) ?? null;
}

/** Почему нельзя рвать. Слова — в интерфейсе, здесь только причина. */
export type PickBlock = 'ok' | 'пусто' | 'зелёный';

export function pickBlock(bush: Bush | null, now: number): PickBlock {
  if (bush === null) return 'пусто';
  return ripe(bush, now) ? 'ok' : 'зелёный';
}

export const PICK_REASON: Record<Exclude<PickBlock, 'ok'>, string> = {
  пусто: 'Здесь нечего рвать',
  зелёный: 'Ягоды ещё не поспели',
};


/* ---------- сбор: тот же аппарат, что у кайла ---------- */

/** Взяться за куст: десять замахов той же работы, что рубит и кайлит. */
export const startPick = (cell: { x: number; z: number }): Work =>
  startWork(cell, PICK_SWINGS);

/**
 * Можно ли рвать. Причины те же, что у валуна, плюс своя — зелёный куст:
 * обобранный созревает два часа, и до срока по нему стучать незачем.
 * Возвращает причину работы (`WorkBlock`), потому что её читает общий
 * `stepWork`, а не отдельный код куста.
 */
export function pickWorkBlock(
  worker: Worker,
  bushes: readonly Bush[],
  cell: { x: number; z: number },
  now: number,
): WorkBlock {
  const bush = bushAt(bushes, cell);
  if (bush === null) return 'gone';
  if (!ripe(bush, now)) return 'gone';
  return inReach(worker, cell) ? 'ok' : 'far';
}

export interface PickStep {
  /** Пришёлся ли замах: рендеру — дрогнуть кустом. */
  readonly swing: boolean;
  /** Обобран ли куст на этом шаге. */
  readonly taken: boolean;
  /** Сколько пищи легло в кладовую. */
  readonly food: number;
  readonly stopped: WorkBlock | null;
}

/**
 * Шаг сбора. Пища кладётся напрямую, а не через кладовую: места она
 * не занимает (§13.7), и потолок ей не писан.
 */
export function stepPickInto(
  worker: Worker,
  walking: boolean,
  bushes: readonly Bush[],
  work: Work,
  dt: number,
  into: Resources,
  now: number,
): PickStep {
  const step = stepWork(worker, walking, work, dt, pickWorkBlock(worker, bushes, work.cell, now));
  if (!step.done) return { swing: step.swing, taken: false, food: 0, stopped: step.stopped };

  const bush = bushAt(bushes, work.cell);
  if (bush === null) return { swing: step.swing, taken: false, food: 0, stopped: 'gone' };
  const food = berryYield(bush);
  into.food += food;
  bush.pickedAt = now;
  return { swing: step.swing, taken: true, food, stopped: null };
}
