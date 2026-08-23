import { avatarSvg } from '../../ui/avatar';
import type { AvatarLook } from '../../ui/avatar';
import { GearSection } from '../../ui/gearSection';
import type { GearState, Offhand } from '../../sim/gear';
import type { SpendableStat } from '../../sim/heroes';
import { Figure } from '../../render/figureView';
import type { FigureModel } from '../../render/figureView';
import { itemIcon } from '../../render/iconView';
import {
  BAG_CELLS,
  FREE_SLOTS,
  ITEM,
  MAX_FREE_SLOTS,
  SLOTS,
  equip,
  fits,
  inHands,
  slotFor,
  startPack,
  unequip,
} from './items';
import type { PackState } from './items';
import { raidSummary } from './summary';

/**
 * Страница персонажа — то, что открывает команда «О персонаже» на любом
 * человеке лагеря (§6.2: панель, а не второй словарь).
 *
 * **Одна на всех.** Герой и жилец смотрят один экран: разбор — это «кто он
 * и что на нём», а вылазка отличает их не устройством, а тем, кто в неё
 * ходит. Пустые места честны: у жильца нет уровня, и страница говорит это
 * строкой, а не подставляет ноль (§11.7 — характеристика без потребителя
 * не показывается).
 *
 * **Лица в шапке.** Экран открывается на одном, но людей в лагере больше,
 * и сравнивают их не по памяти. Лица — те же, что в веере (§11.8): тап
 * перелистывает разбор, не закрывая его.
 *
 * **Три части, слева направо.** Кто это — фигура со слотами — сумка.
 * Раскладка взята из артбука инвентаря (`inventory.html`): там она проверена
 * пальцем, и повторять её заново незачем.
 *
 * **Вещи в кукле и сумке — макет** (`items.ts`), и это главное, что нужно
 * знать про экран. Настоящее снаряжение игры — пять кованых слотов
 * (`ui/gearSection.ts`, `sim/gear.ts`): они читают состояние лагеря
 * и меняют вылазку. Кукла ничего не меняет: она черновик раскладки,
 * заведённый, чтобы решить, заводить ли предметы вообще. Смешивать их
 * в одну сетку было бы враньём — макетная вещь выглядела бы работающей.
 *
 * Поэтому сводка «что будет в вылазке» считается **только по кованому**
 * и считается формулой самой игры (`gearMods`), а не переписанной сюда
 * табличкой. Она же показывает цену левой руки до того, как рука
 * переложена: обзор против защиты, обе величины рядом (§14.2).
 *
 * **Перетаскивание и тап — одно и то же** (§6: игра управляется тапом).
 * Тащить вещь на слот можно, но не обязательно: короткий тап отправляет её
 * в подходящий слот, а надетую — обратно в сумку. Надетое видно на фигуре:
 * вещь с моделью встаёт человеку в руку.
 */
export interface StatRow {
  readonly name: string;
  readonly key: SpendableStat;
  readonly value: number;
}

/** Лицо в шапке: тот же человек, что в веере, и тот же тап по нему. */
export interface PersonTab {
  readonly key: string;
  readonly name: string;
  readonly look: AvatarLook;
  readonly seed: number;
}

export interface CharacterSubject {
  /** Кто именно: смена перерисовывает лицо, фигуру и раскладку макета. */
  readonly key: string;
  readonly name: string;
  readonly kind: 'герой' | 'жилец';
  readonly look: AvatarLook;
  readonly seed: number;
  readonly status: string;
  readonly good: boolean;
  /** Уровень или `null` — у жильца его нет, и подделывать нечем. */
  readonly level: number | null;
  /** Доля до следующего уровня, 0…1. Отрицательная — полосы нет. */
  readonly xp: number;
  readonly stats: readonly StatRow[];
  /** Нераспределённые очки: при них у строк вырастает «+». */
  readonly points: number;
  /** Умение героя или занятие жильца — одна строка про то, чем он полезен. */
  readonly note: string;
  /** Кнопка Плаца. `null` — тренировать некого (жилец). */
  readonly train: { readonly text: string; readonly disabled: boolean } | null;
  readonly gear: GearState | null;
  readonly offhand: Offhand;
  /** §14.3 — колчан показывается только тому, кто стреляет. */
  readonly ranged: boolean;
  readonly model: FigureModel;
  readonly people: readonly PersonTab[];
}

export interface CharacterPageCallbacks {
  onSpend(key: SpendableStat): void;
  onTrain(): void;
  onOffhand(hand: Offhand): void;
  onPick(key: string): void;
  onClose(): void;
}

/** Размер холста фигуры. Совпадает с колонкой куклы в вёрстке. */
const FIGURE_W = 260;
const FIGURE_H = 320;

/** Размер значка вещи. Меньше клетки: у подписи под ним своя строка. */
const ICON = 34;

