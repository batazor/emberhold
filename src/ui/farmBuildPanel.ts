import type { CampState } from '../sim/camp';
import {
  FARM_STRUCTURE_IDS,
  FARM_STRUCTURES,
  farmBuildBlock,
  farmConstructionProgress,
  farmStructureCost,
  farmStructureSeconds,
} from '../sim/farm';
import type { FarmStructureId } from '../sim/farm';
import { gameDuration, gameMessage, gameText, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

interface Callbacks {
  onBuild(id: FarmStructureId): void;
  onDone(): void;
}

interface StructureText {
  readonly title: GameMessage;
  readonly copy: GameMessage;
}

const structureText: Readonly<Record<FarmStructureId, StructureText>> = {
  fence: {
    title: gameMessage('Ограда огорода', 'Garden fence'),
    copy: gameMessage('Защитит первые посадки и обозначит хозяйство', 'Protects the first crops and marks out the farm'),
  },
  well: {
    title: gameMessage('Колодец', 'Well'),
    copy: gameMessage('Открывает четыре рабочие грядки', 'Unlocks four working garden beds'),
  },
  barn: {
    title: gameMessage('Сарай', 'Barn'),
    copy: gameMessage('Открывает сбор и повторный посев одним действием', 'Unlocks batch harvest and replanting'),
  },
  plots: {
    title: gameMessage('Дренаж и грядки', 'Drainage and beds'),
    copy: gameMessage('Открывает все шесть рабочих грядок', 'Unlocks all six working garden beds'),
  },
  farmhouse: {
    title: gameMessage('Дом фермера', 'Farmhouse'),
    copy: gameMessage('Завершает хозяйство и 15-дневную историю', 'Completes the farm and its 15-day story'),
  },
};

const RESOURCE: Readonly<Record<string, GameMessage>> = {
  wood: gameMessage('древесины', 'wood'),
  stone: gameMessage('камня', 'stone'),
  iron: gameMessage('железа', 'iron'),
  crystal: gameMessage('кристаллов', 'crystal'),
  food: gameMessage('пищи', 'food'),
};

interface Card {
  readonly button: HTMLButtonElement;
  readonly state: HTMLElement;
}

export class FarmBuildPanel {
  readonly root: HTMLElement;
  private readonly cards = new Map<FarmStructureId, Card>();
  private readonly progress: HTMLElement;
  private readonly fill: HTMLElement;
  private camp: CampState | null = null;
  private now = 0;

  constructor(parent: HTMLElement, private readonly cb: Callbacks) {
    this.root = document.createElement('section');
    this.root.id = 'farm-build';
    this.root.className = 'panel';
    this.root.hidden = true;

    const head = document.createElement('header');
    head.className = 'row mid sheet-head';
    const title = document.createElement('b');
    setGameText(title, gameMessage('Развитие огорода', 'Farm development'));
    const done = document.createElement('button');
    done.className = 'ghost sheet-x';
    setGameText(done, gameMessage('Готово', 'Done'));
    done.addEventListener('click', () => this.cb.onDone());
    head.append(title, done);

    const list = document.createElement('div');
    list.className = 'farm-build-list';
    for (const id of FARM_STRUCTURE_IDS) {
      const button = document.createElement('button');
      button.className = 'card farm-build-card';
      button.type = 'button';
      const name = document.createElement('b');
      setGameText(name, structureText[id].title);
      const copy = document.createElement('small');
      setGameText(copy, structureText[id].copy);
      const state = document.createElement('span');
      state.className = 'dim';
      button.append(name, copy, state);
      button.addEventListener('click', () => this.cb.onBuild(id));
      list.appendChild(button);
      this.cards.set(id, { button, state });
    }

    this.progress = document.createElement('div');
    this.progress.className = 'farm-build-progress';
    this.fill = document.createElement('i');
    this.progress.appendChild(this.fill);
    this.root.append(head, list, this.progress);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible) this.paint();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  sync(camp: CampState, now: number): void {
    this.camp = camp;
    this.now = now;
    if (this.visible) this.paint();
  }

  private paint(): void {
    if (this.camp === null) return;
    const work = this.camp.farm?.story.construction;
    for (const [id, card] of this.cards) {
      const block = farmBuildBlock(this.camp, id);
      card.button.disabled = block !== 'ok';
      card.button.classList.toggle('built', block === 'built');
      if (work?.structure === id) {
        setGameText(card.state, gameMessage('Строится · {time}', 'Building · {time}'), {
          time: gameDuration(Math.max(0, work.endsAt - this.now)),
        });
      } else if (block === 'built') {
        setGameText(card.state, gameMessage('Построено', 'Built'));
      } else if (block === 'locked') {
        setGameText(card.state, gameMessage('Откроется в день {day}', 'Unlocks on day {day}'), {
          day: FARM_STRUCTURES[id].unlockDay,
        });
      } else if (block === 'busy') {
        setGameText(card.state, gameMessage('Строительный слот занят', 'Construction slot is busy'));
      } else {
        const cost = farmStructureCost(id);
        const price = Object.entries(cost)
          .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0)
          .map(([kind, amount]) => `${amount} ${gameText(RESOURCE[kind] ?? gameMessage(kind, kind))}`)
          .join(' · ');
        setGameText(card.state, gameMessage('{cost} · {time}', '{cost} · {time}'), {
          cost: price,
          time: gameDuration(farmStructureSeconds(id)),
        });
      }
    }
    const p = farmConstructionProgress(this.camp.farm, this.now);
    this.progress.hidden = work == null;
    this.fill.style.width = `${Math.round(p * 100)}%`;
  }
}
