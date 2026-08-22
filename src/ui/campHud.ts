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
  UPGRADE_REASON,
  GEAR_REASON,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { ARROW_PACK, ARROW_PACK_COST, canBuyArrows } from '../sim/camp';
import {
  CHEST_BONUS,
  CHEST_COST,
  CHEST_REASON,
  chestBlock,
  storeCapacity,
  storeUsed,
} from '../sim/chests';
import { GEAR, GEAR_COST, GEAR_ORDER, OFFHAND, OFFHAND_ORDER, gearItemLine, gearLine, gearMods } from '../sim/gear';
import type { GearSlot, Offhand } from '../sim/gear';
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
import { TENT_COST, TENT_REASON, homeless, homelessFolk, tentBlock } from '../sim/residents';
import { avatarSvg } from './avatar';
import type { ResourceKind, Resources } from '../sim/resources';
import { Banner } from './banner';
import type { Roster } from '../sim/heroes';
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
  /** §26 — отправить отряд в место без игрока. */
  onSortie(node: number): void;
  /** §14 — ковка и улучшение это одно действие: слот один, предмет один. */
  onCraft(slot: GearSlot): void;
  /** §20.4 — перестановка: карточка вооружает режим, дальше тап по клетке. */
  onMove(id: BuildingId): void;
  /** §6.1.6 — стройка стен: карточка открывает панель, дальше жест по земле. */
  onWalls(): void;
  /** §14.3 — пачка стрел за железо. Единственный способ наполнить колчан. */
  onBuyArrows(): void;
  /** §14.2 — что в левой руке: фонарь или щит. Бесплатно и мгновенно. */
  onOffhand(offhand: Offhand): void;
  /** Поставить палатку жильцу (`sim/residents.ts`). */
  onTent(): void;
  /** Поставить сундук-хранилище (`sim/chests.ts`): карточка вооружает
   *  режим, дальше тап по клетке — тем же жестом, что палатка. */
  onChest(): void;
  /**
   * Лист открылся или закрылся. Панель зовёт это на переходе состояния,
   * а не на каждом `openSheet`: смена раздела внутри открытого листа —
   * не событие для тех, кто снаружи. Нужен он ровно одному слушателю —
   * вееру у большого пальца (`features/fan`): тот рисуется поверх всего
   * слоем и иначе стоит на карточке места, споря с ней за палец и за глаз.
   */
  onSheet(open: boolean): void;
}

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

/** Что открыто в листе. null — лист закрыт, на экране только лагерь.
 *  'store' — кладовая (§13.6): открывается тапом по сундуку в сцене. */
