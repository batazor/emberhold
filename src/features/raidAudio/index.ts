/**
 * Озвучка вылазки (§18). Симуляция о звуке не знает и событий для него не
 * выдаёт: ухо сравнивает состояние с прошлым тиком и озвучивает разницу.
 * Так звук остаётся вторым каналом для тех же данных (§18.1), а не второй
 * их копией внутри правил.
 *
 * Вынесено из main отдельной фичой: наружу нужен только RaidState, а порядок
 * звуков — записанное решение §18.3, и его лучше проверять, чем помнить.
 */
import { play, setFoodShare } from '../../core/audio';
import type { SfxName } from '../../core/audio';
import type { BattlePlay } from '../../sim/battle';
import type { RaidState, RaidStatus } from '../../sim/raid';
import type { EnemyKind } from '../../sim/types';

/**
 * Куда уходит звук. Параметр, а не прямой вызов: с подставным приёмником
 * порядок §18.3 проверяется в Node списком имён (`raidAudio.rules.ts`),
 * без AudioContext и без слуха.
 */
export interface Sink {
  readonly play: (name: SfxName) => void;
  readonly setFoodShare: (share: number) => void;
}

const AUDIO: Sink = { play, setFoodShare };

interface EnemyHeard { readonly hp: number; readonly kind: EnemyKind }

const enemiesOf = (state: RaidState): Map<number, EnemyHeard> => new Map(
  state.loc.enemies.map((e) => [e.id, { hp: e.hp, kind: e.kind }]),
);

const kindOf = (state: RaidState, unit: number): EnemyKind | null =>
  state.loc.enemies.find((e) => e.id === unit)?.kind ?? null;

/** Сколько десятых запаса уже потрачено: тик расхода звучит на каждой. */
const foodTicksOf = (state: RaidState): number =>
  Math.floor(((state.foodMax - state.food) / state.foodMax) * 10);

export interface RaidEar {
  /** Принять состояние молча — с него пойдёт сравнение. Нужно на входе
   *  в вылазку: иначе первый же тик озвучит всю разницу с прошлой. */
  reset(state: RaidState): void;
  /** Озвучить разницу с прошлым тиком. */
  hear(state: RaidState): void;
}

export function createRaidEar(sink: Sink = AUDIO): RaidEar {
  let voicedPlays = new WeakSet<object>();
  /** Что уже прозвучало. */
  const heard = {
    steps: 0,
    wounds: 0,
    bag: 0,
    enemies: new Map<number, EnemyHeard>(),
    fights: 0,
    ticks: 0,
    cooldown: 0,
    status: 'running' as RaidStatus,
  };

  const reset = (state: RaidState): void => {
    voicedPlays = new WeakSet<object>();
    for (const play of state.plays) voicedPlays.add(play);
    heard.steps = state.steps;
    heard.wounds = state.hero.hp;
    heard.bag = state.bagTotal;
    heard.enemies = enemiesOf(state);
    heard.fights = state.fights;
    heard.ticks = foodTicksOf(state);
    heard.cooldown = state.hero.cooldown;
    heard.status = state.status;
  };

  return {
    reset,
    hear(state: RaidState): void {
      if (state.steps > heard.steps) sink.play('step');
      // Очередь показа ещё не забрана рендером: по ней слышны тяжёлые шаги
      // и собственный каменный удар голема, хотя логика боя остаётся беззвучной.
      for (const play of state.plays as readonly BattlePlay[]) {
        if (voicedPlays.has(play)) continue;
        voicedPlays.add(play);
        const kind = kindOf(state, play.unit);
        if (play.kind === 'move' && (kind === 'stone-golem' || kind === 'minotaur')) {
          sink.play('heavyStep');
        }
        if (play.kind === 'strike' && kind === 'stone-golem' && !play.dodged) {
          sink.play('stoneHit');
        }
      }
      if (
        state.fights > heard.fights
        && state.loc.enemies.some((e) => e.kind === 'minotaur' && e.hp > 0)
      ) sink.play('roar');
      // Замах слышен до результата (§18.3): откат прыгает вверх в момент удара.
      if (state.hero.cooldown > heard.cooldown + 0.01) sink.play('swing');
      const enemies = enemiesOf(state);
      for (const [id, before] of heard.enemies) {
        const after = enemies.get(id);
        if (after === undefined || after.hp >= before.hp) continue;
        if (after.hp <= 0 && before.hp > 0) {
          sink.play(before.kind === 'stone-golem' ? 'golemBreak' : 'kill');
        } else {
          sink.play(before.kind === 'stone-golem' ? 'stoneHit' : 'hit');
        }
      }
      if (state.hero.hp < heard.wounds) sink.play('wound');
      if (state.bagTotal > heard.bag) sink.play('chest');
      const ticks = foodTicksOf(state);
      if (ticks > heard.ticks) sink.play('tick');
      if (state.status !== heard.status && state.status !== 'running') {
        sink.play(state.status === 'evacuated' ? 'evac' : 'fail');
      }
      sink.setFoodShare(state.foodMax > 0 ? Math.max(0, state.food) / state.foodMax : 0);
      reset(state);
    },
  };
}
