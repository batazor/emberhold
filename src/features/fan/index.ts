/**
 * Веер (`?fan`) — отладочная сцена под один вопрос: **со скольких человек
 * дуга перестаёт помещаться под большой палец.**
 *
 * Сам контрол живёт в `control.ts` и стоит в лагере (§11.8): тем же веером
 * выбирают ведущего отряда. Здесь — только органы замера вокруг него.
 *
 * **Что здесь есть.**
 * 1. Ручки: число людей, радиус, поперечник слота, рука. Мест на дуге четыре
 *    (`FITS`) — это решение, и радиус обязан быть не мельче потребного.
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
  calibrated,
  capacity,
  emptyReach,
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
import type { Drill, FanShape, Hand, Reach } from './fan';
import { FanControl } from './control';
import type { FanPerson, Reserve } from './control';

export { FanControl } from './control';
export type { ControlHooks, FanPerson, Reserve } from './control';
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
export { AVATAR_LOOKS, avatarSvg, avatarTraits } from '../../ui/avatar';
export type { AvatarLook, AvatarTraits } from '../../ui/avatar';

export interface FanHooks {
  /** Столько людей, сколько просит ручка: свои первыми, дальше выдуманные. */
  readonly people: (n: number) => readonly FanPerson[];
  /** Что уже занято игрой: сцена стоит рядом с панелями, а не на них. */
  readonly reserve: () => Reserve;
}

/** Строка замера: одна попытка упражнения при одной раскладке. */
interface Row {
  people: number;
  radius: number;
  size: number;
  reached: number | string;
  hits: string;
  median: number;
}

