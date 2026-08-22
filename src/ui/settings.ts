import { mix, play, setMix } from '../core/audio';
import type { Mix } from '../core/audio';
import { saveMix } from '../core/settings';

/**
 * Настройки: шестерня в углу и попап поверх сцены (§6 — UI это DOM над
 * канвасом; §18.5 — где живёт громкость).
 *
 * Отдельного экрана нет намеренно. Громкость выкручивают не до игры, а во
 * время: рядом кто-то спит, приехал лифт, началась вылазка. Значит кнопка
 * обязана быть на месте всегда — и на заставке, и в лагере, и в вылазке, —
 * а окно обязано открываться поверх того, что игрок уже делает.
 *
 * Здесь же «Новая игра». Она стояла в дев-меню, но сброс нужен и игроку:
 * сейв переживает перезагрузку, и стереть его из консоли нельзя — игра тут
 * же запишет его обратно. Кнопка спрашивает подтверждение: это единственное
 * необратимое действие в игре.
 */
export interface SettingsMenuCallbacks {
  onNewGame(): void;
}

/**
 * Шестерня. Восемь зубьев прямыми гранями, без скруглений и полутонов —
 * то же плоское затенение, что и у всего остального в игре (§6.1).
 * Дырка в середине вырезана чётным правилом заливки, а не подложкой цвета:
 * под кнопкой сцена, и любой сплошной кружок читался бы как пятно.
 */
const GEAR = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" fill-rule="evenodd" d="M10.02,4.87L9.80,1.63L14.20,1.63L13.98,4.87L15.64,5.56L17.77,3.11L20.89,6.23L18.44,8.36L19.13,10.02L22.37,9.80L22.37,14.20L19.13,13.98L18.44,15.64L20.89,17.77L17.77,20.89L15.64,18.44L13.98,19.13L14.20,22.37L9.80,22.37L10.02,19.13L8.36,18.44L6.23,20.89L3.11,17.77L5.56,15.64L4.87,13.98L1.63,14.20L1.63,9.80L4.87,10.02L5.56,8.36L3.11,6.23L6.23,3.11L8.36,5.56Z M12,8.4A3.6,3.6 0 1 0 12,15.6A3.6,3.6 0 1 0 12,8.4Z"/>
</svg>`;

/** Ползунки. Порядок тот же, что в §18.5: общая, потом три шины. */
const KNOBS: readonly { readonly key: keyof Mix; readonly name: string }[] = [
  { key: 'master', name: 'Громкость' },
  { key: 'sfx', name: 'Бой' },
  { key: 'ui', name: 'Интерфейс' },
  { key: 'amb', name: 'Амбиент' },
];

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export class SettingsMenu {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly acts: HTMLElement;

  constructor(parent: HTMLElement, cb: SettingsMenuCallbacks) {
    this.button = document.createElement('button');
    this.button.id = 'settings-open';
    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'Настройки');
    this.button.innerHTML = GEAR;
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'settings';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2>Настройки</h2>
        <div class="set-rows">
          ${KNOBS.map(
            (k) => `
          <label class="set-row">
            <span class="lbl">${k.name}</span>
            <input type="range" min="0" max="100" step="5" data-knob="${k.key}">
            <b data-out="${k.key}"></b>
          </label>`,
          ).join('')}
        </div>
        <p class="sp-note">Амбиент глушится отдельно: пульс провианта идёт по шине боя и останется слышен.</p>
        <p class="sp-note">Значки интерфейса — SunGraphica, CC BY 4.0.</p>
        <div class="acts"></div>
      </div>`;
    parent.appendChild(this.overlay);
    this.acts = this.overlay.querySelector('.acts') as HTMLElement;

    this.button.addEventListener('click', () => this.open());
    // Тап по затемнению — тот же выход. Окно ничего не решает за игрока,
    // и держать его открытым до кнопки «Закрыть» незачем.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.overlay.addEventListener('input', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      const key = el.dataset.knob as keyof Mix | undefined;
      if (key === undefined) return;
      // Слышно сразу, пока палец на ползунке: громкость настраивают ухом.
      setMix({ ...mix(), [key]: Number(el.value) / 100 });
      this.paint();
    });

    // Запись — по отпусканию: сохранять каждый пиксель протяга значило бы
    // писать в хранилище по сорок раз на одно движение.
    this.overlay.addEventListener('change', (e) => {
      if (!(e.target instanceof HTMLInputElement)) return;
      saveMix(mix());
      play('tap');
    });

    this.acts.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      const act = e.target.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'new') this.setConfirming(true);
      else if (act === 'cancel') this.setConfirming(false);
      else if (act === 'wipe') cb.onNewGame();
    });

    this.setConfirming(false);
  }

  private open(): void {
    this.setConfirming(false);
    this.paint();
    this.overlay.classList.add('on');
  }

  private close(): void {
    this.overlay.classList.remove('on');
  }

  /** Ползунки и подписи по текущему микшеру — окно всегда открывается на нём. */
  private paint(): void {
    const now = mix();
    for (const { key } of KNOBS) {
      const value = now[key];
      const slider = this.overlay.querySelector(`[data-knob="${key}"]`);
      if (slider instanceof HTMLInputElement) {
        const step = String(Math.round(value * 100));
        if (slider.value !== step) slider.value = step;
      }
      const out = this.overlay.querySelector(`[data-out="${key}"]`);
      if (out !== null) out.textContent = pct(value);
    }
  }

  /**
   * Второй шаг «Новой игры». Спрашивается прямо в той же строке, а не окном
   * поверх окна: вопрос один, и ответ на него — соседняя кнопка.
   */
  private setConfirming(on: boolean): void {
    this.acts.innerHTML = on
      ? `<p class="warn">Лагерь, отряд и запасы будут стёрты.</p>
         <button type="button" class="danger" data-act="wipe">Стереть и начать заново</button>
         <button type="button" class="ghost" data-act="cancel">Отмена</button>`
      : `<button type="button" data-act="new">Новая игра</button>
         <button type="button" class="ghost" data-act="close">Закрыть</button>`;
  }
}
