import { RESIDENT_ORDER, RESIDENT_ORDERS, RESIDENT_WORK, hasRoof, residentState } from '../sim/residents';
import type { ResidentOrder } from '../sim/residents';
import { RESOURCE_NAME } from '../sim/resources';
import type { Offhand } from '../sim/gear';
import type { CampState } from '../sim/camp';
import { avatarSvg } from './avatar';
import { revealCard } from './cardReveal';
import { GearSection } from './gearSection';

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
 *
 * **Два состояния, как у героя.** Тап по жильцу открывает меню — шапку
 * с приказами и командой «О персонаже», — а разбор раскрывается этой
 * командой. В разборе — механика занятия: что жилец приносит и чем это
 * держится. Ответ со знакомства сюда не пишется: приказ переписывает
 * `answer` (`assignWork`), и «что он сказал о себе» после первой же смены
 * занятия было бы враньём. Закрытие возвращает меню: чужому жильцу
 * не показывают разбор предыдущего.
 *
 * **Снаряжение — то же, что у героя** (`gearSection.ts`): механика едина,
 * комплект один на лагерь, и жилец отличается только тем, что в мир
 * не ходит. Смотреть слоты и перекладывать левую руку он вправе так же.
 */
export interface ResidentCardCallbacks {
  onOrder(index: number, order: ResidentOrder): void;
  /** §14.2 — тот же выбор, что в карточке героя и «Припасах»: рука одна. */
  onOffhand(hand: Offhand): void;
}

export class ResidentCard {
  private readonly root: HTMLElement;
  private readonly face: HTMLElement;
  private readonly name: HTMLElement;
  private readonly status: HTMLElement;
  private readonly acts: HTMLElement;
  private readonly aboutRow: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly gear: GearSection;
  /** Меню или разбор: разбор открывается только командой «О персонаже». */
  private mode: 'menu' | 'full' = 'menu';
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
      <div class="r-acts" id="rc-acts"></div>
      <div class="r-acts" id="rc-about-row"><button id="rc-about">О персонаже</button></div>
      <div class="r-meta" id="rc-meta"></div>`;
    this.face = this.root.querySelector('#rc-face')!;
    this.name = this.root.querySelector('#rc-name')!;
    this.status = this.root.querySelector('#rc-status')!;
    this.acts = this.root.querySelector('#rc-acts')!;
    this.aboutRow = this.root.querySelector('#rc-about-row')!;
    this.meta = this.root.querySelector('#rc-meta')!;
    // Секция общая с карточкой героя (`gearSection.ts`): механика едина.
    this.gear = new GearSection((hand) => this.cb.onOffhand(hand));
    this.root.appendChild(this.gear.el);
    this.root.querySelector('#rc-about')!.addEventListener('click', () => {
      this.mode = 'full';
      this.applyMode();
    });
    this.applyMode();
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  /** Открыть меню приказов на жильце: шапка и кнопки, без разбора. */
  showMenu(): void {
    this.mode = 'menu';
    this.applyMode();
    // Растворение — только на появление из скрытого состояния: при
    // перелистывании жильцов уже видимая карточка не мерцает заново.
    const wasHidden = this.root.style.display === 'none';
    this.root.style.display = 'flex';
    if (wasHidden) revealCard(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    // Спрятанная карточка сворачивается: следующий тап по лицу открывает
    // меню, а не разбор того, кого смотрели в прошлый раз.
    if (!visible && this.mode !== 'menu') {
      this.mode = 'menu';
      this.applyMode();
    }
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Отступ снизу: карточка стоит над нижней строкой лагеря, как и веер. */
  setBottom(px: number): void {
    this.root.style.bottom = `${px}px`;
  }

  /** Разбор виден только в полном режиме, приказы и «О персонаже» — в меню. */
  private applyMode(): void {
    const full = this.mode === 'full';
    this.acts.style.display = full ? 'none' : 'flex';
    this.aboutRow.style.display = full ? 'none' : 'flex';
    this.meta.style.display = full ? '' : 'none';
    this.gear.el.style.display = full ? '' : 'none';
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

    // Разбор — механика занятия (`RESIDENT_WORK`), а не выдуманная
    // биография: больше о жильце игра ничего не записывает. Занятие
    // отдых не стирает, поэтому строка честна и для отдыхающего.
    const carry = RESOURCE_NAME[RESIDENT_WORK[r.answer]].toLowerCase();
    this.meta.textContent =
      `Занятие: носит ${carry} — прибавка в кладовую, пока есть крыша`;

    // Карточка жильца лагерь и так держит в руках — снаряжение берётся
    // из него напрямую, в отличие от карточки героя, куда оно приходит
    // параметрами.
    this.gear.sync(camp.gear, camp.offhand);

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
