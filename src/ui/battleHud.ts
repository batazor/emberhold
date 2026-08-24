import { ENEMY_STATS } from '../sim/enemies';
import { alive, current } from '../sim/battle';
import type { BattleState, BattleUnit } from '../sim/battle';
import type { BattleForecast } from '../sim/battle';
import type { HeroLoadout } from '../sim/heroes';
import { avatarSvg } from './avatar';

/**
 * Панель боя (§11.3). Появляется вместе с полем и показывает ровно то,
 * без чего ход нельзя сделать осознанно: чей ход, кто в очереди, что можно
 * сделать и сколько это стоит.
 *
 * Панель не советует «выгодно/невыгодно», но показывает исходные данные:
 * кто достаёт, сколько снимет при попадании и сколько спасёт Блок. Скрыть эти числа
 * означало бы проверять память, а не тактику.
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

// §22.6 — уровень в подписи: сила противника обязана читаться до удара,
// а не выясняться по полоске.
const nameOf = (u: BattleUnit): string =>
  u.side === 'hero' ? 'Герой' : `${ENEMY_STATS[u.kind!].name}${u.level > 1 ? ` ур. ${u.level}` : ''}`;

export class BattleHud {
  private readonly root: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly order: HTMLElement;
  private readonly attack: HTMLButtonElement;
  private readonly guard: HTMLButtonElement;
  private readonly wait: HTMLButtonElement;
  private readonly threat: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly defense: HTMLElement;
  /** Что нарисовано сейчас: панель пересобирается на смену, а не на кадр. */
  private key = '';

  constructor(host: HTMLElement, hooks: BattleHudHooks) {
    this.root = document.createElement('div');
    this.root.id = 'battle';
    this.root.className = 'panel battle';
    this.root.innerHTML = `
      <div class="battle-turn"><b id="b-turn"></b><span id="b-round" class="dim"></span></div>
      <div class="battle-order" id="b-order"></div>
      <div class="battle-threat" id="b-threat"></div>
      <div class="battle-counter" id="b-counter"></div>
      <div class="battle-defense dim" id="b-defense"></div>
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
    this.threat = this.q('b-threat');
    this.counter = this.q('b-counter');
    this.defense = this.q('b-defense');

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
  sync(
    state: BattleState,
    canAttack: boolean,
    party: ReadonlyMap<number, HeroLoadout> = new Map(),
    /** Показ дочитывает прошлые ходы: кнопки молчат, чтобы игрок не ходил
     *  в бой, которого ещё не увидел. */
    busy = false,
    forecast: BattleForecast | null = null,
  ): void {
    const unit = current(state);
    if (unit === undefined) return;

    const queue = state.order
      .map((i) => state.units[i]!)
      .filter((u) => u.hp > 0);
    const key = `${state.round}|${unit.id}|${canAttack}|${busy}|${unit.dodge}|${unit.guarding}|` +
      `${forecast?.damage ?? '-'}:${forecast?.guardedDamage ?? '-'}:${forecast?.canBreakContact ?? '-'}|` +
      `${forecast?.guardedThreats.map((t) => `${t.attacker}:${t.aimed}:${t.target}:${t.intent ?? '-'}`).join('/') ?? '-'}|` +
      queue.map((u) => `${u.id}:${u.hp}:${u.dodge}:${u.guarding}`).join(',');
    if (key === this.key) return;
    this.key = key;

    const mine = unit.side === 'hero' && !busy;
    this.turn.textContent = busy ? 'Бой идёт…' : mine ? 'Ваш ход' : `Ходит ${nameOf(unit)}`;
    this.turn.className = mine ? 'good' : 'dim';
    this.q('b-round').textContent = `раунд ${state.round} · противников ${alive(state, 'enemy').length}`;

    // Очередь — порядком, а не числами: игрок читает, кто следующий,
    // а не считает инициативу.
    //
    // Свои стоят лицами (§11.8): «Герой» на троих читался как один и тот же
    // человек, ходящий трижды. Лицо — то же, что в веере и на карточке:
    // класс и сид приезжают из снаряжения бойца, а не рисуются заново.
    this.order.innerHTML = queue
      .map((u) => {
        const now = u.id === unit.id ? ' now' : '';
        const side = u.side === 'hero' ? ' me' : '';
        const who = u.side === 'hero' ? party.get(u.id) : undefined;
        const face =
          who === undefined ? '' : `<span class="face">${avatarSvg(who.cls, who.seed)}</span>`;
        return `<span class="turn-chip${now}${side}">${face}${nameOf(u)}</span>`;
      })
      .join('');

    if (!mine || forecast === null) {
      this.threat.textContent = '';
      this.counter.textContent = '';
    } else if (forecast.damage > 0 || forecast.guardedDamage > 0) {
      const attacks = forecast.threats.filter((t) => t.target === unit.id).length;
      const guardedAttacks = forecast.guardedThreats.filter((t) => t.target === unit.id).length;
      const attackLabel = attacks === guardedAttacks ? String(attacks) : `${attacks}→${guardedAttacks}`;
      this.threat.textContent = `Угроза: ${num(forecast.damage)} · ` +
        `${unit.hasShield ? 'Заслон' : 'Блок'} ${num(forecast.damage)}→${num(forecast.guardedDamage)} · ` +
        `ударов ${attackLabel}`;
      this.counter.textContent = counterText(state, forecast);
    } else {
      this.threat.textContent = forecast.canBreakContact
        ? 'Угрозы нет · к следующему кругу отрыв'
        : 'Удара в этом круге нет';
      this.counter.textContent = counterText(state, forecast);
    }
    this.defense.textContent = mine
      ? `Уворот ${Math.round(unit.dodge)}%` +
        (unit.hasShield ? ' · щит: первый ближний удар оттолкнёт' : '')
      : '';

    // Кнопки живут только на своём ходу: на чужом жать нечего.
    this.attack.disabled = !mine || !canAttack;
    this.guard.disabled = !mine;
    this.guard.textContent = unit.hasShield ? 'Заслон' : 'Блок';
    this.wait.disabled = !mine;
  }
}

const num = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');

function counterText(state: BattleState, forecast: BattleForecast): string {
  const intents = new Set(forecast.guardedThreats.map((t) => t.intent).filter((x) => x !== undefined));
  const lines: string[] = [];
  if (intents.has('brace-burn')) lines.push('Воин целит щит: первое отбрасывание сгорит');
  if (intents.has('draw-intercept')) lines.push('Маг целит соседа: Заслон примет болт');
  if (intents.has('charge')) lines.push('Таран усилен и не отбрасывается');
  if (intents.has('immovable')) {
    const minotaur = forecast.guardedThreats.some((t) =>
      t.intent === 'immovable' && state.units.find((u) => u.id === t.attacker)?.kind === 'minotaur');
    lines.push(minotaur ? 'Минотавр слишком тяжёл для толчка' : 'Голем удержит позицию');
  }
  if (intents.has('swarm')) lines.push('Стая: оттолкнётся только первый');
  return lines.join(' · ');
}
