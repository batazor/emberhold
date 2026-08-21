/**
 * Конец пролога (§16.1): дерево собрано (или вышел провиант), и герой встаёт
 * лагерем там, где стоит.
 *
 * Одна строка и одна кнопка, как на заставке (§6 — UI это DOM над канвасом).
 * Окна с «Понятно» здесь нет намеренно: раскадровка запрещает их на всём
 * протяжении обучения, а решение тут ровно одно, и отказаться от него нельзя.
 *
 * **Живёт внутри нижней панели вылазки, а не отдельным слоем (§6.2.6).**
 * Своим `position: fixed` приглашение приходило четвёртой коробкой в нижний
 * угол и в конце пролога налезало на подсказку: «Разбить лагерь» и «Соберите
 * бруски» спорили за одни пиксели. Родитель ему теперь даёт `Hud.promptSlot`,
 * и обе строки стоят в одном столбце.
 */
export interface CampPromptCallbacks {
  onPitch(): void;
  /**
   * Приглашение появилось или ушло. Через это HUD узнаёт, уступать ли место
   * подсказке и кнопкам (§6.2.6).
   *
   * Callback, а не три вызова на местах: гасят приглашение уже из трёх точек,
   * и одна из них про это забыла — вылазка после неё шла без подсказки
   * и без кнопок. Забыть здесь больше негде.
   */
  onShown(visible: boolean): void;
}

export class CampPrompt {
  private readonly root: HTMLElement;
  private readonly reason: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: CampPromptCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'pitch';
    // Строка — та же `.chip`, что и подсказка вылазки: они стоят в одном
    // месте столбца и никогда одновременно, значит и выглядеть обязаны
    // одним объектом. Под ними светлая листва поляны, и одной тени
    // для контраста не хватало.
    this.root.innerHTML = `
      <p class="chip" data-role="reason">Дерево собрано</p>
      <button class="cta" data-act="pitch">Разбить лагерь</button>`;
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    const reason = this.root.querySelector('[data-role="reason"]');
    if (!(reason instanceof HTMLElement)) throw new Error('нет строки повода');
    this.reason = reason;

    this.root.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      cb.onPitch();
    });
  }

  /**
   * Чем кончилась прогулка. Строка не декоративная: поводов два — собранное
   * дерево и кончившийся провиант, — и назвать не тот значит соврать игроку
   * о том, что он только что сделал.
   */
  setReason(text: string): void {
    this.reason.textContent = text;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    this.cb.onShown(visible);
  }
}
