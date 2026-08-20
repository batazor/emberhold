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
import { TIER_NAME, TIER_RISK } from '../sim/config';
import {
  CONSUMABLES,
  CONSUMABLE_ORDER,
  CONSUMABLE_SLOTS,
} from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { ONB_HINT } from '../sim/onboarding';
import type { OnbStep } from '../sim/onboarding';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind, Resources } from '../sim/resources';
import { dayAt, regionAt } from '../sim/world';
import type { WorldNode } from '../sim/world';
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
  /** §6.1.6 — стройка стен: карточка открывает панель, дальше жест по земле. */
  onWalls(): void;
}

const BLOCK_TEXT: Record<string, string> = {
  max: 'Максимальный уровень',
  locked: 'Нужен Штаб ур. 2',
  'hq-cap': 'Штаб не пускает выше',
  'slot-busy': 'Слот занят другой стройкой',
  resources: 'Не хватает ресурсов',
};

const GEAR_BLOCK_TEXT: Record<string, string> = {
  max: 'Лучше не бывает',
  'forge-cap': 'Кузница не тянет выше',
  resources: 'Не хватает железа',
};

const RESOURCE_ORDER: readonly ResourceKind[] = ['salt', 'wood', 'iron', 'crystal'];

/**
 * Карта открывается после второй вылазки (`onboarding.html`, `world.html`):
 * она отвечает на скуку, и показанная раньше читается как ещё один экран
 * меню. До этого вылазка идёт в назначенное место — ровно одно решение
 * на экране, как и требует раскадровка.
 */
const mapOpen = (camp: CampState, onb: OnbStep): boolean => onb === 'done' && camp.raids >= 2;

/**
 * Назначенное место первой вылазки: самое дешёвое по ставке из тех, что
 * выпали сегодня. Первый поход не выбирают — его показывают, и он обязан
 * быть самым щадящим из возможных.
 */
