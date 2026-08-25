import type { AchievementDef } from '../sim/achievements';
import { ACHIEVEMENTS } from '../sim/achievements';
import { setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import { ACHIEVEMENT_COPY, achievementGlyph } from './achievementPanel';

/** Глобальный HUD-сигнал: работает и в вылазке, и в лагере, и на возврате. */
export class AchievementToast {
  private readonly root: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly count: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly queue: { def: AchievementDef; earned: number }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.id = 'achievement-toast';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    const icon = document.createElement('div');
    icon.className = 'achievement-toast-icon';
    this.icon = icon;
    const copy = document.createElement('div');
    copy.className = 'achievement-toast-copy';
    const kicker = document.createElement('span');
    setGameText(kicker, gameMessages.achievementToast);
    this.title = document.createElement('b');
    this.description = document.createElement('small');
    copy.append(kicker, this.title, this.description);
    this.count = document.createElement('strong');
    this.root.append(icon, copy, this.count);
    parent.appendChild(this.root);
  }

  show(def: AchievementDef, earned: number): void {
    this.queue.push({ def, earned });
    if (!this.root.classList.contains('on')) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (item === undefined) return;
    const copy = ACHIEVEMENT_COPY[item.def.id];
    this.icon.innerHTML = achievementGlyph(item.def);
    setGameText(this.title, copy.title);
    setGameText(this.description, copy.goal);
    this.count.textContent = `${item.earned}/${ACHIEVEMENTS.length}`;
    this.root.classList.remove('on');
    void this.root.offsetWidth;
    this.root.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.root.classList.remove('on');
      this.timer = null;
      if (this.queue.length > 0) setTimeout(() => this.next(), 180);
    }, 4400);
  }
}
