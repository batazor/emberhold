import type { CampState } from '../sim/camp';
import { FARM_FOOD_GOAL, farmStatus } from '../sim/farm';
import { gameDuration, gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

export type CampLocation = 'camp' | 'farm' | 'clan';

interface FarmOnboardingCallbacks {
  onAdvance(): void;
  onOpenFarm(): void;
}

interface FarmLessonText {
  readonly title: GameMessage;
  readonly copy: GameMessage;
  readonly alt: GameMessage;
}

/** Весь текст экрана отделён от изображений и может меняться во время игры. */
export interface FarmOnboardingText {
  readonly lessons: readonly [FarmLessonText, FarmLessonText, FarmLessonText];
  readonly intro: {
    readonly kicker: GameMessage;
    readonly title: GameMessage;
    readonly copy: GameMessage;
    readonly action: GameMessage;
  };
  readonly goal: {
    readonly kicker: GameMessage;
    readonly title: GameMessage;
    readonly copy: GameMessage;
    readonly name: GameMessage;
    readonly progress: GameMessage;
    readonly baseline: GameMessage;
    readonly badge: GameMessage;
    readonly reward: GameMessage;
  };
  readonly reward: {
    readonly kicker: GameMessage;
    readonly title: GameMessage;
    readonly copy: GameMessage;
    readonly badge: GameMessage;
    readonly note: GameMessage;
    readonly action: GameMessage;
    readonly alt: GameMessage;
  };
}

export const FARM_ONBOARDING_TEXT: FarmOnboardingText = {
  lessons: [
    {
      title: gameMessage('Жителям нужна пища', 'Residents need food'),
      copy: gameMessage('Жители регулярно едят из общих запасов.', 'Every resident draws food from the shared stores.'),
      alt: gameMessage('Двое поселенцев едят горячую похлёбку у костра', 'Two settlers share a hot stew by the campfire'),
    },
    {
      title: gameMessage('Запасайте пищу', 'Gather food'),
      copy: gameMessage('Назначьте добытчиков — всё, что они принесут, попадёт в кладовую.', 'Assign foragers. Everything they bring home goes into storage.'),
      alt: gameMessage('Поселенка приносит корзину еды к лагерной кладовой', 'A settler carries a basket of food to the camp storehouse'),
    },
    {
      title: gameMessage('Голод останавливает работу', 'Hunger stops work'),
      copy: gameMessage('Голодные жители не работают, пока в кладовой снова не появится пища.', 'Hungry residents stop working until food returns to storage.'),
      alt: gameMessage('Голодный поселенец отложил инструменты и держит пустую миску', 'A hungry settler has put down his tools and holds an empty bowl'),
    },
  ],
  intro: {
    kicker: gameMessage('Новое в поселении · пища', 'New in your settlement · food'),
    title: gameMessage('Накормите поселенцев', 'Feed your settlement'),
    copy: gameMessage('Теперь в лагере двое жителей. Прежде чем расти дальше, научитесь пополнять запас пищи.', 'Two residents now live in camp. Learn to keep them fed before expanding further.'),
    action: gameMessage('К первой цели →', 'Set the first goal →'),
  },
  goal: {
    kicker: gameMessage('Первая цель поселения', 'Your first settlement goal'),
    title: gameMessage('Запаситесь пищей', 'Build a food reserve'),
    copy: gameMessage('В зачёт идёт всё, что добыто после начала цели. Ежедневные траты прогресс не уменьшают.', 'Food gathered after this goal begins counts toward it. Daily consumption will not reduce your progress.'),
    name: gameMessage('Добудьте {goal} ед. пищи', 'Gather {goal} food'),
    progress: gameMessage('{gathered} / {goal}', '{gathered} / {goal}'),
    baseline: gameMessage('Было в запасе: {start} · добыто: {gathered}', 'Starting stores: {start} · gathered: {gathered}'),
    badge: gameMessage('Ферма закрыта', 'Farm locked'),
    reward: gameMessage('Награда · ферма и огород', 'Reward · Farm and garden'),
  },
  reward: {
    kicker: gameMessage('Цель выполнена', 'Goal complete'),
    title: gameMessage('Ферма открыта', 'Farm unlocked'),
    copy: gameMessage('Огород готов: засевайте грядки, собирайте урожай и развивайте хозяйство.', 'The garden is ready. Plant crops, harvest food, and grow your settlement.'),
    badge: gameMessage('Новая локация', 'New location'),
    note: gameMessage('Огород готов к первому посеву', 'The garden is ready for its first planting'),
    action: gameMessage('На ферму →', 'Go to the Farm →'),
    alt: gameMessage('Новая ферма с огородом на рассвете', 'A new farm and garden at dawn'),
  },
};

const LESSON_ART = [
  '/assets/onboarding/resources/residents-eat.avif',
  '/assets/onboarding/resources/gather-food.avif',
  '/assets/onboarding/resources/hunger-stops-work.avif',
] as const;
const FARM_ART = '/assets/onboarding/resources/farm-unlocked.avif';

interface FarmLessonNodes {
  readonly image: HTMLImageElement;
  readonly title: HTMLElement;
  readonly copy: HTMLElement;
}

/** Карточки ввода пищи и первой цели хозяйства. */
export class FarmOnboarding {
  private readonly root: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly copy: HTMLElement;
  private readonly lessons: HTMLElement;
  private readonly lessonNodes: FarmLessonNodes[] = [];
  private readonly focus: HTMLElement;
  private readonly farmImage: HTMLImageElement;
  private readonly farmBadge: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalName: HTMLElement;
  private readonly goalValue: HTMLElement;
  private readonly goalFill: HTMLElement;
  private readonly baseline: HTMLElement;
  private readonly reward: HTMLElement;
  private readonly button: HTMLButtonElement;
  private sceneVisible = false;
  private camp: CampState | null = null;
  private text: FarmOnboardingText;

  constructor(
    parent: HTMLElement,
    private readonly cb: FarmOnboardingCallbacks,
    text: FarmOnboardingText = FARM_ONBOARDING_TEXT,
  ) {
    this.text = text;
    this.root = document.createElement('aside');
    this.root.id = 'farm-onboarding';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'farm-onboarding-title');
    this.root.setAttribute('aria-live', 'polite');

    const panel = document.createElement('section');
    panel.className = 'fo-panel panel';
    const head = document.createElement('header');
    head.className = 'fo-head';
    this.kicker = document.createElement('div');
    this.kicker.className = 'fo-kicker';
    this.title = document.createElement('h2');
    this.title.id = 'farm-onboarding-title';
    this.copy = document.createElement('p');
    head.append(this.kicker, this.title, this.copy);

    this.lessons = document.createElement('div');
    this.lessons.className = 'fo-lessons';
    for (const art of LESSON_ART) {
      const lesson = document.createElement('article');
      lesson.className = 'fo-lesson card';
      const media = document.createElement('div');
      media.className = 'fo-lesson-media';
      const image = document.createElement('img');
      image.src = art;
      image.decoding = 'async';
      media.appendChild(image);
      const body = document.createElement('div');
      body.className = 'fo-lesson-body';
      const lessonTitle = document.createElement('h3');
      const lessonCopy = document.createElement('p');
      body.append(lessonTitle, lessonCopy);
      lesson.append(media, body);
      this.lessons.appendChild(lesson);
      this.lessonNodes.push({ image, title: lessonTitle, copy: lessonCopy });
    }

    this.focus = document.createElement('div');
    this.focus.className = 'fo-focus';
    const farmArt = document.createElement('figure');
    farmArt.className = 'fo-farm-art';
    this.farmImage = document.createElement('img');
    this.farmImage.src = FARM_ART;
    this.farmImage.decoding = 'async';
    this.farmBadge = document.createElement('figcaption');
    this.farmBadge.className = 'fo-farm-badge badge';
    farmArt.append(this.farmImage, this.farmBadge);

    const status = document.createElement('div');
    status.className = 'fo-status';
    this.goal = document.createElement('div');
    this.goal.className = 'fo-goal';
    const goalHead = document.createElement('div');
    goalHead.className = 'fo-goal-head';
    this.goalName = document.createElement('b');
    this.goalValue = document.createElement('span');
    goalHead.append(this.goalName, this.goalValue);
    const track = document.createElement('div');
    track.className = 'fo-track';
    this.goalFill = document.createElement('i');
    track.appendChild(this.goalFill);
    this.baseline = document.createElement('div');
    this.baseline.className = 'fo-baseline';
    this.goal.append(goalHead, track, this.baseline);

    this.reward = document.createElement('div');
    this.reward.className = 'fo-reward';
    status.append(this.goal, this.reward);
    this.focus.append(farmArt, status);

    const footer = document.createElement('footer');
    footer.className = 'fo-footer';
    this.button = document.createElement('button');
    this.button.className = 'fo-action';
    this.button.addEventListener('click', () => {
      if (this.camp?.farm?.step === 'reward') this.cb.onOpenFarm();
      else this.cb.onAdvance();
    });
    footer.appendChild(this.button);

    panel.append(head, this.lessons, this.focus, footer);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
    this.paintStaticText();
  }

  setVisible(visible: boolean): void {
    this.sceneVisible = visible;
    this.paint();
  }

  sync(camp: CampState): void {
    this.camp = camp;
    this.paint();
  }

  /** Позволяет переключить язык или отредактировать описание без перерисовки ассетов. */
  setText(text: FarmOnboardingText): void {
    this.text = text;
    this.paintStaticText();
    this.paint();
  }

  private paintStaticText(): void {
    for (let i = 0; i < this.lessonNodes.length; i += 1) {
      const nodes = this.lessonNodes[i];
      const lesson = this.text.lessons[i];
      if (nodes === undefined || lesson === undefined) continue;
      setGameAttribute(nodes.image, 'alt', lesson.alt);
      setGameText(nodes.title, lesson.title);
      setGameText(nodes.copy, lesson.copy);
    }
    setGameAttribute(this.farmImage, 'alt', this.text.reward.alt);
  }

  private paint(): void {
    const farm = this.camp?.farm;
    const shown = this.sceneVisible && farm !== undefined && farm.step !== 'done';
    this.root.hidden = !shown;
    if (!shown || farm === undefined) return;

    const intro = farm.step === 'intro';
    const goal = farm.step === 'goal';
    const reward = farm.step === 'reward';
    this.root.classList.toggle('is-intro', intro);
    this.root.classList.toggle('is-goal', goal);
    this.root.classList.toggle('is-reward', reward);
    this.root.setAttribute('role', goal ? 'status' : 'dialog');
    if (goal) this.root.removeAttribute('aria-modal');
    else this.root.setAttribute('aria-modal', 'true');
    this.lessons.hidden = !intro;
    this.focus.hidden = intro;
    this.goal.hidden = !goal;
    this.button.hidden = goal;

    if (intro) {
      setGameText(this.kicker, this.text.intro.kicker);
      setGameText(this.title, this.text.intro.title);
      setGameText(this.copy, this.text.intro.copy);
      setGameText(this.button, this.text.intro.action);
    } else if (goal) {
      const values = { start: farm.foodAtStart, gathered: farm.gatheredFood, goal: FARM_FOOD_GOAL };
      setGameText(this.kicker, this.text.goal.kicker);
      setGameText(this.title, this.text.goal.title);
      setGameText(this.copy, this.text.goal.copy);
      setGameText(this.goalName, this.text.goal.name, values);
      setGameText(this.goalValue, this.text.goal.progress, values);
      this.goalFill.style.width = `${Math.min(100, (farm.gatheredFood / FARM_FOOD_GOAL) * 100)}%`;
      setGameText(this.baseline, this.text.goal.baseline, values);
      setGameText(this.farmBadge, this.text.goal.badge);
      setGameText(this.reward, this.text.goal.reward);
    } else {
      setGameText(this.kicker, this.text.reward.kicker);
      setGameText(this.title, this.text.reward.title);
      setGameText(this.copy, this.text.reward.copy);
      setGameText(this.farmBadge, this.text.reward.badge);
      setGameText(this.reward, this.text.reward.note);
      setGameText(this.button, this.text.reward.action);
    }
  }
}

