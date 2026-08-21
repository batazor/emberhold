/**
 * Замер добычи по ярусам. §20.3 намеренно не назначает стоимость построек
 * до замеров, а §11.5 задаёт связующее правило: средняя добыча одной успешной
 * вылазки ≈ 70% стоимости следующего доступного улучшения.
 *
 * Живых игроков ещё нет, поэтому меряется бот с явной, простой политикой —
 * см. decide(). Это модель осторожного игрока, а не человек: числа отсюда
 * годятся как первая калибровка и обязаны быть перепроверены телеметрией.
 *
 * Запуск: npm run measure
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { createRaid } from '../src/sim/raid';
import { findPath } from '../src/sim/pathfinding';
import { TIER_KITCHEN_GATE } from '../src/sim/balance';
import { ENEMY_STATS } from '../src/sim/enemies';
import { emptyResources, RESOURCE_NAME } from '../src/sim/resources';
import type { ResourceKind, Resources } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 300;
interface TierStat {
  readonly tier: Tier;
  runs: number;
  success: number;
  carried: Resources;
  carriedTotal: number;
  steps: number;
  seconds: number;
  depthShare: number;
  /**
   * §11.3 — глубина, на которой вылазка кончилась, отдельно у павших
   * и у дошедших. Это и есть главная величина раздела: правило спрашивает,
   * **где** приходит провал, а не чем он нанесён.
   */
  failDepth: number;
  okDepth: number;
  foodLeft: number;
  /** Чем нанесён провал. Больше не вердикт (§22.6), но читать полезно:
   *  по нему видно, какую ручку крутить, когда глубина не сошлась. */
  byFood: number;
  byCombat: number;
  byKind: Record<string, number>;
  /**
   * Что заход приносит в среднем — по всем вылазкам, а не по удачным.
   * У провальной `carriedTotal` уже за вычетом ставки §11.2, поэтому это
   * и есть цена яруса для игрока: «сколько стоит туда сходить».
   */
  haulAll: number;
  /** Сколько камня принёс каждый заход, включая провальные. Нужно затем, что
   *  цену первого здания решает не средний игрок, а тот, кому её не хватило:
   *  среднее по 300 вылазкам такого игрока не показывает вовсе. */
  stoneRuns: number[];
}

function measure(tier: Tier, kitchenLevel: number, storageLevel: number): TierStat {
  const stat: TierStat = {
    tier,
    runs: 0,
    success: 0,
    carried: emptyResources(),
    carriedTotal: 0,
    steps: 0,
    seconds: 0,
    depthShare: 0,
    failDepth: 0,
    okDepth: 0,
    foodLeft: 0,
    haulAll: 0,
    byFood: 0,
    byCombat: 0,
    byKind: {},
    stoneRuns: [],
  };

  for (let seed = 1; seed <= RUNS; seed++) {
    // Игрок берётся у бота целиком. Своя копия здесь была третьей по счёту
    // — после карты опасности и приборов §22.6 — и пережила ровно до
    // пошагового боя: игрок, не умеющий ходить в бою, вешает вылазку,
    // и замер начинает мерить не игру, а обрыв. Одинаковые числа при
    // разных правках — верный признак, что меряется не то.
    const r = playRaid({ seed, tier, kitchenLevel, storageLevel }, POLICIES.cautious, mulberry32(seed));
    stat.runs += 1;
    stat.steps += r.steps;
    stat.seconds += r.durationSec;
    const depth = r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    stat.depthShare += depth;
    if (r.status === 'evacuated') stat.okDepth += depth;
    else stat.failDepth += depth;
    stat.foodLeft += r.foodLeft;
    if (r.status !== 'evacuated') {
      // Причину больше не выводим здесь: её пишет сама вылазка по тому,
      // откуда пришла последняя рана (§9). Прежнее правило «раны кончились
      // раньше провианта» врало на стыке — голодного героя, добитого
      // скелетом, оно относило к бою, а раненного в бою и доевшего
      // провиант — к голоду. И, главное, знал причину только этот скрипт:
      // живой игрок про свою смерть не рассказывал ничего.
      if (r.cause === 'combat') {
        stat.byCombat += 1;
        const kind = r.lastHitBy ?? 'неизвестно';
        stat.byKind[kind] = (stat.byKind[kind] ?? 0) + 1;
      } else stat.byFood += 1;
    }
    // Провальный заход тоже считается: ставка §11.4 отнимает не всё, и вопрос
    // «хватит ли на Мастерскую» задаётся о любом возвращении, а не об удачном.
    stat.stoneRuns.push(r.carried.stone);
    stat.haulAll += r.carriedTotal;
    if (r.status === 'evacuated') {
      stat.success += 1;
      stat.carriedTotal += r.carriedTotal;
      for (const k of Object.keys(stat.carried) as ResourceKind[]) stat.carried[k] += r.carried[k];
    }
  }
  return stat;
}

