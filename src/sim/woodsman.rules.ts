/**
 * Лесник у замка (`woodsman.ts`): правила и замер.
 *
 * Глазом здесь не проверить ничего важного. Что цена удваивается, видно
 * на втором найме, а сломается она на третьем; что пост встал законно —
 * вопрос не к одному замку, а к сотне; что прибавка лесника не разгоняет
 * лагерь — вопрос к отлучке любой длины, а не к той, которую посмотрели.
 * Поэтому сотню замков и все длины отлучек смотрит этот файл.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { coinsOf, createCamp, earnCoins } from './camp';
import type { CampState } from './camp';
import { CASTLE_CELL } from './castle';
import { WOOD, generateCastleSite, spotAt } from './castleSite';
import { castleGuestAt } from './castleGuest';
import { idx } from './grid';
import { CHOP_SECONDS, CHOP_WOOD_AVG } from './logging';
import {
  TENT_COST,
  WOODSMAN_CAP,
  WOODSMAN_SWING,
  WORK_CAP,
  WORK_SECONDS,
  admit,
  assignWork,
  buildTent,
  collectWork,
  residentLook,
  workDone,
} from './residents';
import type { Resident } from './residents';
import { mouths, upkeepDue } from './upkeep';
import {
  HIRE_ORDER,
  WOODSMAN_COIN,
  WOODSMAN_STEP,
  advanceHire,
  hireBlock,
  hireWoodsman,
  hireLine,
  nextWoodsmanPrice,
  startHireTalk,
  woodsmanName,
  woodsmanPostAt,
  woodsmanPrice,
  woodsmenOf,
} from './woodsman';

/** Сиды переписи: сто двадцать замков — та же мерка, что у гостя. */
const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 1);

/** Лагерь с кошельком: наём меряется ценой, а не бедностью. */
function rich(coins = 10_000): CampState {
  const camp = createCamp();
  camp.resources.wood = 500;
  earnCoins(camp, coins);
  return camp;
}

const post = (seed: number) => woodsmanPostAt(generateCastleSite(seed));

const woodsman = (name: string): Resident => ({
  name,
  look: 'поселенец',
  seed: name.length,
  answer: 'строим',
  rest: false,
  craft: 'лесник',
});

