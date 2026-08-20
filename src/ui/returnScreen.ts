import { BUILDINGS, BUILD_COST, suggestUpgrade, upgradeProgress } from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { TIER_NAME } from '../sim/config';
import { CONSUMABLES, cheapestAffordable } from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind } from '../sim/resources';
import type { RaidResult } from '../sim/raid';
import type { Tier } from '../sim/types';

/**
 * Экран возврата (мокап 04). Самый важный экран для удержания: здесь игрок
 * решает, продолжать сессию, уйти с чувством прогресса — или закрыть игру.
 *
 * Три правила оттуда, каждое отражено в коде ниже:
 *   1. Добыча начисляется анимацией ~1,5 с, с пропуском по тапу.
 *      Мгновенно показанный итог не читается как награда.
 *   2. Полосы важнее добычи: прогресс к улучшению занимает больше места.
 *   3. Главная кнопка — трата, а не повтор (§20.1).
 */
const ACCRUAL_SECONDS = 1.5;
const ORDER: readonly ResourceKind[] = ['salt', 'wood', 'iron', 'crystal'];

export interface ReturnCallbacks {
  onBuild(id: BuildingId): void;
  /** §21 — второй сток: когда слот стройки занят, тратить всё равно есть на что. */
  onBuyConsumable(id: ConsumableId): void;
  onRaid(tier: Tier): void;
  onCamp(): void;
}

export class ReturnScreen {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly lootBox: HTMLElement;
  private readonly lostLine: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly secondary: HTMLButtonElement;
  private readonly tertiary: HTMLButtonElement;

  private readonly counters = new Map<ResourceKind, { el: HTMLElement; target: number }>();
  /** Момент показа. Анимация считается от него, а не накоплением dt: если
   *  вкладка была свёрнута, цикл стоял, и накопление растянуло бы «полторы
   *  секунды» на всё время сна — игрок вернулся бы к нулям на экране. */
  private shownAt = 0;
  private skipped = false;
  private suggestion: BuildingId | null = null;
  /** Что предложить, когда слот стройки занят или на здание не хватает. */
  private consumable: ConsumableId | null = null;
  private tier: Tier = 0;
  /** Отчёт о выборе игрока уходит в телеметрию один раз за экран. */
  private reported = false;
  private onChoice: ((chose: 'build' | 'raid' | 'camp', canBuy: boolean) => void) | null = null;

