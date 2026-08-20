/**
 * Дев-меню. Живёт только в `npm run dev`: в сборку не едет вовсе, потому что
 * вызов обёрнут в `import.meta.env.DEV` и вырезается вместе с веткой.
 *
 * Нужно оно ровно затем, что сейв переживает перезагрузку, а разработка
 * онбординга требует обратного — начинать с чистого листа по десять раз
 * подряд. Чистить localStorage руками из консоли — не рабочий процесс.
 */
export interface DevMenuCallbacks {
  onNewGame(): void;
}

export class DevMenu {
  constructor(parent: HTMLElement, cb: DevMenuCallbacks) {
    const root = document.createElement('div');
    root.id = 'dev';
    root.innerHTML = `<button data-act="new">Новая игра</button>`;
    parent.appendChild(root);

    root.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      cb.onNewGame();
    });
  }
}
