import { RESIDENT_ORDER, RESIDENT_ORDERS, hasRoof, residentState } from '../sim/residents';
import type { ResidentOrder } from '../sim/residents';
import type { CampState } from '../sim/camp';
import { avatarSvg } from './avatar';

/**
 * Карточка выбранного жильца — сестра карточки героя (`heroCard.ts`) и то,
 * ради чего жильцы встали в веер: лицо отвечает «кто это», карточка —
 * «чем занят и что ему приказать».
 *
 * Приказов три (`residents.ts`): два занятия — носить дерево или носить
 * камень — и «отдыхать», то есть отложить инструмент. Кнопка текущего
 * состояния выключена — приказ, повторяющий происходящее, не приказ.
 * Что приказ исполнен, видно по руке жильца в кадре: занятие держит
 * инструмент (§6.1.14), отдых — пустые ладони.
 *
 * Про крышу карточка говорит состоянием, а не отказом: без крыши жилец
 * за работу не берётся (`workDone`), но приказ принять может — займётся,
 * как только крыша появится. Запирать расписание за палаткой значило бы
 * прятать само расписание.
 */
export interface ResidentCardCallbacks {
  onOrder(index: number, order: ResidentOrder): void;
}

export class ResidentCard {
  private readonly root: HTMLElement;
  private readonly face: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly acts: HTMLElement;
  private shown = 0;
  /** Чьё лицо нарисовано: карточка обновляется чаще, чем меняется жилец. */
  private faceKey = '';

  constructor(parent: HTMLElement, private readonly cb: ResidentCardCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'resident-card';
    this.root.className = 'panel';
    // Лицо — то же, что в веере и в знакомстве (§11.8): жилец пришёл в лагерь
    // с этим лицом, и карточка обязана показывать того же человека.
    this.root.innerHTML = `
      <div class="r-id"><span class="face" id="rc-face"></span>
        <span><b id="rc-name"></b><span id="rc-status" class="dim"></span></span></div>
      <div class="r-acts" id="rc-acts"></div>`;
    this.face = this.root.querySelector('#rc-face')!;
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
    const faceKey = `${r.look}:${r.seed}`;
    if (faceKey !== this.faceKey) {
      this.faceKey = faceKey;
      this.face.innerHTML = avatarSvg(r.look, r.seed);
    }
    this.name.textContent = r.name;
    const roofed = hasRoof(camp, this.shown);
    // Занятие видно всегда, крыша — только когда её нет: строка о том,
    // что мешает, а не перечень свойств.
    this.status.textContent = roofed ? residentState(r) : 'без крыши';
    this.status.className = roofed ? 'good' : 'dim';

    this.acts.replaceChildren(
      ...RESIDENT_ORDERS.map((order) => {
        const b = document.createElement('button');
        b.textContent = RESIDENT_ORDER[order];
        // Выключена кнопка происходящего: у отдыхающего — «Отдыхать»,
        // у работающего — его занятие.
        b.disabled = order === 'отдых' ? r.rest : !r.rest && r.answer === order;
        b.addEventListener('click', () => this.cb.onOrder(this.shown, order));
        return b;
      }),
    );
  }
}
