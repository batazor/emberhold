import { formatDuration } from '../core/clock';
import {
  BUILDINGS,
  BUILDING_ORDER,
  BUILD_COST,
  BUILD_SECONDS,
  gearBlock,
  itemCap,
  speedupCost,
  upgradeBlock,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { GEAR, GEAR_COST, GEAR_ORDER, gearLine } from '../sim/gear';
import type { GearSlot } from '../sim/gear';
import {
  CONSUMABLES,
  CONSUMABLE_ORDER,
  CONSUMABLE_SLOTS,
} from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { ONB_HINT } from '../sim/onboarding';
import { dayAt, firstRaidNode } from '../sim/world';
import type { OnbStep } from '../sim/onboarding';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind, Resources } from '../sim/resources';
import { WorldMap } from './worldMap';

/**
 * Лагерь: сцена первая, карточка по тапу.
 *
 * Прежняя версия держала на экране все списки разом — постройки, снаряжение,
 * расходники, отряд и ярусы, — и на телефоне (360×780 у Galaxy, 393×852
 * у iPhone) они закрывали лагерь целиком: игрок видел набор карточек, а не
 * своё поселение. Это противоречит §2 — лагерь это то, ради чего
 * возвращаются, — и той самой раскадровке онбординга, где кадр 9 показывает
 * поляну и ровно одно возможное действие.
 *
 * Отсюда правило этой панели: **постоянно на экране только ресурсы и нижняя
 * строка**. Всё остальное живёт в одном листе, который выезжает снизу по
 * тапу — по зданию в сцене или по кнопке в строке — и уходит по тапу мимо.
 * Одновременно открыт ровно один раздел.
 */
export interface CampCallbacks {
  onUpgrade(id: BuildingId): void;
  onBuyConsumable(id: ConsumableId): void;
  onRefundConsumable(at: number): void;
  onSpeedup(): void;
  /** §4 — идут в место на карте, а не в «ярус»: ярус у места один из трёх чисел. */
  onRaid(node: number): void;
  /** §14 — ковка и улучшение это одно действие: слот один, предмет один. */
  onCraft(slot: GearSlot): void;
  /** §20.4 — перестановка: карточка вооружает режим, дальше тап по клетке. */
  onMove(id: BuildingId): void;
}

const BLOCK_TEXT: Record<string, string> = {
  max: 'Максимальный уровень',
  locked: 'Нужно Жильё ур. 2',
  'hq-cap': 'Жильё не пускает выше',
  'slot-busy': 'Слот занят другой стройкой',
  resources: 'Не хватает ресурсов',
};

const GEAR_BLOCK_TEXT: Record<string, string> = {
  max: 'Лучше не бывает',
  'forge-cap': 'Мастерская не тянет выше',
  resources: 'Не хватает железа',
};

const RESOURCE_ORDER: readonly ResourceKind[] = ['stone', 'wood', 'iron', 'crystal'];

/*
 * Карта региона открыта всегда, с первой же вылазки.
 *
 * Раньше она ждала второй вылазки, а до неё место назначалось само — «ровно
 * одно решение на экране». Держалось это на том, что игрок к моменту выхода
 * из раскадровки не видел ни одного меню; с прологом это перестало быть
 * правдой: пролог сдаёт игрока в лагерь, и в лагере он и так стоит перед
 * нижней строкой из трёх кнопок. Прятать за одной из них ещё один экран,
 * который откроется через две вылазки, — это не «одно решение», а отложенное
 * меню, и назначенное место было его ширмой.
 *
 * Кнопка называется «В мир» и ведёт в мир. Ставка §11.6 при этом объявляется
 * до входа как и прежде — её называет карточка места на самой карте.
 */

/** Что открыто в листе. null — лист закрыт, на экране только лагерь. */
type SheetKind = BuildingId | 'tiers' | 'shop' | 'roster' | null;

const isBuilding = (kind: SheetKind): kind is BuildingId =>
  kind !== null && BUILDING_ORDER.includes(kind as BuildingId);

