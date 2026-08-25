import type { CampState } from '../sim/camp';
import {
  ACHIEVEMENTS,
  unseenAchievements,
  type AchievementDef,
  type AchievementId,
} from '../sim/achievements';
import { setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages, type GameMessage } from '../i18n/gameMessages';

interface AchievementCopy {
  readonly title: GameMessage;
  readonly description: GameMessage;
  readonly goal: GameMessage;
}

/** Текст остаётся рядом с показом и извлекается в каталог literal-вызовами. */
export const ACHIEVEMENT_COPY: Record<AchievementId, AchievementCopy> = {
  'first-camp': {
    title: gameMessages.achievementFirstCampTitle,
    description: gameMessages.achievementFirstCampDescription,
    goal: gameMessages.achievementFirstCampGoal,
  },
  'first-return': {
    title: gameMessages.achievementFirstReturnTitle,
    description: gameMessages.achievementFirstReturnDescription,
    goal: gameMessages.achievementFirstReturnGoal,
  },
  'first-shelter': {
    title: gameMessages.achievementFirstShelterTitle,
    description: gameMessages.achievementFirstShelterDescription,
    goal: gameMessages.achievementFirstShelterGoal,
  },
};

/**
 * Три знака из одной линии и одной палитры. Это SVG интерфейса, а не новый
 * набор картинок: карточка и HUD обязаны показывать один и тот же силуэт.
 */
export function achievementGlyph(def: Pick<AchievementDef, 'icon'>): string {
  const drawing = def.icon === 'camp'
    ? '<path d="M7 18h10M9 18l3-13 3 13M8.3 13.5h7.4M6 18l2-5m10 5-2-5"/><path class="flame" d="M12 12c-2.2 1.5-2.8 3-1.6 4.3.5.5 1 .7 1.6.7s1.2-.2 1.6-.7c1.2-1.3.6-2.8-1.6-4.3Z"/>'
    : def.icon === 'return'
      ? '<path d="M5 11.5h9m-3-3 3 3-3 3"/><path d="M16 6h3v12h-3M5 16.5v2h9v-4"/><path class="flame" d="M6.5 7.5h3l1 2h-5Z"/>'
      : '<path d="M4 12 12 5l8 7M6.5 10.5V19h11v-8.5M10 19v-5h4v5"/><circle cx="8.3" cy="14" r="1.2"/><circle cx="15.7" cy="14" r="1.2"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><g>${drawing}</g></svg>`;
}

interface AchievementCard {
  readonly root: HTMLElement;
  readonly state: HTMLElement;
  readonly title: HTMLElement;
  readonly description: HTMLElement;
  readonly goal: HTMLElement;
}

export interface AchievementPanelCallbacks {
  onIcon(): void;
  onSeen(): void;
}

export class AchievementPanel {
  readonly root: HTMLElement;
  readonly icon: HTMLButtonElement;
  private readonly mark: HTMLElement;
  private readonly count: HTMLElement;
  private readonly cards = new Map<AchievementId, AchievementCard>();

  constructor(private readonly cb: AchievementPanelCallbacks) {
    this.icon = document.createElement('button');
    this.icon.className = 'chip achievement-icon';
    this.icon.innerHTML = `${achievementGlyph(ACHIEVEMENTS[0]!)}<span class="achievement-icon-count">0/${ACHIEVEMENTS.length}</span>`;
    setGameAttribute(this.icon, 'aria-label', gameMessages.achievementTitle);
    this.count = this.icon.querySelector('.achievement-icon-count')!;
    this.mark = document.createElement('i');
    this.mark.className = 'achievement-mark';
    this.icon.appendChild(this.mark);
    this.icon.addEventListener('click', () => this.cb.onIcon());

    this.root = document.createElement('div');
    this.root.className = 'sec achievements';
    const lead = document.createElement('p');
    lead.className = 'achievement-lead';
    setGameText(lead, gameMessages.achievementLead);
    const grid = document.createElement('div');
    grid.className = 'achievement-grid';
    for (const def of ACHIEVEMENTS) {
      const copy = ACHIEVEMENT_COPY[def.id];
      const card = document.createElement('article');
      card.className = 'card achievement-card locked';
      card.style.setProperty('--in', `${def.paceDay * 55}ms`);
      const emblem = document.createElement('div');
      emblem.className = 'achievement-emblem';
      emblem.innerHTML = achievementGlyph(def);
      const state = document.createElement('span');
      state.className = 'achievement-state';
      const title = document.createElement('b');
      setGameText(title, copy.title);
      const description = document.createElement('p');
      setGameText(description, copy.description);
      const goal = document.createElement('small');
      setGameText(goal, copy.goal);
      const words = document.createElement('div');
      words.className = 'achievement-words';
      words.append(state, title, description, goal);
      card.append(emblem, words);
      grid.appendChild(card);
      this.cards.set(def.id, { root: card, state, title, description, goal });
    }
    this.root.append(lead, grid);
  }

  sync(camp: CampState): void {
    const state = camp.achievements;
    const earned = ACHIEVEMENTS.filter((def) => state?.earned[def.id] !== undefined).length;
    this.count.textContent = `${earned}/${ACHIEVEMENTS.length}`;
    const unseen = unseenAchievements(camp).length;
    this.mark.textContent = unseen > 0 ? String(unseen) : '';
    this.mark.style.display = unseen > 0 ? '' : 'none';
    this.icon.classList.toggle('ready', unseen > 0);
    for (const def of ACHIEVEMENTS) {
      const card = this.cards.get(def.id)!;
      const record = state?.earned[def.id];
      const done = record !== undefined;
      card.root.classList.toggle('locked', !done);
      card.root.classList.toggle('earned', done);
      if (done) {
        setGameText(card.state, gameMessages.achievementEarned, { day: record.day });
      } else {
        setGameText(card.state, gameMessages.achievementSuggested, { day: def.paceDay });
      }
    }
  }

  appear(): void {
    const grid = this.root.querySelector('.achievement-grid');
    grid?.classList.remove('appear');
    if (grid instanceof HTMLElement) void grid.offsetWidth;
    grid?.classList.add('appear');
    this.cb.onSeen();
  }
}
