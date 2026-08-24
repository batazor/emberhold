import {
  BUILDING_ORDER,
  BUILDINGS,
  MAX_LEVEL,
  TIER_KITCHEN_GATE,
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
    const max = Math.max(1, ...trend.values);
    const trendText = trend.change === null
      ? 'Нужно ещё несколько вылазок для сравнения'
      : `${trend.change >= 0 ? '↗' : '↘'} ${trend.change >= 0 ? '+' : ''}${pct(trend.change)} за последние 5`;
    const built = BUILDING_ORDER.filter((id) => camp.levels[id] > 0).length;
    const buyGoal = s.raids === 0
      ? 'Появится после первого возвращения'
      : s.buyOfferRate >= 0.6 && s.buyOfferRate <= 0.8
        ? 'Цель 60–80% достигнута'
        : 'Ориентир — 60–80%';
    const spark = trend.values.length === 0
      ? '<p class="sp-note">Ещё ни одной завершённой вылазки</p>'
      : `<div class="sp-spark" aria-label="Добыча последних вылазок">${trend.values
          .map((value) => `<i style="height:${Math.max(12, Math.round((value / max) * 100))}%"></i>`)
          .join('')}</div>`;

    return `
      <div class="row sp-caption"><strong>Ваш прогресс</strong><span>${s.raids} вылазок</span></div>
      <div class="sp-grid">
        <article class="card sp-card">
          <span class="lbl">Вынесено за вылазку</span>
          <b class="sp-value">${s.avgCarried.toFixed(1)} <small>ресурса</small></b>
          <span class="sp-trend">${trendText}</span>${spark}
        </article>
        <article class="card sp-card">
          <span class="lbl">Средняя глубина</span>
          <b class="sp-value">${pct(s.avgDepthShare)}</b>
          ${bar(s.avgDepthShare, s.avgDepthShare >= 0.5 ? 'good' : 'warn')}
          <span class="row sp-scale"><small>Выход</small><small>Дно</small></span>
        </article>
        <article class="card sp-card">
          <span class="lbl">Развитие лагеря</span>
          <b class="sp-value">${built} <small>из ${BUILDING_ORDER.length} зданий</small></b>
          ${bar(built / BUILDING_ORDER.length)}
          <span class="sp-trend">Следом: ${html(nextBuilding(camp))}</span>
        </article>
        <article class="card sp-card">
          <span class="lbl">Возвраты с покупкой</span>
          <b class="sp-value">${pct(s.buyOfferRate)}</b>
          ${bar(s.buyOfferRate, s.buyOfferRate >= 0.6 && s.buyOfferRate <= 0.8 ? 'good' : 'warn')}
          <span class="sp-trend">${buyGoal}</span>
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
