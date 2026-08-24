import {
  BUILDINGS,
  BUILDING_ORDER,
  BUILD_COST,
  suggestGear,
  suggestUpgrade,
  upgradeBlock,
  upgradeProgress,
} from '../sim/camp';
import type { BuildingId, CampState } from '../sim/camp';
import { gearLine } from '../sim/gear';
import type { GearSlot } from '../sim/gear';
import { cheapestAffordable } from '../sim/consumables';
import type { ConsumableId } from '../sim/consumables';
import { play } from '../core/audio';
import type { ResourceKind } from '../sim/resources';
import type { RaidResult } from '../sim/raid';
import { SUPPLY_HARD_PITY } from '../sim/lootbox';
import type { SupplyRewardId } from '../sim/lootbox';
import type { SupplyClaim } from '../sim/lootboxClaim';
import { KIND, dayAt, regionAt, worldAt } from '../sim/world';
import type { Visit } from '../sim/world';
import { resourceIcon } from './resourceIcons';
import { buildingMessage, consumableMessage, gearMessage, resourceMessage, tierMessage } from '../i18n/gameData';
import { gameDuration, gameMarkup, gameMessage, gameText, setGameText } from '../i18n/game';

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
const ORDER: readonly ResourceKind[] = ['stone', 'wood', 'iron', 'crystal', 'meat', 'pelt'];
const SUPPLY_REWARD_MESSAGE = {
  'stone-4': gameMessage('Камень ×4', 'Stone ×4'),
  'wood-2': gameMessage('Дерево ×2', 'Wood ×2'),
  'iron-1': gameMessage('Железо ×1', 'Iron ×1'),
  ration: gameMessage('Дорожный паёк', 'Travel ration'),
  bandage: gameMessage('Повязка', 'Bandage'),
  'arrows-4': gameMessage('Стрелы ×4', 'Arrows ×4'),
  smoke: gameMessage('Дымовая шашка', 'Smoke bomb'),
  'stone-6': gameMessage('Камень ×6', 'Stone ×6'),
  'wood-3': gameMessage('Дерево ×3', 'Wood ×3'),
  'bonus-iron-1': gameMessage('Железо ×1', 'Iron ×1'),
  'crystal-1': gameMessage('Кристалл ×1', 'Crystal ×1'),
  'iron-2': gameMessage('Железо ×2', 'Iron ×2'),
} satisfies Record<SupplyRewardId, ReturnType<typeof gameMessage>>;

export interface ReturnCallbacks {
  onBuild(id: BuildingId): void;
  /**
   * §20.1 — вторая половина ответа на «слот занят». Постройка уходит в таймер,
   * снаряжение доступно всегда, и главная кнопка остаётся тратой.
   */
  onCraft(slot: GearSlot): void;
  /** §21 — третья ветка того же места: расходник тратит камень, которого в избытке. */
  onBuyConsumable(id: ConsumableId): void;
  /** §4 — «ещё вылазка» ведёт в место на карте, и оно названо на кнопке. */
  onRaid(node: number): void;
  onCamp(): void;
}

/** Прогресс конкретного героя, начисленный вместе с этим возвращением. */
export interface ReturnProgress {
  readonly xp: number;
  readonly levels: number;
  readonly level: number;
}

/**
 * Место для следующей вылазки: то же самое, пока в нём осталось хотя бы два
 * захода, иначе самое богатое из открытых. Автовыбора «лучшей локации» на
 * карте нет и не будет (`world.html`, кадр 05) — но кнопка «ещё вылазка»
 * решения не отменяет: она его предлагает, а карта рядом открыта.
 */
function nextPlace(
  camp: CampState,
  node: number,
  now: number,
  others: readonly Visit[],
): number {
  const world = worldAt(now, camp.visits, others);
  if ((world[node]?.rich ?? 0) >= 2) return node;
  // Только вылазки: богатство считается и у прогулочных мест — их просто
  // никто не тратит, поэтому у них всегда полные три, и без фильтра кнопка
  // «Ещё вылазка» звала в замок, где добычи нет вовсе.
  const nodes = regionAt(dayAt(now)).nodes.filter((n) => KIND[n.kind].raidable);
  if (nodes.length === 0) return node;
  return [...nodes].sort((a, b) => (world[b.id]?.rich ?? 0) - (world[a.id]?.rich ?? 0))[0]!.id;
}