interface CampLocationsCallbacks {
  onSelect(location: CampLocation): void;
  onSign(): void;
}

/** Переключатель соседних локаций: Ферма расположена слева от Лагеря. */
export class CampLocations {
  private readonly root: HTMLElement;
  private readonly campButton: HTMLButtonElement;
  private readonly farmButton: HTMLButtonElement;
  private readonly clanButton: HTMLButtonElement;
  private readonly farmState: HTMLElement;
  private readonly signButton: HTMLButtonElement;
  private sceneVisible = false;
  private camp: CampState | null = null;
  private active: CampLocation = 'camp';
  private now = 0;

  constructor(parent: HTMLElement, cb: CampLocationsCallbacks) {
    this.root = document.createElement('nav');
    this.root.id = 'camp-locations';
    setGameAttribute(this.root, 'aria-label', gameMessage('Локации поселения', 'Settlement locations'));
    const label = document.createElement('span');
    label.className = 'cl-label';
    setGameText(label, gameMessage('Локации', 'Locations'));

    this.farmButton = document.createElement('button');
    this.farmButton.className = 'cl-place farm';
    const farmName = document.createElement('b');
    setGameText(farmName, gameMessage('Ферма', 'Farm'));
    this.farmState = document.createElement('span');
    this.farmButton.append(farmName, this.farmState);
    this.farmButton.addEventListener('click', () => cb.onSelect('farm'));

    this.campButton = document.createElement('button');
    this.campButton.className = 'cl-place camp';
    const campName = document.createElement('b');
    setGameText(campName, gameMessage('Лагерь', 'Camp'));
    const campState = document.createElement('span');
    campState.textContent = '●';
    this.campButton.append(campName, campState);
    this.campButton.addEventListener('click', () => cb.onSelect('camp'));

    this.clanButton = document.createElement('button');
    this.clanButton.className = 'cl-place clan';
    const clanName = document.createElement('b');
    setGameText(clanName, gameMessage('Клан', 'Clan'));
    const clanState = document.createElement('span');
    clanState.textContent = '⚑';
    this.clanButton.append(clanName, clanState);
    this.clanButton.addEventListener('click', () => cb.onSelect('clan'));

    this.signButton = document.createElement('button');
    this.signButton.className = 'cl-place sign';
    setGameText(this.signButton, gameMessage('+ Указатель', '+ Signpost'));
    this.signButton.addEventListener('click', () => cb.onSign());

    this.root.append(label, this.farmButton, this.campButton, this.clanButton, this.signButton);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.sceneVisible = visible;
    this.paint();
  }

