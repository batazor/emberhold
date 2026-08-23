/**
 * Сила как одно число. Прибор написан под чужой метод — «Игровой баланс #3»
 * (gdcuffs), — и отвечает на единственный вопрос: **работает ли этот метод
 * в нашем бою.**
 *
 * Метод статьи в одну строку: свести все характеристики к одному числу
 * `PW = HP × DMG`, и дальше выводить из него параметры, а не назначать их.
 * Всё остальное там — следствия: архетипы делаются множителями (`HP × 1.5`,
 * `DMG ÷ 1.5` — сила та же), уворот считается как `HP / (1 − dodge)`,
 * отряд из N считается как `N²`, а проценты защиты заменяются рейтингами,
 * чтобы не упереться в сотню.
 *
 * Ни одно из этих утверждений нельзя принять на веру: они верны для той
 * модели боя, в которой написаны — процентное смягчение, одновременный
 * размен, вечный уворот. У нас другая (§11.3): Защита **вычитается**,
 * уворот — плавающий ресурс, а раунд отдаёт каждому по удару. Поэтому
 * прибор не проверяет статью на правоту — он меряет, **где её формулы
 * дают наш результат, а где расходятся, и насколько**.
 *
 * Пять блоков, по одному утверждению в каждом:
 *
 * 1. Сводится ли сила к одному числу — или у нас это пара «кто против кого».
 * 2. Курс обмена «стойкость ↔ Атака»: правда ли `×k` и `÷k` дают ту же силу.
 * 3. Цена уворота: сколько стойкости стоит очко Ловкости против `1/(1−dodge)`.
 * 4. Защита против растущей Атаки — тот вопрос, ради которого статья вводит
 *    рейтинги вместо процентов.
 * 5. Отряд: `N` или `N²`. Это единственный блок, вывод которого адресован
 *    не разделу, а коду: бюджет ран §22 складывает цену присутствия штука
 *    за штукой, то есть считает отряд линейным.
 *
 * Стенд — та же дуэль без локации, что у `scripts/combat.ts`: пустое поле,
 * герой и противники в шаге друг от друга, провиант выключен. Вылазка меряет
 * всё сразу и потому не отвечает про бой; дуэль отвечает только про бой
 * и потому не отвечает про вылазку (§22 предупреждает об этом прямо).
 *
 * Броски уворота детерминированы сидом (§11.3), поэтому «доля побед» здесь
 * набирается не повторами одного и того же боя, а прогоном по сидам:
 * один сид — один бой, посимвольно воспроизводимый.
 *
 * Запуск: npm run power
 */
import { TICK } from '../src/core/loop';
import { HERO_HP, TIER_ENEMY_LEVEL, TIER_HERO_LEVEL } from '../src/sim/balance';
import { DODGE_PER_AGILITY, dodgeOf } from '../src/sim/battle';
import { POLICIES, botBattlePlan } from '../src/sim/bot';
import { ENEMY_STATS, enemyStats } from '../src/sim/enemies';
import { emptyGear } from '../src/sim/gear';
import { DEFAULT_LOADOUT, HERO_CLASSES, CLASS_ORDER, referenceLoadout } from '../src/sim/heroes';
import type { HeroLoadout } from '../src/sim/heroes';
import { commandBattle, commandMove, createRaid, damageOf, inBattle, stepRaid } from '../src/sim/raid';
import { generateLocation } from '../src/sim/generate';
import { playRaid } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import { TIER_ROSTER } from '../src/sim/balance';
import { distanceField } from '../src/sim/grid';
import type { EnemyKind, GameLocation, RaidEnemyKind, Tier } from '../src/sim/types';

/** Сколько секунд стенда считаем безнадёжными. Больше, чем в дуэли: пятеро
 *  падают дольше одного, и общий потолок не должен обрезать именно тот бой,
 *  ради которого блок написан. */
const GIVE_UP = 180;
/** Поле. Больше дуэльного ровно настолько, чтобы вокруг героя помещался круг
 *  из пятерых и оставалось место отойти. */
const SIZE = 15;
const MID = (SIZE - 1) / 2;
/** Сидов на точку. Единственный источник разброса — броски уворота. */
const SEEDS = 24;

/** Забегов бота на ярус в шестом блоке. Столько же, сколько снимает
 *  `scripts/encounter.ts`: числа обязаны быть сравнимы с его таблицей. */