export class ReturnScreen {
  /**
   * Чужие метки (§30.6). Нужны экрану ради одной кнопки: «ещё вылазка»
   * предлагает место по остатку богатства, и предложить выработанное
   * соседями значило бы позвать туда, откуда игрок только что ушёл ни с чем.
   */
  private others: readonly Visit[] = [];
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly lootBox: HTMLElement;
  private readonly supplyBox: HTMLElement;
  private readonly supplyList: HTMLElement;
  private readonly supplyNote: HTMLElement;
  private readonly combatBox: HTMLElement;
  private readonly combatGrid: HTMLElement;
  private readonly levelLine: HTMLElement;
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
  /**
   * Сколько строк добычи уже прозвучало. Звук `pick` написан ровно под этот
   * экран — «ресурс зачислен, по одному на строку», — и не звучал нигде:
   * начисление, ради которого экран и устроен (§20.1), шло полторы секунды
   * молча. Самый приятный момент петли был единственным беззвучным.
   */
  private picked = 0;
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
        <section class="card r-supply" id="r-supply">
          <h3>${gameMarkup(gameMessage('Ларец снабжения', 'Supply chest'))}</h3>
          <div class="r-supply-list" id="r-supply-list"></div>
          <p class="dim" id="r-supply-note"></p>
        </section>
        <p class="bad" id="r-lost"></p>
        <section class="card r-combat" id="r-combat">
          <h3>${gameMarkup(gameMessage('Итог боя', 'Combat summary'))}</h3>
          <div class="r-combat-grid" id="r-combat-grid"></div>
          <p class="good" id="r-level"></p>
        </section>
        <div class="progress">
          <div class="lbl" id="r-plabel"></div>
          <div class="bar"><i id="r-pbar"></i></div>
        </div>
        <div class="acts">
          <button id="r-primary" class="primary"></button>
          <button id="r-secondary"></button>
          <button id="r-tertiary" class="ghost">${gameMarkup(gameMessage('В лагерь', 'To camp'))}</button>
        </div>
      </div>`;
    parent.appendChild(this.root);

    const q = (id: string): HTMLElement => this.root.querySelector(`#${id}`) as HTMLElement;
    this.title = q('r-title');
    this.subtitle = q('r-sub');
    this.lootBox = q('r-loot');
    this.supplyBox = q('r-supply');
    this.supplyList = q('r-supply-list');
    this.supplyNote = q('r-supply-note');
    this.combatBox = q('r-combat');
    this.combatGrid = q('r-combat-grid');
    this.levelLine = q('r-level');
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

  /** Отдать экрану чужие метки: читает их сеть, а панели про неё не знают. */
  setNeighbours(visits: readonly Visit[]): void {
    this.others = visits;
  }