const CSS = `
#fan { position: fixed; inset: 0; z-index: 9; touch-action: none;
  font: 12px/1.3 ui-sans-serif, system-ui, sans-serif; color: #e8e2d4; }
#fan canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#fan .box { position: absolute; background: rgba(14,13,11,0.9);
  border: 1px solid rgba(232,226,212,0.14); border-radius: 10px; padding: 7px 9px; }
/* Обе панели сцены стоят ниже полосы игры: её верх занят ресурсами
   и кнопкой настроек, и накрывать их отладочным листом значит мерить
   не веер, а то, что из-под него видно. Отступ сверху ставит sync числом
   из reserve(), а не константой — полоса игры не всегда одной высоты. */
#fan-panel { left: 6px; max-width: 224px; }
/* Строка задания стоит внизу слева, а не сверху: на упражнении глаз и так
   идёт вниз — к пальцу.
   Нажатий она не берёт: палец, задевший её край вместо кружка,
   записывался бы промахом — замер портился бы собственной подписью. */
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
  const panel = document.createElement('div');
  panel.id = 'fan-panel';
  panel.className = 'box';
  const note = document.createElement('div');
  note.id = 'fan-note';
  note.className = 'box';
  root.append(style, canvas, panel, note);
  document.body.append(root);

  let count = 3;
  let reach = emptyReach();
  let tracing = false;
  let drill: Drill | null = null;
  let asked = 0;
  const rows: Row[] = [];

  // Контрол — тот же, что в лагере. Палец ведёт сцена: у неё обвод
  // и упражнение, и разделять один жест на двоих нельзя.
  const fan = new FanControl({
    parent: root,
    people: () => hooks.people(count),
    reserve: hooks.reserve,
    onPick: () => {},
    input: false,
    labels: true,
    decorate: (el, slot) => {
      if (calibrated(reach) && !reached(reach, slot)) el.classList.add('far');
      if (drill === null) return;
      el.classList.remove('lead');
      if (slot.i === drillTarget(drill)) el.classList.add('want');
      // Поверх лица встаёт номер. Лицо при этом остаётся: убери его — и замер
      // пойдёт по кружкам с цифрами, то есть не по тому контролу, который
      // меряют. Номер нужен, потому что задание обязано быть однозначным:
      // два имени на одну букву превратили бы время попадания во время чтения.
      const num = document.createElement('b');
      num.textContent = String(slot.i + 1);
      el.append(num);
    },
  });
  const shape = (): FanShape => fan.shape;

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

  /* ---------- направляющие ---------- */

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
    const p = fan.pivot();
    const side = shape().hand === 'правая' ? -1 : 1;
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

    // Дуга, по которой стоят слоты.
    g.beginPath();
    for (let k = 0; k <= 48; k++) {
      const [x, y] = at((k / 48) * shape().span, shape().radius);
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

  function sync(): void {
    const band = hooks.reserve();
    panel.style.top = `${band.top + 6}px`;
    note.style.bottom = `${band.bottom + 6}px`;
    drawGuides();
    // Сцена рисует силой: её добавки (номер задания, гашение по обводу)
    // в подпись кадра не входят, и без принуждения не обновлялись бы.
    fan.draw(true);
    const shown = fan.slots();
    const near = calibrated(reach) ? shown.filter((s) => reached(reach, s)).length : null;
    out.n.textContent = String(count);
    // Радиус не молчит о тесноте: мест на дуге четыре всегда, и если они
    // при этом налезают, виноват радиус, а не число.
    out.r.textContent = tight(shape())
      ? `${shape().radius} px · тесно, нужно ${Math.ceil(minRadius(shape()))}`
      : `${shape().radius} px`;
    out.s.textContent = `${shape().size} px`;
    out.cap.textContent = `${capacity(shape())} · видно ${shown.length}`;
    out.reach.textContent = near === null ? 'не обведено' : `${near} из ${shown.length}`;
    out.scroll.textContent = scrolls(shape(), count) ? 'нужна' : 'не нужна';
    note.textContent = tracing
      ? 'Обведи пальцем, докуда дотягиваешься. Ещё раз «обвод» — закончить.'
      : drill !== null
        ? drillNote()
        : `${hooks.people(count)[fan.picked]?.name ?? '—'} · тап выбирает, протяг крутит`;
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
    drill = makeDrill(count, rounds, count * 100 + shape().radius);
    asked = performance.now();
    sync();
  }

  function finishDrill(): void {
    if (drill === null) return;
    const r = drillResult(drill);
    const shown = fan.slots();
    rows.push({
      people: count,
      radius: shape().radius,
      size: shape().size,
      reached: calibrated(reach) ? shown.filter((s) => reached(reach, s)).length : 'none',
      hits: `${r.попаданий}/${r.заданий}`,
      median: r.медиана,
    });
    out.log.innerHTML = rows
      .map(
        (x) =>
          `<div><b>${x.people}</b> чел · r${x.radius} · слот ${x.size} · ` +
          `в обводе ${x.reached} · <b>${x.hits}</b> · ${x.median} мс</div>`,
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
    if (i >= 0) fan.picked = i;
    sync();
  }

  /* ---------- палец ---------- */

  let down: { x: number; y: number; angle: number; offset: number } | null = null;
  let moved = false;

  root.addEventListener('pointerdown', (e: PointerEvent) => {
    const { angle, radius } = fan.polar(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, angle, offset: fan.offset };
    moved = false;
    if (tracing) {
      record(reach, angle, radius);
      sync();
    }
    root.setPointerCapture(e.pointerId);
  });

  root.addEventListener('pointermove', (e: PointerEvent) => {
    if (down === null) return;
    const { angle, radius } = fan.polar(e.clientX, e.clientY);
    if (tracing) {
      record(reach, angle, radius);
      sync();
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) moved = true;
    if (!moved || !scrolls(shape(), count)) return;
    // Дуга едет за пальцем: палец вверх — люди вверх, то есть смещение вниз.
    fan.offset = down.offset + (down.angle - angle);
    sync();
  });

  const up = (e: PointerEvent): void => {
    if (down === null) return;
    const wasMoved = moved;
    down = null;
    moved = false;
    if (tracing || wasMoved) return;
    tap(fan.slotAt(e.clientX, e.clientY));
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
    fan.picked = Math.min(fan.picked, count - 1);
  });
  on('fan-n-more', () => {
    count = clampCount(count + 1);
  });
  on('fan-r-less', () => {
    fan.shape = { ...shape(), radius: Math.max(40, shape().radius - 10) };
  });
  on('fan-r-more', () => {
    fan.shape = { ...shape(), radius: Math.min(400, shape().radius + 10) };
  });
  on('fan-s-less', () => {
    fan.shape = { ...shape(), size: Math.max(24, shape().size - 4) };
  });
  on('fan-s-more', () => {
    fan.shape = { ...shape(), size: Math.min(96, shape().size + 4) };
  });
  on('fan-hand', () => {
    fan.shape = { ...shape(), hand: shape().hand === 'правая' ? 'левая' : 'правая' };
    // Обвод снимается вместе с рукой: правая ладонь не отвечает за левую,
    // и оставленный профиль читался бы замером, которого не делали.
    reach = emptyReach(shape().span);
    pick<HTMLButtonElement>('fan-hand').textContent = `рука: ${shape().hand}`;
  });
  on('fan-trace', () => {
    tracing = !tracing;
    if (tracing) reach = emptyReach(shape().span);
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
    reach = emptyReach(shape().span);
    drill = null;
    fan.offset = 0;
  });
  pick<HTMLButtonElement>('fan-hand').textContent = `рука: ${shape().hand}`;

  window.addEventListener('resize', sync);
  sync();

  const publicHand = (hand: Hand): 'left' | 'right' => (hand === 'левая' ? 'left' : 'right');
  const localHand = (hand: 'left' | 'right'): Hand => (hand === 'left' ? 'левая' : 'правая');

  (window as unknown as Record<string, unknown>)['fan'] = {
    view: () => {
      const s = shape();
      return {
        people: count,
        radius: s.radius,
        size: s.size,
        span: s.span,
        hand: publicHand(s.hand),
        capacity: capacity(s),
        visible: fan.slots().length,
        scrolls: scrolls(s, count),
        tight: tight(s),
        reach: calibrated(reach) ? reach.ring.map((r) => Math.round(r)) : 'not traced',
      };
    },
    people: (n: number) => {
      count = clampCount(n);
      sync();
      return capacity(shape());
    },
    radius: (px: number) => {
      fan.shape = { ...shape(), radius: px };
      sync();
      return Math.ceil(minRadius(shape()));
    },
    size: (px: number) => {
      fan.shape = { ...shape(), size: px };
      sync();
      return Math.ceil(minRadius(shape()));
    },
    hand: (h: 'left' | 'right') => {
      fan.shape = { ...shape(), hand: localHand(h) };
      reach = emptyReach(shape().span);
      sync();
    },
    /** Потребный радиус под разные поперечники слота. Пальца не требует. */
    radii: (sizes = [36, 44, 52, 64]) =>
      sizes.map((size) => ({ size, needed: Math.ceil(minRadius({ ...shape(), size })) })),
    drill: (rounds = 3) => {
      startDrill(rounds);
      return drill?.order.length ?? 0;
    },
    results: () => rows.map((r) => ({ ...r })),
    reach: (): Reach => reach,
    reset: () => {
      rows.length = 0;
      reach = emptyReach(shape().span);
      drill = null;
      fan.offset = 0;
      out.log.textContent = '';
      sync();
    },
  };
}
