import type { CampState } from '../sim/camp';
import { coinsOf } from '../sim/camp';
import {
  MINOTAUR_TRADES,
  minotaurQuestRotation,
  minotaurResourceText,
  minotaurTradeRewardText,
} from '../sim/minotaurCastle';
import { resourceMessage } from '../i18n/gameData';
import { gameMessage, gameText, setGameText } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';

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

  private button(label: GameMessage | string, small: GameMessage | string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    const main = document.createElement('span');
    const detail = document.createElement('small');
    if (typeof label === 'string') main.textContent = label;
    else setGameText(main, label);
    if (typeof small === 'string') detail.textContent = small;
    else setGameText(detail, small);
    button.append(main, detail);
    button.addEventListener('click', click);
    return button;
  }

  private render(): void {
    const camp = this.camp;
    if (camp === null) return;
    const accepted = camp.minotaurQuests?.[String(this.seed >>> 0)];
    const reputation = camp.minotaurReputation ?? 0;
    const rotation = minotaurQuestRotation(this.seed, camp.minotaurQuestCycle ?? 0);
    setGameText(this.say, gameMessage('— В моём доме не крадут. За моей спиной два каменных стража. Выбирай: испытание, честный обмен или работа.', '— No one steals from my house. Two stone sentinels stand behind me. Choose: a trial, an honest trade, or honest work.'));
    setGameText(this.goods, gameMessage('Репутация: {reputation} · Монеты: {coins} · {stone}: {stoneCount} · {wood}: {woodCount} · {iron}: {ironCount}', 'Reputation: {reputation} · Coins: {coins} · {stone}: {stoneCount} · {wood}: {woodCount} · {iron}: {ironCount}'), {
      reputation, coins: coinsOf(camp), stone: gameText(resourceMessage.stone), stoneCount: camp.resources.stone,
      wood: gameText(resourceMessage.wood), woodCount: camp.resources.wood,
      iron: gameText(resourceMessage.iron), ironCount: camp.resources.iron,
    });
    this.acts.replaceChildren();
    this.acts.append(this.button(gameMessage('Сразиться', 'Fight'), gameMessage('Минотавр и два голема охраняют золотой сундук', 'The minotaur and two golems guard a golden chest'), this.cb.onFight));
    for (const offer of MINOTAUR_TRADES) {
      const need = Math.max(0, offer.reputation - (Object.values(camp.minotaurRelics ?? {}).includes('labyrinth-signet') ? 1 : 0));
      const button = this.button(
        offer.name,
        `${minotaurResourceText(offer.costKind, offer.costAmount)} → ${minotaurTradeRewardText(offer, Object.values(camp.minotaurRelics ?? {}).includes('golem-heart') ? 1 : 0)}`,
        () => this.cb.onTrade(offer.id),
      );
      button.disabled = reputation < need;
      if (button.disabled) setGameText(button.querySelector('small')!, gameMessage('Откроется при репутации {reputation}', 'Unlocks at reputation {reputation}'), { reputation: need });
      this.acts.append(button);
    }
    if (accepted !== undefined && !accepted.completed) {
      this.acts.append(this.button(
        gameText(gameMessage('Сдать: {quest}', 'Turn in: {quest}'), { quest: accepted.title ?? gameText(gameMessage('заказ минотавра', 'minotaur order')) }),
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
    this.acts.append(this.button(gameMessage('Уйти', 'Leave'), gameMessage('Разговор закончится', 'End the conversation'), this.cb.onLeave));
  }
}
