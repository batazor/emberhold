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
import { TIER_NAME, TIER_RISK } from '../sim/config';
import { EVENTS, effectOf } from '../sim/events';
import type { EventId } from '../sim/events';
import { formatDuration } from '../core/clock';
import { CLANS, RICH_MAX, SHIFT_SEC, dayAt, lootMul, regionAt, worldAt } from '../sim/world';
import type { NodeState, Region, WorldNode } from '../sim/world';
import { drawMapTerrain } from './mapTerrain';

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

export interface WorldMapCallbacks {
  /** Игрок выбрал место и решил идти. */
  onRaid(node: number): void;
}

/**
 * Почему сюда нельзя. Причина, а не булево, — то же правило, что у построек
 * (`camp.ts`) и у мест под здание в прологе: игрок обязан видеть, что мешает,
 * а не молчащую серую кнопку.
 */
export type EntryBlock = 'ok' | 'kitchen' | 'onb';

const ENTRY_REASON: Record<Exclude<EntryBlock, 'ok'>, string> = {
  kitchen: 'Провианта не хватит на такую глубину — нужна Кухня выше',
  onb: 'Первая вылазка идёт в другое место — оно одно горит на карте',
};

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
  /**
   * Единственное место, открытое первой вылазкой (§16.2); null — карта открыта
   * целиком. Ставится снаружи: карта не знает про кадры раскадровки, ей
   * говорят «сегодня можно только сюда».
   */
  private only: number | null = null;

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
    // §4, артбук `world.html`: вход в локацию — единственное необратимое
    // действие на этом экране, и класс у него свой. Прежний `primary`
    // не имел в карте ни одного правила и падал на общую `button`.
    this.go.className = 'cta';
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

    const spots = [...this.region.nodes, { ...this.region.camp, id: -1 }];

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

      // Замок — квадрат, кладбище — крест, вылазка — круг. Форма, а не цвет:
      // цвет на карте уже занят богатством, и второй смысл в него не влезает.
      ctx.beginPath();
      if (node.kind === 'замок') ctx.rect(x - r, y - r, r * 2, r * 2);
      else if (node.kind === 'кладбище') {
        ctx.moveTo(x - r * 0.42, y - r);
        ctx.lineTo(x + r * 0.42, y - r);
        ctx.lineTo(x + r * 0.42, y - r * 0.3);
        ctx.lineTo(x + r, y - r * 0.3);
        ctx.lineTo(x + r, y + r * 0.12);
        ctx.lineTo(x + r * 0.42, y + r * 0.12);
        ctx.lineTo(x + r * 0.42, y + r);
        ctx.lineTo(x - r * 0.42, y + r);
        ctx.lineTo(x - r * 0.42, y + r * 0.12);
        ctx.lineTo(x - r, y + r * 0.12);
        ctx.lineTo(x - r, y - r * 0.3);
        ctx.lineTo(x - r * 0.42, y - r * 0.3);
        ctx.closePath();
      } else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 10, 9, 0.85)';
      ctx.fill();
      // Толщина кольца — ярус: цена места видна раньше подписи. У замка
      // яруса нет, и кольцо у него тонкое всегда.
      const walk = node.kind !== 'вылазка';
      ctx.lineWidth = walk ? 1.4 : 1 + node.tier * 0.9;
      ctx.strokeStyle = node.kind === 'замок' ? '#c8a24a' : node.kind === 'кладбище' ? '#9fb6d8' : color;
      ctx.stroke();

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
      const event = node.kind === 'замок' ? null : state?.event ?? null;
      if (event !== null) drawEventGlyph(ctx, event, x, y, r, w, h);

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
    if (node.kind === 'замок') return 'ok';
    if (this.camp !== null && tierBlock(this.camp, node.tier) !== 'ok') return 'kitchen';
    return 'ok';
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
    if (node !== null) this.focus = node;
    this.paint();
  }

  /* ---------- карточка ---------- */

  private paintCard(): void {
    const node = this.node();
    if (node.kind === 'замок') {
      this.paintKeepCard(node);
      return;
    }
    if (node.kind === 'кладбище') {
      this.paintGraveCard(node);
      return;
    }
    const state = this.world[node.id] ?? { rich: RICH_MAX, clan: null, restShifts: 0, event: null };
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

    this.card.innerHTML =
      `<div class="t"><b>${node.name}</b><i>${state.rich} из ${RICH_MAX}</i></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="line"><span>${TIER_NAME[node.tier]}</span>` +
      `<b class="${fx.risk > 0 ? 'bad' : ''}">ставка ${Math.round(stake * 100)}%</b></div>` +
      `<div class="line"><span>Добыча</span>` +
      `<b class="${mul < 1 ? 'bad' : 'good'}">×${mul.toFixed(1).replace('.', ',')}</b></div>` +
      `<div class="line"><span>Кто здесь</span>` +
      (clan === null
        ? '<b class="good">никого</b>'
        : `<b style="color:${clan.color}">${clan.name}</b>`) +
      '</div>' +
      // §11.6 — событие названо до входа, как ставка и богатство. Строка
      // появляется только тогда, когда есть что сказать: пустое «Событие: —»
      // обещало бы, что когда-нибудь оно заполнится само.
      (state.event === null
        ? ''
        : `<div class="line"><span>${EVENTS[state.event].name}</span>` +
          `<b class="${state.event === 'collapse' ? 'bad' : 'good'}">` +
          `${EVENTS[state.event].line}</b></div>`);

    // Срок восстановления — вместо запрета. Локация не закрыта, она просто
    // невыгодна, и игрок должен видеть, когда сюда снова стоит идти.
    this.note.textContent =
      state.restShifts > 0
        ? `Ещё один заход вернётся через ${formatDuration(state.restShifts * SHIFT_SEC)}`
        : 'Полная жила: три захода';

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
    this.go.textContent = hot ? `Войти · ставка ${Math.round(stake * 100)}%` : 'Войти';
    this.go.classList.toggle('danger', hot && block === 'ok');
    this.go.disabled = block !== 'ok';
    // Отказ говорит причиной и перебивает срок восстановления: игроку сейчас
    // важнее, почему сюда нельзя, чем когда сюда снова будет выгодно.
    if (block !== 'ok') this.note.textContent = ENTRY_REASON[block];
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
      `<div class="t"><b>${node.name}</b><i>прогулка</i></div>` +
      '<div class="line"><span>Что там</span><b>ограда, могилы, склеп</b></div>' +
      '<div class="line"><span>Добыча</span><b>нет</b></div>' +
      '<div class="line"><span>Кто здесь</span><b class="bad">привидения</b></div>';
    this.note.textContent = 'Прогулка: добычи нет. Привидение медленнее вас — от него можно уйти.';
    this.go.textContent = 'Пойти';
  }

  private paintKeepCard(node: WorldNode): void {
    this.card.innerHTML =
      `<div class="t"><b>${node.name}</b><i>постройка</i></div>` +
      '<div class="line"><span>Что там</span><b>стены, башни, двор</b></div>' +
      '<div class="line"><span>Добыча</span><b>нет</b></div>' +
      '<div class="line"><span>Кто здесь</span><b class="good">никого</b></div>';
    this.note.textContent = 'Прогулка: ни добычи, ни противников. Выход открыт сразу.';
    this.go.textContent = 'Пойти';
    // У замка ставки нет вовсе (§6.1.6) — и оранжевой кнопке там взяться неоткуда.
    this.go.classList.remove('danger');
    this.go.disabled = this.entryBlock(node) !== 'ok';
  }
}
