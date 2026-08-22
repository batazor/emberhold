/**
 * Лавка торговца (§13.5). Открывается подходом во дворе замка и закрывается
 * уходом — как надпись на камне кладбища, тем же жестом.
 *
 * **Строки, а не магазин.** Решение целиком взято у §21, где раздел припасов
 * сделан строкой в листе лагеря: «Отдельный экран превратил бы лагерь
 * в витрину, а туда возвращаются смотреть на выросшие постройки». Здесь то же
 * и по той же причине: замок — это постройка, по которой ходят, и отдельный
 * экран поверх неё отменил бы прогулку, ради которой во двор и шли.
 *
 * Ни вкладок, ни валюты-посредника, ни кнопки «закрыть»: игрок отходит,
 * и лавка гаснет сама.
 */
import { OFFER_ORDER, PARITY, dealsToParity, feeOf, offerOf, tradeBlock } from '../sim/trade';
import type { OfferId } from '../sim/trade';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind } from '../sim/resources';
import type { CampState } from '../sim/camp';
import { avatarSvg } from './avatar';

/** Сид лица торговца. Он один на игру, и лицо у него одно. */
export const TRADER_FACE = 41;

export interface TradePanelCallbacks {
  /** Игрок нажал строку обмена. */
  onTrade(id: OfferId): void;
}

interface Row {
  readonly button: HTMLButtonElement;
  readonly note: HTMLElement;
}

export class TradePanel {
  private readonly root: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly rows = new Map<OfferId, Row>();

  constructor(parent: HTMLElement, cb: TradePanelCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'trade';
    this.root.style.display = 'none';

    // Лицо торговца (`ui/avatar.ts`) — то же, что у него в веере и во дворе.
    // Сид у него один на всю игру: торговец в замке один, и меняться лицом
    // между заходами ему не с кем.
    const face = document.createElement('div');
    face.className = 'face';
    face.innerHTML = avatarSvg('торговец', TRADER_FACE);

    const title = document.createElement('p');
    title.className = 'panel t';
    title.textContent = 'Торговец';

    // Классический прилавок: ваше — слева, его — справа. Слева только счёт,
    // никаких кнопок: продаёт торговец, а не игрок, и обратного курса нет.
    const cols = document.createElement('div');
    cols.className = 'cols panel';
    const mine = document.createElement('div');
    mine.className = 'col';
    const mineTitle = document.createElement('b');
    mineTitle.textContent = 'Ваше';
    this.wallet = document.createElement('div');
    mine.append(mineTitle, this.wallet);

    const his = document.createElement('div');
    his.className = 'col';
    const hisTitle = document.createElement('b');
    hisTitle.textContent = 'Торговца';
    his.append(hisTitle);
    for (const id of OFFER_ORDER) {
      const box = document.createElement('div');
      box.className = 'row tight';
      const button = document.createElement('button');
      button.addEventListener('click', () => cb.onTrade(id));
      const note = document.createElement('span');
      note.className = 'why';
      box.append(button, note);
      his.append(box);
      this.rows.set(id, { button, note });
    }
    cols.append(mine, his);

    // Отношения — сделками: наценка видна числом и тает на глазах.
    this.relation = document.createElement('p');
    this.relation.className = 'panel rel';

    this.root.append(face, title, cols, this.relation);
    parent.appendChild(this.root);
  }

  private relation!: HTMLElement;

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Пересчёт под кошелёк. Курс называется словами с обеих сторон — «Камень 8 →
   * Железо 1», — а не значками: значков в игре нет ни одного, кроме шестерни
   * настроек (§6.1).
   *
   * Отказ говорит причиной, а не серой кнопкой: то же правило, что у построек
   * (§20.3) и у мест под здание в прологе.
   */
  sync(camp: CampState): void {
    const deals = camp.trades ?? 0;
    this.wallet.replaceChildren(
      ...(['stone', 'wood', 'iron'] as ResourceKind[]).map((kind) => {
        const line = document.createElement('div');
        line.textContent = `${RESOURCE_NAME[kind]} ${camp.resources[kind]}`;
        return line;
      }),
    );

    for (const id of OFFER_ORDER) {
      const row = this.rows.get(id);
      if (row === undefined) continue;
      const offer = offerOf(id, deals);
      const side = (part: Partial<Record<ResourceKind, number>>): string =>
        (Object.entries(part) as [ResourceKind, number][])
          .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
          .join(' · ');
      row.button.textContent = `${side(offer.take)} · за ${side(offer.give)}`;
      const block = tradeBlock(camp, id);
      row.button.disabled = block !== 'ok';
      row.note.textContent = block === 'ok' ? '' : 'не хватает';
    }

    const fee = feeOf(deals);
    this.relation.textContent = fee > 0
      ? `Наценка ${Math.round(fee * 100)} на сто · до своей цены ${dealsToParity(deals)} сделок`
      : 'Своя цена: наценки нет';
  }

  /** Что даёт обмен — одной строкой, для всплывающего события. */
  static gained(id: OfferId, deals: number): string {
    const offer = offerOf(id, deals);
    const side = (part: Partial<Record<ResourceKind, number>>): string =>
      (Object.entries(part) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
    return `${side(offer.take)} · отдано ${side(offer.give)}`;
  }

  static has(id: string): id is OfferId {
    return id in PARITY;
  }
}
