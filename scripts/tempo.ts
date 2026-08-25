/**
 * Цена резонанса жилы (§13.11) в секундах игрока.
 *
 * Вопрос, под который написан инструмент. §13.4 держится на замере «добыча
 * обязана проигрывать подбору»: камень кайлом дороже камня из находки, и
 * потому валун не может стать основным источником. Резонанс продаёт скорость
 * за клики — и вопрос звучит так: **на какой меткости активная добыча
 * догоняет находку и перегоняет ли она её вовсе?** Ответ решает, где стоит
 * потолок лестницы (`COMBO_MULS`), и решает его прогон, а не оценка.
 *
 * Меряются профили игрока за одним валуном (30 замахов, 24 с пассивно):
 * от «не кликает» до «каждое попадание perfect». Живой палец лежит между
 * «новичком» и «ритмачом» — крайние строки таблицы это границы, а не норма.
 *
 * Запуск: npm run tempo
 */
import { mulberry32 } from '../src/core/rng';
import type { Rng } from '../src/core/rng';
import { MINE_SECONDS, MINE_STONE_AVG } from '../src/sim/stones';
import {
  APPROACH_SECONDS,
  SPOT_SECONDS,
  startTempo,
  stepTempo,
  tempoBeat,
  tempoBoost,
} from '../src/sim/tempo';

/** Цена камня из находки — замер §13.4 (`npm run fence`), сюда взят числом. */
const FIND_PRICE = 2.5;

const TICK = 1 / 60;

interface Profile {
  readonly name: string;
  /** Вероятность попасть в круг; промах — сознательный клик мимо. */
  readonly aim: number;
  /** Разброс клика вокруг совпадения колец, ± секунд. 0 — метроном. */
  readonly jitter: number;
  /** Профиль вовсе не играет: пассивная добыча, весь резонанс мимо. */
  readonly passive?: boolean;
  /** Профиль только кликает по добыче и точку не трогает никогда. */
  readonly cheerOnly?: boolean;
}

const PROFILES: readonly Profile[] = [
  { name: 'не кликает', aim: 0, jitter: 0, passive: true },
  { name: 'только клики', aim: 0, jitter: 0, cheerOnly: true },
  { name: 'новичок 60%', aim: 0.6, jitter: 0.3 },
  { name: 'середина 85%', aim: 0.85, jitter: 0.18 },
  { name: 'ритмач 100%', aim: 1, jitter: 0.06 },
  { name: 'метроном', aim: 1, jitter: 0 },
];

/** Пауза между кликами разгона: быстрее окна «3 за 0,9 с», как у пальца. */
const CHEER_GAP = 0.22;

interface Run {
  readonly seconds: number;
  readonly avgBoost: number;
  readonly perfects: number;
  readonly hits: number;
  readonly misses: number;
}

function mineOnce(profile: Profile, seed: number): Run {
  const t = startTempo();
  const rngSpots: Rng = mulberry32(seed);
  const rngHand: Rng = mulberry32(seed ^ 0x2f61c7);
  let left = MINE_SECONDS;
  let now = 0;
  let nextCheer = 0;
  /** Точка, на которую уже запланирован клик, — по моменту рождения. */
  let plannedFor = -1;
  let planAt = Infinity;
  let planAim: 'spot' | 'wide' = 'spot';
  let boostSum = 0;
  let ticks = 0;
  let perfects = 0;
  let hits = 0;
  let misses = 0;

  while (left > 0 && now < 300) {
    if (!profile.passive) {
      if (t.spot === null || profile.cheerOnly) {
        if (now >= nextCheer) {
          tempoBeat(t, now, rngSpots, null);
          nextCheer = now + CHEER_GAP;
        }
      } else {
        if (t.spot.bornAt !== plannedFor) {
          plannedFor = t.spot.bornAt;
          const jitter = (rngHand() * 2 - 1) * profile.jitter;
          planAt = Math.min(plannedFor + APPROACH_SECONDS + jitter, plannedFor + SPOT_SECONDS);
          planAim = rngHand() < profile.aim ? 'spot' : 'wide';
        }
        if (now >= planAt) {
          planAt = Infinity;
          const beat = tempoBeat(t, now, rngSpots, planAim);
          if (beat === 'perfect') perfects++;
          if (beat === 'perfect' || beat === 'good') hits++;
          if (beat === 'miss') misses++;
        }
      }
    }
    const boost = tempoBoost(t, now);
    left -= TICK * boost;
    boostSum += boost;
    ticks++;
    now += TICK;
    stepTempo(t, now, rngSpots);
  }
  return { seconds: now, avgBoost: boostSum / ticks, perfects, hits, misses };
}

const RUNS = 60;
const num = (x: number, d = 1): string => x.toFixed(d).padStart(7);

console.log(`Один валун: ${MINE_SECONDS} с пассивно, награда в среднем ${MINE_STONE_AVG} камня.`);
console.log(`Камень из находки — ${FIND_PRICE} с (§13.4, npm run fence).\n`);
console.log('профиль        с/валун  с/камень  средний ×  perfect  против находки');
for (const profile of PROFILES) {
  let seconds = 0;
  let boost = 0;
  let perfects = 0;
  let hits = 0;
  for (let i = 0; i < RUNS; i++) {
    const run = mineOnce(profile, 1000 + i);
    seconds += run.seconds / RUNS;
    boost += run.avgBoost / RUNS;
    perfects += run.perfects;
    hits += run.hits + run.misses;
  }
  const price = seconds / MINE_STONE_AVG;
  const vs = price / FIND_PRICE;
  console.log(
    `${profile.name.padEnd(14)}${num(seconds)}  ${num(price, 2)}  ${num(boost, 2)}` +
    `  ${num(hits === 0 ? 0 : (100 * perfects) / hits, 0)}%  ${num(vs, 2)}×`,
  );
}
console.log(
  '\nЧитается так: пассивная цена держит правило §13.4 «добыча дороже находки»,' +
  '\nа строки ниже показывают, какую долю этой разницы выкупают клики и меткость.',
);
