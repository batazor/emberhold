import { formatDuration } from '../core/clock';
import {
  CLAIM_REASON,
  GIFT_ARROWS,
  WEEK,
  claimBlock,
  dayOf,
  emptyDaily,
  giftAt,
  giftLoot,
  giftTier,
  guestSeed,
  rookie,
  weekAt,
  weekOf,
} from '../sim/daily';
import type { DailyGift } from '../sim/daily';
import { CHEST_BONUS, chestSpot, overflowOf } from '../sim/chests';
import { campOrigin } from '../sim/camp';
import { generateSettler } from '../sim/settler';
import { DAY_SEC, dayAt } from '../sim/world';
import { RESOURCE_NAME } from '../sim/resources';
import type { CampState } from '../sim/camp';
import type { ResourceKind } from '../sim/resources';
import { avatarSvg } from './avatar';

/**
 * Подарок за вход (§29.4): значок над сценой и семь карточек в листе.
 *
 * **Значок отдельно от листа, и это не украшение.** Механика, ради которой
 * игру открывают, обязана быть видна с первого кадра лагеря — иначе она
 * живёт внутри меню, в которое заходят те, кто и так вернулся. Поэтому
 * значок стоит поверх сцены постоянно, а лист выезжает по тапу, как всякий
 * другой раздел лагеря.
 *
 * **Значок молчит, когда брать нечего.** Точка на нём — не украшение
 * и не счётчик: она значит ровно «сегодня не брали». Значок, который зовёт
 * всегда, перестаёт звать вовсе — это тот же довод, по которому строка
 * задания гаснет вместе с заданием (`campHud.syncTask`).
 *
 * **Карточка показывает вещь, а не слово о вещи.** Бревно, валун, слиток
 * и сундук приходят картинкой из той же запечённой геометрии, которой набран
 * лагерь (`render/giftIcon.ts`), а седьмой день первой недели показывает
 * лицо — то самое, которое придёт к костру (§29.2). Слой рендера панелям
 * не виден (`scripts/arch.ts`), поэтому картинка приходит снаружи, как
 * значок вещи в Мастерской.
 *
 * Словарь §6.2 не расширяется: лист — `.panel` листа лагеря, дни — `.card`,
 * номер дня — `.badge`, круг лица — `.face`, кнопка — `.cta`. Своего здесь
 * только раскладка семи карточек и место значка.
 */
export type GiftPic = 'дерево' | 'камень' | 'железо' | 'сундук' | 'стрелы';

export interface DailyCallbacks {
  /** Забрать сегодняшний подарок. Всё, что панель умеет делать. */
  onClaim(): void;
  /** Тап по значку: лист открывается или закрывается. */
  onIcon(): void;
  /** Картинка вещи как `data:`-URL. Пустая строка — значка не будет. */
  giftIcon(name: GiftPic): string;
}

/** Какой моделью показывается ресурс. Кристалла подарок не даёт (§29.1). */
const PIC_OF: Partial<Record<ResourceKind, GiftPic>> = {
  wood: 'дерево',
  stone: 'камень',
  iron: 'железо',
};

/**
 * Заголовок и подпись карточки.
 *
 * У ресурсного дня заголовком стоит сама кучка, а подписи нет вовсе:
 * «Камень и дерево» над строкой «Камень 4 · Дерево 4» — это одно и то же
 * слово дважды, и на телефоне оно съедало три строки из четырёх. Название
 * дня при этом не потеряно: кучка его и называет, только с числами.
 *
 * У вещей наоборот: «Сундук» — это вещь, а «Кладовая +30» — то, что она
 * делает, и второе из первого не выводится.
 */