export class CharacterPage {
  private readonly root: HTMLElement;
  private readonly face: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly level: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly note: HTMLElement;
  private readonly train: HTMLButtonElement;
  private readonly wornEl: HTMLElement;
  private readonly bagEl: HTMLElement;
  private readonly raid: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly gear: GearSection;
  private readonly figure = new Figure();
  private pack: PackState = startPack();
  /** Чья раскладка сейчас разложена: у другого человека она своя. */
  private packKey = '';
  private faceKey = '';
  private tabsKey = '';
  /** Что нарисовано в сводке: она считается формулой, а не тиком. */
  private raidKey = '';
  private shown: CharacterSubject | null = null;
  private drag: {
    readonly item: string;
    readonly from: { readonly kind: 'сумка' } | { readonly kind: 'слот'; readonly id: string };
    readonly ghost: HTMLElement;
    readonly source: HTMLElement;
    moved: boolean;
    readonly x: number;
    readonly y: number;
  } | null = null;

  constructor(parent: HTMLElement, private readonly cb: CharacterPageCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'character';
    this.root.innerHTML = `
      <div class="panel ch-page">
        <div class="ch-head">
          <span class="face" id="ch-face"></span>
          <span class="ch-who"><b id="ch-name"></b><span id="ch-status" class="dim"></span></span>
          <span class="ch-tabs" id="ch-tabs"></span>
          <span class="ch-level" id="ch-level"></span>
          <button id="ch-close" class="ghost">Закрыть</button>
        </div>
        <div class="bar" id="ch-bar"><i id="ch-xp"></i></div>
        <div class="ch-body">
          <div class="ch-doll">
            <div class="ch-slots" id="ch-worn"></div>
            <div class="ch-fig">
              <div id="ch-canvas"></div>
              <button id="ch-turn" class="ghost">Ракурс лагеря</button>
            </div>
          </div>
          <div class="ch-side" id="ch-side">
            <h3>Сумка</h3>
            <div class="ch-bag" id="ch-bag"></div>
            <h3>Что будет в вылазке · §14</h3>
            <div class="ch-raid" id="ch-raid"></div>
            <h3>Характеристики</h3>
            <div class="ch-stats" id="ch-stats"></div>
            <div class="r-skill" id="ch-note"></div>
            <button id="ch-train"></button>
            <h3>Кованое · §14</h3>
          </div>
        </div>
        <p class="ch-hint" id="ch-hint"></p>
      </div>`;
    const pick = <T extends HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!;
    this.face = pick('ch-face');
    this.tabs = pick('ch-tabs');
    this.name = pick('ch-name');
    this.status = pick('ch-status');
    this.level = pick('ch-level');
    this.bar = pick('ch-bar');
    this.xp = pick('ch-xp');
    this.statsEl = pick('ch-stats');
    this.note = pick('ch-note');
    this.train = pick<HTMLButtonElement>('ch-train');
    this.wornEl = pick('ch-worn');
    this.bagEl = pick('ch-bag');
    this.raid = pick('ch-raid');
    this.hint = pick('ch-hint');
    pick('ch-canvas').appendChild(this.figure.el);

    // Кованые слоты — та же секция, что стояла в карточках (§14.2): механика
    // одна, и второй её набор разошёлся бы с первым молча.
    this.gear = new GearSection((hand) => this.cb.onOffhand(hand));
    pick('ch-side').appendChild(this.gear.el);

    pick<HTMLButtonElement>('ch-close').addEventListener('click', () => this.cb.onClose());
    pick<HTMLButtonElement>('ch-turn').addEventListener('click', () => this.figure.reset());
    this.train.addEventListener('click', () => this.cb.onTrain());
    this.statsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-stat]');
      if (b !== null) this.cb.onSpend(b.dataset['stat'] as SpendableStat);
    });
    this.tabs.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-who]');
      if (b !== null) this.cb.onPick(b.dataset['who'] as string);
    });
    // Тап по фону закрывает: то же, чем закрываются панели лагеря.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.cb.onClose();
    });
    this.bindDrag();
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('on', visible);
    // Покой — клип, и крутится он только под открытым экраном: закрытая
    // страница не имеет права держать кадр.
    if (visible) this.figure.start();
    else this.figure.stop();
  }

  sync(s: CharacterSubject): void {
    this.shown = s;
    if (s.key !== this.faceKey) {
      this.faceKey = s.key;
      this.face.innerHTML = avatarSvg(s.look, s.seed);
    }
    // Раскладка макета своя у каждого человека: чужие вещи на новом лице
    // читались бы как «снаряжение перешло», а перехода никакого нет.
    if (s.key !== this.packKey) {
      this.packKey = s.key;
      this.pack = startPack();
      this.hint.textContent = 'Тащите вещь из сумки на слот — или коротко тапните по ней.';
      this.drawPack();
    }
    const tabsKey = s.people.map((p) => p.key).join(',') + `|${s.key}`;
    if (tabsKey !== this.tabsKey) {
      this.tabsKey = tabsKey;
      this.drawTabs(s);
    }
    this.name.textContent = s.name;
    this.status.textContent = s.status;
    this.status.className = s.good ? 'good' : 'dim';
    this.level.textContent = s.level === null ? s.kind : `${s.kind} · ур. ${s.level}`;
    this.bar.style.display = s.xp < 0 ? 'none' : '';
    this.xp.style.width = `${Math.min(100, Math.max(0, s.xp * 100)).toFixed(1)}%`;

    if (s.stats.length === 0) {
      // Честная пустота вместо выдуманных чисел: у жильца характеристик нет,
      // и страница говорит это словами (§11.7).
      this.statsEl.innerHTML =
        '<span class="dim">Характеристик у жильца игра не считает — есть занятие и крыша.</span>';
    } else {
      this.statsEl.innerHTML =
        s.stats
          .map(
            (row) =>
              `<span class="ch-stat">${row.name} <b>${row.value}</b>${
                s.points > 0 ? `<button class="hc-plus" data-stat="${row.key}">+</button>` : ''
              }</span>`,
          )
          .join('') + (s.points > 0 ? `<span class="ch-stat"><b>очков: ${s.points}</b></span>` : '');
    }
    this.note.textContent = s.note;
    this.train.style.display = s.train === null ? 'none' : '';
    if (s.train !== null) {
      this.train.textContent = s.train.text;
      this.train.disabled = s.train.disabled;
    }
    this.gear.sync(s.gear, s.offhand);
    this.drawRaid(s);
    this.figure.show(s.model, inHands(this.pack), FIGURE_W, FIGURE_H);
  }

  /* ---------- сводка вылазки ---------- */

  /**
   * Что снаряжение сделает в вылазке — формулой игры, а не пересказом.
   * Третьей колонкой стоит цена левой руки: величина, которой у вещи
   * сейчас нет, но она появится, если руку переложить (§14.2). Экран,
   * показывающий только плюс, превращает выбор в «надеть всё».
   */
  private drawRaid(s: CharacterSubject): void {
    if (s.gear === null) {
      this.raid.replaceChildren();
      this.raidKey = '';
      return;
    }
    const key = `${Object.values(s.gear).join(',')}:${s.offhand}:${s.ranged}`;
    if (key === this.raidKey) return;
    this.raidKey = key;
    const summary = raidSummary(s.gear, s.offhand, s.ranged);
    this.raid.innerHTML = summary.rows
      .map(
        (row) =>
          `<span class="dim">${row.name}</span><b>${row.now}</b>` +
          `<i>${row.other === null ? '' : `→ ${row.other} ${summary.withOther}`}</i>`,
      )
      .join('');
  }

  /* ---------- лица в шапке ---------- */

  private drawTabs(s: CharacterSubject): void {
    this.tabs.replaceChildren(
      ...s.people.map((p) => {
        const b = document.createElement('button');
        b.className = `face ch-tab${p.key === s.key ? ' on' : ''}`;
        b.dataset['who'] = p.key;
        b.title = p.name;
        b.innerHTML = avatarSvg(p.look, p.seed);
        return b;
      }),
    );
  }

  /* ---------- кукла и сумка ---------- */

  private cell(itemId: string | null, into: HTMLElement): void {
    if (itemId === null) return;
    const item = ITEM.get(itemId);
    if (item === undefined) return;
    const el = document.createElement('div');
    el.className = 'ch-item';
    el.dataset['item'] = itemId;
    // Значок — та же модель, что в руке (`render/iconView.ts`). Вещи без
    // модели остаются подписью: похожая модель читалась бы как «вот эта».
    if (item.icon !== undefined) el.appendChild(itemIcon(item.icon, ICON));
    const label = document.createElement('span');
    label.textContent = item.name;
    el.appendChild(label);
    el.title = `${item.effect} · ${item.cost}`;
    into.appendChild(el);
  }

  private drawPack(): void {
    this.wornEl.replaceChildren(
      ...SLOTS.map((slot) => {
        const el = document.createElement('div');
        el.className = 'ch-slot card';
        el.dataset['slot'] = slot.id;
        el.innerHTML = `<i>${slot.name}</i>`;
        this.cell(this.pack.worn.get(slot.id) ?? null, el);
        return el;
      }),
    );
    // Строка про свободные слоты стоит рядом с ними, а не в комментарии:
    // игрок обязан видеть, что их будет больше и от чего (`items.ts`).
    const note = document.createElement('p');
    note.className = 'ch-free-note dim';
    note.textContent = `Свободных слотов ${FREE_SLOTS} из ${MAX_FREE_SLOTS} — остальные откроют навыки`;
    this.wornEl.appendChild(note);

    this.bagEl.replaceChildren(
      ...Array.from({ length: BAG_CELLS }, (_, at) => {
        const el = document.createElement('div');
        el.className = 'ch-cell card';
        el.dataset['bag'] = String(at);
        this.cell(this.pack.bag[at] ?? null, el);
        return el;
      }),
    );
    // Фигура держит то, что надето: перетаскивание видно на человеке.
    if (this.shown !== null) {
      this.figure.show(this.shown.model, inHands(this.pack), FIGURE_W, FIGURE_H);
    }
  }

  /** Надеть по тапу: вещь идёт в свой слот, надетая — обратно в сумку. */
  private tap(itemId: string, fromSlot: string | null): void {
    const item = ITEM.get(itemId);
    if (item === undefined) return;
    if (fromSlot !== null) {
      this.hint.textContent = unequip(this.pack, fromSlot)
        ? `${item.name} убран в сумку.`
        : 'В сумке нет места.';
      this.drawPack();
      return;
    }
    const slot = slotFor(this.pack, item);
    if (slot === null || !equip(this.pack, itemId, slot.id)) {
      this.hint.textContent = `${item.name} надеть некуда.`;
    } else {
      this.hint.textContent = `${item.name} → ${slot.name.toLowerCase()}. ${item.effect} · ${item.cost}`;
    }
    this.drawPack();
  }

  private drop(itemId: string, slotId: string): void {
    const item = ITEM.get(itemId);
    const slot = SLOTS.find((s) => s.id === slotId);
    if (item === undefined || slot === undefined) return;
    if (!fits(slot, item)) {
      this.hint.textContent = `${item.name} в слот «${slot.name.toLowerCase()}» не встаёт.`;
      return;
    }
    if (!equip(this.pack, itemId, slotId)) {
      this.hint.textContent = 'В сумке нет места для снятого.';
      return;
    }
    this.hint.textContent = `${item.name} → ${slot.name.toLowerCase()}. ${item.effect} · ${item.cost}`;
  }

  /**
   * Перетаскивание пальцем и мышью на одних указателях. Порог в 6 пикселей
   * разводит тап и протяжку: без него всякий тап читался бы промахнувшимся
   * перетаскиванием.
   */
  private bindDrag(): void {
    this.root.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.ch-item');
      if (el === null) return;
      const itemId = el.dataset['item'];
      if (itemId === undefined) return;
      const slot = el.closest<HTMLElement>('.ch-slot')?.dataset['slot'];
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.className = 'ch-item ch-ghost';
      ghost.style.display = 'none';
      this.root.appendChild(ghost);
      this.drag = {
        item: itemId,
        from: slot !== undefined ? { kind: 'слот', id: slot } : { kind: 'сумка' },
        ghost,
        source: el,
        moved: false,
        x: e.clientX,
        y: e.clientY,
      };
      el.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (d === null) return;
      if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      d.source.classList.add('ch-lift');
      d.ghost.style.display = '';
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.ch-slot');
      for (const el of this.wornEl.querySelectorAll('.ch-slot')) el.classList.remove('ok', 'no');
      if (over !== null && over !== undefined) {
        const slot = SLOTS.find((s) => s.id === over.dataset['slot']);
        const item = ITEM.get(d.item);
        if (slot !== undefined && item !== undefined) {
          over.classList.add(fits(slot, item) ? 'ok' : 'no');
        }
      }
    });

    const finish = (e: PointerEvent): void => {
      const d = this.drag;
      if (d === null) return;
      this.drag = null;
      d.ghost.remove();
      d.source.classList.remove('ch-lift');
      for (const el of this.wornEl.querySelectorAll('.ch-slot')) el.classList.remove('ok', 'no');
      if (!d.moved) {
        this.tap(d.item, d.from.kind === 'слот' ? d.from.id : null);
        return;
      }
      const at = document.elementFromPoint(e.clientX, e.clientY);
      const slot = at?.closest<HTMLElement>('.ch-slot')?.dataset['slot'];
      const bag = at?.closest<HTMLElement>('.ch-cell') ?? at?.closest<HTMLElement>('.ch-bag');
      if (slot !== undefined) this.drop(d.item, slot);
      else if (bag !== null && bag !== undefined && d.from.kind === 'слот') {
        this.hint.textContent = unequip(this.pack, d.from.id)
          ? `${ITEM.get(d.item)?.name ?? d.item} убран в сумку.`
          : 'В сумке нет места.';
      } else this.hint.textContent = 'Вещь вернулась на место.';
      this.drawPack();
    };
    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', finish);
  }
}