interface Row {
  readonly box: HTMLElement;
  readonly level: HTMLElement;
  readonly effect: HTMLElement;
  readonly status: HTMLElement;
  readonly barWrap: HTMLElement;
  readonly bar: HTMLElement;
  readonly button: HTMLButtonElement;
}

/**
 * Панель строится один раз и дальше обновляется на месте.
 *
 * Пересборка innerHTML каждый тик выглядит безобидно, но ломает ввод:
 * кнопка, заменённая между нажатием и отпусканием, не даёт события click,
 * и панель просто перестаёт нажиматься. Это стоило одного бага в этапе 3.
 * По той же причине лист не пересоздаёт разделы, а прячет лишние.
 */
export class CampHud {
  private readonly root: HTMLElement;
  /**
   * Место для панелей, которые живут в лагере, но не принадлежат зданиям, —
   * сейчас там отряд (§11.8). Слот, а не прямой доступ к корню: порядок
   * элементов в лагере — решение этой панели, а не того, кто в неё встраивается.
   */
  readonly slot: HTMLElement;
  private readonly resValues = new Map<ResourceKind, HTMLElement>();
  private readonly rows = new Map<BuildingId, Row>();
  private readonly gearRows = new Map<GearSlot, Row>();
  /** Карта региона (§4). Живёт в том же листе, где раньше был список ярусов. */
  private readonly map: WorldMap;
  private readonly shopButtons = new Map<ConsumableId, HTMLButtonElement>();
  private readonly banner: HTMLElement;

  private readonly sheet: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetClose: HTMLButtonElement;
  private readonly sections = new Map<string, HTMLElement>();
  /** Раздел «Мастерская» — часть карточки Мастерской, а не отдельная витрина. */
  private readonly gearSection: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private slots!: HTMLElement;

  private open: SheetKind = null;
  private bannerTimer = 0;
  private onb: OnbStep = 'done';
  /**
   * Последнее, что панель видела в sync. Нужно, чтобы открытый лист красился
   * сразу, а не на следующем тике: лист выезжает по тапу, и пустые строки
   * в нём — даже на один кадр — читаются как поломка.
   */
  private last: { camp: CampState; now: number } | null = null;

