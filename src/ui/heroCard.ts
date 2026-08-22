import { formatDuration } from '../core/clock';
import { HERO_CLASSES, healSeconds } from '../sim/heroes';
import type { HeroState, Roster } from '../sim/heroes';
import { avatarSvg } from './avatar';
import { revealCard } from './cardReveal';

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
 * **Карточка — меню, разбор живёт отдельно.** Развёрнутая карточка стояла
 * на лагере постоянно и накрывала четверть кадра — сцена читалась из-под
 * панели. Потом разбор прятался за команду «О персонаже» и раскрывался
 * на месте, в 172 пикселя ширины: характеристики, опыт, умение, Плац
 * и пять слотов помещались туда только тем, что мельчали.
 *
 * Теперь та же команда открывает страницу персонажа
 * (`features/character`) — целый экран поверх лагеря, один на героя
 * и жильца. Здесь остаётся ровно то, ради чего в карточку смотрят, не
 * отрываясь от сцены: кто это и что с ним.
 */
const STATUS_TEXT: Record<string, string> = {
  ready: 'готов',
  raid: 'в вылазке',
  healing: 'лечится',
  training: 'тренируется',
};

export interface HeroCardCallbacks {
  /** Открыть страницу персонажа на этом герое (`features/character`). */
  onAbout(index: number): void;
}

export class HeroCard {
  private readonly root: HTMLElement;
  private readonly face: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
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
      <div class="r-acts"><button id="hc-about">О персонаже</button></div>`;
    const pick = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    this.face = pick('hc-face');
    this.name = pick('hc-name');
    this.status = pick('hc-status');
    pick<HTMLButtonElement>('hc-about').addEventListener('click', () => this.cb.onAbout(this.shown));
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  /** Открыть меню команд на герое: шапка и кнопки. */
  showMenu(): void {
    // Растворение — только на появление из скрытого состояния: при
    // перелистывании героев уже видимая карточка не мерцает заново.
    const wasHidden = this.root.style.display === 'none';
    this.root.style.display = 'flex';
    if (wasHidden) revealCard(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  /** Отступ снизу: карточка стоит над нижней строкой лагеря, как и веер. */
  setBottom(px: number): void {
    this.root.style.bottom = `${px}px`;
  }

  /**
   * Карточка показывает «кто это и что с ним» — имя, уровень строкой имени
   * и состояние. Характеристики, опыт, умение, Плац и снаряжение живут
   * на странице персонажа (`features/character`): туда их увёл не размер
   * карточки, а то, что в 172 пикселя они читались только мелким шрифтом.
   */
  sync(roster: Roster, index: number, now: number): void {
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
