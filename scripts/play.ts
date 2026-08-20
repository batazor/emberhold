/**
 * Сессия из двадцати вылазок через настоящий игровой цикл и настоящую
 * телеметрию. Вылазку отрабатывает бот из src/sim/bot.ts (политика balanced),
 * решения лагеря — те же, что предлагает игроку экран возврата.
 *
 * Это не замер баланса (для него есть measure), а прогон петли целиком:
 * вылазка → экран возврата → стройка → следующая вылазка, с перерывами
 * между сессиями, чтобы таймеры и возвраты были настоящими.
 *
 * Запуск: npm run play
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import {
  BUILDINGS,
  BUILD_SECONDS,
  completeIfDue,
  craftGear,
  createCamp,
  startUpgrade,
  suggestGear,
  suggestUpgrade,
  tierBlock,
  upgradeBlock,
} from '../src/sim/camp';
import { GEAR } from '../src/sim/gear';
import type { BuildingId, CampState } from '../src/sim/camp';
import { addResources } from '../src/sim/resources';
import { events, setEvents, summarize, track } from '../src/sim/telemetry';
import { BUILDING_ORDER } from '../src/sim/camp';
import type { Tier } from '../src/sim/types';

/**
 * Прогон без Кузницы — чтобы «стало лучше» было измеримым, а не заявленным:
 * NOFORGE=1 npm run play. Оставлено намеренно, этим же переключателем
 * сравнивается любой следующий сток без таймера (§21).
 */
const FORGE = process.env['NOFORGE'] !== '1';

const RAIDS = 20;
const RAIDS_PER_SESSION = 5;
/** Пауза в лагере между вылазками и перерыв между сессиями, секунды. */
const CAMP_PAUSE = 40;
const AWAY = [0, 35 * 60, 3 * 3600, 11 * 3600];

/** Самый глубокий открытый ярус: игрок идёт туда, где дороже. */
function bestTier(camp: CampState): Tier {
  let best: Tier = 0;
  for (const t of [1, 2, 3] as Tier[]) if (tierBlock(camp, t) === 'ok') best = t;
  return best;
}

/** Во что вкладываться: Кухня и Склад меняют вылазку, Штаб — только потолок. */
function chooseUpgrade(camp: CampState): BuildingId | null {
  // Кузница бесплатна и мгновенна: её ставят сразу, как только Штаб позволит.
  if (FORGE && camp.levels.forge === 0 && upgradeBlock(camp, 'forge') === 'ok') return 'forge';
  for (const id of ['kitchen', 'storage'] as BuildingId[]) {
    if (upgradeBlock(camp, id) === 'ok') return id;
  }
  const capped = (['kitchen', 'storage'] as BuildingId[]).some(
    (id) => upgradeBlock(camp, id) === 'hq-cap',
  );
  if (capped && upgradeBlock(camp, 'hq') === 'ok') return 'hq';
  return null;
}

const camp = createCamp();
// Сид сессии можно задать аргументом: одна сессия ничего не доказывает.
const SEED = Number(process.argv[2] ?? 20260820);
const rng = mulberry32(SEED);
setEvents([]);

let now = 0;
let watermark = 0;
const rows: string[] = [];
/** Почему экран возврата не смог предложить покупку — §20.1 живёт этим. */
const noOffer: Record<string, number> = { 'слот занят': 0, 'потолок Штаба': 0, 'нет ресурсов': 0 };

