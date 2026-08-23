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
import { CLAN_NAME_MAX, JOIN_REASON, NAME_REASON, nameBlock } from '../sim/clan';

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
        <h2>Свой клан</h2>
        <p class="dim">Имя, под которым лагерь стоит в таблице.</p>
        <input id="clan-name" type="text" maxlength="${CLAN_NAME_MAX}"
               autocomplete="off" spellcheck="false" placeholder="Имя клана">
        <div class="why" id="clan-why"></div>
        <div class="acts">
          <button id="clan-found">Основать</button>
          <button class="ghost" disabled title="${JOIN_REASON}">Вступить в чужой</button>
          <button class="ghost" data-close>Закрыть</button>
        </div>
        <p class="sp-note">${JOIN_REASON}.</p>
      </div>`;
    parent.appendChild(this.overlay);
    this.input = this.overlay.querySelector('#clan-name') as HTMLInputElement;
    this.found = this.overlay.querySelector('#clan-found') as HTMLButtonElement;
    this.why = this.overlay.querySelector('#clan-why') as HTMLElement;

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
    this.why.textContent = block === 'ok' || block === 'empty' ? '' : NAME_REASON[block];
  }

  private submit(): void {
    if (nameBlock(this.input.value) !== 'ok') return;
    this.cb.onFound(this.input.value.trim());
    this.close();
  }
}
