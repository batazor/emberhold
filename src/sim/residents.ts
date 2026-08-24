/**
 * Жильцы лагеря и палатки под них.
 *
 * **Палатка вмещает одного.** Отсюда всё остальное: приглашённый занимает
 * место, мест ровно столько, сколько палаток, и каждый новый житель стоит
 * ещё одной палатки. Жильё из пролога — такая же палатка, и живёт в ней
 * герой; поэтому первый же приглашённый оказывается без крыши, и это
 * не оплошность, а тот самый повод строить, ради которого он и приходит.
 *
 * **Без крыши — не тупик.** Приглашённый остаётся в лагере в любом случае:
 * запирать знакомство за ценой значило бы отменять само знакомство, а §16.1
 * прямо держит правило «лагерь тратит собранное, но не запирается за ним».
 * Нехватка крыши читается заданием, а не отказом.
 *
 * **Палатка — не здание.** У неё нет уровня, она ничего не открывает
 * и не задаёт потолка: §20.4 оставляет эту роль одному Жилью, и вторая
 * лестница уровней рядом с первой означала бы, что «поставь пять палаток»
 * это способ обойти первую. Палатка даёт ровно одно — место для одного
 * человека и след 2×2 на площадке.
 *
 * **Палатка стоит дерева, а не места, и это вывод замера.** Сперва след был
 * 2×2, как у зданий, — и `npm run tents` показал, что это не работает
 * вовсе: на Жилье ур. 1 влезает одна палатка, а на ур. 2 — **ни одной**.
 * Рост лагеря отнимал место, и задание «поставить палатку» упиралось
 * в тупик на первом же жильце. Причина не в размере палатки, а в стартовой
 * раскладке: четыре здания стоят по клеткам 1–2 и 4–5, и двух соседних
 * свободных столбцов на площади 7×7 не остаётся.
 *
 * След 1×1 промахивается в другую сторону — влезает от 33 до 60 палаток,
 * то есть площадь не ограничивает ничего. Взят он всё равно, и вот почему:
 * **§20.4 уже вынес этот приговор и отложил возврат к нему до дня, когда
 * зданий станет больше десяти.** Палатка на жителя к этому дню приводит,
 * но пересчитывать планировку сейчас значило бы вводить ограничение,
 * которого никто не измерял, — и вводить его ценой тупика в кадре, где
 * тупика быть не может. Место палатки останется выразительным ровно
 * до того замера, каким §20.4 будет пересмотрен.
 *
 * Размер при этом не произвол: палатка на одного и обязана быть меньше
 * Кухни. 2×2 было взято у зданий по невнимательности, а не по доводу.
 */
import { BUILDING_ORDER, barracksBeds, campArea, clearanceOf, stash } from './camp';
import type { CampState } from './camp';
import type { DwellerLook } from './garrison';
import type { SelfAnswer } from './settler';
import { canAfford, spend } from './resources';
import { GUEST_FOOD } from './balance';
import type { ResourceKind, Resources } from './resources';
import { gatherFarmFood, startFarmOnboarding } from './farm';
import { mulberry32 } from '../core/rng';

/**
 * Чем жилец занят. Двух первых он приносит с собой — это ответ на вопрос
 * о себе (§16.1); третье назначает игрок, и оно появилось вместе с пищей
 * (§13.7). Тип шире `SelfAnswer` намеренно: вопрос знакомства остаётся
 * из двух кнопок, а занятий в лагере три.
 */
export type ResidentJob = SelfAnswer | 'кормим';

export const RESIDENT_JOBS: readonly ResidentJob[] = ['строим', 'ходим', 'кормим'];

/**
 * Ремёсла (§6.1.6.3). Их одно — лесник, и список из одного значения заведён
 * не «на будущее», а затем, что ремесло обязано лежать в сейве словом,
 * а не булевым полем: второе ремесло иначе пришлось бы вводить сменой
 * формата сохранения.
 *
 * Ремесло — единственное, чем купленный человек отличается от позванного,
 * и отличие это одно: он быстрее на **своём** деле. На чужом он обычные
 * руки — лесник, переведённый на камень, кайлит как все, потому что лес
 * он знает, а породу нет.
 */
export type ResidentCraft = 'лесник';

export const RESIDENT_CRAFTS: readonly ResidentCraft[] = ['лесник'];

