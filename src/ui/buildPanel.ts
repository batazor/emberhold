/**
 * Панель стройки стен (§12, §6.1.6). Открывается из лагеря и вооружает сцену:
 * карточка выбрана — тап и протяжка по земле строят, карточка снята — лагерь
 * ведёт себя как обычно.
 *
 * **Почему карточки, а не список зданий.** Здание в лагере ставится в клетку
 * одним тапом, и для него хватает кнопки в листе. Стена — это много клеток
 * подряд, башня — та же клетка несколько раз, ворота — клетка, которая
 * обязана быть серединой прямой. Жест у каждого свой, и карточка нужна
 * ровно затем, чтобы игрок знал, каким жестом он сейчас работает.
 *
 * **Цена названа за клетку, а счёт идёт по ходу мазка.** Клеток у стены
 * столько, сколько проведут пальцем, поэтому карточка говорит цену единицы,
 * а общий счёт — камень и минуты — растёт под карточками, пока палец ведёт.
 * Узнать цену после того, как отпустил, было бы поздно.
 *
 * Чего стена **даёт**, панель по-прежнему не решает: это вопрос §12
 * и отдельного замера.
 *
 * **Знак на карточке — силуэт постройки, а не иконка действия.** Шесть
 * названий подряд читаются списком, и в списке жест теряется: игрок ищет
 * глазами слово, а не то, что он ставит. Силуэт даёт зацепку раньше текста
 * и стоит ноль байт — это `<svg>` в разметке, не картинка и не модель.
 * Рисовать его рендером набора было бы честнее по материалу, но панель
 * не знает про three и знать не должна.
 *
 * **Цена красная, когда не хватает.** Карточка и раньше называла цену,
 * но молчала о том, потянет ли её игрок; узнать это можно было, только
 * проведя пальцем и получив отказ. Красное — это тот же отказ, сказанный
 * до жеста, а не после. Карточка при этом остаётся живой: причину
 * по-прежнему говорит подсказка под панелью (`setNote`), а погашенная
 * кнопка объяснить ничего не может.
 *
 * **Счёт построенного ушёл в угол числом.** Он стоял в одной строке с ценой
 * через `space-between`, и на длинной цене ограды строка ломалась пополам:
 * «стоит / 6   1 дерева за 4 кл. · / 2 с/кл.». Число в углу не делит ширину
 * ни с чем и не ломается ни при какой цене.
 *
 * Панель — DOM, а не сцена: она ничего не рисует и не знает про three.
 * Что стройка сделала с лагерем, показывает `CampView`.
 */
