/**
 * Правила жильцов и палаток (`residents.ts`).
 *
 * Проверяется то, что ломается молча: что приглашение не запирает игрока,
 * что палатка не превращается в обязательство крупнее настоящей постройки
 * и что следы не налезают друг на друга. Последнее глазом ловится хуже
 * всего — две палатки, стоящие в одной клетке, снаружи выглядят одной.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILDING_ORDER, BUILD_COST, campArea, createCamp } from './camp';
import type { CampState } from './camp';
import { CHOP_SECONDS, CHOP_WOOD_AVG } from './logging';
import { MINE_SECONDS, MINE_STONE_AVG } from './stones';
import { SELF_ANSWERS, generateSettler } from './settler';
import {
  RESIDENT_WORK,
  TENT_COST,
  TENT_FOOT,
  TENT_ROOM,
  admit,
  buildTent,
  dwellers,
  homeless,
  homelessFolk,
  roofs,
  WORK_CAP,
  WORK_SECONDS,
  HUNT_SECONDS,
  HUNT_UNLOCK_FOXES,
  assignWork,
  assignSchedule,
  collectHunts,
  collectWork,
  huntYield,
  recallHunt,
  residentUuid,
  residentPhaseAt,
  scheduledWorkSeconds,
  startHunt,
  tentBlock,
  tentSpot,
  workDone,
} from './residents';
import type { Resident } from './residents';
import { totalOf } from './resources';
import type { Resources } from './resources';

const guest = (name: string): Resident => ({ name, look: 'поселенец', seed: name.length, answer: 'строим', rest: false });

const rich = (): CampState => {
  const camp = createCamp();
  camp.resources.wood = 500;
  camp.resources.stone = 500;
  return camp;
};

describe('Жильцы и палатки', () => {
  /**
   * Пустой лагерь — герой под крышей и ни одного задания. Если бы задание
   * висело с самого начала, оно читалось бы как недоделка лагеря, а не как
   * следствие приглашения.
   */
  test('до знакомства крыша есть у всех', () => {
    const camp = createCamp();
    assert.equal(dwellers(camp), 1, 'герой должен считаться жильцом');
    assert.equal(roofs(camp), 1, 'Жильё — это палатка, и она одна');
    assert.equal(homeless(camp), 0);
    assert.equal(tentBlock(camp), 'nobody', 'палатка про запас не предлагается');
  });

  /**
   * **Главное свойство кадра: приглашение не запирается за ценой.** Игрок
   * встречает поселенца до того, как у него есть дерево на палатку, и отказ
   * в этот момент отменял бы само знакомство. Нехватка крыши обязана быть
   * заданием, а не запретом.
   */
  test('приглашённый входит в лагерь и без крыши', () => {
    const camp = createCamp();
    camp.resources.wood = 0;
    assert.ok(admit(camp, guest('Гита')), 'приглашение отклонено при пустом кошельке');
    assert.equal(homeless(camp), 1, 'без палатки он обязан числиться без крыши');
    assert.equal(tentBlock(camp), 'resources', 'причина обязана называть, чего не хватает');
  });

  /** Приглашённый входит с тем лицом, с каким сидел на прогалине. */
  test('лицо приходит в лагерь вместе с человеком', () => {
    const camp = rich();
    const met = generateSettler(77);
    admit(camp, { name: met.name, look: met.look, seed: met.seed, answer: 'строим', rest: false });
    const lives = camp.residents[0]!;
    assert.equal(lives.seed, met.seed, 'жилец сменил лицо на входе');
    assert.equal(lives.look, met.look, 'жилец сменил вид на входе');
  });

  /**
   * Задание показывает того самого человека, а не первого попавшегося:
   * лицо в строке обязано совпадать со счётом без крыши, иначе игрок ставит
   * палатку и видит, что просил её кто-то другой.
   */
  test('без крыши остаются последние пришедшие, и счёт с ними сходится', () => {
    const camp = rich();
    for (let n = 1; n <= 4; n++) admit(camp, guest(`Гость ${n}`));
    assert.equal(homelessFolk(camp).length, homeless(camp), 'счёт и список разошлись');
    assert.equal(homelessFolk(camp)[0]!.name, 'Гость 1', 'крышу ждёт не тот, кто пришёл раньше');
    buildTent(camp);
    assert.equal(homelessFolk(camp).length, homeless(camp), 'после палатки счёт разошёлся');
    assert.equal(homelessFolk(camp)[0]!.name, 'Гость 2', 'палатка досталась не первому в очереди');
  });

  test('один и тот же человек не приходит дважды', () => {
    const camp = rich();
    assert.ok(admit(camp, guest('Гита')));
    assert.ok(!admit(camp, guest('Гита')), 'тот же человек принят второй раз');
    assert.equal(camp.residents.length, 1);
  });

  /**
   * Палатка вмещает одного, и это вся механика: каждый новый житель стоит
   * ещё одной палатки. Стоит вместимости стать двойкой — и задание перестаёт
   * появляться на втором жильце, то есть перестаёт быть правилом.
   */
  test('каждому жильцу нужна своя палатка', () => {
    const camp = rich();
    assert.equal(TENT_ROOM, 1, 'вместимость палатки — единица, и на ней стоит весь кадр');
    for (let n = 1; n <= 4; n++) {
      assert.ok(admit(camp, guest(`Гость ${n}`)));
      assert.equal(homeless(camp), 1, `жилец ${n}: задание не появилось`);
      assert.ok(buildTent(camp) !== null, `жилец ${n}: палатка не встала`);
      assert.equal(homeless(camp), 0, `жилец ${n}: палатка не закрыла задание`);
      assert.equal(roofs(camp), 1 + n);
    }
  });

  /**
   * Цена — черновая (§20.3 требует замера), но две её связи проверяются
   * уже сейчас: палатка не может быть обязательством крупнее настоящей
   * постройки, и платится она деревом. Дерево бесконечно по кромке (§13.3),
   * а значит задание «поставить палатку» не запирается навсегда.
   */
  test('палатка дешевле настоящей постройки и платится деревом', () => {
    const cost = TENT_COST as Resources;
    const full: Resources = {
      wood: cost.wood ?? 0,
      stone: cost.stone ?? 0,
      iron: cost.iron ?? 0,
      crystal: cost.crystal ?? 0,
      food: 0,
    };
    const rung: Resources = {
      wood: BUILD_COST[2]?.wood ?? 0,
      stone: BUILD_COST[2]?.stone ?? 0,
      iron: BUILD_COST[2]?.iron ?? 0,
      crystal: BUILD_COST[2]?.crystal ?? 0,
      food: 0,
    };
    assert.ok(totalOf(full) < totalOf(rung), `палатка ${totalOf(full)} не дешевле ступени ${totalOf(rung)}`);
    assert.ok((full.wood ?? 0) > 0, 'палатка не платится деревом — задание может запереться');
    assert.equal(full.iron, 0, 'в палатке железо: задание запрётся на дефицитном ресурсе');
    assert.equal(full.crystal, 0, 'в палатке кристалл: задание запрётся на дефицитном ресурсе');
  });

  test('палатка списывает цену, а не встаёт даром', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    const before = { ...camp.resources };
    buildTent(camp);
    assert.equal(camp.resources.wood, before.wood - (TENT_COST.wood ?? 0), 'дерево не списано');
  });

  /**
   * Следы не налезают ни на здания, ни друг на друга. Следы при этом
   * **разные**: у здания 2×2, у палатки 1×1, и первая версия проверки
   * мерила оба размером палатки — палатки садились прямо на Кухню.
   * Поймал это не глаз, а `npm run tents`: занятость площадки вышла 125%.
   */
  test('палатки не садятся ни на здания, ни друг на друга', () => {
    const camp = rich();
    const walls: { x: number; z: number; foot: number }[] = [];
    for (const id of BUILDING_ORDER) {
      if (camp.levels[id] > 0) walls.push({ ...camp.layout[id]!, foot: 2 });
    }
    for (let n = 0; n < 12; n++) {
      admit(camp, guest(`Гость ${n}`));
      const spot = buildTent(camp);
      if (spot === null) break;
      for (const p of walls) {
        const overlap: boolean =
          spot.x < p.x + p.foot &&
          spot.x + TENT_FOOT > p.x &&
          spot.z < p.z + p.foot &&
          spot.z + TENT_FOOT > p.z;
        assert.ok(!overlap, `палатка (${spot.x},${spot.z}) села на след (${p.x},${p.z})`);
      }
      walls.push({ ...spot, foot: TENT_FOOT });
    }
    assert.ok(walls.length > BUILDING_ORDER.length, 'ни одной палатки не встало');
  });

  /**
   * Место палатки выбирает игрок — тем же жестом, что перестановку зданий
   * (§20.4). Автовыбор в первой версии сажал палатку в клетку под визуальным
   * свесом шатра Жилья, и снаружи это читалось палаткой, выросшей из чужой.
   * Выбранное место обязано приниматься, чужой след и заграница площадки —
   * отказываться, и отказ не должен стоить дерева.
   */
  test('игрок выбирает клетку палатки, и отказ не списывает цену', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    const wood = camp.resources.wood;
    const area = campArea(camp.levels.hq);
    assert.equal(buildTent(camp, camp.layout.hq), null, 'палатка встала на след Жилья');
    assert.equal(buildTent(camp, { x: -1, z: 0 }), null, 'палатка встала за площадкой');
    assert.equal(buildTent(camp, { x: area, z: 0 }), null, 'палатка встала за кромкой площадки');
    assert.equal(camp.resources.wood, wood, 'отказ списал дерево');
    const spot = buildTent(camp, { x: 0, z: area - 1 });
    assert.deepEqual(spot, { x: 0, z: area - 1 }, 'свободная клетка игрока не принята');
    assert.deepEqual(camp.tents[0], spot, 'палатка встала не туда, куда показал игрок');
    admit(camp, guest('Гера'));
    assert.equal(buildTent(camp, spot!), null, 'вторая палатка села на первую');
  });

  /**
   * **Два свойства, которые нашёл замер, и оба он же сторожит.**
   *
   * Первое: ни на одном уровне Жилья вместимость не равна нулю. При следе
   * 2×2 на ур. 2 не влезало ни одной палатки, и задание «поставить палатку»
   * упиралось в тупик на первом же жильце.
   *
   * Второе: вместимость не падает с ростом Жилья. Лагерь, который растёт
   * и теряет места, — это не ограничение, а поломка, и читается она
   * как поломка.
   */
  test('площадка вмещает жильцов на каждом уровне и не теряет мест с ростом', () => {
    const fits: number[] = [];
    for (let hq = 1; hq <= 5; hq++) {
      const camp = createCamp();
      camp.levels.hq = hq;
      if (hq >= 2) camp.levels.forge = 1;
      camp.resources.wood = 99999;
      let tents = 0;
      for (let n = 0; n < 200; n++) {
        admit(camp, guest(`Гость ${n}`));
        if (buildTent(camp) === null) break;
        tents++;
      }
      fits.push(tents);
    }
    for (let hq = 0; hq < fits.length; hq++) {
      assert.ok(fits[hq]! > 0, `Жильё ${hq + 1}: ноль палаток — задание упирается в тупик`);
      if (hq > 0) {
        assert.ok(
          fits[hq]! >= fits[hq - 1]!,
          `Жильё ${hq + 1}: мест стало меньше (${fits[hq - 1]} → ${fits[hq]}) — лагерь растёт и теряет места`,
        );
      }
    }
  });

  /**
   * Первая палатка не прячется за здание. Камера в лагере не крутится,
   * и клетка вплотную позади Жилья — это «не видно никогда», а не «под
   * другим углом»: игрок платит пять дерева и не видит ничего. Ровно это
   * и случилось с первой версией — палатка садилась на (1,0), за шатёр.
   *
   * Проверяется на первых палатках, а не на всех: когда площадка забита,
   * спрятанная клетка лучше отказа, и правило это разрешает.
   */
  test('первые палатки не встают за зданиями', () => {
    const camp = rich();
    for (let n = 0; n < 3; n++) {
      admit(camp, guest(`Гость ${n}`));
      const spot = buildTent(camp);
      assert.ok(spot !== null, `палатка ${n} не встала`);
      for (const id of BUILDING_ORDER) {
        if (camp.levels[id] <= 0) continue;
        const p = camp.layout[id]!;
        const sameColumn: boolean = spot.x < p.x + 2 && spot.x + TENT_FOOT > p.x;
        assert.ok(
          !(sameColumn && p.z > spot.z && p.z - spot.z <= 2),
          `палатка (${spot.x},${spot.z}) спряталась за ${id} (${p.x},${p.z})`,
        );
      }
    }
  });

  /* ---------- чем жилец занят ---------- */

  /**
   * **То, ради чего вопрос знакомства существует.** Два ответа обязаны
   * приводить к разным ресурсам: если оба дают одно и то же, вопрос
   * снова становится тем самым выбором происхождения, который отвергнут
   * за то, что ничего не менял.
   */
  test('ответ выбирает, что жилец приносит', () => {
    const kinds = SELF_ANSWERS.map((a) => RESIDENT_WORK[a]);
    assert.equal(new Set(kinds).size, kinds.length, 'оба ответа дают один и тот же ресурс');
    for (const kind of kinds) {
      assert.ok(
        kind === 'wood' || kind === 'stone',
        `жилец приносит ${kind}: §13.2 держит дефицит железа и кристалла, и он — вся глубина`,
      );
    }
  });

  /**
   * Жилец медленнее игрока на порядки. Сравнивается цена **единицы** ресурса
   * руками: секунды дерева и валуна на их среднюю награду (и топор,
   * и кайло отдают 3–5 за работу). Жилец, работающий сравнимо, отменял бы
   * саму работу руками — выгоднее было бы не играть.
   */
  test('жилец работает медленнее рук игрока в сотню раз', () => {
    const handUnit = Math.min(MINE_SECONDS / MINE_STONE_AVG, CHOP_SECONDS / CHOP_WOOD_AVG);
    assert.ok(
      WORK_SECONDS >= handUnit * 100,
      `жилец: ${WORK_SECONDS} с против ${handUnit} с за единицу у игрока — слишком быстро`,
    );
  });

  /**
   * Потолок ниже цены палатки. Иначе жилец окупает следующего жильца,
   * приглашённые начинают селить друг друга, и палатка перестаёт
   * что-либо стоить.
   */
  test('жилец не окупает следующую палатку', () => {
    assert.ok(
      WORK_CAP < (TENT_COST.wood ?? 0),
      `потолок ${WORK_CAP} не ниже цены палатки ${TENT_COST.wood}`,
    );
  });

  /** Отлучка на неделю не отменяет вылазки: потолок держит одну отлучку. */
  test('потолок держит любую отлучку', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    for (const away of [WORK_SECONDS * 4, 3600 * 24, 3600 * 24 * 30]) {
      const done = workDone(camp, away);
      assert.equal(done.length, 1);
      assert.equal(done[0]!.n, WORK_CAP, `отлучка ${away} с дала ${done[0]!.n} вместо потолка`);
    }
  });

  test('короткая отлучка не даёт ничего, и недоработанное не копится', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    assert.deepEqual(workDone(camp, WORK_SECONDS - 1), [], 'единица выдана за неполный срок');
    // Дважды подряд по половине срока — по-прежнему ничего: доля не хранится.
    collectWork(camp, WORK_SECONDS / 2);
    const before = camp.resources.wood;
    collectWork(camp, WORK_SECONDS / 2);
    assert.equal(camp.resources.wood, before, 'доля накопилась между отлучками');
  });

  test('отправленный в клан жилец не работает одновременно на личный склад', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    const id = residentUuid(camp.residents[0]!);
    assert.deepEqual(
      workDone(camp, WORK_SECONDS * WORK_CAP, undefined, undefined, new Set([id])),
      [],
    );
  });

  /**
   * Работает только тот, у кого есть крыша: задание, сказанное третий раз.
   * Человек, ночующий у костра, за работу не берётся, и видно это
   * прибавкой, которой не случилось.
   */
  test('бездомный жилец не работает', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    assert.deepEqual(workDone(camp, WORK_SECONDS * 10), [], 'бездомный наработал');
    buildTent(camp);
    assert.equal(workDone(camp, WORK_SECONDS * 10).length, 1, 'под крышей — а всё равно не работает');
  });

  test('оба ответа складываются каждый в свой ресурс', () => {
    const camp = rich();
    admit(camp, { name: 'Строитель', look: 'поселенец', seed: 1, answer: 'строим', rest: false });
    buildTent(camp);
    admit(camp, { name: 'Ходок', look: 'торговец', seed: 2, answer: 'ходим', rest: false });
    buildTent(camp);
    // Богатый лагерь этого файла стоит выше потолка кладовой (§13.6),
    // а здесь меряется делёж по видам — место обязано быть.
    camp.resources.wood = 10;
    camp.resources.stone = 0;
    const wood = camp.resources.wood;
    const stone = camp.resources.stone;
    collectWork(camp, WORK_SECONDS * WORK_CAP);
    assert.equal(camp.resources.wood - wood, WORK_CAP, 'дерева пришло не столько');
    assert.equal(camp.resources.stone - stone, WORK_CAP, 'камня пришло не столько');
  });

  /**
   * **Отдых — не третье занятие, а отложенный инструмент.** Отдыхающий
   * не приносит ничего: прибавка от отдыха была бы работой под другим
   * именем, у которой §20.3 потребовал бы замера. Занятие при этом
   * не стирается — отдых кончается, и жилец возвращается к своему делу,
   * а не к умолчанию.
   */
  test('отдыхающий не приносит ничего, а занятие помнит', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    assert.ok(assignWork(camp, 0, 'отдых'), 'приказ отдыхать не принят');
    assert.deepEqual(workDone(camp, WORK_SECONDS * 10), [], 'отдыхающий наработал');
    assert.equal(camp.residents[0]!.answer, 'строим', 'отдых стёр занятие');
    assert.ok(assignWork(camp, 0, 'строим'), 'возврат к занятию не принят');
    assert.equal(workDone(camp, WORK_SECONDS * 10).length, 1, 'вернувшийся не работает');
  });

  /** Приказ, повторяющий происходящее, — не приказ: и у занятия, и у отдыха. */
  test('повторный приказ не принимается', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    assert.equal(assignWork(camp, 0, 'строим'), false, 'повтор занятия прошёл приказом');
    assert.ok(assignWork(camp, 0, 'отдых'));
    assert.equal(assignWork(camp, 0, 'отдых'), false, 'повтор отдыха прошёл приказом');
    assert.ok(assignWork(camp, 0, 'строим'), 'то же занятие после отдыха — уже приказ');
  });

  /** Палатка не вылезает за площадку: за кромкой её попросту не видно. */
  test('палатка стоит внутри площадки', () => {
    const camp = rich();
    const area = campArea(camp.levels.hq);
    for (let n = 0; n < 30; n++) {
      admit(camp, guest(`Гость ${n}`));
      const spot = buildTent(camp);
      if (spot === null) break;
      assert.ok(spot.x >= 0 && spot.z >= 0, `палатка ушла в минус: (${spot.x},${spot.z})`);
      assert.ok(
        spot.x + TENT_FOOT <= area && spot.z + TENT_FOOT <= area,
        `палатка (${spot.x},${spot.z}) вылезла за площадку ${area}×${area}`,
      );
    }
  });

  /**
   * Когда места нет — причина называется «нет места», а не «не хватает
   * дерева»: соврать о причине хуже, чем отказать.
   */
  test('кончившееся место названо местом, а не деньгами', () => {
    const camp = rich();
    for (let n = 0; n < 300; n++) {
      admit(camp, guest(`Гость ${n}`));
      if (tentSpot(camp) === null) break;
      buildTent(camp);
    }
    assert.equal(tentSpot(camp), null, 'площадка так и не кончилась — проверять нечего');
    assert.equal(tentBlock(camp), 'area');
  });

  test('расписание оставляет отдельное время сну, еде и работе', () => {
    const r = guest('Гита');
    assert.equal(residentPhaseAt(r, 3 * 3600), 'сон');
    assert.equal(residentPhaseAt(r, 6 * 3600 + 30 * 60), 'еда');
    assert.equal(residentPhaseAt(r, 8 * 3600), 'работа');
    assert.equal(residentPhaseAt(r, 20 * 3600), 'свободен');
    assert.equal(scheduledWorkSeconds(r, 0, 24 * 3600), 10 * 3600);
  });

  test('смена расписания двигает окна, но не меняет их длину', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    assert.ok(assignSchedule(camp, 0, 'ранняя'));
    const r = camp.residents[0]!;
    assert.equal(residentPhaseAt(r, 5 * 3600), 'работа');
    assert.equal(residentPhaseAt(r, 21 * 3600), 'сон');
    assert.equal(scheduledWorkSeconds(r, 0, 24 * 3600), 10 * 3600);
  });

  test('охота открывается на десятой лисе и длится пять часов', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    camp.foxesCaught = HUNT_UNLOCK_FOXES - 1;
    assert.equal(startHunt(camp, 0, 100), false, 'охота открылась раньше порога');
    camp.foxesCaught = HUNT_UNLOCK_FOXES;
    assert.ok(startHunt(camp, 0, 100));
    assert.equal(camp.residents[0]!.hunt!.endsAt, 100 + HUNT_SECONDS);
    assert.deepEqual(collectHunts(camp, 100 + HUNT_SECONDS - 1), []);
  });

  test('охотник ловит от нуля до пяти лис и приносит две части мяса и шкуру', () => {
    for (let seed = 0; seed < 100; seed++) {
      const caught = huntYield({ startedAt: 0, endsAt: HUNT_SECONDS, seed });
      assert.ok(caught >= 0 && caught <= 5, `сид ${seed}: поймано ${caught}`);
    }
    const camp = rich();
    camp.resources.wood = 0;
    camp.resources.stone = 0;
    admit(camp, guest('Гита'));
    camp.resources.wood = TENT_COST.wood ?? 0;
    buildTent(camp);
    camp.foxesCaught = HUNT_UNLOCK_FOXES;
    startHunt(camp, 0, 100);
    const report = collectHunts(camp, 100 + HUNT_SECONDS)[0]!;
    assert.equal(report.meat, report.foxes * 2);
    assert.equal(report.pelts, report.foxes);
    assert.equal(camp.foxesCaught, HUNT_UNLOCK_FOXES + report.foxes);
  });

  test('отзыв возвращает жильца без награды', () => {
    const camp = rich();
    admit(camp, guest('Гита'));
    buildTent(camp);
    camp.foxesCaught = HUNT_UNLOCK_FOXES;
    assert.ok(startHunt(camp, 0, 100));
    const before = { ...camp.resources };
    assert.ok(recallHunt(camp, 0));
    assert.deepEqual(collectHunts(camp, 100 + HUNT_SECONDS), []);
    assert.deepEqual(camp.resources, before);
  });
});