const RAID_RUNS = 60;
/** Показатель роста силы отряда — им шестой блок пересчитывает цену состава.
 *  Берётся из пятого блока этого же прибора, а не назначается. */
const GROUP_EXP = 1.75;

/** Ярусные противники: те, кого набирает бюджет ран §22. Привидение
 *  и стражник — обитатели мест, в состав вылазки не входят (§15). */
const RAID_KINDS: readonly RaidEnemyKind[] = ['minion', 'warrior', 'mage'];

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const n1 = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/**
 * Поле для стенда: всё проходимо, герой в центре, противники кольцом вокруг.
 * Стены нет намеренно — вопрос про силу, а не про геометрию, и камень добавил
 * бы к ответу то, чего в вопросе не было.
 *
 * Кольцо, а не шеренга: шеренга даёт коридор, в котором до героя дотягивается
 * один, и блок про отряд мерил бы ширину прохода вместо числа врагов.
 */
function arena(seed: number, kinds: readonly EnemyKind[], level: number): GameLocation {
  const blocked = new Uint8Array(SIZE * SIZE);
  const evac = { x: MID, z: MID };
  const taken = new Set<string>();
  const enemies = kinds.map((kind, i) => {
    const stats = ENEMY_STATS[kind];
    // Ставим на дистанции, с которой противник начинает бить: для ближнего
    // это длина оружия, для стрелка — дальность выстрела, но не дальше
    // четырёх клеток, иначе стенд мерил бы дорогу до мага.
    const gap = Math.min(Math.max(1, stats.reach * 0.9), 4);
    const a = (Math.PI * 2 * i) / Math.max(1, kinds.length);
    let x = Math.round(MID + Math.cos(a) * gap);
    let z = Math.round(MID + Math.sin(a) * gap);
    // Двое в одной клетке — не отряд, а один противник с двойной стойкостью.
    while (taken.has(`${x},${z}`) || (x === MID && z === MID)) x += 1;
    taken.add(`${x},${z}`);
    x = Math.min(SIZE - 2, Math.max(1, x));
    z = Math.min(SIZE - 2, Math.max(1, z));
    return {
      id: i,
      kind,
      level,
      x,
      z,
      prevX: x,
      prevZ: z,
      hp: enemyStats(kind, level).hp,
      awake: true,
      telegraph: 0,
      cooldown: 0,
    };
  });
  return {
    seed,
    tier: 0,
    size: SIZE,
    blocked,
    evac,
    containers: [],
    stones: [],
    enemies,
    backSteps: distanceField(SIZE, blocked, evac),
  };
}

interface Fight {
  /** Все ли противники упали. */
  readonly won: boolean;
  /** Сколько очков стойкости снято с героя. */
  readonly damage: number;
  /** Доля стойкости, которую сняли. Абсолютный урон между бойцами разной
   *  живучести несравним: сорок очков с сорока — смерть, сорок с двухсот —
   *  царапина, и блок про обмен читал бы по этой колонке ерунду. */
  readonly share: number;
  /** Раундов до конца. Раунды, а не секунды: бой пошаговый (§11.3). */
  readonly rounds: number;
  /** На сколько отдельных стычек распался бой и сколько врагов было
   *  в самой людной из них. Отряд, встреченный по частям, — это не отряд,
   *  и без этих двух чисел блок 5 мерил бы порядок подхода, а не число. */
  readonly bouts: number;
  readonly biggest: number;
}

/**
 * Один бой. Модель игрока берётся у бота целиком (`POLICIES.greedy`,
 * отступления нет): своя копия здесь уже стоила прогона в `combat.ts`,
 * и второй раз её заводить незачем.
 */
