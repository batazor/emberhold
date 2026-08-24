/**
 * Обмен кучками — классический прилавок на отдельном экране: слева ваше,
 * справа его, под каждой стороной зона сделки. Карточка тянется пальцем
 * или мышью; тап делает то же, что перенос одной штуки, — тащить точнее,
 * но выбор жеста остаётся за рукой.
 *
 * Компонент один на все обмены и про деньги не знает. Цену подключает
 * вызывающий (`price`): лавка торговца считает ценность и наценку
 * (`sim/trade.ts`), обмен между жителями пойдёт без неё — те же зоны,
 * та же сделка, просто без торговли.
 *
 * Экран закрывает сцену целиком (выбор макетом), поэтому у него есть
 * «Уйти»: жест ухода, который у нижних панелей делает ходьба, здесь
 * делает кнопка.
 */

/** Кучка предмета на прилавке или в сделке. */
import { gameMessage, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

export interface ExchangeItem {
  readonly id: string;
  readonly name: string;
  /** null — счёта нет: у торговца товар не кончается. */
  readonly count: number | null;
  readonly icon?: string;
}

export interface ExchangeSide {
  readonly title: GameMessage;
  readonly stock: () => readonly ExchangeItem[];
}

/** Кучки сделки: id → сколько штук перенесено. */
export type Piles = Record<string, number>;

export interface ExchangePrice {
  /** Во что оценено собранное с правой стороны — с наценкой. */
  readonly ask: (take: Piles) => number;
  /** Во что оценено собранное с левой. */
  readonly worth: (give: Piles) => number;
  /** Строка отношений: наценка и путь к своей цене. */
  readonly note: () => string;
}

export interface ExchangeHooks {
  readonly parent: HTMLElement;
  readonly left: ExchangeSide;
  readonly right: ExchangeSide;
  /** null — обмен без торговли: сделку держит только непустота сторон. */
  readonly price: ExchangePrice | null;
  readonly confirmLabel: GameMessage;
  /** true — сделка прошла: зоны очищаются, прилавок пересчитывается. */
  readonly onConfirm: (give: Piles, take: Piles) => boolean;
  readonly onLeave: () => void;
}

interface Zone {
  readonly root: HTMLElement;
  readonly cards: HTMLElement;
}

export class ExchangePanel {
  private readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly stockL: Zone;
  private readonly stockR: Zone;
  private readonly dealL: Zone;
  private readonly dealR: Zone;
  private readonly balance: HTMLElement;
  private readonly note: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  /** Призрак перетаскивания — на body, чтобы не резаться экраном. */
  private ghost: HTMLElement | null = null;

  private give: Piles = {};
  private take: Piles = {};

  constructor(private readonly hooks: ExchangeHooks) {
    this.root = document.createElement('div');
    this.root.id = 'exchange';
    this.root.style.display = 'none';

    this.head = document.createElement('div');
    this.head.className = 'head';

    const zone = (title: GameMessage, kind: 'stock' | 'deal'): Zone => {
      const root = document.createElement('div');
      root.className = `zone ${kind}`;
      const label = document.createElement('b');
      setGameText(label, title);
      const cards = document.createElement('div');
      cards.className = 'cards';
      root.append(label, cards);
      return { root, cards };
    };

    this.stockL = zone(hooks.left.title, 'stock');
    this.stockR = zone(hooks.right.title, 'stock');
    this.dealL = zone(gameMessage('Отдаёте', 'You give'), 'deal');
    this.dealR = zone(gameMessage('Получаете', 'You receive'), 'deal');

    const cols = document.createElement('div');
    cols.className = 'cols';
    const colL = document.createElement('div');
    colL.className = 'col panel';
    colL.append(this.stockL.root, this.dealL.root);
    const colR = document.createElement('div');
    colR.className = 'col panel';
    colR.append(this.stockR.root, this.dealR.root);
    cols.append(colL, colR);

    this.balance = document.createElement('p');
    this.balance.className = 'bal';

    this.confirm = document.createElement('button');
    this.confirm.className = 'primary';
    setGameText(this.confirm, hooks.confirmLabel);
    this.confirm.addEventListener('click', () => {
      if (!this.hooks.onConfirm(this.give, this.take)) return;
      this.give = {};
      this.take = {};
      this.sync();
    });

    const leave = document.createElement('button');
    setGameText(leave, gameMessage('Уйти', 'Leave'));
    leave.addEventListener('click', () => hooks.onLeave());

    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.append(this.confirm, leave);

    this.note = document.createElement('p');
    this.note.className = 'rel';

    this.root.append(this.head, cols, this.balance, acts, this.note);
    hooks.parent.appendChild(this.root);
  }

  /** Шапке — лицо и имя визави: их даёт вызывающий, экран лиц не выбирает. */
  setHead(...children: (HTMLElement | string)[]): void {
    this.head.replaceChildren(...children);
  }

  setVisible(visible: boolean): void {
    if (!visible && this.visible) {
      // Уход — отмена: несостоявшаяся сделка кучки не держит.
      this.give = {};
      this.take = {};
    }
    this.root.style.display = visible ? 'flex' : 'none';
    if (visible) this.sync();
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Пересчёт: прилавки, зоны, баланс и кнопка. */
  sync(): void {
    const paint = (side: ExchangeSide, pile: Piles, stockZone: Zone, dealZone: Zone): void => {
      stockZone.cards.replaceChildren(
        ...side.stock().map((item) => {
          const inDeal = pile[item.id] ?? 0;
          const left = item.count === null ? null : item.count - inDeal;
          // Пустая кучка стоит серой, а не исчезает: пропавший товар
          // читался бы поломкой, а не концом запаса.
          return this.card(
            item.name,
            left,
            left !== null && left <= 0
              ? null
              : () => {
                  pile[item.id] = inDeal + 1;
                  this.sync();
                },
            item.icon,
          );
        }),
      );
      dealZone.cards.replaceChildren(
        ...Object.entries(pile)
          .filter(([, n]) => n > 0)
          .map(([id, n]) => {
            const item = side.stock().find((i) => i.id === id);
            const name = item?.name ?? id;
            // Жест обратный переносу: штука возвращается на прилавок.
            return this.card(name, n, () => {
              pile[id] = n - 1;
              if (pile[id] === 0) delete pile[id];
              this.sync();
            }, item?.icon);
          }),
      );
    };
    paint(this.hooks.left, this.give, this.stockL, this.dealL);
    paint(this.hooks.right, this.take, this.stockR, this.dealR);

    const price = this.hooks.price;
    const gave = Object.values(this.give).some((n) => n > 0);
    const took = Object.values(this.take).some((n) => n > 0);
    if (price === null) {
      this.balance.textContent = '';
      this.note.textContent = '';
      this.confirm.disabled = !gave && !took;
    } else {
      const worth = price.worth(this.give);
      const ask = price.ask(this.take);
      if (!took) setGameText(this.balance, gameMessage('Выберите товар на прилавке торговца', 'Choose an item from the trader’s counter'));
      else if (worth >= ask) {
        setGameText(this.balance, gameMessage('Ваше предложение: {worth} · цена торговца: {ask} · по рукам', 'Your offer: {worth} · trader’s price: {ask} · deal accepted'), { worth, ask });
      } else {
        setGameText(this.balance, gameMessage('Ваше предложение: {worth} · цена торговца: {ask} · не хватает {missing}', 'Your offer: {worth} · trader’s price: {ask} · short by {missing}'), { worth, ask, missing: ask - worth });
      }
      this.note.textContent = window.EmberholdLanguage?.translate(price.note()) ?? price.note();
      this.confirm.disabled = !took || worth < ask;
    }
  }

  /**
   * Карточка кучки. Нажал — призрак пошёл за пальцем, отпустил — штука
   * переехала; короткий тап делает тот же перенос без дороги. Сторона
   * у кучки одна и зона одна, поэтому куда тянули — неважно: жест
   * выбирает штуку, а не маршрут.
   */
  private card(name: string, count: number | null, move: (() => void) | null, icon?: string): HTMLElement {
    const card = document.createElement('button');
    card.className = 'pile';
    if (icon !== undefined) {
      const pic = document.createElement('img');
      pic.className = 'resource-pic';
      pic.src = icon;
      pic.alt = '';
      card.appendChild(pic);
    }
    card.append(count === null ? name : `${name} ×${count}`);
    if (move === null) {
      card.disabled = true;
      return card;
    }
    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = { x: e.clientX, y: e.clientY };
      let dragging = false;
      const onMove = (ev: PointerEvent): void => {
        if (!dragging && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 8) return;
        dragging = true;
        if (this.ghost === null) {
          this.ghost = document.createElement('div');
          this.ghost.className = 'chip drag-ghost';
          this.ghost.textContent = name;
          document.body.appendChild(this.ghost);
        }
        this.ghost.style.left = `${ev.clientX}px`;
        this.ghost.style.top = `${ev.clientY}px`;
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this.ghost?.remove();
        this.ghost = null;
        move();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return card;
  }
}
