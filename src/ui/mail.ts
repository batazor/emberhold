/**
 * Почта (§30) — значок в углу и пустой ящик под ним.
 *
 * **Пока это ровно значок, и он честен.** Писем не бывает ни одного:
 * писать их некому, потому что живых соседей в мире нет, а фракции не пишут
 * (§10.3 — поддельный сокомандник вычисляется за пару дней). Ящик поэтому
 * говорит «писем нет» и ничего не обещает: строка про то, что «здесь будут
 * приглашения», — это обещание, которое ещё нечем оплатить (§0.1).
 *
 * Зачем он тогда есть: со вторым жильцом мир перестаёт быть пустым — на карте
 * зажигаются чужие лагеря, в статистике появляется таблица. Место, куда
 * придёт первое слово от соседа, называется в тот же момент, а не в тот,
 * когда слово придёт: угол экрана — это привычка, и заводить её позже
 * значит переучивать.
 *
 * Появляется он вместе со всем слоем (`sim/clan.ts`) и живёт там же, где
 * шестерня настроек, — в верхнем левом углу, под ней. Угол выбран не «куда
 * влезло»: это единственное место, свободное во всех сценах сразу
 * (`style.css`, раздел настроек).
 */

import { gameMessage, setGameAttribute, setGameText } from '../i18n/game';

/**
 * Конверт: рамка и клапан. Прямые грани, без скруглений и полутонов — то же
 * правило, по которому нарисована шестерня рядом, и то же плоское затенение,
 * что у всего в игре (§6.1).
 *
 * Одним путём и чётным правилом заливки: нутро конверта вырезано из рамки,
 * а клапан лежит в нутре — и потому заливается обратно. Подложкой цвета его
 * рисовать нельзя, под кнопкой сцена, и любой сплошной прямоугольник читался
 * бы заплаткой.
 */
const MAIL = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" fill-rule="evenodd" d="M1.5,4.5L22.5,4.5L22.5,19.5L1.5,19.5Z M3.9,6.9L3.9,17.1L20.1,17.1L20.1,6.9Z M3.9,6.9L20.1,6.9L20.1,9.3L12,15.1L3.9,9.3Z"/>
</svg>`;

export class MailButton {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLElement;

  constructor(parent: HTMLElement) {
    this.button = document.createElement('button');
    this.button.id = 'mail-open';
    this.button.type = 'button';
    setGameAttribute(this.button, 'aria-label', gameMessage('Почта', 'Mail'));
    this.button.innerHTML = MAIL;
    // Значка нет до второго жильца: угол экрана — дорогое место, и держать
    // там кнопку, которая не про сегодняшнюю игру, значит занять его зря.
    this.button.style.display = 'none';
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'mail';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2 id="mail-title"></h2>
        <p class="dim" id="mail-empty"></p>
        <div class="acts"><button class="ghost" data-close></button></div>
      </div>`;
    setGameText(this.overlay.querySelector('#mail-title')!, gameMessage('Почта', 'Mail'));
    setGameText(this.overlay.querySelector('#mail-empty')!, gameMessage('Писем пока нет', 'No messages yet'));
    setGameText(this.overlay.querySelector('[data-close]')!, gameMessage('Закрыть', 'Close'));
    parent.appendChild(this.overlay);

    this.button.addEventListener('click', () => this.open());
    // Тап по затемнению — тот же выход, что у настроек: окно ничего
    // не решает за игрока.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay || (e.target as HTMLElement).hasAttribute('data-close')) {
        this.close();
      }
    });
  }

  /** Показать или спрятать значок. Решает не почта, а слой соседей. */
  setShown(on: boolean): void {
    this.button.style.display = on ? '' : 'none';
    if (!on) this.close();
  }

  open(): void {
    this.overlay.classList.add('on');
  }

  close(): void {
    this.overlay.classList.remove('on');
  }
}
