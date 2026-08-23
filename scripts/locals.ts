/**
 * Замер местных у ягодных кустов (§13.8): много ли им достаётся, много ли
 * остаётся игроку и часто ли их вообще видно в кадре.
 *
 * Скрипт заведён под один вопрос: **сбывается ли то, что написано в формуле
 * мест.** `takenByLocals` обещала «вплотную к воротам обирают почти всегда,
 * за десяток клеток — редко» и мерила близость константой в двенадцать
 * клеток. Замер показал, что обещание не сбывалось ни разу: кусты мест
 * растут у края карты, от ворот до них 1,4–24,7 клетки при медиане 13,6,
 * и три четверти узлов сидели на нижнем упоре доли. Местные обирали
 * 0,15 куста за окно — то есть в кадре их было бы видно раз в семь заходов.
 *
 * Число было верным про поле, которого нет. Отсюда `Locals.reach`: размах
 * места мерится по самому месту, а не назначается, — и `TAKEN_NEAR`: своя
 * сторона места обирается почти вся, потому что **поле не кормит место**
 * (десять ртов замка съедают за окно тринадцать пищи, поле даёт полторы).
 * Местные стали снимать 0,39 спелого куста за окно вместо 0,15, игроку
 * осталось 0,87 пищи за заход вместо 1,23, а в кадре они появляются
 * в трети заходов вместо седьмой части.
 *
 * Второй вопрос — потолок собирателей: сколько их вообще может выйти разом.
 * Отвечает на него та же раскладка, а не глазомер.
 *
 * Запуск: npm run locals
 */
import { generateCastleSite } from '../src/sim/castleSite';
import { generateGraveSite } from '../src/sim/graveSite';
import {
  BERRY_FOOD_AVG,
  RIPEN_SECONDS,
  localsOf,
  takenBushes,
  wildRipe,
} from '../src/sim/berries';
import type { Bush, Locals } from '../src/sim/berries';
import { GATHERERS_MAX, gatherersOf } from '../src/sim/gatherers';
import { DWELLER_SPEED, SQUAD, garrisonOf } from '../src/sim/garrison';
import { FOOD_PER_MOUTH } from '../src/sim/balance';
import { WORK_SECONDS } from '../src/sim/residents';

/** Сидов на место и окон созревания на сид: хватает, чтобы доли не шумели. */
const SEEDS = 120;
const EPOCHS = 24;

interface Place {
  readonly name: string;
  readonly size: number;
  readonly blocked: Uint8Array;
  readonly bushes: readonly Bush[];
  readonly gate: { x: number; z: number };
  readonly seed: number;
  /** Есть ли у места живые жители: у кладбища их нет (§6.1.7.1). */
  readonly peopled: boolean;
}

const places = (kind: 'замок' | 'кладбище'): Place[] => {
  const out: Place[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const site = kind === 'замок' ? generateCastleSite(s) : generateGraveSite(s);
    out.push({
      name: kind,
      size: site.loc.size,
      blocked: site.loc.blocked,
      bushes: site.bushes,
      gate: site.gate,
      seed: site.loc.seed,
      peopled: kind === 'замок',
    });
  }
  return out;
};