  constructor(parent: HTMLElement, private readonly cb: ReturnCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'return';
    this.root.innerHTML = `
      <div class="panel">
        <h2 id="r-title"></h2>
        <p class="dim" id="r-sub"></p>
        <div class="loot" id="r-loot"></div>
        <p class="bad" id="r-lost"></p>
        <div class="progress">
          <div class="lbl" id="r-plabel"></div>
          <div class="bar"><i id="r-pbar"></i></div>
        </div>
        <div class="acts">
          <button id="r-primary" class="primary"></button>
          <button id="r-secondary"></button>
          <button id="r-tertiary" class="ghost">В лагерь</button>
        </div>
      </div>`;
    parent.appendChild(this.root);

    const q = (id: string): HTMLElement => this.root.querySelector(`#${id}`) as HTMLElement;
    this.title = q('r-title');
    this.subtitle = q('r-sub');
    this.lootBox = q('r-loot');
    this.lostLine = q('r-lost');
    this.progressLabel = q('r-plabel');
    this.progressBar = q('r-pbar');
    this.primary = q('r-primary') as HTMLButtonElement;
    this.secondary = q('r-secondary') as HTMLButtonElement;
    this.tertiary = q('r-tertiary') as HTMLButtonElement;

    // Тап по экрану досчитывает анимацию: ждать полторы секунды на десятой
    // вылазке — раздражение, а не награда.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      this.skipped = true;
      this.paint(1);
    });

    this.primary.addEventListener('click', () => {
      if (this.suggestion !== null) {
        this.report('build');
        this.cb.onBuild(this.suggestion);
      } else if (this.consumable !== null) {
        this.report('build');
        this.cb.onBuyConsumable(this.consumable);
      } else {
        this.report('raid');
        this.cb.onRaid(this.tier);
      }
    });
    this.secondary.addEventListener('click', () => {
      this.report('raid');
      this.cb.onRaid(this.tier);
    });
    this.tertiary.addEventListener('click', () => {
      this.report('camp');
      this.cb.onCamp();
    });

    this.hide();
  }

  private report(chose: 'build' | 'raid' | 'camp'): void {
    if (this.reported) return;
    this.reported = true;
    this.onChoice?.(chose, this.suggestion !== null);
  }

  show(
    result: RaidResult,
    camp: CampState,
    onChoice: (chose: 'build' | 'raid' | 'camp', canBuy: boolean) => void,
  ): void {
    this.onChoice = onChoice;
    this.reported = false;
    this.shownAt = performance.now();
    this.skipped = false;
    this.tier = result.tier;
    this.suggestion = suggestUpgrade(camp);
    // Постройка важнее: она меняет вылазку навсегда, расходник — на одну.
    this.consumable = this.suggestion === null
      ? cheapestAffordable(camp.resources, camp.loadout)
      : null;

    const ok = result.status === 'evacuated';
    this.title.textContent = ok ? 'Вылазка завершена' : 'Провал';
    this.title.className = ok ? 'ok' : 'bad';

    const depth =
      result.locMaxBack > 0 ? Math.round((result.maxBack / result.locMaxBack) * 100) : 0;
    const minutes = Math.floor(result.durationSec / 60);
    const seconds = Math.round(result.durationSec % 60);
    this.subtitle.textContent =
      `${TIER_NAME[result.tier]} · глубина ${result.maxBack} из ${result.locMaxBack} шагов ` +
      `(${depth}%) · ${minutes > 0 ? `${minutes} мин ` : ''}${seconds} с`;

    this.lootBox.innerHTML = '';
    this.counters.clear();
    for (const kind of ORDER) {
      const amount = result.carried[kind];
      if (amount <= 0) continue;
      const row = document.createElement('div');
      row.className = 'loot-row';
      const name = document.createElement('span');
      name.className = 'lbl';
      name.textContent = RESOURCE_NAME[kind];
      const value = document.createElement('b');
      value.textContent = '0';
      row.append(name, value);
      this.lootBox.appendChild(row);
      this.counters.set(kind, { el: value, target: amount });
    }
    if (this.counters.size === 0) {
      this.lootBox.innerHTML = '<div class="loot-row dim">Пусто</div>';
    }

    this.lostLine.textContent =
      result.lost > 0 ? `Потеряно ${result.lost} из ${result.bagTotal}` : '';

    // §20.1 — главная кнопка это трата. Если тратить нечего, честно
    // предлагаем повтор, а не серую кнопку.
    if (this.suggestion !== null) {
      const id = this.suggestion;
      this.primary.textContent = `Построить: ${BUILDINGS[id].name} ур. ${camp.levels[id] + 1}`;
      this.secondary.textContent = 'Ещё вылазка';
      this.secondary.style.display = '';
    } else if (this.consumable !== null) {
      this.primary.textContent = `Взять: ${CONSUMABLES[this.consumable].name}`;
      this.secondary.textContent = 'Ещё вылазка';
      this.secondary.style.display = '';
    } else {
      this.primary.textContent = 'Ещё вылазка';
      this.secondary.style.display = 'none';
    }

    this.syncProgress(camp);
    this.root.classList.add('on');
  }

  /** Полоса прогресса к следующему улучшению — то, ради чего играли. */
  private syncProgress(camp: CampState): void {
    const id = this.suggestion ?? this.cheapestLocked(camp);
    if (id === null) {
      this.progressLabel.textContent = 'Всё построено';
      this.progressBar.style.width = '100%';
      return;
    }
    const next = camp.levels[id] + 1;
    const progress = upgradeProgress(camp, id);
    if (progress >= 1) {
      this.progressLabel.textContent = `${BUILDINGS[id].name} ур. ${next} — ресурсы собраны`;
      this.progressBar.style.width = '100%';
      return;
    }
    const cost = BUILD_COST[next] ?? {};
    const need = (Object.entries(cost) as [ResourceKind, number][])
      .filter(([kind, amount]) => camp.resources[kind] < amount)
      .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${camp.resources[kind]}/${amount}`)
      .join(' · ');
    this.progressLabel.textContent = `${BUILDINGS[id].name} ур. ${next} — ${need}`;
    this.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
  }

  private cheapestLocked(camp: CampState): BuildingId | null {
    let best: BuildingId | null = null;
    let bestProgress = -1;
    for (const id of ['hq', 'kitchen', 'storage'] as BuildingId[]) {
      if (camp.levels[id] >= 6) continue;
      const p = upgradeProgress(camp, id);
      if (p > bestProgress) {
        bestProgress = p;
        best = id;
      }
    }
    return best;
  }

  /** Анимация начисления: числа набегают. Вызывается из цикла отрисовки. */
  update(): void {
    if (this.skipped || !this.root.classList.contains('on')) return;
    const t = Math.min(1, (performance.now() - this.shownAt) / (ACCRUAL_SECONDS * 1000));
    this.paint(t);
    if (t >= 1) this.skipped = true;
  }

  private paint(t: number): void {
    // Замедление к концу: последние единицы должны быть видны поштучно.
    const eased = 1 - (1 - t) * (1 - t);
    for (const { el, target } of this.counters.values()) {
      el.textContent = String(Math.round(target * eased));
    }
  }

  hide(): void {
    this.root.classList.remove('on');
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }
}