function assignedNode(now: number): WorldNode {
  const nodes = regionAt(dayAt(now)).nodes;
  return [...nodes].sort((a, b) => a.tier - b.tier)[0]!;
}

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
  /** Вход в назначенное место — пока карта не открылась. */
  private readonly firstRaid: HTMLButtonElement;
  private readonly shopButtons = new Map<ConsumableId, HTMLButtonElement>();
  private readonly banner: HTMLElement;

  private readonly sheet: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetClose: HTMLButtonElement;
  private readonly sections = new Map<string, HTMLElement>();
  /** Раздел «Кузница» — часть карточки Кузницы, а не отдельная витрина. */
  private readonly gearSection: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly tierCard: HTMLElement;
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

    // §20.1 — сток без таймера. Живёт внутри карточки Кузницы: снаряжение
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
    // §11.6 — ставка объявляется до входа, а не выясняется после провала.
    this.tierCard = document.createElement('div');
    this.tierCard.className = 'tier-card';
    // До карты вылазка идёт в одно назначенное место. Карта в первые минуты
    // была бы экраном меню раньше, чем появилась скука, которой она отвечает
    // (`world.html`, часть I; `onboarding.html` — карта после второй вылазки).
    this.firstRaid = document.createElement('button');
    this.firstRaid.addEventListener('click', () => {
      if (this.last !== null) this.cb.onRaid(assignedNode(this.last.now).id);
    });
    this.map = new WorldMap({ onRaid: (node) => this.cb.onRaid(node) });
    tiers.append(this.tierCard, this.firstRaid, this.map.root);
    this.sections.set('tiers', tiers);
    this.sheet.appendChild(tiers);

    /* ---------- нижняя строка ---------- */
    this.bar = document.createElement('div');
    this.bar.className = 'camp-bar';
    // «Стены» стоит рядом с «Отрядом», а не в листе здания: стройка стен —
    // не улучшение постройки, а свой режим со своим жестом, и прятать её
    // внутрь карточки Штаба значило бы соврать про то, чем она является.
    const walls = document.createElement('button');
    walls.textContent = 'Стены';
    walls.addEventListener('click', () => {
      this.close();
      this.cb.onWalls();
    });
    this.bar.append(
      this.makeBarButton('Отряд', 'roster'),
      walls,
      this.makeBarButton('Припасы', 'shop'),
      this.makeBarButton('В вылазку', 'tiers', true),
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
    if (kind === 'tiers' && this.last !== null && mapOpen(this.last.camp, this.onb)) {
      this.map.open(this.last.camp, this.last.now);
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
    if (kind === 'tiers') {
      return this.last !== null && mapOpen(this.last.camp, this.onb) ? 'Карта региона' : 'Вылазка';
    }
    if (kind === 'shop') return 'В вылазку';
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
    const map = mapOpen(camp, this.onb);
    this.map.root.style.display = map ? '' : 'none';
    this.tierCard.style.display = map ? 'none' : '';
    this.firstRaid.style.display = map ? 'none' : '';
    if (map) {
      this.map.sync(camp, now);
      return;
    }
    // Назначенное место: та же карточка, что раньше называла ярус. Ставка
    // и здесь объявлена до входа — молчащая кнопка читается как поломка.
    const node = assignedNode(now);
    this.tierCard.innerHTML =
      `<div class="t"><b>${node.name}</b><span class="dim">${TIER_NAME[node.tier]}</span></div>` +
      `<p class="dim">При провале теряется ${Math.round(TIER_RISK[node.tier] * 100)}% добычи</p>`;
    this.firstRaid.textContent = 'В вылазку';
    this.firstRaid.disabled = false;
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
      row.button.textContent = price === 0 ? 'Достроить' : `Ускорить · соль ${price}`;
      row.button.disabled = price > camp.resources.salt;
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
    // Кадры 9 и 10 сами решают, что открыто: на экране ровно одно действие.
    if (step === 'build') this.openSheet('kitchen');
    else if (step === 'tier') this.openSheet('tiers');
    else if (step === 'done') this.close();
  }

  /**
   * Кадры 9 и 10 (`onboarding.html`): сначала пустое место просит здание,
   * потом выросшая Кухня зовёт на следующий ярус. Ни нижней строки, ни
   * кнопки «Закрыть»: закрывать нечего, действие ровно одно.
   */
  private applyOnboarding(): void {
    const building = this.onb === 'build';
    const leaving = this.onb === 'tier';
    const quiet = building || leaving;

    // Подсказка кадра держится, пока кадр не сменится. Там, где подсказки
    // нет (кадр 10 говорит карточкой яруса), баннер остаётся за обычными
    // сообщениями лагеря.
    const hint = ONB_HINT[this.onb];
    if (hint !== undefined) this.banner.textContent = hint;

    this.bar.style.display = quiet ? 'none' : '';
    this.sheetClose.style.display = quiet ? 'none' : '';
    if (quiet) this.moveButton.style.display = 'none';

    // Подарок кадра 9: кнопка обязана называть цену словом, а не нулём, —
    // «· 0 с» читается как поломка таймера (см. priceLine).
    const kitchen = this.rows.get('kitchen');
    if (building && kitchen !== undefined) {
      kitchen.button.textContent = 'Построить · бесплатно';
      kitchen.button.disabled = false;
      kitchen.button.dataset['mode'] = 'upgrade';
      kitchen.status.textContent = 'Первое здание вырастает сразу';
      kitchen.barWrap.style.display = 'none';
    }

    // Карточка и кнопка вылазки живут в syncTiers: и в кадре 10, и после
    // него это одно и то же — назначенное место, названное до входа.
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
   * Цена и срок одной строкой. Первый уровень бесплатен и мгновенен
   * (§20.3), и «· 0 с» читалось бы как поломка таймера, а не как подарок:
   * ноль в интерфейсе всегда выглядит ошибкой, поэтому он называется словом.
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