function fight(hero: HeroLoadout, kinds: readonly EnemyKind[], level: number, seed: number): Fight {
  const state = createRaid({
    seed,
    tier: 0,
    kitchenLevel: 9,
    storageLevel: 9,
    loadout: hero,
    gear: emptyGear(),
    loc: arena(seed, kinds, level),
    food: 99999,
    hunger: false,
  });

  const startHp = state.hero.hp;
  const living = (): { x: number; z: number } | null => {
    // Правда о стойкости живёт на поле, пока бой идёт: в мир она пишется
    // только на выходе из боя. Чтение из `loc.enemies` во время боя показало
    // бы полную стойкость до самого конца.
    if (state.battle !== null) {
      const u = state.battle.units.find((v) => v.side === 'enemy' && v.hp > 0);
      if (u === undefined) return null;
      const e = state.loc.enemies.find((x) => x.id === u.id);
      return e === undefined ? null : { x: e.x, z: e.z };
    }
    const e = state.loc.enemies.find((x) => x.hp > 0);
    return e === undefined ? null : { x: e.x, z: e.z };
  };

  let rounds = 0;
  let biggest = 0;
  let t = 0;
  while (t < GIVE_UP && state.status === 'running' && state.hero.hp > 0) {
    const target = living();
    if (target === null) break;
    if (inBattle(state)) {
      rounds = state.battle!.round;
      biggest = Math.max(biggest, state.battle!.units.filter((u) => u.side === 'enemy').length);
      if (!commandBattle(state, botBattlePlan(state, POLICIES.greedy))) {
        // Отклонённое решение обязано кончаться ожиданием, а не повтором:
        // иначе очередь стоит, и бой не кончается никогда.
        commandBattle(state, { kind: 'wait' });
      }
    } else if (state.path.length === 0) {
      // Герой сам идёт на противника: маг стоит далеко именно затем, чтобы
      // до него шли, и неподвижный герой мерил бы собственную неподвижность.
      commandMove(state, { x: Math.round(target.x), z: Math.round(target.z) });
    }
    stepRaid(state, TICK, false, hero.knowledge);
    t += TICK;
  }

  const damage = startHp - Math.max(0, state.hero.hp);
  return {
    won: living() === null && state.hero.hp > 0,
    damage,
    share: damage / Math.max(1, startHp),
    rounds: Math.max(1, rounds),
    bouts: Math.max(1, state.fights),
    biggest,
  };
}

/** Прогон по сидам: доля побед и средние по бою величины. */
function runs(hero: HeroLoadout, kinds: readonly EnemyKind[], level: number): {
  win: number;
  damage: number;
  share: number;
  rounds: number;
  bouts: number;
  biggest: number;
} {
  const got = Array.from({ length: SEEDS }, (_, i) => fight(hero, kinds, level, 1000 + i * 7));
  return {
    win: got.filter((f) => f.won).length / SEEDS,
    damage: mean(got.map((f) => f.damage)),
    share: mean(got.map((f) => f.share)),
    rounds: mean(got.map((f) => f.rounds)),
    bouts: mean(got.map((f) => f.bouts)),
    biggest: mean(got.map((f) => f.biggest)),
  };
}

/** Боец с подменёнными числами. Класс здесь не при чём: подменять таблицу
 *  классов ради замера незачем — вылазка принимает готовый расклад. */
const fighter = (over: Partial<HeroLoadout>): HeroLoadout => ({ ...DEFAULT_LOADOUT, ...over });

/** Стойкость бойца целиком: база плюс прибавка класса (§11.3). */
const hpOf = (who: HeroLoadout): number => HERO_HP + who.hp;

console.log('Сила как одно число: проверка метода PW = HP × DMG на нашем бою\n');

/* ══════════════════════════════════════════════════════════════════════════
   1. Сводится ли сила к одному числу
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Статья считает силу свойством юнита: `PW = HP × DMG`, одно число на всех.
 * У нас урон по герою — `max(МИН, Атака − Защита/2)` (§11.3), то есть он
 * зависит от того, **кого бьют**. Значит сила противника — не число, а строка
 * значений: своё против каждого класса. Блок печатает эту строку и меряет
 * разброс: если он мал, одним числом пользоваться можно, если велик — нельзя.
 */
console.log('══ 1. Сила: число или пара ══\n');

console.log('герой       стойкость  Атака       PW');
for (const cls of CLASS_ORDER) {
  const def = HERO_CLASSES[cls];
  const who = fighter({ cls, hp: def.hp, attack: def.base.attack, defense: def.base.defense, agility: def.base.agility, ranged: def.ranged });
  console.log(
    `${def.name.padEnd(12)}${String(hpOf(who)).padStart(9)}${String(def.base.attack).padStart(7)}` +
      `${String(hpOf(who) * def.base.attack).padStart(9)}`,
  );
}

