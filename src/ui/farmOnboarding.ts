import type { CampState } from '../sim/camp';
import { formatDuration } from '../core/clock';
import { FARM_FOOD_GOAL, farmStatus } from '../sim/farm';

export type CampLocation = 'camp' | 'farm' | 'clan';

interface FarmOnboardingCallbacks {
  onAdvance(): void;
  onOpenFarm(): void;
}

interface FarmLessonText {
  readonly title: string;
  readonly copy: string;
  readonly alt: string;
}

/** Весь текст экрана отделён от изображений и может меняться во время игры. */
export interface FarmOnboardingText {
  readonly lessons: readonly [FarmLessonText, FarmLessonText, FarmLessonText];
  readonly intro: {
    readonly kicker: string;
    readonly title: string;
    readonly copy: string;
    readonly action: string;
  };
  readonly goal: {
    readonly kicker: string;
    readonly title: string;
    readonly copy: string;
    readonly name: string;
    readonly progress: string;
    readonly baseline: string;
    readonly badge: string;
    readonly reward: string;
  };
  readonly reward: {
    readonly kicker: string;
    readonly title: string;
    readonly copy: string;
    readonly badge: string;
    readonly note: string;
    readonly action: string;
    readonly alt: string;
  };
}

export const FARM_ONBOARDING_RU: FarmOnboardingText = {
  lessons: [
    {
      title: 'Жители едят',
      copy: 'Каждый житель регулярно расходует пищу из общего запаса.',
      alt: 'Двое поселенцев едят горячую похлёбку у костра',
    },
    {
      title: 'Добывайте пищу',
      copy: 'Назначайте добытчиков — принесённая еда пополняет кладовую.',
      alt: 'Поселенка приносит корзину еды к лагерной кладовой',
    },
    {
      title: 'Нет еды — нет работы',
      copy: 'Голодные жители прекращают работу, пока запас не пополнится.',
      alt: 'Голодный поселенец отложил инструменты и держит пустую миску',
    },
  ],
  intro: {
    kicker: 'Новое в поселении · ресурсы',
    title: 'Накормите поселение',
    copy: 'Теперь жителей двое. Познакомьтесь с пищей, прежде чем развивать лагерь дальше.',
    action: 'Понятно, к цели →',
  },
  goal: {
    kicker: 'Первая общая цель',
    title: 'Создайте запас на будущее',
    copy: 'В прогресс идёт пища, добытая после выдачи задания. Ежедневный расход результат не отнимает.',
    name: 'Добудьте {goal} пищи',
    progress: '{gathered} / {goal}',
    baseline: 'Запас при выдаче: {start} · добыто после задания: {gathered}',
    badge: 'Ферма закрыта',
    reward: 'Награда · новая локация «Ферма» и участок «Огород»',
  },
  reward: {
    kicker: 'Цель выполнена',
    title: 'Открыта локация «Ферма»!',
    copy: 'Здесь появится огород: выращивайте урожай и развивайте хозяйство поселения.',
    badge: 'Новая локация',
    note: 'Ферма открыта · огород готов к развитию',
    action: 'Перейти на ферму →',
    alt: 'Новая ферма с огородом на рассвете',
  },
};

const LESSON_ART = [
  '/assets/onboarding/resources/residents-eat.avif',
  '/assets/onboarding/resources/gather-food.avif',
  '/assets/onboarding/resources/hunger-stops-work.avif',
] as const;
const FARM_ART = '/assets/onboarding/resources/farm-unlocked.avif';

const fillText = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{([a-z]+)\}/gi, (_, key: string) => String(values[key] ?? `{${key}}`));

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
    text: FarmOnboardingText = FARM_ONBOARDING_RU,
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
      nodes.image.alt = lesson.alt;
      nodes.title.textContent = lesson.title;
      nodes.copy.textContent = lesson.copy;
    }
    this.farmImage.alt = this.text.reward.alt;
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
      this.kicker.textContent = this.text.intro.kicker;
      this.title.textContent = this.text.intro.title;
      this.copy.textContent = this.text.intro.copy;
      this.button.textContent = this.text.intro.action;
    } else if (goal) {
      const values = { start: farm.foodAtStart, gathered: farm.gatheredFood, goal: FARM_FOOD_GOAL };
      this.kicker.textContent = this.text.goal.kicker;
      this.title.textContent = this.text.goal.title;
      this.copy.textContent = this.text.goal.copy;
      this.goalName.textContent = fillText(this.text.goal.name, values);
      this.goalValue.textContent = fillText(this.text.goal.progress, values);
      this.goalFill.style.width = `${Math.min(100, (farm.gatheredFood / FARM_FOOD_GOAL) * 100)}%`;
      this.baseline.textContent = fillText(this.text.goal.baseline, values);
      this.farmBadge.textContent = this.text.goal.badge;
      this.reward.textContent = this.text.goal.reward;
    } else {
      this.kicker.textContent = this.text.reward.kicker;
      this.title.textContent = this.text.reward.title;
      this.copy.textContent = this.text.reward.copy;
      this.farmBadge.textContent = this.text.reward.badge;
      this.reward.textContent = this.text.reward.note;
      this.button.textContent = this.text.reward.action;
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
    this.root.setAttribute('aria-label', 'Локации поселения');
    const label = document.createElement('span');
    label.className = 'cl-label';
    label.textContent = 'Локации';

    this.farmButton = document.createElement('button');
    this.farmButton.className = 'cl-place farm';
    const farmName = document.createElement('b');
    farmName.textContent = 'Ферма';
    this.farmState = document.createElement('span');
    this.farmButton.append(farmName, this.farmState);
    this.farmButton.addEventListener('click', () => cb.onSelect('farm'));

    this.campButton = document.createElement('button');
    this.campButton.className = 'cl-place camp';
    const campName = document.createElement('b');
    campName.textContent = 'Лагерь';
    const campState = document.createElement('span');
    campState.textContent = '●';
    this.campButton.append(campName, campState);
    this.campButton.addEventListener('click', () => cb.onSelect('camp'));

    this.clanButton = document.createElement('button');
    this.clanButton.className = 'cl-place clan';
    const clanName = document.createElement('b');
    clanName.textContent = 'Клан';
    const clanState = document.createElement('span');
    clanState.textContent = '⚑';
    this.clanButton.append(clanName, clanState);
    this.clanButton.addEventListener('click', () => cb.onSelect('clan'));

    this.signButton = document.createElement('button');
    this.signButton.className = 'cl-place sign';
    this.signButton.textContent = '+ Указатель';
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
      this.farmButton.title = 'Ферма закрыта';
      this.farmButton.setAttribute('aria-label', 'Ферма закрыта');
      return;
    }

    const status = farmStatus(farm, this.now);
    this.farmState.classList.toggle('ready', status.ready > 0);
    let title: string;
    if (status.ready > 0) {
      this.farmState.textContent = `готово: ${status.ready}`;
      title = `Ферма · урожай готов: ${status.ready}`;
    } else if (status.growing > 0 && status.nextReadyAt !== null) {
      this.farmState.textContent = `растёт: ${status.growing}`;
      title = `Ферма · растёт: ${status.growing} · урожай через ${formatDuration(Math.max(0, status.nextReadyAt - this.now))}`;
    } else {
      this.farmState.textContent = `грядок: ${status.active}`;
      title = `Ферма · свободно грядок: ${status.empty}`;
    }
    this.farmButton.title = title;
    this.farmButton.setAttribute('aria-label', title);
  }
}
