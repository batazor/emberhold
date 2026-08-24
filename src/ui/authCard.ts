import { play } from '../core/audio';
import { cloudLink } from '../core/cloud';
import { clearGameText, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import { revealCard } from './cardReveal';

/**
 * Вход в игру: карточка поверх заставки, открывается кнопкой «Играть»,
 * когда сессии нет. Пароля нет вовсе — на почту уходит ссылка, ссылка
 * возвращает в игру уже вошедшим; сессия живёт в хранилище и переживает
 * перезапуск, так что карточка — гость редкий.
 *
 * Вход и регистрация — две отдельные карточки, а не одна форма с тумблером:
 * у них разные обещания (открыть свой лагерь — завести новый), и каждая
 * проявляется тем же растворением, что карточки раздачи, — это жест
 * «игра сдаёт карту», а не служебное окно.
 */
const CARDS = {
  in: {
    title: gameMessages.authSignInTitle,
    lead: gameMessages.authSignInLead,
    act: gameMessages.authSignInSubmit,
    swap: gameMessages.authSignInSwap,
  },
  up: {
    title: gameMessages.authSignUpTitle,
    lead: gameMessages.authSignUpLead,
    act: gameMessages.authSignUpSubmit,
    swap: gameMessages.authSignUpSwap,
  },
} as const;

type Mode = keyof typeof CARDS;

export class AuthCard {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private mode: Mode = 'in';
  /** Пока облако отвечает, вторая отправка не принимается. */
  private busy = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'auth';
    this.root.innerHTML = `<div class="panel"></div>`;
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.card = this.root.querySelector('.panel') as HTMLElement;

    // Тап по затемнению — назад к заставке: карточку игрок открыл сам
    // кнопкой «Играть», тем же жестом её можно и отложить.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });

    this.card.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      const act = e.target.dataset.act;
      if (act === 'go') void this.submit();
      else if (act === 'swap') {
        this.mode = this.mode === 'in' ? 'up' : 'in';
        this.paint();
        revealCard(this.card);
      }
    });
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.submit();
    });
  }

  show(): void {
    this.paint();
    this.root.style.display = 'flex';
    revealCard(this.card);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private paint(): void {
    const c = CARDS[this.mode];
    this.card.innerHTML = `
      <h2></h2>
      <p class="sp-note"></p>
      <input type="email" data-in="email" autocomplete="email">
      <p class="auth-note warn"></p>
      <button type="button" data-act="go"></button>
      <button type="button" class="ghost" data-act="swap"></button>`;
    setGameText(this.card.querySelector('h2') as HTMLElement, c.title);
    setGameText(this.card.querySelector('.sp-note') as HTMLElement, c.lead);
    setGameAttribute(this.card.querySelector('[data-in="email"]') as HTMLInputElement, 'placeholder', gameMessages.authEmail);
    setGameText(this.card.querySelector('[data-act="go"]') as HTMLButtonElement, c.act);
    setGameText(this.card.querySelector('[data-act="swap"]') as HTMLButtonElement, c.swap);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const email = this.card.querySelector('[data-in="email"]');
    const note = this.card.querySelector('.auth-note');
    if (!(email instanceof HTMLInputElement) || email.value === '') return;
    if (note !== null) setGameText(note, gameMessages.authSending);
    this.busy = true;
    const refusal = await cloudLink(email.value, this.mode === 'up');
    this.busy = false;
    if (note === null) return;
    if (refusal !== null) {
      clearGameText(note);
      note.textContent = refusal;
      return;
    }
    play('tap');
    // Дальше всё случится в письме: ссылка вернёт в игру уже вошедшим,
    // а эта вкладка узнает о сессии сама и уберёт карточку.
    setGameText(note, gameMessages.authSent);
  }
}