console.log('\nпротивник      стойкость │ ' + CLASS_ORDER.map((c) => `PW против ${HERO_CLASSES[c].name}`.padStart(20)).join(''));
const spreads: number[] = [];
for (const kind of RAID_KINDS) {
  const s = ENEMY_STATS[kind];
  const pw = CLASS_ORDER.map((c) => s.hp * damageOf(s.attack, HERO_CLASSES[c].base.defense));
  spreads.push(Math.max(...pw) / Math.max(0.01, Math.min(...pw)));
  console.log(
    `${s.name.padEnd(14)}${String(s.hp).padStart(10)} │ ` +
      pw.map((x) => x.toFixed(0).padStart(20)).join(''),
  );
}
const spread = Math.max(...spreads);
console.log(
  spread >= 1.25
    ? `\n⚠ Одним числом сила противника не описывается: разброс до ×${spread.toFixed(2)}\n` +
        '  между классами. Вычитаемая Защита делает силу парой «кто против кого»,\n' +
        '  и таблица «сила юнита» у нас была бы таблицей одного класса.'
    : `\n✓ Разброс между классами мал (×${spread.toFixed(2)}): силу можно считать числом.`,
);

/**
 * Проверка того же с другой стороны: предсказывает ли отношение сил исход.
 * Если предсказывает — метод годен как быстрая прикидка, даже если само
 * число приходится считать пофамильно.
 */
console.log('\n══ отношение сил против исхода дуэли ══\n');
console.log('пара                       PW героя  PW врага  прогноз  доля побед');
let agree = 0;
let pairs = 0;
for (const cls of CLASS_ORDER) {
  const def = HERO_CLASSES[cls];
  const who = fighter({ cls, hp: def.hp, attack: def.base.attack, defense: def.base.defense, agility: def.base.agility, ranged: def.ranged });
  for (const kind of RAID_KINDS) {
    const s = ENEMY_STATS[kind];
    const pwHero = hpOf(who) * def.base.attack;
    const pwFoe = s.hp * damageOf(s.attack, def.base.defense);
    const r = runs(who, [kind], 1);
    const predicted = pwHero >= pwFoe;
    if (predicted === r.win >= 0.5) agree += 1;
    pairs += 1;
    console.log(
      `${(def.name + ' ↔ ' + s.name).padEnd(26)}${pwHero.toFixed(0).padStart(9)}${pwFoe.toFixed(0).padStart(10)}` +
        `${(predicted ? 'герой' : 'враг').padStart(9)}${pct(r.win).padStart(12)}`,
    );
  }
}
console.log(
  agree === pairs
    ? `\n✓ Прогноз по PW совпал с исходом во всех ${pairs} парах: как прикидка «кто\n` +
        '  кого» метод работает и у нас.'
    : `\n⚠ Прогноз по PW разошёлся с исходом в ${pairs - agree} парах из ${pairs}.`,
);

/* ══════════════════════════════════════════════════════════════════════════
   2. Курс обмена «стойкость ↔ Атака»
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * На этом утверждении держится вся вторая половина статьи: архетип делается
 * множителями, и `HP × k` вместе с `DMG ÷ k` оставляют силу неизменной.
 * Если это верно, танк и дамагер по построению равны, и балансировать
 * архетипы не нужно вовсе — достаточно не ошибиться в паре коэффициентов.
 *
 * Блок берёт эталонного бойца и водит `k` в обе стороны, держа `PW`
 * постоянным. Ровная строка означает, что курс обмена — единица.
 */
console.log('\n\n══ 2. Курс обмена: HP × k и Атака ÷ k — та же сила? ══\n');

const REF_FOE: readonly EnemyKind[] = ['minion', 'minion'];
console.log(`противник: два «${ENEMY_STATS.minion.name}», ${SEEDS} сидов на точку\n`);
console.log('  k   стойкость  Атака       PW  доля побед  снято здоровья  раундов');
const exchange: { k: number; win: number; share: number }[] = [];
for (const k of [0.5, 0.7, 1, 1.4, 2]) {
  const hp = Math.round(hpOf(DEFAULT_LOADOUT) * k);
  const attack = DEFAULT_LOADOUT.attack / k;
  const who = fighter({ hp: hp - HERO_HP, attack });
  const r = runs(who, REF_FOE, 1);
  exchange.push({ k, win: r.win, share: r.share });
  console.log(
    `${k.toFixed(1).padStart(5)}${String(hp).padStart(11)}${attack.toFixed(1).padStart(7)}` +
      `${(hp * attack).toFixed(0).padStart(9)}${pct(r.win).padStart(12)}` +
      `${pct(r.share).padStart(16)}${r.rounds.toFixed(1).padStart(9)}`,
  );
}
const winSpread = Math.max(...exchange.map((e) => e.win)) - Math.min(...exchange.map((e) => e.win));
const shareSpread = Math.max(...exchange.map((e) => e.share)) - Math.min(...exchange.map((e) => e.share));
/** Куда клонит перекос. Знак важнее величины: он говорит, что у нас дороже —
 *  бить или держать, — а это и есть решение про архетипы. */
