import { setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import type { CloudClanInvitePreview } from '../core/cloud';

export interface ClanInvitePanelCallbacks {
  onAccept(token: string): Promise<boolean>;
}

/** Confirmation card opened from Telegram's startapp deep link. */
export class ClanInvitePanel {
  private readonly overlay: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly reason: HTMLElement;
  private readonly accept: HTMLButtonElement;
  private token: string | null = null;

  constructor(parent: HTMLElement, private readonly cb: ClanInvitePanelCallbacks) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'clan-invite';
    this.overlay.innerHTML = `<div class="panel"><h2></h2><p data-summary></p><p class="why" data-reason></p>
      <div class="acts"><button data-accept></button><button class="ghost" data-close></button></div></div>`;
    parent.appendChild(this.overlay);
    this.summary = this.overlay.querySelector('[data-summary]') as HTMLElement;
    this.reason = this.overlay.querySelector('[data-reason]') as HTMLElement;
    this.accept = this.overlay.querySelector('[data-accept]') as HTMLButtonElement;
    setGameText(this.overlay.querySelector('h2') as HTMLElement, gameMessages.clanInviteTitle);
    setGameText(this.overlay.querySelector('[data-close]') as HTMLButtonElement, gameMessages.clanInviteLater);

    this.accept.addEventListener('click', () => void this.submit());
    this.overlay.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target === this.overlay || target.hasAttribute('data-close')) this.close();
    });
  }

  open(token: string, preview: CloudClanInvitePreview): void {
    this.token = token;
    this.accept.hidden = false;
    setGameText(this.summary, gameMessages.clanInviteSummary, {
      name: preview.name,
      members: preview.memberCount,
    });
    setGameText(this.accept, preview.alreadyMember
      ? gameMessages.clanInviteAcceptAgain
      : gameMessages.clanInviteAccept);
    this.accept.disabled = !preview.canJoin;
    this.reason.hidden = preview.canJoin;
    if (!preview.canJoin) setGameText(this.reason, gameMessages.clanInviteConflict);
    this.overlay.classList.add('on');
  }

  invalid(): void {
    this.token = null;
    setGameText(this.summary, gameMessages.clanInviteInvalid);
    this.reason.hidden = true;
    this.accept.hidden = true;
    this.overlay.classList.add('on');
  }

  close(): void {
    this.overlay.classList.remove('on');
  }

  private async submit(): Promise<void> {
    if (this.token === null) return;
    this.accept.disabled = true;
    const accepted = await this.cb.onAccept(this.token);
    this.accept.disabled = false;
    if (accepted) this.close();
  }
}
