import { BUILDINGS } from '../sim/camp';
import { clearTelemetry, events, summarize } from '../sim/telemetry';

/**
 * §9 — данные должны быть читаемыми, иначе телеметрия пишется в никуда.
 * Сервера в v0 нет, поэтому сводка показывается прямо в игре, а сырые события
 * выгружаются в буфер обмена — оттуда их можно унести в таблицу.
 *
 * Каждая строка снабжена целевым значением из документа: цифра без ориентира
 * не решение, а повод для спора.
 */
const pct = (x: number): string => `${Math.round(x * 100)}%`;

export class StatsPanel {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;

  constructor(parent: HTMLElement) {
    this.button = document.createElement('button');
    this.button.id = 'stats-open';
    this.button.textContent = 'Данные';
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'stats-panel';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2>Телеметрия</h2>
        <div id="sp-body"></div>
        <div class="acts">
          <button id="sp-copy">Скопировать события</button>
          <button id="sp-clear" class="ghost">Очистить</button>
          <button id="sp-close" class="ghost">Закрыть</button>
        </div>
      </div>`;
    parent.appendChild(this.overlay);
    this.body = this.overlay.querySelector('#sp-body') as HTMLElement;

    this.button.addEventListener('click', () => this.open());
    this.overlay.querySelector('#sp-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#sp-clear')?.addEventListener('click', () => {
      clearTelemetry();
      this.render();
    });
    this.overlay.querySelector('#sp-copy')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(events(), null, 2));
    });
  }

  setVisible(visible: boolean): void {
    this.button.style.display = visible ? 'block' : 'none';
    if (!visible) this.close();
  }

  private open(): void {
    this.render();
    this.overlay.classList.add('on');
  }

  private close(): void {
    this.overlay.classList.remove('on');
  }

  private render(): void {
    const s = summarize(events());
    if (s.raids === 0) {
      this.body.innerHTML = '<p class="dim">Ещё ни одной завершённой вылазки.</p>';
      return;
    }

    const rows: [string, string, string][] = [
      ['Вылазок', String(s.raids), ''],
      // Ориентира у доли провалов больше нет: соотношение причин «провиант
      // против боя» снято с действия вместе с §11.3, и подписывать цифру
      // целью, которой не существует, значит спорить с самим собой.
      ['Провалов', pct(s.failRate), 'как часто вылазка не доходит домой'],
      ['Урона за вылазку', s.avgDamageTaken.toFixed(1), 'бой стоит очков, а не времени'],
      ['Стычек за вылазку', s.avgFights.toFixed(1), 'сколько раз пришлось драться'],
      [
        'Глубина выхода',
        pct(s.avgDepthShare),
        s.avgDepthShare < 0.5
          ? 'ниже половины — похоже на «эвакуируются слишком рано» (§9)'
          : 'доля локации до разворота',
      ],
      ['Вынесено за вылазку', s.avgCarried.toFixed(1), ''],
      ['Потеряно за вылазку', s.avgLost.toFixed(1), ''],
      ['Покупка была доступна', pct(s.buyOfferRate), 'цель 60–80% возвратов — §20.1'],
      ['Из них выбрали стройку', pct(s.buyTakeRate), 'подмена главного действия'],
      [
        'Построено первым',
        s.firstBuilding === null ? '—' : BUILDINGS[s.firstBuilding].name,
        '',
      ],
      [
        'Возврат после таймера',
        s.medianReturnMin === null ? '—' : `${s.medianReturnMin.toFixed(0)} мин`,
        'медиана; сравнивать с лестницей §20.2',
      ],
      [
        'Выходы из сессии',
        `вылазка ${s.exits.raid} · лагерь ${s.exits.camp} · возврат ${s.exits.return}`,
        '',
      ],
    ];

    this.body.innerHTML = rows
      .map(
        ([name, value, note]) =>
          `<div class="row sp-row"><span class="lbl">${name}</span><b>${value}</b></div>` +
          (note === '' ? '' : `<div class="sp-note">${note}</div>`),
      )
      .join('');
  }
}