const glass = exchange[0]!.win - exchange[exchange.length - 1]!.win;
console.log(
  winSpread <= 0.1 && shareSpread <= 0.1
    ? `\n✓ Курс обмена близок к единице: доля побед гуляет на ${pct(winSpread)},\n` +
        `  доля снятого здоровья — на ${pct(shareSpread)}. Архетипы можно делать множителями.`
    : `\n⚠ Курс обмена не единица: при постоянном PW доля побед расходится\n` +
        `  на ${pct(winSpread)}, доля снятого здоровья — на ${pct(shareSpread)}.\n` +
        (glass > 0
          ? `  Перекос в сторону Атаки: «стеклянная пушка» берёт на ${pct(glass)} больше\n` +
            '  боёв, чем равносильный по PW толстяк. Причина в самом раунде (§11.3):\n' +
            '  убитый перестаёт бить, и Атака покупает не только урон, но и\n' +
            '  ненанесённый по герою.'
          : `  Перекос в сторону стойкости: толстяк берёт на ${pct(-glass)} больше боёв,\n` +
            '  чем равносильная по PW пушка.') +
        '\n  Коэффициенты архетипа нельзя брать из статьи как есть — их надо мерить.',
);

/* ══════════════════════════════════════════════════════════════════════════
   3. Цена уворота
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Статья считает уворот вечной лотереей и переводит его в стойкость как
 * `HP / (1 − dodge)`: 50% уворота — это удвоенное здоровье. У нас уворот
 * плавающий (§11.3, модель Wasteland Punk): каждый промах сжигает часть,
 * ниже трети базы он не падает, в свой ход часть возвращается. Значит наш
 * уворот заведомо дешевле статейного — вопрос в том, насколько.
 *
 * Мерится он снятым уроном, а не победами: боец нарочно живучий, чтобы
 * бой доходил до конца при любой Ловкости и прибор мерил цену уворота,
 * а не порог смерти.
 */
console.log('\n\n══ 3. Цена уворота: сколько стойкости стоит очко Ловкости ══\n');

const TANK_HP = 200;
const PACK: readonly EnemyKind[] = ['minion', 'minion', 'minion'];
console.log(`боец: стойкость ${TANK_HP}, противник: три «${ENEMY_STATS.minion.name}»\n`);
console.log('Ловкость  база уворота  урон снят   ×стойкости  по статье  доля от статьи');
const zero = runs(fighter({ hp: TANK_HP - HERO_HP, agility: 0 }), PACK, 1);
const shares: number[] = [];
for (const agility of [0, 2, 4, 6, 8, 12, 15]) {
  const r = runs(fighter({ hp: TANK_HP - HERO_HP, agility }), PACK, 1);
  const gain = zero.damage / Math.max(0.01, r.damage);
  const dodge = dodgeOf(agility) / 100;
  const byArticle = 1 / (1 - dodge);
  if (agility > 0) shares.push((gain - 1) / Math.max(0.01, byArticle - 1));
  console.log(
    `${String(agility).padStart(8)}${pct(dodge).padStart(14)}${r.damage.toFixed(1).padStart(11)}` +
      `${('×' + gain.toFixed(2)).padStart(13)}${('×' + byArticle.toFixed(2)).padStart(11)}` +
      `${(agility === 0 ? '—' : pct((gain - 1) / Math.max(0.01, byArticle - 1))).padStart(17)}`,
  );
}
const share = mean(shares);
console.log(
  `\n  Очко Ловкости даёт ${DODGE_PER_AGILITY}% базы уворота (§11.3).`,
);
console.log(
  share >= 0.85
    ? `\n✓ Наш уворот стоит почти столько же, сколько считает статья (${pct(share)}\n` +
        '  от её прибавки): формулу можно брать как есть.'
    : `\n⚠ Наш уворот дешевле статейного: он даёт ${pct(share)} обещанной прибавки\n` +
        '  к стойкости. Формула `HP/(1−dodge)` завысила бы Ловкость в бюджете —\n' +
        '  плавающий уворот сгорает под серией и на длинный бой не работает.',
);