const quantile = (xs: readonly number[], p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? 0;

console.log('§13.8 — местные у кустов мест мира\n');

for (const kind of ['замок', 'кладбище'] as const) {
  const all = places(kind);

  /* 1. Геометрия: та самая мерка, которую нельзя было назначать. */
  const far: number[] = [];
  const reaches: number[] = [];
  for (const p of all) {
    const locals = localsOf(p.gate, p.bushes);
    if (locals !== null) reaches.push(locals.reach);
    for (const b of p.bushes) far.push(Math.hypot(b.x - p.gate.x, b.z - p.gate.z));
  }

  /* 2. Что достаётся кому: за окно созревания. */
  let ripe = 0;
  let taken = 0;
  const crowd = new Map<number, number>();
  const circuits: number[] = [];
  let ringless = 0;
  let overflow = 0;
  for (const p of all) {
    const locals: Locals | null = p.peopled ? localsOf(p.gate, p.bushes) : null;
    for (let e = 0; e < EPOCHS; e++) {
      const now = e * RIPEN_SECONDS + 11;
      ripe += p.bushes.filter((b) => wildRipe(p.seed, b, now)).length;
      const mine = takenBushes(p.seed, p.bushes, locals, now);
      taken += mine.length;
      const folk = gatherersOf(
        { seed: p.seed, size: p.size, blocked: p.blocked, bushes: p.bushes, locals },
        now,
      );
      crowd.set(folk.length, (crowd.get(folk.length) ?? 0) + 1);
      if (mine.length > GATHERERS_MAX) overflow++;
      // Не вышел — либо круг не замкнулся, либо узел уже занят соседом.
      ringless += Math.min(mine.length, GATHERERS_MAX) - folk.length;
      for (const g of folk) circuits.push(g.chore.circuit);
    }
  }

  /*
   * 3. Довод, из которого следует форма доли: **поле не кормит место.**
   * Считается по тем, кто в замке вправду живёт (гарнизон, двор, торговец
   * и ремесленники), и по пайку §13.7 — иначе это было бы не доводом,
   * а прикидкой на глаз.
   */
  const mouths: number[] = [];
  if (kind === 'замок') {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const site = generateCastleSite(seed);
      const g = garrisonOf(site);
      mouths.push(SQUAD + (g.runs.length > 0 ? 1 : 0) + g.yard.length);
    }
  }

  const visits = all.length * EPOCHS;
  const seen = [...crowd.entries()].filter(([n]) => n > 0).reduce((a, [, v]) => a + v, 0);

  console.log(`${kind}: ${all.length} сидов × ${EPOCHS} окон`);
  console.log(
    `  до ворот, клеток   мин ${quantile(far, 0).toFixed(1)}  q25 ${quantile(far, 0.25).toFixed(1)}` +
      `  медиана ${quantile(far, 0.5).toFixed(1)}  q75 ${quantile(far, 0.75).toFixed(1)}` +
      `  макс ${quantile(far, 1).toFixed(1)}`,
  );
  console.log(
    `  размах места       ${reaches.length === 0 ? '—' : `${quantile(reaches, 0).toFixed(1)}..${quantile(reaches, 1).toFixed(1)}`}` +
      '   (им и мерится доля обобранного)',
  );
  console.log(
    `  за окно: спелых ${(ripe / visits).toFixed(2)}  обирают местные ${(taken / visits).toFixed(2)}` +
      `  остаётся игроку ${((ripe - taken) / visits).toFixed(2)}` +
      `  = ${(((ripe - taken) / visits) * BERRY_FOOD_AVG).toFixed(2)} пищи за заход`,
  );
  if (mouths.length > 0) {
    const mid = [...mouths].sort((a, b) => a - b)[Math.floor(mouths.length / 2)]!;
    const eats = (mid * FOOD_PER_MOUTH * RIPEN_SECONDS) / WORK_SECONDS;
    console.log(
      `  ртов в месте       ${Math.min(...mouths)}..${Math.max(...mouths)} (медиана ${mid})` +
        `   съедают за окно ${eats.toFixed(1)} пищи, поле даёт ${((ripe / all.length / EPOCHS) * BERRY_FOOD_AVG).toFixed(1)}`,
    );
  }
  console.log(
    `  местных в кадре    ${((100 * seen) / visits).toFixed(0)}% заходов   раскладка ` +
      [...crowd.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([n, v]) => `${n}: ${((100 * v) / visits).toFixed(0)}%`)
        .join('  '),
  );
  if (circuits.length > 0) {
    console.log(
      `  круг собирателя    ${quantile(circuits, 0).toFixed(0)}..${quantile(circuits, 1).toFixed(0)} с` +
        `  (шаг ${DWELLER_SPEED} кл/с)`,
    );
  }
  // Потолок обязан молчать: если он режет, это должно быть видно здесь,
  // а не только в кадре. Считается по обираемым узлам, а не по вышедшим:
  // потолок режет до маршрутов, и сравнивать надо с тем, что он резал.
  console.log(
    `  потолок ${GATHERERS_MAX} срезал  ${((100 * overflow) / visits).toFixed(1)}% заходов` +
      `   не вышло: ${ringless} раз`,
  );
  console.log();
}
