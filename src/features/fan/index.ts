/**
 * Веер (`?веер`) — отладочная сцена под один вопрос: **со скольких человек
 * дуга перестаёт помещаться под большой палец.**
 *
 * Отряд — это трое (§11.8), и трое влезают в любую дугу; вопрос возникает
 * там, где тем же контролом хотят брать всех людей лагеря разом, а жильцов
 * десятки. Спорить об этом бессмысленно: ёмкость дуги считается, а промахи
 * пальца замеряются. Сцена делает и то и другое.
 *
 * **Что здесь есть.**
 * 1. Веер: слоты по дуге вокруг нижнего угла, ручки на число людей, радиус,
 *    поперечник слота и руку. Прокрутка появляется сама, когда люди
 *    перестают помещаться, и не раньше.
 * 2. Обвод: досягаемость не берётся из статьи, а обводится пальцем на том
 *    телефоне, где меряют. До обвода сцена честно пишет «не обведено».
 * 3. Упражнение: сцена называет человека, палец его ищет; считаются промахи
 *    и медиана времени. Строчка замера ложится в таблицу — по ней и видно,
 *    на каком числе людей палец начинает мазать.
 *
 * **Сцена забирает экран целиком, и это намеренно.** Веер меряется как
 * контрол, а не как слой поверх лагеря: если под пальцем окажется ещё
 * и лагерь, промах перестанет быть промахом по вееру. Лагерь виден за ним
 * фоном — чтобы размер и место читались на настоящем кадре, а не на пустоте.
 *
 * Стили лежат здесь же, а не в `style.css`: это отладочный орган, как стенд
 * (`?bench`), и игре его классы не нужны ни на одном экране.
 */
import {
  SHAPE,
  calibrated,
  capacity,
  clampOffset,
  emptyReach,
  layout,
  makeDrill,
  minRadius,
  answer as drillAnswer,
  result as drillResult,
  target as drillTarget,
  reached,
  record,
  scrolls,
  tight,
} from './fan';
import type { Drill, FanShape, Hand, Reach, Slot } from './fan';
import { avatarSvg } from './avatar';
import type { AvatarLook } from './avatar';

export {
  FITS,
  QUADRANT,
  SHAPE,
  TAP,
  capacity,
  clampOffset,
  layout,
  makeDrill,
  maxOffset,
  minRadius,
  scrolls,
  step,
  tight,
} from './fan';
export type { FanShape, Hand, Slot } from './fan';
export { AVATAR_LOOKS, avatarSvg } from './avatar';
export type { AvatarLook } from './avatar';

/** Человек в веере. Сцене нужно ровно это — остальное про него знает игра. */
export interface FanPerson {
  readonly name: string;
  readonly kind: 'герой' | 'жилец';
  /** Чьё лицо рисовать (`avatar.ts`). */
  readonly look: AvatarLook;
  /** Сид лица: тот же человек — то же лицо, сколько ни перерисовывай. */
  readonly seed: number;
  /** Короткая подпись состояния: «готов», «лечится», «без крыши». */
  readonly state: string;
  /** Есть ли у него вопрос — та метка, ради которой список и затевался. */
  readonly asking: boolean;
}

/** Полосы экрана, занятые игрой: сверху ресурсы, снизу строка действий. */
export interface Reserve {
  readonly top: number;
  readonly bottom: number;
}

export interface FanHooks {
  /** Столько людей, сколько просит ручка: свои первыми, дальше выдуманные. */
  readonly people: (n: number) => readonly FanPerson[];
  /**
   * Что уже занято игрой. Веер не имеет права лезть под нижнюю строку
   * («Отряд», «Стены», «В мир») и под ресурсы сверху: контрол, стоящий
   * на чужой кнопке, мерит не себя, а спор двух панелей.
   */
  readonly reserve: () => Reserve;
}

/** Строка замера: одна попытка упражнения при одной раскладке. */
interface Row {
  людей: number;
  радиус: number;
  слот: number;
  'в дуге': number;
  'в обводе': number | string;
  попаданий: string;
  медиана: number;
}

