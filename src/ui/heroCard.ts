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
import type { GearState, Offhand } from '../sim/gear';
import { avatarSvg } from './avatar';
import { GearSection } from './gearSection';

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
 *
 * **Два состояния, а не одно.** Развёрнутая карточка стояла на лагере
 * постоянно и накрывала четверть кадра — сцена читалась из-под панели.
 * Теперь тап по лицу открывает меню — шапку с командами, — а полный
 * разбор (характеристики, опыт, умение, Плац) раскрывает команда
 * «О персонаже». Закрытие возвращает меню: чужому герою не показывают
 * разбор предыдущего.
 */
const STATUS_TEXT: Record<string, string> = {
  ready: 'готов',
  raid: 'в вылазке',
  healing: 'лечится',
  training: 'тренируется',
};

export interface HeroCardCallbacks {
  onTrain(index: number): void;
  /** §14.2 — переложить предмет в левой руке: тот же выбор, что в «Припасах». */
  onOffhand(hand: Offhand): void;
}

export class HeroCard {
  private readonly root: HTMLElement;
  private readonly face: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly skill: HTMLElement;
  private readonly gear: GearSection;
  private readonly train: HTMLButtonElement;
  private readonly acts: HTMLElement;
  /** Меню или полный разбор: полный открывается только командой «О персонаже». */
  private mode: 'menu' | 'full' = 'menu';
  private shown = 0;
  /** Чьё лицо нарисовано: карточка обновляется кадром, лицо — сменой героя. */
  private faceKey = '';

  constructor(parent: HTMLElement, private readonly cb: HeroCardCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'hero-card';
    this.root.className = 'panel';
    // Лицо — то же, что в веере (§11.8, §6.2.1): карточка отвечает «что
    // с ним», и без лица «с ним» приходилось сверять по подписи. Имя со
    // статусом встают колонкой рядом: в 172 пикселя строка «лицо · имя ·
    // статус» не влезает.
    this.root.innerHTML = `
      <div class="r-id"><span class="face" id="hc-face"></span>
        <span><b id="hc-name"></b><span id="hc-status" class="dim"></span></span></div>
      <div class="r-acts" id="hc-acts"><button id="hc-about">О персонаже</button></div>
      <div class="r-meta" id="hc-meta"></div>
      <div class="bar" id="hc-bar"><i id="hc-xp"></i></div>
      <div class="r-skill" id="hc-skill"></div>
      <button id="hc-train"></button>`;
    const pick = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    this.face = pick('hc-face');
    this.name = pick('hc-name');
    this.status = pick('hc-status');
    this.meta = pick('hc-meta');
    this.xp = pick('hc-xp');
    this.bar = pick('hc-bar');
    this.skill = pick('hc-skill');
    this.acts = pick('hc-acts');
    this.train = pick<HTMLButtonElement>('hc-train');
    // Секция общая с карточкой жильца (`gearSection.ts`): механика едина.
    this.gear = new GearSection((hand) => this.cb.onOffhand(hand));
    this.root.insertBefore(this.gear.el, this.train);
    this.train.addEventListener('click', () => this.cb.onTrain(this.shown));
    pick<HTMLButtonElement>('hc-about').addEventListener('click', () => {
      this.mode = 'full';
      this.applyMode();
    });
    this.applyMode();
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  /** Открыть меню команд на герое: шапка и кнопки, без разбора. */
  showMenu(): void {
    this.mode = 'menu';
    this.applyMode();
    this.root.style.display = 'flex';
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    // Спрятанная карточка сворачивается: следующий тап по лицу открывает
    // меню, а не разбор того, кого смотрели в прошлый раз.
    if (!visible && this.mode !== 'menu') {
      this.mode = 'menu';
      this.applyMode();
    }
  }

  /** Разбор виден только в полном режиме, команда «О персонаже» — только в меню. */
  private applyMode(): void {
    const full = this.mode === 'full';
    this.acts.style.display = full ? 'none' : 'flex';
    for (const el of [this.meta, this.bar, this.skill, this.gear.el, this.train]) {
      el.style.display = full ? '' : 'none';
    }
  }

  /** Отступ снизу: карточка стоит над нижней строкой лагеря, как и веер. */
  setBottom(px: number): void {
    this.root.style.bottom = `${px}px`;
  }

  /**
   * Уровень Плаца приходит числом, а не состоянием лагеря: карточка про
   * лагерь ничего не знает и знать не должна. Лазарет сюда не передаётся —
   * остаток лечения уже лежит в `busyUntil`.
   *
   * Снаряжение приходит тем же путём — слотами и рукой, а не лагерем.
   * Комплект один на отряд (§14: слот и есть инвентарь), и карточка вправе
   * показывать его на любом герое: в вылазку идёт один, и несёт он именно
   * этот комплект.
   */
  sync(
    roster: Roster,
    index: number,
    now: number,
    yardLevel = 0,
    gear: GearState | null = null,
    offhand: Offhand = 'torch',
  ): void {
    this.shown = Math.min(Math.max(0, index), roster.heroes.length - 1);
    const hero = roster.heroes[this.shown];
    if (hero === undefined) return;
    const def = HERO_CLASSES[hero.cls];
    const lead = roster.active === this.shown;

    // Лицо выводится из класса и сида (§11.8) — тот же вызов, что в веере:
    // человек в карточке обязан быть тем же, что под пальцем.
    const faceKey = `${hero.cls}:${hero.id}`;
    if (faceKey !== this.faceKey) {
      this.faceKey = faceKey;
      this.face.innerHTML = avatarSvg(hero.cls, hero.id);
    }

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

    this.gear.sync(gear, offhand);

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