  show(
    result: RaidResult,
    camp: CampState,
    onChoice: (chose: 'build' | 'craft' | 'raid' | 'camp', canBuy: boolean) => void,
    onlyCamp = false,
    node = 0,
    now = 0,
    progression: ReturnProgress | null = null,
    supply: SupplyClaim | null = null,
  ): void {
    this.onChoice = onChoice;
    this.onlyCamp = onlyCamp;
    this.reported = false;
    this.shownAt = performance.now();
    this.skipped = false;
    this.picked = 0;
    this.at = now;
    this.raidNode = nextPlace(camp, node, now, this.others);
    this.suggestion = suggestUpgrade(camp);
    // Три ветки одной главной кнопки, и они не бывают главными одновременно.
    // Порядок — постройка, расходник, ковка. Постройка меняет вылазку
    // навсегда. Дальше расходник, а не снаряжение, по составу кошелька:
    // расходник берётся за камень, которого к концу дня в избытке (§13),
    // а снаряжение — за железо и кристалл, которых как раз не хватает.
    // Предлагать первым то, что игрок точно может себе позволить, —
    // и есть смысл второго стока.
    this.consumable = this.suggestion === null
      ? cheapestAffordable(camp.resources, camp.loadout)
      : null;
    this.gearSuggestion =
      this.suggestion === null && this.consumable === null ? suggestGear(camp) : null;

    const ok = result.status === 'evacuated';
    setGameText(this.title, ok
      ? gameMessage('Вылазка завершена', 'Raid completed')
      : gameMessage('Вылазка провалена', 'Raid failed'));
    this.title.className = ok ? 'ok' : 'bad';

    const depth =
      result.locMaxBack > 0 ? Math.round((result.maxBack / result.locMaxBack) * 100) : 0;
    setGameText(this.subtitle,
      gameMessage('{tier} · глубина {depthNow} из {depthMax} шагов ({percent}%) · {duration}',
        '{tier} · depth {depthNow} of {depthMax} steps ({percent}%) · {duration}'),
      {
        tier: gameText(tierMessage[result.tier]), depthNow: result.maxBack,
        depthMax: result.locMaxBack, percent: depth, duration: gameDuration(result.durationSec),
      });

    this.lootBox.innerHTML = '';
    this.counters.clear();
    for (const kind of ORDER) {
      const amount = result.carried[kind] ?? 0;
      if (amount <= 0) continue;
      const row = document.createElement('div');
      row.className = 'row loot-row';
      const name = document.createElement('span');
      name.className = 'lbl';
      setGameText(name, resourceMessage[kind]);
      const icon = resourceIcon(kind);
      if (icon !== undefined) {
        const pic = document.createElement('img');
        pic.className = 'resource-pic';
        pic.src = icon;
        pic.alt = '';
        row.appendChild(pic);
      }
      const value = document.createElement('b');
      value.textContent = '0';
      row.append(name, value);
      this.lootBox.appendChild(row);
      this.counters.set(kind, { el: value, target: amount });
    }
    if (this.counters.size === 0) {
      this.lootBox.innerHTML = `<div class="loot-row dim">${gameMarkup(gameMessage('Пусто', 'Empty'))}</div>`;
    }

    this.supplyBox.style.display = supply === null ? 'none' : '';
    this.supplyList.replaceChildren();
    if (supply !== null) {
      for (const reward of supply.rewards) {
        const row = document.createElement('div');
        row.className = `r-supply-row${reward.category === 'bonus-rare' ? ' rare' : ''}`;
        const slot = document.createElement('span');
        const slotMessage = reward.slot === 'material'
          ? gameMessage('Материал', 'Material')
          : reward.slot === 'expedition'
            ? gameMessage('В путь', 'Expedition')
            : gameMessage('Бонус', 'Bonus');
        setGameText(slot, slotMessage);
        const name = document.createElement('b');
        setGameText(name, SUPPLY_REWARD_MESSAGE[reward.id]);
        row.append(slot, name);
        this.supplyList.appendChild(row);
      }
      if (supply.forced) {
        setGameText(this.supplyNote,
          gameMessage('Редкий бонус · гарантия {pity}-го ларца', 'Rare bonus · guaranteed on chest {pity}'),
          { pity: SUPPLY_HARD_PITY });
      } else if (supply.rare) {
        setGameText(this.supplyNote, gameMessage('Редкий бонус', 'Rare bonus'));
      } else {
        setGameText(this.supplyNote,
          gameMessage('До гарантии: {left}', 'Until guarantee: {left}'),
          { left: SUPPLY_HARD_PITY - supply.pityAfter });
      }
      if (!supply.consumableAdded && supply.rewards.some((reward) => reward.consumable !== undefined)) {
        this.supplyNote.append(` · ${gameText(gameMessage('слоты походных предметов заняты', 'expedition slots are full'))}`);
      }
      if (supply.overflow > 0) {
        this.supplyNote.append(` · ${gameText(gameMessage('не поместилось: {amount}', 'could not fit: {amount}'), { amount: supply.overflow })}`);
      }
    }

    if (result.lost > 0) {
      setGameText(this.lostLine, gameMessage('Потеряно {lost} из {total}', 'Lost {lost} of {total}'), {
        lost: result.lost, total: result.bagTotal,
      });
    } else this.lostLine.textContent = '';

    const showCombat = result.fights > 0 || result.kills > 0 || result.damageTaken > 0;
    this.combatBox.style.display = showCombat ? '' : 'none';
    if (showCombat) {
      const stats = [
        { label: gameMessage('Стычки', 'Encounters'), value: result.fights },
        { label: gameMessage('Побеждено', 'Defeated'), value: result.kills },
        { label: gameMessage('Получено урона', 'Damage taken'), value: result.damageTaken },
        { label: gameMessage('Опыт за бой', 'Combat XP'), value: `+${result.combatXp}` },
        { label: gameMessage('Всего опыта', 'Total XP'), value: progression === null ? '—' : `+${progression.xp}` },
      ];
      this.combatGrid.replaceChildren();
      for (const { label, value } of stats) {
        const name = document.createElement('span');
        setGameText(name, label);
        const amount = document.createElement('b');
        amount.textContent = String(value);
        this.combatGrid.append(name, amount);
      }
      if (progression !== null && progression.levels > 0) {
        setGameText(this.levelLine,
          gameMessage('Новый уровень: {level} · очки характеристик +{stats} · очки умений +{skills}',
            'New level: {level} · Stat points +{stats} · Skill points +{skills}'),
          { level: progression.level, stats: progression.levels * 2, skills: progression.levels });
      } else this.levelLine.textContent = '';
    }

    // §20.1 — главная кнопка это трата. Если тратить нечего, честно
    // предлагаем повтор, а не серую кнопку.
    if (this.suggestion !== null) {
      const id = this.suggestion;
      setGameText(this.primary, gameMessage('Построить: {building} ур. {level}', 'Build: {building} lvl {level}'), {
        building: gameText(buildingMessage[id]), level: camp.levels[id] + 1,
      });
      this.setRaidLabel(this.secondary);
      this.secondary.style.display = '';
    } else if (this.consumable !== null) {
      setGameText(this.primary, gameMessage('Взять: {item}', 'Take: {item}'), {
        item: gameText(consumableMessage[this.consumable].name),
      });
      this.setRaidLabel(this.secondary);
      this.secondary.style.display = '';
    } else if (this.gearSuggestion !== null) {
      setGameText(this.primary,
        camp.gear[this.gearSuggestion] <= 0
          ? gameMessage('Выковать: {item}', 'Forge: {item}')
          : gameMessage('Улучшить: {item}', 'Upgrade: {item}'),
        { item: gameText(gearMessage[this.gearSuggestion]) });
      this.setRaidLabel(this.secondary);
      this.secondary.style.display = '';
    } else {
      this.setRaidLabel(this.primary);
      this.secondary.style.display = 'none';
    }

    this.syncProgress(camp);

    // Первое возвращение ведёт в лагерь и никуда больше.
    if (onlyCamp) {
      setGameText(this.primary, gameMessage('В лагерь', 'To camp'));
      this.secondary.style.display = 'none';
      setGameText(this.progressLabel, gameMessage('Лагерь открыт', 'Camp unlocked'));
      this.progressBar.style.width = '100%';
    }
    this.tertiary.style.display = onlyCamp ? 'none' : '';

    this.root.classList.add('on');
  }

