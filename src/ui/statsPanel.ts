import {
  BUILDING_ORDER,
  BUILDINGS,
  MAX_LEVEL,
  TIER_KITCHEN_GATE,
  buildingMaxLevel,
  isUnlocked,
  tierBlock,
} from '../sim/camp';
import type { CampState } from '../sim/camp';
import { neighboursOpen } from '../sim/clan';
import { campsByLikes, standings } from '../sim/standing';
import type { LiveCamp } from '../sim/standing';
import { clearTelemetry, events, summarize } from '../sim/telemetry';
import type { TelemetryEvent } from '../sim/telemetry';
import type { Tier } from '../sim/types';
import { gameMarkup, gameMessage } from '../i18n/game';

/**
 * §9 — личные данные игрока теперь читаются как прогресс, а не как прибор.
 * Сырые события и диагностические ориентиры остаются доступны внизу, но
 * первый экран отвечает на три человеческих вопроса: что выросло, насколько
 * далеко я хожу и какой рубеж был последним.
 */
const pct = (x: number): string => `${Math.round(x * 100)}%`;

const html = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const raidEnds = (
  list: readonly TelemetryEvent[],
): Extract<TelemetryEvent, { t: 'raid_end' }>[] =>
  list.filter((event): event is Extract<TelemetryEvent, { t: 'raid_end' }> => event.t === 'raid_end');

export interface RaidTrend {
  readonly values: readonly number[];
  /** null — сравнивать пока не с чем. */
  readonly change: number | null;
}

/** Последние шесть вылазок для рисунка и две пятёрки для честного сравнения. */
export function raidTrend(list: readonly TelemetryEvent[]): RaidTrend {
  const carried = raidEnds(list).map((event) => event.carried);
  const recent = carried.slice(-5);
  const previous = carried.slice(-10, -5);
  const before = mean(previous);
  return {
    values: carried.slice(-6),
    change: recent.length === 0 || previous.length === 0 || before <= 0
      ? null
      : (mean(recent) - before) / before,
  };
}

export interface ChronicleItem {
  readonly at: number;
  readonly title: string;
  readonly note: string;
}

/**
 * Личная хроника из уже существующих событий. Обычная вылазка в неё не
 * попадает: летопись хранит рубежи, а не журнал каждого шага.
 */
export function chronicle(list: readonly TelemetryEvent[]): ChronicleItem[] {
  const out: ChronicleItem[] = [];
  const firstTier = new Set<Tier>();

  for (const event of list) {
    if (event.t === 'raid_end' && !event.failed && !firstTier.has(event.tier)) {
      firstTier.add(event.tier);
      out.push({
        at: event.at,
        title: event.tier === 0 ? 'Первая вылазка завершена' : `Открыт путь через Ярус ${event.tier}`,
        note: `Вынесено ${event.carried} ресурсов`,
      });
    } else if (event.t === 'build_done') {
      out.push({
        at: event.at,
        title: `${BUILDINGS[event.building].name} — уровень ${event.level}`,
        note: BUILDINGS[event.building].effect(event.level),
      });
    } else if (event.t === 'craft') {
      out.push({ at: event.at, title: 'Снаряжение улучшено', note: `Новый уровень — ${event.toLevel}` });
    } else if (event.t === 'train_start') {
      out.push({ at: event.at, title: 'Начата тренировка', note: `Герой уровня ${event.level} вышел на Плац` });
    } else if (event.t === 'speedup') {
      out.push({
        at: event.at,
        title: `${BUILDINGS[event.building].name} ускорено`,
        note: `Потрачено ${event.cost} монет`,
      });
    }
  }

  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

const relativeTime = (at: number, now: number): string => {
  const seconds = Math.max(0, now - at);
  if (seconds < 60) return 'только что';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч назад`;
  return `${Math.floor(seconds / 86400)} дн назад`;
};

const bar = (share: number, kind = ''): string =>
  `<div class="bar"><i${kind === '' ? '' : ` class="${kind}"`} style="width:${Math.round(
    Math.max(0, Math.min(1, share)) * 100,
  )}%"></i></div>`;

