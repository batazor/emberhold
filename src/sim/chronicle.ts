/**
 * §24 — хроника: игра пересказывает то, что уже посчитала.
 *
 * Ни одной новой механики здесь нет и быть не может. Телеметрия (§9) уже
 * пишет, чем кончилась каждая вылазка и что достроилось; хроника — вторая
 * читалка того же буфера, только не для нас, а для игрока. Отсюда её главное
 * свойство и главное ограничение разом: **строка выводится из события,
 * а не сочиняется рядом с ним**. Нет события — нет строки; поля в сохранении
 * хроника не стоит (§4 требует того же от мира).
 *
 * **Один день — одна строка.** Правило то же, что у отказов (§23.3), и по той
 * же причине: день, пересказанный пятью строками, — это лог, а лог читают
 * разработчики, а не игрок. Какая из пяти строк останется, решает
 * **старшинство**: шаблоны стоят по убыванию частности, и выигрывает первый,
 * чьё условие сегодня выполнено. Приём взят у сторилетов (saliency
 * в Yarn Spinner, «плавающие модули» King of Dragon Pass) и стоит здесь
 * одного массива: провал старше полного рюкзака, полный рюкзак старше
 * обычного дня.
 *
 * **Подпись и значение разведены** (§6.2, слово `.row`). Слева — слова,
 * справа — число, которое игрок может проверить: сколько потеряно, сколько
 * унесено, до какого уровня поднялось здание. Числа в словах не живут,
 * поэтому таблица `CHRON_TEXT` — обычная перепись голоса (§23), а не набор
 * шаблонов с подстановками, которые перепись мерить не умеет.
 *
 * Метки времени («вчера», «три дня назад») здесь нет намеренно. Абсолютный
 * номер дня стоил бы поля в сохранении — первого дня игры мы не помним, —
 * а относительная метка протухает прямо на экране: заставка живёт до тех
 * пор, пока её не закроют. Порядок строк сверху вниз и есть вся хронология,
 * которую хроника вправе обещать.
 */
import { BUILDINGS } from './camp';
import type { TelemetryEvent } from './telemetry';
import { TIER_NAME } from './config';
import { DAY_SEC } from './world';

/** Что за день пересказано. Ключ шаблона и ключ строки в `CHRON_TEXT` — один. */
export type ChronId = 'bottom' | 'fail' | 'full' | 'deep' | 'built' | 'home';

/**
 * Слова хроники. Канал «хроника» в переписи голоса (`voice.rules.ts`):
 * работа у них событийная — сказать, что случилось, — но читаются они
 * в своём темпе, подписью в строке, а не полосой на четыре секунды.
 * Отсюда и права: прошедшее или назывное, без адресата, без точки.
 */
export const CHRON_TEXT: Record<ChronId, string> = {
  bottom: 'Дно забрало добычу',
  fail: 'Вылазка не дошла домой',
  full: 'Рюкзак пришёл полным',
  deep: 'Локация пройдена насквозь',
  built: 'Стройка кончилась',
  // «Кончились дома» здесь стояло до тех пор, пока перепись голоса
  // (`voice.rules.ts`) не посчитала строку приказом: разбор ищет глагол
  // на «-ись», а прошедшее «кончились» от повелительного «вернитесь»
  // по хвосту не отличить. Слова заменены, а не внесены в исключения:
  // «дошли домой» точнее и по смыслу — день без провала это день,
  // в который дошли все.
  home: 'Вылазки дошли домой',
};

/** Строка хроники: день, шаблон, слова и число к ним. */
export interface Entry {
  /** Номер суток мира — тот же, которым живёт карта (§4.1). */
  readonly day: number;
  readonly id: ChronId;
  readonly text: string;
  /** То, что игрок может проверить: число, а не оценка. */
  readonly value: string;
}

/** Сколько строк показывается. Четыре — это экран, а не архив. */
export const CHRON_LIMIT = 4;

/**
 * Доля локации, с которой заход считается пройденным насквозь. Не единица:
 * `maxBack` меряется от выхода до самой дальней **достигнутой** клетки,
 * и требовать ровно дна значило бы требовать обойти всю карту.
 */
