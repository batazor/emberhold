/**
 * Лавка торговца (§13.5) на общем экране обмена (`exchangePanel.ts`).
 * Открывается подходом во дворе замка; уходит игрок кнопкой «Уйти» или
 * ногами — сделка, не собранная до конца, не держится.
 *
 * Прежде лавка была строками готовых пар у нижней кромки; экран с кучками
 * выбран макетом: сделку собирает игрок, а курс держит та же линейка
 * ценности с наценкой отношений (`sim/trade.ts`). Лавка отдаёт экрану
 * только своё: прилавки (ваше — камень и дерево, его — железо), цену
 * и лицо. Сам обмен кучками — забота экрана, и он один на все обмены.
 */
import { GIVABLE, SELLABLE, askOf, dealsToParity, feeOf, worthOf } from '../sim/trade';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind, Resources } from '../sim/resources';
import type { CampState } from '../sim/camp';
import { ExchangePanel } from './exchangePanel';
import type { Piles } from './exchangePanel';
import { avatarSvg } from './avatar';

/** Сид лица торговца. Он один на игру, и лицо у него одно. */
export const TRADER_FACE = 41;

export interface TradePanelCallbacks {
  /** Игрок собрал сделку и нажал «Обменять». true — сделка прошла. */
  onDeal(give: Partial<Resources>, take: Partial<Resources>): boolean;
  /** «Уйти»: экран просит увести героя от прилавка. */
  onLeave(): void;
}

/** Кучки экрана — в ресурсы лагеря: id кучки и есть вид ресурса. */
export const pilesToResources = (piles: Piles): Partial<Resources> => {
  const out: Partial<Resources> = {};
  for (const [kind, n] of Object.entries(piles) as [ResourceKind, number][]) {
    if (n > 0) out[kind] = n;
  }
  return out;
};

export class TradePanel {
  private readonly screen: ExchangePanel;
  private camp: CampState | null = null;

  constructor(parent: HTMLElement, cb: TradePanelCallbacks) {
    this.screen = new ExchangePanel({
      parent,
      left: {
        title: 'Ваше',
        stock: () =>
          GIVABLE.map((kind) => ({
            id: kind,
            name: RESOURCE_NAME[kind],
            count: this.camp?.resources[kind] ?? 0,
          })),
      },
      right: {
        // Товар торговца не кончается: лимитирует курс, а не прилавок.
        title: 'Торговца',
        stock: () => SELLABLE.map((kind) => ({ id: kind, name: RESOURCE_NAME[kind], count: null })),
      },
      price: {
        worth: (give) => worthOf(pilesToResources(give)),
        ask: (take) => askOf(pilesToResources(take), this.camp?.trades ?? 0),
        note: () => {
          const deals = this.camp?.trades ?? 0;
          const fee = feeOf(deals);
          return fee > 0
            ? `Наценка ${Math.round(fee * 100)} на сто · до своей цены ${dealsToParity(deals)} сделок`
            : 'Своя цена: наценки нет';
        },
      },
      confirmLabel: 'Обменять',
      onConfirm: (give, take) => cb.onDeal(pilesToResources(give), pilesToResources(take)),
      onLeave: () => cb.onLeave(),
    });

    const face = document.createElement('div');
    face.className = 'face';
    face.innerHTML = avatarSvg('торговец', TRADER_FACE);
    const title = document.createElement('p');
    title.className = 'panel t';
    title.textContent = 'Торговец';
    this.screen.setHead(face, title);
  }

  setVisible(visible: boolean): void {
    this.screen.setVisible(visible);
  }

  get visible(): boolean {
    return this.screen.visible;
  }

  sync(camp: CampState): void {
    this.camp = camp;
    if (this.screen.visible) this.screen.sync();
  }

  /** Что дала сделка — одной строкой, для всплывающего события. */
  static gained(give: Partial<Resources>, take: Partial<Resources>): string {
    const side = (part: Partial<Resources>): string =>
      (Object.entries(part) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
    return `${side(take)} · отдано ${side(give)}`;
  }
}