type SheetKind = BuildingId | 'tiers' | 'shop' | 'store' | null;

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
  private readonly resValues = new Map<ResourceKind, HTMLElement>();
  private readonly rows = new Map<BuildingId, Row>();
  private readonly gearRows = new Map<GearSlot, Row>();
  /** Лист кладовой (§13.6): полоса занятости, запас, карточка сундука. */
  private storeLevel!: HTMLElement;
  private storeBarWrap!: HTMLElement;
  private storeBar!: HTMLElement;
  private storeList!: HTMLElement;
  /** Счёт кладовой в полосе ресурсов: «занято/вместимость». */
  private storeMeter!: HTMLElement;
  private chestCount!: HTMLElement;
  private chestEffect!: HTMLElement;
  private chestStatus!: HTMLElement;
  private chestButton!: HTMLButtonElement;
  /** Карта региона (§4). Живёт в том же листе, где раньше был список ярусов. */
  private readonly map: WorldMap;
  /** Отряд, отданный лагерю снаружи (§26): карте он нужен, чтобы знать,
   *  есть ли кого отправить. */
  private roster: Roster | null = null;
  private readonly shopButtons = new Map<ConsumableId, HTMLButtonElement>();
  private readonly banner: HTMLElement;
  private readonly task: HTMLElement;
  private readonly taskFace: HTMLElement;
  private readonly taskWhy: HTMLElement;
  private readonly taskButton: HTMLButtonElement;

  private readonly sheet: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetClose: HTMLButtonElement;
  private readonly sections = new Map<string, HTMLElement>();
  /** Раздел «Мастерская» — часть карточки Мастерской, а не отдельная витрина. */
  private readonly gearSection: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly bar: HTMLElement;
  /**
   * Место для панелей, которые живут в лагере, но не принадлежат зданиям, —
   * сейчас там панель стройки стен. Стоит **над нижней строкой, а не в листе**,
   * и это исправление: раньше слот был разделом листа, а лист под отряд.
   * Кнопка «Стены» закрывает лист и показывает панель — то есть показывала её
   * внутри только что закрытого листа, и не показывала вовсе. Отладочная сцена
   * `?тест=walls` ставит кольцо кодом и мимо этой дыры проходила.
   */
  readonly slot: HTMLElement;
  /** Полоса ресурсов: верхний край экрана, занятый панелью. */
  private readonly res: HTMLElement;
  private slots!: HTMLElement;
  private quiver!: HTMLButtonElement;
  private offhand!: HTMLElement;
  private readonly offhandButtons = new Map<Offhand, HTMLButtonElement>();
  /**
   * Стреляет ли тот, кем сейчас идут. Колчан (§14.3) есть только у стрелка,
   * а класс живёт в ростере, которого лагерь не знает и знать не должен:
   * `CampState` — про постройки и припасы. Поэтому его сообщают снаружи.
   */
  private ranged = false;

  private open: SheetKind = null;
  /** Что говорить игроку и в каком порядке (`banner.ts`). */
  private readonly line = new Banner();
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
    this.res = res;
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
    // Счёт кладовой (§13.6) — пятым в полосе: конечность видна там же,
    // где сами числа, а не только в листе. Тап открывает кладовую —
    // тот же лист, что тап по сундуку в сцене.
    const meter = document.createElement('span');
    meter.className = 'res-item';
    const meterLabel = document.createElement('span');
    meterLabel.className = 'lbl';
    meterLabel.textContent = 'кладовая';
    this.storeMeter = document.createElement('b');
    meter.append(meterLabel, this.storeMeter);
    meter.addEventListener('click', () => this.openStore());
    res.appendChild(meter);

    this.banner = document.createElement('div');
    this.banner.className = 'chip hint';

    /* ---------- задание ---------- */
    // Строка, а не уведомление. Уведомление гаснет через четыре секунды,
    // а «кому-то негде спать» не перестаёт быть правдой оттого, что игрок
    // отвернулся: пока задание открыто, оно обязано быть на экране.
    //
    // И не карточка здания: палатка зданием не является (`residents.ts`),
    // а прятать задание за кнопку нижней строки значило бы прятать
    // единственное, что лагерь сейчас просит.
    this.task = document.createElement('div');
    this.task.className = 'panel task';
    this.task.style.display = 'none';
    // Лицо того, кто ждёт крышу (`ui/avatar.ts`). Задание про человека,
    // и человек в нём — тот же, с которым знакомились на прогалине.
    this.taskFace = document.createElement('div');
    this.taskFace.className = 'face';
    this.taskWhy = document.createElement('span');
    this.taskWhy.className = 'why';
    this.taskButton = document.createElement('button');
    this.taskButton.addEventListener('click', () => this.cb.onTent());
    this.task.append(this.taskFace, this.taskWhy, this.taskButton);

    // Пустая середина — это и есть лагерь. Клики сквозь неё уходят на сцену,
    // иначе тап по зданию не дошёл бы до канваса.
    const space = document.createElement('div');
    space.className = 'camp-space';

    /* ---------- лист ---------- */
    this.sheet = document.createElement('div');
    this.sheet.className = 'panel sheet';
    const head = document.createElement('div');
    head.className = 'row mid sheet-head';
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

    // Кладовая (§13.6) — свой лист: открывается тапом по сундуку в сцене,
    // сундук и есть её лицо. Полоса занятости, запас по видам и карточка
    // постройки нового сундука.
    const store = document.createElement('div');
    store.className = 'sec';
    const storeBox = document.createElement('div');
    storeBox.className = 'b';
    this.storeLevel = document.createElement('span');
    this.storeLevel.className = 'dim';
    const storeTop = document.createElement('div');
    storeTop.className = 'row b-top';
    storeTop.append(this.storeLevel);
    this.storeBarWrap = document.createElement('div');
    this.storeBarWrap.className = 'bar';
    this.storeBar = document.createElement('i');
    this.storeBarWrap.appendChild(this.storeBar);
    this.storeList = document.createElement('div');
    this.storeList.className = 'b-eff';
    storeBox.append(storeTop, this.storeBarWrap, this.storeList);
    store.appendChild(storeBox);
    this.sections.set('store', store);
    this.sheet.appendChild(store);

    const chest = document.createElement('div');
    chest.className = 'card b';
    const chestTop = document.createElement('div');
    chestTop.className = 'row b-top';
    const chestName = document.createElement('b');
    chestName.textContent = 'Сундук';
    this.chestCount = document.createElement('span');
    this.chestCount.className = 'badge';
    chestTop.append(chestName, this.chestCount);
    this.chestEffect = document.createElement('div');
    this.chestEffect.className = 'b-eff';
    const chestBottom = document.createElement('div');
    chestBottom.className = 'row mid b-bot';
    this.chestStatus = document.createElement('span');
    this.chestStatus.className = 'dim';
    this.chestButton = document.createElement('button');
    this.chestButton.className = 'act';
    this.chestButton.textContent = 'Поставить';
    // Лист закрывается, как у перестановки: дальше жест по земле, и сцена
    // обязана быть видна.
    this.chestButton.addEventListener('click', () => {
      this.cb.onChest();
      this.close();
    });
    chestBottom.append(this.chestStatus, this.chestButton);
    chest.append(chestTop, this.chestEffect, chestBottom);
    store.appendChild(chest);

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

    /**
     * §14.3 и §14.2 — колчан и левая рука.
     *
     * Обе механики были написаны, оттестированы и **не подключены ни к одной
     * кнопке**: `buyArrows` и `setOffhand` не звал никто. Колчан начинался
     * пустым и мог только убывать, то есть Лучник всегда дрался со штрафом
     * пустого колчана, а левая рука навсегда оставалась фонарём. Две
     * записанные решения игрок не мог принять вовсе.
     *
     * Место им здесь, а не в листе Мастерской: ковка стоит ресурсов и меняет
     * предмет, а это — сборы перед выходом. Стрелы кончаются каждую вылазку,
     * рука перекладывается бесплатно, и оба вопроса задаются ровно тогда же,
     * когда игрок берёт расходники.
     */
    this.quiver = document.createElement('button');
    this.quiver.addEventListener('click', () => this.cb.onBuyArrows());
    shop.appendChild(this.quiver);

    this.offhand = document.createElement('div');
    this.offhand.className = 'slots';
    for (const hand of OFFHAND_ORDER) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.addEventListener('click', () => this.cb.onOffhand(hand));
      this.offhandButtons.set(hand, b);
      this.offhand.appendChild(b);
    }
    shop.appendChild(this.offhand);
    this.sections.set('shop', shop);
    this.sheet.appendChild(shop);

    const tiers = document.createElement('div');
    tiers.className = 'sec tiers';
    this.map = new WorldMap({
      onRaid: (node) => this.cb.onRaid(node),
      onSortie: (node) => this.cb.onSortie(node),
    });
    tiers.append(this.map.root);
    this.sections.set('tiers', tiers);
    this.sheet.appendChild(tiers);

    this.slot = document.createElement('div');
    this.slot.className = 'sec camp-slot';

    /* ---------- нижняя строка ---------- */
    this.bar = document.createElement('div');
    this.bar.className = 'camp-bar';
    // «Стены» стоит рядом с «Отрядом», а не в листе здания: стройка стен —
    // не улучшение постройки, а свой режим со своим жестом, и прятать её
    // внутрь карточки Штаба значило бы соврать про то, чем она является.
    const walls = document.createElement('button');
    walls.textContent = 'Строительство';
    walls.addEventListener('click', () => {
      this.close();
      this.cb.onWalls();
    });
    this.wallsButton = walls;
    // Кнопки «Отряд» здесь больше нет: отряд переехал в веер у большого
    // пальца (`features/fan`) и стоит на экране постоянно. Лист открывался
    // ради одного вопроса — кем идти, — и на него теперь отвечает лицо
    // под пальцем, без листа и без второго касания.
    this.bar.append(
      walls,
      this.makeBarButton('Припасы', 'shop'),
      this.makeBarButton('В мир', 'tiers', true),
    );

    this.root.append(res, this.banner, this.task, space, this.sheet, this.slot, this.bar);
    parent.appendChild(this.root);
    this.close();
  }

  private wallsButton!: HTMLButtonElement;

  /**
   * Показ кнопки «Стены». В лагере на поляне (§16.1) стены пока не строятся:
   * их рисует только сцена площадки, и кнопка обещала бы механику, которой
   * в кадре нет. Скрыта, а не выключена: заготовка, как HUD прогулки.
   */
  showWalls(show: boolean): void {
    this.wallsButton.style.display = show ? '' : 'none';
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
    top.className = 'row b-top';
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
    bottom.className = 'row mid b-bot';
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
    // Пять предметов подряд — список, и коробка ему нужна общая: `.card`.
    box.className = 'card b';

    const top = document.createElement('div');
    top.className = 'row b-top';
    const name = document.createElement('b');
    name.textContent = def.name;
    const level = document.createElement('span');
    level.className = 'badge';
    top.append(name, level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    barWrap.style.display = 'none';
    const bar = document.createElement('i');
    barWrap.appendChild(bar);

    const bottom = document.createElement('div');
    bottom.className = 'row mid b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    button.className = 'act';
    bottom.append(status, button);
    button.addEventListener('click', () => this.cb.onCraft(slot));

    box.append(top, effect, bottom);
    this.gearRows.set(slot, { box, level, effect, status, barWrap, bar, button });
    return box;
  }

  /* ---------- лист: открыть, закрыть, назвать ---------- */

  openSheet(kind: SheetKind): void {
    const was = this.open !== null;
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
    // На переходе, а не на каждом зове: конструктор закрывает закрытый лист,
    // и слушатель в этот момент ещё не создан.
    if (was !== (kind !== null)) this.cb.onSheet(kind !== null);
  }

  /** Тап по зданию в сцене. Открывает карточку именно этого здания. */
  openBuilding(id: BuildingId): void {
    this.openSheet(id);
  }

  /** Тап по сундуку в сцене (§13.6): сундук — лицо кладовой. */
  openStore(): void {
    this.openSheet('store');
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
    if (kind === 'store') return 'Кладовая';
    return BUILDINGS[kind].name;
  }

  /* ---------- обновление ---------- */

  /**
   * Сколько экрана занято панелью сверху и снизу, в пикселях. Середина
   * между ними принадлежит сцене (`camp-space`), и всё, что встаёт поверх
   * лагеря, обязано умещаться туда, а не на кнопки.
   *
   * Считается по живым прямоугольникам, а не по константам вёрстки: высота
   * полосы зависит от безопасной зоны телефона, от строки задания и от того,
   * говорит ли сейчас баннер. Константа разошлась бы с вёрсткой молча.
   */
  bands(): { top: number; bottom: number } {
    const low = [this.res, this.banner, this.task]
      .filter((el) => el.offsetParent !== null)
      .reduce((y, el) => Math.max(y, el.getBoundingClientRect().bottom), 0);
    const bar = this.bar.getBoundingClientRect();
    return {
      top: Math.round(low),
      bottom: Math.round(Math.max(0, window.innerHeight - bar.top)),
    };
  }

  sync(camp: CampState, now: number, dt: number): void {
    for (const kind of RESOURCE_ORDER) {
      const el = this.resValues.get(kind);
      if (el !== undefined) el.textContent = String(camp.resources[kind]);
    }
    this.storeMeter.textContent = `${storeUsed(camp)}/${storeCapacity(camp)}`;

    this.line.tick(dt);

    this.syncTask(camp);

    this.last = { camp, now };
    this.paintOpen();
    this.applyOnboarding();
  }

  /**
   * Строка задания. Красится в общем `sync`, а не в `paintOpen`: она видна
   * всегда, а не в открытом разделе, — в этом и смысл задания.
   *
   * Кнопка не гаснет молча. Когда палатку поставить нельзя, причина стоит
   * рядом словом — то же правило, что у `siteBlock` (§16.1) и у погасших
   * точек карты (§16.2): отказ обязан называть, чего не хватает.
   */
  private syncTask(camp: CampState): void {
    const need = homeless(camp);
    this.task.style.display = need === 0 ? 'none' : 'flex';
    if (need === 0) return;
    // Имя вместо «гостя»: человек, которого позвали, стоит в лагере
    // с именем и лицом, и звать его в задании гостем — значит забыть
    // знакомство, ради которого он и пришёл.
    //
    // Строка нарочно именительная. «Гите негде спать» требует дательного,
    // а склонять имена из пула (§0.1) неоткуда: «Гость 2 негде спать» уже
    // получилось и читалось поломкой. Двоеточие обходит падеж целиком
    // и работает с любым именем.
    const first = homelessFolk(camp)[0];
    const who = first?.name ?? 'гость';
    this.taskWhy.textContent = need === 1 ? `Без крыши: ${who}` : `Без крыши: ${who} и ещё ${need - 1}`;
    const face = first === undefined ? '' : `${first.look}/${first.seed}`;
    if (this.taskFace.dataset['who'] !== face) {
      this.taskFace.dataset['who'] = face;
      this.taskFace.innerHTML = first === undefined ? '' : avatarSvg(first.look, first.seed);
      this.taskFace.style.display = first === undefined ? 'none' : '';
    }
    const block = tentBlock(camp);
    this.taskButton.textContent = `Палатка · ${this.costLine(0, TENT_COST)}`;
    this.taskButton.disabled = block !== 'ok';
    // Название причины дописывается к поводу, а не заменяет его: игрок
    // должен видеть и что просят, и почему нельзя, — одно без другого
    // это либо задание без выхода, либо отказ без повода.
    if (block !== 'ok') this.taskWhy.textContent += ` · ${TENT_REASON[block]}`;
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
    else if (this.open === 'store') this.syncStore(camp);
    else if (isBuilding(this.open)) {
      this.syncBuilding(camp, this.open, now);
      if (this.open === 'forge') this.syncGear(camp);
    }
  }

  private syncTiers(camp: CampState, now: number): void {
    this.map.sync(camp, now, this.roster ?? { heroes: [], active: 0 });
  }

  /**
   * §26 — карте нужен отряд: отправлять некого решает ростер, а лагерь про
   * героев не знает (см. `setRanged` — тот же случай и та же причина).
   */
  setRoster(roster: Roster): void {
    this.roster = roster;
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
    /**
     * §14.3 — колчан. Вместимость даёт лук (`gearMods`), и без лука строка
     * не показывается вовсе: у ближника колчан не значит ничего, а кнопка,
     * которая ничего не делает, хуже отсутствующей.
     */
    const cap = this.ranged ? gearMods(camp.gear, camp.offhand).arrows : 0;
    this.quiver.style.display = cap > 0 ? '' : 'none';
    if (cap > 0) {
      const price = (Object.entries(ARROW_PACK_COST) as [ResourceKind, number][])
        .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
        .join(' · ');
      this.quiver.textContent = `Стрелы ${camp.arrows} / ${cap} · +${ARROW_PACK} · ${price}`;
      this.quiver.title = 'Колчан пустеет за вылазку — донесённое возвращается в лагерь';
      this.quiver.disabled = !canBuyArrows(camp, cap);
    }

    /**
     * §14.2 — левая рука. Выбор бесплатный и мгновенный: он обязан
     * пересматриваться перед каждым выходом, иначе слот теряет смысл.
     * Уровень у обоих предметов один и тот же — кован слот, а не предмет.
     */
    const level = camp.gear.torch;
    this.offhand.style.display = level > 0 ? '' : 'none';
    for (const hand of OFFHAND_ORDER) {
      const b = this.offhandButtons.get(hand);
      if (b === undefined) continue;
      const def = OFFHAND[hand];
      b.textContent = def.name;
      b.title = gearItemLine(def, level);
      b.className = 'slot' + (camp.offhand === hand ? '' : ' empty');
      b.disabled = camp.offhand === hand;
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
        : UPGRADE_REASON[block];
  }

  /** Лист кладовой (§13.6): занятость, запас по видам, карточка сундука. */
  private syncStore(camp: CampState): void {
    const used = storeUsed(camp);
    const cap = storeCapacity(camp);
    this.storeLevel.textContent = `Занято ${used} из ${cap}`;
    this.storeBar.style.width = `${Math.min(100, (used / Math.max(1, cap)) * 100).toFixed(1)}%`;
    // Переполненный старый сейв — полоса тревоги: приток стоит, пока не потратят.
    this.storeBar.className = used >= cap ? 'warn' : '';
    this.storeList.textContent = RESOURCE_ORDER
      .map((kind) => `${RESOURCE_NAME[kind]} ${camp.resources[kind]}`)
      .join(' · ');

    const block = chestBlock(camp);
    this.chestCount.textContent = `×${camp.chests.length}`;
    this.chestEffect.textContent = `Кладовая +${CHEST_BONUS} за каждый`;
    this.chestButton.disabled = block !== 'ok';
    this.chestStatus.textContent =
      block === 'ok' || block === 'resources'
        ? `дерево ${CHEST_COST.wood ?? 0}`
        : CHEST_REASON[block];
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
          : GEAR_REASON[block];
    }
  }

  /* ---------- онбординг ---------- */

  /** Кадр онбординга. 'done' возвращает лагерь в обычный вид.
   *  `restore` — восстановление вида (загрузка, вход в сцену), а не переход:
   *  одноразовые жесты кадра при нём не повторяются. */
  setOnboarding(step: OnbStep, restore = false): void {
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
    // Карточка Мастерской открывается на живом переходе кадра, а не при
    // каждом входе в лагерь: самооткрытие на загрузке читалось поломкой.
    if ((step === 'build' || step === 'craft') && !restore) this.openSheet('forge');
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
    /*
     * У кадра `craft` тот же капкан, и он злее: ковать нечем по построению —
     * первый предмет стоит железа, а ярус 1 ещё заперт Кухней (§13.5).
     * Спрятанная строка отняла бы «В мир», то есть единственный путь
     * к торговцу, у которого это железо и берут. Кадр молчит только тогда,
     * когда ковка вправду доступна.
     */
    const canForge =
      this.last !== null && GEAR_ORDER.some((slot) => gearBlock(this.last!.camp, slot) === 'ok');
    const quiet = (this.onb === 'build' && affordable) || (this.onb === 'craft' && canForge);

    // Подсказка кадра держится, пока кадр не сменится, — но не поверх
    // сообщения: сообщение живёт секунды, кадр живёт до следующего кадра.
    // Кадр без подсказки не оставляет чужую: на `done` онбординг кончился,
    // и последняя его строка не имеет права висеть до конца игры.
    this.line.setSticky(ONB_HINT[this.onb] ?? '');
    this.banner.textContent = this.line.text;

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

  /**
   * Кем идут: стрелок или ближник. Меняет только то, показывать ли колчан —
   * §14.3 у ближника не значит ничего, и строка «Стрелы 0 / 2» у Рыцаря
   * была бы обещанием механики, которой у него нет.
   */
  setRanged(ranged: boolean): void {
    if (this.ranged === ranged) return;
    this.ranged = ranged;
    this.paintOpen();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  /** Виден ли лагерный интерфейс. Спрашивает вёрстку, а не свой флаг:
   *  второй флаг рядом с `display` разошёлся бы с ним молча. */
  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Сказать игроку строку. Строки не спорят за одно поле, а становятся
   * в очередь (`banner.ts`): пришедшие в один тик показываются по очереди,
   * а не последней выигравшей.
   */
  notify(text: string): void {
    this.line.push(text);
    this.banner.textContent = this.line.text;
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

  /**
   * Цена строкой. Второй довод — готовая цена: у палатки её нет в лестнице
   * `BUILD_COST`, а строка обязана выглядеть той же, что у зданий, — иначе
   * два ценника в одном лагере читаются двумя разными валютами.
   */
  private costLine(level: number, ready?: Partial<Resources>): string {
    const cost = ready ?? BUILD_COST[level];
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