export interface Resident {
  /** Стабильный идентификатор для назначений, не зависящий от имени и позиции в списке. */
  readonly id?: string;
  readonly name: string;
  readonly look: DwellerLook;
  /** Сид лица (`ui/avatar.ts`): с каким пришёл, с таким и живёт. */
  readonly seed: number;
  /** Что он о себе сказал при знакомстве или на что его перевели:
   *  этим выбрано, чем он занят в лагере (`RESIDENT_WORK`). */
  readonly answer: ResidentJob;
  /**
   * Отдыхает: приказ «отдыхать» откладывает инструмент и останавливает
   * работу. Занятие (`answer`) при этом не стирается — отдых кончается
   * приказом вернуться к нему, и жилец обязан помнить, к чему.
   */
  readonly rest: boolean;
  /** Суточная смена. Без поля старый сейв живёт по дневной смене. */
  readonly schedule?: ResidentScheduleId;
  /** Пятичасовое поручение вне лагеря. До завершения можно только отозвать. */
  readonly hunt?: ResidentHunt;
  /**
   * Ремесло: с чем человек пришёл в лагерь и чего не может разучиться
   * (§6.1.6.3). Поля нет у всех, кто пришёл знакомством или гостем, — они
   * умеют ровно то же, что игрок, и ничего сверх.
   *
   * Отдельно от `answer` намеренно: занятие меняется приказом карточки
   * и меняется бесплатно, ремесло не меняется вовсе. Отдельно от `look`
   * тоже, и это то же правило с другого конца: внешность **выводится**
   * из ремесла (`residentLook`), а не хранится второй правдой рядом с ним.
   */
  readonly craft?: ResidentCraft;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function residentHash(value: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** UUID старого жильца выводится стабильно; новый сохраняет его навсегда. */
export function residentUuid(resident: Pick<Resident, 'id' | 'name' | 'look' | 'seed'>): string {
  if (resident.id !== undefined && UUID.test(resident.id)) return resident.id.toLowerCase();
  const key = `${resident.name}\u0000${resident.look}\u0000${resident.seed}`;
  const raw = [0x13579bdf, 0x2468ace0, 0x9e3779b9, 0x85ebca6b]
    .map((salt) => residentHash(key, salt).toString(16).padStart(8, '0'))
    .join('')
    .split('');
  raw[12] = '5';
  raw[16] = ((parseInt(raw[16]!, 16) & 3) | 8).toString(16);
  const hex = raw.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ResidentScheduleId = 'ранняя' | 'дневная' | 'поздняя';
export type ResidentPhase = 'сон' | 'еда' | 'работа' | 'свободен' | 'охота';

export interface ResidentSchedule {
  readonly name: string;
  readonly sleep: readonly [number, number];
  readonly meals: readonly (readonly [number, number])[];
  readonly work: readonly (readonly [number, number])[];
}

/**
 * Три понятных профиля вместо почасового редактора на 24 клетки. В каждом
 * восемь часов сна, два приёма пищи и десять часов работы; меняется только
 * фаза суток. Это уже расписание, но ещё не таблица Excel на экране телефона.
 */
export const RESIDENT_SCHEDULES: Readonly<Record<ResidentScheduleId, ResidentSchedule>> = {
  ранняя: { name: 'Ранняя смена', sleep: [20, 4], meals: [[4, 5], [10, 11]], work: [[5, 10], [11, 16]] },
  дневная: { name: 'Дневная смена', sleep: [22, 6], meals: [[6, 7], [12, 13]], work: [[7, 12], [13, 18]] },
  поздняя: { name: 'Поздняя смена', sleep: [2, 10], meals: [[10, 11], [16, 17]], work: [[11, 16], [17, 22]] },
};

export const RESIDENT_SCHEDULE_ORDER: readonly ResidentScheduleId[] = ['ранняя', 'дневная', 'поздняя'];
export const scheduleOf = (r: Resident): ResidentScheduleId => r.schedule ?? 'дневная';

const inHours = (hour: number, [from, to]: readonly [number, number]): boolean =>
  from <= to ? hour >= from && hour < to : hour >= from || hour < to;

/** Текущее окно по серверным часам. Охота старше обычного распорядка. */
export function residentPhaseAt(r: Resident, now: number): ResidentPhase {
  if (r.hunt !== undefined) return 'охота';
  const hour = ((now / 3600) % 24 + 24) % 24;
  const schedule = RESIDENT_SCHEDULES[scheduleOf(r)];
  if (inHours(hour, schedule.sleep)) return 'сон';
  if (schedule.meals.some((slot) => inHours(hour, slot))) return 'еда';
  if (schedule.work.some((slot) => inHours(hour, slot))) return 'работа';
  return 'свободен';
}

export interface ResidentHunt {
  readonly startedAt: number;
  readonly endsAt: number;
  readonly seed: number;
}

/** Пять настоящих часов: таймер досчитывается и при закрытой игре. */
export const HUNT_SECONDS = 5 * 60 * 60;
export const HUNT_UNLOCK_FOXES = 10;
export const foxesCaught = (camp: CampState): number => camp.foxesCaught ?? 0;
export const huntUnlocked = (camp: CampState): boolean => foxesCaught(camp) >= HUNT_UNLOCK_FOXES;

export type HuntBlock = 'ok' | 'locked' | 'missing' | 'roof' | 'away';

export function huntBlock(camp: CampState, index: number): HuntBlock {
  if (!huntUnlocked(camp)) return 'locked';
  const r = camp.residents[index];
  if (r === undefined) return 'missing';
  if (!hasRoof(camp, index)) return 'roof';
  if (r.hunt !== undefined) return 'away';
  return 'ok';
}

export function startHunt(camp: CampState, index: number, now: number): boolean {
  if (huntBlock(camp, index) !== 'ok') return false;
  const r = camp.residents[index]!;
  const seed = (r.seed ^ Math.floor(now) ^ (foxesCaught(camp) * 0x9e3779b9)) >>> 0;
  camp.residents[index] = {
    ...r,
    rest: false,
    hunt: { startedAt: now, endsAt: now + HUNT_SECONDS, seed },
  };
  return true;
}

/** Отзыв всегда без награды, даже за секунду до возвращения. */
export function recallHunt(camp: CampState, index: number): boolean {
  const r = camp.residents[index];
  if (r?.hunt === undefined) return false;
  const { hunt: _hunt, ...back } = r;
  camp.residents[index] = back;
  return true;
}

export interface HuntReport {
  readonly resident: number;
  readonly name: string;
  readonly foxes: number;
  readonly meat: number;
  readonly pelts: number;
  readonly lost: number;
}

/** Результат бросается из билета и потому одинаков после любой перезагрузки. */
export function huntYield(hunt: ResidentHunt): number {
  return Math.floor(mulberry32(hunt.seed)() * 6);
}

/** Завершить все дозревшие охоты и сразу положить добычу в кладовую. */
export function collectHunts(camp: CampState, now: number): HuntReport[] {
  const reports: HuntReport[] = [];
  camp.residents.forEach((r, index) => {
    const hunt = r.hunt;
    if (hunt === undefined || now < hunt.endsAt) return;
    const foxes = huntYield(hunt);
    const meatAsked = foxes * 2;
    const peltsAsked = foxes;
    const meatBefore = camp.resources.meat ?? 0;
    const peltsBefore = camp.resources.pelt ?? 0;
    const lost = stash(camp, { meat: meatAsked, pelt: peltsAsked });
    const meat = (camp.resources.meat ?? 0) - meatBefore;
    const pelts = (camp.resources.pelt ?? 0) - peltsBefore;
    camp.foxesCaught = foxesCaught(camp) + foxes;
    const { hunt: _hunt, ...back } = r;
    camp.residents[index] = back;
    reports.push({ resident: index, name: r.name, foxes, meat, pelts, lost });
  });
  return reports;
}

export function assignSchedule(camp: CampState, index: number, schedule: ResidentScheduleId): boolean {
  const r = camp.residents[index];
  if (r === undefined || scheduleOf(r) === schedule) return false;
  camp.residents[index] = { ...r, schedule };
  return true;
}

/** Сколько человек вмещает одна палатка. Единица — это и есть вся механика. */
export const TENT_ROOM = 1;

/**
 * Цена палатки — **черновая**, и помечена так намеренно. §20.3 требует,
 * чтобы цена была измерена, а не назначена: у зданий это делает
 * `npm run measure`, и у палатки обязан появиться свой блок замера — иначе
 * число проживёт до релиза только потому, что его написали раньше.
 *
 * Пока оно взято двумя связями, обе проверяются правилом. Палатка дешевле
 * второго уровня любого здания (`BUILD_COST[2]`): она не обязана быть
 * обязательством крупнее настоящей постройки. И платится она деревом:
 * дерево — единственный источник, бесконечный по кромке (§13.3), а значит
 * задание «поставить палатку» не может запереться навсегда.
 */
export const TENT_COST: Partial<Resources> = { wood: 5 };

/** След палатки в клетках. Единица: палатка на одного меньше здания. */
export const TENT_FOOT = 1;

/**
 * Мест под крышей. Жильё считается палаткой наравне с прочими: оно и есть
 * та палатка, которую игрок поставил в прологе.
 */
export const roofs = (camp: CampState): number =>
  (1 + camp.tents.length) * TENT_ROOM + barracksBeds(camp.levels.barracks);

/** Людей в лагере: герой и все приглашённые. */
export const dwellers = (camp: CampState): number => 1 + camp.residents.length;

/** Скольким не хватает крыши. Это и есть текст задания. */
export const homeless = (camp: CampState): number => Math.max(0, dwellers(camp) - roofs(camp));

/**
 * Кому именно не хватает крыши. Крыши занимают по старшинству: герой живёт
 * в палатке из пролога, дальше приглашённые в порядке прихода, — значит
 * без крыши остаются последние пришедшие, и первый из них тот, чьё лицо
 * стоит в задании. Число (`homeless`) говорит «скольким», а задание
 * показывает человека: «кому-то негде спать» — это не задание, а сводка.
 */
export const homelessFolk = (camp: CampState): readonly Resident[] =>
  camp.residents.slice(Math.max(0, roofs(camp) - 1));

export type TentBlock = 'ok' | 'nobody' | 'resources' | 'area';

/**
 * Почему палатку сейчас не поставить. Причина, а не булево, — то же
 * правило, что у `siteBlock` (§16.1) и у погасших точек карты (§16.2):
 * отказ обязан называть, чего не хватает.
 *
 * `nobody` стоит первым намеренно: палатка про запас — это здание, которое
 * ничего не делает, и предлагать её тому, кому она не нужна, значит
 * предлагать потратить дерево ни на что.
 */
export function tentBlock(camp: CampState): TentBlock {
  if (homeless(camp) === 0) return 'nobody';
  if (!canAfford(camp.resources, TENT_COST)) return 'resources';
  if (tentSpot(camp) === null) return 'area';
  return 'ok';
}

export const TENT_REASON: Record<Exclude<TentBlock, 'ok'>, string> = {
  nobody: 'Все под крышей',
  resources: 'Не хватает дерева',
  area: 'На площадке нет места',
};

/**
 * Клетки, занятые следом здания или палатки.
 *
 * Следы разные, и путать их нельзя: у здания 2×2, у палатки 1×1. Первая
 * версия мерила и то и другое размером палатки — палатки садились прямо
 * на Кухню, и `npm run tents` показал это занятостью в 125% от площадки.
 * Число выше ста и есть тот сторож, которого глазом не завести.
 */
const BUILDING_FOOT = 2;

function taken(camp: CampState, x: number, z: number): boolean {
  for (const id of BUILDING_ORDER) {
    if (camp.levels[id] <= 0) continue;
    const p = camp.layout[id];
    // Свободная зона (`clearanceOf`): изба шире следа, и палатка вплотную
    // оказывалась под её свесом — тот же довод, что у ходьбы (`campBlocked`).
    const pad = clearanceOf(id, camp.levels.hq);
    if (
      x < p.x + BUILDING_FOOT + pad &&
      x + TENT_FOOT > p.x - pad &&
      z < p.z + BUILDING_FOOT + pad &&
      z + TENT_FOOT > p.z - pad
    ) {
      return true;
    }
  }
  // Палатки и сундуки (`chests.ts`) занимают одинаково: след 1×1.
  for (const t of [...camp.tents, ...camp.chests]) {
    if (x < t.x + TENT_FOOT && x + TENT_FOOT > t.x && z < t.z + TENT_FOOT && z + TENT_FOOT > t.z) {
      return true;
    }
  }
  // Костры гостей (`castleGuest.ts`) занимают клетку наравне с палатками:
  // палатка, поставленная в костёр, была бы палаткой в огне.
  for (const f of camp.fires ?? []) {
    if (x < f.x + TENT_FOOT && x + TENT_FOOT > f.x && z < f.z + TENT_FOOT && z + TENT_FOOT > f.z) {
      return true;
    }
  }
  return false;
}

/**
 * Занятость клетки под след 1×1 — общая проверка палатки и сундука
 * (`chests.ts`): оба ставятся тем же жестом на ту же площадку, и две копии
 * этого цикла разошлись бы молча.
 */
export const spotTaken = (camp: CampState, x: number, z: number): boolean => taken(camp, x, z);

/**
 * Влезет ли палатка в эту клетку: в границах площадки и не на чужом следе.
 * Это проверка выбранного игроком места (`buildTent` с адресом): место
 * палатки выбирает игрок — тем же жестом, каким он переставляет здания
 * (§20.4), и по той же причине: планировка выразительна, и где жить
 * приглашённому — решение того, кто его пригласил. Автовыбор (`tentSpot`)
 * остаётся запасным путём и ответом на вопрос «есть ли место вообще».
 */
export function tentFits(camp: CampState, x: number, z: number): boolean {
  const area = campArea(camp.levels.hq);
  return x >= 0 && z >= 0 && x + TENT_FOOT <= area && z + TENT_FOOT <= area && !taken(camp, x, z);
}

/**
 * Куда встанет палатка, если игрок место не выбрал: запасной путь
 * (отладочная консоль) и проверка `tentBlock` на «место вообще есть».
 *
 * Ищется ближайшая свободная клетка **к Жилью**: люди селятся у той палатки,
 * которая уже стоит. Обход рядами сваливал бы их в угол площадки сплошным
 * блоком — снаружи это читается стеной, а не жильём.
 *
 * За зданием прячется камера, а не место (`behind`). Прежде здесь стояла
 * просто ближайшая клетка, и первая палатка садилась на (1,0) — вплотную
 * за Жильё, — где её целиком закрывал шатёр: игрок платил пять дерева
 * и не видел ничего. Камера в лагере не крутится, и «сзади» здесь значит
 * «нет никогда», а не «под другим углом».
 *
 * Клетка позади здания не запрещена, а отложена: если свободна только она,
 * палатка встанет и там. Тупик хуже плохого ракурса.
 */
function behind(camp: CampState, x: number, z: number): boolean {
  for (const id of BUILDING_ORDER) {
    if (camp.levels[id] <= 0) continue;
    const p = camp.layout[id];
    // Та же полоса по x и здание ближе к камере: ортокамера смотрит вдоль
    // растущего z, и здание с большим z стоит перед клеткой.
    const sameColumn = x < p.x + BUILDING_FOOT && x + TENT_FOOT > p.x;
    if (sameColumn && p.z > z && p.z - z <= BUILDING_FOOT) return true;
  }
  return false;
}

export function tentSpot(camp: CampState): { x: number; z: number } | null {
  const area = campArea(camp.levels.hq);
  const home = camp.layout.hq;
  let best: { x: number; z: number } | null = null;
  let bestKey = Infinity;
  for (let z = 0; z + TENT_FOOT <= area; z++) {
    for (let x = 0; x + TENT_FOOT <= area; x++) {
      if (taken(camp, x, z)) continue;
      // Ключ — расстояние до Жилья, а спрятанным клеткам добавляется штраф
      // размером с площадку: любая видимая клетка бьёт любую спрятанную,
      // но спрятанная всё равно лучше отказа.
      const key = Math.hypot(x - home.x, z - home.z) + (behind(camp, x, z) ? area * 2 : 0);
      if (key >= bestKey) continue;
      bestKey = key;
      best = { x, z };
    }
  }
  return best;
}

/**
 * Поставить палатку. Мгновенно и без таймера — по тому же правилу §20.2,
 * по которому его нет у первого уровня: палатка уровня не имеет вовсе,
 * и ждать здесь нечего. Слот стройки (§20.1) она не занимает по той же
 * причине — занимать его нечем.
 *
 * Вопрос о таймере встанет вместе с уровнями палаток, если они появятся;
 * до тех пор приписывать ей ожидание значило бы придумывать цену,
 * а не измерять её.
 *
 * Место (`at`) выбирает игрок; без адреса клетку выбирает `tentSpot` —
 * это путь отладочной консоли, а не игры. Первая версия выбирала место
 * всегда сама — и первая же палатка вставала в клетку, на которую визуально
 * свисает шатёр Жилья: игрок видел палатку, выросшую из чужой. Мимо выбора
 * игрока такое не проходит, мимо автомата прошло молча.
 */
export function buildTent(camp: CampState, at?: { x: number; z: number }): { x: number; z: number } | null {
  if (tentBlock(camp) !== 'ok') return null;
  const spot = at === undefined ? tentSpot(camp) : tentFits(camp, at.x, at.z) ? at : null;
  if (spot === null) return null;
  spend(camp.resources, TENT_COST);
  camp.tents.push(spot);
  return spot;
}

/* ---------- чем жилец занят ---------- */

/**
 * **Что ответ на вопрос знакомства наконец меняет.**
 *
 * Он выбирает, чем жилец занят, пока игрока нет. Оба занятия — это две
 * работы, которые игрок и сам делает руками в лагере: рубка (§13.3)
 * и валуны (§13.4). Жилец не умеет ничего, чего не умеет игрок; он просто
 * тратит на это своё время вместо чужого.
 *
 * Связка не произвольная. Сказавший «строим лагерь» приносит **дерево** —
 * материал, из которого лагерь и растёт. Сказавший «ходим вниз» приносит
 * **камень**: §13.4 прямо говорит, что камень внизу и есть порода.
 *
 * Железа и кристалла в списке нет и быть не может. §13.2 держит на них
 * дефицит, и он — вся конструкция глубины: жилец, приносящий железо,
 * отменил бы причину спускаться. Дерево и камень выбраны ровно потому,
 * что первое бесконечно по кромке леса, а второму §13.4 избыток прямо
 * разрешает.
 */
export const RESIDENT_WORK: Record<ResidentJob, ResourceKind> = {
  строим: 'wood',
  ходим: 'stone',
  // §13.7 — пища не выпадает в находках вовсе: её приносит только этот
  // жилец. Так у лагеря появляется первый настоящий выбор между людьми:
  // добытчик не носит ни дерева, ни камня, а без него не работает никто.
  кормим: 'food',
};

/** Занятие словами — для веера и карточки жильца: что он делает сейчас. */
export const RESIDENT_STATE: Record<ResidentJob, string> = {
  строим: 'носит дерево',
  ходим: 'носит камень',
  кормим: 'добывает пищу',
};

/**
 * Как жилец выглядит. Ремесло старше внешности, с которой человек пришёл:
 * лесник узнаётся лесником в любом кадре, где его видно, — в лагере,
 * в веере и на карточке. Две записи об одном человеке разошлись бы молча,
 * поэтому хранится одна — ремесло, — а внешность выводится.
 */
export const residentLook = (r: Resident): DwellerLook => r.craft ?? r.look;

/** Состояние жильца одним словом: отдых виден раньше занятия. */
export const residentState = (r: Resident): string =>
  r.rest ? 'отдыхает' : RESIDENT_STATE[r.answer];

/** Полная строка для интерфейса: распорядок виден раньше постоянной работы. */
export function residentStateAt(r: Resident, now: number): string {
  if (r.hunt !== undefined) {
    const left = Math.max(0, r.hunt.endsAt - now);
    const totalMinutes = Math.ceil(left / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `на охоте · ${hours} ч ${minutes} мин`;
  }
  if (r.rest) return 'отдыхает по приказу';
  const phase = residentPhaseAt(r, now);
  if (phase === 'работа') return residentState(r);
  if (phase === 'сон') return 'спит';
  if (phase === 'еда') return 'ест';
  return 'свободное время';
}

/**
 * Приказ карточки. Занятий по-прежнему два (`RESIDENT_WORK`), а приказов
 * три: «отдыхать» — не третье занятие, а разрешение отложить инструмент.
 * Ресурсов он не приносит и приносить не может — иначе отдых стал бы
 * работой, у которой §20.3 потребовал бы замера.
 */
export type ResidentOrder = ResidentJob | 'отдых';

/** Порядок кнопок карточки: сперва занятия, отдых последним. */
export const RESIDENT_ORDERS: readonly ResidentOrder[] = ['строим', 'ходим', 'кормим', 'отдых'];

/** Приказ словами — кнопки карточки жильца: на что его можно перевести. */
export const RESIDENT_ORDER: Record<ResidentOrder, string> = {
  строим: 'Носить дерево',
  ходим: 'Носить камень',
  кормим: 'Добывать пищу',
  отдых: 'Отдыхать',
};

/**
 * Есть ли у жильца с этим номером крыша. Первая палатка — героя, жильцы
 * считаются по остатку мест (`workDone` меряет тем же правилом): кто без
 * крыши, тот за работу не берётся, и веер обязан говорить это лицом.
 */
export function hasRoof(camp: CampState, index: number): boolean {
  return index < Math.min(camp.residents.length, Math.max(0, roofs(camp) - 1));
}

/**
 * Приказ жильцу: сменить занятие или отложить инструмент. Бесплатно
 * и мгновенно, как перестановка зданий (§20.4): расписание —
 * выразительность лагеря, а не логистика.
 */
export function assignWork(camp: CampState, index: number, order: ResidentOrder): boolean {
  const r = camp.residents[index];
  if (r === undefined) return false;
  // Поручение вне лагеря сначала отзывают явно: смена работы не должна
  // исподтишка отменять пять часов и стирать ожидаемую награду.
  if (r.hunt !== undefined) return false;
  if (order === 'отдых') {
    if (r.rest) return false;
    camp.residents[index] = { ...r, rest: true };
    return true;
  }
  if (r.answer === order && !r.rest) return false;
  camp.residents[index] = { ...r, answer: order, rest: false };
  return true;
}

/**
 * Сколько жилец возится с одной единицей. **Черновое число**, и помечено
 * так по тому же поводу, что цена палатки: §20.3 требует замера, и у этой
 * работы своего блока в `npm run measure` пока нет.
 *
 * Держит его одна проверяемая связь, и она жёсткая. Игрок добывает единицу
 * **за шесть секунд** стоя (24 с работы на среднюю награду 4 — замах
 * и вилка 3–5 общие у топора с кайлом). Жилец обязан быть медленнее
 * на порядки, иначе выгоднее не играть: правило держит отставание
 * не меньше чем в сто раз.
 */
export const WORK_SECONDS = 1800;

/**
 * Потолок на одного жильца за одну отлучку. Он и делает всю работу: без
 * потолка отлучка на неделю возвращала бы склад, набитый даром, и лагерь
 * переставал бы зависеть от вылазок — то есть отменялась бы петля §0.
 *
 * Тройка ниже цены палатки (5 дерева) намеренно: жилец не должен окупать
 * следующего жильца, иначе приглашённые начинают селить друг друга,
 * и палатка перестаёт что-либо стоить.
 */
export const WORK_CAP = 3;

/**
 * Во сколько раз лесник (§6.1.6.3) быстрее обычных рук **на дереве**.
 * Двойка — не «в меру хорошая» прибавка, а единственная, которую видно
 * без калькулятора: у лесника такт четверть часа против получаса, и первый
 * брусок он кладёт в кладовую тогда, когда обычный жилец ещё стоит с топором.
 *
 * Дальше двойки идти нельзя не из вкуса, а из `WORK_SECONDS`: правило держит
 * отставание жильца от рук игрока не меньше чем в сто раз (единица стоит
 * игроку шести секунд), и уже здесь запас — сто пятьдесят. Тройка съела бы
 * его до сотни ровно, четвёрка сломала бы правило.
 */
export const WOODSMAN_SWING = 2;

/**
 * Потолок лесника за одну отлучку. На единицу выше общего — и **ниже цены
 * палатки**, тем же доводом, каким `WORK_CAP` ниже её: жилец, окупающий
 * следующую палатку, начинает селить сам себя, и палатка перестаёт
 * что-либо стоить. Лесник куплен за монеты, а не за дерево, и разрешать
 * ему разгонять лагерь деревом значило бы отдать монете чужую работу.
 *
 * Отсюда и вся его выгода на длинной отлучке: одна единица сверху. Главное
 * он даёт не потолком, а скоростью — до потолка он доходит за час, а не
 * за полтора, и до этого часа обгоняет обычные руки втрое.
 */
export const WOODSMAN_CAP = 4;

/**
 * С какой скоростью и до какого потолка работает этот человек. Одно место
 * на приход и на его границу: разведённые, они разошлись бы первым же
 * ремеслом — прибавку посчитали бы по одной таблице, а потолок по другой.
 *
 * Ремесло действует только на своём деле (`RESIDENT_WORK`): лесник, которого
 * перевели на камень, кайлит как все.
 */
export function residentPace(r: Resident): { seconds: number; cap: number } {
  if (r.craft === 'лесник' && RESIDENT_WORK[r.answer] === 'wood') {
    return { seconds: WORK_SECONDS / WOODSMAN_SWING, cap: WOODSMAN_CAP };
  }
  return { seconds: WORK_SECONDS, cap: WORK_CAP };
}

const DAY_SECONDS = 24 * 60 * 60;

/** Накопленное время в повторяющихся суточных окнах от эпохи до `at`. */
function scheduledBefore(at: number, slots: readonly (readonly [number, number])[]): number {
  const days = Math.floor(at / DAY_SECONDS);
  const rem = at - days * DAY_SECONDS;
  let total = days * slots.reduce((sum, [from, to]) => sum + (to - from) * 3600, 0);
  for (const [from, to] of slots) {
    const start = from * 3600;
    const end = to * 3600;
    total += Math.max(0, Math.min(rem, end) - start);
  }
  return total;
}

/** Сколько из промежутка пришлось на рабочие окна конкретного человека. */
export function scheduledWorkSeconds(r: Resident, from: number, to: number): number {
  if (to <= from || r.rest || r.hunt !== undefined) return 0;
  const slots = RESIDENT_SCHEDULES[scheduleOf(r)].work;
  return Math.max(0, scheduledBefore(to, slots) - scheduledBefore(from, slots));
}

/**
 * Что жильцы наработали за отлучку.
 *
 * **Недоработанное не копится, а пропадает** — то же правило, по которому
 * в прологе пропадают недостоянные секунды отдыха (§16.1). Иначе пришлось
 * бы хранить долю у каждого жильца, и «сколько там накапало» стало бы
 * вопросом к сохранению, а не к экрану.
 */
export function workDone(
  camp: CampState,
  awaySec: number,
  /**
   * §13.7 — сколько жильцов вышло на работу. Голодные не работают, и считает
   * их `upkeep.ts`; по умолчанию работают все, у кого есть крыша, — иначе
   * все прежние прогоны и золотой мастер сдвинулись бы молча.
   */
  working?: number,
  /** Конец промежутка. Если задан, сон и еда вырезаются по расписанию. */
  untilAt?: number,
  /** Назначенные вне личного лагеря не могут работать в двух местах сразу. */
  excludedIds: ReadonlySet<string> = new Set(),
): { kind: ResourceKind; n: number }[] {
  if (awaySec <= 0) return [];
  // Работает только тот, у кого есть крыша. Это не наказание, а то же
  // задание, сказанное третий раз: человек, ночующий у костра, за работу
  // не берётся, и видно это прибавкой, которой не случилось.
  const roofed = Math.min(
    working ?? camp.residents.length,
    Math.min(camp.residents.length, Math.max(0, roofs(camp) - 1)),
  );
  const sum = new Map<ResourceKind, number>();
  for (const r of camp.residents.slice(0, roofed)) {
    if (excludedIds.has(residentUuid(r))) continue;
    // Отдыхающий не приносит ничего: отдых — это и есть отложенный
    // инструмент, и прибавка от него была бы работой под другим именем.
    if (r.rest || r.hunt !== undefined) continue;
    const active = untilAt === undefined
      ? Math.max(0, awaySec)
      : scheduledWorkSeconds(r, untilAt - Math.max(0, awaySec), untilAt);
    // Темп и потолок спрашиваются у человека, а не берутся общими: ремесло
    // (§6.1.6.3) меняет ровно эту пару и ничего больше.
    const pace = residentPace(r);
    const each = Math.min(pace.cap, Math.floor(active / pace.seconds));
    if (each === 0) continue;
    const kind = RESIDENT_WORK[r.answer];
    sum.set(kind, (sum.get(kind) ?? 0) + each);
  }
  return [...sum].map(([kind, n]) => ({ kind, n }));
}

/**
 * Положить наработанное в кошелёк. Возвращает то, что вправду прибавилось:
 * кладовая конечна (§13.6, `stash`), и наработанное сверх места пропадает —
 * жилец складывает в закрома, а не мимо них, и строка «принёс N» обязана
 * называть вошедшее, а не заработанное.
 */
export function collectWork(
  camp: CampState,
  awaySec: number,
  working?: number,
  untilAt?: number,
  excludedIds: ReadonlySet<string> = new Set(),
): { kind: ResourceKind; n: number }[] {
  const done = workDone(camp, awaySec, working, untilAt, excludedIds);
  const collected = done
    .map(({ kind, n }) => ({ kind, n: n - stash(camp, { [kind]: n }) }))
    .filter(({ n }) => n > 0);
  const food = collected.find((item) => item.kind === 'food')?.n ?? 0;
  if (food > 0) gatherFarmFood(camp, food);
  return collected;
}

/**
 * Принять жильца. Крыши может не быть — и это нормально: см. «без крыши —
 * не тупик» выше. Отказывает только повтор: один и тот же человек не может
 * прийти дважды, и различает их имя, потому что больше их ничто не различает.
 */
export function admit(camp: CampState, who: Resident): boolean {
  if (camp.residents.some((r) => r.name === who.name)) return false;
  camp.residents.push(who.id === undefined ? { ...who, id: residentUuid(who) } : who);
  // §13.7 — приглашённый приходит со своим узелком. Кладётся он через
  // кладовую (§13.6): у неё есть дно, и подарок, не влезший в закрома,
  // пропадает так же, как принесённое жильцом.
  stash(camp, { food: GUEST_FOOD });
  // Узелок второго жителя уже лежит в запасе: именно этот уровень становится
  // точкой отсчёта, а подарок не считается добычей задания.
  startFarmOnboarding(camp);
  return true;
}
