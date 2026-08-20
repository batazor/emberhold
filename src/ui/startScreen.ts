/**
 * Стартовый экран: одна кнопка поверх сцены (§6 — UI это DOM над канвасом).
 * Заголовок здесь не рисуется: он стоит в сцене буквами, и дублировать его
 * текстом значило бы держать два заголовка, которые разъедутся.
 */
export interface StartScreenCallbacks {
  onPlay(): void;
}

export class StartScreen {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement, cb: StartScreenCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'start';
    this.root.innerHTML = `<button data-act="play">Играть</button>`;
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      cb.onPlay();
    });
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