import {
  FENCE_COST,
  ROAD_COST,
  WALL_COST,
  WALL_SECONDS,
  WALL_TOOLS,
  fenceMaterial,
  fenceResource,
  wallCount,
  wallPrice,
  wallProgress,
  type CampWalls,
  type WallTool,
} from '../sim/campWalls';
import { canAfford, type Resources } from '../sim/resources';
import { type FenceMaterial } from '../sim/fence';
import { TOWER_MAX } from '../sim/castle';
import { clearGameAttribute, clearGameText, gameMessage, gameText, setGameAttribute, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

export interface BuildPanelCallbacks {
  /** Игрок выбрал карточку или снял выбор. */
  onTool(tool: WallTool | null): void;
  /** Закрыть панель и выйти из режима стройки. */
  onDone(): void;
  /** Тап по уже выбранной карточке ограды — следующий материал. */
  onCycleFence(): void;
}

/**
 * Что карточка обещает. Первая строка — жест: игрок обязан узнать, что делать
 * руками, раньше, чем что это даст. Вторая — то, что уже построено: панель
 * без счёта превращается в набор кнопок без обратной связи.
 */
const CARD: Record<WallTool, {
  readonly title: GameMessage;
  readonly gesture: GameMessage;
  readonly gestureValues?: Readonly<Record<string, number>>;
}> = {
  'стена': {
    title: gameMessage('Стена', 'Wall'),
    gesture: gameMessage('Ведите линию по земле', 'Drag a line across the ground'),
  },
  // Материал перебирается повторным тапом по карточке — тем же жестом,
  // каким башня растёт ярусом. Второго органа управления под четыре
  // материала панель не заводит: она и так называет жест, а не эффект.
  'ограда': {
    title: gameMessage('Ограда', 'Fence'),
    gesture: gameMessage('Ведите линию · тап по карточке — другой материал', 'Drag a line · tap the card to change material'),
  },
  // Дорога ведётся тем же мазком, что стена: полотно — те же «много клеток
  // подряд», только по ним ходят, а не за ними прячутся.
  'дорога': {
    title: gameMessage('Дорога', 'Road'),
    gesture: gameMessage('Ведите линию по земле', 'Drag a line across the ground'),
  },
  'фонарь': {
    title: gameMessage('Фонарь', 'Lantern'),
    gesture: gameMessage('Тап по клетке · ночью горит сам', 'Tap a tile · lights automatically at night'),
  },
  'башня': {
    title: gameMessage('Башня', 'Tower'),
    gesture: gameMessage(
      'Тап по клетке · ещё тап — ярус выше, до {max}',
      'Tap a tile · tap again to add a level, up to {max}',
    ),
    gestureValues: { max: TOWER_MAX },
  },
  'ворота': {
    title: gameMessage('Ворота', 'Gate'),
    gesture: gameMessage('Тап по середине прямого участка', 'Tap the middle of a straight section'),
  },
  'лестница': {
    title: gameMessage('Лестница', 'Stairs'),
    gesture: gameMessage('Тап по клетке у стены изнутри', 'Tap a tile beside the inside of a wall'),
  },
  'снос': {
    title: gameMessage('Снести', 'Demolish'),
    gesture: gameMessage('Тап по тому, что стоит', 'Tap an existing structure'),
  },
};

const FENCE_TITLE: Record<FenceMaterial, GameMessage> = {
  'дерево': gameMessage('Дощатая ограда', 'Plank fence'),
  'ковка': gameMessage('Кованая ограда', 'Wrought-iron fence'),
  'кирпич': gameMessage('Кирпичная ограда', 'Brick fence'),
  'камень': gameMessage('Каменная ограда', 'Stone fence'),
};

/**
 * Силуэт постройки. Рисуется заливкой без обводки — тем же приёмом, что и
 * низкополигональный арт: плоское пятно, а не контур. Ворота и башня режутся
 * `fill-rule="evenodd"`: проём и бойница — дырки в фигуре, а не второй цвет.
 * Снос назван инструментом, а не результатом: молот читается действием
 * с любого расстояния, а разрушенная стена — ещё одной постройкой.
 */
const GLYPH: Record<WallTool, string> = {
  'стена': '<path d="M3 7h3.2v3.4H3zM10.4 7h3.2v3.4h-3.2zM17.8 7H21v3.4h-3.2zM3 10.4h18V21H3z"/>',
  // Прожилок один, а не два: при двух силуэт на 25 px читался решёткой.
  'ограда': '<path d="M2.5 12.6h19v2.4h-19zM3.4 4.2l2.9 3V21H3.4zM10.5 4.2l2.9 3V21h-2.9zM17.7 4.2l2.9 3V21h-2.9z"/>',
  // Дорога — полотно в перспективе, шов посередине вырезан по evenodd.
  'дорога': '<path fill-rule="evenodd" d="M9.2 3h5.6L19 21H5zM11.4 5.4h1.2v3h-1.2zM10.9 10.4h1.6v3.6h-1.6zM10.3 15.6h2v4h-2z"/>',
  // Фонарь — столб с кронштейном и подвешенным плафоном.
  'фонарь': '<path d="M6 2.6h3.2V21H6zM9.2 4.2h7.6v2h-2v1.6h-2.6V6.2h-3zM13 8.6h3.6l.9 5h-5.4zM14 14.4h1.6v2.2H14z"/>',
  'башня': '<path fill-rule="evenodd" d="M6 3.6h2.9v3.2h2.6V3.6h2.9v3.2h2.6V3.6H20V21H6zm4.9 8.2h4.2v5.4h-4.2z"/>',
  'ворота': '<path fill-rule="evenodd" d="M3 4h18v17h-5.2v-6.4a3.8 3.8 0 0 0-7.6 0V21H3z"/>',
  'лестница': '<path d="M3 21v-4.2h5.2v-4.2h5.2V8.4H21V21z"/>',
  'снос': '<path d="M13.4 2.7 21 10.3l-3 3-7.6-7.6zM11.1 8.4 3.9 15.6a2.2 2.2 0 0 0 3.1 3.1l7.2-7.2z"/>',
};

/** Счёт показывают все карточки, кроме сноса: ему считать нечего. */
const COUNTED: readonly WallTool[] = ['стена', 'ограда', 'дорога', 'фонарь', 'башня', 'ворота', 'лестница'];

interface Card {
  readonly box: HTMLElement;
  /** Число построенного в углу. Пустое — значит ни одного: ноль в углу
   *  это шум, а отсутствие значка читается как «ещё нет». */
  readonly count: HTMLElement;
  /** Цена: у ограды она меняется вместе с материалом, у остальных постоянна. */
  readonly price: HTMLElement;
  readonly name: HTMLElement;
  readonly button: HTMLButtonElement;
}

export class BuildPanel {
  readonly root: HTMLElement;
  private readonly cards = new Map<WallTool, Card>();
  private readonly note: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private tool: WallTool | null = null;

  constructor(private readonly cb: BuildPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'panel build';
    this.root.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'row mid sheet-head';
    const title = document.createElement('b');
    setGameText(title, gameMessage('Стены лагеря', 'Camp defenses'));
    const close = document.createElement('button');
    close.className = 'ghost sheet-x';
    setGameText(close, gameMessage('Готово', 'Done'));
    close.addEventListener('click', () => {
      this.select(null);
      this.cb.onDone();
    });
    head.append(title, close);

    const list = document.createElement('div');
    list.className = 'build-cards';
    for (const tool of WALL_TOOLS) list.appendChild(this.makeCard(tool));

    this.note = document.createElement('div');
    this.note.className = 'build-note dim';

    // Полоса стройки: та же мерка, что у зданий, — сколько осталось ждать.
    this.timer = document.createElement('div');
    this.timer.className = 'build-note dim';
    this.bar = document.createElement('div');
    this.bar.className = 'bar';
    this.bar.style.display = 'none';
    this.fill = document.createElement('i');
    this.bar.appendChild(this.fill);

    this.root.append(head, list, this.bar, this.timer, this.note);
    this.setNote(null);
  }

  private makeCard(tool: WallTool): HTMLElement {
    const box = document.createElement('div');
    box.className = 'build-card' + (tool === 'снос' ? ' raze' : '');

    const button = document.createElement('button');
    button.className = 'card build-pick';
    button.setAttribute('aria-pressed', 'false');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'glyph');
    icon.setAttribute('viewBox', '0 0 24 24');
    // Силуэт — украшение, а не подпись: имя постройки стоит рядом словами,
    // и второй раз проговаривать его читалке незачем.
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = GLYPH[tool];

    const name = document.createElement('b');
    setGameText(name, CARD[tool].title);

    const gesture = document.createElement('span');
    gesture.className = 'dim build-gesture';
    setGameText(gesture, CARD[tool].gesture, CARD[tool].gestureValues);

    // Счёт построенного — в углу карточки. В одной строке с ценой он делил
    // с ней ширину и ломался на длинной цене ограды.
    const count = document.createElement('span');
    count.className = 'badge build-count';

    // Цена названа за клетку, а не за постройку: у стены клеток столько,
    // сколько проведут пальцем, и общий счёт идёт под карточками по ходу мазка.
    const price = document.createElement('span');
    price.className = 'build-price';
    // Дорога и фонарь платятся деревом; дорога к тому же дробная, как ограда
    // (§6.1.7): карточка называет, за сколько клеток берут единицу.
    if (tool === 'снос') setGameText(price, gameMessage('вернёт ресурс', 'refunds resources'));
    else if (tool === 'дорога') setGameText(price, gameMessage(
      'Дерево: 1 за {cells} кл. · {seconds} с/кл.',
      'Wood: 1 per {cells} tiles · {seconds} sec/tile',
    ), { cells: Math.round(1 / ROAD_COST.perCell), seconds: WALL_SECONDS[tool] });
    else if (tool === 'фонарь') setGameText(price, gameMessage(
      'Дерево: {cost} · {seconds} с',
      'Wood: {cost} · {seconds} sec',
    ), { cost: WALL_COST[tool], seconds: WALL_SECONDS[tool] });
    else setGameText(price, gameMessage(
      'Камень: {cost} · {seconds} с',
      'Stone: {cost} · {seconds} sec',
    ), { cost: WALL_COST[tool], seconds: WALL_SECONDS[tool] });

    button.append(icon, name, gesture, count, price);
    button.addEventListener('click', () => {
      // Ограда — единственная карточка, у которой повторный тап не снимает
      // выбор, а перебирает материал: снять её можно «Готово» или другой
      // карточкой, а четыре материала иначе некуда положить.
      if (tool === 'ограда' && this.tool === tool) {
        this.cb.onCycleFence();
        return;
      }
      this.select(this.tool === tool ? null : tool);
    });
    box.appendChild(button);

    this.cards.set(tool, { box, count, price, name, button });
    return box;
  }

  /** Выбрать карточку. Повторный тап по той же снимает выбор. */
  select(tool: WallTool | null): void {
    this.tool = tool;
    for (const [key, card] of this.cards) {
      card.button.setAttribute('aria-pressed', key === tool ? 'true' : 'false');
    }
    this.setNote(null);
    this.cb.onTool(tool);
  }

  get selected(): WallTool | null {
    return this.tool;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (!on && this.tool !== null) this.select(null);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Счётчики карточек и полоса идущей стройки. Пока таймер идёт, карточки
   * гаснут: слот один на лагерь, и вторую стройку начать всё равно нельзя —
   * живая кнопка, которая откажет, врёт сильнее, чем погашенная.
   */
  update(walls: CampWalls, now: number, have: Resources): void {
    const work = walls.work ?? null;
    const busy = work != null;
    for (const [, card] of this.cards) card.button.disabled = busy;
    if (busy) {
      const left = Math.max(0, Math.ceil(work.endsAt - now));
      this.bar.style.display = '';
      this.fill.style.width = `${Math.round(wallProgress(walls, now) * 100)}%`;
      setGameText(this.timer, gameMessage(
        '{tool}: осталось {left} с',
        '{tool}: {left} sec left',
      ), { tool: gameText(CARD[work.tool].title), left });
    } else {
      this.bar.style.display = 'none';
      clearGameText(this.timer);
      this.timer.textContent = '';
    }

    // Ограда называет свой материал именем карточки, а ресурс — ценой:
    // «1 камня» на дощатой ограде было бы прямой ложью про то, чем платят.
    const fence = this.cards.get('ограда');
    if (fence !== undefined) {
      const material = fenceMaterial(walls);
      setGameText(fence.name, FENCE_TITLE[material]);
      const back = fenceResource(material) === 'wood' ? 'дерева' : 'камня';
      // Цена ограды дробная (§6.1.7), и назвать её «1 за клетку» значило бы
      // соврать вчетверо. Карточка говорит, за сколько клеток берут единицу;
      // сколько выйдет за этот мазок, считается под карточками по ходу пальца.
      const per = Math.round(1 / FENCE_COST[material].perCell);
      setGameText(fence.price, back === 'дерева'
        ? gameMessage('Дерево: 1 за {cells} кл. · {seconds} с/кл.', 'Wood: 1 per {cells} tiles · {seconds} sec/tile')
        : gameMessage('Камень: 1 за {cells} кл. · {seconds} с/кл.', 'Stone: 1 per {cells} tiles · {seconds} sec/tile'), {
        cells: per,
        seconds: WALL_SECONDS['ограда'],
      });
    }

    const count = wallCount(walls);
    for (const tool of COUNTED) {
      const card = this.cards.get(tool);
      if (card === undefined) continue;
      const n = count[tool as keyof typeof count] ?? 0;
      card.count.textContent = n === 0 ? '' : String(n);
      // Читалке одного числа мало: в углу оно понятно только глазом.
      if (n === 0) clearGameAttribute(card.count, 'aria-label');
      else setGameAttribute(card.count, 'aria-label', gameMessage('Построено: {count}', 'Built: {count}'), { count: n });
    }
    const raze = this.cards.get('снос');
    if (raze !== undefined) raze.count.textContent = '';

    // Хватает ли на одну клетку. Цена мазка растёт под карточками по ходу
    // пальца, а карточка отвечает за единицу — ту же, что называет ценой.
    const material = fenceMaterial(walls);
    for (const tool of COUNTED) {
      const card = this.cards.get(tool);
      if (card === undefined) continue;
      const short = !canAfford(have, wallPrice(tool as Exclude<WallTool, 'снос'>, 1, material));
      card.price.classList.toggle('cant', short);
    }
  }

  /**
   * Подсказка под карточками. Пусто — значит панель говорит, что делать;
   * причина отказа — почему сейчас не вышло. Молчащий отказ читается как
   * поломка, поэтому текста «нельзя» без причины здесь нет.
   */
  setNote(reason: string | null): void {
    if (reason !== null) {
      clearGameText(this.note);
      this.note.textContent = reason;
      this.note.classList.add('warn');
      return;
    }
    this.note.classList.remove('warn');
    if (this.tool === null) setGameText(this.note, gameMessage(
      'Выберите, что строить. Пока карточка не выбрана, лагерь работает как обычно.',
      'Choose what to build. Until a card is selected, the camp works as usual.',
    ));
    else setGameText(this.note, gameMessage(
      'Карточка выбрана. Тап по карточке ещё раз — снять выбор.',
      'Card selected. Tap it again to clear the selection.',
    ));
  }
}
