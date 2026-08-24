import { formatDuration } from '../core/clock';
import type { CampState } from '../sim/camp';
import {
  FARM_CROPS,
  farmReturnActionUnlocked,
  farmStatus,
} from '../sim/farm';
import type { FarmCropId } from '../sim/farm';
import { FARM_CARE_BONUS, farmCareHelpers } from '../sim/farmResidents';
import { clanBuilderIds } from '../sim/clan';

interface FarmCropPickerCallbacks {
  onSelect(crop: FarmCropId): void;
  onReturn(): void;
}

interface CropCardText {
  readonly name: string;
  readonly badge: string;
  readonly copy: string;
  readonly alt: string;
}

export const FARM_CROP_TEXT: Readonly<Record<FarmCropId, CropCardText>> = {
  turnip: {
    name: 'Репа',
    badge: 'Быстро',
    copy: 'Пища к ближайшему возвращению',
    alt: 'Спелая репа на рассветном огороде',
  },
  barley: {
    name: 'Ячмень',
    badge: 'Выгодно',
    copy: 'Больше пищи за один посев',
    alt: 'Золотой ячмень на рассветном огороде',
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
    title.textContent = 'Что посеять';
    const hint = document.createElement('p');
    hint.textContent = 'Выберите культуру, затем коснитесь свободной грядки';
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
    helperLabel.textContent = 'Жители';
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
      nodes.image.alt = text.alt;
      nodes.badge.textContent = text.badge;
      nodes.name.textContent = text.name;
      nodes.copy.textContent = text.copy;
      nodes.time.textContent = formatDuration(balance.growSeconds);
      nodes.yield.textContent = `${balance.seedFood} → ${balance.harvestFood} пищи`;
      nodes.net.textContent = `чистыми +${balance.harvestFood - balance.seedFood}`;
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
      nodes.button.setAttribute(
        'aria-label',
        `${FARM_CROP_TEXT[crop].name}: ${nodes.time.textContent}, ${nodes.yield.textContent}, ${nodes.net.textContent}`,
      );
    }
    const helpers = farmCareHelpers(this.camp!, clanBuilderIds(this.camp!));
    const assigned = this.camp!.residents.some((resident) => resident.answer === 'кормим');
    this.helperCopy.textContent = helpers.length > 0
      ? `Помогают: ${helpers.map((helper) => helper.name).join(', ')} · по 1 грядке · +${FARM_CARE_BONUS} пищи`
      : assigned
        ? 'Назначенный помощник отдыхает, в отлучке или без крыши'
        : 'Назначьте жителю «Добывать пищу» — он поможет со сбором';
    const status = farmStatus(farm, this.now);
    const returnUnlocked = farmReturnActionUnlocked(farm);
    this.returnAction.hidden = !returnUnlocked;
    this.returnAction.disabled = status.ready === 0;
    this.returnAction.textContent = status.ready > 0
      ? `Собрать и повторить · ${status.ready}`
      : 'Собрать и повторить';
  }
}
