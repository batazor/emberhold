/**
 * Карта региона — вход в вылазку (§4, артбук `world.html`).
 *
 * Заменила список ярусов. Четыре кнопки сравнивать не с чем: ярус там был
 * единственным отличием, и «куда идти» решалось один раз навсегда. Карта
 * существует ровно затем, чтобы у похода была причина выбирать место —
 * и если бы локации были равноценны, её следовало бы вырезать целиком.
 *
 * Что она показывает и чего не показывает — оттуда же:
 * весь регион виден сразу, **без скролла и без тумана войны**. Исследование
 * живёт внутри локации; здесь — сравнение. Ставка, ярус и богатство названы
 * до входа (§1, §11.6), потому что сюрприз после входа читается как обман.
 */
import { tierBlock } from '../sim/camp';
import type { CampState } from '../sim/camp';
import { TIER_RISK } from '../sim/config';
import { LOOT_SHARE } from '../sim/resources';
import type { ResourceKind } from '../sim/resources';
import { effectOf } from '../sim/events';
import type { EventId } from '../sim/events';
import type { Roster } from '../sim/heroes';
import {
  SORTIE_LOOT,
  SORTIE_MAX_TIER,
  sortieBlock,
  sortieSeconds,
} from '../sim/sortie';
import {
  CLANS,
  CLAN_CAMPS,
  RICH_MAX,
  SHIFT_SEC,
  clanGrowth,
  clanState,
  dayAt,
  lootMul,
  regionAt,
  worldAt,
} from '../sim/world';
import { neighboursOpen } from '../sim/clan';
import {
  LIVE_COLOR,
  NO_CLAN,
  campLevel,
  campPower,
  clanPower,
  standings,
  yourPlace,
} from '../sim/standing';
import type { LiveCamp } from '../sim/standing';
import { LIVE_SHOWN, liveCampSpots } from '../sim/world';
import { KIND } from '../sim/world';
import type { NodeKind, NodeState, Region, Visit, WorldNode } from '../sim/world';
import { drawMapTerrain } from './mapTerrain';
import { gameDuration, gameMarkup, gameMessage, gameText, setGameText } from '../i18n/game';
import { eventMessage, resourceMessage, tierMessage } from '../i18n/gameData';

const WORLD_PLACE_PREFIX: Readonly<Record<string, ReturnType<typeof gameMessage>>> = {
  'Замок': gameMessage('Замок', 'Castle'),
  'Замок минотавра': gameMessage('Замок минотавра', 'Minotaur Castle'),
  'Кладбище': gameMessage('Кладбище', 'Graveyard'),
  'Тропа': gameMessage('Тропа', 'Trail'),
  'Колесо': gameMessage('Колесо', 'Prize Wheel'),
};

function worldText(source: string): string {
  const place = /^(.+) «(.+)»$/.exec(source);
  if (place !== null) {
    const prefix = WORLD_PLACE_PREFIX[place[1]!];
    if (prefix !== undefined) return `${gameText(prefix)} “${worldText(place[2]!)}”`;
  }
  return window.EmberholdLanguage?.translate(source) ?? source;
}

/**
 * Цвет кольца у прогулочных мест. Богатства у них нет, и шкала им ни к чему —
 * цвет тут просто называет вид места.
 */
const WALK_COLOR: Partial<Record<NodeKind, string>> = {
  'замок': '#c8a24a',
  'замок минотавра': '#d46a3a',
  'кладбище': '#9fb6d8',
  // Мшистый, а не зелёный богатства (`RICH_COLOR[3]`): кольцо прогулки
  // не имеет права читаться как «полная жила».
  'тропа': '#86a35c',
  // Фиолетовый — единственный не занятый картой цвет: золото у замка,
  // зелёный и красный у богатства, синева у кладбища. Ярмарке достался он.
  'призы': '#a778c9',
};

/**
 * Золото своего лагеря — тот же цвет, каким карта рисует его палатку
 * с первого дня, и та же строка, что у своей строки таблицы (`sim/standing.ts`).
 */
const OWN_CAMP_COLOR = '#c8a24a';

/**
 * Цвет узла по богатству: от выработанной к полной жиле. Наружу выставлен
 * ради замера (`mapTerrain.rules.ts`): фон карты обязан остаться темнее
 * любого из этих четырёх, и проверяется это числом, а не глазами.
 */
export const RICH_COLOR: readonly string[] = ['#d4543a', '#c07a3a', '#c8a24a', '#7fb069'];

/**
 * Цвет глифа события. Единственное на узле, что красится не богатством:
 * событие обязано читаться и на выработанной точке, где кольцо уже красное.
 */
/**
 * С какой ставки вход перестаёт быть обычным и кнопка краснеет.
 *
 * Шестьдесят процентов — не подобранное число: артбук `world.html` красит
 * оранжевым ровно два входа, «В Сухое русло — ставка 60%» и «Войти в бурю»
 * (60% → 85%), и оба стоят на `TIER_RISK[2]` и выше. Тридцать процентов
 * в том же артбуке остаются золотой кнопкой.
 */
const DANGER_STAKE = 0.6;

const EVENT_COLOR: Record<EventId, string> = {
  storm: '#e2a33c',
  collapse: '#d4543a',
  quiet: '#7fb069',
  vein: '#e8e2d4',
};

/** Иллюстрации карты нарисованы с прозрачным фоном: кольцо под ними всё ещё
 * несёт ярус и богатство, а сам рисунок называет место или событие. */
const EVENT_ICON_URL: Record<EventId, string> = {
  storm: new URL('../../assets/world-map-icons/storm.png', import.meta.url).href,
  collapse: new URL('../../assets/world-map-icons/collapse.png', import.meta.url).href,
  quiet: new URL('../../assets/world-map-icons/quiet.png', import.meta.url).href,
  vein: new URL('../../assets/world-map-icons/vein.png', import.meta.url).href,
};

/** Полноразмерные иллюстрации живут в карточке, а не на самой карте: у точки
 * остаётся только компактный знак, а последствия события читаются до входа. */
const EVENT_CARD_URL: Record<EventId, string> = {
  storm: new URL('../../assets/event-cards/storm.png', import.meta.url).href,
  collapse: new URL('../../assets/event-cards/collapse.png', import.meta.url).href,
  quiet: new URL('../../assets/event-cards/quiet.png', import.meta.url).href,
  vein: new URL('../../assets/event-cards/vein.png', import.meta.url).href,
};

const LOCATION_ICON_URL: Record<NodeKind, string> = {
  'вылазка': new URL('../../assets/world-map-icons/expedition.png', import.meta.url).href,
  'замок': new URL('../../assets/world-map-icons/castle.png', import.meta.url).href,
  // Своей иллюстрации у замка минотавра нет — рисунок замка общий, а угрозу
  // называет значок-череп в кольце и оранжевый цвет самого кольца.
  'замок минотавра': new URL('../../assets/world-map-icons/castle.png', import.meta.url).href,
  'кладбище': new URL('../../assets/world-map-icons/graveyard.png', import.meta.url).href,
  'тропа': new URL('../../assets/world-map-icons/trail.png', import.meta.url).href,
  'призы': new URL('../../assets/world-map-icons/prizes.png', import.meta.url).href,
};

