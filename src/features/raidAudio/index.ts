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
import type { RaidState, RaidStatus } from '../../sim/raid';

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

const enemyWoundsOf = (state: RaidState): number =>
  state.loc.enemies.reduce((sum, e) => sum + Math.max(0, e.wounds), 0);

/** Живых противников. Смерть слышна по убыли их числа, а не по наличию
 *  мёртвого: мёртвый остаётся мёртвым, и проверка «есть труп» звучала бы
 *  на каждом следующем попадании. */
const aliveOf = (state: RaidState): number =>
  state.loc.enemies.reduce((n, e) => n + (e.wounds > 0 ? 1 : 0), 0);

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
  /** Что уже прозвучало. */
  const heard = {
    steps: 0,
    wounds: 0,
    bag: 0,
    enemyWounds: 0,
    alive: 0,
    ticks: 0,
    cooldown: 0,
    status: 'running' as RaidStatus,
  };

  const reset = (state: RaidState): void => {
    heard.steps = state.steps;
    heard.wounds = state.hero.wounds;
    heard.bag = state.bagTotal;
    heard.enemyWounds = enemyWoundsOf(state);
    heard.alive = aliveOf(state);
    heard.ticks = foodTicksOf(state);
    heard.cooldown = state.hero.cooldown;
    heard.status = state.status;
  };

  return {
    reset,
    hear(state: RaidState): void {
      if (state.steps > heard.steps) sink.play('step');
      // Замах слышен до результата (§18.3): откат прыгает вверх в момент удара.
      if (state.hero.cooldown > heard.cooldown + 0.01) sink.play('swing');
      const enemyWounds = enemyWoundsOf(state);
      const alive = aliveOf(state);
      // Попадание — только по живому: последний удар звучит смертью, а не оба
      // разом. §18.3 — попадание не громче ранения, и подавно не поверх смерти.
      if (enemyWounds < heard.enemyWounds && alive === heard.alive) sink.play('hit');
      if (alive < heard.alive) sink.play('kill');
      if (state.hero.wounds < heard.wounds) sink.play('wound');
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