/* ══════════════════════════════════════════════════════════════════════════
   4. Защита против растущей Атаки
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ради этого вопроса статья и вводит рейтинги: процент, который не зависит
 * от уровня врага, либо упирается в сотню, либо обесценивает рост. Решение
 * там — `ARMOR% = ARMOR / (ARMOR + PENETRATION)`.
 *
 * У нас Защита вычитается, и у вычитания ровно обратная болезнь: доля
 * снятого падает по мере роста чужой Атаки. Блок печатает эту долю по ярусам,
 * взяв обе стороны такими, какими их видит §22.6, — тела уровня яруса
 * (`TIER_ENEMY_LEVEL`) против модельного героя яруса (`TIER_HERO_LEVEL`).
 *
 * Считается арифметикой, а не боем, намеренно: вопрос про формулу урона,
 * и симуляция добавила бы к ответу уворот, очередь и геометрию.
 */
console.log('\n\n══ 4. Защита против растущей Атаки ══\n');

console.log('ярус  ур. врага  ур. героя  Защита │ ' + RAID_KINDS.map((k) => ENEMY_STATS[k].name.padStart(15)).join(''));
const absorbed: Record<string, number[]> = {};
for (const tier of [0, 1, 2, 3] as Tier[]) {
  const hero = referenceLoadout(TIER_HERO_LEVEL[tier]);
  const lvl = TIER_ENEMY_LEVEL[tier];
  const cells = RAID_KINDS.map((kind) => {
    const attack = enemyStats(kind, lvl).attack;
    const shareOff = 1 - damageOf(attack, hero.defense) / attack;
    (absorbed[kind] ??= []).push(shareOff);
    return `${n1(attack)} → ${damageOf(attack, hero.defense).toFixed(1)} (${pct(shareOff)})`.padStart(15);
  });
  console.log(
    `${String(tier).padStart(4)}${String(lvl).padStart(11)}${String(TIER_HERO_LEVEL[tier]).padStart(11)}` +
      `${String(hero.defense).padStart(8)} │ ` + cells.join(''),
  );
}
const drift = RAID_KINDS.map((k) => {
  const row = absorbed[k]!;
  return row[row.length - 1]! - row[0]!;
});
const worst = Math.min(...drift);
console.log(
  worst < -0.05
    ? `\n⚠ Доля смягчённого падает с ярусом (до ${pct(worst)} за четыре яруса):\n` +
        '  вычитаемая Защита обесценивается ростом чужой Атаки. Это та самая\n' +
        '  болезнь, ради которой в статье появляются рейтинги.'
    : `\n✓ Доля смягчённого с ярусом не падает (сдвиг ${pct(worst)}…${pct(Math.max(...drift))}):\n` +
        '  Защита растёт вместе с чужой Атакой, и роль класса держится в глубину.\n' +
        '  Рейтинг вместо вычитания нам сейчас не нужен.',
);

/* ══════════════════════════════════════════════════════════════════════════
   5. Отряд: N или N²
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Самый дорогой вывод статьи и единственный, адресованный у нас коду.
 *
 * Утверждение: сила отряда растёт быстрее числа. Пятеро бьют впятеро чаще
 * **и** держат впятеро дольше, поэтому `PW(N) = HP·N × DMG·N = PW·N²`,
 * а с поправкой на то, что павшие перестают бить, — `PW·N·(1 + 0.7(N−1))`.
 *
 * У нас бюджет ран (`deriveTier`, §22) набирает состав сложением: цена
 * присутствия штука за штукой, пока хватает бюджета. Это ровно линейная
 * модель. Если показатель окажется около двойки, сложение занижает цену
 * толпы, и `MAX_ENEMIES` (§15, «не больше четырёх») — не отдельное правило,
 * а заплата поверх этого занижения.
 *
 * Метод: для каждого N ищем, во сколько раз надо усилить героя, чтобы он
 * выигрывал половину боёв. Сила разгоняется по статье — корень множителя
 * в стойкость, корень в Атаку, — так что искомое `m` и есть сила отряда
 * в единицах силы одного.
 */
