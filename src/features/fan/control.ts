/**
 * Веер как контрол игры: дуга лиц у большого пальца, тап выбирает.
 *
 * Отдельно от `index.ts` потому, что мест применения стало два и они разные.
 * Отладочная сцена (`?веер`) меряет: забирает экран, гасит недостижимое,
 * пишет номера, ведёт упражнение. Лагерь ничего не меряет — ему нужна дуга,
 * которая **не мешает**: слой прозрачен для пальца везде, кроме самих лиц,
 * иначе тап по земле перестал бы доходить до лагеря, а веер стал бы стеклом
 * поверх игры.
 *
 * Общее у них — раскладка, лица и жест; оно здесь. Разное — органы замера;
 * они остались в сцене.
 */
import { SHAPE, clampOffset, layout, scrolls } from './fan';
import type { FanShape, Slot } from './fan';
import { avatarSvg } from '../../ui/avatar';
import type { AvatarLook } from '../../ui/avatar';

/** Человек в веере. Всё остальное про него знает игра. */
export interface FanPerson {
  readonly name: string;
  readonly kind: 'герой' | 'жилец';
  /** Чьё лицо рисовать (`avatar.ts`). */
  readonly look: AvatarLook;
  /** Сид лица: тот же человек — то же лицо, сколько ни перерисовывай. */
  readonly seed: number;
  /** Короткая подпись состояния: «готов», «лечится», «без крыши». */
  readonly state: string;
  /** Занят и в вылазку сейчас не пойдёт: лицо гаснет. */
  readonly busy?: boolean;
  /** Есть ли у него вопрос — метка, ради которой список и затевался. */
  readonly asking?: boolean;
}

/** Полосы экрана, занятые игрой: сверху ресурсы, снизу строка действий. */
export interface Reserve {
  readonly top: number;
  readonly bottom: number;
}

export interface ControlHooks {
  readonly parent: HTMLElement;
  readonly people: () => readonly FanPerson[];
  /**
   * Что уже занято игрой. Веер не имеет права лезть под нижнюю строку
   * («Отряд», «Стены», «В мир») и под ресурсы сверху: контрол, стоящий
   * на чужой кнопке, спорит с ней за палец.
   */
  readonly reserve: () => Reserve;
  /** Тап по лицу. −1 — мимо всех; лагерю это не приходит, сцене приходит. */
  readonly onPick: (i: number) => void;
  /** Вести палец самому. Сцена ведёт свой — у неё обвод и упражнение. */
  readonly input?: boolean;
  /** Подписи под лицами. В лагере имя говорит карточка, и подпись лишняя. */
  readonly labels?: boolean;
  /** Добавить своё поверх лица: номер упражнения, гашение по обводу. */
  readonly decorate?: (el: HTMLElement, slot: Slot, who: FanPerson) => void;
}

const CSS = `
/* Веер лежит НАД сценой, но ПОД листом игры (#hud, #camp — 6). Лист,
   открытый во весь экран, — стройка, припасы, сводка — обязан накрывать
   лица: пока веер стоял выше, карточки «Стен лагеря» уходили под чужие
   головы, и нижние ряды нельзя было ни прочитать, ни нажать. Пустоты это
   не касается: контейнер листа сквозной для пальца (pointer-events: none),
   и лицо, которое ничем не накрыто, нажимается как раньше. */
.fan-layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
.fan-slot { position: absolute; border-radius: 50%; overflow: hidden;
  pointer-events: auto; touch-action: none;
  border: 1px solid rgba(232,226,212,0.35); background: rgba(30,28,24,0.9); }
.fan-slot svg { display: block; width: 100%; height: 100%; }
.fan-slot.hero { border-color: #6d5a30; }
.fan-slot.busy { filter: grayscale(0.8); opacity: 0.55; }
.fan-slot.lead { border-color: #c8a24a; border-width: 2px;
  box-shadow: 0 0 0 3px rgba(200,162,74,0.28); }
.fan-slot.far { opacity: 0.35; }
.fan-slot.want { border-color: #e2a33c; border-width: 2px;
  box-shadow: 0 0 0 4px rgba(226,163,60,0.25); }
.fan-slot b { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  font-size: 15px; font-weight: 700; color: #e8e2d4; text-shadow: 0 1px 3px #0b0a09;
  background: rgba(11,10,9,0.55); border-radius: 50%; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center; }
.fan-slot i { position: absolute; top: -1px; right: -1px; width: 10px; height: 10px;
  border-radius: 50%; background: #e2a33c; border: 1px solid #0b0a09; }
.fan-name { position: absolute; width: 64px; text-align: center; font-size: 9px;
  color: #9a927f; pointer-events: none; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
`;