/**
 * Пары «ярус — уровни зданий». Кухня берётся из `TIER_KITCHEN_GATE`, а не
 * назначается здесь: гейт и есть то, с чем игрок на ярус попадает, и списывать
 * его вторым числом означало мерить состояние, в котором игрока не бывает.
 *
 * Списанное разошлось на единицу: в таблице стояла Кухня 1 на ярусе 1, а гейт
 * требует второй. Стоило это лестницы добычи — ярус 1 выносил меньше нулевого,
 * и читалось это как «подниматься невыгодно», хотя бот просто заходил
 * в локацию вдвое большую с провиантом предыдущего яруса. Комментарий рядом
 * называл гейты «Кухня 2 на ярус 2», и это тоже было неверно.
 *
 * Склад лестницей и остаётся: рюкзак гейтом не заперт, и его рост — часть
 * кривой §16, а не условие входа.
 */
const PLAN: { tier: Tier; kitchen: number; storage: number }[] = ([0, 1, 2, 3] as Tier[]).map(
  (tier) => ({ tier, kitchen: TIER_KITCHEN_GATE[tier], storage: tier + 1 }),
);

const num = (x: number, d = 1): string => x.toFixed(d).padStart(6);

console.log(`Замер: ${RUNS} вылазок на ярус, бот-осторожный, ночь\n`);
console.log('ярус  Кухня/Склад   успех   добыча  в сред.   шагов   время   глубина  провиант');
console.log('─'.repeat(74));

const stats = PLAN.map(({ tier, kitchen, storage }) => {
  const s = measure(tier, kitchen, storage);
  const perSuccess = s.success > 0 ? s.carriedTotal / s.success : 0;
  console.log(
    `  ${tier}      ${kitchen} / ${storage}      ` +
      `${num((s.success / s.runs) * 100, 0)}% ${num(perSuccess)} ${num(s.haulAll / s.runs)}  ${num(s.steps / s.runs, 0)}  ` +
      `${num(s.seconds / s.runs, 0)} с ${num((s.depthShare / s.runs) * 100, 0)}%  ${num(s.foodLeft / s.runs, 0)}`,
  );
  return s;
});