  /**
   * Куда зовёт кнопка. Название места вместо «ещё вылазка»: после первой же
   * вылазки места перестают быть одинаковыми, и кнопка обязана это признавать.
   */
  private setRaidLabel(element: Element): void {
    const node = regionAt(dayAt(this.at)).nodes[this.raidNode];
    if (node === undefined) setGameText(element, gameMessage('Ещё вылазка', 'Another raid'));
    else setGameText(element, gameMessage('Ещё вылазка · {place}', 'Another raid · {place}'), {
      place: window.EmberholdLanguage?.translate(node.name) ?? node.name,
    });
  }

  /** Полоса прогресса к следующему улучшению — то, ради чего играли. */
  private syncProgress(camp: CampState): void {
    // Когда трата — снаряжение, полоса обязана показывать его же: полоса
    // про недостижимую постройку рядом с кнопкой про кайло читается как ошибка.
    if (this.suggestion === null && this.gearSuggestion !== null) {
      const slot = this.gearSuggestion;
      const next = camp.gear[slot] + 1;
      setGameText(this.progressLabel, gameMessage('{item} ур. {level} — {effect}', '{item} lvl {level} — {effect}'), {
        item: gameText(gearMessage[slot]), level: next, effect: gearLine(slot, next),
      });
      this.progressBar.style.width = '100%';
      return;
    }
    const id = this.suggestion ?? this.cheapestLocked(camp);
    if (id === null) {
      setGameText(this.progressLabel, gameMessage('Всё построено', 'Everything is built'));
      this.progressBar.style.width = '100%';
      return;
    }
    const next = camp.levels[id] + 1;
    const progress = upgradeProgress(camp, id);
    const block = this.upgradeBlockedLine(camp, id);
    if (progress >= 1) {
      setGameText(this.progressLabel,
        block === null
          ? gameMessage('{building} ур. {level} — ресурсы собраны', '{building} lvl {level} — resources collected')
          : gameMessage('{building} ур. {level} — ресурсы собраны · {block}', '{building} lvl {level} — resources collected · {block}'),
        { building: gameText(buildingMessage[id]), level: next, ...(block === null ? {} : { block }) });
      this.progressBar.style.width = '100%';
      return;
    }
    const cost = BUILD_COST[next] ?? {};
    const need = (Object.entries(cost) as [ResourceKind, number][])
      .filter(([kind, amount]) => (camp.resources[kind] ?? 0) < amount)
      .map(([kind, amount]) => `${gameText(resourceMessage[kind])} ${camp.resources[kind] ?? 0}/${amount}`)
      .join(' · ');
    const tail = [need, block].filter((part) => part !== null && part !== '').join(' · ');
    setGameText(this.progressLabel, gameMessage('{building} ур. {level} — {remaining}', '{building} lvl {level} — {remaining}'), {
      building: gameText(buildingMessage[id]), level: next, remaining: tail,
    });
    this.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
  }