function giftText(gift: DailyGift, camp: CampState, taken: number): { title: string; line: string } {
  switch (gift.id) {
    case 'ресурсы': {
      const loot = giftLoot(gift, giftTier(camp.levels.kitchen), taken);
      const title = (Object.entries(loot) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
      return { title, line: '' };
    }
    case 'сундук':
      return { title: gift.title, line: `Кладовая +${CHEST_BONUS}` };
    case 'стрелы':
      return { title: gift.title, line: `Стрелы ${GIFT_ARROWS}` };
    case 'встреча':
      return { title: gift.title, line: 'Ему нужна крыша' };
  }
}

/**
 * Чем показывается день. У ресурсного — вещь самого крупного вида в кучке:
 * две картинки на карточке шириной в четверть листа читались бы шумом,
 * а не парой.
 */
function picOf(gift: DailyGift, camp: CampState, taken: number): GiftPic | null {
  switch (gift.id) {
    case 'ресурсы': {
      const loot = giftLoot(gift, giftTier(camp.levels.kitchen), taken);
      const top = (Object.entries(loot) as [ResourceKind, number][])
        .sort((a, b) => b[1] - a[1])[0];
      return top === undefined ? null : PIC_OF[top[0]] ?? null;
    }
    case 'сундук':
      return 'сундук';
    case 'стрелы':
      return 'стрелы';
    case 'встреча':
      // Лицо рисуется своим приёмом: человек — не вещь из набора.
      return null;
  }
}

/**
 * Чем сегодняшний подарок обернётся потерей — до нажатия, а не после.
 *
 * Раньше об этом узнавали строкой полосы, когда кучка уже пропала в полной
 * кладовой: игра называла цену задним числом, то есть не называла вовсе.
 * Считает потерю тот же счёт, которым её делает `stash` (`overflowOf`),
 * и совпадение сторожит `chests.rules.ts`.
 *
 * Кнопку это не запирает. Полная кладовая — не отказ: игрок вправе взять
 * подарок и потерять часть, а вот не знать об этом заранее не вправе.
 */
function giftWarn(camp: CampState, taken: number): string | null {
  const gift = giftAt(taken);
  if (gift.id === 'сундук') {
    return chestSpot(camp) === null ? 'Сундук некуда поставить — площадка занята' : null;
  }
  if (gift.kinds.length === 0) return null;
  const loot = giftLoot(gift, giftTier(camp.levels.kitchen), taken);
  const lost = overflowOf(camp, loot);
  if (lost === 0) return null;
  const asked = (Object.values(loot) as number[]).reduce((sum, n) => sum + n, 0);
  return lost >= asked
    ? 'Кладовая полна — из подарка не влезет ничего'
    : `Кладовая почти полна — из ${asked} влезет ${asked - lost}`;
}

export class DailyPanel {
  /** Раздел листа лагеря. Живёт внутри `campHud`, как карта региона. */
  readonly root: HTMLElement;
  /** Значок поверх сцены. Его показ и место — забота лагеря. */
  readonly icon: HTMLButtonElement;

  private readonly mark: HTMLElement;
  private readonly week: HTMLElement;
  private readonly weekName: HTMLElement;
  private readonly weekCount: HTMLElement;
  private readonly days: HTMLElement;
  private readonly note: HTMLElement;
  private readonly take: HTMLButtonElement;
  private readonly cards: {
    box: HTMLElement;
    pic: HTMLElement;
    title: HTMLElement;
    line: HTMLElement;
    badge: HTMLElement;
  }[] = [];

  constructor(private readonly cb: DailyCallbacks) {
    this.icon = document.createElement('button');
    this.icon.className = 'chip gift-icon';
    this.icon.setAttribute('aria-label', 'Подарок за вход');
    // Значок над сценой — тот же сундук, что стоит в лагере: игрок узнаёт
    // вещь раньше, чем прочтёт подпись, а подписи у значка нет вовсе.
    const pic = document.createElement('img');
    pic.alt = '';
    pic.src = this.cb.giftIcon('сундук');
    this.mark = document.createElement('i');
    this.mark.className = 'gift-mark';
    this.icon.append(pic, this.mark);
    this.icon.addEventListener('click', () => this.cb.onIcon());

    this.root = document.createElement('div');
    this.root.className = 'sec gift';

    this.week = document.createElement('div');
    this.week.className = 'row';
    const weekName = document.createElement('span');
    weekName.className = 'gift-week';
    this.weekCount = document.createElement('b');
    this.week.append(weekName, this.weekCount);
    this.weekName = weekName;


    this.days = document.createElement('div');
    this.days.className = 'gift-days';
    for (let day = 0; day < WEEK; day++) {
      const box = document.createElement('div');
      // Седьмой день шире прочих: неделя обязана читаться подъёмом к концу,
      // а не семью одинаковыми клетками. Ряд от этого сходится ровно —
      // четыре карточки в первом, две и двойная во втором.
      box.className = day === WEEK - 1 ? 'card gift-day gift-last' : 'card gift-day';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `День ${day + 1}`;
      const pic2 = document.createElement('div');
      pic2.className = 'gift-pic';
      const title = document.createElement('b');
      const line = document.createElement('span');
      line.className = 'dim gift-what';
      const col = document.createElement('div');
      col.className = 'gift-col';
      col.append(title, line);
      const body = document.createElement('div');
      body.className = 'gift-body';
      body.append(pic2, col);
      box.append(badge, body);
      this.days.appendChild(box);
      this.cards.push({ box, pic: pic2, title, line, badge });
    }

    this.note = document.createElement('div');
    this.note.className = 'dim gift-note';

    this.take = document.createElement('button');
    this.take.className = 'cta';
    this.take.textContent = 'Забрать';
    this.take.addEventListener('click', () => this.cb.onClaim());

    this.root.append(this.week, this.days, this.note, this.take);
  }

  /**
   * Перекрасить. Зовётся из общего `sync` лагеря, а не по своему таймеру:
   * день меняется серверными часами (§27), и панель обязана узнавать об этом
   * оттуда же, откуда узнают стройка и лечение.
   */
  sync(camp: CampState, now: number): void {
    const day = dayAt(now);
    const state = camp.daily ?? emptyDaily();
    const week = weekAt(state.taken);
    const first = rookie(state.taken);
    const today = dayOf(state.taken);
    const free = claimBlock(state, day) === 'ok';

    this.mark.style.display = free ? '' : 'none';
    this.icon.classList.toggle('ready', free);

    this.weekName.textContent = first ? 'Первая неделя' : `Неделя ${weekOf(state.taken)}`;
    this.weekCount.textContent = first ? 'даётся один раз' : 'круг повторяется';

    week.forEach((gift, at) => {
      const card = this.cards[at]!;
      const taken = state.taken - today + at;
      const text = giftText(gift, camp, taken);
      card.title.textContent = text.title;
      card.line.textContent = text.line;
      this.paintPic(card.pic, gift, camp, taken);
      // Три состояния и ни одного лишнего: взято, следующий, впереди.
      // Взятое гасится, а не вычёркивается: вычеркнутое читается потерей.
      //
      // Счёт подарков указывает на **следующий**, а не на последний взятый,
      // и первая сборка на этом ошиблась: сразу после подарка карточка
      // назавтра красилась «взято» — то есть игра показывала отданным то,
      // чего ещё не давала.
      const done = at < today;
      const next = at === today;
      card.box.classList.toggle('on', next && free);
      card.box.classList.toggle('gift-done', done);
      card.badge.textContent = done
        ? 'взято'
        : next
          ? free
            ? 'сегодня'
            : 'завтра'
          : `День ${at + 1}`;
    });

    this.take.disabled = !free;
    // Взявшему называется срок, а не запрет: «приходите завтра» без числа —
    // это отказ, а число — это уже свидание. Считается оно теми же часами,
    // которыми считается сам день (§27).
    const warn = free ? giftWarn(camp, state.taken) : null;
    this.note.textContent =
      warn ??
      (free
        ? 'Подарок сегодняшнего дня ждёт в лагере'
        : `${CLAIM_REASON.today}, через ${formatDuration((day + 1) * DAY_SEC - now)}`);
    // Предупреждение красится как предупреждение: строка о потере, набранная
    // тем же серым, что и «ждёт в лагере», сообщает ровно ничего.
    this.note.classList.toggle('warn', warn !== null);
    this.note.classList.toggle('dim', warn === null);
  }

  /**
   * Откуда вылетает подарок (§29.4). Картинка сегодняшнего дня, а если лист
   * закрыт — сам значок: лететь неоткуда не бывает, иначе подарок появляется
   * в полосе ресурсов из ниоткуда.
   */
  origin(camp: CampState): { rect: DOMRect; url: string } {
    const today = dayOf((camp.daily ?? emptyDaily()).taken);
    const card = this.cards[today];
    const box = card !== undefined && card.pic.offsetParent !== null ? card.pic : this.icon;
    const img = box.querySelector('img');
    return { rect: box.getBoundingClientRect(), url: img?.src ?? '' };
  }

  /**
   * Картинка дня. У встречи это лицо гостя — то самое, которое придёт
   * к костру: сид считает `sim/daily.ts`, и панель со сценой берут его
   * из одного места (§29.2).
   */
  private paintPic(box: HTMLElement, gift: DailyGift, camp: CampState, taken: number): void {
    if (gift.id === 'встреча') {
      const guest = generateSettler(guestSeed(campOrigin(camp), camp.residents.length));
      box.className = 'gift-pic face';
      box.innerHTML = avatarSvg(guest.look, guest.seed);
      return;
    }
    const name = picOf(gift, camp, taken);
    box.className = 'gift-pic';
    box.innerHTML = '';
    if (name === null) return;
    const url = this.cb.giftIcon(name);
    if (url === '') return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    box.appendChild(img);
  }
}