const CSS = `
#fan { position: fixed; inset: 0; z-index: 9; touch-action: none;
  font: 12px/1.3 ui-sans-serif, system-ui, sans-serif; color: #e8e2d4; }
#fan canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.fan-slot { position: absolute; border-radius: 50%; overflow: hidden;
  border: 1px solid rgba(232,226,212,0.35); background: rgba(30,28,24,0.9); }
.fan-slot svg { display: block; width: 100%; height: 100%; }
.fan-slot.hero { border-color: #6d5a30; }
.fan-slot b { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  font-size: 15px; font-weight: 700; color: #e8e2d4; text-shadow: 0 1px 3px #0b0a09;
  background: rgba(11,10,9,0.55); border-radius: 50%; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center; }
.fan-slot.far { opacity: 0.35; }
.fan-slot.want { border-color: #e2a33c; border-width: 2px; box-shadow: 0 0 0 4px rgba(226,163,60,0.25); }
.fan-slot.pick { border-color: #7fb069; border-width: 2px; }
.fan-slot i { position: absolute; top: -1px; right: -1px; width: 10px; height: 10px;
  border-radius: 50%; background: #e2a33c; border: 1px solid #0b0a09; }
.fan-name { position: absolute; width: 64px; text-align: center; font-size: 9px;
  color: #9a927f; pointer-events: none; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
#fan .box { position: absolute; background: rgba(14,13,11,0.9);
  border: 1px solid rgba(232,226,212,0.14); border-radius: 10px; padding: 7px 9px; }
/* Обе панели сцены стоят ниже полосы игры: её верх занят ресурсами
   и кнопкой настроек, и накрывать их отладочным листом значит мерить
   не веер, а то, что из-под него видно. Отступ сверху ставит sync числом
   из reserve(), а не константой — полоса игры не всегда одной высоты. */
#fan-panel { left: 6px; max-width: 224px; }
/* Строка задания стоит внизу слева, а не сверху: сверху справа живёт
   кнопка «Данные», а на упражнении глаз и так идёт вниз — к пальцу.
   Ширина ограничена левой половиной, дуга занимает правую. */
/* Строка задания не берёт нажатий: она стоит у самой дуги, и палец,
   задевший её край вместо кружка, записывался бы промахом — замер
   портился бы собственной подписью. */
#fan-note { left: 6px; max-width: 172px; font-size: 13px; pointer-events: none; }
#fan-panel .grid { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px;
  font-variant-numeric: tabular-nums; }
#fan-panel .k { color: #9a927f; }
#fan-panel .acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
#fan button { font: inherit; color: #e8e2d4; background: rgba(60,51,32,0.8);
  border: 1px solid rgba(232,226,212,0.2); border-radius: 6px; padding: 5px 8px;
  touch-action: manipulation; }
#fan button.on { background: #6d5a30; }
#fan-log { margin-top: 6px; max-height: 26vh; overflow: auto; color: #9a927f;
  font-size: 10px; font-variant-numeric: tabular-nums; }
#fan-log b { color: #e8e2d4; font-weight: 600; }
`;

