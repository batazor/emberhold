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
import { GIVABLE, SELLABLE, askOf, dealsToParity, feeOf, onCounter, worthOf } from '../sim/trade';
import type { Stock } from '../sim/trade';
import type { ResourceKind, Resources } from '../sim/resources';
import type { CampState } from '../sim/camp';
import { ExchangePanel } from './exchangePanel';
import type { Piles } from './exchangePanel';
import { avatarSvg } from './avatar';
import { resourceIcon } from './resourceIcons';
import { resourceMessage } from '../i18n/gameData';
import { gameMessage, gameText, setGameText } from '../i18n/game';

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
  /** Прилавок торговца (§13.5): пища — сколько принесли местные, железо — без счёта. */
  private stock: Stock | null = null;

  constructor(parent: HTMLElement, cb: TradePanelCallbacks) {
    this.screen = new ExchangePanel({
      parent,
      left: {
        title: gameMessage('Ваше', 'Yours'),
        stock: () =>
          GIVABLE.map((kind) => {
            const icon = resourceIcon(kind);
            return {
              id: kind,
              name: gameText(resourceMessage[kind]),
              count: this.camp?.resources[kind] ?? 0,
              ...(icon === undefined ? {} : { icon }),
            };
          }),
      },
      right: {
        /**
         * Счёт стоит не на всём: железо у торговца не кончается (его никто
         * в мире для него не добывает, и всякий счёт был бы назначенным),
         * а пища — ровно та, что местные сняли с кустов этого места
         * за сутки (§13.8). `null` в карточке и значит «без счёта».
         */
        title: gameMessage('Торговца', "Trader's"),
        stock: () =>
          SELLABLE.map((kind) => {
            const left = onCounter(this.stock, kind);
            const icon = resourceIcon(kind);
            return {
              id: kind,
              name: gameText(resourceMessage[kind]),
              count: Number.isFinite(left) ? left : null,
              ...(icon === undefined ? {} : { icon }),
            };
          }),
      },
      price: {
        worth: (give) => worthOf(pilesToResources(give)),
        ask: (take) => askOf(pilesToResources(take), this.camp?.trades ?? 0),
        note: () => {
          const deals = this.camp?.trades ?? 0;
          const fee = feeOf(deals);
          return fee > 0
            ? gameText(gameMessage('Наценка {fee}% · сделок до честной цены: {deals}', '{fee}% markup · deals until fair price: {deals}'), {
                fee: Math.round(fee * 100), deals: dealsToParity(deals),
              })
            : gameText(gameMessage('Честная цена: без наценки', 'Fair price: no markup'));
        },
      },
      confirmLabel: gameMessage('Обменять', 'Trade'),
      onConfirm: (give, take) => cb.onDeal(pilesToResources(give), pilesToResources(take)),
      onLeave: () => cb.onLeave(),
    });

    const face = document.createElement('div');
    face.className = 'face';
    face.innerHTML = avatarSvg('торговец', TRADER_FACE);
    const title = document.createElement('p');
    title.className = 'panel t';
    setGameText(title, gameMessage('Торговец', 'Trader'));
    this.screen.setHead(face, title);
  }

  setVisible(visible: boolean): void {
    this.screen.setVisible(visible);
  }

  get visible(): boolean {
    return this.screen.visible;
  }

  sync(camp: CampState, stock: Stock | null = null): void {
    this.camp = camp;
    this.stock = stock;
    if (this.screen.visible) this.screen.sync();
  }

  /** Что дала сделка — одной строкой, для всплывающего события. */
  static gained(give: Partial<Resources>, take: Partial<Resources>): string {
    const side = (part: Partial<Resources>): string =>
      (Object.entries(part) as [ResourceKind, number][])
        .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${amount}`)
        .join(' · ');
    return gameText(gameMessage('{received} · вы отдали {given}', '{received} · you gave {given}'), {
      received: side(take), given: side(give),
    });
  }
}
