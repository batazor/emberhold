import { mix, play, setMix } from '../core/audio';
import type { Mix } from '../core/audio';
import { saveMix } from '../core/settings';
import { setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages, type GameMessage } from '../i18n/gameMessages';

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
 *
 * И здесь же «Летопись» (`statsPanel.ts`). Раньше сводку открывала кнопка
 * «Данные», прибитая к правому краю лагеря: постоянное место под то, что
 * смотрят раз в сессию. Настройки — то же самое по природе: не ход, а взгляд
 * на игру со стороны, и открываются они оттуда же, из угла с шестерней.
 */
export interface SettingsMenuCallbacks {
  onNewGame(): void;
  /** Сводка телеметрии (§9): окно открывает тот, кто им владеет. */
  onStats(): void;
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
const KNOBS: readonly { readonly key: keyof Mix; readonly name: GameMessage }[] = [
  { key: 'master', name: gameMessages.settingsMaster },
  { key: 'sfx', name: gameMessages.settingsCombat },
  { key: 'ui', name: gameMessages.settingsInterface },
  { key: 'amb', name: gameMessages.settingsAmbient },
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
    setGameAttribute(this.button, 'aria-label', gameMessages.settingsOpen);
    this.button.innerHTML = GEAR;
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'settings';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2></h2>
        <div class="set-language">
          <span class="lbl" data-language-label></span>
          <div class="language-toggle" translate="no" role="group" aria-label="Language">
            <button type="button" data-lang="en" class="${window.EmberholdLanguage?.current !== 'ru' ? 'on' : ''}" aria-pressed="${window.EmberholdLanguage?.current !== 'ru'}">EN</button>
            <button type="button" data-lang="ru" class="${window.EmberholdLanguage?.current === 'ru' ? 'on' : ''}" aria-pressed="${window.EmberholdLanguage?.current === 'ru'}">RU</button>
          </div>
        </div>
        <div class="set-rows">
          ${KNOBS.map(
            (k) => `
          <label class="set-row">
            <span class="lbl" data-label="${k.key}"></span>
            <input type="range" min="0" max="100" step="5" data-knob="${k.key}">
            <b data-out="${k.key}"></b>
          </label>`,
          ).join('')}
        </div>
        <p class="sp-note"></p>
        <div class="acts"></div>
      </div>`;
    parent.appendChild(this.overlay);
    this.acts = this.overlay.querySelector('.acts') as HTMLElement;
    setGameText(this.overlay.querySelector('h2') as HTMLElement, gameMessages.settingsTitle);
    setGameText(this.overlay.querySelector('[data-language-label]') as HTMLElement, gameMessages.settingsLanguage);
    for (const knob of KNOBS) {
      setGameText(this.overlay.querySelector(`[data-label="${knob.key}"]`) as HTMLElement, knob.name);
    }
    setGameText(this.overlay.querySelector('.sp-note') as HTMLElement, gameMessages.settingsAmbientNote);

    this.button.addEventListener('click', () => this.open());
    // Тап по затемнению — тот же выход. Окно ничего не решает за игрока,
    // и держать его открытым до кнопки «Закрыть» незачем.
    this.overlay.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement && (e.target.dataset.lang === 'en' || e.target.dataset.lang === 'ru')) {
        window.EmberholdLanguage?.set(e.target.dataset.lang);
        return;
      }
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
      // Настройки уходят с экрана: сводка — окно во весь лист, и держать
      // под ней ещё одно значило бы копить окна поверх окон.
      else if (act === 'stats') {
        this.close();
        cb.onStats();
      } else if (act === 'new') this.setConfirming(true);
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
      ? `<p class="warn"></p>
         <button type="button" class="danger" data-act="wipe"></button>
         <button type="button" class="ghost" data-act="cancel"></button>`
      : `<button type="button" data-act="stats"></button>
         <button type="button" data-act="new"></button>
         <button type="button" class="ghost" data-act="close"></button>`;
    if (on) {
      setGameText(this.acts.querySelector('.warn') as HTMLElement, gameMessages.settingsEraseWarning);
      setGameText(this.acts.querySelector('[data-act="wipe"]') as HTMLButtonElement, gameMessages.settingsErase);
      setGameText(this.acts.querySelector('[data-act="cancel"]') as HTMLButtonElement, gameMessages.settingsCancel);
    } else {
      setGameText(this.acts.querySelector('[data-act="stats"]') as HTMLButtonElement, gameMessages.settingsChronicle);
      setGameText(this.acts.querySelector('[data-act="new"]') as HTMLButtonElement, gameMessages.settingsNewGame);
      setGameText(this.acts.querySelector('[data-act="close"]') as HTMLButtonElement, gameMessages.settingsClose);
    }
  }
}
