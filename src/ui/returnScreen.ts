import {
  BUILDINGS,
  BUILD_COST,
  gearAction,
  suggestGear,
  suggestUpgrade,
  upgradeProgress,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { GEAR, gearLine } from '../sim/gear';
import type { GearSlot } from '../sim/gear';
import { TIER_NAME } from '../sim/config';
import { CONSUMABLES, cheapestAffordable } from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind } from '../sim/resources';
import type { RaidResult } from '../sim/raid';
import { dayAt, regionAt, worldAt } from '../sim/world';

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
  /**
   * §20.1 — вторая половина ответа на «слот занят». Постройка уходит в таймер,
   * снаряжение доступно всегда, и главная кнопка остаётся тратой.
   */
  onCraft(slot: GearSlot): void;
  /** §21 — третья ветка того же места: расходник тратит соль, которой в избытке. */
  onBuyConsumable(id: ConsumableId): void;
  /** §4 — «ещё вылазка» ведёт в место на карте, и оно названо на кнопке. */
  onRaid(node: number): void;
  onCamp(): void;
}

/**
 * Место для следующей вылазки: то же самое, пока в нём осталось хотя бы два
 * захода, иначе самое богатое из открытых. Автовыбора «лучшей локации» на
 * карте нет и не будет (`world.html`, кадр 05) — но кнопка «ещё вылазка»
 * решения не отменяет: она его предлагает, а карта рядом открыта.
 */
function nextPlace(camp: CampState, node: number, now: number): number {
  const world = worldAt(now, camp.visits);
  if ((world[node]?.rich ?? 0) >= 2) return node;
  const nodes = regionAt(dayAt(now)).nodes;
  if (nodes.length === 0) return node;
  return [...nodes].sort((a, b) => (world[b.id]?.rich ?? 0) - (world[a.id]?.rich ?? 0))[0]!.id;
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
  /** Что предложить, когда постройка недоступна: слот занят или не по карману. */
  private gearSuggestion: GearSlot | null = null;
  private consumable: ConsumableId | null = null;
  /**
   * Куда ведёт «ещё вылазка». Локация помнит заход (§4): если она уже
   * просела, экран предлагает не её, а лучшее из доступного — иначе кнопка
   * молча ведёт в выработанную жилу.
   */
  private raidNode = 0;
  /** Когда показан экран: регион меняется днями, и имя места берётся из дня. */
  private at = 0;
  /**
   * Кадр 8 раскадровки: в первый раз выбора нет. Кнопки «Ещё вылазка» здесь
   * не существует — иначе игрок не увидит лагерь, ради которого играл.
   */
  private onlyCamp = false;
  /** Отчёт о выборе игрока уходит в телеметрию один раз за экран. */
  private reported = false;
  private onChoice: ((chose: 'build' | 'craft' | 'raid' | 'camp', canBuy: boolean) => void) | null =
    null;

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
      if (this.onlyCamp) {
        this.report('camp');
        this.cb.onCamp();
        return;
      }
      if (this.suggestion !== null) {
        this.report('build');
        this.cb.onBuild(this.suggestion);
      } else if (this.consumable !== null) {
        this.report('build');
        this.cb.onBuyConsumable(this.consumable);
      } else if (this.gearSuggestion !== null) {
        this.report('craft');
        this.cb.onCraft(this.gearSuggestion);
      } else {
        this.report('raid');
        this.cb.onRaid(this.raidNode);
      }
    });
    this.secondary.addEventListener('click', () => {
      this.report('raid');
      this.cb.onRaid(this.raidNode);
    });
    this.tertiary.addEventListener('click', () => {
      this.report('camp');
      this.cb.onCamp();
    });

    this.hide();
  }

  private report(chose: 'build' | 'craft' | 'raid' | 'camp'): void {
    if (this.reported) return;
    this.reported = true;
    // «Покупка была доступна» теперь значит любую трату, а не только стройку:
    // §20.1 меряет долю возвратов, на которых игроку было что купить.
    // «Покупка доступна» из §20.1 — это любая трата: постройка, расходник
    // или ковка. Считать только стройку значило бы мерить дыру, а не её починку.
    this.onChoice?.(
      chose,
      this.suggestion !== null || this.consumable !== null || this.gearSuggestion !== null,
    );
  }

  show(
    result: RaidResult,
    camp: CampState,
    onChoice: (chose: 'build' | 'craft' | 'raid' | 'camp', canBuy: boolean) => void,
    onlyCamp = false,
    node = 0,
    now = 0,
  ): void {
    this.onChoice = onChoice;
    this.onlyCamp = onlyCamp;
    this.reported = false;
    this.shownAt = performance.now();
    this.skipped = false;
    this.at = now;
    this.raidNode = nextPlace(camp, node, now);
    this.suggestion = suggestUpgrade(camp);
    // Три ветки одной главной кнопки, и они не бывают главными одновременно.
    // Порядок — постройка, расходник, ковка. Постройка меняет вылазку
    // навсегда. Дальше расходник, а не снаряжение, по составу кошелька:
    // расходник берётся за соль, которой к концу дня в избытке (§13),
    // а снаряжение — за железо и кристалл, которых как раз не хватает.
    // Предлагать первым то, что игрок точно может себе позволить, —
    // и есть смысл второго стока.
    this.consumable = this.suggestion === null
      ? cheapestAffordable(camp.resources, camp.loadout)
      : null;
    this.gearSuggestion =
      this.suggestion === null && this.consumable === null ? suggestGear(camp) : null;

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
      this.secondary.textContent = this.raidLabel();
      this.secondary.style.display = '';
    } else if (this.consumable !== null) {
      this.primary.textContent = `Взять: ${CONSUMABLES[this.consumable].name}`;
      this.secondary.textContent = this.raidLabel();
      this.secondary.style.display = '';
    } else if (this.gearSuggestion !== null) {
      this.primary.textContent = gearAction(camp, this.gearSuggestion);
      this.secondary.textContent = this.raidLabel();
      this.secondary.style.display = '';
    } else {
      this.primary.textContent = this.raidLabel();
      this.secondary.style.display = 'none';
    }

    this.syncProgress(camp);

    // Первое возвращение ведёт в лагерь и никуда больше.
    if (onlyCamp) {
      this.primary.textContent = 'В лагерь';
      this.secondary.style.display = 'none';
      this.progressLabel.textContent = 'Лагерь открыт';
      this.progressBar.style.width = '100%';
    }
    this.tertiary.style.display = onlyCamp ? 'none' : '';

    this.root.classList.add('on');
  }

  /**
   * Куда зовёт кнопка. Название места вместо «ещё вылазка»: после первой же
   * вылазки места перестают быть одинаковыми, и кнопка обязана это признавать.
   */
  private raidLabel(): string {
    const node = regionAt(dayAt(this.at)).nodes[this.raidNode];
    return node === undefined ? 'Ещё вылазка' : `Ещё вылазка · ${node.name}`;
  }

  /** Полоса прогресса к следующему улучшению — то, ради чего играли. */
  private syncProgress(camp: CampState): void {
    // Когда трата — снаряжение, полоса обязана показывать его же: полоса
    // про недостижимую постройку рядом с кнопкой про кайло читается как ошибка.
    if (this.suggestion === null && this.gearSuggestion !== null) {
      const slot = this.gearSuggestion;
      const next = camp.gear[slot] + 1;
      this.progressLabel.textContent = `${GEAR[slot].name} ур. ${next} — ${gearLine(slot, next)}`;
      this.progressBar.style.width = '100%';
      return;
    }
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
    for (const id of ['hq', 'kitchen', 'storage', 'forge'] as BuildingId[]) {
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
