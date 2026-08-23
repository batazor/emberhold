import {
  CLAIM_REASON,
  GIFT_ARROWS,
  WEEK,
  claimBlock,
  dayOf,
  emptyDaily,
  giftLoot,
  giftTier,
  rookie,
  weekAt,
  weekOf,
} from '../sim/daily';
import type { DailyGift } from '../sim/daily';
import { CHEST_BONUS } from '../sim/chests';
import { RESOURCE_NAME } from '../sim/resources';
import type { CampState } from '../sim/camp';
import type { ResourceKind } from '../sim/resources';

/**
 * Подарок за вход (§29): значок над сценой и семь карточек в листе.
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
 * Словарь §6.2 не расширяется: лист — `.panel` листа лагеря, дни — `.card`,
 * номер дня — `.badge`, силуэт — `.glyph`, кнопка — `.cta`. Своего здесь
 * только раскладка семи карточек и место значка.
 */
export interface DailyCallbacks {
  /** Забрать сегодняшний подарок. Всё, что панель умеет делать. */
  onClaim(): void;
  /** Тап по значку: лист открывается или закрывается. */
  onIcon(): void;
}

/**
 * Силуэт сундука. Тот же приём, что у карточек стройки (`buildPanel`):
 * заливка без обводки, цвет — от кнопки. Рисованных значков в игре нет
 * (§6.1), а гонять ради одной картинки запечённую геометрию, как это делает
 * `gearIcon`, здесь не за чем: подарок — это не вещь из набора, и обещать
 * сундук моделью значило бы обещать конкретную вещь в конкретный день.
 */
const CHEST_GLYPH =
  '<path d="M3 9.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2V11H3V9.5Z"/>' +
  '<path d="M3 12.5h7V15h4v-2.5h7V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6.5Z"/>' +
  '<path d="M10.5 8h3v5h-3V8Z"/>';

/** Что написано на карточке дня под заголовком. */
function giftLine(gift: DailyGift, camp: CampState, taken: number): string {
  switch (gift.id) {
    case 'ресурсы': {
      const loot = giftLoot(gift, giftTier(camp.levels.kitchen), taken);
      return (Object.entries(loot) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
    }
    case 'сундук':
      return `Кладовая +${CHEST_BONUS}`;
    case 'стрелы':
      return `Стрелы ${GIFT_ARROWS}`;
    case 'встреча':
      return 'Человек к костру';
  }
}

export class DailyPanel {
  /** Раздел листа лагеря. Живёт внутри `campHud`, как карта региона. */
  readonly root: HTMLElement;
  /** Значок поверх сцены. Его показ и место — забота лагеря. */
  readonly icon: HTMLButtonElement;

  private readonly mark: HTMLElement;
  private readonly week: HTMLElement;
  private readonly days: HTMLElement;
  private readonly note: HTMLElement;
  private readonly take: HTMLButtonElement;
  private readonly cards: {
    box: HTMLElement;
    title: HTMLElement;
    line: HTMLElement;
    badge: HTMLElement;
  }[] = [];

  constructor(private readonly cb: DailyCallbacks) {
    this.icon = document.createElement('button');
    this.icon.className = 'chip gift-icon';
    this.icon.setAttribute('aria-label', 'Подарок за вход');
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'glyph');
    glyph.setAttribute('viewBox', '0 0 24 24');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = CHEST_GLYPH;
    this.mark = document.createElement('i');
    this.mark.className = 'gift-mark';
    this.icon.append(glyph, this.mark);
    this.icon.addEventListener('click', () => this.cb.onIcon());

    this.root = document.createElement('div');
    this.root.className = 'sec gift';

    this.week = document.createElement('div');
    this.week.className = 'row';

    this.days = document.createElement('div');
    this.days.className = 'gift-days';
    for (let day = 0; day < WEEK; day++) {
      const box = document.createElement('div');
      box.className = 'card gift-day';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `День ${day + 1}`;
      const title = document.createElement('b');
      const line = document.createElement('span');
      line.className = 'dim gift-what';
      box.append(badge, title, line);
      this.days.appendChild(box);
      this.cards.push({ box, title, line, badge });
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
  sync(camp: CampState, day: number): void {
    const state = camp.daily ?? emptyDaily();
    const week = weekAt(state.taken);
    const first = rookie(state.taken);
    const today = dayOf(state.taken);
    const free = claimBlock(state, day) === 'ok';

    this.mark.style.display = free ? '' : 'none';
    this.icon.classList.toggle('ready', free);

    this.week.innerHTML =
      `<span>${first ? 'Первая неделя' : `Неделя ${weekOf(state.taken)}`}</span>` +
      `<b>${first ? 'даётся один раз' : 'круг повторяется'}</b>`;

    week.forEach((gift, day2) => {
      const card = this.cards[day2]!;
      card.title.textContent = gift.title;
      card.line.textContent = giftLine(gift, camp, state.taken - today + day2);
      // Три состояния и ни одного лишнего: взято, следующий, впереди.
      // Взятое гасится, а не вычёркивается: вычеркнутое читается потерей.
      //
      // Счёт подарков указывает на **следующий**, а не на последний взятый,
      // и первая сборка на этом ошиблась: сразу после подарка карточка
      // назавтра красилась «взято» — то есть игра показывала отданным то,
      // чего ещё не давала.
      const done = day2 < today;
      const next = day2 === today;
      card.box.classList.toggle('on', next && free);
      card.box.classList.toggle('gift-done', done);
      card.badge.textContent = done
        ? 'взято'
        : next
          ? free
            ? 'сегодня'
            : 'завтра'
          : `День ${day2 + 1}`;
    });

    this.take.disabled = !free;
    this.note.textContent = free
      ? 'Подарок сегодняшнего дня ждёт в лагере.'
      : CLAIM_REASON.today;
  }
}
