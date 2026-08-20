import { formatDuration } from '../core/clock';
import {
  BUILDINGS,
  BUILDING_ORDER,
  BUILD_COST,
  BUILD_SECONDS,
  MAX_LEVEL,
  speedupCost,
  TIER_KITCHEN_GATE,
  tierBlock,
  upgradeBlock,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { RESOURCE_NAME } from '../sim/resources';
import type { ResourceKind, Resources } from '../sim/resources';
import type { Tier } from '../sim/types';

export interface CampCallbacks {
  onUpgrade(id: BuildingId): void;
  onSpeedup(): void;
  onRaid(tier: Tier): void;
}

const BLOCK_TEXT: Record<string, string> = {
  max: 'Максимальный уровень',
  'hq-cap': 'Штаб не пускает выше',
  'slot-busy': 'Слот занят другой стройкой',
  resources: 'Не хватает ресурсов',
};

const RESOURCE_ORDER: readonly ResourceKind[] = ['salt', 'wood', 'iron', 'crystal'];

const TIERS: readonly Tier[] = [0, 1, 2, 3];

interface Row {
  readonly level: HTMLElement;
  readonly effect: HTMLElement;
  readonly status: HTMLElement;
  readonly barWrap: HTMLElement;
  readonly bar: HTMLElement;
  readonly button: HTMLButtonElement;
}

/**
 * Панель лагеря строится один раз и дальше обновляется на месте.
 *
 * Пересборка innerHTML каждый тик выглядит безобидно, но ломает ввод:
 * кнопка, заменённая между нажатием и отпусканием, не даёт события click,
 * и панель просто перестаёт нажиматься. Это стоило одного бага в этапе 3.
 */
export class CampHud {
  private readonly root: HTMLElement;
  /**
   * Место для панелей, которые живут в лагере, но не принадлежат зданиям, —
   * сейчас там отряд (§11.8). Слот, а не прямой доступ к корню: порядок
   * элементов в лагере — решение этой панели, а не того, кто в неё встраивается.
   */
  readonly slot: HTMLElement;
  private readonly resValues = new Map<ResourceKind, HTMLElement>();
  private readonly rows = new Map<BuildingId, Row>();
  private readonly tierButtons = new Map<Tier, HTMLButtonElement>();
  private readonly banner: HTMLElement;
  private bannerTimer = 0;

  constructor(parent: HTMLElement, private readonly cb: CampCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'camp';

    const res = document.createElement('div');
    res.className = 'panel res';
    for (const kind of RESOURCE_ORDER) {
      const item = document.createElement('span');
      item.className = 'res-item';
      const label = document.createElement('span');
      label.className = 'lbl';
      label.textContent = RESOURCE_NAME[kind];
      const value = document.createElement('b');
      value.textContent = '0';
      item.append(label, value);
      res.appendChild(item);
      this.resValues.set(kind, value);
    }

    this.banner = document.createElement('div');
    this.banner.className = 'hint';

    const list = document.createElement('div');
    list.className = 'panel list';
    for (const id of BUILDING_ORDER) {
      list.appendChild(this.makeRow(id));
    }

    const raid = document.createElement('div');
    raid.className = 'panel raid';
    const raidLabel = document.createElement('span');
    raidLabel.className = 'lbl';
    raidLabel.textContent = 'Вылазка';
    raid.appendChild(raidLabel);
    for (const tier of [0, 1, 2, 3] as Tier[]) {
      const b = document.createElement('button');
      b.textContent = `Ярус ${tier}`;
      b.addEventListener('click', () => this.cb.onRaid(tier));
      this.tierButtons.set(tier, b);
      raid.appendChild(b);
    }

    this.slot = document.createElement('div');
    this.slot.className = 'camp-slot';

    this.root.append(res, this.banner, list, this.slot, raid);
    parent.appendChild(this.root);
  }

  private makeRow(id: BuildingId): HTMLElement {
    const def = BUILDINGS[id];
    const box = document.createElement('div');
    box.className = 'b';

    const top = document.createElement('div');
    top.className = 'b-top';
    const name = document.createElement('b');
    name.textContent = def.name;
    const level = document.createElement('span');
    level.className = 'dim';
    top.append(name, level);

    const effect = document.createElement('div');
    effect.className = 'b-eff';

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const bar = document.createElement('i');
    bar.className = 'warn';
    barWrap.appendChild(bar);
    barWrap.style.display = 'none';

    const bottom = document.createElement('div');
    bottom.className = 'b-bot';
    const status = document.createElement('span');
    status.className = 'dim';
    const button = document.createElement('button');
    bottom.append(status, button);

    // Слушатель вешается один раз на живой элемент — он и не переживает
    // перерисовку, потому что перерисовки больше нет.
    button.addEventListener('click', () => {
      if (button.dataset['mode'] === 'speedup') this.cb.onSpeedup();
      else this.cb.onUpgrade(id);
    });

    box.append(top, effect, barWrap, bottom);
    this.rows.set(id, { level, effect, status, barWrap, bar, button });
    return box;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  notify(text: string): void {
    this.banner.textContent = text;
    this.bannerTimer = 4;
  }

  private costLine(level: number): string {
    const cost = BUILD_COST[level];
    if (cost === undefined) return '';
    return (Object.entries(cost) as [ResourceKind, number][])
      .map(([kind, amount]) => `${RESOURCE_NAME[kind]} ${amount}`)
      .join(' · ');
  }

  sync(camp: CampState, now: number, dt: number): void {
    for (const kind of RESOURCE_ORDER) {
      const el = this.resValues.get(kind);
      if (el !== undefined) el.textContent = String(camp.resources[kind]);
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.textContent = '';
    }

    // Закрытый ярус говорит, чем он закрыт: молчащая серая кнопка читается
    // как поломка, а не как условие.
    for (const tier of TIERS) {
      const b = this.tierButtons.get(tier);
      if (b === undefined) continue;
      const blocked = tierBlock(camp, tier) !== 'ok';
      b.disabled = blocked;
      b.textContent = blocked ? `Ярус ${tier} · Кухня ${TIER_KITCHEN_GATE[tier]}` : `Ярус ${tier}`;
    }

    const c = camp.construction;
    for (const id of BUILDING_ORDER) {
      const row = this.rows.get(id);
      if (row === undefined) continue;
      const level = camp.levels[id];

      if (c !== null && c.building === id) {
        const left = Math.max(0, c.endsAt - now);
        const total = Math.max(1, c.endsAt - c.startedAt);
        const price = speedupCost(left, total);
        row.level.textContent = `ур. ${level} → ${c.toLevel}`;
        row.effect.textContent = BUILDINGS[id].effect(c.toLevel);
        row.barWrap.style.display = '';
        row.bar.style.width = `${((1 - left / total) * 100).toFixed(1)}%`;
        row.status.textContent = formatDuration(left);
        row.button.dataset['mode'] = 'speedup';
        // §20.5 — последние пять минут бесплатны.
        row.button.textContent = price === 0 ? 'Достроить' : `Ускорить · соль ${price}`;
        row.button.disabled = price > camp.resources.salt;
        continue;
      }

      const block = upgradeBlock(camp, id);
      row.level.textContent = `ур. ${level}`;
      row.effect.textContent = BUILDINGS[id].effect(level);
      row.barWrap.style.display = 'none';
      row.button.dataset['mode'] = 'upgrade';
      row.button.textContent = 'Улучшить';
      row.button.disabled = block !== 'ok';
      row.status.textContent =
        block === 'ok' || block === 'resources'
          ? `${this.costLine(level + 1)} · ${
              level < MAX_LEVEL ? formatDuration(BUILD_SECONDS[level + 1] ?? 0) : ''
            }`
          : (BLOCK_TEXT[block] ?? '');
    }
  }

  /** Итог вылазки: что зачислено на склад. */
  static resourceSummary(res: Resources): string {
    const parts = RESOURCE_ORDER.filter((k) => res[k] > 0).map(
      (k) => `${RESOURCE_NAME[k]} ${res[k]}`,
    );
    return parts.length > 0 ? parts.join(' · ') : 'пусто';
  }
}