for (let n = 1; n <= RAIDS; n++) {
  // Начало сессии: перерыв, за который могла достроиться стройка.
  if ((n - 1) % RAIDS_PER_SESSION === 0) {
    const away = AWAY[Math.floor((n - 1) / RAIDS_PER_SESSION)] ?? 0;
    now += away;
    track({
      t: 'session_start',
      at: now,
      awaySec: watermark > 0 ? now - watermark : 0,
      timerLeftSec:
        camp.construction === null ? null : Math.max(0, camp.construction.endsAt - now),
    });
    const done = completeIfDue(camp, now);
    if (done !== null) track({ t: 'build_done', at: now, building: done, level: camp.levels[done] });
  }

  const tier = bestTier(camp);
  const raid = playRaid(
    {
      seed: (rng() * 1e9) | 0,
      tier,
      kitchenLevel: camp.levels.kitchen,
      storageLevel: camp.levels.storage,
      gear: camp.gear,
    },
    POLICIES.balanced,
    rng,
  );

  track({ t: 'raid_start', at: now, tier, food: 0, capacity: 0 });
  now += raid.durationSec;
  track({
    t: 'raid_end',
    at: now,
    tier,
    failed: raid.status !== 'evacuated',
    maxBack: raid.maxBack,
    locMaxBack: raid.locMaxBack,
    carried: raid.carriedTotal,
    lost: raid.lost,
    steps: raid.steps,
    foodLeft: raid.foodLeft,
    durationSec: Math.round(raid.durationSec),
  });
  addResources(camp.resources, raid.carried);
  camp.raids += 1;

  // Экран возврата: что он предложил и что игрок выбрал. Предложений два вида —
  // стройка по таймеру и ковка без него (§20.1), и второе существует ровно
  // затем, чтобы первое могло быть занято.
  // Без Кузницы её нельзя и предлагать: иначе бесплатная непостроенная
  // Кузница вечно висит в предложениях и завышает базовый замер.
  const raw = suggestUpgrade(camp);
  const offer = !FORGE && raw === 'forge' ? null : raw;
  const gearOffer = offer === null && FORGE ? suggestGear(camp) : null;
  if (offer === null && gearOffer === null) {
    const reason =
      camp.construction !== null
        ? 'слот занят'
        : BUILDING_ORDER.every((id) => upgradeBlock(camp, id) === 'hq-cap')
          ? 'потолок Штаба'
          : 'нет ресурсов';
    noOffer[reason] = (noOffer[reason] ?? 0) + 1;
  }
  const plan = chooseUpgrade(camp);
  const chose = plan !== null ? 'build' : gearOffer !== null ? 'craft' : 'raid';
  track({ t: 'return_screen', at: now, canBuy: offer !== null || gearOffer !== null, chose });

  let built = '—';
  if (plan !== null && startUpgrade(camp, plan, now)) {
    const toLevel = camp.levels[plan] + 1;
    track({ t: 'build_start', at: now, building: plan, toLevel, seconds: BUILD_SECONDS[toLevel] ?? 0 });
    built = `${BUILDINGS[plan].name} → ${toLevel}`;
  } else if (gearOffer !== null && craftGear(camp, gearOffer)) {
    const level = camp.gear[gearOffer];
    track({ t: 'craft', at: now, slot: gearOffer, toLevel: level });
    built = `${GEAR[gearOffer].name} → ${level}`;
  }

  rows.push(
    `${String(n).padStart(2)}  ярус ${tier}  ` +
      `${raid.status === 'evacuated' ? 'вышел ' : 'провал '} ` +
      `${String(raid.carriedTotal).padStart(3)}  ` +
      `${String(raid.lost).padStart(3)}  ` +
      `${String(Math.round(raid.durationSec)).padStart(4)} с  ` +
      `${String(Math.round((raid.maxBack / Math.max(1, raid.locMaxBack)) * 100)).padStart(4)}%  ` +
      `${
        offer !== null
          ? BUILDINGS[offer].name.padEnd(7)
          : gearOffer !== null
            ? 'Кузница'
            : 'нечего купить'
      }  ${built}`,
  );

  now += CAMP_PAUSE;
  const done = completeIfDue(camp, now);
  if (done !== null) track({ t: 'build_done', at: now, building: done, level: camp.levels[done] });

  // Уход из игры фиксируется в конце сессии.
  if (n % RAIDS_PER_SESSION === 0) {
    track({ t: 'exit', at: now, where: n % 2 === 0 ? 'camp' : 'return' });
    watermark = now;
  }
}

console.log(`Сессия, сид ${SEED}\n`);
console.log('Вылазка               Вынес Потерял Время Глубина  Предложено      Начато');
console.log('─'.repeat(92));
for (const r of rows) console.log(r);

const s = summarize(events());
const pct = (x: number): string => `${Math.round(x * 100)}%`;

console.log('\nТелеметрия (§9)');
console.log('─'.repeat(92));
console.log(`  Вылазок                    ${s.raids}`);
console.log(`  Провалов                   ${pct(s.failRate)}          цель: провиант 65% / бой 35% (§11.3)`);
console.log(`  Глубина выхода             ${pct(s.avgDepthShare)}          ниже половины = уходят рано (§9)`);
console.log(`  Вынесено за вылазку        ${s.avgCarried.toFixed(1)}`);
console.log(`  Потеряно за вылазку        ${s.avgLost.toFixed(1)}`);
console.log(`  Провианта на выходе        ${s.avgFoodLeft.toFixed(1)}`);
console.log(`  Покупка была доступна      ${pct(s.buyOfferRate)}          цель 60–80% (§20.1)`);
console.log(`  Из них выбрали стройку     ${pct(s.buyTakeRate)}`);
console.log(
  `  Почему не предложена       ${Object.entries(noOffer)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')}`,
);
console.log(`  Построено первым           ${s.firstBuilding === null ? '—' : BUILDINGS[s.firstBuilding].name}`);
console.log(
  `  Возврат после таймера      ${s.medianReturnMin === null ? '—' : `${s.medianReturnMin.toFixed(0)} мин`}          сравнивать с §20.2`,
);
console.log(`  Выходы из сессии           вылазка ${s.exits.raid} · лагерь ${s.exits.camp} · возврат ${s.exits.return}`);

console.log('\nЛагерь на конец');
console.log('─'.repeat(92));
console.log(
  `  ${BUILDING_ORDER.map((id) => `${BUILDINGS[id].name} ${camp.levels[id]}`).join(' · ')}`,
);
console.log(
  `  Осталось: соль ${camp.resources.salt} · дерево ${camp.resources.wood} · ` +
    `железо ${camp.resources.iron} · кристалл ${camp.resources.crystal}`,
);
console.log(`  Прошло игрового времени: ${(now / 3600).toFixed(1)} ч`);