const DEEP_SHARE = 0.9;

type Of<T extends TelemetryEvent['t']> = Extract<TelemetryEvent, { t: T }>;

/** Факты одних суток. Больше в хронику ничего не входит — и не должно. */
interface Day {
  readonly day: number;
  readonly raids: Of<'raid_end'>[];
  readonly starts: Of<'raid_start'>[];
  readonly builds: Of<'build_done'>[];
}

const dayOf = (at: number): number => Math.floor(at / DAY_SEC);

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Разбор буфера по суткам. Сутки без интересных событий не заводятся вовсе. */
function daysOf(events: readonly TelemetryEvent[]): Day[] {
  const box = new Map<number, Day>();
  const at = (day: number): Day => {
    const found = box.get(day);
    if (found !== undefined) return found;
    const fresh: Day = { day, raids: [], starts: [], builds: [] };
    box.set(day, fresh);
    return fresh;
  };
  for (const e of events) {
    if (e.t === 'raid_end') at(dayOf(e.at)).raids.push(e);
    else if (e.t === 'raid_start') at(dayOf(e.at)).starts.push(e);
    else if (e.t === 'build_done') at(dayOf(e.at)).builds.push(e);
  }
  return [...box.values()].sort((a, b) => a.day - b.day);
}

/**
 * Шаблоны по убыванию старшинства. Первый, чьё условие выполнено, и есть
 * строка дня. Порядок — решение, а не оформление: провал важнее удачи,
 * а редкая удача важнее обычного дня.
 */
const TEMPLATES: readonly { readonly id: ChronId; readonly of: (d: Day) => string | null }[] = [
  {
    // Дно (§11.2) отнимает всю добычу вылазки, и это единственный ярус,
    // где провал стоит именно столько.
    id: 'bottom',
    of: (d) => {
      const e = d.raids.find((r) => r.failed && r.tier === 3);
      return e === undefined ? null : `потеряно ${e.lost}`;
    },
  },
  {
    id: 'fail',
    of: (d) => {
      const e = d.raids.find((r) => r.failed);
      return e === undefined ? null : `${TIER_NAME[e.tier]} · потеряно ${e.lost}`;
    },
  },
  {
    // Полный рюкзак — это упёршийся Склад (§2), и говорит он о лагере,
    // а не о вылазке: следующий заход упрётся туда же.
    id: 'full',
    of: (d) => {
      const cap = Math.max(0, ...d.starts.map((s) => s.capacity));
      const e = d.raids.find((r) => !r.failed && cap > 0 && r.carried >= cap);
      return e === undefined ? null : `${e.carried} из ${cap}`;
    },
  },
  {
    id: 'deep',
    of: (d) => {
      const e = d.raids.find(
        (r) => !r.failed && r.locMaxBack > 0 && r.maxBack / r.locMaxBack >= DEEP_SHARE,
      );
      return e === undefined ? null : `${e.maxBack} шагов от выхода`;
    },
  },
  {
    id: 'built',
    of: (d) => {
      const e = d.builds.at(-1);
      return e === undefined ? null : `${BUILDINGS[e.building].name} ур. ${e.level}`;
    },
  },
  {
    id: 'home',
    of: (d) =>
      d.raids.length === 0 ? null : `унесено ${sum(d.raids.map((r) => r.carried))}`,
  },
];

/** Все шаблоны по порядку старшинства — правилам, чтобы мерить мёртвые. */
export const CHRON_ORDER: readonly ChronId[] = TEMPLATES.map((t) => t.id);

/**
 * Хроника по буферу телеметрии: не длиннее `limit` строк, свежие сверху.
 * Чистая функция от событий — те же события дают ту же хронику.
 */
export function chronicle(
  events: readonly TelemetryEvent[],
  limit: number = CHRON_LIMIT,
): Entry[] {
  const out: Entry[] = [];
  for (const day of daysOf(events).reverse()) {
    if (out.length >= limit) break;
    for (const { id, of } of TEMPLATES) {
      const value = of(day);
      if (value === null) continue;
      out.push({ day: day.day, id, text: CHRON_TEXT[id], value });
      break;
    }
  }
  return out;
}