/**
 * Глифы событий (§11.6). Прямые грани, без скруглений и полутонов — то же
 * правило, по которому нарисована шестерня настроек, и то же плоское
 * затенение, что у всего в игре (§6.1).
 *
 * Рисуются отрезками в долях `u` — четверти радиуса узла, — чтобы глиф ехал
 * вместе с картой при любом размере экрана.
 *
 * Место глифа — левый верх узла. Нутро занято крестом выработанной, правый
 * верх — флагом клана, кольцо несёт разом богатство (цветом) и ярус
 * (толщиной). Шесть каналов на одной точке — это потолок, и седьмому здесь
 * места уже нет.
 */
const GLYPH: Record<EventId, (ctx: CanvasRenderingContext2D, u: number) => void> = {
  // Буря — три косые штриха одного наклона: ветер, а не молния.
  storm: (ctx, u) => {
    for (let i = -1; i <= 1; i++) {
      const d = i * u * 0.7;
      ctx.moveTo(-u + d, u * 0.55);
      ctx.lineTo(d, -u * 0.55);
    }
  },
  // Обвал — три ступени вниз: то, что осело, а не то, что стоит. Сплошной
  // треугольник на десяти пикселях слипался в пятно и читался как флаг клана.
  collapse: (ctx, u) => {
    ctx.moveTo(-u, -u * 0.7);
    ctx.lineTo(-u, 0);
    ctx.lineTo(0, 0);
    ctx.lineTo(0, u * 0.7);
    ctx.lineTo(u, u * 0.7);
  },
  // Тихая ночь — чаша: две стенки и дно. Дуга здесь не годится, круг уже
  // занят самим узлом.
  quiet: (ctx, u) => {
    ctx.moveTo(-u, -u * 0.7);
    ctx.lineTo(-u * 0.75, u * 0.7);
    ctx.lineTo(u * 0.75, u * 0.7);
    ctx.lineTo(u, -u * 0.7);
  },
  // Жила — ромб. Пустой: черта внутри на этом размере съедала контур,
  // и ромб переставал отличаться от квадратного флага клана.
  vein: (ctx, u) => {
    ctx.moveTo(0, -u);
    ctx.lineTo(u * 0.8, 0);
    ctx.lineTo(0, u);
    ctx.lineTo(-u * 0.8, 0);
    ctx.closePath();
  },
};

/**
 * Нарисовать глиф события у точки. Вынесено из `draw()` затем, что тем же
 * кодом его рисует артбук `world.html`: две копии одной арифметики разошлись
 * бы молча, а глиф — это то, по чему игрок решает, идти ли.
 */
export function drawEventGlyph(
  ctx: CanvasRenderingContext2D,
  id: EventId,
  x: number,
  y: number,
  r: number,
  w = Infinity,
  h = Infinity,
): void {
  // Размер измерен глазами, а не выведен: на узле радиусом 5–9 пикселей
  // (`r = max(5, w * 0.026)`) глиф мельче трети радиуса слипается в пятно.
  const u = Math.max(3, r * 0.62);
  // Точки стоят от 2% ширины (`world.ts`), и у кромки глиф уезжал за канвас
  // наполовину. Зажим оставляет его при своём узле — сдвиг меньше радиуса, —
  // но целым: обрезанный глиф читается как другой глиф.
  const gx = Math.max(u + 1, Math.min(w - u - 1, x - r * 1.3));
  const gy = Math.max(u + 1, Math.min(h - u - 1, y - r * 1.3));
  ctx.save();
  ctx.translate(gx, gy);
  ctx.beginPath();
  GLYPH[id](ctx, u);
  ctx.strokeStyle = EVENT_COLOR[id];
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
}

/**
 * Рисунки точек из Kenney Cartography Pack. `new URL` оставляет тестам
 * обычный file URL, а Vite при сборке встраивает или переносит только семь
 * выбранных PNG и подставляет их адреса. Исходный набор лежит в `assets/`,
 * лицензия CC0 сохранена рядом.
 *
 * Кольцо больше не пытается быть одновременно картинкой места: оно остаётся
 * кругом и несёт только богатство цветом и ярус толщиной. Внутри — отдельная
 * иллюстрация Kenney, поэтому замок не приходится собирать из Canvas-линий,
 * а вылазка наконец выглядит шахтой, а не безымянной точкой.
 */
export const MAP_ICON_URL: Record<NodeKind, string> = {
  'вылазка': new URL('../../assets/kenney-cartography/png/mine.png', import.meta.url).href,
  'замок': new URL('../../assets/kenney-cartography/png/castle.png', import.meta.url).href,
  'замок минотавра': new URL('../../assets/kenney-cartography/png/skull.png', import.meta.url).href,
  'кладбище': new URL('../../assets/kenney-cartography/png/graveyard.png', import.meta.url).href,
  'тропа': new URL('../../assets/kenney-cartography/png/pathCorner.png', import.meta.url).href,
  'призы': new URL('../../assets/kenney-cartography/png/compass.png', import.meta.url).href,
};

export const CAMP_ICON_URL = new URL(
  '../../assets/kenney-cartography/png/tent.png',
  import.meta.url,
).href;

/** Светлая тушь читается на тёмной земле; исходные PNG у Kenney чёрные. */
const MAP_ICON_COLOR = '#e8e2d4';
/** Картинка остаётся внутри кольца и не наступает на событие или флаг. */
export const MAP_ICON_DIAMETER = 1.72;

/** Лагерь на карте — свой, фракции или живого соседа. В узлы не входит:
 *  в лагерь не ходят, и ни яруса, ни богатства у него нет. */
interface MapCamp {
  readonly key: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
}

export interface WorldMapCallbacks {
  /** Игрок выбрал место и решил идти. */
  onRaid(node: number): void;
  /** §26 — то же место, но идёт отряд, а игрок остаётся в лагере. */
  onSortie(node: number): void;
}

/**
 * Почему сюда нельзя. Причина, а не булево, — то же правило, что у построек
 * (`camp.ts`) и у мест под здание в прологе: игрок обязан видеть, что мешает,
 * а не молчащую серую кнопку.
 */
export type EntryBlock = 'ok' | 'kitchen' | 'onb';

const ENTRY_REASON = {
  kitchen: gameMessage('Провианта не хватит на такую глубину — нужна Кухня выше', 'Not enough provisions for this depth—upgrade the Kitchen'),
  onb: gameMessage('Первая вылазка идёт в другое место — оно одно горит на карте', 'The first raid starts elsewhere—the available location is highlighted on the map'),
};

const SORTIE_REASON_MESSAGE = {
  slot: gameMessage('Отряд уже в пути', 'A party is already away'),
  tier: gameMessage('Глубже Яруса 1 отряд один не ходит', 'A party cannot venture beyond Tier 1 alone'),
  hero: gameMessage('Идти некому — все заняты', 'No one is available—everyone is busy'),
} as const;

