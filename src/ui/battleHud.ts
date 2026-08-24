import { alive, current } from '../sim/battle';
import type { BattleState, BattleUnit } from '../sim/battle';
import type { BattleForecast } from '../sim/battle';
import type { HeroLoadout } from '../sim/heroes';
import { avatarSvg } from './avatar';
import { enemyMessage } from '../i18n/gameData';
import { gameMarkup, gameMessage, gameText, setGameText } from '../i18n/game';

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
  u.side === 'hero'
    ? gameText(gameMessage('Герой', 'Hero'))
    : u.level > 1
      ? gameText(gameMessage('{enemy} ур. {level}', '{enemy} lvl {level}'), {
          enemy: gameText(enemyMessage[u.kind!]), level: u.level,
        })
      : gameText(enemyMessage[u.kind!]);

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
        <button id="b-attack" type="button">${gameMarkup(gameMessage('Удар', 'Attack'))}</button>
        <button id="b-guard" type="button">${gameMarkup(gameMessage('Блок', 'Block'))}</button>
        <button id="b-wait" type="button">${gameMarkup(gameMessage('Ждать', 'Wait'))}</button>
      </div>
      <p class="battle-hint dim">${gameMarkup(gameMessage('Тап по гексу — шаг, по противнику — удар', 'Tap a hex to move, tap an enemy to attack'))}</p>
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
    const key = `${document.documentElement.lang}|${state.round}|${unit.id}|${canAttack}|${busy}|${unit.dodge}|${unit.guarding}|` +
      `${forecast?.damage ?? '-'}:${forecast?.guardedDamage ?? '-'}:${forecast?.canBreakContact ?? '-'}|` +
      `${forecast?.guardedThreats.map((t) => `${t.attacker}:${t.aimed}:${t.target}:${t.intent ?? '-'}`).join('/') ?? '-'}|` +
      queue.map((u) => `${u.id}:${u.hp}:${u.dodge}:${u.guarding}`).join(',');
    if (key === this.key) return;
    this.key = key;

    const mine = unit.side === 'hero' && !busy;
    setGameText(this.turn,
      busy
        ? gameMessage('Бой идёт…', 'Battle in progress…')
        : mine
          ? gameMessage('Ваш ход', 'Your turn')
          : gameMessage('Ход: {unit}', 'Turn: {unit}'),
      busy || mine ? undefined : { unit: nameOf(unit) });
    this.turn.className = mine ? 'good' : 'dim';
    setGameText(this.q('b-round'), gameMessage('Раунд {round} · противников: {enemies}', 'Round {round} · Enemies: {enemies}'), {
      round: state.round, enemies: alive(state, 'enemy').length,
    });

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
      setGameText(this.threat,
        gameMessage('Угроза: {damage} · {guard}: {damage}→{guarded} · ударов: {attacks}',
          'Threat: {damage} · {guard}: {damage}→{guarded} · hits: {attacks}'), {
          damage: num(forecast.damage),
          guard: gameText(unit.hasShield ? gameMessage('Заслон', 'Intercept') : gameMessage('Блок', 'Block')),
          guarded: num(forecast.guardedDamage), attacks: attackLabel,
        });
      this.counter.textContent = counterText(state, forecast);
    } else {
      setGameText(this.threat, forecast.canBreakContact
        ? gameMessage('Угрозы нет · в следующем раунде контакт прервётся', 'No threat · disengaging next round')
        : gameMessage('Удара в этом круге нет', 'No attack this round'));
      this.counter.textContent = counterText(state, forecast);
    }
    if (mine) {
      setGameText(this.defense,
        unit.hasShield
          ? gameMessage('Уворот {dodge}% · щит оттолкнёт первого ближнего противника', 'Dodge {dodge}% · shield pushes back the first melee attacker')
          : gameMessage('Уворот {dodge}%', 'Dodge {dodge}%'),
        { dodge: Math.round(unit.dodge) });
    } else this.defense.textContent = '';

    // Кнопки живут только на своём ходу: на чужом жать нечего.
    this.attack.disabled = !mine || !canAttack;
    this.guard.disabled = !mine;
    setGameText(this.guard, unit.hasShield ? gameMessage('Заслон', 'Intercept') : gameMessage('Блок', 'Block'));
    this.wait.disabled = !mine;
  }
}

const num = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');

function counterText(state: BattleState, forecast: BattleForecast): string {
  const intents = new Set(forecast.guardedThreats.map((t) => t.intent).filter((x) => x !== undefined));
  const lines: string[] = [];
  if (intents.has('brace-burn')) lines.push(gameText(gameMessage('Воин целит щит: первое отбрасывание не сработает', 'The warrior braces against the shield: the first knockback will fail')));
  if (intents.has('draw-intercept')) lines.push(gameText(gameMessage('Маг целит союзника: Заслон примет болт', 'The mage targets an ally: Intercept will absorb the bolt')));
  if (intents.has('charge')) lines.push(gameText(gameMessage('Разогнавшегося противника нельзя оттолкнуть', 'A charging enemy cannot be pushed back')));
  if (intents.has('immovable')) {
    const minotaur = forecast.guardedThreats.some((t) =>
      t.intent === 'immovable' && state.units.find((u) => u.id === t.attacker)?.kind === 'minotaur');
    lines.push(gameText(minotaur
      ? gameMessage('Минотавр слишком тяжёл для толчка', 'The minotaur is too heavy to push')
      : gameMessage('Голем удержит позицию', 'The golem will hold its position')));
  }
  if (intents.has('swarm')) lines.push(gameText(gameMessage('Из стаи оттолкнётся только первый', 'Only the first attacker in the swarm will be pushed back')));
  return lines.join(' · ');
}
