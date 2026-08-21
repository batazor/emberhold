import { formatDuration } from '../core/clock';
import {
  HERO_CLASSES,
  SKILLS,
  healSeconds,
  stats,
  TRAIN_REASON,
  trainBlock,
  trainCap,
  trainPerLevel,
  xpToNext,
} from '../sim/heroes';
import type { HeroState, Roster } from '../sim/heroes';

/**
 * Карточка выбранного героя (§11.8) — то, что осталось от списка отряда,
 * когда список заменил веер (`features/fan`).
 *
 * **Почему не список.** Список отвечал на вопрос «кем я иду сейчас» строками
 * с кнопками «Идти этим», и ради этого вопроса приходилось открывать лист
 * лагеря: два касания на смену ведущего, оба — не глядя не сделать. Веер
 * отвечает на тот же вопрос лицом под пальцем и одним касанием. Но всё
 * остальное, что несла панель, — уровень, раны, характеристики, умение
 * и Плац, — лицом не показать: карточка и есть это остальное.
 *
 * **Показывает выбранного, а не ведущего.** Это разные люди ровно тогда,
 * когда смотрят раненого: тапнуть по лечащемуся можно, повести им — нет
 * (§11.7). Карточка обязана открыться и на нём, иначе «сколько ему ещё
 * лечиться» негде прочитать.
 */
const STATUS_TEXT: Record<string, string> = {
  ready: 'готов',
  raid: 'в вылазке',
  healing: 'лечится',
  training: 'тренируется',
};

export interface HeroCardCallbacks {
  onTrain(index: number): void;
}

export class HeroCard {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly skill: HTMLElement;
  private readonly train: HTMLButtonElement;
  private shown = 0;

  constructor(parent: HTMLElement, private readonly cb: HeroCardCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'hero-card';
    this.root.className = 'panel';
    this.root.innerHTML = `
      <div class="r-top"><b id="hc-name"></b><span id="hc-status" class="dim"></span></div>
      <div class="r-meta" id="hc-meta"></div>
      <div class="bar"><i id="hc-xp"></i></div>
      <div class="r-skill" id="hc-skill"></div>
      <button id="hc-train"></button>`;
    const pick = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    this.name = pick('hc-name');
    this.status = pick('hc-status');
    this.meta = pick('hc-meta');
    this.xp = pick('hc-xp');
    this.skill = pick('hc-skill');
    this.train = pick<HTMLButtonElement>('hc-train');
    this.train.addEventListener('click', () => this.cb.onTrain(this.shown));
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  /** Отступ снизу: карточка стоит над нижней строкой лагеря, как и веер. */
  setBottom(px: number): void {
    this.root.style.bottom = `${px}px`;
  }

  /**
   * Уровень Плаца приходит числом, а не состоянием лагеря: карточка про
   * лагерь ничего не знает и знать не должна. Лазарет сюда не передаётся —
   * остаток лечения уже лежит в `busyUntil`.
   */
  sync(roster: Roster, index: number, now: number, yardLevel = 0): void {
    this.shown = Math.min(Math.max(0, index), roster.heroes.length - 1);
    const hero = roster.heroes[this.shown];
    if (hero === undefined) return;
    const def = HERO_CLASSES[hero.cls];
    const lead = roster.active === this.shown;

    // «Ведёт» стоит в имени, а не отдельной строкой: в карточке на четыре
    // строки пятая читается шумом, а кто ведёт — видно и по кольцу на лице.
    this.name.textContent = `${def.name} · ур. ${hero.level}${lead ? ' · ведёт' : ''}`;
    this.status.textContent = this.statusLine(hero, now);
    this.status.className = hero.status === 'ready' && hero.wounds === 0 ? 'good' : 'dim';

    // Три характеристики, а не четыре. «Сила» стояла здесь четвёртой
    // и не читалась ничем: ни боем, ни обзором, ни генератором. Показанное
    // число обязано на что-то влиять; до тех пор строка врёт.
    const s = stats(hero);
    this.meta.textContent = `Атака ${s.attack} · Защита ${s.defense} · Знание ${s.knowledge}`;

    const need = xpToNext(hero.level);
    this.xp.style.width = `${Math.min(100, (hero.xp / need) * 100).toFixed(1)}%`;

    const skill = SKILLS[def.skill];
    this.skill.textContent = `${skill.name} — ${skill.effect} · ${def.strong}, ${def.weak}`;

    const tb = trainBlock(roster, hero, yardLevel);
    this.train.disabled = tb !== 'ok';
    this.train.textContent =
      hero.status === 'training'
        ? `Тренируется · ${formatDuration(Math.max(0, (hero.busyUntil ?? now) - now))}`
        : tb === 'ok'
          ? `Тренировать · ${formatDuration(trainPerLevel(yardLevel))} · до ур. ${trainCap(roster)}`
          : TRAIN_REASON[tb];
  }

  private statusLine(hero: HeroState, now: number): string {
    if (hero.status === 'ready') {
      return hero.wounds > 0 ? `ран ${hero.wounds}` : 'готов';
    }
    if (hero.busyUntil === null) return STATUS_TEXT[hero.status] ?? '';
    const left = Math.max(0, hero.busyUntil - now);
    const what = hero.status === 'healing' ? 'лечится' : STATUS_TEXT[hero.status] ?? '';
    return `${what} · ${formatDuration(left)}`;
  }

  /** Сколько будет лечиться герой с таким числом ран — для баннера возврата. */
  static healText(wounds: number, infirmaryLevel = 0): string {
    return formatDuration(healSeconds(wounds, infirmaryLevel));
  }
}