console.log('\n\n══ 5. Отряд: сила растёт как N или как N²? ══\n');

/** Герой силы `m` в единицах эталона: корень в стойкость, корень в Атаку —
 *  так, как предписывает статья, иначе `m` означало бы не силу, а одну ось. */
const scaled = (m: number): HeroLoadout => {
  const root = Math.sqrt(m);
  return fighter({
    hp: Math.round(hpOf(DEFAULT_LOADOUT) * root) - HERO_HP,
    attack: DEFAULT_LOADOUT.attack * root,
  });
};

/**
 * Множитель силы, при котором герой берёт половину боёв. Половина — точка,
 * где сравнение честно: на краях (0% и 100%) прибор насыщается и разницы
 * между двумя и пятью не видит вовсе — ровно та беда, о которой предупреждает
 * `scripts/encounter.ts` про раны.
 */
function powerFor(kinds: readonly EnemyKind[], level: number): number {
  let lo = 0.1;
  let hi = 64;
  for (let i = 0; i < 9; i++) {
    const mid = Math.sqrt(lo * hi);
    if (runs(scaled(mid), kinds, level).win >= 0.5) hi = mid;
    else lo = mid;
  }
  return Math.sqrt(lo * hi);
}

for (const kind of ['minion', 'warrior'] as EnemyKind[]) {
  console.log(`\nпротивник: «${ENEMY_STATS[kind].name}»\n`);
  console.log('  N   сила отряда  во сколько раз  показатель  линейно  по статье (N²)  разом в бою');
  const one = powerFor([kind], 1);
  const exps: number[] = [];
  const ratios: number[] = [];
  const met: number[] = [];
  for (const n of [1, 2, 3, 4, 5]) {
    const pack: EnemyKind[] = Array.from({ length: n }, () => kind);
    const m = n === 1 ? one : powerFor(pack, 1);
    const ratio = m / one;
    const exp = n === 1 ? 1 : Math.log(ratio) / Math.log(n);
    if (n > 1) exps.push(exp);
    // Поправка статьи на смертность: павшие перестают бить, поэтому
    // не N², а N·(1 + 0.7·(N−1)).
    const byArticle = n * (1 + 0.7 * (n - 1));
    // Сколько их вправду встретилось разом. Без этой колонки нельзя отличить
    // «отряд не сильнее» от «отряда не было»: встреченные по очереди
    // складываются линейно по построению.
    const r = runs(scaled(m), pack, 1);
    met.push(r.biggest / n);
    if (n > 1) ratios.push(ratio);
    console.log(
      `${String(n).padStart(3)}${m.toFixed(2).padStart(13)}${('×' + ratio.toFixed(2)).padStart(16)}` +
        `${(n === 1 ? '—' : exp.toFixed(2)).padStart(12)}${('×' + String(n)).padStart(9)}` +
        `${('×' + byArticle.toFixed(1)).padStart(17)}${r.biggest.toFixed(1).padStart(13)}`,
    );
  }
  const together = mean(met);
  if (together < 0.9) {
    console.log(
      `\n  Осторожно: разом в бою оказывалось ${pct(together)} поставленных. Стенд мерил\n` +
        '  отряд, который герой встречает по частям, и показатель ниже настоящего.',
    );
  }
  /**
   * Насколько близко к статье. Сравнивается не с `N²`, а с её же поправкой
   * на смертность — `N·(1 + 0.7·(N−1))`: чистый квадрат в статье назван
   * силой отряда, который дерётся весь целиком до последнего, и таких боёв
   * не бывает ни у неё, ни у нас.
   */
  const miss = mean(
    [2, 3, 4, 5].map((n, i) => Math.abs(ratios[i]! / (n * (1 + 0.7 * (n - 1))) - 1)),
  );
  console.log(
    miss <= 0.2
      ? `\n  Формула статьи с поправкой на смертность — N·(1 + 0.7·(N−1)) — ложится\n` +
          `  на замер со средней ошибкой ${pct(miss)}: считать ею толпу у нас можно.`
      : `\n  Формула статьи с поправкой на смертность промахивается в среднем\n` +
          `  на ${pct(miss)}: пользоваться ею как есть нельзя, показатель надо мерить.`,
  );
  const a = mean(exps);
  console.log(
    a >= 1.35
      ? `\n⚠ Показатель ${a.toFixed(2)}: сила отряда растёт быстрее числа. Складывать\n` +
          '  цену присутствия штука за штукой (§22, `deriveTier`) значит занижать\n' +
          '  цену толпы — и потолок §15 держит именно эту дыру.'
      : `\n✓ Показатель ${a.toFixed(2)}: у нас отряд ближе к линейному, чем к N².\n` +
          '  Сложение цены присутствия в §22 остаётся законным.',
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   6. Часто ли их встречают разом
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Вывод пятого блока сам по себе к вылазке не относится. Стенд ставит всех
 * вокруг героя разом, а в локации они стоят врозь и просыпаются по одному:
 * встреченные по очереди складываются линейно по построению, и тогда
 * сложение в §22 законно независимо от того, что показал стенд.
 *
 * Поэтому последний вопрос — про настоящие вылазки: **сколько противников
 * приходится на одну стычку.** Ходит бот по сгенерированным локациям, всё
 * как в замерах §22.
 *
 * Величина — нижняя оценка, и это надо читать вместе с числом: бой, из
 * которого ушли отрывом (§11.3), кончается без падений и тянет её вниз.
 * Оценка снизу здесь и нужна: если даже она больше единицы, значит толпой
 * встречают, и цена толпы посчитана сложением.
 */
console.log('\n\n══ 6. Сколько противников на одну стычку в настоящей вылазке ══\n');

console.log('ярус  в составе  стычек  падений  падений на стычку  занижение цены');
const crowd: number[] = [];
for (const tier of [0, 1, 2, 3] as Tier[]) {
  const got = Array.from({ length: RAID_RUNS }, (_, i) => {
    const seed = 5000 + i;
    return playRaid(
      {
        seed,
        tier,
        kitchenLevel: 3,
        storageLevel: 3,
        loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
        loc: generateLocation(seed, tier, 1),
      },
      POLICIES.cautious,
      mulberry32(seed),
    );
  });
  const fights = mean(got.map((r) => r.fights));
  const kills = mean(got.map((r) => r.kills));
  const per = kills / Math.max(0.01, fights);
  const size = TIER_ROSTER[tier].length;
  /**
   * Насколько сложение занижает цену. Стычка из `per` тел стоит `per^1.75`
   * по стенду и `per` по бюджету; отношение — `per^0.75`. Меньше одного
   * тела на стычку значит, что толпы не было вовсе, и занижения нет:
   * такие бои кончались отрывом, а не падением.
   */
  const under = per <= 1 ? 0 : Math.pow(per, GROUP_EXP - 1) - 1;
  crowd.push(per);
  console.log(
    `${String(tier).padStart(4)}${String(size).padStart(11)}${fights.toFixed(1).padStart(8)}` +
      `${kills.toFixed(1).padStart(9)}${per.toFixed(2).padStart(19)}` +
      `${pct(under).padStart(16)}`,
  );
}
const worstCrowd = Math.max(...crowd);
const worstUnder = worstCrowd <= 1 ? 0 : Math.pow(worstCrowd, GROUP_EXP - 1) - 1;
console.log(
  worstCrowd <= 1.4
    ? `\n✓ Встречают по одному: самая людная стычка — ${worstCrowd.toFixed(2)} тела, и сложение\n` +
        `  в \`deriveTier\` занижает цену состава не больше чем на ${pct(worstUnder)}. Вывод\n` +
        '  пятого блока до нынешней вылазки не доходит — но держит это не бюджет,\n' +
        '  а расстановка генератора и потолок §15. Станет расстановка плотнее —\n' +
        '  сюда придётся вернуться.'
    : `\n⚠ Стычки людные: до ${worstCrowd.toFixed(2)} тел на бой, и сложение занижает цену\n` +
        `  состава на ${pct(worstUnder)}. Бюджет ран покупает больше врагов, чем думает.`,
);

console.log(
  '\n\nЧто с этим делать — решает не прибор. Он отвечает только на то,\n' +
    'какие формулы статьи дают наш результат, а какие нет.',
);