  constructor(parent: HTMLElement, private readonly cb: CampCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'camp';

    const res = document.createElement('div');
    res.className = 'panel res';
    for (const kind of RESOURCE_ORDER) {
      const item = document.createElement('span');
      item.className = 'res-item';
      const label = document.createElement('span');
      label.className = 'lbl';
      label.textContent = RESOURCE_NAME[kind];
      const value = document.createElement('b');
      value.textContent = '0';
      item.append(label, value);
      res.appendChild(item);
      this.resValues.set(kind, value);
    }

    this.banner = document.createElement('div');
    this.banner.className = 'hint';

    // Пустая середина — это и есть лагерь. Клики сквозь неё уходят на сцену,
    // иначе тап по зданию не дошёл бы до канваса.
    const space = document.createElement('div');
    space.className = 'camp-space';

    /* ---------- лист ---------- */
    this.sheet = document.createElement('div');
    this.sheet.className = 'panel sheet';
    const head = document.createElement('div');
    head.className = 'sheet-head';
    this.sheetTitle = document.createElement('b');
    this.sheetClose = document.createElement('button');
    this.sheetClose.className = 'ghost sheet-x';
    this.sheetClose.textContent = 'Закрыть';
    this.sheetClose.addEventListener('click', () => this.close());
    head.append(this.sheetTitle, this.sheetClose);
    this.sheet.appendChild(head);

    for (const id of BUILDING_ORDER) {
      const section = document.createElement('div');
      section.className = 'sec';
      section.appendChild(this.makeRow(id));
      this.sections.set(id, section);
      this.sheet.appendChild(section);
    }

    // §20.1 — сток без таймера. Живёт внутри карточки Мастерской: снаряжение
    // делает она, и отдельная вкладка разорвала бы эту связь.
    this.gearSection = document.createElement('div');
    this.gearSection.className = 'gear';
    for (const slot of GEAR_ORDER) this.gearSection.appendChild(this.makeGearRow(slot));
    this.sections.get('forge')?.appendChild(this.gearSection);

    // §20.4 — перестановка бесплатна и мгновенна, поэтому это кнопка
    // в карточке, а не отдельный режим редактирования лагеря.
    this.moveButton = document.createElement('button');
    this.moveButton.className = 'ghost move';
    this.moveButton.textContent = 'Переставить';
    this.moveButton.addEventListener('click', () => {
      if (!isBuilding(this.open)) return;
      this.cb.onMove(this.open);
      this.close();
    });

    // §21: строка, а не магазин. Отдельный экран превратил бы лагерь
    // в витрину, а туда возвращаются смотреть на выросшие постройки.
    const shop = document.createElement('div');
    shop.className = 'sec shop';
    for (const id of CONSUMABLE_ORDER) {
      const b = document.createElement('button');
      b.dataset['buy'] = id;
      b.addEventListener('click', () => this.cb.onBuyConsumable(id));
      shop.appendChild(b);
      this.shopButtons.set(id, b);
    }
    this.slots = document.createElement('div');
    this.slots.className = 'slots';
    shop.appendChild(this.slots);
    this.sections.set('shop', shop);
    this.sheet.appendChild(shop);

    this.slot = document.createElement('div');
    this.slot.className = 'sec camp-slot';
    this.sections.set('roster', this.slot);
    this.sheet.appendChild(this.slot);

    const tiers = document.createElement('div');
    tiers.className = 'sec tiers';
    this.map = new WorldMap({ onRaid: (node) => this.cb.onRaid(node) });
    tiers.append(this.map.root);
    this.sections.set('tiers', tiers);
    this.sheet.appendChild(tiers);

    /* ---------- нижняя строка ---------- */
    this.bar = document.createElement('div');
    this.bar.className = 'camp-bar';
    this.bar.append(
      this.makeBarButton('Отряд', 'roster'),
      this.makeBarButton('Припасы', 'shop'),
      this.makeBarButton('В мир', 'tiers', true),
    );

    this.root.append(res, this.banner, space, this.sheet, this.bar);
    parent.appendChild(this.root);
    this.close();
  }

  private makeBarButton(text: string, kind: SheetKind, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    if (primary) b.className = 'primary';
    // Повторный тап по той же кнопке закрывает лист: кнопка, которая только
    // открывает, вынуждает целиться в «Закрыть».
    b.addEventListener('click', () => (this.open === kind ? this.close() : this.openSheet(kind)));
    return b;
  }

