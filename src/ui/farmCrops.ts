import type { CampState } from '../sim/camp';
import {
  FARM_CONVOY_FOOD,
  FARM_CONVOY_IRON,
  FARM_CROPS,
  farmConvoyBlock,
  farmReturnActionUnlocked,
  farmStoryReady,
  farmStatus,
} from '../sim/farm';
import type { FarmCaretaker, FarmCropId } from '../sim/farm';
import { FARM_CARE_BONUS, farmCareHelpers } from '../sim/farmResidents';
import { clanBuilderIds } from '../sim/clan';
import { residentUuid } from '../sim/residents';
import { gameDuration, gameMessage, gameText, setGameAttribute, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

interface FarmCropPickerCallbacks {
  onSelect(crop: FarmCropId): void;
  onReturn(): void;
  onCaretaker(caretaker: FarmCaretaker): void;
  onConvoy(): void;
}

const STORY: readonly { title: GameMessage; goal: GameMessage }[] = [
  { title: gameMessage('Первая борозда', 'The first furrow'), goal: gameMessage('Засейте две грядки', 'Plant two garden beds') },
  { title: gameMessage('Первый урожай', 'First harvest'), goal: gameMessage('Соберите урожай с двух грядок', 'Harvest two garden beds') },
  { title: gameMessage('Следы у посадок', 'Tracks by the crops'), goal: gameMessage('Постройте ограду через меню строительства', 'Build the fence from the construction menu') },
  { title: gameMessage('Сухая земля', 'Dry soil'), goal: gameMessage('Постройте колодец', 'Build the well') },
  { title: gameMessage('Больше земли', 'More soil'), goal: gameMessage('Засейте четыре доступные грядки', 'Plant four available garden beds') },
  { title: gameMessage('Работа сообща', 'Working together'), goal: gameMessage('Дождитесь помощи жителя со сбором', 'Let a resident help with a harvest') },
  { title: gameMessage('Семена на завтра', 'Seeds for tomorrow'), goal: gameMessage('Соберите суммарно шесть грядок', 'Harvest six garden beds in total') },
  { title: gameMessage('Место для припасов', 'Room for supplies'), goal: gameMessage('Начните строительство сарая', 'Start building the barn') },
  { title: gameMessage('Новая рутина', 'A new routine'), goal: gameMessage('Используйте массовый сбор у готового сарая', 'Use batch harvest with the completed barn') },
  { title: gameMessage('Запас для дороги', 'Stores for the road'), goal: gameMessage('Добудьте огородом суммарно 40 пищи', 'Produce 40 food from the farm in total') },
  { title: gameMessage('Кому вести хозяйство', 'Who will run the farm'), goal: gameMessage('Выберите уклад смотрителя', 'Choose the caretaker’s approach') },
  { title: gameMessage('Вода после дождя', 'After the rain'), goal: gameMessage('Проведите дренаж и откройте шесть грядок', 'Build drainage and unlock all six beds') },
  { title: gameMessage('Свой очаг', 'A hearth of one’s own'), goal: gameMessage('Начните строительство дома фермера', 'Start building the farmhouse') },
  { title: gameMessage('Последний венец', 'The final beam'), goal: gameMessage('Дождитесь завершения дома', 'Wait for the farmhouse to be completed') },
  { title: gameMessage('Первый новый обоз', 'The first new convoy'), goal: gameMessage('Соберите 70 пищи и снарядите первый обоз', 'Produce 70 food and supply the first convoy') },
];

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
  private readonly storyTitle: HTMLElement;
  private readonly storyGoal: HTMLElement;
  private readonly storyState: HTMLElement;
  private readonly caretaker: HTMLElement;
  private readonly convoyAction: HTMLButtonElement;
  private camp: CampState | null = null;
  private sceneVisible = false;
  private now = 0;

  constructor(parent: HTMLElement, cb: FarmCropPickerCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'farm-crops';
    this.root.className = 'panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'farm-crops-title');

    const story = document.createElement('div');
    story.className = 'fc-story';
    this.storyTitle = document.createElement('b');
    this.storyGoal = document.createElement('span');
    this.storyState = document.createElement('small');
    story.append(this.storyTitle, this.storyGoal, this.storyState);

    this.caretaker = document.createElement('div');
    this.caretaker.className = 'fc-caretaker';
    for (const [id, label] of [
      ['grower', gameMessage('Садовод · бережный урожай', 'Grower · careful harvest')],
      ['steward', gameMessage('Завхоз · надёжный запас', 'Steward · reliable stores')],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      setGameText(button, label);
      button.addEventListener('click', () => cb.onCaretaker(id));
      this.caretaker.appendChild(button);
    }

    this.convoyAction = document.createElement('button');
    this.convoyAction.className = 'fc-convoy';
    this.convoyAction.type = 'button';
    this.convoyAction.addEventListener('click', () => cb.onConvoy());

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
    this.root.append(story, this.caretaker, this.convoyAction, head, list, footer);
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
    const chapter = STORY[Math.max(0, Math.min(STORY.length - 1, farm.story.day - 1))]!;
    const roadStory = this.camp!.roadStory;
    const caravaner = this.camp!.residents.find((resident) =>
      roadStory?.caravanerId !== undefined && residentUuid(resident) === roadStory.caravanerId
    )?.name ?? roadStory?.caravanerName;
    setGameText(this.storyTitle, gameMessage('День {day} из 15 · {title}', 'Day {day} of 15 · {title}'), {
      day: farm.story.day,
      title: gameText(chapter.title),
    });
    if (farm.story.day === 6) {
      if (caravaner !== undefined) {
        setGameText(this.storyGoal, gameMessage('Дождитесь, когда {name} поможет со сбором', 'Let {name} help with a harvest'), {
          name: window.EmberholdLanguage?.translate(caravaner) ?? caravaner,
        });
      } else if (roadStory?.step === 'return-to-trader') {
        setGameText(this.storyGoal, gameMessage('Расспросите торговца о пропавшем обозе', 'Ask the trader about the missing convoy'));
      } else if (roadStory?.step === 'find-caravan') {
        setGameText(this.storyGoal, gameMessage('Найдите выжившего у пропавшего обоза', 'Find the survivor by the missing convoy'));
      } else if (roadStory === undefined) {
        setGameText(this.storyGoal, gameMessage('Скуйте первую вещь и разыщите пропавший обоз', 'Forge your first item and find the missing convoy'));
      } else {
        setGameText(this.storyGoal, chapter.goal);
      }
    } else if (farm.story.day === 8 && roadStory?.step !== 'done') {
      const roadGoal = roadStory?.step === 'return-to-trader'
        ? gameMessage('Расспросите торговца о пропавшем обозе', 'Ask the trader about the missing convoy')
        : roadStory?.step === 'find-caravan'
          ? gameMessage('Найдите пропавший обоз на лесной дороге', 'Find the missing convoy on the forest road')
          : roadStory?.step === 'settle-supply'
            ? gameMessage('Откройте дорогу у минотавра', 'Reopen the road past the minotaur')
            : gameMessage('Скуйте первую вещь и откройте дорогу', 'Forge your first item and reopen the road');
      setGameText(this.storyGoal, roadGoal);
    } else if (farm.story.day === 11 && caravaner !== undefined) {
      setGameText(this.storyGoal, gameMessage('Выберите уклад хозяйства для {name}', 'Choose how {name} will run the farm'), {
        name: window.EmberholdLanguage?.translate(caravaner) ?? caravaner,
      });
    } else {
      setGameText(this.storyGoal, chapter.goal);
    }
    const ready = farmStoryReady(farm, roadStory);
    if (farm.story.day === 15 && ready) {
      setGameText(this.storyState, gameMessage('Обоз снабжён · первая поставка железа получена', 'Convoy supplied · first iron shipment received'));
    } else if (ready) {
      setGameText(this.storyState, gameMessage('Цель выполнена · продолжение завтра', 'Goal complete · continues tomorrow'));
    } else {
      setGameText(this.storyState, gameMessage('Цель дня', 'Today’s goal'));
    }
    this.caretaker.hidden = farm.story.day !== 11 || farm.story.caretaker !== null;
    const convoyBlock = farmConvoyBlock(this.camp!);
    this.convoyAction.hidden = farm.story.day !== 15 || convoyBlock === 'done';
    this.convoyAction.disabled = convoyBlock !== 'ok';
    if (convoyBlock === 'ok') {
      setGameText(this.convoyAction, gameMessage('Снарядить обоз · {food} пищи → {iron} железа', 'Supply convoy · {food} food → {iron} iron'), {
        food: FARM_CONVOY_FOOD,
        iron: FARM_CONVOY_IRON,
      });
    } else if (convoyBlock === 'road') {
      setGameText(this.convoyAction, gameMessage('Сначала откройте дорогу для обозов', 'Reopen the caravan road first'));
    } else if (convoyBlock === 'harvest') {
      setGameText(this.convoyAction, gameMessage('Сначала соберите огородом 70 пищи', 'First produce 70 food on the farm'));
    } else if (convoyBlock === 'food') {
      setGameText(this.convoyAction, gameMessage('Для обоза нужно {food} пищи на складе', 'The convoy needs {food} food in storage'), {
        food: FARM_CONVOY_FOOD,
      });
    } else if (convoyBlock === 'house') {
      setGameText(this.convoyAction, gameMessage('Сначала достройте дом фермера', 'Finish the farmhouse first'));
    }
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