  private upgradeBlockedLine(camp: CampState, id: BuildingId): string | null {
    const block = upgradeBlock(camp, id);
    if (block === 'ok' || block === 'resources') return null;
    if (block === 'locked') return gameText(gameMessage('нужно Жильё ур. {level}', 'requires Housing lvl {level}'), {
      level: BUILDINGS[id].unlockHq,
    });
    if (block === 'slot-busy') {
      if (camp.construction !== null) {
        return gameText(gameMessage('слот занят: {building} ещё {duration}', 'slot occupied: {building}, {duration} left'), {
          building: gameText(buildingMessage[camp.construction.building]),
          duration: gameDuration(camp.construction.endsAt - this.at),
        });
      }
      if (camp.walls?.work != null) {
        return gameText(gameMessage('слот занят: стена ещё {duration}', 'slot occupied: wall, {duration} left'), {
          duration: gameDuration(camp.walls.work.endsAt - this.at),
        });
      }
    }
    if (block === 'max') return gameText(gameMessage('Максимальный уровень', 'Maximum level'));
    if (block === 'hq-cap') return gameText(gameMessage('Сначала улучшите Жильё', 'Upgrade Housing first'));
    return gameText(gameMessage('Уже идёт другая стройка', 'Another construction job is underway'));
  }

  private cheapestLocked(camp: CampState): BuildingId | null {
    let best: BuildingId | null = null;
    let bestProgress = -1;
    for (const id of BUILDING_ORDER) {
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

    /**
     * Строки звучат по одной, вразбивку по всей анимации, а не разом
     * в конце: одновременные щелчки слились бы в один, и «начислено четыре
     * вида» звучало бы так же, как «начислен один».
     *
     * Пропуск тапом досчитывает и звук — но одним щелчком, а не очередью
     * из четырёх: игрок, пропускающий начисление, просит короче, а не громче.
     */
    const rows = this.counters.size;
    if (rows === 0) return;
    // Потолок в число строк обязателен: без него шаг `rows + 1`, взятый
    // ради того, чтобы первая строка не звучала в нулевой момент, даёт
    // на полной анимации на один щелчок больше, чем строк.
    const due = this.skipped ? rows : Math.min(rows, Math.floor(eased * (rows + 1)));
    if (due <= this.picked) return;
    this.picked = this.skipped ? rows : this.picked + 1;
    play('pick');
  }

  hide(): void {
    this.root.classList.remove('on');
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }
}
