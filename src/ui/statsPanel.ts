import { BUILDINGS } from '../sim/camp';
import type { CampState } from '../sim/camp';
import { neighboursOpen } from '../sim/clan';
import { standings } from '../sim/standing';
import { clearTelemetry, events, summarize } from '../sim/telemetry';

/**
 * §9 — данные должны быть читаемыми, иначе телеметрия пишется в никуда.
 * Сервера в v0 нет, поэтому сводка показывается прямо в игре, а сырые события
 * выгружаются в буфер обмена — оттуда их можно унести в таблицу.
 *
 * Каждая строка снабжена целевым значением из документа: цифра без ориентира
 * не решение, а повод для спора.
 *
 * Своей кнопки на экране у панели нет: «Статистика» стоит в настройках
 * (`settings.ts`), рядом с громкостью и «Новой игрой». Кнопка «Данные»
 * держала правый край лагеря — постоянное место под то, что открывают раз
 * в сессию, и строка задания ужималась, чтобы её не накрыть. Открывает
 * панель тот, кто ей владеет, — здесь только `open`.
 */
const pct = (x: number): string => `${Math.round(x * 100)}%`;

export class StatsPanel {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  /** Таблица лагерей (§30). Стоит выше сводки: она про мир, а сводка —
   *  про то, как игрок в него ходит. */
  private readonly table: HTMLElement;
  private last: { camp: CampState; now: number } | null = null;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'stats-panel';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2>Статистика</h2>
        <div id="sp-table"></div>
        <div id="sp-body"></div>
        <div class="acts">
          <button id="sp-copy">Скопировать события</button>
          <button id="sp-clear" class="ghost">Очистить</button>
          <button id="sp-close" class="ghost">Закрыть</button>
        </div>
      </div>`;
    parent.appendChild(this.overlay);
    this.body = this.overlay.querySelector('#sp-body') as HTMLElement;
    this.table = this.overlay.querySelector('#sp-table') as HTMLElement;

    this.overlay.querySelector('#sp-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#sp-clear')?.addEventListener('click', () => {
      clearTelemetry();
      this.render();
    });
    this.overlay.querySelector('#sp-copy')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(events(), null, 2));
    });
  }

  /**
   * Открыть сводку. Зовёт настройки — своей кнопки у панели нет.
   *
   * Лагерь и часы приходят снаружи: таблица лагерей (§30) считается от них,
   * а телеметрия — от событий, и спрашивать сохранение панель не должна.
   */
  open(camp: CampState, now: number): void {
    this.last = { camp, now };
    this.renderTable();
    this.render();
    this.overlay.classList.add('on');
  }

  /** Сцена сменилась — сводка не переезжает вместе с ней. */
  close(): void {
    this.overlay.classList.remove('on');
  }

  /**
   * Таблица лагерей (§4 — «таблица развития лагерей»). Появляется вместе
   * со всем слоем соседей, со вторым жильцом (`clan.ts`): до него в мире
   * не с кем сравниваться, и таблица из одной своей строки — это не таблица,
   * а зеркало.
   *
   * Сила у всех строк считается одним правилом (`sim/standing.ts`): таблица,
   * в которой своё число считается иначе, чем чужое, ничего не сравнивает.
   */
  private renderTable(): void {
    const last = this.last;
    if (last === null || !neighboursOpen(last.camp)) {
      this.table.innerHTML = '';
      return;
    }
    const rows = standings(last.camp, last.now, last.camp.clan?.name ?? null);
    this.table.innerHTML =
      '<h3 class="sp-head">Лагеря по силе</h3>' +
      rows
        .map(
          (r, i) =>
            `<div class="row sp-row${r.you ? ' you' : ''}">` +
            `<span class="lbl"><i class="sp-place">${i + 1}</i>` +
            `<s class="sp-flag" style="background:${r.color}"></s>${r.who}</span>` +
            `<b>${r.power}</b></div>` +
            `<div class="sp-note">ур. ${r.level}` +
            (r.folk === null ? '' : ` · народу ${r.folk}`) +
            '</div>',
        )
        .join('');
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
      // §26 — единственный вопрос, ради которого заведена отправка отряда:
      // не перестал ли игрок играть сам. Больше единицы — режем долю добычи.
      ['Отправок на вылазку', s.sortiePerRaid.toFixed(2), 'больше 1 — в игру играет бот'],
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
