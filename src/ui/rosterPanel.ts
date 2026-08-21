import { formatDuration } from '../core/clock';
import {
  HERO_CLASSES,
  SKILLS,
  healSeconds,
  raidBlock,
  stats,
  trainBlock,
  trainPerLevel,
  trainCap,
  xpToNext,
} from '../sim/heroes';
import type { HeroState, Roster } from '../sim/heroes';

/**
 * Отряд (§11.8, раскадровка `heroes.html`, кадры 04–07).
 *
 * Панель отвечает ровно на один вопрос — **кем я иду сейчас**, — поэтому
 * строки сортированы по готовности, а не по силе, и занятый герой показывает
 * время, а не серую заглушку. Характеристики живут в раскрытой строке:
 * в списке они не решают ничего, а место занимают.
 *
 * Панель строится один раз и обновляется на месте — по той же причине, что и
 * CampHud: кнопка, заменённая между нажатием и отпусканием, не даёт click.
 */
export interface RosterCallbacks {
  onSelect(index: number): void;
  onTrain(index: number): void;
}

interface Row {
  readonly box: HTMLElement;
  readonly name: HTMLElement;
  readonly meta: HTMLElement;
  readonly status: HTMLElement;
  readonly xpWrap: HTMLElement;
  readonly xp: HTMLElement;
  readonly skill: HTMLElement;
  readonly pick: HTMLButtonElement;
  readonly train: HTMLButtonElement;
}

const STATUS_TEXT: Record<string, string> = {
  ready: 'готов',
  raid: 'в вылазке',
  healing: 'лечится',
  training: 'тренируется',
};

const TRAIN_TEXT: Record<string, string> = {
  cap: 'потолок — на два ниже лучшего',
  busy: 'занят',
  'slot-busy': 'тренировочный слот занят',
  max: 'максимальный уровень',
  'no-yard': 'нужен Плац',
};

export class RosterPanel {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;
  private readonly rows: Row[] = [];
  private built = 0;

  constructor(parent: HTMLElement, private readonly cb: RosterCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'roster';
    this.root.className = 'panel';

    this.head = document.createElement('div');
    this.head.className = 'lbl';
    this.head.textContent = 'Отряд';

    this.list = document.createElement('div');
    this.list.className = 'r-list';

    this.root.append(this.head, this.list);
    parent.appendChild(this.root);
  }

  private makeRow(index: number): Row {
    const box = document.createElement('div');
    box.className = 'r';

    const top = document.createElement('div');
    top.className = 'r-top';
    const name = document.createElement('b');
    const status = document.createElement('span');
    status.className = 'dim';
    top.append(name, status);

    const meta = document.createElement('div');
    meta.className = 'r-meta';

    const xpWrap = document.createElement('div');
    xpWrap.className = 'bar';
    const xp = document.createElement('i');
    xpWrap.appendChild(xp);

    const skill = document.createElement('div');
    skill.className = 'r-skill';

    const acts = document.createElement('div');
    acts.className = 'r-acts';
    const pick = document.createElement('button');
    pick.textContent = 'Идти этим';
    pick.addEventListener('click', () => this.cb.onSelect(index));
    const train = document.createElement('button');
    train.textContent = 'Тренировать';
    train.addEventListener('click', () => this.cb.onTrain(index));
    acts.append(pick, train);

    box.append(top, meta, xpWrap, skill, acts);
    this.list.appendChild(box);
    return { box, name, meta, status, xpWrap, xp, skill, pick, train };
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  /**
   * Уровень Плаца приходит числом, а не состоянием лагеря: панель отряда про
   * лагерь ничего не знает и знать не должна. Лазарет сюда не передаётся —
   * остаток лечения уже лежит в `busyUntil`, и пересчитывать его здесь
   * значило бы держать два источника одного числа.
   */
  sync(roster: Roster, now: number, yardLevel = 0): void {
    // Строк ровно столько, сколько героев открыто (§11.8). Запертые классы
    // не показываются: пустой слот с надписью «Жильё ур. 4» — это витрина,
    // а не решение, а витрин в игре нет.
    while (this.built < roster.heroes.length) {
      this.rows.push(this.makeRow(this.built));
      this.built++;
    }
    this.head.textContent = `Отряд · ${roster.heroes.length} из 3`;

    roster.heroes.forEach((hero, i) => {
      const row = this.rows[i];
      if (row === undefined) return;
      const def = HERO_CLASSES[hero.cls];
      const active = roster.active === i;

      row.box.className = `r${active ? ' on' : ''}`;
      row.name.textContent = `${def.name} · ур. ${hero.level}`;
      row.status.textContent = this.statusLine(hero, now);
      row.status.className = hero.status === 'ready' ? 'good' : 'dim';

      // Три характеристики, а не четыре. «Сила» стояла здесь четвёртой
      // и не читалась ничем: ни боем, ни обзором, ни генератором. При этом
      // она различала классы на экране — 4 у Рыцаря, 5 у Лучника, 3
      // у Бандита — и участвовала в выборе героя, не участвуя в игре.
      // Показанное число обязано на что-то влиять; до тех пор строка врёт.
      const s = stats(hero);
      row.meta.textContent =
        `Атака ${s.attack} · Защита ${s.defense} · Знание ${s.knowledge}`;

      const need = xpToNext(hero.level);
      row.xp.style.width = `${Math.min(100, (hero.xp / need) * 100).toFixed(1)}%`;

      const skill = SKILLS[def.skill];
      row.skill.textContent = `${skill.name} — ${skill.effect} · ${def.strong}, ${def.weak}`;

      const block = raidBlock(hero);
      row.pick.disabled = block !== 'ok' || active;
      row.pick.textContent = active ? 'Идёт этим' : 'Идти этим';

      const tb = trainBlock(roster, hero, yardLevel);
      row.train.disabled = tb !== 'ok';
      row.train.textContent =
        hero.status === 'training'
          ? `Тренируется · ${formatDuration(Math.max(0, (hero.busyUntil ?? now) - now))}`
          : tb === 'ok'
            ? `Тренировать · ${formatDuration(trainPerLevel(yardLevel))}`
            : (TRAIN_TEXT[tb] ?? 'Тренировать');
    });

    // Потолок тренировки выведен в шапку: иначе «почему кнопка серая»
    // приходится выяснять по одной строке за раз.
    const cap = trainCap(roster);
    if (roster.heroes.length > 1) {
      this.head.textContent = `Отряд · ${roster.heroes.length} из 3 · тренировка до ур. ${cap}`;
    }
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
