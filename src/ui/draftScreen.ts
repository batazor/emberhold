/**
 * Драфт сборов (§19): экран между выбором точки на карте и входом в локацию.
 *
 * Три карты, три разные оси, выбрать обязательно. **Кнопки «пропустить» нет
 * намеренно** — §19.1 запрещает переброс, а пропуск это тот же переброс,
 * растянутый на две вылазки: игрок ходил бы без карты, пока не выпадет
 * привычная. Отказ здесь стоил бы ровно того же, что и рулетка.
 *
 * Цена карты стоит на самой карте и до нажатия (§1): «даёт» и «платит» —
 * две строки, а не одна. Карта без цены честно молчит вместо прочерка:
 * пустая строка «платит: —» читается как «цена будет позже».
 */
import { AXIS_NAME, DRAFT } from '../sim/draft';
import type { DraftCardId } from '../sim/draft';

export interface DraftCallbacks {
  onChoose(id: DraftCardId): void;
}

export class DraftScreen {
  private readonly root: HTMLElement;
  private readonly cards: HTMLElement;
  private hand: DraftCardId[] = [];

  constructor(parent: HTMLElement, private readonly cb: DraftCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'draft';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="panel">
        <h2>Сборы</h2>
        <p class="dim">Одна карта на эту вылазку. Перебросить нельзя.</p>
        <div class="cards"></div>
      </div>`;
    parent.appendChild(this.root);

    const cards = this.root.querySelector('.cards');
    if (!(cards instanceof HTMLElement)) throw new Error('нет ряда карт');
    this.cards = cards;

    // Слушатель один на живой контейнер: карточки перерисовываются каждую
    // раздачу, и вешать обработчик на каждую значило бы копить их.
    this.cards.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      const id = button.dataset['card'] as DraftCardId | undefined;
      if (id === undefined || !this.hand.includes(id)) return;
      this.hide();
      this.cb.onChoose(id);
    });
  }

  show(hand: readonly DraftCardId[]): void {
    this.hand = [...hand];
    this.cards.innerHTML = '';
    for (const id of this.hand) {
      const c = DRAFT[id];
      const button = document.createElement('button');
      button.className = 'card';
      button.dataset['card'] = id;
      // Ось названа на карте: §19.1 обещает три разные оси в раздаче,
      // и обещание это видно только если ось подписана.
      button.innerHTML =
        `<i class="axis">${AXIS_NAME[c.axis]}</i>` +
        `<b>${c.name}</b>` +
        `<span class="gives">${c.gives}</span>` +
        (c.costs === '' ? '' : `<span class="costs">${c.costs}</span>`);
      this.cards.appendChild(button);
    }
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }
}