describe('Лесник у замка', () => {
  test('пост есть у каждого замка: это услуга, а не находка', () => {
    const missing = SEEDS.filter((seed) => post(seed) === null);
    assert.deepEqual(missing, [], `на этих замках посту не нашлось места: ${missing.join(', ')}`);
  });

  test('пост стоит в поле, на свободных клетках и мимо стоянки гостя', () => {
    for (const seed of SEEDS) {
      const site = generateCastleSite(seed);
      const p = post(seed)!;
      const size = site.loc.size;
      const road = new Set<string>();
      for (const plan of site.roads) {
        const base = spotAt(site, plan);
        for (let dz = 0; dz < CASTLE_CELL; dz++) {
          for (let dx = 0; dx < CASTLE_CELL; dx++) road.add(`${base.x + dx}:${base.z + dz}`);
        }
      }
      const guest = castleGuestAt(site);
      const busy = new Set<string>([
        ...site.lamps.map((l) => `${l.x}:${l.z}`),
        ...site.loc.stones.map((s) => `${s.x}:${s.z}`),
        ...site.bushes.map((b) => `${b.x}:${b.z}`),
        ...(guest === null ? [] : [guest.tent, guest.fire, guest.sit].map((c) => `${c.x}:${c.z}`)),
      ]);
      for (const cell of [p.tent, p.target, p.stand]) {
        assert.ok(
          cell.x >= WOOD && cell.z >= WOOD && cell.x < size - WOOD && cell.z < size - WOOD,
          `замок ${seed}: клетка поста в лесу, а не в поле`,
        );
        assert.equal(site.loc.blocked[idx(size, cell.x, cell.z)], 0, `замок ${seed}: пост в занятой клетке`);
        assert.ok(!road.has(`${cell.x}:${cell.z}`), `замок ${seed}: пост встал на дорогу`);
        assert.ok(!busy.has(`${cell.x}:${cell.z}`), `замок ${seed}: пост встал на чужое`);
      }
    }
  });

  /** Тот же замок — тот же пост: иначе лесник переезжает между заходами. */
  test('пост выводится из сида и не меняется между заходами', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      assert.deepEqual(post(seed), post(seed), `замок ${seed}: пост поехал`);
    }
  });

  test('цена удваивается с каждым нанятым', () => {
    assert.equal(woodsmanPrice(0), WOODSMAN_COIN);
    for (let hired = 0; hired < 6; hired++) {
      assert.equal(
        woodsmanPrice(hired + 1),
        woodsmanPrice(hired) * WOODSMAN_STEP,
        `${hired + 1}-й лесник стоит не вдвое дороже предыдущего`,
      );
    }
  });

  test('наём списывает монеты, вписывает жильца и поднимает цену', () => {
    const camp = rich();
    const p = post(SEEDS[0]!)!;
    const before = coinsOf(camp);
    const hired = hireWoodsman(camp, p);
    assert.ok(hired !== null, 'лесник не нанялся при полном кошельке');
    assert.equal(coinsOf(camp), before - WOODSMAN_COIN, 'списана не та цена');
    assert.equal(woodsmenOf(camp), 1);
    assert.equal(camp.residents.at(-1)!.craft, 'лесник', 'нанятый пришёл без ремесла');
    assert.equal(camp.residents.at(-1)!.answer, 'строим', 'нанятый пришёл не на дерево');
    assert.equal(nextWoodsmanPrice(camp), WOODSMAN_COIN * WOODSMAN_STEP, 'цена не выросла');
  });

  /**
   * Цена считается до приёма. Иначе второй лесник обошёлся бы игроку
   * в цену третьего — и заметить это можно было бы только по кошельку.
   */
  test('второй лесник стоит вдвое, а не вчетверо', () => {
    const camp = rich();
    hireWoodsman(camp, post(SEEDS[0]!)!);
    const before = coinsOf(camp);
    hireWoodsman(camp, post(SEEDS[1]!)!);
    assert.equal(before - coinsOf(camp), WOODSMAN_COIN * WOODSMAN_STEP, 'со второго снято не вдвое');
  });

  test('пустой кошелёк отказывает и не списывает половину цены', () => {
    const camp = rich(WOODSMAN_COIN - 1);
    assert.equal(hireBlock(camp), 'coins');
    const before = coinsOf(camp);
    assert.equal(hireWoodsman(camp, post(SEEDS[0]!)!), null, 'нанялся без денег');
    assert.equal(coinsOf(camp), before, 'монеты списаны при отказе');
    assert.equal(camp.residents.length, 0, 'жилец появился без оплаты');
  });

  /** Имена кончаются раньше, чем монеты: тёзку `admit` не пускает. */
  test('лагерь набирает лесников, пока хватает монет, и все они разные', () => {
    const camp = rich(WOODSMAN_COIN * 64);
    for (let i = 0; i < 6; i++) {
      const hired = hireWoodsman(camp, post(SEEDS[i]!)!);
      assert.ok(hired !== null, `${i + 1}-й лесник не нанялся`);
    }
    const names = new Set(camp.residents.map((r) => r.name));
    assert.equal(names.size, camp.residents.length, 'в лагере завелись тёзки');
    assert.notEqual(woodsmanName(camp, 1), '', 'имя следующему не выдаётся');
  });

  /**
   * Ремесло старше внешности: лесник читается лесником везде, где его видно.
   * Проверяется на нанятом, а не на выдуманном: `hireWoodsman` — единственный
   * вход, и он же обязан класть то, что читает интерфейс.
   */
  test('нанятый виден лесником, с какой бы внешностью ни пришёл', () => {
    const camp = rich();
    hireWoodsman(camp, post(SEEDS[0]!)!);
    assert.equal(residentLook(camp.residents[0]!), 'лесник');
  });

  test('лесник вдвое быстрее обычных рук на дереве', () => {
    const camp = createCamp();
    camp.resources.wood = 500;
    admit(camp, woodsman('Лесник'));
    admit(camp, { name: 'Гита', look: 'поселенец', seed: 4, answer: 'строим', rest: false });
    buildTent(camp);
    buildTent(camp);
    // Такт лесника — четверть часа: за полчаса у него две единицы,
    // у обычного жильца одна.
    const done = workDone(camp, WORK_SECONDS);
    assert.equal(done.length, 1, 'оба несут дерево — строка обязана быть одна');
    assert.equal(done[0]!.n, 1 + WOODSMAN_SWING, `за такт принесли ${done[0]!.n} вместо ${1 + WOODSMAN_SWING}`);
  });

  test('на камне лесник — обычные руки', () => {
    const camp = createCamp();
    camp.resources.wood = 500;
    admit(camp, woodsman('Лесник'));
    buildTent(camp);
    assignWork(camp, 0, 'ходим');
    const done = workDone(camp, WORK_SECONDS * WORK_CAP * 4);
    assert.deepEqual(done, [{ kind: 'stone', n: WORK_CAP }], 'ремесло сработало на чужом деле');
  });

  /**
   * Потолок держит любую отлучку — то же правило, что у обычного жильца,
   * и то же число сверху: ниже цены палатки. Лесник, окупающий палатку,
   * начал бы селить сам себя, и палатка перестала бы что-либо стоить.
   */
  test('потолок лесника держит неделю и не окупает палатку', () => {
    const camp = createCamp();
    camp.resources.wood = 500;
    admit(camp, woodsman('Лесник'));
    buildTent(camp);
    for (const away of [WORK_SECONDS * 8, 3600 * 24, 3600 * 24 * 30]) {
      const done = workDone(camp, away);
      assert.deepEqual(done, [{ kind: 'wood', n: WOODSMAN_CAP }], `отлучка ${away} с пробила потолок`);
    }
    assert.ok(WOODSMAN_CAP > WORK_CAP, 'лесник не лучше обычных рук');
    assert.ok(
      WOODSMAN_CAP < (TENT_COST.wood ?? 0),
      `потолок лесника ${WOODSMAN_CAP} окупает палатку за ${TENT_COST.wood}`,
    );
  });

  /**
   * Тот же забор, что у обычного жильца (`residents.rules.ts`): работа рук
   * игрока обязана оставаться быстрее на порядки, иначе выгоднее не играть.
   */
  test('лесник всё равно медленнее рук игрока в сотню раз', () => {
    const handUnit = CHOP_SECONDS / CHOP_WOOD_AVG;
    assert.ok(
      WORK_SECONDS / WOODSMAN_SWING >= handUnit * 100,
      `лесник: ${WORK_SECONDS / WOODSMAN_SWING} с против ${handUnit} с у игрока — слишком быстро`,
    );
  });

  test('без крыши лесник не работает, но ест наравне со всеми', () => {
    const camp = createCamp();
    admit(camp, woodsman('Лесник'));
    assert.deepEqual(workDone(camp, WORK_SECONDS * WORK_CAP), [], 'бездомный лесник принёс дерево');
    assert.equal(mouths(camp), 1, 'купленный человек не числится ртом');
    assert.ok(upkeepDue(camp, WORK_SECONDS).food > 0, 'лесник не ест');
  });

  test('кладовая конечна и лесника не отменяет', () => {
    const camp = createCamp();
    camp.resources.wood = 500;
    admit(camp, woodsman('Лесник'));
    buildTent(camp);
    const before = camp.resources.wood;
    const got = collectWork(camp, WORK_SECONDS * WORK_CAP * 2);
    const brought = got.find((g) => g.kind === 'wood')?.n ?? 0;
    assert.equal(camp.resources.wood - before, brought, 'принесённое разошлось с положенным в кладовую');
  });

  test('разговор идёт вперёд и по одному кадру', () => {
    const talk = startHireTalk();
    assert.equal(talk.step, HIRE_ORDER[0]);
    assert.equal(advanceHire(talk), 'уговор');
    assert.equal(advanceHire(talk), 'кончено');
    assert.equal(advanceHire(talk), 'кончено', 'разговор поехал дальше последнего кадра');
    assert.equal(talk.hired, false, 'листание кадров наняло человека');
  });

  test('цена названа строкой и числом', () => {
    assert.match(hireLine(WOODSMAN_COIN), new RegExp(String(WOODSMAN_COIN)));
  });
});
