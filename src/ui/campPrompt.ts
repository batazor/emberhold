/**
 * Конец пролога: провиант вышел, и герой встаёт лагерем там, где стоит.
 *
 * Одна строка и одна кнопка, как на заставке (§6 — UI это DOM над канвасом).
 * Окна с «Понятно» здесь нет намеренно: раскадровка запрещает их на всём
 * протяжении обучения, а решение тут ровно одно, и отказаться от него нельзя.
 */
export interface CampPromptCallbacks {
  onPitch(): void;
}

export class CampPrompt {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement, cb: CampPromptCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'pitch';
    // Строка на панели, а не голым текстом по сцене: под ней светлая листва
    // поляны, и одной тени для контраста не хватало.
    this.root.innerHTML = `
      <p class="panel">Провиант кончился</p>
      <button data-act="pitch">Разбить лагерь</button>`;
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      cb.onPitch();
    });
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
