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
 * **Панель не решает, чем платят.** Цена, время стройки и то, что стена даёт,
 * — вопросы §12 и замера, а не панели. Пока их нет, в карточке стоит прочерк:
 * прочерк честно говорит «не решено», а придуманное число врёт, что решено.
 *
 * Панель — DOM, а не сцена: она ничего не рисует и не знает про three.
 * Что стройка сделала с лагерем, показывает `CampView`.
 */
import { WALL_TOOLS, wallCount, type CampWalls, type WallTool } from '../sim/campWalls';
import { TOWER_MAX } from '../sim/castle';

export interface BuildPanelCallbacks {
  /** Игрок выбрал карточку или снял выбор. */
  onTool(tool: WallTool | null): void;
  /** Закрыть панель и выйти из режима стройки. */
  onDone(): void;
}

/**
 * Что карточка обещает. Первая строка — жест: игрок обязан узнать, что делать
 * руками, раньше, чем что это даст. Вторая — то, что уже построено: панель
 * без счёта превращается в набор кнопок без обратной связи.
 */
const CARD: Record<WallTool, { readonly title: string; readonly gesture: string }> = {
  'стена': { title: 'Стена', gesture: 'Ведите линию по земле' },
  'башня': { title: 'Башня', gesture: `Тап по клетке · ещё тап — ярус выше, до ${TOWER_MAX}` },
  'ворота': { title: 'Ворота', gesture: 'Тап по середине прямого участка' },
  'лестница': { title: 'Лестница', gesture: 'Тап по клетке у стены изнутри' },
  'снос': { title: 'Снести', gesture: 'Тап по тому, что стоит' },
};

/** Счёт показывают четыре карточки из пяти: сносу считать нечего. */
const COUNTED: readonly WallTool[] = ['стена', 'башня', 'ворота', 'лестница'];

interface Card {
  readonly box: HTMLElement;
  readonly count: HTMLElement;
  readonly button: HTMLButtonElement;
}

export class BuildPanel {
  readonly root: HTMLElement;
  private readonly cards = new Map<WallTool, Card>();
  private readonly note: HTMLElement;
  private tool: WallTool | null = null;

  constructor(private readonly cb: BuildPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'panel build';
    this.root.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'sheet-head';
    const title = document.createElement('b');
    title.textContent = 'Стены лагеря';
    const close = document.createElement('button');
    close.className = 'ghost sheet-x';
    close.textContent = 'Готово';
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

    this.root.append(head, list, this.note);
    this.setNote(null);
  }

  private makeCard(tool: WallTool): HTMLElement {
    const box = document.createElement('div');
    box.className = 'build-card' + (tool === 'снос' ? ' raze' : '');

    const button = document.createElement('button');
    button.className = 'build-pick';
    button.setAttribute('aria-pressed', 'false');

    const name = document.createElement('b');
    name.textContent = CARD[tool].title;

    const gesture = document.createElement('span');
    gesture.className = 'dim build-gesture';
    gesture.textContent = CARD[tool].gesture;

    const bottom = document.createElement('span');
    bottom.className = 'build-bot dim';
    const count = document.createElement('span');
    // Цена — слот, а не ноль: ноль читался бы как «бесплатно навсегда».
    const price = document.createElement('span');
    price.textContent = tool === 'снос' ? 'вернёт всё' : 'цена —';
    bottom.append(count, price);

    button.append(name, gesture, bottom);
    button.addEventListener('click', () => this.select(this.tool === tool ? null : tool));
    box.appendChild(button);

    this.cards.set(tool, { box, count, button });
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

  /** Счётчики карточек по тому, что стоит в лагере. */
  update(walls: CampWalls): void {
    const count = wallCount(walls);
    for (const tool of COUNTED) {
      const card = this.cards.get(tool);
      if (card === undefined) continue;
      const n = count[tool as keyof typeof count] ?? 0;
      card.count.textContent = n === 0 ? 'нет' : `стоит ${n}`;
    }
    const raze = this.cards.get('снос');
    if (raze !== undefined) raze.count.textContent = '';
  }

  /**
   * Подсказка под карточками. Пусто — значит панель говорит, что делать;
   * причина отказа — почему сейчас не вышло. Молчащий отказ читается как
   * поломка, поэтому текста «нельзя» без причины здесь нет.
   */
  setNote(reason: string | null): void {
    if (reason !== null) {
      this.note.textContent = reason;
      this.note.classList.add('warn');
      return;
    }
    this.note.classList.remove('warn');
    this.note.textContent = this.tool === null
      ? 'Выберите, что строить. Пока карточка не выбрана, лагерь работает как обычно.'
      : CARD[this.tool].gesture + '. Тап по карточке ещё раз — снять выбор.';
  }
}
