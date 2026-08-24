/**
 * Стартовый экран: одна кнопка поверх сцены (§6 — UI это DOM над канвасом).
 * Заголовок здесь не рисуется: он стоит в сцене буквами, и дублировать его
 * текстом значило бы держать два заголовка, которые разъедутся.
 *
 * Над кнопкой — хроника (§25), и место выбрано, а не найдено: это
 * единственный кадр, который игрок видит **на возвращении** и до того,
 * как принял хоть одно решение. Ни экран возврата, ни лагерь для неё
 * не годятся — там у игрока на руках выбор, который §20.1 меряет, и класть
 * рядом с ним чтение значит мерить уже не его.
 *
 * Пустой хроники не бывает: строк нет — нет и листа. Коробка с надписью
 * «пока ничего» — это обещание содержимого, которого игра не давала.
 */
import type { Entry } from '../sim/chronicle';
import { setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';

export interface StartScreenCallbacks {
  onPlay(): void;
}

export class StartScreen {
  private readonly root: HTMLElement;
  private readonly chron: HTMLElement;

  constructor(parent: HTMLElement, cb: StartScreenCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'start';
    this.root.innerHTML = `
      <div id="chron" class="panel"></div>
      <button data-act="play"></button>`;
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.chron = this.root.querySelector('#chron') as HTMLElement;
    setGameText(this.root.querySelector('[data-act="play"]') as HTMLButtonElement, gameMessages.startPlay);
    this.setChronicle([]);

    this.root.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      cb.onPlay();
    });
  }

  /** §25 — что случилось в прошлые дни. Слева слова, справа число (§6.2). */
  setChronicle(entries: readonly Entry[]): void {
    this.chron.style.display = entries.length === 0 ? 'none' : 'flex';
    this.chron.innerHTML = entries
      .map((e) => `<div class="row"><span>${e.text}</span><span class="num">${e.value}</span></div>`)
      .join('');
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