  sync(camp: CampState, active: CampLocation, now: number): void {
    this.camp = camp;
    this.active = active;
    this.now = now;
    this.paint();
  }

  private paint(): void {
    const farm = this.camp?.farm;
    const clan = this.camp?.clan;
    this.root.style.display = this.sceneVisible && (farm !== undefined || clan != null) ? 'grid' : 'none';
    this.farmButton.style.display = farm === undefined ? 'none' : '';
    this.farmButton.classList.toggle('locked', farm?.unlocked !== true);
    this.farmButton.disabled = farm?.unlocked !== true;
    this.farmButton.setAttribute('aria-disabled', String(farm?.unlocked !== true));
    this.farmButton.setAttribute('aria-pressed', String(this.active === 'farm'));
    this.campButton.setAttribute('aria-pressed', String(this.active === 'camp'));
    this.clanButton.style.display = clan == null ? 'none' : '';
    this.clanButton.disabled = clan == null;
    this.clanButton.setAttribute('aria-pressed', String(this.active === 'clan'));
    this.clanButton.title = clan?.name ?? '';
    if (farm?.unlocked !== true) {
      this.farmState.textContent = '🔒';
      this.farmState.classList.remove('ready');
      const locked = gameMessage('Ферма закрыта', 'Farm locked');
      setGameAttribute(this.farmButton, 'title', locked);
      setGameAttribute(this.farmButton, 'aria-label', locked);
      return;
    }

    const status = farmStatus(farm, this.now);
    this.farmState.classList.toggle('ready', status.ready > 0);
    let title: GameMessage;
    let values: Readonly<Record<string, number | ReturnType<typeof gameDuration>>>;
    if (status.ready > 0) {
      values = { count: status.ready };
      setGameText(this.farmState, gameMessage('готово: {count}', '{count} ready'), values);
      title = gameMessage('Ферма · урожай готов: {count}', 'Farm · harvest ready: {count}');
    } else if (status.growing > 0 && status.nextReadyAt !== null) {
      values = { count: status.growing, time: gameDuration(Math.max(0, status.nextReadyAt - this.now)) };
      setGameText(this.farmState, gameMessage('растёт: {count}', '{count} growing'), values);
      title = gameMessage('Ферма · растёт: {count} · урожай через {time}', 'Farm · {count} growing · harvest in {time}');
    } else {
      values = { count: status.empty };
      setGameText(this.farmState, gameMessage('свободно: {count}', '{count} open'), values);
      title = gameMessage('Ферма · свободно грядок: {count}', 'Farm · open beds: {count}');
    }
    setGameAttribute(this.farmButton, 'title', title, values);
    setGameAttribute(this.farmButton, 'aria-label', title, values);
  }
}
