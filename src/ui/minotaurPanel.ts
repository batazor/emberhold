import type { CampState } from '../sim/camp';
import { coinsOf } from '../sim/camp';
import {
  MINOTAUR_TRADES,
  minotaurQuestRotation,
  minotaurResourceText,
  minotaurTradeRewardText,
} from '../sim/minotaurCastle';
import { RESOURCE_NAME } from '../sim/resources';

export interface MinotaurPanelCallbacks {
  readonly onFight: () => void;
  readonly onTrade: (id: string) => void;
  readonly onQuest: (id?: string) => void;
  readonly onLeave: () => void;
}

export class MinotaurPanel {
  readonly el: HTMLDivElement;
  private readonly say: HTMLParagraphElement;
  private readonly goods: HTMLParagraphElement;
  private readonly acts: HTMLDivElement;
  private camp: CampState | null = null;
  private seed = 0;

  constructor(parent: HTMLElement, private readonly cb: MinotaurPanelCallbacks) {
    this.el = document.createElement('div');
    this.el.id = 'minotaur-meet';
    this.say = document.createElement('p');
    this.say.className = 'say';
    this.goods = document.createElement('p');
    this.goods.className = 'goods';
    this.acts = document.createElement('div');
    this.acts.className = 'acts';
    this.el.append(this.say, this.goods, this.acts);
    parent.append(this.el);
    this.hide();
  }

  get visible(): boolean { return this.el.style.display !== 'none'; }
  hide(): void { this.el.style.display = 'none'; }

  show(camp: CampState, seed: number): void {
    this.camp = camp;
    this.seed = seed;
    this.el.style.display = 'flex';
    this.render();
  }

  sync(camp: CampState): void {
    if (!this.visible) return;
    this.camp = camp;
    this.render();
  }

  private button(label: string, small: string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.innerHTML = `${label}<small>${small}</small>`;
    button.addEventListener('click', click);
    return button;
  }

  private render(): void {
    const camp = this.camp;
    if (camp === null) return;
    const accepted = camp.minotaurQuests?.[String(this.seed >>> 0)];
    const reputation = camp.minotaurReputation ?? 0;
    const rotation = minotaurQuestRotation(this.seed, camp.minotaurQuestCycle ?? 0);
    this.say.textContent = '— В моём доме берут не тайком. За моей спиной два каменных стража. Есть три пути: испытание, честный обмен или работа.';
    this.goods.textContent = `Репутация: ${reputation} · Монеты: ${coinsOf(camp)} · ${RESOURCE_NAME.stone}: ${camp.resources.stone} · ${RESOURCE_NAME.wood}: ${camp.resources.wood} · ${RESOURCE_NAME.iron}: ${camp.resources.iron}`;
    this.acts.replaceChildren();
    this.acts.append(this.button('Сразиться', 'Минотавр и два голема охраняют золотой сундук', this.cb.onFight));
    for (const offer of MINOTAUR_TRADES) {
      const need = Math.max(0, offer.reputation - (Object.values(camp.minotaurRelics ?? {}).includes('labyrinth-signet') ? 1 : 0));
      const button = this.button(
        offer.name,
        `${minotaurResourceText(offer.costKind, offer.costAmount)} → ${minotaurTradeRewardText(offer, Object.values(camp.minotaurRelics ?? {}).includes('golem-heart') ? 1 : 0)}`,
        () => this.cb.onTrade(offer.id),
      );
      button.disabled = reputation < need;
      if (button.disabled) button.querySelector('small')!.textContent = `Откроется при репутации ${need}`;
      this.acts.append(button);
    }
    if (accepted !== undefined && !accepted.completed) {
      this.acts.append(this.button(
        `Сдать: ${accepted.title ?? 'заказ минотавра'}`,
        `${minotaurResourceText(accepted.kind, accepted.amount)} → ${accepted.reward} монет · +${accepted.reputation ?? 1} репутации`,
        () => this.cb.onQuest(accepted.id),
      ));
    } else {
      for (const quest of rotation) {
        this.acts.append(this.button(
          quest.title,
          `${minotaurResourceText(quest.kind, quest.amount)} → ${quest.reward} монет · +${quest.reputation} репутации`,
          () => this.cb.onQuest(quest.id),
        ));
      }
    }
    this.acts.append(this.button('Уйти', 'Разговор закончится', this.cb.onLeave));
  }
}
