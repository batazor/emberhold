import { RESIDENT_ORDERS, hasRoof, residentLook } from '../sim/residents';
import type { ResidentOrder } from '../sim/residents';
import type { CampState } from '../sim/camp';
import { avatarSvg } from './avatar';
import { revealCard } from './cardReveal';
import { gameMessage, setGameText } from '../i18n/game';
import { residentJobMessage, residentOrderMessage } from '../i18n/gameData';

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
 * **Карточка — приказы, разбор живёт отдельно.** Тап по жильцу открывает
 * меню: шапку, приказы и команду «О персонаже». Команда открывает страницу
 * персонажа (`features/character`) — тот же экран, что у героя, и это
 * не уступка единообразию: занятие, снаряжение и то, что уровня у жильца
 * нет, читаются там на целом экране, а не в 172 пикселя.
 *
 * Ответ со знакомства на страницу не пишется: приказ переписывает `answer`
 * (`assignWork`), и «что он сказал о себе» после первой же смены занятия
 * было бы враньём.
 */
export interface ResidentCardCallbacks {
  onOrder(index: number, order: ResidentOrder): void;
  /** Открыть страницу персонажа на этом жильце (`features/character`). */
  onAbout(index: number): void;
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
      <div class="r-acts" id="rc-acts"></div>
      <div class="r-acts"><button id="rc-about"></button></div>`;
    this.face = this.root.querySelector('#rc-face')!;
    this.name = this.root.querySelector('#rc-name')!;
    this.status = this.root.querySelector('#rc-status')!;
    this.acts = this.root.querySelector('#rc-acts')!;
    const about = this.root.querySelector<HTMLButtonElement>('#rc-about')!;
    setGameText(about, gameMessage('О персонаже', 'View character'));
    about.addEventListener('click', () => {
      this.cb.onAbout(this.shown);
    });
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  /** Открыть меню приказов на жильце: шапка и кнопки. */
  showMenu(): void {
    // Растворение — только на появление из скрытого состояния: при
    // перелистывании жильцов уже видимая карточка не мерцает заново.
    const wasHidden = this.root.style.display === 'none';
    this.root.style.display = 'flex';
    if (wasHidden) revealCard(this.root);
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
    const faceKey = `${residentLook(r)}:${r.seed}`;
    if (faceKey !== this.faceKey) {
      this.faceKey = faceKey;
      this.face.innerHTML = avatarSvg(residentLook(r), r.seed);
    }
    this.name.textContent = window.EmberholdLanguage?.translate(r.name) ?? r.name;
    const roofed = hasRoof(camp, this.shown);
    // Занятие видно всегда, крыша — только когда её нет: строка о том,
    // что мешает, а не перечень свойств.
    if (!roofed) setGameText(this.status, gameMessage('без крыши', 'without shelter'));
    else if (r.hunt !== undefined) setGameText(this.status, gameMessage('на охоте', 'hunting'));
    else if (r.rest) setGameText(this.status, gameMessage('отдыхает', 'resting'));
    else setGameText(this.status, residentJobMessage[r.answer]);
    this.status.className = roofed ? 'good' : 'dim';

    this.acts.replaceChildren(
      ...RESIDENT_ORDERS.map((order) => {
        const b = document.createElement('button');
        setGameText(b, residentOrderMessage[order]);
        // Выключена кнопка происходящего: у отдыхающего — «Отдыхать»,
        // у работающего — его занятие.
        b.disabled = r.hunt !== undefined || (order === 'отдых' ? r.rest : !r.rest && r.answer === order);
        b.addEventListener('click', () => this.cb.onOrder(this.shown, order));
        return b;
      }),
    );
  }
}
