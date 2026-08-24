import { play } from '../core/audio';
import { cloudLink } from '../core/cloud';
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
    title: 'Вход',
    lead: 'Лагерь хранится за аккаунтом — ссылка придёт на почту',
    act: 'Прислать ссылку',
    swap: 'У меня нет аккаунта',
  },
  up: {
    title: 'Регистрация',
    lead: 'Аккаунт сохранит лагерь между устройствами',
    act: 'Завести аккаунт',
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

  /**
   * **Язык спрашивается на регистрации, и только на ней.** Заводящий аккаунт
   * приходит с чистого листа, и первый вопрос к нему — на каком языке
   * говорить; входящий уже отвечал на него однажды, и спрашивать второй раз
   * значило бы не помнить ответа (`cloudLanguage`).
   *
   * Переключатель — тот же, что в настройках и в артбуках (`language.js`),
   * и меняет он язык **сразу**, вместе с самой карточкой: выбор, который
   * ничего не делает до кнопки, читается формой, а не выбором.
   */
  private paint(): void {
    const c = CARDS[this.mode];
    this.card.innerHTML = `
      <h2>${c.title}</h2>
      <p class="sp-note">${c.lead}</p>
      ${this.mode === 'up'
        ? `<div class="set-language"><span class="lbl">Язык</span><span data-slot="language"></span></div>`
        : ''}
      <input type="email" data-in="email" placeholder="Почта" autocomplete="email">
      <p class="auth-note warn"></p>
      <button type="button" data-act="go">${c.act}</button>
      <button type="button" class="ghost" data-act="swap">${c.swap}</button>`;
    const slot = this.card.querySelector('[data-slot="language"]');
    if (slot instanceof HTMLElement) window.EmberholdLanguage?.toggle(slot);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const email = this.card.querySelector('[data-in="email"]');
    const note = this.card.querySelector('.auth-note');
    if (!(email instanceof HTMLInputElement) || email.value === '') return;
    if (note !== null) note.textContent = 'Письмо собирается…';
    this.busy = true;
    const refusal = await cloudLink(email.value, this.mode === 'up');
    this.busy = false;
    if (note === null) return;
    if (refusal !== null) {
      note.textContent = refusal;
      return;
    }
    play('tap');
    // Дальше всё случится в письме: ссылка вернёт в игру уже вошедшим,
    // а эта вкладка узнает о сессии сама и уберёт карточку.
    note.textContent = 'Ссылка отправлена — откройте письмо';
  }
}
