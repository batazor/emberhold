import { ENEMY_STATS } from '../sim/enemies';
import { alive, current } from '../sim/battle';
import type { BattleState, BattleUnit } from '../sim/battle';

/**
 * Панель боя (§11.3). Появляется вместе с полем и показывает ровно то,
 * без чего ход нельзя сделать осознанно: чей ход, кто в очереди, что можно
 * сделать и сколько это стоит.
 *
 * **Чего здесь нет и почему.** Нет чисел урона, нет полосок стойкости,
 * нет подсказок «выгодно/невыгодно». Всё это игра уже говорит другим
 * способом: раны считаются штуками в верхней панели (§11.3), стойкость
 * противника читается полоской над ним, а «выгодно» — это решение игрока,
 * а не совет интерфейса.
 *
 * Кнопок три, и перемещения среди них нет: ходят тапом по гексу, тем же
 * жестом, каким ходят по локации (§6). Второго жеста для того же действия
 * игра не заводит нигде.
 */
export interface BattleHudHooks {
  readonly onAttack: () => void;
  readonly onGuard: () => void;
  readonly onWait: () => void;
}

const nameOf = (u: BattleUnit): string =>
  u.side === 'hero' ? 'Герой' : ENEMY_STATS[u.kind!].name;

export class BattleHud {
  private readonly root: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly order: HTMLElement;
  private readonly attack: HTMLButtonElement;
  private readonly guard: HTMLButtonElement;
  private readonly wait: HTMLButtonElement;
  /** Что нарисовано сейчас: панель пересобирается на смену, а не на кадр. */
  private key = '';

  constructor(host: HTMLElement, hooks: BattleHudHooks) {
    this.root = document.createElement('div');
    this.root.id = 'battle';
    this.root.className = 'battle';
    this.root.innerHTML = `
      <div class="battle-turn"><b id="b-turn"></b><span id="b-round" class="dim"></span></div>
      <div class="battle-order" id="b-order"></div>
      <div class="battle-acts">
        <button id="b-attack" type="button">Удар</button>
        <button id="b-guard" type="button">Блок</button>
        <button id="b-wait" type="button">Ждать</button>
      </div>
      <p class="battle-hint dim">Тап по гексу — шаг, по противнику — удар</p>
    `;
    host.appendChild(this.root);

    this.turn = this.q('b-turn');
    this.order = this.q('b-order');
    this.attack = this.q('b-attack') as HTMLButtonElement;
    this.guard = this.q('b-guard') as HTMLButtonElement;
    this.wait = this.q('b-wait') as HTMLButtonElement;

    this.attack.addEventListener('click', hooks.onAttack);
    this.guard.addEventListener('click', hooks.onGuard);
    this.wait.addEventListener('click', hooks.onWait);
    this.setVisible(false);
  }

  private q(id: string): HTMLElement {
    const el = this.root.querySelector(`#${id}`);
    if (el === null) throw new Error(`панель боя: нет ${id}`);
    return el as HTMLElement;
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
    if (!on) this.key = '';
  }

  /**
   * Обновить панель. `canAttack` считает поле теми же правилами, которыми
   * применит ход: кнопка, предлагающая невозможное, хуже отсутствующей —
   * игрок жмёт, ничего не происходит, и он винит себя.
   */
  sync(state: BattleState, canAttack: boolean): void {
    const unit = current(state);
    if (unit === undefined) return;

    const queue = state.order
      .map((i) => state.units[i]!)
      .filter((u) => u.hp > 0);
    const key = `${state.round}|${unit.id}|${canAttack}|${queue.map((u) => `${u.id}:${u.hp}`).join(',')}`;
    if (key === this.key) return;
    this.key = key;

    const mine = unit.side === 'hero';
    this.turn.textContent = mine ? 'Ваш ход' : `Ходит ${nameOf(unit)}`;
    this.turn.className = mine ? 'good' : 'dim';
    this.q('b-round').textContent = `раунд ${state.round} · противников ${alive(state, 'enemy').length}`;

    // Очередь — порядком, а не числами: игрок читает, кто следующий,
    // а не считает инициативу.
    this.order.innerHTML = queue
      .map((u) => {
        const now = u.id === unit.id ? ' now' : '';
        const side = u.side === 'hero' ? ' me' : '';
        return `<span class="turn-chip${now}${side}">${nameOf(u)}</span>`;
      })
      .join('');

    // Кнопки живут только на своём ходу: на чужом жать нечего.
    this.attack.disabled = !mine || !canAttack;
    this.guard.disabled = !mine;
    this.wait.disabled = !mine;
  }
}
