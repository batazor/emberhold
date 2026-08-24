import type { LiveCamp } from '../sim/standing';
import { setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';

/**
 * Небольшая рамка гостевого режима. Она не повторяет лагерный HUD: ресурсы,
 * стройка и жители принадлежат хозяину и потому в просмотре не являются
 * кнопками. На сцене остаются только имя, явная метка read-only и выход.
 */
export class VisitCampHud {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly people: HTMLElement;
  private readonly like: HTMLButtonElement;
  private readonly note: HTMLElement;

  constructor(parent: HTMLElement, onBack: () => void, onLike: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'visit-camp';

    const head = document.createElement('div');
    head.className = 'panel visit-head';
    const title = document.createElement('div');
    title.className = 'row mid';
    this.name = document.createElement('b');
    const badge = document.createElement('span');
    badge.className = 'badge';
    setGameText(badge, gameMessages.visitCampMode);
    title.append(this.name, badge);
    this.people = document.createElement('span');
    this.people.className = 'map-note';
    head.append(title, this.people);

    const actions = document.createElement('div');
    actions.className = 'visit-actions';
    this.like = document.createElement('button');
    this.like.className = 'cta visit-like';
    this.like.type = 'button';
    this.like.addEventListener('click', onLike);
    this.note = document.createElement('span');
    this.note.className = 'map-note visit-like-note';

    const back = document.createElement('button');
    back.className = 'ghost visit-back';
    back.type = 'button';
    setGameText(back, gameMessages.visitCampBack);
    back.addEventListener('click', onBack);
    actions.append(this.like, back, this.note);

    this.root.append(head, actions);
    parent.appendChild(this.root);
  }

  show(camp: LiveCamp): void {
    if (camp.clan === null) setGameText(this.name, gameMessages.visitCampUnnamed);
    else {
      this.name.removeAttribute('data-lingui-text');
      this.name.textContent = camp.clan;
    }
    setGameText(this.people, gameMessages.visitCampSummary, { level: camp.level, folk: camp.folk });
    this.setLike(camp.liked === true, camp.likes ?? 0);
    this.note.textContent = '';
    this.root.style.display = 'flex';
  }

  setLike(liked: boolean, likes: number, pending = false, failed = false): void {
    this.like.classList.toggle('liked', liked);
    this.like.setAttribute('aria-pressed', String(liked));
    this.like.disabled = pending;
    setGameText(this.like, liked ? gameMessages.visitCampLiked : gameMessages.visitCampLike, { likes });
    if (failed) setGameText(this.note, gameMessages.visitCampLikeFailed);
    else this.note.textContent = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