/**
 * Что падает на ярусе, от частого к редкому. Порог в 10% отсекает то, что
 * игрок за заход скорее всего не увидит: обещать кристалл там, где он капает
 * раз в десять находок, значит продавать ярус тем, чего в нём нет.
 */
const lootLine = (tier: 0 | 1 | 2 | 3): string =>
  (Object.entries(LOOT_SHARE[tier]) as [ResourceKind, number][])
    .filter(([, share]) => share >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => gameMarkup(resourceMessage[kind]))
    .join(' · ');

/**
 * Ростер до первой синхронизации: карточка рисуется раньше, чем ей отдают
 * отряд, и спрашивать у пустоты «есть ли свободный» она обязана без падения.
 */
const EMPTY_ROSTER: Roster = { heroes: [], active: 0 };

/** Доля отправки словами карточки: то же число, что режет добычу (§26). */
const SHARE_TEXT = SORTIE_LOOT.toFixed(1).replace('.', ',');

export class WorldMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly card: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly note: HTMLElement;
  /**
   * §26 — вторая кнопка карточки. Ниже входа и мельче его намеренно:
   * §4.1 называет вход единственным необратимым действием экрана, и отправка
   * этого не меняет — она предлагает то же место на худших условиях.
   * Причина отказа стоит рядом с кнопкой (`.row.tight`, §6.2), а не в общей
   * строке под карточкой: та занята сроком восстановления и отказом входа.
   */
  private readonly sendRow: HTMLElement;
  private readonly send: HTMLButtonElement;
  private readonly sendNote: HTMLElement;
  private readonly markerImages = new Map<string, HTMLImageElement>();

  /** Выбранный узел. Карта открывается с выбранным местом, а не пустой:
   *  пустая карточка вынуждает тапнуть дважды, чтобы вообще что-то узнать. */
  private focus = 0;
  /**
   * Выбранный лагерь (§30): ключ вида `свой`, `клан:2`, `живой:<id>`;
   * `null` — выбран узел, и карточку рисует он. Второе поле, а не значение
   * в `focus`: лагерь не узел — в него не ходят, у него нет ни яруса,
   * ни богатства, и общий номер заставил бы каждую строку карточки
   * спрашивать, кто перед ней. Ровно на этом §4 уже терял кладбище.
   *
   * Ключ строкой, а не номером: соседей опознаёт идентификатор аккаунта,
   * и втискивать его в ту же числовую ось, где живут четыре фракции, значит
   * заводить третью систему нумерации поверх двух.
   */
  private focusCamp: string | null = null;
  /** Регион сегодняшнего дня: завтра здесь будут другие точки (§4). */
  private region: Region = regionAt(0);
  private world: NodeState[] = [];
  /**
   * Метки живых соседей (§30.6). Приходят снаружи и в сохранение не едут:
   * это чужие дельты, а сейв хранит только свои (§4). Пустой список —
   * честный ответ и при отсутствии сети, и при отсутствии соседей: карта
   * в обоих случаях показывает мир без них, ровно как показывала до облака.
   */
  private others: readonly Visit[] = [];
  /**
   * Лагеря живых соседей (§30.7). Как и метки, приходят снаружи и в сейв
   * не едут: это чужие строки общей таблицы, а сохранение хранит своё.
   */
  private live: readonly LiveCamp[] = [];
  private camp: CampState | null = null;
  private roster: Roster | null = null;
  private now = 0;
  /**
   * Единственное место, открытое первой вылазкой (§16.2); null — карта открыта
   * целиком. Ставится снаружи: карта не знает про кадры раскадровки, ей
   * говорят «сегодня можно только сюда».
   */
  private only: number | null = null;

  /** Исходные PNG и их окрашенные копии. Копия нужна потому, что набор
   * нарисован чёрной тушью, а на тёмной земле карты она исчезает. */
  private readonly iconImages = new Map<string, HTMLImageElement>();
  private readonly iconTints = new Map<string, HTMLCanvasElement>();

  constructor(private readonly cb: WorldMapCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'sec map';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-cv';
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('нет 2d-контекста для карты');
    this.ctx = ctx;
    this.canvas.addEventListener('pointerdown', (e) => this.pick(e));
    this.loadMapIcons();
    // Иллюстрации — вторым слоем поверх значков Kenney: маленький значок
    // в кольце живёт всегда, картинка приходит на широком экране и у событий.
    for (const url of [...Object.values(EVENT_ICON_URL), ...Object.values(LOCATION_ICON_URL)]) {
      const image = new Image();
      image.src = url;
      image.addEventListener('load', () => this.paint());
      this.markerImages.set(url, image);
    }

    this.card = document.createElement('div');
    this.card.className = 'card map-card';

    this.note = document.createElement('div');
    this.note.className = 'map-note';

    this.go = document.createElement('button');
    // §4, артбук `world.html`: вход в локацию — единственное необратимое
    // действие на этом экране, и класс у него свой. Прежний `primary`
    // не имел в карте ни одного правила и падал на общую `button`.
    this.go.className = 'cta';
    this.go.addEventListener('click', () => this.cb.onRaid(this.node().id));

    this.sendRow = document.createElement('div');
    this.sendRow.className = 'row tight send';
    this.send = document.createElement('button');
    this.send.className = 'act';
    this.send.addEventListener('click', () => this.cb.onSortie(this.node().id));
    this.sendNote = document.createElement('span');
    this.sendNote.className = 'map-note';
    this.sendRow.append(this.send, this.sendNote);

    this.root.append(this.canvas, this.card, this.note, this.go, this.sendRow);
  }

  /** Загружает семь маленьких файлов один раз. До загрузки остаются кольца;
   * `load` тут же перерисует карту и положит внутрь готовые картинки. */
  private loadMapIcons(): void {
    const urls = new Set([...Object.values(MAP_ICON_URL), CAMP_ICON_URL]);
    for (const url of urls) {
      const image = new Image();
      image.decoding = 'async';
      image.addEventListener('load', () => {
        this.iconTints.clear();
        this.paint();
      });
      image.src = url;
      this.iconImages.set(url, image);
    }
  }

  /** Перекрашивает прозрачный PNG ровной тушью и кеширует результат.
   * Исходные линии и альфа Kenney остаются неизменными. */
  private tintedMapIcon(url: string, color: string): HTMLCanvasElement | null {
    const image = this.iconImages.get(url);
    if (image === undefined || !image.complete || image.naturalWidth === 0) return null;
    const key = `${url}\n${color}`;
    const ready = this.iconTints.get(key);
    if (ready !== undefined) return ready;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.iconTints.set(key, canvas);
    return canvas;
  }

  private drawMapIcon(url: string, x: number, y: number, r: number, color: string): void {
    const icon = this.tintedMapIcon(url, color);
    if (icon === null) return;
    const size = r * MAP_ICON_DIAMETER;
    this.ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
  }

  /** Место, с которого карта открывается: самое богатое из тех, что есть.
   *  Это подсказка, а не выбор за игрока, — рядом видно всё остальное. */
  private defaultFocus(): number {
    const best = [...this.region.nodes].sort(
      (a, b) => (this.world[b.id]?.rich ?? 0) - (this.world[a.id]?.rich ?? 0),
    )[0];
    return best?.id ?? 0;
  }

  private node(): WorldNode {
    return this.region.nodes[this.focus] ?? this.region.nodes[0]!;
  }

  /** Карта открылась: пересчитать мир и встать на разумное место. */
  open(camp: CampState, now: number): void {
    this.camp = camp;
    this.now = now;
    this.region = regionAt(dayAt(now));
    this.world = worldAt(now, camp.visits, this.others);
    this.focus = this.defaultFocus();
    // Карта открывается на месте, а не на лагере: лагерь — то, откуда игрок
    // только что пришёл, и рассказывать ему про себя незачем.
    this.focusCamp = null;
    this.paint();
  }

  sync(camp: CampState, now: number, roster: Roster): void {
    this.camp = camp;
    this.roster = roster;
    // Мир меняется сменами по 40 минут — пересчитывать его каждый кадр
    // незачем, а вот срок восстановления в карточке идёт вживую.
    if (Math.floor(now / SHIFT_SEC) !== Math.floor(this.now / SHIFT_SEC)) {
      this.region = regionAt(dayAt(now));
      this.world = worldAt(now, camp.visits, this.others);
      if (this.focus >= this.region.nodes.length) this.focus = this.defaultFocus();
    }
    this.now = now;
    this.paint();
  }

  private pick(e: PointerEvent): void {
    const box = this.canvas.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    const near = (x: number, y: number): number =>
      Math.hypot((x - px) * box.width, (y - py) * box.height);
    let best = -1;
    let bestDist = Infinity;
    for (const node of this.region.nodes) {
      const d = near(node.x, node.y);
      if (d < bestDist) {
        bestDist = d;
        best = node.id;
      }
    }
    // Лагеря — в том же переборе, а не отдельным: два перебора с разными
    // порогами дали бы точку, которая ловится и тем и другим, и карточка
    // зависела бы от порядка проверок.
    let bestCamp: string | null = null;
    for (const spot of this.camps()) {
      const d = near(spot.x, spot.y);
      if (d < bestDist) {
        bestDist = d;
        bestCamp = spot.key;
      }
    }
    // Промах мимо всего ничего не меняет: карточка обязана оставаться
    // на том месте, о котором игрок только что читал.
    if (bestDist >= box.width * 0.09) return;
    this.focusCamp = bestCamp;
    if (bestCamp === null && best >= 0) this.focus = best;
    this.paint();
  }

  /**
   * Лагеря на карте: свой и соседские (§30). Свой стоит всегда — он и был
   * первой точкой карты; соседи зажигаются со вторым жильцом (`clan.ts`),
   * и до того их не видно даже тапом.
   */
  private camps(): readonly MapCamp[] {
    const own: MapCamp = {
      key: 'свой',
      color: OWN_CAMP_COLOR,
      x: this.region.camp.x,
      y: this.region.camp.y,
    };
    if (this.camp === null || !neighboursOpen(this.camp)) return [own];
    const clans: MapCamp[] = CLAN_CAMPS.map((c) => ({
      key: `клан:${c.id}`,
      color: CLANS[c.id % CLANS.length]!.color,
      x: c.x,
      y: c.y,
    }));
    // Живые — по кромке и подрезанные по числу (`LIVE_SHOWN`): места там
    // ровно столько, сколько лагерей на нём различит палец.
    const live: MapCamp[] = liveCampSpots(this.live.map((c) => c.id)).map((spot) => ({
      key: `живой:${spot.id}`,
      color: LIVE_COLOR,
      x: spot.x,
      y: spot.y,
    }));
    return [own, ...clans, ...live];
  }

  private paint(): void {
    if (this.camp === null || this.region.nodes.length === 0) return;
    this.draw();
    this.paintCard();
  }

  /** Рисуем только готовую картинку: пока Vite-ассет грузится, остаётся
   * прежний геометрический маркер, и карта не мигает пустыми точками. */
  private drawMarker(url: string, x: number, y: number, size: number): boolean {
    const image = this.markerImages.get(url);
    if (image?.complete !== true || image.naturalWidth === 0) return false;
    this.ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    return true;
  }

  /* ---------- карта ---------- */

  private draw(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // `syncTiers` зовёт `draw` только у открытого листа, так что время здесь
    // не заводит ни отдельного таймера, ни работы у закрытой карты.
    const motion = performance.now() / 1000;
    // В 24–32 px детальная иллюстрация становится кляксой. На телефоне
    // оставляем лаконичные силуэты `NODE_ICON` и глиф события — та же
    // семантика, но без ложной мелкой детализации.
    const compact = w < 520 || h < 300;

    const spots = [...this.region.nodes, ...this.camps()];

    // §4.2 — земля под точками. Чёрный экран делал из региона список кружков,
    // разложенный по прямоугольнику; местность делает из него место. Ни одного
    // канала она при этом не несёт и ни на одну точку не наступает — за то
    // и другое отвечает `sim/terrain.ts`.
    drawMapTerrain(ctx, this.region.day, spots, w, h, dpr);

    // Тракт: связи ближних узлов. Без них двадцать точек читаются как список,
    // а не как местность, и «дальше» перестаёт значить «дороже».
    //
    // По земле он светлее, чем по чёрному: на 10% прозрачности линия пропадала
    // в хвое и оставляла точки без связей.
    ctx.strokeStyle = 'rgba(232, 226, 212, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]!;
        const b = spots[j]!;
        if (Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) > w * 0.24) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    }

    const r = Math.max(5, w * 0.026);
    // Лагеря — такие же точки карты, только в них не ходят: свой золотом,
    // соседские цветом своей фракции — тем же, каким её флаг стоит
    // на занятой точке, иначе флаг и лагерь читались бы разными людьми.
    for (const spot of this.camps()) {
      const own = spot.key === 'свой';
      const color = spot.color;
      const x = spot.x * w;
      const y = spot.y * h;
      if (this.focusCamp === spot.key) {
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 162, 74, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 10, 9, 0.85)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      // Палатка Kenney вместо собранного вручную треугольника. Своя золотая,
      // чужие светлые: это разводит свой лагерь и золотой «Клан Отвала»,
      // а цвет фракции остаётся на кольце.
      this.drawMapIcon(CAMP_ICON_URL, x, y, r, own ? color : MAP_ICON_COLOR);
    }

    for (const node of this.region.nodes) {
      const x = node.x * w;
      const y = node.y * h;
      const state = this.world[node.id];
      const color = RICH_COLOR[state?.rich ?? RICH_MAX] ?? '#c8a24a';

      // Запертая точка гаснет, но остаётся на месте: §4.1 запрещает туман
      // войны, и спрятать девятнадцать точек ради одной — это он и есть.
      // Игрок видит, что мир больше сегодняшней задачи, и видит, куда
      // он вырастет.
      ctx.save();
      // Гаснут по-разному, и это не украшение. Кухня — надолго, и точка
      // остаётся читаемой целью: игрок должен видеть, куда вырастет. Кадр
      // раскадровки — на одну вылазку, и там гасится сильнее: на экране
      // обязано остаться ровно одно место.
      const block = this.entryBlock(node);
      if (block === 'onb') ctx.globalAlpha = 0.16;
      else if (block !== 'ok') ctx.globalAlpha = 0.34;

      if (this.focus === node.id) {
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 162, 74, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // Кольцо у всех точек одно: цвет занят богатством, толщина — ярусом.
      // Вид места называет значок Kenney внутри кольца; на широком экране
      // над ним встаёт иллюстрация — кольцо и значок при этом не уходят.
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 10, 9, 0.85)';
      ctx.fill();
      // Толщина кольца — ярус: цена места видна раньше подписи. У замка
      // яруса нет, и кольцо у него тонкое всегда.
      const walk = KIND[node.kind].walk;
      ctx.lineWidth = walk ? 1.4 : 1 + node.tier * 0.9;
      ctx.strokeStyle = walk ? WALK_COLOR[node.kind] ?? '#c8a24a' : color;
      ctx.stroke();
      this.drawMapIcon(MAP_ICON_URL[node.kind], x, y, r, MAP_ICON_COLOR);

      // На телефоне остаётся чистый силуэт; на широком экране иллюстрация не
      // разрастается вместе с радиусом точки и не перекрывает соседей.
      if (!compact) {
        this.drawMarker(LOCATION_ICON_URL[node.kind], x, y, Math.min(58, Math.max(32, r * 3.8)));
      }

      // Выработанная — крест. Цифру «0 из 3» на карте не прочитать, а решение
      // «сюда не иду» принимается взглядом.
      if (!walk && (state?.rich ?? RICH_MAX) === 0) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.5);
        ctx.lineTo(x + r * 0.5, y + r * 0.5);
        ctx.moveTo(x + r * 0.5, y - r * 0.5);
        ctx.lineTo(x - r * 0.5, y + r * 0.5);
        ctx.strokeStyle = 'rgba(212, 84, 58, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      const clan = walk ? null : state?.clan ?? null;
      if (clan !== null) {
        ctx.fillStyle = CLANS[clan % CLANS.length]!.color;
        ctx.fillRect(x + r * 0.95, y - r * 1.35, r * 0.62, r * 0.62);
      }

      // §11.6 — что здесь сегодня. Глиф в левом верху: нутро занято крестом,
      // правый верх флагом клана.
      const event = KIND[node.kind].events ? state?.event ?? null : null;
      if (event !== null) {
        // Событие сидит над левым краем локации: там раньше был глиф, поэтому
        // флаг клана справа и крест выработанной в центре не меняют места.
        const eventSize = Math.min(38, Math.max(22, r * 2.35));
        const ex = Math.max(eventSize / 2, Math.min(w - eventSize / 2, x - r * 1.35));
        const ey = Math.max(eventSize / 2, Math.min(h - eventSize / 2, y - r * 1.35));
        if (compact) {
          drawEventGlyph(ctx, event, x, y, r, w, h);
        } else {
          // Микродвижение не меняет положения маркера: буря колышется,
          // обвал оседает, тихая ночь дышит, жила пульсирует. Таким образом
          // событие живёт, но флаг клана и зона тапа остаются неподвижными.
          const phase = motion * (event === 'storm' ? 2.2 : event === 'vein' ? 1.8 : 1.2);
          const pulse = event === 'vein' ? 1 + Math.sin(phase) * 0.07 : 1;
          const tilt = event === 'storm' ? Math.sin(phase) * 0.07 : 0;
          const bob = event === 'collapse' ? Math.max(0, Math.sin(phase)) * 1.5 : 0;
          ctx.save();
          ctx.translate(ex, ey + bob);
          ctx.rotate(tilt);
          ctx.scale(pulse, pulse);
          if (event === 'quiet') ctx.globalAlpha = 0.78 + (Math.sin(phase) + 1) * 0.11;
          if (!this.drawMarker(EVENT_ICON_URL[event], 0, 0, eventSize)) {
            ctx.restore();
            drawEventGlyph(ctx, event, x, y, r, w, h);
          } else {
            ctx.restore();
          }
        }
      }

      ctx.restore();
    }
  }

  /**
   * Пускают ли в это место. Две причины, и обе временные по-разному: кадр
   * раскадровки кончится сам, Кухня вырастет постройкой. Замок не запирается
   * ничем — там нечего добывать и нечем рисковать (§6.1.6).
   */
  private entryBlock(node: WorldNode): EntryBlock {
    // Запирание кадра сильнее всех послаблений, включая замок: на первой
    // вылазке «ровно одно место» обязано значить ровно одно, иначе игрок
    // уходит гулять по стенам вместо того, ради чего кадр заведён.
    if (this.only !== null) return node.id === this.only ? 'ok' : 'onb';
    // Прогулку Кухня не запирает: рисковать там нечем, и провианта на неё
    // не нужно. Прежде это было записано только про замок, а кладбище
    // проходило по совпадению — у него `tier: 0`, и гейт нулевого яруса
    // всегда открыт.
    if (KIND[node.kind].gated === false) return 'ok';
    if (this.camp !== null && tierBlock(this.camp, node.tier) !== 'ok') return 'kitchen';
    return 'ok';
  }

  /**
   * Отдать карте чужие метки (§30.6). Зовётся снаружи, потому что читает их
   * сеть, а панели про сеть не знают — как и симуляция: `worldAt` берёт их
   * входом и остаётся чистой функцией.
   *
   * Мир пересчитывается сразу: метки приходят ответом сервера, то есть
   * в произвольный момент, а не на границе смены, и ждать следующей значило
   * бы показывать заведомо старое богатство.
   */
  setNeighbours(visits: readonly Visit[]): void {
    this.others = visits;
    if (this.camp === null) return;
    this.world = worldAt(this.now, this.camp.visits, visits);
    this.paint();
  }

  /**
   * Отдать карте чужие лагеря (§30.7). Тот же случай, что у меток строкой
   * выше: читает их сеть, а панель про сеть не знает.
   */
  setCamps(live: readonly LiveCamp[]): void {
    this.live = live;
    this.paint();
  }

  /**
   * Открыть карту целиком или запереть на одном месте (§16.2). Зовётся
   * снаружи: про кадры раскадровки карта не знает и знать не должна.
   *
   * Фокус переезжает на открытое место сразу: карточка, показывающая
   * запертую точку в тот момент, когда открыта ровно одна, — это лишний тап
   * до единственного возможного действия.
   */
  setOnly(node: number | null): void {
    if (this.only === node) return;
    this.only = node;
    if (node !== null) {
      this.focus = node;
      this.focusCamp = null;
    }
    this.paint();
  }

  /* ---------- карточка ---------- */

  private paintCard(): void {
    if (this.focusCamp !== null) {
      this.paintCampCard(this.focusCamp);
      return;
    }
    // Кнопки входа лагерь прячет, а узел обязан их вернуть: карточка узла
    // ставит их состояние, но не показывает — показ снимается здесь.
    this.go.style.display = '';
    const node = this.node();
    if (node.kind === 'замок') {
      this.paintKeepCard(node);
      return;
    }
    if (node.kind === 'замок минотавра') {
      this.paintMinotaurKeepCard(node);
      return;
    }
    if (node.kind === 'кладбище') {
      this.paintGraveCard(node);
      return;
    }
    if (node.kind === 'тропа') {
      this.paintTrailCard(node);
      return;
    }
    if (node.kind === 'призы') {
      this.paintPrizeCard(node);
      return;
    }
    const state = this.world[node.id] ??
      { rich: RICH_MAX, clan: null, others: 0, restShifts: 0, event: null };
    // §11.6 — «объявляются до входа». Объявлять надо итог: карточка, которая
    // пишет «ставка 0%» и «×0,6», пока буря делает 25% и ×0,9, — это и есть
    // сюрприз после входа, которого раздел прямо не хочет.
    const fx = effectOf(state.event);
    const mul = lootMul(state.rich) * fx.loot;
    // Зажата единицей — как и в `atRisk`: на Дне база уже 100%, и «125%»
    // было бы обещанием отнять больше, чем игрок несёт.
    const stake = Math.min(1, TIER_RISK[node.tier] + fx.risk);
    const clan = state.clan === null ? null : CLANS[state.clan % CLANS.length]!;

    const pips = Array.from(
      { length: RICH_MAX },
      (_, i) => `<s class="${i < state.rich ? '' : 'off'}"></s>`,
    ).join('');

    const eventCard = state.event === null
      ? ''
      : `<div class="event-art" style="background-image:url('${EVENT_CARD_URL[state.event]}')">` +
        `<span>${gameMarkup(gameMessage('Событие', 'Event'))}</span>` +
        `<b>${gameMarkup(eventMessage[state.event].name)}</b>` +
        `<i>${gameMarkup(eventMessage[state.event].line)}</i></div>`;

    this.card.innerHTML =
      eventCard +
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(
        gameMessage('{rich} из {max}', '{rich} of {max}'), { rich: state.rich, max: RICH_MAX },
      )}</i></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="row line"><span>${gameMarkup(tierMessage[node.tier])}</span>` +
      `<b class="${fx.risk > 0 ? 'bad' : ''}">${gameMarkup(
        gameMessage('ставка {stake}%', 'risk {stake}%'), { stake: Math.round(stake * 100) },
      )}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Добыча', 'Loot'))}</span>` +
      `<b class="${mul < 1 ? 'bad' : 'good'}">×${document.documentElement.lang === 'ru' ? mul.toFixed(1).replace('.', ',') : mul.toFixed(1)}</b></div>` +
      // §13 — что здесь падает. Ставка называет цену яруса, а довод за него
      // до сих пор не называл никто: железо идёт с первого, кристалл со
      // второго, и узнать это можно было только сходив. Ставку игрок читает
      // до входа — награда обязана читаться там же.
      `<div class="row line"><span>${gameMarkup(gameMessage('Можно добыть', 'Available loot'))}</span><b>${lootLine(node.tier)}</b></div>` +
      // §30.6 — кто ещё сюда ходил. Строка появляется только тогда, когда
      // соседи были: «заходов 0» — это не сведение, а шум, и стоять
      // на карточке ему незачем. Имён нет: решение здесь одно — идти или
      // не идти, — и чужая почта его не меняет.
      //
      // Подпись слева, число справа и без склонения: «1 заход» против
      // «2 захода» против «5 заходов» — три формы ради одной цифры,
      // и падеж здесь взялся бы ниоткуда ровно так же, как у имён (§0.1).
      (state.others > 0
        ? `<div class="row line"><span>${gameMarkup(gameMessage('Вылазки соседей', 'Neighboring raids'))}</span>` +
          `<b class="bad">${state.others}</b></div>`
        : '') +
      `<div class="row line"><span>${gameMarkup(gameMessage('Кто здесь', 'Who’s here'))}</span>` +
      // §4 — кланы «растут», и до этой строки рост считался, но не показывался
      // нигде. Уровень — та самая таблица развития, свёрнутая до одного
      // числа: имя рабочее (§0.1), а «ур.» читается без легенды.
      (clan === null || state.clan === null
        ? `<b class="good">${gameMarkup(gameMessage('никого', 'no one'))}</b>`
        : `<b style="color:${clan.color}">${worldText(clan.name)} · ${gameMarkup(
          gameMessage('ур. {level}', 'lvl {level}'), { level: clanState(state.clan, this.now).level },
        )}</b>`) +
      '</div>';
      // Отдельной строки события нет: название и итог стоят поверх
      // иллюстрации (`eventCard`), и вторая строка была бы тем же дважды.

    // Срок восстановления — вместо запрета. Локация не закрыта, она просто
    // невыгодна, и игрок должен видеть, когда сюда снова стоит идти.
    if (state.restShifts > 0) setGameText(this.note, gameMessage(
      'Ещё один заход вернётся через {duration}',
      'Another run becomes available in {duration}',
    ), { duration: gameDuration(state.restShifts * SHIFT_SEC) });
    else setGameText(this.note, gameMessage('Нетронутая жила: три вылазки', 'Untapped vein: three raids'));

    // Кнопка называется действием, а не местом: имя локации склоняется,
    // а имена в прототипе рабочие (§0.1) и меняются без предупреждения.
    //
    // Ставку она называет только там, где та стала настоящей. Артбук делает
    // ровно это — «В Сухое русло — ставка 60%», «Войти в бурю», — и делает
    // не ради полноты: строка карточки объявляет ставку глазам, а кнопка —
    // пальцу, который сейчас нажмёт. Ниже порога кнопка молчит: повторять
    // «ставка 0%» на кнопке значит учить не читать её.
    const block = this.entryBlock(node);
    const hot = stake >= DANGER_STAKE;
    setGameText(this.go, hot
      ? gameMessage('Войти · ставка {stake}%', 'Enter · risk {stake}%')
      : gameMessage('Войти', 'Enter'), { stake: Math.round(stake * 100) });
    this.go.classList.toggle('danger', hot && block === 'ok');
    this.go.disabled = block !== 'ok';
    // Отказ говорит причиной и перебивает срок восстановления: игроку сейчас
    // важнее, почему сюда нельзя, чем когда сюда снова будет выгодно.
    if (block !== 'ok') setGameText(this.note, ENTRY_REASON[block]);
    this.paintSend(node, block);
  }

  /**
   * Карточка лагеря — своего или соседского (§30). Ни ставки, ни добычи,
   * ни события: в лагерь не ходят, и четыре прочерка подряд обещали бы,
   * что когда-нибудь они заполнятся сами. Сказано ровно то, что про лагерь
   * известно: кто, насколько силён и где сегодня работает.
   *
   * Кнопки под ней нет вовсе — не запертая, а именно нет. Запертая кнопка
   * говорит «сюда пока нельзя», а сюда нельзя не «пока»: чужой лагерь —
   * не место входа, и обещать вход было бы враньём.
   */
  private paintCampCard(key: string): void {
    this.go.style.display = 'none';
    this.sendRow.style.display = 'none';
    if (key === 'свой') {
      this.paintOwnCard();
      return;
    }
    if (key.startsWith('клан:')) {
      this.paintNeighbourCard(Number(key.slice(5)));
      return;
    }
    const live = this.live.find((c) => `живой:${c.id}` === key);
    if (live !== undefined) this.paintLiveCard(live);
  }

  /**
   * Карточка живого соседа (§30.7). Отличается от фракционной тем, чего
   * про живого **не** известно: где он сегодня работает, мы не знаем —
   * метки мира считают заходы, а не хозяев (§30.6), и врать про это
   * карточка не станет. Зато известно то, чего нет у фракции: сколько
   * в лагере народу.
   */
  private paintLiveCard(live: LiveCamp): void {
    this.card.innerHTML =
      `<div class="row t"><b style="color:${LIVE_COLOR}">${live.clan ?? NO_CLAN}</b>` +
      `<i>${gameMarkup(gameMessage('сосед', 'neighbor'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Сила', 'Power'))}</span>` +
      `<b style="color:${LIVE_COLOR}">${live.power}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Жильё', 'Housing'))}</span><b>${gameMarkup(
        gameMessage('ур. {level}', 'lvl {level}'), { level: live.level },
      )}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Народу', 'People'))}</span><b>${live.folk}</b></div>`;
    if (live.clan === null) setGameText(this.note, gameMessage(
      'Живой сосед. Клана у него нет — в таблице он стоит без имени.',
      'A live neighbor. They have no clan, so they appear unnamed in the standings.',
    ));
    else setGameText(this.note, gameMessage(
      'Живой сосед. Стоит в таблице как «{clan}».',
      'A live neighbor. Listed in the standings as “{clan}”.',
    ), { clan: live.clan });
  }

  private paintOwnCard(): void {
    const camp = this.camp;
    if (camp === null) return;
    const rows = standings(camp, this.now, camp.clan?.name ?? null, this.live);
    const place = yourPlace(rows);
    this.card.innerHTML =
      `<div class="row t"><b>${camp.clan?.name ?? gameMarkup(gameMessage('Ваш лагерь', 'Your camp'))}</b>` +
      `<i>${gameMarkup(gameMessage('лагерь', 'camp'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Сила', 'Power'))}</span>` +
      `<b style="color:${OWN_CAMP_COLOR}">${campPower(camp)}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Жильё', 'Housing'))}</span><b>${gameMarkup(
        gameMessage('ур. {level}', 'lvl {level}'), { level: campLevel(camp) },
      )}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Народу', 'People'))}</span><b>${1 + camp.residents.length}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('В таблице', 'Standing'))}</span>` +
      `<b class="${place === 1 ? 'good' : ''}">${gameMarkup(
        gameMessage('{place} из {total}', '{place} of {total}'), { place, total: rows.length },
      )}</b></div>` +
      (camp.clan === null || camp.clan === undefined
        ? ''
        : `<div class="row line"><span>${gameMarkup(gameMessage('Клан', 'Clan'))}</span><b>${camp.clan.name}</b></div>`);
    // Сила — число выведенное (`sim/standing.ts`), и строка обязана называть,
    // из чего оно: иначе это цифра без ориентира, то есть повод для спора.
    //
    // Подрезанного списка молча не бывает: если соседей больше, чем влезает
    // на кромку, строка говорит сколько. Иначе карта читается как «это все
    // соседи мира», а это не все.
    const hidden = this.live.length - LIVE_SHOWN;
    if (hidden > 0) setGameText(this.note, gameMessage(
      'Сила — стоимость добычи, вложенной в лагерь. На кромке видно {shown} лагерей соседей из {total}; остальные — в таблице.',
      'Power is the value of loot invested in the camp. The edge shows {shown} of {total} neighboring camps; the rest are in the standings.',
    ), { shown: LIVE_SHOWN, total: this.live.length });
    else setGameText(this.note, gameMessage(
      'Сила — стоимость добычи, вложенной в лагерь: в постройки, снаряжение, палатки и сундуки.',
      'Power is the value of loot invested in the camp: buildings, equipment, tents, and chests.',
    ));
  }

  private paintNeighbourCard(id: number): void {
    const clan = CLANS[id % CLANS.length]!;
    const state = clanState(id, this.now);
    const at = state.nodes[0];
    const where = at === undefined ? null : this.region.nodes[at];
    this.card.innerHTML =
      `<div class="row t"><b style="color:${clan.color}">${worldText(clan.name)}</b><i>${gameMarkup(gameMessage('фракция', 'faction'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Сила', 'Power'))}</span>` +
      `<b style="color:${clan.color}">${clanPower(clanGrowth(id, this.now))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Лагерь', 'Camp'))}</span><b>${gameMarkup(
        gameMessage('ур. {level}', 'lvl {level}'), { level: state.level },
      )}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Сегодня работает', 'Working today'))}</span>` +
      (where === undefined || where === null
        ? `<b class="good">${gameMarkup(gameMessage('нигде', 'nowhere'))}</b>`
        : `<b class="bad">${worldText(where.name)}</b>`) +
      '</div>';
    // Почему это важно игроку, а не просто любопытно: занятая точка тратит
    // богатство (§4), и читается строка выше именно так.
    setGameText(this.note, where === null
      ? gameMessage('Фракция мира. Сегодня её людей на точках не видно.', 'A world faction. None of its people are visible at locations today.')
      : gameMessage('Пока они там, запас точки истощается — вам достанется меньше добычи.', 'While they are there, the site is being depleted—your raid will yield less loot.'));
  }

  /**
   * §26 — предложение отправить отряд. Глубже `SORTIE_MAX_TIER` строки нет
   * вовсе: там этой механики не существует, и запрещать нечего — запрет
   * рассказывал бы о механике, которой на этом ярусе не бывает.
   *
   * Запертое Кухней место отправке тоже закрыто: она ходит туда же, куда
   * и игрок, и объяснять два раза одну причину незачем.
   */
  private paintSend(node: WorldNode, entry: EntryBlock): void {
    const off =
      KIND[node.kind].gated === false || node.tier > SORTIE_MAX_TIER || entry !== 'ok';
    this.sendRow.style.display = off ? 'none' : 'flex';
    if (off) return;
    const block = sortieBlock(this.camp?.sortie ?? null, this.roster ?? EMPTY_ROSTER, node.tier);
    setGameText(this.send, gameMessage('Отправить · {duration}', 'Send · {duration}'), {
      duration: gameDuration(sortieSeconds(node.tier)),
    });
    this.send.disabled = block !== 'ok';
    if (block === 'ok') setGameText(this.sendNote, gameMessage('добыча ×{share}', 'loot ×{share}'), {
      share: document.documentElement.lang === 'ru' ? SHARE_TEXT : SHARE_TEXT.replace(',', '.'),
    });
    else setGameText(this.sendNote, SORTIE_REASON_MESSAGE[block]);
  }

  /**
   * Карточка замка (§6.1.6). Ни ставки, ни добычи, ни клана: их там нет,
   * и показывать прочерки в четырёх строках подряд — значит обещать, что
   * когда-нибудь они заполнятся сами. Вместо этого сказано прямо, что здесь
   * есть сейчас: постройка, по которой можно ходить.
   */
  /**
   * Кладбище (§6.1.7). Карточка отличается от замковой одной строкой —
   * «кто здесь», — и эта строка обязана быть честной: привидения там есть,
   * и игрок узнаёт об этом до входа, а не внутри.
   */
  private paintGraveCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(gameMessage('прогулка', 'exploration'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Что там', 'What’s there'))}</span>` +
      `<b>${gameMarkup(gameMessage('ограда, могилы, склеп', 'fence, graves, crypt'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Добыча', 'Loot'))}</span><b>${gameMarkup(gameMessage('нет', 'none'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Кто здесь', 'Who’s here'))}</span>` +
      `<b class="bad">${gameMarkup(gameMessage('привидения', 'ghosts'))}</b></div>`;
    setGameText(this.note, gameMessage(
      'Прогулка: добычи нет. Привидение медленнее вас — от него можно уйти.',
      'Exploration: no loot. The ghost is slower than you, so you can escape it.',
    ));
    this.walkButton(node);
  }

  /**
   * Замок (§6.1.6). Карточка перестала обещать пустую прогулку: во дворе
   * стоит торговец (§13.5), и это единственное место, где железо берут
   * не глубиной.
   *
   * Ставки и добычи здесь по-прежнему нет — а курс не называется: он плохой
   * и меняется замером, а карточка обязана оставаться правдой без правок.
   * Числа игрок увидит у самого торговца.
   */
  private paintKeepCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(gameMessage('постройка', 'structure'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Что там', 'What’s there'))}</span>` +
      `<b>${gameMarkup(gameMessage('стены, башни, двор', 'walls, towers, courtyard'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Кто здесь', 'Who’s here'))}</span>` +
      `<b class="good">${gameMarkup(gameMessage('торговец', 'trader'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Меняет на', 'Trades for'))}</span>` +
      `<b>${gameMarkup(gameMessage('железо', 'iron'))}</b></div>`;
    setGameText(this.note, gameMessage(
      'Прогулка: добычи и противников нет. Торговец во дворе, за воротами.',
      'Exploration: no loot or enemies. The trader is in the courtyard beyond the gate.',
    ));
    this.walkButton(node);
  }

  private paintMinotaurKeepCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(gameMessage('испытание', 'trial'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Что там', 'What’s there'))}</span>` +
      `<b>${gameMarkup(gameMessage('замок и золотой сундук', 'castle and golden chest'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Охрана', 'Guards'))}</span>` +
      `<b class="bad">${gameMarkup(gameMessage('минотавр и два голема', 'minotaur and two golems'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Выбор', 'Choice'))}</span>` +
      `<b>${gameMarkup(gameMessage('бой, обмен или заказ', 'fight, trade, or order'))}</b></div>`;
    setGameText(this.note, gameMessage(
      'Поговорите с хозяином. За сундук придётся сразиться; торг или заказ безопаснее, но принесут меньшую награду.',
      'Talk to the owner. You must fight for the chest; trading or taking a contract is safer, but less rewarding.',
    ));
    this.walkButton(node);
  }

  /**
   * Тропа (§6.1.17). Карточка отличается от двух других прогулок словом
   * «пройти»: у замка и кладбища смысл захода — рассмотреть участок, у тропы —
   * длина. Добыча здесь — работа руками, а не находки: лес рубят, валуны
   * бьют, и строка обязана это называть — «нет» врало бы про топор.
   * «Никого» — честное сегодняшнее состояние, а не обещание навсегда:
   * когда на тропе поселятся засады, строка обязана поменяться вместе с ними.
   */
  private paintTrailCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(gameMessage('прогулка', 'exploration'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Что там', 'What’s there'))}</span>` +
      `<b>${gameMarkup(gameMessage('тропа, развилки, тупики', 'trail, forks, dead ends'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Добыча', 'Loot'))}</span>` +
      `<b>${gameMarkup(gameMessage('дерево и камень', 'wood and stone'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Кто здесь', 'Who’s here'))}</span>` +
      `<b class="good">${gameMarkup(gameMessage('никого', 'no one'))}</b></div>`;
    setGameText(this.note, gameMessage(
      'Прогулка: тропа виляет и раздваивается, выходы на обоих концах. Лес рубят, валуны бьют — противников нет.',
      'Exploration: the trail twists and forks, with exits at both ends. Chop trees and break boulders — there are no enemies.',
    ));
    this.walkButton(node);
  }

  /**
   * Колесо призов. Единственное место карты с суточным замком на самом
   * месте, а не на ярусе: прокрутка одна в день, и карточка обязана говорить,
   * потрачена ли она, — до входа, как всё на этом экране (§11.6).
   * Сколько выпадет, карточка не называет: исход решает симуляция за дверью,
   * а обещать вилку «1–10» — значит продавать место тем, чего игрок может
   * не получить.
   */
  private paintPrizeCard(node: WorldNode): void {
    const spun = this.camp?.wheelDay === dayAt(this.now);
    this.card.innerHTML =
      `<div class="row t"><b>${worldText(node.name)}</b><i>${gameMarkup(gameMessage('аттракцион', 'attraction'))}</i></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Что там', 'What’s there'))}</span>` +
      `<b>${gameMarkup(gameMessage('колесо призов', 'prize wheel'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Добыча', 'Loot'))}</span>` +
      `<b>${gameMarkup(gameMessage('кристаллы', 'crystals'))}</b></div>` +
      `<div class="row line"><span>${gameMarkup(gameMessage('Прокрутка', 'Spin'))}</span>` +
      (spun
        ? `<b class="bad">${gameMarkup(gameMessage('сегодня уже была', 'already used today'))}</b>`
        : `<b class="good">${gameMarkup(gameMessage('одна в день, сегодня не тратилась', 'once per day, unused today'))}</b>`) +
      '</div>';
    setGameText(this.note, spun
      ? gameMessage('Колесо уже крутили — новая прокрутка завтра, с новым регионом.', 'The wheel has already been spun. A new spin arrives tomorrow with the new region.')
      : gameMessage('Дёрните рычаг — сколько выпадет, столько кристаллов и заберёте.', 'Pull the lever and keep however many crystals come up.'));
    this.walkButton(node);
    // Поверх общего правила прогулок: сегодняшняя прокрутка потрачена —
    // и идти незачем, кнопка говорит об этом запертостью, а строка выше —
    // причиной.
    if (spun) this.go.disabled = true;
  }

  /**
   * Кнопка прогулочного места. Общая на все виды, и это не экономия строк:
   * карточка кладбища состояние кнопки не сбрасывала вовсе, и после опасной
   * вылазки та оставалась оранжевой и запертой — оранжевой, потому что
   * `danger` вешается по ставке и никем не снимался, запертой, потому что
   * `disabled` ставится гейтом Кухни.
   *
   * Ставки у прогулки нет (§6.1.6), значит оранжевой кнопке там взяться
   * неоткуда, и заперта она может быть только кадром раскадровки.
   */
  private walkButton(node: WorldNode): void {
    setGameText(this.go, gameMessage('Пойти', 'Go'));
    this.go.classList.remove('danger');
    this.go.disabled = this.entryBlock(node) !== 'ok';
  }
}