/** Стили ставятся один раз на страницу, сколько бы вееров на ней ни было. */
function ensureStyle(): void {
  if (document.getElementById('fan-css') !== null) return;
  const el = document.createElement('style');
  el.id = 'fan-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

export class FanControl {
  readonly root: HTMLElement;
  shape: FanShape = { ...SHAPE };
  offset = 0;
  /** Кто отмечен ведущим. Лагерь ставит это сам, из отряда. */
  picked = 0;

  private readonly box: HTMLElement;
  private down: { x: number; y: number; angle: number; offset: number } | null = null;
  private moved = false;
  /**
   * Что нарисовано сейчас. Веер зовут из игрового цикла, шестьдесят раз
   * в секунду, а пересборка узлов между нажатием и отпусканием съедает
   * само нажатие — та же цена, что у листа лагеря. Поэтому дуга
   * пересобирается на смену, а не на кадр.
   */
  private key = '';

  constructor(private readonly hooks: ControlHooks) {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'fan-layer';
    this.box = document.createElement('div');
    this.root.appendChild(this.box);
    hooks.parent.appendChild(this.root);
    if (hooks.input !== false) this.listen();
  }

  /**
   * Основание пальца. Не пиксель угла: сустав лежит внутри экрана, а слот
   * на нулевом угле иначе наполовину уходит за кромку — «не влезает»
   * получалось бы раскладкой, а не пальцем. Снизу к отступу добавляется
   * полоса игры: нижняя строка лагеря — не место для веера.
   */
  private inset(): number {
    return this.shape.size / 2 + 6;
  }

  pivot(): { x: number; y: number } {
    return {
      x: this.shape.hand === 'правая' ? window.innerWidth - this.inset() : this.inset(),
      y: window.innerHeight - this.hooks.reserve().bottom - this.inset(),
    };
  }

  /** Куда показывает точка экрана: угол от нижней кромки и радиус от сустава. */
  polar(px: number, py: number): { angle: number; radius: number } {
    const p = this.pivot();
    const dx = this.shape.hand === 'правая' ? p.x - px : px - p.x;
    const dy = p.y - py;
    return { angle: Math.atan2(Math.max(dy, 0), Math.max(dx, 0)), radius: Math.hypot(dx, dy) };
  }

  slots(): Slot[] {
    return layout(this.shape, this.hooks.people().length, this.offset);
  }

  /**
   * Кого нажали. Решает браузер, а не наша геометрия: круг с закруглением
   * попадает по своей форме, и промах обязан считаться там же, где случается.
   */
  slotAt(px: number, py: number): number {
    const hit = document.elementFromPoint(px, py);
    const box = hit === null ? null : (hit as HTMLElement).closest('.fan-slot');
    if (box === null) return -1;
    const i = Number((box as HTMLElement).dataset['i']);
    return Number.isFinite(i) ? i : -1;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  draw(force = false): void {
    const people = this.hooks.people();
    this.offset = clampOffset(this.shape, people.length, this.offset);
    const p = this.pivot();
    const key = JSON.stringify([
      people.map((w) => [w.name, w.look, w.seed, w.state, w.busy === true, w.asking === true]),
      this.shape,
      Math.round(this.offset * 1000),
      this.picked,
      p.x,
      p.y,
    ]);
    if (!force && key === this.key) return;
    this.key = key;
    const side = this.shape.hand === 'правая' ? -1 : 1;
    this.box.textContent = '';
    for (const slot of this.slots()) {
      const who = people[slot.i];
      if (who === undefined) continue;
      const x = p.x + slot.x;
      const y = p.y + slot.y;
      const el = document.createElement('div');
      el.className = 'fan-slot';
      if (who.kind === 'герой') el.classList.add('hero');
      if (who.busy === true) el.classList.add('busy');
      if (slot.i === this.picked) el.classList.add('lead');
      el.dataset['i'] = String(slot.i);
      el.style.width = `${this.shape.size}px`;
      el.style.height = `${this.shape.size}px`;
      el.style.left = `${x - this.shape.size / 2}px`;
      el.style.top = `${y - this.shape.size / 2}px`;
      el.innerHTML = avatarSvg(who.look, who.seed);
      if (who.asking === true) el.append(document.createElement('i'));
      this.hooks.decorate?.(el, slot, who);
      if (this.hooks.input !== false) {
        el.addEventListener('pointerdown', (e: PointerEvent) => this.start(e));
      }
      this.box.append(el);

      // Подпись выносится на внешнюю дугу, а не под кружок: под кружком она
      // ложится на следующий слот — соседи стоят в полсотни пикселей.
      if (this.hooks.labels !== true) continue;
      const out = this.shape.radius + this.shape.size / 2 + 10;
      const label = document.createElement('div');
      label.className = 'fan-name';
      label.textContent = who.name;
      label.style.left = `${p.x + side * Math.cos(slot.angle) * out - 32}px`;
      label.style.top = `${p.y - Math.sin(slot.angle) * out - 6}px`;
      this.box.append(label);
    }
  }

  /* ---------- палец ---------- */

  private start(e: PointerEvent): void {
    const { angle } = this.polar(e.clientX, e.clientY);
    this.down = { x: e.clientX, y: e.clientY, angle, offset: this.offset };
    this.moved = false;
  }

  private listen(): void {
    // Слушает окно, а не слой: слой прозрачен для пальца, и палец, съехавший
    // с лица, иначе увозил бы жест в никуда — дуга застревала бы на полпути.
    window.addEventListener('pointermove', (e: PointerEvent) => {
      const down = this.down;
      if (down === null) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) this.moved = true;
      if (!this.moved || !scrolls(this.shape, this.hooks.people().length)) return;
      // Дуга едет за пальцем: палец вниз — поздние приходят сверху.
      const { angle } = this.polar(e.clientX, e.clientY);
      this.offset = clampOffset(
        this.shape,
        this.hooks.people().length,
        down.offset + (down.angle - angle),
      );
      this.draw();
    });
    const up = (e: PointerEvent): void => {
      if (this.down === null) return;
      const wasMoved = this.moved;
      this.down = null;
      this.moved = false;
      if (wasMoved) return;
      const i = this.slotAt(e.clientX, e.clientY);
      if (i >= 0) this.hooks.onPick(i);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => {
      this.down = null;
      this.moved = false;
    });
  }
}