  private makeRow(id: BuildingId): HTMLElement {
    const box = document.createElement('div');
    box.className = 'b';

    // Имя здания стоит в шапке листа, и второй раз оно только шумит:
    // карточка открыта ровно про одно здание.
    const top = document.createElement('div');
    top.className = 'b-top';
    const level = document.createElement('span');
    level.className = 'dim';
    top.append(level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const bar = document.createElement('i');
    bar.className = 'warn';
    barWrap.appendChild(bar);
    barWrap.style.display = 'none';

    const bottom = document.createElement('div');
    bottom.className = 'b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    bottom.append(status, button);

    // Слушатель вешается один раз на живой элемент — он и не переживает
    // перерисовку, потому что перерисовки больше нет.
    button.addEventListener('click', () => {
      if (button.dataset['mode'] === 'speedup') this.cb.onSpeedup();
      else this.cb.onUpgrade(id);
    });

    box.append(top, effect, barWrap, bottom);
    this.rows.set(id, { box, level, effect, status, barWrap, bar, button });
    return box;
  }

  private makeGearRow(slot: GearSlot): HTMLElement {
    const def = GEAR[slot];
    const box = document.createElement('div');
    box.className = 'b';

    const top = document.createElement('div');
    top.className = 'b-top';
    const name = document.createElement('b');
    name.textContent = def.name;
    const level = document.createElement('span');
    level.className = 'dim';
    top.append(name, level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    barWrap.style.display = 'none';
    const bar = document.createElement('i');
    barWrap.appendChild(bar);

    const bottom = document.createElement('div');
    bottom.className = 'b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    bottom.append(status, button);
    button.addEventListener('click', () => this.cb.onCraft(slot));

    box.append(top, effect, bottom);
    this.gearRows.set(slot, { box, level, effect, status, barWrap, bar, button });
    return box;
  }

  /* ---------- лист: открыть, закрыть, назвать ---------- */

  openSheet(kind: SheetKind): void {
    this.open = kind;
    this.sheet.style.display = kind === null ? 'none' : '';
    for (const [key, el] of this.sections) el.style.display = key === kind ? '' : 'none';
    this.sheetTitle.textContent = this.titleFor(kind);
    if (kind === 'tiers' && this.last !== null) {
      this.map.open(this.last.camp, this.last.now);
      // Кадр мог встать до первого `sync`, когда выбирать было ещё не из чего:
      // тогда запирание случается здесь, на открытии листа.
      if (this.onb === 'world') {
        this.map.setOnly(firstRaidNode(dayAt(this.last.now), this.last.now));
      }
    }
    this.paintOpen();
    // Кнопка перестановки принадлежит карточке здания и переезжает в неё:
    // здание всегда одно, а разделов много.
    if (isBuilding(kind)) {
      this.rows.get(kind)?.box.appendChild(this.moveButton);
      this.moveButton.style.display = '';
    } else {
      this.moveButton.style.display = 'none';
    }
  }

  /** Тап по зданию в сцене. Открывает карточку именно этого здания. */
  openBuilding(id: BuildingId): void {
    this.openSheet(id);
  }

  close(): void {
    this.openSheet(null);
  }

  get sheetOpen(): boolean {
    return this.open !== null;
  }

  private titleFor(kind: SheetKind): string {
    if (kind === null) return '';
    if (kind === 'tiers') return 'Карта региона';
    // Заголовок называет ту же кнопку, что открыла лист: «В вылазку» здесь
    // называло кнопку, которой больше нет.
    if (kind === 'shop') return 'Припасы';
    if (kind === 'roster') return 'Отряд';
    return BUILDINGS[kind].name;
  }

  /* ---------- обновление ---------- */

  sync(camp: CampState, now: number, dt: number): void {
    for (const kind of RESOURCE_ORDER) {
      const el = this.resValues.get(kind);
      if (el !== undefined) el.textContent = String(camp.resources[kind]);
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.textContent = '';
    }

    this.last = { camp, now };
    this.paintOpen();
    this.applyOnboarding();
  }

  /**
   * Красится только открытый раздел: остальные не видны, и их пересчёт
   * каждый тик — работа, которой никто не увидит.
   */
  private paintOpen(): void {
    if (this.last === null) return;
    const { camp, now } = this.last;
    if (this.open === 'tiers') this.syncTiers(camp, now);
    else if (this.open === 'shop') this.syncShop(camp);
    else if (isBuilding(this.open)) {
      this.syncBuilding(camp, this.open, now);
      if (this.open === 'forge') this.syncGear(camp);
    }
  }

  private syncTiers(camp: CampState, now: number): void {
    this.map.sync(camp, now);
  }

  private syncShop(camp: CampState): void {
    for (const id of CONSUMABLE_ORDER) {
      const def = CONSUMABLES[id];
      const button = this.shopButtons.get(id);
      if (button === undefined) continue;
      const price = (Object.entries(def.price) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
      button.textContent = `${def.name} · ${price}`;
      button.title = `${def.trigger} → ${def.effect}`;
      const full = camp.loadout.length >= CONSUMABLE_SLOTS;
      const afford = (Object.entries(def.price) as [ResourceKind, number][]).every(
        ([kind, amount]) => camp.resources[kind] >= amount,
      );
      button.disabled = full || !afford;
    }
    this.slots.innerHTML = '';
    for (let i = 0; i < CONSUMABLE_SLOTS; i++) {
      const taken = camp.loadout[i];
      const slot = document.createElement('button');
      slot.className = 'slot' + (taken === undefined ? ' empty' : '');
      slot.textContent = taken === undefined ? 'пусто' : CONSUMABLES[taken].name;
      slot.disabled = taken === undefined;
      if (taken !== undefined) {
        slot.title = 'Вернуть';
        slot.addEventListener('click', () => this.cb.onRefundConsumable(i));
      }
      this.slots.appendChild(slot);
    }
  }

  private syncBuilding(camp: CampState, id: BuildingId, now: number): void {
    const row = this.rows.get(id);
    if (row === undefined) return;
    const level = camp.levels[id];
    const c = camp.construction;

    if (c !== null && c.building === id) {
      const left = Math.max(0, c.endsAt - now);
      const total = Math.max(1, c.endsAt - c.startedAt);
      const price = speedupCost(left, total);
      row.level.textContent = `ур. ${level} → ${c.toLevel}`;
      row.effect.textContent = BUILDINGS[id].effect(c.toLevel);
      row.barWrap.style.display = '';
      row.bar.style.width = `${((1 - left / total) * 100).toFixed(1)}%`;
      row.status.textContent = formatDuration(left);
      row.button.dataset['mode'] = 'speedup';
      // §20.5 — последние пять минут бесплатны.
      row.button.textContent = price === 0 ? 'Достроить' : `Ускорить · камень ${price}`;
      row.button.disabled = price > camp.resources.stone;
      return;
    }

    const block = upgradeBlock(camp, id);
    // Уровень 0 — не «ур. 0», а пустое место: цифра тут врала бы.
    row.level.textContent = level > 0 ? `ур. ${level}` : 'не построена';
    row.effect.textContent = BUILDINGS[id].effect(level);
    row.barWrap.style.display = 'none';
    row.button.dataset['mode'] = 'upgrade';
    row.button.textContent = level > 0 ? 'Улучшить' : 'Построить';
    row.button.disabled = block !== 'ok';
    row.status.textContent =
      block === 'ok' || block === 'resources'
        ? this.priceLine(level + 1)
        : (BLOCK_TEXT[block] ?? '');
  }

  /** Снаряжение. Компромисс слота показывается всегда, а не только когда
   *  предмет надет: §14 требует, чтобы цена была видна до покупки. */
  private syncGear(camp: CampState): void {
    const open = camp.levels.forge > 0;
    this.gearSection.style.display = open ? '' : 'none';
    if (!open) return;
    for (const slot of GEAR_ORDER) {
      const row = this.gearRows.get(slot);
      if (row === undefined) continue;
      const level = camp.gear[slot];
      const block = gearBlock(camp, slot);
      row.level.textContent = level > 0 ? `ур. ${level} / ${itemCap(camp.levels.forge)}` : '—';
      row.effect.textContent = `${gearLine(slot, level)} · ${GEAR[slot].tradeoff}`;
      row.button.textContent = level > 0 ? 'Улучшить' : 'Выковать';
      row.button.disabled = block !== 'ok';
      row.status.textContent =
        block === 'ok' || block === 'resources'
          ? this.gearCostLine(level + 1)
          : (GEAR_BLOCK_TEXT[block] ?? '');
    }
  }

  /* ---------- онбординг ---------- */

  /** Кадр онбординга. 'done' возвращает лагерь в обычный вид. */
  setOnboarding(step: OnbStep): void {
    if (this.onb === step) return;
    this.onb = step;
    // §16.2 — на кадре `world` карта открыта одним местом: игрок не видел
    // ни боя, ни ран, и «выбирай из двадцати» здесь не выбор, а рулетка.
    // Место называет `firstRaidNode`, а не карта: она про кадры не знает.
    if (step === 'world' && this.last !== null) {
      this.map.setOnly(firstRaidNode(dayAt(this.last.now), this.last.now));
    } else if (step !== 'world') {
      this.map.setOnly(null);
    }
    // Кадры 9 и 10 сами решают, что открыто: на экране ровно одно действие.
    // Оба последних кадра говорят одной карточкой — Мастерской: сначала она
    // просит камень, потом показывает, что на него куплено. Разводить их
    // по разным разделам значило бы прятать ответ на вопрос, который кадр
    // только что задал.
    if (step === 'build' || step === 'craft') this.openSheet('forge');
    else if (step === 'done') this.close();
  }

  /**
   * Два последних кадра раскадровки: Мастерская просит камень, потом
   * показывает ковку. Ни нижней строки, ни кнопки «Закрыть»: закрывать
   * нечего, действие ровно одно.
   */
  private applyOnboarding(): void {
    /*
     * «Тихий» кадр прячет нижнюю строку, чтобы на экране осталось ровно одно
     * действие. На кадре `build` это можно делать только тогда, когда это
     * действие вправду есть: Мастерская теперь стоит камня, и первой вылазки
     * на неё хватает не всем (замер: четырём из пяти). Тому, кому не хватило,
     * спрятанная строка запирает единственный выход — вторую вылазку.
     *
     * Поэтому строка прячется по кошельку, а не по номеру кадра.
     */
    const affordable =
      this.last !== null && upgradeBlock(this.last.camp, 'forge') === 'ok';
    const quiet = (this.onb === 'build' && affordable) || this.onb === 'craft';

    // Подсказка кадра держится, пока кадр не сменится.
    const hint = ONB_HINT[this.onb];
    if (hint !== undefined) this.banner.textContent = hint;

    this.bar.style.display = quiet ? 'none' : '';
    this.sheetClose.style.display = quiet ? 'none' : '';
    if (quiet) this.moveButton.style.display = 'none';

    // Цену кадр не переписывает и подарка не делает: Мастерская стоит камня,
    // и обычная строка цены (`priceLine`) называет его сама. Прежний кадр
    // подменял здесь кнопку на «Построить · бесплатно» — бесплатных зданий
    // в игре больше нет ни одного.
    //
    // Кадр держится за постройку, а не за экран: игрок, ушедший во вторую
    // вылазку за недостающим камнем, возвращается на тот же кадр.
  }

  /* ---------- мелочи ---------- */

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  notify(text: string): void {
    this.banner.textContent = text;
    this.bannerTimer = 4;
  }

  /**
   * Цена и срок одной строкой. Первый уровень мгновенен (§20.2), и «· 0 с»
   * читалось бы как поломка таймера: ноль в интерфейсе всегда выглядит
   * ошибкой, поэтому он называется словом.
   *
   * Ветка «бесплатно» осталась не про здания — у всех уровней есть цена
   * (§20.3), — а про то, что строка обязана уцелеть, если цена когда-нибудь
   * окажется пустой: молчащий ценник хуже честного слова.
   */
  private priceLine(level: number): string {
    const cost = this.costLine(level);
    const seconds = BUILD_SECONDS[level] ?? 0;
    if (cost === '' && seconds === 0) return 'бесплатно · сразу';
    return `${cost === '' ? 'бесплатно' : cost} · ${
      seconds === 0 ? 'сразу' : formatDuration(seconds)
    }`;
  }

  private costLine(level: number): string {
    const cost = BUILD_COST[level];
    if (cost === undefined) return '';
    return (Object.entries(cost) as [ResourceKind, number][])
      .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
      .join(' · ');
  }

  private gearCostLine(level: number): string {
    const cost = GEAR_COST[level];
    if (cost === undefined) return '';
    return (Object.entries(cost) as [ResourceKind, number][])
      .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
      .join(' · ');
  }

  /** Итог вылазки: что зачислено на склад. */
  static resourceSummary(res: Resources): string {
    const parts = RESOURCE_ORDER.filter((k) => res[k] > 0).map(
      (k) => `${RESOURCE_NAME[k]} ${res[k]}`,
    );
    return parts.length > 0 ? parts.join(' · ') : 'пусто';
  }
}
