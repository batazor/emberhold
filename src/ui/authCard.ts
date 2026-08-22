import { play } from '../core/audio';
import { cloudSignIn, cloudSignUp } from '../core/cloud';
import { revealCard } from './cardReveal';

/**
 * Вход в игру: карточка поверх заставки. Показывается, только когда сессии
 * нет, — у входившего игрока сессия живёт в хранилище и переживает
 * перезапуск, так что карточку он видит один раз, а не каждый вечер.
 *
 * Вход и регистрация — две отдельные карточки, а не одна форма с тумблером:
 * у них разные обещания (открыть свой лагерь — завести новый аккаунт),
 * и каждая проявляется тем же растворением, что карточки раздачи, —
 * это тот же жест «игра сдаёт карту», а не служебное окно.
 *
 * Пароль уходит одним вызовом входа и нигде не хранится.
 */
export interface AuthCardCallbacks {
  /** Сессия открыта — main сверяет сейв с облаком и пускает играть. */
  onDone(): void;
}

const CARDS = {
  in: {
    title: 'Вход',
    lead: 'Лагерь хранится за аккаунтом',
    act: 'Войти',
    swap: 'У меня нет аккаунта',
  },
  up: {
    title: 'Регистрация',
    lead: 'Аккаунт сохранит лагерь между устройствами',
    act: 'Создать аккаунт',
    swap: 'У меня есть аккаунт',
  },
} as const;

type Mode = keyof typeof CARDS;

export class AuthCard {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private mode: Mode = 'in';
  /** Пока облако отвечает, вторая отправка не принимается. */
  private busy = false;

  constructor(parent: HTMLElement, cb: AuthCardCallbacks) {
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
      if (act === 'go') void this.submit(cb);
      else if (act === 'swap') {
        this.mode = this.mode === 'in' ? 'up' : 'in';
        this.paint();
        revealCard(this.card);
      }
    });
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.submit(cb);
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
      <h2>${c.title}</h2>
      <p class="sp-note">${c.lead}</p>
      <input type="email" data-in="email" placeholder="Почта" autocomplete="username">
      <input type="password" data-in="pass" placeholder="Пароль"
             autocomplete="${this.mode === 'in' ? 'current-password' : 'new-password'}">
      <p class="auth-note warn"></p>
      <button type="button" data-act="go">${c.act}</button>
      <button type="button" class="ghost" data-act="swap">${c.swap}</button>`;
  }

  private async submit(cb: AuthCardCallbacks): Promise<void> {
    if (this.busy) return;
    const email = this.card.querySelector('[data-in="email"]');
    const pass = this.card.querySelector('[data-in="pass"]');
    const note = this.card.querySelector('.auth-note');
    if (!(email instanceof HTMLInputElement) || !(pass instanceof HTMLInputElement)) return;
    if (email.value === '' || pass.value === '') return;
    if (note !== null) note.textContent = this.mode === 'in' ? 'Вход…' : 'Создание…';
    this.busy = true;
    const refusal = await (this.mode === 'in'
      ? cloudSignIn(email.value, pass.value)
      : cloudSignUp(email.value, pass.value));
    this.busy = false;
    if (refusal !== null) {
      if (note !== null) note.textContent = refusal;
      return;
    }
    play('tap');
    this.hide();
    cb.onDone();
  }
}