export function installFan(hooks: FanHooks): void {
  const root = document.createElement('div');
  root.id = 'fan';
  const style = document.createElement('style');
  style.textContent = CSS;
  const canvas = document.createElement('canvas');
  const slotBox = document.createElement('div');
  const panel = document.createElement('div');
  panel.id = 'fan-panel';
  panel.className = 'box';
  const note = document.createElement('div');
  note.id = 'fan-note';
  note.className = 'box';
  root.append(style, canvas, slotBox, panel, note);
  document.body.append(root);

  let shape: FanShape = { ...SHAPE };
  let count = 3;
  let offset = 0;
  let picked = 0;
  let reach = emptyReach(shape.span);
  let tracing = false;
  let drill: Drill | null = null;
  let asked = 0;
  const rows: Row[] = [];

  panel.innerHTML = `
    <div class="grid">
      <span class="k">людей</span><b id="fan-n"></b>
      <span class="k">радиус</span><b id="fan-r"></b>
      <span class="k">слот</span><b id="fan-s"></b>
      <span class="k">в дуге</span><b id="fan-cap"></b>
      <span class="k">в обводе</span><b id="fan-reach"></b>
      <span class="k">прокрутка</span><b id="fan-scroll"></b>
    </div>
    <div class="acts">
      <button id="fan-n-less">−чел</button><button id="fan-n-more">+чел</button>
      <button id="fan-r-less">−рад</button><button id="fan-r-more">+рад</button>
      <button id="fan-s-less">−слот</button><button id="fan-s-more">+слот</button>
      <button id="fan-hand">рука</button>
      <button id="fan-trace">обвод</button>
      <button id="fan-drill">упражнение</button>
      <button id="fan-clear">сброс</button>
    </div>
    <div id="fan-log"></div>`;

  const pick = <T extends HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;
  const out = {
    n: pick('fan-n'),
    r: pick('fan-r'),
    s: pick('fan-s'),
    cap: pick('fan-cap'),
    reach: pick('fan-reach'),
    scroll: pick('fan-scroll'),
    log: pick('fan-log'),
  };

  /**
   * Основание пальца. Не пиксель угла: сустав лежит внутри экрана, а слот
   * на нулевом угле иначе наполовину уходит за кромку — «не влезает»
   * получалось бы раскладкой, а не пальцем. Отступ равен половине слота
   * с запасом, поэтому крайние слоты видны целиком на любом поперечнике.
   */
  const inset = (): number => shape.size / 2 + 6;
  const pivot = (): { x: number; y: number } => ({
    x: shape.hand === 'правая' ? window.innerWidth - inset() : inset(),
    // Нижняя строка лагеря — не место для веера: сустав поднимается над ней.
    // Замер от этого честнее, а не хуже: в игре эта строка тоже есть,
    // и палец тянется к вееру именно из-над неё.
    y: window.innerHeight - hooks.reserve().bottom - inset(),
  });

  /** Куда показывает точка экрана: угол от нижней кромки и радиус от угла. */
  const polar = (px: number, py: number): { angle: number; radius: number } => {
    const p = pivot();
    const dx = shape.hand === 'правая' ? p.x - px : px - p.x;
    const dy = p.y - py;
    return { angle: Math.atan2(Math.max(dy, 0), Math.max(dx, 0)), radius: Math.hypot(dx, dy) };
  };

  /* ---------- рисование ---------- */

  const slots = (): Slot[] => layout(shape, count, offset);

  function drawGuides(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    if (g === null) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const p = pivot();
    const side = shape.hand === 'правая' ? -1 : 1;
    const at = (angle: number, radius: number): [number, number] => [
      p.x + side * Math.cos(angle) * radius,
      p.y - Math.sin(angle) * radius,
    ];

    // Обвод: то, докуда палец дотянулся. Рисуется первым — он подложка.
    if (calibrated(reach)) {
      g.beginPath();
      g.moveTo(p.x, p.y);
      for (let s = 0; s < reach.ring.length; s++) {
        const r = reach.ring[s]!;
        if (r <= 0) continue;
        const a0 = (s / reach.ring.length) * reach.span;
        const a1 = ((s + 1) / reach.ring.length) * reach.span;
        g.lineTo(...at(a0, r));
        g.lineTo(...at(a1, r));
      }
      g.closePath();
      g.fillStyle = 'rgba(127,176,105,0.14)';
      g.fill();
      g.strokeStyle = 'rgba(11,10,9,0.5)';
      g.lineWidth = 3.5;
      g.stroke();
      g.strokeStyle = 'rgba(127,176,105,0.95)';
      g.lineWidth = 1.5;
      g.stroke();
    }

    // Дуга, по которой стоят слоты, и её концы.
    g.beginPath();
    for (let k = 0; k <= 48; k++) {
      const [x, y] = at((k / 48) * shape.span, shape.radius);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    // Дважды: тёмным вниз, светлым поверх. Одной светлой линии на траве
    // попросту не видно, а невидимая направляющая — это её отсутствие.
    g.strokeStyle = 'rgba(11,10,9,0.45)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(232,226,212,0.55)';
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
  }

  function drawSlots(): void {
    const p = pivot();
    const people = hooks.people(count);
    const want = drill === null ? null : drillTarget(drill);
    slotBox.textContent = '';
    for (const slot of slots()) {
      const who = people[slot.i];
      if (who === undefined) continue;
      const x = p.x + slot.x;
      const y = p.y + slot.y;
      const el = document.createElement('div');
      el.className = 'fan-slot';
      if (who.kind === 'герой') el.classList.add('hero');
      if (calibrated(reach) && !reached(reach, slot)) el.classList.add('far');
      if (slot.i === picked && drill === null) el.classList.add('pick');
      if (slot.i === want) el.classList.add('want');
      el.dataset['i'] = String(slot.i);
      el.style.width = `${shape.size}px`;
      el.style.height = `${shape.size}px`;
      el.style.left = `${x - shape.size / 2}px`;
      el.style.top = `${y - shape.size / 2}px`;
      el.innerHTML = avatarSvg(who.look, who.seed);
      // На упражнении поверх лица встаёт номер. Лицо при этом остаётся:
      // убери его — и замер пойдёт по кружкам с цифрами, то есть не по тому
      // контролу, который меряют. Номер нужен, потому что задание обязано
      // быть однозначным: два имени на одну букву превратили бы время
      // попадания во время чтения.
      if (drill !== null) {
        const num = document.createElement('b');
        num.textContent = String(slot.i + 1);
        el.append(num);
      }
      if (who.asking) el.append(document.createElement('i'));
      slotBox.append(el);

      // Подпись выносится на внешнюю дугу, а не под кружок: под кружком она
      // ложится на следующий слот — соседи на дуге стоят в полсотни пикселей.
      // Слоты подпись не закрывает никогда, а сама она на плотном веере
      // налезает на соседнюю, и это тоже ответ: столько имён уже не читается.
      if (drill !== null) continue;
      const out2 = shape.radius + shape.size / 2 + 10;
      const side = shape.hand === 'правая' ? -1 : 1;
      const label = document.createElement('div');
      label.className = 'fan-name';
      label.textContent = who.name;
      label.style.left = `${p.x + side * Math.cos(slot.angle) * out2 - 32}px`;
      label.style.top = `${p.y - Math.sin(slot.angle) * out2 - 6}px`;
      slotBox.append(label);
    }
  }

  function sync(): void {
    offset = clampOffset(shape, count, offset);
    const band = hooks.reserve();
    panel.style.top = `${band.top + 6}px`;
    note.style.bottom = `${band.bottom + 6}px`;
    drawGuides();
    drawSlots();
    const fits = capacity(shape);
    const shown = slots();
    const near = calibrated(reach) ? shown.filter((s) => reached(reach, s)).length : null;
    out.n.textContent = String(count);
    // Радиус не молчит о тесноте: мест на дуге четыре всегда, и если они
    // при этом налезают, виноват радиус, а не число.
    out.r.textContent = tight(shape)
      ? `${shape.radius} px · тесно, нужно ${Math.ceil(minRadius(shape))}`
      : `${shape.radius} px`;
    out.s.textContent = `${shape.size} px`;
    out.cap.textContent = `${fits} · видно ${shown.length}`;
    out.reach.textContent = near === null ? 'не обведено' : `${near} из ${shown.length}`;
    out.scroll.textContent = scrolls(shape, count) ? 'нужна' : 'не нужна';
    note.textContent = tracing
      ? 'Обведи пальцем, докуда дотягиваешься. Ещё раз «обвод» — закончить.'
      : drill !== null
        ? drillNote()
        : `${hooks.people(count)[picked]?.name ?? '—'} · тап выбирает, протяг крутит`;
  }

  /* ---------- упражнение ---------- */

  const drillNote = (): string => {
    if (drill === null) return '';
    const want = drillTarget(drill);
    const r = drillResult(drill);
    if (want === null) return `Готово · ${r.попаданий}/${r.заданий}, медиана ${r.медиана} мс`;
    const who = hooks.people(count)[want];
    return `Нажми: ${want + 1} · ${who?.name ?? ''} — ${r.заданий + 1} из ${drill.order.length}`;
  };

  function startDrill(rounds = 3): void {
    drill = makeDrill(count, rounds, count * 100 + shape.radius);
    asked = performance.now();
    sync();
  }

  function finishDrill(): void {
    if (drill === null) return;
    const r = drillResult(drill);
    const shown = slots();
    rows.push({
      людей: count,
      радиус: shape.radius,
      слот: shape.size,
      'в дуге': capacity(shape),
      'в обводе': calibrated(reach) ? shown.filter((s) => reached(reach, s)).length : 'нет',
      попаданий: `${r.попаданий}/${r.заданий}`,
      медиана: r.медиана,
    });
    out.log.innerHTML = rows
      .map(
        (x) =>
          `<div><b>${x.людей}</b> чел · r${x.радиус} · слот ${x.слот} · в дуге ${x['в дуге']} · ` +
          `в обводе ${x['в обводе']} · <b>${x.попаданий}</b> · ${x.медиана} мс</div>`,
      )
      .join('');
    drill = null;
  }

  /** Ответ пальцем: −1 — мимо всех. */
  function tap(i: number): void {
    if (drill !== null) {
      drillAnswer(drill, i, performance.now() - asked);
      asked = performance.now();
      if (drillTarget(drill) === null) {
        const done = drillNote();
        finishDrill();
        sync();
        note.textContent = done;
        return;
      }
      sync();
      return;
    }
    if (i >= 0) picked = i;
    sync();
  }

  /* ---------- палец ---------- */

  let down: { x: number; y: number; angle: number; offset: number } | null = null;
  let moved = false;

  root.addEventListener('pointerdown', (e: PointerEvent) => {
    const { angle, radius } = polar(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, angle, offset };
    moved = false;
    if (tracing) {
      record(reach, angle, radius);
      sync();
    }
    root.setPointerCapture(e.pointerId);
  });

  root.addEventListener('pointermove', (e: PointerEvent) => {
    if (down === null) return;
    const { angle, radius } = polar(e.clientX, e.clientY);
    if (tracing) {
      record(reach, angle, radius);
      sync();
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) moved = true;
    if (!moved || !scrolls(shape, count)) return;
    // Дуга едет за пальцем: палец вверх — люди вверх, то есть смещение вниз.
    offset = clampOffset(shape, count, down.offset + (down.angle - angle));
    sync();
  });

  const up = (e: PointerEvent): void => {
    if (down === null) return;
    const wasMoved = moved;
    down = null;
    moved = false;
    if (tracing || wasMoved) return;
    // Кого нажали, решает браузер, а не наша геометрия: промах обязан
    // считаться там же, где он случается, — иначе замеряется не палец,
    // а совпадение двух разных попаданий в круг.
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const box = hit === null ? null : (hit as HTMLElement).closest('.fan-slot');
    const i = box === null ? -1 : Number((box as HTMLElement).dataset['i']);
    tap(Number.isFinite(i) ? i : -1);
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', () => {
    down = null;
    moved = false;
  });

  /* ---------- ручки ---------- */

  const on = (id: string, fn: () => void): void => {
    pick<HTMLButtonElement>(id).addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      sync();
    });
  };
  const clampCount = (n: number): number => Math.min(40, Math.max(1, n));
  on('fan-n-less', () => {
    count = clampCount(count - 1);
    picked = Math.min(picked, count - 1);
  });
  on('fan-n-more', () => {
    count = clampCount(count + 1);
  });
  on('fan-r-less', () => {
    shape = { ...shape, radius: Math.max(40, shape.radius - 10) };
  });
  on('fan-r-more', () => {
    shape = { ...shape, radius: Math.min(400, shape.radius + 10) };
  });
  on('fan-s-less', () => {
    shape = { ...shape, size: Math.max(24, shape.size - 4) };
  });
  on('fan-s-more', () => {
    shape = { ...shape, size: Math.min(96, shape.size + 4) };
  });
  on('fan-hand', () => {
    shape = { ...shape, hand: shape.hand === 'правая' ? 'левая' : 'правая' };
    // Обвод снимается вместе с рукой: правая ладонь не отвечает за левую,
    // и оставленный профиль читался бы замером, которого не делали.
    reach = emptyReach(shape.span);
    pick<HTMLButtonElement>('fan-hand').textContent = `рука: ${shape.hand}`;
  });
  on('fan-trace', () => {
    tracing = !tracing;
    if (tracing) reach = emptyReach(shape.span);
    pick<HTMLButtonElement>('fan-trace').classList.toggle('on', tracing);
  });
  on('fan-drill', () => {
    if (drill === null) startDrill();
    else finishDrill();
    pick<HTMLButtonElement>('fan-drill').classList.toggle('on', drill !== null);
  });
  on('fan-clear', () => {
    rows.length = 0;
    out.log.textContent = '';
    reach = emptyReach(shape.span);
    drill = null;
    offset = 0;
  });
  pick<HTMLButtonElement>('fan-hand').textContent = `рука: ${shape.hand}`;

  window.addEventListener('resize', sync);
  sync();

  (window as unknown as Record<string, unknown>)['веер'] = {
    вид: () => ({
      людей: count,
      ...shape,
      'в дуге': capacity(shape),
      видно: slots().length,
      прокрутка: scrolls(shape, count),
      обвод: calibrated(reach) ? reach.ring.map((r) => Math.round(r)) : 'не обведено',
    }),
    люди: (n: number) => {
      count = clampCount(n);
      sync();
      return capacity(shape);
    },
    радиус: (px: number) => {
      shape = { ...shape, radius: px };
      sync();
      return capacity(shape);
    },
    слот: (px: number) => {
      shape = { ...shape, size: px };
      sync();
      return capacity(shape);
    },
    рука: (h: Hand) => {
      shape = { ...shape, hand: h };
      reach = emptyReach(shape.span);
      sync();
    },
    /**
     * Ёмкость дуги таблицей — тот же расчёт, что и в `npm run fan`, но с той
     * раскладкой, которая сейчас на экране. Пальца не требует.
     */
    ёмкость: (radii = [90, 110, 130, 160, 200, 240]) =>
      radii.map((radius) => ({ радиус: radius, влезает: capacity({ ...shape, radius }) })),
    упражнение: (rounds = 3) => {
      startDrill(rounds);
      return drill?.order.length ?? 0;
    },
    итоги: () => rows.map((r) => ({ ...r })),
    обвод: (): Reach => reach,
    сброс: () => {
      rows.length = 0;
      reach = emptyReach(shape.span);
      drill = null;
      offset = 0;
      out.log.textContent = '';
      sync();
    },
  };
}
