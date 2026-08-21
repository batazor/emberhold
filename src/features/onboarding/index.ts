/**
 * Режиссёр раскадровки (§16, `onboarding.html`). Пока кадр не 'done', игра
 * идёт по сценарию: открывается сразу в вылазке, показывает по одной полосе
 * за раз и приводит в лагерь только после первого возвращения.
 *
 * Кадры 1–7 двигаются событиями вылазки, а не секундомером: полоса рюкзака
 * появляется тогда, когда в рюкзаке что-то есть. Пауза участвует только там,
 * где два открытия идут от одного события (добыча → цена возврата → ставка).
 *
 * Правила переходов лежат в sim/onboarding и проверяются там. Здесь — то,
 * что раньше было пятью модульными let в main: текущий кадр, время его
 * начала, скриптовая рана и счётчик вскрытого. Показ режиссёр не делает
 * и про полосы не знает — он зовёт `show`, а что там показывать, решает игра.
 */
import {
  isRaidStep,
  nextRaidStep,
  openEvacWhenEarned,
  scriptWound,
} from '../../sim/onboarding';
import type { OnbStep } from '../../sim/onboarding';
import type { RaidState } from '../../sim/raid';

export interface OnboardingHooks {
  /** Часы сессии в секундах: ими разводятся открытия от одного события. */
  readonly now: () => number;
  /**
   * Показать кадр. Зовётся на каждой смене и на входе в сцену — и только
   * тогда: сравнивать состояние каждый тик значило бы драться с игроком
   * за видимость элементов.
   */
  readonly show: (step: OnbStep) => void;
  /** Кадр 3: экран коротко дёргается. Рана обязана быть замечена телом. */
  readonly shake: () => void;
  /** Кадр сменился: это идёт в телеметрию и в сохранение. */
  readonly changed: (step: OnbStep) => void;
}

export interface Director {
  /** Текущий кадр. */
  readonly step: OnbStep;
  /** Идёт ли раскадровка по вылазке — от неё зависят вход и экран возврата. */
  readonly inRaid: boolean;
  /** Перевести кадр. Тот же кадр второй раз ничего не стоит. */
  set(step: OnbStep): void;
  /** Пересобрать показ под текущий кадр: вход в сцену, возвращение в лагерь. */
  apply(): void;
  /**
   * Начало вылазки. Счётчики обнуляются вместе с ней: перезапуск возвращает
   * игрока к первому кадру, а не к середине раскадровки.
   */
  enterRaid(state: RaidState): void;
  /** Тик вылазки. */
  drive(state: RaidState): void;
}

export function createDirector(from: OnbStep, hooks: OnboardingHooks): Director {
  let step = from;
  /** Время начала кадра. */
  let stepAt = 0;
  /** Сколько контейнеров вскрыто в первой вылазке: кадры 4 и 6 считают по ним. */
  let looted = 0;
  /** Скриптовая рана кадра 3 выдаётся ровно один раз. */
  let wounded = false;
  /** С чего начали: по этому числу видно, что героя задели по-настоящему. */
  let startWounds = 0;

  /** Перевод кадра — общий для смены снаружи и изнутри тика. */
  const set = (next: OnbStep): void => {
    if (step === next) return;
    step = next;
    stepAt = hooks.now();
    hooks.show(step);
    hooks.changed(step);
  };

  return {
    get step(): OnbStep {
      return step;
    },
    get inRaid(): boolean {
      return isRaidStep(step);
    },

    set,

    apply(): void {
      hooks.show(step);
    },

    enterRaid(state: RaidState): void {
      if (isRaidStep(step)) {
        looted = 0;
        wounded = false;
        startWounds = state.hero.hp;
        stepAt = hooks.now();
      }
      hooks.show(step);
    },

    drive(state: RaidState): void {
      openEvacWhenEarned(state, step);
      // Кадр 3: первый противник обязан задеть. Раны показываются до того,
      // как станут опасными, — на нулевом ярусе это ничего не стоит.
      if (step === 'approach' && !wounded && scriptWound(state)) {
        wounded = true;
        hooks.shake();
      }
      looted = 0;
      for (const c of state.loc.containers) if (c.opened) looted++;

      const next = nextRaidStep(step, {
        moved: state.steps > 0,
        wounded: wounded || state.hero.hp < startWounds,
        looted,
        sinceStep: hooks.now() - stepAt,
      });
      if (next !== null) set(next);
    },
  };
}