// §22.6 — соотношение причин перестало быть целью: правило спрашивает,
// где приходит провал, а не чем нанесён. Строка осталась диагностикой —
// по ней видно, какую ручку крутить, когда глубина не сошлась.
console.log('\nЧем нанесён провал (не цель — диагностика, §22.6)');
console.log('─'.repeat(74));
for (const s of stats) {
  const fails = s.runs - s.success;
  if (fails === 0) {
    console.log(`  ярус ${s.tier}: провалов нет`);
    continue;
  }
  console.log(
    `  ярус ${s.tier}: провалов ${((fails / s.runs) * 100).toFixed(0)}% ` +
      `на глубине ${((s.failDepth / fails) * 100).toFixed(0)}% ` +
      `(дошедший — ${((s.okDepth / Math.max(1, s.success)) * 100).toFixed(0)}%) — ` +
      `провиант ${((s.byFood / fails) * 100).toFixed(0)}% · бой ${((s.byCombat / fails) * 100).toFixed(0)}%` +
      (s.byCombat > 0
        ? ` (${Object.entries(s.byKind)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${ENEMY_STATS[k as keyof typeof ENEMY_STATS]?.name ?? k} ${n}`)
            .join(' · ')})`
        : ''),
  );
}

/**
 * Вердикт. §22.7 приписывает его этому прибору прямым текстом — «доля причин
 * вне коридора §22.6», — а печатал прибор одну таблицу, и читать её должен
 * был глаз. Так и вышло, что ярус 2 стоял тяжелее яруса 3 замер за замером,
 * и никто этого не назвал.
 *
 * Проверяются две вещи, и обе — про порядок величин, а не про конкретное
 * число. Числа §22.6 черновые, пока пересчёт не закончен; эти два
 * утверждения переживают любой пересчёт и потому годятся в вердикт уже
 * сейчас.
 */
console.log('\nВердикт (§22.7 — вывод прибора отменяет оценку)');
console.log('─'.repeat(74));
{
  /**
   * 1. Сложность обязана расти с номером яруса.
   *
   * Это не баланс, а само устройство лестницы: ярус — единственное обещание,
   * которое игра даёт до входа (§4.1 называет ставку, §11.2 — цену провала),
   * и ярус, который легче предыдущего, делает это обещание ложным.
   *
   * Проверяется замером, а не моделью: модель считает ожидаемые раны
   * монотонными и инверсии не видит — она набирает состав из бюджета
   * и не знает, что четверо по 0,47 страшнее одного по 1,55.
   *
   * Допуск — пять пунктов: при трёхстах забегах случайный разброс доли
   * около половины держится в трёх, и меньший допуск краснел бы на шуме.
   */
  const TOLERANCE = 0.05;
  const share = stats.map((s) => ({ tier: s.tier, ok: s.success / s.runs }));
  const inversions = share.filter(
    (s, i) => i > 0 && s.ok > share[i - 1]!.ok + TOLERANCE,
  );
  if (inversions.length === 0) {
    console.log('  ✓ Сложность монотонна: успех не растёт с номером яруса.');
  } else {
    for (const s of inversions) {
      const prev = share[share.findIndex((x) => x.tier === s.tier) - 1]!;
      console.log(
        `  ⚠ ЯРУС ${prev.tier} ТЯЖЕЛЕЕ ЯРУСА ${s.tier}: успех ` +
          `${(prev.ok * 100).toFixed(0)}% против ${(s.ok * 100).toFixed(0)}%. ` +
          'Лестница ярусов сломана,\n    и ставка §11.2 обещает не то, что берёт.',
      );
    }
  }

  /**
   * 2. Провал приходит глубже середины локации (§11.3).
   *
   * Заменило прежнее «провиант 65 / бой 35». То было неверно поставленным
   * вопросом: оно спрашивало, **чем** нанесён провал, а решает игрок
   * не это. Пока бой шёл сам, «умер в бою» значило «умер от арифметики
   * за кадром», и запрет был осмыслен; с пошаговым боем (§11.3) удар, блок,
   * позиция и отрыв — решения, и умереть от собственного решения игре
   * запрещать незачем.
   *
   * Что решает — **где** провал приходит. На глубине держится §22.5:
   * игрок продолжает, пока ожидаемая ценность выше синицы в руке, и вся
   * эта арифметика предполагает, что риск растёт с глубиной. Провал у входа
   * отменяет решение «глубже или назад» целиком: не игрок выбирает, докуда
   * дойти, а встреча выбирает за него.
   *
   * Два утверждения, оба про порядок величин:
   *  — павший заходил глубже середины локации;
   *  — и не мельче, чем дошедший, иначе риск с глубиной падает.
   */
  const HALF = 0.5;
  const depth = stats
    .map((s) => {
      const fails = s.runs - s.success;
      return {
        tier: s.tier,
        fails,
        fail: fails > 0 ? s.failDepth / fails : NaN,
        ok: s.success > 0 ? s.okDepth / s.success : NaN,
      };
    })
    .filter((s) => s.fails > 0);

  const shallow = depth.filter((s) => s.fail < HALF);
  const inverted = depth.filter((s) => s.fail < s.ok - TOLERANCE);

  if (shallow.length === 0 && inverted.length === 0) {
    console.log('  ✓ Провал приходит глубже середины локации, и глубже возвращения (§11.3).');
  }
  for (const s of shallow) {
    console.log(
      `  ⚠ ЯРУС ${s.tier}: ПРОВАЛ ПРИХОДИТ У ВХОДА — ${(s.fail * 100).toFixed(0)}% глубины ` +
        `при пороге ${(HALF * 100).toFixed(0)}%.\n` +
        '    Решение «глубже или назад» (§22.5) принимает встреча, а не игрок.',
    );
  }
  for (const s of inverted) {
    console.log(
      `  ⚠ ЯРУС ${s.tier}: РИСК ПАДАЕТ С ГЛУБИНОЙ — павший дошёл до ` +
        `${(s.fail * 100).toFixed(0)}%, дошедший до ${(s.ok * 100).toFixed(0)}%.\n` +
        '    Дальше — безопаснее, и вся ставка §11.2 обещает не то, что берёт.',
    );
  }

  /**
   * 3. Подниматься обязано быть выгодно.
   *
   * Ярус называет цену ставкой §11.2 — 0 / 30 / 60 / 100% добычи при провале, —
   * и продаёт за неё глубину. Сделка состоялась, если средний заход на ярусе
   * приносит больше, чем средний заход ярусом ниже: сравнивать надо по всем
   * вылазкам, а не по удачным, иначе ставка в сравнение не входит вовсе
   * и дорогой ярус выглядит выгодным ровно потому, что дорогой.
   *
   * Сырая добыча удачного захода этого вопроса не решает: она может расти,
   * пока растёт и доля провалов, и тогда игрок платит за глубину больше,
   * чем она стоит.
   */
  const worth = stats
    .filter((s) => s.runs > 0)
    .map((s) => ({ tier: s.tier, avg: s.haulAll / s.runs }));
  const poor = worth.filter((s, i) => i > 0 && s.avg <= worth[i - 1]!.avg);
  if (poor.length === 0) {
    console.log('  ✓ Подниматься выгодно: средний заход дорожает с ярусом.');
  } else {
    for (const s of poor) {
      const prev = worth[worth.findIndex((x) => x.tier === s.tier) - 1]!;
      console.log(
        `  ⚠ ЯРУС ${s.tier} НЕ ОКУПАЕТ СТАВКУ: средний заход ${s.avg.toFixed(1)} ` +
          `против ${prev.avg.toFixed(1)} на ярусе ${prev.tier}.\n` +
          '    Ставка §11.2 растёт, а цена яруса — нет: подниматься невыгодно.',
      );
    }
  }

  // Прибор, ничего не измеривший, обязан назвать себя сломанным, а не выдать
  // молчание за результат: ровно так врал scripts/combat.ts.
  if (stats.every((s) => s.runs === 0)) {
    console.log('  ⛔ ПРИБОР НИЧЕГО НЕ ИЗМЕРИЛ: ни одного забега.');
    process.exitCode = 1;
  }
}

console.log('\nСостав добычи успешной вылазки (§13)');
console.log('─'.repeat(74));
for (const s of stats) {
  const parts = (Object.keys(s.carried) as ResourceKind[])
    .map((k) => `${RESOURCE_NAME[k]} ${(s.carried[k] / Math.max(1, s.success)).toFixed(1)}`)
    .join(' · ');
  console.log(`  ярус ${s.tier}: ${parts}`);
}

console.log('\nСтоимость улучшения по §11.5 (добыча ≈ 70% цены)');
console.log('─'.repeat(74));
for (const s of stats) {
  const per = s.success > 0 ? s.carriedTotal / s.success : 0;
  console.log(
    `  ярус ${s.tier}: добыча ${per.toFixed(1)} → цена ${(per / 0.7).toFixed(1)} ` +
      `(${(1 / 0.7).toFixed(2)} вылазки)`,
  );
}

/*
 * Цена Мастерской (§16.1, третий акт пролога). Вопрос у неё свой, и ни §11.5,
 * ни бот на него не отвечают.
 *
 * §11.5 («добыча ≈ 70% цены») задаёт темп середины игры, а речь о первом
 * возвращении, которое обязано кончиться постройкой почти у всех.
 *
 * Бот же меряет не тот заход: он осторожен и уходит рано, а первую вылазку
 * ведёт раскадровка — кадр `bait` держит игрока, пока не вскрыты два
 * контейнера. Поэтому меряется то, что даёт вскрытая пара, а не средний
 * заход осторожного игрока: два ближних контейнера яруса 0.
 */
console.log('\nЦена Мастерской: что даёт первая вылазка (два ближних контейнера)');
console.log('─'.repeat(74));
{
  const hauls: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const state = createRaid({ seed: 20260820 + i, tier: 0, kitchenLevel: 1, storageLevel: 1 });
    const { loc } = state;
    const from = { x: Math.round(state.hero.x), z: Math.round(state.hero.z) };
    const near = [...loc.containers]
      .map((c) => ({ c, d: findPath(loc.size, loc.blocked, from, { x: c.x, z: c.z }).length }))
      .filter((e) => e.d > 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    hauls.push(near.reduce((sum, e) => sum + (e.c.kind === 'stone' ? e.c.amount : 0), 0));
  }
  const sorted = [...hauls].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  console.log(
    `  камня в паре: медиана ${at(0.5)} · нижняя десятая ${at(0.1)} · ` +
      `нижняя четверть ${at(0.25)} · максимум ${at(1)}`,
  );
  console.log(`  ни камня вовсе: ${((hauls.filter((n) => n === 0).length / hauls.length) * 100).toFixed(0)}% ` +
    '— оба контейнера выпали деревом, и никакая цена этого не чинит');
  for (let price = 1; price <= 8; price += 1) {
    const share = hauls.filter((n) => n >= price).length / hauls.length;
    const mark = share >= 0.8 ? ' ←' : '';
    console.log(`  цена ${price}: хватило ${(share * 100).toFixed(0)}%${mark}`);
  }
  console.log('  (← — цены, которые покрывает четыре первых вылазки из пяти)');
}
