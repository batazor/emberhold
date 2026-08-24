import type { CampState } from '../sim/camp';
import {
  FARM_CROPS,
  farmReturnActionUnlocked,
  farmStatus,
} from '../sim/farm';
import type { FarmCropId } from '../sim/farm';
import { FARM_CARE_BONUS, farmCareHelpers } from '../sim/farmResidents';
import { clanBuilderIds } from '../sim/clan';
import { gameDuration, gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

interface FarmCropPickerCallbacks {
  onSelect(crop: FarmCropId): void;
  onReturn(): void;
}

interface CropCardText {
  readonly name: GameMessage;
  readonly badge: GameMessage;
  readonly copy: GameMessage;
  readonly alt: GameMessage;
  readonly aria: GameMessage;
}

export const FARM_CROP_TEXT: Readonly<Record<FarmCropId, CropCardText>> = {
  turnip: {
    name: gameMessage('Репа', 'Turnip'),
    badge: gameMessage('Быстро', 'Quick'),
    copy: gameMessage('Урожай к скорому возвращению', 'Ready by your next return'),
    alt: gameMessage('Спелая репа на рассветном огороде', 'Ripe turnips in a garden at dawn'),
    aria: gameMessage('Репа: {time}, {seed} → {harvest} ед. пищи, прибыль +{net}', 'Turnip: {time}, {seed} → {harvest} food, net +{net}'),
  },
  barley: {
    name: gameMessage('Ячмень', 'Barley'),
    badge: gameMessage('Урожайно', 'High yield'),
    copy: gameMessage('Больше пищи с каждой грядки', 'More food from every planting'),
    alt: gameMessage('Золотой ячмень на рассветном огороде', 'Golden barley in a garden at dawn'),
    aria: gameMessage('Ячмень: {time}, {seed} → {harvest} ед. пищи, прибыль +{net}', 'Barley: {time}, {seed} → {harvest} food, net +{net}'),
  },
};

const CROP_ART: Readonly<Record<FarmCropId, string>> = {
  turnip: '/assets/farm/crops/turnip-card.webp',
  barley: '/assets/farm/crops/barley-card.webp',
};

interface CropCardNodes {
  readonly button: HTMLButtonElement;
  readonly image: HTMLImageElement;
  readonly badge: HTMLElement;
  readonly name: HTMLElement;
  readonly copy: HTMLElement;
  readonly time: HTMLElement;
  readonly yield: HTMLElement;
  readonly net: HTMLElement;
}

/** Выбор следующего посева: изображения дают характер, цифры держит симуляция. */
export class FarmCropPicker {
  private readonly root: HTMLElement;
  private readonly cards = new Map<FarmCropId, CropCardNodes>();
  private readonly helpers: HTMLElement;
  private readonly helperCopy: HTMLElement;
  private readonly returnAction: HTMLButtonElement;
  private camp: CampState | null = null;
  private sceneVisible = false;
  private now = 0;

  constructor(parent: HTMLElement, cb: FarmCropPickerCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'farm-crops';
    this.root.className = 'panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'farm-crops-title');

    const head = document.createElement('header');
    head.className = 'row';
    const title = document.createElement('h2');
    title.id = 'farm-crops-title';
    setGameText(title, gameMessage('Что посеять', 'Choose a crop'));
    const hint = document.createElement('p');
    setGameText(hint, gameMessage('Выберите культуру, затем коснитесь свободной грядки', 'Choose a crop, then touch an open garden bed'));
    head.append(title, hint);

    const list = document.createElement('div');
    list.className = 'fc-list';
    for (const crop of ['turnip', 'barley'] as const) {
      const button = document.createElement('button');
      button.className = `card fc-card ${crop}`;
      button.type = 'button';

      const media = document.createElement('span');
      media.className = 'fc-media';
      const image = document.createElement('img');
      image.src = CROP_ART[crop];
      image.decoding = 'async';
      const badge = document.createElement('span');
      badge.className = 'fc-badge badge';
      media.append(image, badge);

      const body = document.createElement('span');
      body.className = 'fc-body';
      const name = document.createElement('b');
      const copy = document.createElement('small');
      const stats = document.createElement('span');
      stats.className = 'fc-stats';
      const time = document.createElement('span');
      time.className = 'chip';
      const cropYield = document.createElement('span');
      cropYield.className = 'chip';
      const net = document.createElement('span');
      net.className = 'chip';
      stats.append(time, cropYield, net);
      body.append(name, copy, stats);
      button.append(media, body);
      button.addEventListener('click', () => cb.onSelect(crop));
      list.appendChild(button);
      this.cards.set(crop, { button, image, badge, name, copy, time, yield: cropYield, net });
    }

    this.helpers = document.createElement('div');
    this.helpers.className = 'fc-helpers row mid';
    const helperLabel = document.createElement('b');
    setGameText(helperLabel, gameMessage('Жители', 'Residents'));
    this.helperCopy = document.createElement('span');
    this.helpers.append(helperLabel, this.helperCopy);
    const footer = document.createElement('div');
    footer.className = 'fc-footer';
    this.returnAction = document.createElement('button');
    this.returnAction.className = 'fc-return';
    this.returnAction.type = 'button';
    this.returnAction.addEventListener('click', () => cb.onReturn());
    footer.append(this.helpers, this.returnAction);
    this.root.append(head, list, footer);
    parent.appendChild(this.root);
    this.paintStatic();
  }

  setVisible(visible: boolean): void {
    this.sceneVisible = visible;
    this.paint();
  }

  sync(camp: CampState, now: number): void {
    this.camp = camp;
    this.now = now;
    this.paint();
  }

  private paintStatic(): void {
    for (const crop of ['turnip', 'barley'] as const) {
      const nodes = this.cards.get(crop);
      if (nodes === undefined) continue;
      const text = FARM_CROP_TEXT[crop];
      const balance = FARM_CROPS[crop];
      setGameAttribute(nodes.image, 'alt', text.alt);
      setGameText(nodes.badge, text.badge);
      setGameText(nodes.name, text.name);
      setGameText(nodes.copy, text.copy);
      setGameText(nodes.time, gameMessage('{time}', '{time}'), { time: gameDuration(balance.growSeconds) });
      setGameText(nodes.yield, gameMessage('{seed} → {harvest} ед. пищи', '{seed} → {harvest} food'), {
        seed: balance.seedFood,
        harvest: balance.harvestFood,
      });
      setGameText(nodes.net, gameMessage('прибыль +{net}', 'net +{net}'), {
        net: balance.harvestFood - balance.seedFood,
      });
    }
  }

  private paint(): void {
    const farm = this.camp?.farm;
    const shown = this.sceneVisible && farm?.unlocked === true;
    this.root.hidden = !shown;
    if (!shown || farm === undefined) return;
    for (const [crop, nodes] of this.cards) {
      const selected = farm.selectedCrop === crop;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.setAttribute('aria-pressed', String(selected));
      const balance = FARM_CROPS[crop];
      setGameAttribute(nodes.button, 'aria-label', FARM_CROP_TEXT[crop].aria, {
        time: gameDuration(balance.growSeconds),
        seed: balance.seedFood,
        harvest: balance.harvestFood,
        net: balance.harvestFood - balance.seedFood,
      });
    }
    const helpers = farmCareHelpers(this.camp!, clanBuilderIds(this.camp!));
    const assigned = this.camp!.residents.some((resident) => resident.answer === 'кормим');
    if (helpers.length > 0) {
      const names = helpers
        .map((helper) => window.EmberholdLanguage?.translate(helper.name) ?? helper.name)
        .join(', ');
      setGameText(this.helperCopy, gameMessage('Помогают: {names} · по грядке · +{food} ед. пищи', 'Helping: {names} · one bed each · +{food} food'), {
        names,
        food: FARM_CARE_BONUS,
      });
    } else if (assigned) {
      setGameText(this.helperCopy, gameMessage('Назначенный помощник сейчас недоступен', 'The assigned helper is currently unavailable'));
    } else {
      setGameText(this.helperCopy, gameMessage('Назначьте жителю «Добывать пищу» — он поможет с урожаем', 'Assign “Gather food” to a resident for help with the harvest'));
    }
    const status = farmStatus(farm, this.now);
    const returnUnlocked = farmReturnActionUnlocked(farm);
    this.returnAction.hidden = !returnUnlocked;
    this.returnAction.disabled = status.ready === 0;
    if (status.ready > 0) {
      setGameText(this.returnAction, gameMessage('Собрать и засеять снова · {count}', 'Harvest and replant · {count}'), {
        count: status.ready,
      });
    } else {
      setGameText(this.returnAction, gameMessage('Собрать и засеять снова', 'Harvest and replant'));
    }
  }
}
