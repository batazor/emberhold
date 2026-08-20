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
import type { CampState } from '../sim/camp';
import { TIER_NAME, TIER_RISK } from '../sim/config';
import { formatDuration } from '../core/clock';
import { CLANS, RICH_MAX, SHIFT_SEC, dayAt, lootMul, regionAt, worldAt } from '../sim/world';
import type { NodeState, Region, WorldNode } from '../sim/world';

/** Цвет узла по богатству: от выработанной к полной жиле. */
const RICH_COLOR: readonly string[] = ['#d4543a', '#c07a3a', '#c8a24a', '#7fb069'];

export interface WorldMapCallbacks {
  /** Игрок выбрал место и решил идти. */
  onRaid(node: number): void;
}

export class WorldMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly card: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly note: HTMLElement;

  /** Выбранный узел. Карта открывается с выбранным местом, а не пустой:
   *  пустая карточка вынуждает тапнуть дважды, чтобы вообще что-то узнать. */
  private focus = 0;
  /** Регион сегодняшнего дня: завтра здесь будут другие точки (§4). */
  private region: Region = regionAt(0);
  private world: NodeState[] = [];
  private camp: CampState | null = null;
  private now = 0;

  constructor(private readonly cb: WorldMapCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'sec map';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-cv';
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('нет 2d-контекста для карты');
    this.ctx = ctx;
    this.canvas.addEventListener('pointerdown', (e) => this.pick(e));

    this.card = document.createElement('div');
    this.card.className = 'map-card';

    this.note = document.createElement('div');
    this.note.className = 'map-note';

    this.go = document.createElement('button');
    this.go.className = 'primary';
    this.go.addEventListener('click', () => this.cb.onRaid(this.node().id));

    this.root.append(this.canvas, this.card, this.note, this.go);
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
    this.world = worldAt(now, camp.visits);
    this.focus = this.defaultFocus();
    this.paint();
  }

  sync(camp: CampState, now: number): void {
    this.camp = camp;
    // Мир меняется сменами по 40 минут — пересчитывать его каждый кадр
    // незачем, а вот срок восстановления в карточке идёт вживую.
    if (Math.floor(now / SHIFT_SEC) !== Math.floor(this.now / SHIFT_SEC)) {
      this.region = regionAt(dayAt(now));
      this.world = worldAt(now, camp.visits);
      if (this.focus >= this.region.nodes.length) this.focus = this.defaultFocus();
    }
    this.now = now;
    this.paint();
  }

  private pick(e: PointerEvent): void {
    const box = this.canvas.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    let best = -1;
    let bestDist = Infinity;
    for (const node of this.region.nodes) {
      const d = Math.hypot((node.x - px) * box.width, (node.y - py) * box.height);
      if (d < bestDist) {
        bestDist = d;
        best = node.id;
      }
    }
    // Промах мимо всех узлов ничего не меняет: карточка обязана оставаться
    // на том месте, о котором игрок только что читал.
    if (best >= 0 && bestDist < box.width * 0.09) {
      this.focus = best;
      this.paint();
    }
  }

  private paint(): void {
    if (this.camp === null || this.region.nodes.length === 0) return;
    this.draw();
    this.paintCard();
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

    // Тракт: связи ближних узлов. Без них двадцать точек читаются как список,
    // а не как местность, и «дальше» перестаёт значить «дороже».
    ctx.strokeStyle = 'rgba(232, 226, 212, 0.10)';
    ctx.lineWidth = 1;
    const spots = [...this.region.nodes, { ...this.region.camp, id: -1 }];
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
    // Лагерь — такая же точка карты, только в него не ходят.
    const camp = this.region.camp;
    ctx.beginPath();
    ctx.arc(camp.x * w, camp.y * h, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 162, 74, 0.22)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#c8a24a';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(camp.x * w, camp.y * h, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#c8a24a';
    ctx.fill();

    for (const node of this.region.nodes) {
      const x = node.x * w;
      const y = node.y * h;
      const state = this.world[node.id];
      const color = RICH_COLOR[state?.rich ?? RICH_MAX] ?? '#c8a24a';

      if (this.focus === node.id) {
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 162, 74, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // Замок — квадрат, вылазка — круг. Форма, а не цвет: цвет на карте уже
      // занят богатством, и второй смысл в него не влезает.
      ctx.beginPath();
      if (node.kind === 'замок') ctx.rect(x - r, y - r, r * 2, r * 2);
      else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 10, 9, 0.85)';
      ctx.fill();
      // Толщина кольца — ярус: цена места видна раньше подписи. У замка
      // яруса нет, и кольцо у него тонкое всегда.
      ctx.lineWidth = node.kind === 'замок' ? 1.4 : 1 + node.tier * 0.9;
      ctx.strokeStyle = node.kind === 'замок' ? '#c8a24a' : color;
      ctx.stroke();

      // Выработанная — крест. Цифру «0 из 3» на карте не прочитать, а решение
      // «сюда не иду» принимается взглядом.
      if (node.kind !== 'замок' && (state?.rich ?? RICH_MAX) === 0) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.5);
        ctx.lineTo(x + r * 0.5, y + r * 0.5);
        ctx.moveTo(x + r * 0.5, y - r * 0.5);
        ctx.lineTo(x - r * 0.5, y + r * 0.5);
        ctx.strokeStyle = 'rgba(212, 84, 58, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      const clan = node.kind === 'замок' ? null : state?.clan ?? null;
      if (clan !== null) {
        ctx.fillStyle = CLANS[clan % CLANS.length]!.color;
        ctx.fillRect(x + r * 0.95, y - r * 1.35, r * 0.62, r * 0.62);
      }
    }
  }

  /* ---------- карточка ---------- */

  private paintCard(): void {
    const node = this.node();
    if (node.kind === 'замок') {
      this.paintKeepCard(node);
      return;
    }
    const state = this.world[node.id] ?? { rich: RICH_MAX, clan: null, restShifts: 0 };
    const mul = lootMul(state.rich);
    const clan = state.clan === null ? null : CLANS[state.clan % CLANS.length]!;

    const pips = Array.from(
      { length: RICH_MAX },
      (_, i) => `<s class="${i < state.rich ? '' : 'off'}"></s>`,
    ).join('');

    this.card.innerHTML =
      `<div class="t"><b>${node.name}</b><i>${state.rich} из ${RICH_MAX}</i></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="line"><span>${TIER_NAME[node.tier]}</span>` +
      `<b>ставка ${Math.round(TIER_RISK[node.tier] * 100)}%</b></div>` +
      `<div class="line"><span>Добыча</span>` +
      `<b class="${mul < 1 ? 'bad' : 'good'}">×${mul.toFixed(1).replace('.', ',')}</b></div>` +
      `<div class="line"><span>Кто здесь</span>` +
      (clan === null
        ? '<b class="good">никого</b>'
        : `<b style="color:${clan.color}">${clan.name}</b>`) +
      '</div>';

    // Срок восстановления — вместо запрета. Локация не закрыта, она просто
    // невыгодна, и игрок должен видеть, когда сюда снова стоит идти.
    this.note.textContent =
      state.restShifts > 0
        ? `Ещё один заход вернётся через ${formatDuration(state.restShifts * SHIFT_SEC)}`
        : 'Полная жила: три захода';

    // Кнопка называется действием, а не местом: имя локации склоняется,
    // а имена в прототипе рабочие (§0.1) и меняются без предупреждения.
    this.go.textContent = 'Войти';
  }

  /**
   * Карточка замка (§6.1.6). Ни ставки, ни добычи, ни клана: их там нет,
   * и показывать прочерки в четырёх строках подряд — значит обещать, что
   * когда-нибудь они заполнятся сами. Вместо этого сказано прямо, что здесь
   * есть сейчас: постройка, по которой можно ходить.
   */
  private paintKeepCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="t"><b>${node.name}</b><i>постройка</i></div>` +
      '<div class="line"><span>Что там</span><b>стены, башни, двор</b></div>' +
      '<div class="line"><span>Добыча</span><b>нет</b></div>' +
      '<div class="line"><span>Кто здесь</span><b class="good">никого</b></div>';
    this.note.textContent = 'Прогулка: ни добычи, ни противников. Выход открыт сразу.';
    this.go.textContent = 'Пойти';
  }
}
