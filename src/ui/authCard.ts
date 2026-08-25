import { play } from '../core/audio';
import { cloudLink } from '../core/cloud';
import { platformKind } from '../core/platform';
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

type Mode = keyof typeof CARDS | 'platform';

/**
 * Платформа доказывает личность сама, и карточка здесь — не форма входа,
 * а объяснение осечки. Кнопки «Повторить» и «Закрыть» у платформ общие и
 * намеренно остались под своими прежними ключами перевода: текст у них
 * нейтральный, а переименование ключа стоило бы правки словаря ради
 * ничего не меняющей строки.
 */
const PLATFORM_CARDS = {
  telegram: {
    title: gameMessages.telegramAuthTitle,
    lead: gameMessages.telegramAuthLead,
    retrying: gameMessages.telegramAuthRetrying,
    failed: gameMessages.telegramAuthFailed,
  },
  vk: {
    title: gameMessages.vkAuthTitle,
    lead: gameMessages.vkAuthLead,
    retrying: gameMessages.vkAuthRetrying,
    failed: gameMessages.vkAuthFailed,
  },
} as const;

/** Веб сюда не попадает: у него платформенного входа нет, есть почта. */
const platformCard = (): typeof PLATFORM_CARDS[keyof typeof PLATFORM_CARDS] =>
  platformKind() === 'vk' ? PLATFORM_CARDS.vk : PLATFORM_CARDS.telegram;

export class AuthCard {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private mode: Mode = 'in';
  /** Пока облако отвечает, вторая отправка не принимается. */
  private busy = false;
  private platformRetry: (() => Promise<boolean>) | null = null;
  private platformSuccess: (() => void) | null = null;

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
      if (act === 'go') void (this.mode === 'platform' ? this.submitPlatform() : this.submit());
      else if (act === 'swap' && this.mode !== 'platform') {
        this.mode = this.mode === 'in' ? 'up' : 'in';
        this.paint();
        revealCard(this.card);
      } else if (act === 'close') this.hide();
    });
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void (this.mode === 'platform' ? this.submitPlatform() : this.submit());
    });
  }

  show(): void {
    this.mode = 'in';
    this.platformRetry = null;
    this.platformSuccess = null;
    this.paint();
    this.root.style.display = 'flex';
    revealCard(this.card);
  }

  /** A platform never falls back to email: a failed signed exchange is retried in place. */
  showPlatform(retry: () => Promise<boolean>, onSuccess: () => void): void {
    this.busy = false;
    this.mode = 'platform';
    this.platformRetry = retry;
    this.platformSuccess = onSuccess;
    this.paint();
    this.root.style.display = 'flex';
    revealCard(this.card);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /**
   * **Язык спрашивается на регистрации, и только на ней** (§6.2.7).
   * Заводящий аккаунт приходит с чистого листа, и первый вопрос к нему —
   * на каком языке говорить; входящему его не задают, потому что он на него
   * уже отвечал, и ответ лежит в аккаунте (`cloudLanguage`).
   *
   * Переключатель — тот же, что в настройках и в артбуках (`i18n/browser.ts`),
   * и меняет он язык **сразу**, вместе с самой карточкой: выбор, который
   * ничего не делает до кнопки, читается формой, а не выбором.
   */
  private paint(): void {
    if (this.mode === 'platform') {
      const card = platformCard();
      this.card.innerHTML = `
        <h2></h2>
        <p class="sp-note"></p>
        <p class="auth-note warn"></p>
        <button type="button" data-act="go"></button>
        <button type="button" class="ghost" data-act="close"></button>`;
      setGameText(this.card.querySelector('h2') as HTMLElement, card.title);
      setGameText(this.card.querySelector('.sp-note') as HTMLElement, card.lead);
      setGameText(this.card.querySelector('[data-act="go"]') as HTMLButtonElement, gameMessages.telegramAuthRetry);
      setGameText(this.card.querySelector('[data-act="close"]') as HTMLButtonElement, gameMessages.telegramAuthClose);
      return;
    }
    const c = CARDS[this.mode];
    this.card.innerHTML = `
      <h2></h2>
      <p class="sp-note"></p>
      ${this.mode === 'up'
        ? `<div class="set-language"><span class="lbl" data-language-label></span><span data-slot="language"></span></div>`
        : ''}
      <input type="email" data-in="email" autocomplete="email">
      <p class="auth-note warn"></p>
      <button type="button" data-act="go"></button>
      <button type="button" class="ghost" data-act="swap"></button>`;
    setGameText(this.card.querySelector('h2') as HTMLElement, c.title);
    setGameText(this.card.querySelector('.sp-note') as HTMLElement, c.lead);
    setGameAttribute(this.card.querySelector('[data-in="email"]') as HTMLInputElement, 'placeholder', gameMessages.authEmail);
    setGameText(this.card.querySelector('[data-act="go"]') as HTMLButtonElement, c.act);
    setGameText(this.card.querySelector('[data-act="swap"]') as HTMLButtonElement, c.swap);
    const label = this.card.querySelector('[data-language-label]');
    if (label instanceof HTMLElement) setGameText(label, gameMessages.settingsLanguage);
    // Кнопки языка ставит сам переключатель: своя копия разошлась бы
    // с настройками подписями и состоянием.
    const slot = this.card.querySelector('[data-slot="language"]');
    if (slot instanceof HTMLElement) window.EmberholdLanguage?.toggle(slot);
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

  private async submitPlatform(): Promise<void> {
    if (this.busy || this.platformRetry === null) return;
    const note = this.card.querySelector('.auth-note');
    const button = this.card.querySelector('[data-act="go"]');
    if (note instanceof HTMLElement) setGameText(note, platformCard().retrying);
    if (button instanceof HTMLButtonElement) button.disabled = true;
    this.busy = true;
    const signedIn = await this.platformRetry();
    this.busy = false;
    if (signedIn) {
      this.hide();
      this.platformSuccess?.();
      return;
    }
    if (button instanceof HTMLButtonElement) button.disabled = false;
    if (note instanceof HTMLElement) setGameText(note, platformCard().failed);
    play('deny');
  }
}
