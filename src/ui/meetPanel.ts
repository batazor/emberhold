/**
 * Знакомство у прогалины (`sim/settler.ts`).
 *
 * **Не окно.** Панель стоит внизу, как приглашение разбить лагерь (§16.1)
 * и как лавка торговца (§13.5), и по той же причине: разговор случается
 * там, где игрок стоит, а не на отдельном экране поверх него. Кнопки
 * «закрыть» нет — отойти можно в любой момент, и разговор гаснет сам.
 *
 * **Реплика — одна строка и не длиннее.** Раскадровка запрещает окна
 * с «Понятно» на всём обучении, и абзац с кнопкой — то же окно, только
 * без рамки. Кадров четыре, тапов столько же.
 *
 * **Поле открывается заполненным.** Это единственная клавиатура в игре,
 * и появляться она обязана уже с ответом: кто не хочет печатать, принимает
 * подставленное имя тапом и не печатает ни буквы. Форма от этого не
 * возникает — возникает согласие.
 */
import { MAX_NAME, SELF_ANSWERS, SELF_HINT, SELF_LABEL, giftLine, giftOf } from '../sim/settler';
import type { MeetState, SelfAnswer, Settler } from '../sim/settler';
import { avatarSvg } from './avatar';

export interface MeetPanelCallbacks {
  /** Игрок принял имя — своё или подставленное. */
  onName(name: string): void;
  onAnswer(answer: SelfAnswer): void;
  /** Кадр без выбора: игрок просто идёт дальше по разговору. */
  onAdvance(): void;
  onInvite(): void;
}

export class MeetPanel {
  private readonly root: HTMLElement;
  /**
   * Лицо собеседника (`ui/avatar.ts`). Выводится из сида поселенца — того же,
   * с которым он войдёт в лагерь и встанет в веер: человек ходит по игре
   * с одним лицом, иначе лицо ничего не значит.
   */
  private readonly face: HTMLElement;
  private readonly line: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly goods: HTMLElement;
  private readonly buttons: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: MeetPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'meet';
    this.root.style.display = 'none';

    this.face = document.createElement('div');
    this.face.className = 'face';

    this.line = document.createElement('p');
    this.line.className = 'panel say';

    this.field = document.createElement('input');
    this.field.type = 'text';
    this.field.maxLength = MAX_NAME;
    this.field.autocomplete = 'off';
    this.field.spellcheck = false;
    this.field.style.display = 'none';
    // Enter принимает имя ровно так же, как кнопка: на клавиатуре телефона
    // «готово» стоит под большим пальцем, и заставлять после него целиться
    // в кнопку значило бы требовать два жеста там, где игрок сделал один.
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.cb.onName(this.field.value);
    });

    this.goods = document.createElement('p');
    this.goods.className = 'panel goods';
    this.goods.style.display = 'none';

    this.buttons = document.createElement('div');
    this.buttons.className = 'acts';

    this.root.append(this.face, this.line, this.field, this.goods, this.buttons);
    parent.appendChild(this.root);
  }

  /**
   * Перерисовать под шаг разговора. Панель не держит своего состояния:
   * шаг живёт в симуляции, а здесь остаётся то, что из него видно.
   */
  show(settler: Settler, state: MeetState): void {
    this.root.style.display = state.step === 'кончено' ? 'none' : 'flex';
    if (state.step === 'кончено') return;

    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'none';
    // Лицо рисуется на смену человека, а не на каждый кадр разговора:
    // разметка та же, и перекладывать её четыре раза подряд незачем.
    const face = `${settler.look}/${settler.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg(settler.look, settler.seed);
    }

    if (state.step === 'он') {
      this.line.textContent = `— Я ${settler.name}.`;
      this.act('Назваться', () => this.cb.onAdvance());
      return;
    }

    if (state.step === 'ты') {
      this.line.textContent = '— А тебя как звать?';
      this.field.style.display = 'block';
      // Значение ставится только на входе в кадр: перетирать его на каждой
      // перерисовке значило бы стирать то, что игрок печатает.
      if (this.field.dataset.step !== 'ты') {
        this.field.value = state.heroName;
        this.field.dataset.step = 'ты';
      }
      this.act('Так и звать', () => this.cb.onName(this.field.value));
      return;
    }

    if (state.step === 'вопрос') {
      this.field.dataset.step = '';
      this.line.textContent = `— ${state.heroName}. Чем у вас там живут?`;
      for (const answer of SELF_ANSWERS) {
        this.act(SELF_LABEL[answer], () => this.cb.onAnswer(answer), SELF_HINT[answer]);
      }
      return;
    }

    const gift = giftOf(state);
    this.line.textContent = gift === null ? '— Возьми, что есть.' : '— Возьми, что было.';
    // Дар отдельной строкой, а не внутри реплики: это перечень с числами,
    // и в кавычках прямой речи он читался бы репликой, которую человек
    // произносит вслух.
    this.goods.textContent = gift === null ? '' : giftLine(gift);
    this.goods.style.display = gift === null ? 'none' : 'block';
    this.act('Позвать с собой', () => this.cb.onInvite());
  }

  /** Фокус в поле — отдельным вызовом: телефон открывает клавиатуру только
   *  по жесту игрока, и дёргать её на каждой перерисовке нельзя. */
  focusName(): void {
    this.field.focus();
    this.field.select();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.field.dataset.step = '';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  private act(label: string, onClick: () => void, hint?: string): void {
    const button = document.createElement('button');
    button.textContent = label;
    // Пояснение внутри кнопки, а не рядом: выбор и его цена — одно касание.
    if (hint !== undefined) {
      const sub = document.createElement('small');
      sub.textContent = hint;
      button.append(sub);
    }
    button.addEventListener('click', onClick);
    this.buttons.append(button);
  }
}
