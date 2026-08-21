import { RESIDENT_ORDER, RESIDENT_STATE, hasRoof } from '../sim/residents';
import { SELF_ANSWERS } from '../sim/settler';
import type { SelfAnswer } from '../sim/settler';
import type { CampState } from '../sim/camp';

/**
 * Карточка выбранного жильца — сестра карточки героя (`heroCard.ts`) и то,
 * ради чего жильцы встали в веер: лицо отвечает «кто это», карточка —
 * «чем занят и что ему приказать».
 *
 * Приказов ровно столько, сколько занятий у жильца (`residents.ts`):
 * носить дерево или носить камень. Кнопка текущего занятия выключена —
 * приказ, повторяющий происходящее, не приказ.
 *
 * Про крышу карточка говорит состоянием, а не отказом: без крыши жилец
 * за работу не берётся (`workDone`), но приказ принять может — займётся,
 * как только крыша появится. Запирать расписание за палаткой значило бы
 * прятать само расписание.
 */
export interface ResidentCardCallbacks {
  onOrder(index: number, answer: SelfAnswer): void;
}

export class ResidentCard {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly acts: HTMLElement;
  private shown = 0;

  constructor(parent: HTMLElement, private readonly cb: ResidentCardCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'resident-card';
    this.root.className = 'panel';
    this.root.innerHTML = `
      <div class="row r-top"><b id="rc-name"></b><span id="rc-status" class="dim"></span></div>
      <div class="r-acts" id="rc-acts"></div>`;
    this.name = this.root.querySelector('#rc-name')!;
    this.status = this.root.querySelector('#rc-status')!;
    this.acts = this.root.querySelector('#rc-acts')!;
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Отступ снизу: карточка стоит над нижней строкой лагеря, как и веер. */
  setBottom(px: number): void {
    this.root.style.bottom = `${px}px`;
  }

  sync(camp: CampState, index: number): void {
    this.shown = Math.min(Math.max(0, index), camp.residents.length - 1);
    const r = camp.residents[this.shown];
    if (r === undefined) {
      this.setVisible(false);
      return;
    }
    this.name.textContent = r.name;
    const roofed = hasRoof(camp, this.shown);
    // Занятие видно всегда, крыша — только когда её нет: строка о том,
    // что мешает, а не перечень свойств.
    this.status.textContent = roofed ? RESIDENT_STATE[r.answer] : 'без крыши';
    this.status.className = roofed ? 'good' : 'dim';

    this.acts.replaceChildren(
      ...SELF_ANSWERS.map((answer) => {
        const b = document.createElement('button');
        b.textContent = RESIDENT_ORDER[answer];
        b.disabled = r.answer === answer;
        b.addEventListener('click', () => this.cb.onOrder(this.shown, answer));
        return b;
      }),
    );
  }
}
