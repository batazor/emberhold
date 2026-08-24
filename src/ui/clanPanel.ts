/**
 * Свой клан: окно, в котором его заводят (§30).
 *
 * **Вопрос ровно один — имя.** Ни цвета, ни девиза, ни устава: всё это
 * настройки того, чего ещё нет, и спрашивать их значит обещать механику
 * вперёд её появления. Клан сегодня — подпись, под которой лагерь стоит
 * в таблице, и окно спрашивает ровно её.
 *
 * **Вступление стоит здесь же, и оно отказывает с причиной.** Оба выхода —
 * свой клан и чужой — игрок обязан увидеть в одном месте, иначе «создать»
 * читается как единственный, а не как выбранный. Отказ при этом не серая
 * кнопка: §16.1 требует называть, чего не хватает, — а не хватает живых
 * соседей, потому что фракции мира людей не набирают (§10.3).
 */
import { clearGameText, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import { CLAN_NAME_MAX, CLAN_NAME_MIN, nameBlock, type NameBlock } from '../sim/clan';

const NAME_MESSAGES: Record<Exclude<NameBlock, 'ok'>, () => readonly [
  (typeof gameMessages)[keyof typeof gameMessages],
  Readonly<Record<string, number>>?,
]> = {
  empty: () => [gameMessages.clanNameEmpty],
  short: () => [gameMessages.clanNameShort, { min: CLAN_NAME_MIN }],
  long: () => [gameMessages.clanNameLong, { max: CLAN_NAME_MAX }],
  world: () => [gameMessages.clanNameWorld],
};

export interface ClanPanelCallbacks {
  /** Игрок назвал клан. Панель уже проверила имя — лагерь проверит ещё раз. */
  onFound(name: string): void;
}

export class ClanPanel {
  private readonly overlay: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly found: HTMLButtonElement;
  private readonly why: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: ClanPanelCallbacks) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'clan';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2></h2>
        <p class="dim" data-clan-lead></p>
        <input id="clan-name" type="text" maxlength="${CLAN_NAME_MAX}"
               autocomplete="off" spellcheck="false">
        <div class="why" id="clan-why"></div>
        <div class="acts">
          <button id="clan-found"></button>
          <button class="ghost" data-clan-join disabled></button>
          <button class="ghost" data-close></button>
        </div>
        <p class="sp-note" data-clan-reason></p>
      </div>`;
    parent.appendChild(this.overlay);
    this.input = this.overlay.querySelector('#clan-name') as HTMLInputElement;
    this.found = this.overlay.querySelector('#clan-found') as HTMLButtonElement;
    this.why = this.overlay.querySelector('#clan-why') as HTMLElement;
    setGameText(this.overlay.querySelector('h2') as HTMLElement, gameMessages.clanPanelTitle);
    setGameText(this.overlay.querySelector('[data-clan-lead]') as HTMLElement, gameMessages.clanPanelLead);
    setGameAttribute(this.input, 'placeholder', gameMessages.clanPanelName);
    setGameText(this.found, gameMessages.clanPanelFound);
    const join = this.overlay.querySelector('[data-clan-join]') as HTMLButtonElement;
    setGameText(join, gameMessages.clanPanelJoin);
    setGameAttribute(join, 'title', gameMessages.clanPanelJoinReason);
    setGameText(this.overlay.querySelector('[data-close]') as HTMLButtonElement, gameMessages.clanPanelClose);
    setGameText(this.overlay.querySelector('[data-clan-reason]') as HTMLElement, gameMessages.clanPanelJoinReason);

    this.input.addEventListener('input', () => this.sync());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    this.found.addEventListener('click', () => this.submit());
    this.overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.overlay || target.hasAttribute('data-close')) this.close();
    });
  }

  open(): void {
    this.input.value = '';
    this.sync();
    this.overlay.classList.add('on');
    // Клавиатура поднимается сама: окно спрашивает одно поле, и лишний тап
    // по нему — это тап ни за чем.
    this.input.focus();
  }

  close(): void {
    this.overlay.classList.remove('on');
  }

  /**
   * Отказ показывается **не сразу**: пустое поле в момент открытия — это
   * ещё не ошибка игрока, а начало ввода, и красная строка под ним читалась
   * бы упрёком за то, что он не успел напечатать.
   */
  private sync(): void {
    const block = nameBlock(this.input.value);
    this.found.disabled = block !== 'ok';
    if (block === 'ok' || block === 'empty') {
      clearGameText(this.why);
      this.why.textContent = '';
    }
    else {
      const [descriptor, values] = NAME_MESSAGES[block]();
      setGameText(this.why, descriptor, values);
    }
  }

  private submit(): void {
    if (nameBlock(this.input.value) !== 'ok') return;
    this.cb.onFound(this.input.value.trim());
    this.close();
  }
}