const clampShare = (value: number): number => Math.max(0, Math.min(1, value));

/** Линия, а не ряд столбиков: так последние походы читаются как движение. */
const lootChart = (values: readonly number[]): string => {
  if (values.length === 0) {
    return '<div class="sp-chart-empty"><i></i><span>Первый поход<br>начнёт график</span></div>';
  }
  const width = 280;
  const height = 78;
  const left = 8;
  const top = 9;
  const bottom = 66;
  const high = Math.max(1, ...values);
  const x = (index: number): number => values.length === 1
    ? width / 2
    : left + (index / (values.length - 1)) * (width - left * 2);
  const y = (value: number): number => bottom - (value / high) * (bottom - top);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const firstX = x(0).toFixed(1);
  const lastX = x(values.length - 1).toFixed(1);
  const area = `${firstX},${bottom} ${points} ${lastX},${bottom}`;

  return `<svg class="sp-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Добыча в последних ${values.length} вылазках">
    <line x1="${left}" y1="${bottom}" x2="${width - left}" y2="${bottom}"></line>
    <line x1="${left}" y1="${Math.round((top + bottom) / 2)}" x2="${width - left}" y2="${Math.round((top + bottom) / 2)}"></line>
    <polygon points="${area}"></polygon>
    <polyline points="${points}"></polyline>
    ${values.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3"><title>Поход ${index + 1}: ${value}</title></circle>`).join('')}
  </svg>`;
};

const depthChart = (share: number, hasRaids: boolean): string => {
  const value = clampShare(share);
  const percent = Math.round(value * 100);
  return `<div class="sp-depth-chart">
    <div class="sp-ring" role="img" aria-label="Пройдено в среднем ${percent} процентов маршрута">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="sp-ring-track" cx="50" cy="50" r="40" pathLength="100"></circle>
        <circle class="sp-ring-value" cx="50" cy="50" r="40" pathLength="100" stroke-dasharray="${percent} 100"></circle>
      </svg>
      <b>${hasRaids ? `${percent}%` : '—'}</b><small>маршрута</small>
    </div>
    <div class="sp-route">
      <div class="sp-route-line" aria-hidden="true"><i style="width:${percent}%"></i>${[0, 25, 50, 75, 100]
        .map((mark) => `<s class="chip${percent >= mark && hasRaids ? ' on' : ''}" style="left:${mark}%"></s>`)
        .join('')}</div>
      <div class="row sp-route-labels"><span>Выход</span><span>Середина</span><span>Дно</span></div>
      <p>${hasRaids ? (percent >= 50 ? 'Уверенно держите глубину' : 'Разведан первый отрезок пути') : 'Завершите вылазку, чтобы увидеть маршрут'}</p>
    </div>
  </div>`;
};

const campChart = (camp: CampState): string => {
  const levels = BUILDING_ORDER.reduce((sum, id) => sum + camp.levels[id], 0);
  const possible = BUILDING_ORDER.reduce((sum, id) => sum + buildingMaxLevel(id), 0);
  return `<div class="sp-build-chart" role="img" aria-label="Уровни зданий лагеря">
    ${BUILDING_ORDER.map((id) => {
      const level = camp.levels[id];
      const max = buildingMaxLevel(id);
      return `<span title="${html(BUILDINGS[id].name)}: уровень ${level} из ${max}">
        <i><b style="height:${Math.round((level / max) * 100)}%"></b></i>
        <small>${html(BUILDINGS[id].name.slice(0, 1))}</small>
      </span>`;
    }).join('')}
    <em>${levels}<small> / ${possible} уровней</small></em>
  </div>`;
};

const offerChart = (share: number, returns: number): string => {
  const percent = Math.round(clampShare(share) * 100);
  const marker = returns === 0 ? 0 : Math.max(1, Math.min(99, percent));
  return `<div class="sp-bullet-chart" role="img" aria-label="Покупка доступна в ${percent} процентах возвращений, целевой диапазон от 60 до 80 процентов">
    <div class="sp-bullet-track">
      <span class="sp-bullet-goal"></span>
      ${returns === 0 ? '' : `<i style="left:${marker}%"><b>${percent}%</b></i>`}
    </div>
    <div class="row sp-bullet-labels"><span>0</span><strong>цель 60–80%</strong><span>100%</span></div>
  </div>`;
};

const highestVisitedTier = (camp: CampState): Tier => {
  let best: Tier = 0;
  for (const tier of [1, 2, 3] as const) if (camp.tierRaids[tier] > 0) best = tier;
  return best;
};

const openTiers = (camp: CampState): number =>
  ([0, 1, 2, 3] as Tier[]).filter((tier) => tierBlock(camp, tier) === 'ok').length;

const nextBuilding = (camp: CampState): string => {
  if (camp.construction !== null) {
    return `${BUILDINGS[camp.construction.building].name} → ур. ${camp.construction.toLevel}`;
  }
  const next = BUILDING_ORDER
    .filter((id) => isUnlocked(camp, id) && camp.levels[id] < MAX_LEVEL)
    .sort((a, b) => camp.levels[a] - camp.levels[b])[0];
  return next === undefined ? 'Все здания завершены' : `${BUILDINGS[next].name} → ур. ${camp.levels[next] + 1}`;
};

type StatsTab = 'summary' | 'loops' | 'chronicle';

export class StatsPanel {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  /** Таблица лагерей (§30) живёт во вкладке «Петли»: это прогресс мира. */
  private readonly table: HTMLElement;
  private readonly tabs: HTMLElement;
  private last: { camp: CampState; now: number } | null = null;
  private live: readonly LiveCamp[] = [];
  private selected: StatsTab = 'summary';

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'stats-panel';
    this.overlay.innerHTML = `
      <div class="panel">
        <div class="row mid sp-title">
          <div><h2>Летопись</h2><p>Ваш путь через вылазки, лагерь и мир</p></div>
          <button type="button" id="sp-close" class="ghost" aria-label="Закрыть летопись">×</button>
        </div>
        <div class="sp-tabs" role="tablist" aria-label="Разделы летописи">
          <button type="button" role="tab" data-tab="summary" aria-selected="true">Сводка</button>
          <button type="button" role="tab" data-tab="loops" aria-selected="false">Петли</button>
          <button type="button" role="tab" data-tab="chronicle" aria-selected="false">Хроника</button>
        </div>
        <div id="sp-body"></div>
        <div id="sp-table"></div>
        <div class="acts sp-tools">
          <button type="button" id="sp-copy" class="ghost">Скопировать данные</button>
          <button type="button" id="sp-clear" class="ghost">Очистить историю</button>
        </div>
      </div>`;
    parent.appendChild(this.overlay);
    this.body = this.overlay.querySelector('#sp-body') as HTMLElement;
    this.table = this.overlay.querySelector('#sp-table') as HTMLElement;
    this.tabs = this.overlay.querySelector('.sp-tabs') as HTMLElement;

    this.overlay.querySelector('#sp-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });
    this.tabs.addEventListener('click', (event) => {
      if (!(event.target instanceof HTMLButtonElement)) return;
      const tab = event.target.dataset.tab as StatsTab | undefined;
      if (tab === undefined) return;
      this.selected = tab;
      this.render();
    });
    this.overlay.querySelector('#sp-clear')?.addEventListener('click', () => {
      clearTelemetry();
      this.render();
    });
    this.overlay.querySelector('#sp-copy')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(events(), null, 2));
    });
  }

  /** Отдать панели чужие лагеря. Зовётся снаружи — панели про сеть не знают. */
  setCamps(live: readonly LiveCamp[]): void {
    this.live = live;
    if (this.overlay.classList.contains('on') && this.selected === 'loops') this.renderTable();
  }

  open(camp: CampState, now: number): void {
    this.last = { camp, now };
    this.selected = 'summary';
    this.render();
    this.overlay.classList.add('on');
  }

  /** Сцена сменилась — летопись не переезжает вместе с ней. */
  close(): void {
    this.overlay.classList.remove('on');
  }

  private render(): void {
    const last = this.last;
    if (last === null) return;
    for (const button of this.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.tab === this.selected));
    }

    this.body.innerHTML = this.selected === 'summary'
      ? this.renderSummary(last.camp)
      : this.selected === 'loops'
        ? this.renderLoops(last.camp)
        : this.renderChronicle(last.now);
    this.renderTable();
  }

  private renderSummary(camp: CampState): string {
    const list = events();
    const s = summarize(list);
    const trend = raidTrend(list);
    const trendText = s.raids === 0
      ? 'История появится после первого похода'
      : trend.change === null
      ? 'Нужно 6+ походов для сравнения'
      : `${trend.change >= 0 ? '↗' : '↘'} ${trend.change >= 0 ? '+' : ''}${pct(trend.change)} за последние 5`;
    const built = BUILDING_ORDER.filter((id) => camp.levels[id] > 0).length;
    const returns = list.filter((event) => event.t === 'return_screen').length;
    const buyGoal = returns === 0
      ? 'Нет завершённых возвращений'
      : s.buyOfferRate >= 0.6 && s.buyOfferRate <= 0.8
        ? 'Цель 60–80% достигнута'
        : 'Ориентир — 60–80%';

    return `
      <div class="row sp-caption"><strong>Ваш прогресс</strong><span>${s.raids} вылазок</span></div>
      <div class="sp-grid">
        <article class="card sp-card">
          <header class="row sp-card-head"><span class="lbl">Добыча за вылазку</span><b>${s.raids === 0 ? '—' : s.avgCarried.toFixed(1)}<small> в среднем</small></b></header>
          ${lootChart(trend.values)}
          <footer class="row"><span class="sp-trend">${trendText}</span><small>${trend.values.length === 0 ? 'нет данных' : `последние ${trend.values.length}`}</small></footer>
        </article>
        <article class="card sp-card">
          <header class="row sp-card-head"><span class="lbl">Средняя глубина</span><small>${s.raids} походов</small></header>
          ${depthChart(s.avgDepthShare, s.raids > 0)}
        </article>
        <article class="card sp-card">
          <header class="row sp-card-head"><span class="lbl">Развитие лагеря</span><b>${built}<small> / ${BUILDING_ORDER.length} зданий</small></b></header>
          ${campChart(camp)}
          <footer class="row"><span class="sp-trend">Следом: ${html(nextBuilding(camp))}</span></footer>
        </article>
        <article class="card sp-card">
          <header class="row sp-card-head"><span class="lbl">Покупка после похода</span><b>${returns === 0 ? '—' : pct(s.buyOfferRate)}<small> доступно</small></b></header>
          ${offerChart(s.buyOfferRate, returns)}
          <footer class="row"><span class="sp-trend">${buyGoal}</span><small>${returns} возвращений</small></footer>
        </article>
      </div>`;
  }

  private renderLoops(camp: CampState): string {
    const s = summarize(events());
    const built = BUILDING_ORDER.filter((id) => camp.levels[id] > 0);
    const tiers = openTiers(camp);
    const visited = highestVisitedTier(camp);
    const nextTier = ([0, 1, 2, 3] as Tier[]).find((tier) => tierBlock(camp, tier) !== 'ok');
    const worldNote = nextTier === undefined
      ? 'Все ярусы открыты'
      : `Ярус ${nextTier} требует Кухню ур. ${TIER_KITCHEN_GATE[nextTier]}`;

    return `
      <div class="row sp-caption"><strong>Три игровые петли</strong><span>текущая глава</span></div>
      <div class="sp-loops">
        <article class="card sp-loop">
          <i class="sp-loop-mark">I</i>
          <div><b>Вылазка</b><p>Ярус ${visited} · средняя глубина ${pct(s.avgDepthShare)} · потеряно ${s.avgLost.toFixed(1)} за поход</p>${bar(s.avgDepthShare)}</div>
          <strong>${s.raids}<small>походов</small></strong>
        </article>
        <article class="card sp-loop">
          <i class="sp-loop-mark">II</i>
          <div><b>Лагерь</b><p>${built.length === 0 ? 'Первые здания ещё впереди' : built.map((id) => BUILDINGS[id].name).join(', ')}</p>${bar(built.length / BUILDING_ORDER.length)}</div>
          <strong>${built.length} / ${BUILDING_ORDER.length}<small>зданий</small></strong>
        </article>
        <article class="card sp-loop">
          <i class="sp-loop-mark">III</i>
          <div><b>Мир</b><p>${worldNote}</p>${bar(tiers / 4)}</div>
          <strong>${tiers} / 4<small>ярусов</small></strong>
        </article>
      </div>`;
  }

  private renderChronicle(now: number): string {
    const items = chronicle(events());
    if (items.length === 0) {
      return '<div class="card sp-empty"><b>Летопись только начинается</b><p>Первый поход или улучшение оставит здесь свой след.</p></div>';
    }
    return `
      <div class="row sp-caption"><strong>Личные рубежи</strong><span>${items.length} записей</span></div>
      <div class="sp-timeline">${items
        .map(
          (item) => `<article class="sp-event"><i></i><div><b>${html(item.title)}</b><p>${html(item.note)}</p></div><time>${relativeTime(item.at, now)}</time></article>`,
        )
        .join('')}</div>`;
  }

  /** Таблица лагерей (§4 — «таблица развития лагерей»). */
  private renderTable(): void {
    const last = this.last;
    if (this.selected !== 'loops' || last === null || !neighboursOpen(last.camp)) {
      this.table.innerHTML = '';
      return;
    }
    const rows = standings(last.camp, last.now, last.camp.clan?.name ?? null, this.live);
    const popular = campsByLikes(this.live);
    this.table.innerHTML =
      '<h3 class="sp-head">Лагеря по силе</h3>' +
      rows
        .map(
          (row, index) =>
            `<div class="row sp-row${row.kind === 'вы' ? ' you' : ''}">` +
            `<span class="lbl"><i class="sp-place">${index + 1}</i>` +
            `<s class="sp-flag" style="background:${row.color}"></s>${html(row.who)}</span>` +
            `<b>${row.power}</b></div>` +
            `<div class="sp-note">${row.kind === 'фракция' ? 'фракция · ' : ''}ур. ${row.level}` +
            (row.folk === null ? '' : ` · народу ${row.folk}`) +
            '</div>',
        )
        .join('') +
      `<h3 class="sp-head">${gameMarkup(gameMessage('Лагеря по лайкам', 'Camps by likes'))}</h3>` +
      (popular.length === 0
        ? `<div class="card sp-empty"><p>${gameMarkup(gameMessage(
          'Пока никто не показал свой лагерь.',
          'No one has shared a camp yet.',
        ))}</p></div>`
        : popular
          .map(
            (row, index) =>
              `<div class="row sp-row${row.liked === true ? ' you' : ''}">` +
              `<span class="lbl"><i class="sp-place">${index + 1}</i>` +
              `<s class="sp-flag" style="background:${row.liked === true ? '#d46a3a' : '#9fb6d8'}"></s>` +
              `${row.clan === null
                ? gameMarkup(gameMessage('Лагерь без имени', 'Unnamed camp'))
                : html(row.clan)}</span>` +
              `<b>♥ ${row.likes ?? 0}</b></div>` +
              `<div class="sp-note">${gameMarkup(gameMessage(
                'сила {power} · ур. {level} · народу {folk}',
                'power {power} · lvl {level} · people {folk}',
              ), { power: row.power, level: row.level, folk: row.folk })}</div>`,
          )
          .join(''));
  }
}
