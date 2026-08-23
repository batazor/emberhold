/**
 * Правила мира (§4). Числа истощения пришли из артбука `world.html` как
 * предложение, и проверяются здесь тем же способом, что и всё остальное
 * в этом проекте: замером, а не рассуждением.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AWAKE_SEC,
  CAMP_DAY,
  CAMP_NIGHT,
  KIND,
  CLANS,
  DAY_SEC,
  RICH_MAX,
  RICH_WINDOW,
  SHIFTS_PER_DAY,
  SHIFT_SEC,
  WORLD_EPOCH,
  CLAN_CAMPS,
  CLAN_STAY,
  LIVE_SHOWN,
  liveCampSpots,
  clanGrowth,
  clanState,
  clanTier,
  dayAt,
  dayStartShift,
  liveVisits,
  lootMul,
  nightAt,
  nodeSeed,
  phaseAt,
  regionAt,
  shiftAt,
  SLEEP_SEC,
  WAKE_AT,
  worldAt,
} from './world';
import type { Visit } from './world';

/** Третий день мира: кланы уже расселились, а игрок только пришёл. */
const DAY0 = dayAt(WORLD_EPOCH) + 3;
/** Полдень: окно богатства к этому часу успело раскрыться целиком. */
const T0 = (dayStartShift(DAY0) + RICH_WINDOW) * SHIFT_SEC;

/** Момент и точка, которых кланы не касались всё окно, — чистый стенд. */
function quietNode(): { t: number; node: number } {
  for (let s = 0; s < 500; s++) {
    const t = T0 + s * SHIFT_SEC;
    const now = shiftAt(t);
    if (now - dayStartShift(dayAt(t)) < RICH_WINDOW) continue; // окно ещё не полное
    for (const node of regionAt(dayAt(t)).nodes) {
      let free = true;
      for (let back = 0; back < RICH_WINDOW && free; back++) {
        for (let k = 0; k < CLANS.length; k++) {
          if (clanState(k, (now - back) * SHIFT_SEC).nodes.includes(node.id)) {
            free = false;
            break;
          }
        }
      }
      if (free) return { t, node: node.id };
    }
  }
  throw new Error('в регионе не нашлось точки без кланов на всё окно');
}

describe('Мир: карта локаций', () => {
  test('§4 — регион это один экран: точки не налезают друг на друга', () => {
    for (let day = DAY0; day < DAY0 + 60; day++) {
      const region = regionAt(day);
      assert.ok(region.nodes.length >= 16, `день ${day}: точек ${region.nodes.length}`);
      for (const node of region.nodes) {
        assert.ok(node.x > 0.02 && node.x < 0.98, `${node.name}: за экраном по x`);
        assert.ok(node.y > 0.02 && node.y < 0.98, `${node.name}: за экраном по y`);
      }
      const seen = new Set(region.nodes.map((n) => n.name));
      assert.equal(seen.size, region.nodes.length, `день ${day}: имя повторилось`);
      for (const a of region.nodes) {
        for (const b of region.nodes) {
          if (a.id >= b.id) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          assert.ok(d > 0.05, `день ${day}: ${a.name} и ${b.name} слились в одну точку`);
        }
      }
    }
  });

  test('§4 — регион пересобирается каждый день и постоянного расклада не держит', () => {
    const shape = (day: number): string =>
      regionAt(day)
        .nodes.map((n) => `${n.tier}:${n.x.toFixed(3)}`)
        .join(',');
    let same = 0;
    const tiers = new Set<number>();
    const counts = new Set<number>();
    for (let day = DAY0; day < DAY0 + 60; day++) {
      if (shape(day) === shape(day + 1)) same++;
      counts.add(regionAt(day).nodes.length);
      for (const node of regionAt(day).nodes) tiers.add(node.tier);
    }
    assert.equal(same, 0, 'два дня подряд с одинаковой картой');
    assert.ok(counts.size > 1, 'число точек не меняется — раздача не случайна');
    assert.deepEqual([...tiers].sort(), [0, 1, 2, 3], 'за два месяца встречаются все ярусы');
    // Дни, где рядом только дорогие места, обязаны быть возможны: постоянного
    // соотношения ярусов нет намеренно.
    //
    // Считаются **вылазки**, а не все точки. Ярус есть у каждой записи, но
    // значит он что-то только у вылазки: замок и кладбище стоят нулевыми
    // потому, что ставки у них нет вовсе, и складывать их с дешёвыми
    // вылазками — считать одно другим.
    let lopsided = 0;
    for (let day = DAY0; day < DAY0 + 200; day++) {
      const cheap = regionAt(day).nodes.filter((n) => n.kind === 'вылазка' && n.tier === 0).length;
      if (cheap <= 2) lopsided++;
    }
    assert.ok(lopsided > 0, 'нулевой ярус всегда представлен поровну — это расписание');
  });

  /**
   * Особые точки раньше добавлялись по одной и **пропадали молча**: клетка
   * бралась из колоды по `cells[nodes.length]`, а в людный день колода
   * кончалась, и `undefined` тихо отменял точку. Правило написано ровно
   * на это: раздача обещает и замок, и кладбище каждый день, и обещание
   * не должно зависеть от того, сколько выпало вылазок.
   */
  test('§4 — особые точки выпадают каждый день и не пропадают в людный', () => {
    for (let day = DAY0; day < DAY0 + 200; day++) {
      const nodes = regionAt(day).nodes;
      for (const kind of ['замок', 'кладбище'] as const) {
        const count = nodes.filter((n) => n.kind === kind).length;
        assert.ok(count >= 1, `день ${day}: ${kind} не выпал вовсе`);
        assert.ok(count <= 3, `день ${day}: ${kind} выпал ${count} раз`);
      }
      assert.equal(
        nodes.filter((n) => n.kind === 'замок минотавра').length,
        1,
        `день ${day}: замок минотавра должен быть ровно один`,
      );
      // Раздача вылазок не тронута особыми точками: их число прежнее.
      const raids = nodes.filter((n) => n.kind === 'вылазка').length;
      assert.ok(raids >= 16 && raids <= 22, `день ${day}: вылазок ${raids}`);
    }
  });

  test('§4 — числа особых точек день на день не приходятся', () => {
    const seen = new Set<string>();
    for (let day = DAY0; day < DAY0 + 200; day++) {
      const nodes = regionAt(day).nodes;
      const keeps = nodes.filter((n) => n.kind === 'замок').length;
      const graves = nodes.filter((n) => n.kind === 'кладбище').length;
      seen.add(`${keeps}:${graves}`);
    }
    // Одна пара на двести дней означала бы, что разброс объявлен, но не выпал.
    assert.ok(seen.size >= 6, `за двести дней сочетаний ${seen.size}`);
  });

  test('§4 — день держит форму: сид точки не меняется до утра', () => {
    const first = regionAt(DAY0).nodes.map((n) => nodeSeed(DAY0, n.id));
    const again = regionAt(DAY0).nodes.map((n) => nodeSeed(DAY0, n.id));
    assert.deepEqual(first, again, 'внутри дня пещера у места одна');
    assert.equal(new Set(first).size, first.length, 'две точки не собирают одну пещеру');
    const tomorrow = regionAt(DAY0 + 1).nodes.map((n) => nodeSeed(DAY0 + 1, n.id));
    assert.notDeepEqual(first, tomorrow, 'наутро регион другой');
  });

  test('§4 — кланы не тикают: состояние это функция от сида и часов', () => {
    for (let k = 0; k < CLANS.length; k++) {
      assert.deepEqual(clanState(k, T0), clanState(k, T0), 'один и тот же момент — один ответ');
      assert.equal(clanState(k, T0).nodes.length, 1, 'клан держит одну точку (замер ниже)');
      assert.ok(
        clanState(k, WORLD_EPOCH + 30 * DAY_SEC).level >
          clanState(k, WORLD_EPOCH + DAY_SEC).level,
        'мир растёт без игрока',
      );
    }
  });

  /**
   * Три дыры, которые называл `npm run clans` до расселения одной колодой:
   * клан на прогулочной точке невидим (флага там нет), второй клан на той же
   * точке невидим тоже (рисуется первый), а переезд каждую смену — телепорт,
   * который игрок не успевает прочитать. Все три закрыты по построению,
   * и правило стережёт построение.
   */
  test('§4 — кланы занимают вылазки, не толпятся и держат стоянку', () => {
    for (let day = DAY0; day < DAY0 + 30; day++) {
      const region = regionAt(day);
      for (let s = 0; s < SHIFTS_PER_DAY; s++) {
        const t = (dayStartShift(day) + s) * SHIFT_SEC;
        const taken = new Set<number>();
        for (let k = 0; k < CLANS.length; k++) {
          const node = clanState(k, t).nodes[0];
          assert.notEqual(node, undefined, `день ${day}: клану ${k} не досталось точки`);
          const spot = region.nodes[node!]!;
          assert.ok(KIND[spot.kind].raidable, `день ${day}: клан ${k} на прогулке (${spot.kind})`);
          assert.ok(!taken.has(node!), `день ${day}, смена ${s}: двое на «${spot.name}»`);
          taken.add(node!);
          // Внутри стоянки точка одна: смена внутри того же блока CLAN_STAY
          // обязана отвечать тем же местом, иначе оседлость — случайность.
          const blockStart = (dayStartShift(day) + s - (s % CLAN_STAY)) * SHIFT_SEC;
          assert.equal(node, clanState(k, blockStart).nodes[0], 'точка уплыла внутри стоянки');
        }
      }
    }
  });

  test('§4 — фракции различимы: клан работает ярус своего характера', () => {
    // До характера все четыре гистограммы ярусов совпадали, и фракции,
    // которые §4 велит отличать, отличались только цветом флага.
    for (let k = 0; k < CLANS.length; k++) {
      const want = clanTier(k);
      const hist = [0, 0, 0, 0];
      for (let day = DAY0; day < DAY0 + 30; day++) {
        const region = regionAt(day);
        for (let s = 0; s < SHIFTS_PER_DAY; s += CLAN_STAY) {
          const t = (dayStartShift(day) + s) * SHIFT_SEC;
          hist[region.nodes[clanState(k, t).nodes[0]!]!.tier]++;
        }
      }
      const top = hist.indexOf(Math.max(...hist));
      assert.equal(top, want, `${CLANS[k]!.name}: характер ярус ${want}, а живёт на ${top}`);
    }
  });

  test('§4 — заход стоит один из трёх, покой возвращает за 6 часов', () => {
    const { t, node } = quietNode();
    assert.equal(worldAt(t)[node]!.rich, RICH_MAX, 'нетронутая локация полна');

    const one: Visit[] = [{ node, shift: shiftAt(t) }];
    assert.equal(worldAt(t, one)[node]!.rich, RICH_MAX - 1, 'заход стоит один из трёх');

    const three: Visit[] = [0, 1, 2].map((i) => ({ node, shift: shiftAt(t) - i }));
    assert.equal(worldAt(t, three)[node]!.rich, 0, 'три захода подряд — выработана');
    assert.ok(worldAt(t, three)[node]!.restShifts > 0, 'выработанная называет срок');

    // Полное восстановление — 6 часов, то есть окно целиком.
    const later = t + RICH_WINDOW * SHIFT_SEC;
    assert.equal(worldAt(later, three)[node]!.rich, RICH_MAX, 'через 6 часов жила снова полна');
  });

  test('§4 — утро отменяет вчерашние заходы: региона того больше нет', () => {
    const evening = (dayStartShift(DAY0 + 1) - 1) * SHIFT_SEC;
    const visits: Visit[] = [0, 1, 2].map((i) => ({ node: 0, shift: shiftAt(evening) - i }));
    assert.ok(worldAt(evening, visits)[0]!.rich < RICH_MAX, 'вечером место просело');
    const morning = dayStartShift(DAY0 + 1) * SHIFT_SEC;
    assert.equal(worldAt(morning, visits)[0]!.rich, RICH_MAX, 'наутро жила полна');
    assert.equal(liveVisits(visits, morning).length, 0, 'вчерашние заходы не хранятся');
  });

  test('§4 — выработанная локация это плохая сделка, а не запрет', () => {
    assert.equal(lootMul(0), 0.4, 'артбук: 0 из 3 — добыча ×0,4');
    assert.equal(lootMul(RICH_MAX), 1, 'артбук: 3 из 3 — полная жила');
    for (let r = 1; r <= RICH_MAX; r++) {
      assert.ok(lootMul(r) > lootMul(r - 1), 'богаче никогда не хуже');
    }
    assert.ok(lootMul(0) > 0, 'запрета нет: идти можно, просто невыгодно');
  });

  test('§4 — карта учит выбирать, а не ждать: три богатых всегда доступны', () => {
    // Условие артбука: в любой момент у игрока есть минимум три локации
    // с богатством ≥ 2. Если оно нарушается, карта отправляет игрока ждать,
    // а ждёт он вне игры.
    //
    // Нагрузка — верхняя граница сессии по §21: пять вылазок подряд, четыре
    // сессии в сутки, и каждый раз в самое богатое место, то есть игрок
    // выжигает карту так быстро, как позволяют правила.
    for (let day = DAY0; day < DAY0 + 30; day++) {
      const nodes = regionAt(day).nodes;
      const visits: Visit[] = [];
      let worst = { shift: 0, count: nodes.length };
      for (let s = 0; s < SHIFTS_PER_DAY; s++) {
        const t = (dayStartShift(day) + s) * SHIFT_SEC;
        if (s % RICH_WINDOW === 0) {
          for (let raid = 0; raid < 5; raid++) {
            const world = worldAt(t, visits);
            const best = [...nodes].sort((a, b) => world[b.id]!.rich - world[a.id]!.rich)[0]!;
            visits.push({ node: best.id, shift: shiftAt(t) });
          }
        }
        const world = worldAt(t, visits);
        // Богатство считается по вылазкам: прогулочная точка стоит полной
        // и не тратится никогда, потому что тратить в ней нечего. Три
        // «богатых» кладбища вместо трёх богатых вылазок прошли бы правило,
        // не дав игроку ровно того, ради чего оно написано.
        const count = nodes.filter((n) => n.kind === 'вылазка' && world[n.id]!.rich >= 2).length;
        if (count < worst.count) worst = { shift: s, count };
      }
      assert.ok(
        worst.count >= 3,
        `день ${day}: на смене ${worst.shift} осталось ${worst.count} богатых ` +
          `локаций из ${nodes.length} — карта учит ждать, а не выбирать`,
      );
    }
  });

  test('§6 — в сохранении живут только дельты, и их число ограничено', () => {
    const visits: Visit[] = [];
    for (let s = 0; s < 200; s++) visits.push({ node: s % 16, shift: shiftAt(T0) + s });
    const t = T0 + 200 * SHIFT_SEC;
    const live = liveVisits(visits, t);
    assert.ok(live.length <= RICH_WINDOW, 'старые заходы выброшены');
    assert.deepEqual(
      worldAt(t, live).map((n) => n.rich),
      worldAt(t, visits).map((n) => n.rich),
      'чистка не меняет мир: выброшено то, что уже ни на что не влияет',
    );
  });

  /*
   * Виды узла описаны таблицей, а не россыпью проверок `kind === …`.
   *
   * Проверок было семь на три вида, в двух файлах, и ни одну компилятор
   * не ловил. Кладбище приехало третьим и половину не задело: событие ему
   * считалось как вылазке, а гейт Кухни пропускал по совпадению — у него
   * `tier: 0`. Правило ниже держит таблицу полной: новый вид узла упрётся
   * в него раньше, чем в игрока.
   */
  test('каждый вид узла описан в таблице, и прогулки честно помечены', () => {
    const kinds = new Set(regionAt(DAY0).nodes.map((n) => n.kind));
    for (let d = 1; d < 30; d++) {
      for (const n of regionAt(DAY0 + d).nodes) kinds.add(n.kind);
    }
    for (const kind of kinds) {
      assert.notEqual(KIND[kind], undefined, `вид «${kind}» не описан в KIND`);
    }
    // Прогулка — это разом четыре свойства, и врозь они не бывают: место
    // без добычи не запирается ярусом, не носит событий и не годится
    // в «ещё вылазку».
    for (const [kind, t] of Object.entries(KIND)) {
      if (!t.walk) continue;
      assert.equal(t.events, false, `${kind}: прогулка с событием — модифицировать нечего`);
      assert.equal(t.gated, false, `${kind}: прогулку запирает Кухня, хотя провианта ей не нужно`);
      assert.equal(t.raidable, false, `${kind}: прогулка предлагается как вылазка`);
    }
    assert.ok(KIND['вылазка'].raidable, 'вылазка перестала быть вылазкой');
  });

  test('прогулочные места не попадают туда, где ждут добычу', () => {
    // `safestNode` и `nextPlace` сортируют по ярусу и богатству. У прогулки
    // `tier: 0` и богатство всегда полное — без фильтра обе звали в замок.
    const nodes = regionAt(DAY0).nodes;
    const raidable = nodes.filter((n) => KIND[n.kind].raidable);
    assert.ok(raidable.length > 0, 'вылазок в дне не осталось');
    assert.ok(raidable.length < nodes.length, 'в дне нет ни одной прогулки — проверять нечего');
    for (const n of raidable) assert.equal(n.kind, 'вылазка');
  });
});

describe('Время суток (§24)', () => {
  /** Шаг обхода смены. Мельче секунды тут нечего ловить. */
  const STEP = 1;

  test('сутки — это смена, а не своё число', () => {
    // Второй период рядом с существующим разошёлся бы с ним молча: свет
    // говорил бы одно, а кланы и богатство — другое.
    for (const t of [0, 12345, WORLD_EPOCH, WORLD_EPOCH + 987654]) {
      assert.equal(nightAt(t), nightAt(t + SHIFT_SEC), 'свет не повторяется через смену');
      assert.equal(phaseAt(t), phaseAt(t + SHIFT_SEC));
    }
  });

  test('свет не выходит за день и ночь, а закат длиннее трёх минут', () => {
    /**
     * Порог не назначен, а выведен: скорость света меряется тем, за сколько
     * при ней прошёл бы весь размах от полудня к полуночи. Три минуты — это
     * полторы двухминутных сессии; закат быстрее читался бы не заходом
     * солнца, а щелчком выключателя, и застать его целиком успевал бы
     * один заход из многих.
     */
    const FASTEST = (CAMP_NIGHT - CAMP_DAY) / (3 * 60);
    let steepest = 0;
    let prev = nightAt(WORLD_EPOCH);
    for (let s = STEP; s <= SHIFT_SEC; s += STEP) {
      const now = nightAt(WORLD_EPOCH + s);
      assert.ok(now >= CAMP_DAY - 1e-9 && now <= CAMP_NIGHT + 1e-9, `свет ушёл за края: ${now}`);
      steepest = Math.max(steepest, Math.abs(now - prev) / STEP);
      prev = now;
    }
    assert.ok(
      steepest <= FASTEST,
      `весь размах света прошёл бы за ${Math.round((CAMP_NIGHT - CAMP_DAY) / steepest)} с — быстрее трёх минут`,
    );
  });

  test('за смену случаются и полдень, и глухая ночь', () => {
    // Сутки без плато — это не сутки, а качели: игрок обязан застать
    // и полный день, и полную ночь, а не только переходы между ними.
    let day = 0;
    let dark = 0;
    for (let s = 0; s < SHIFT_SEC; s += STEP) {
      const now = nightAt(WORLD_EPOCH + s);
      if (Math.abs(now - CAMP_DAY) < 1e-9) day++;
      if (Math.abs(now - CAMP_NIGHT) < 1e-9) dark++;
    }
    assert.ok(day * STEP > 10 * 60, `полдня всего ${Math.round((day * STEP) / 60)} мин`);
    assert.ok(dark * STEP > 8 * 60, `ночи всего ${Math.round((dark * STEP) / 60)} мин`);
  });

  test('ночь темнее сумерек кладбища и светлее подземелья', () => {
    // Связь, а не вкус: под небом не бывает так же черно, как под землёй,
    // а лагерь обязан читаться силуэтами и без факела.
    assert.ok(CAMP_NIGHT > 0.45, 'ночь лагеря светлее сумерек кладбища');
    assert.ok(CAMP_NIGHT < 1, 'ночь лагеря сравнялась с подземельем');
    assert.ok(CAMP_DAY < CAMP_NIGHT);
  });

  test('фазы идут по кругу и каждая случается', () => {
    const seen = new Set<string>();
    for (let s = 0; s < SHIFT_SEC; s += STEP) seen.add(phaseAt(WORLD_EPOCH + s));
    assert.deepEqual([...seen].sort(), ['день', 'закат', 'ночь', 'рассвет']);
    // Слово и свет обязаны сходиться: «ночь» на светлом небе — это две
    // разошедшиеся таблицы, ровно то, чего §23.3 не разрешает.
    for (let s = 0; s < SHIFT_SEC; s += STEP) {
      const t = WORLD_EPOCH + s;
      if (phaseAt(t) === 'день') assert.equal(nightAt(t), CAMP_DAY);
      if (phaseAt(t) === 'ночь') assert.equal(nightAt(t), CAMP_NIGHT);
    }
  });

  test('свет и расписание просыпаются в одну и ту же секунду', () => {
    // Границы фаз считаются в секундах ровно ради этого: на долях 0,87×2400
    // выходило то чуть больше 2088, то чуть меньше, и свет говорил «ещё
    // ночь», когда расписание уже будило жильца.
    assert.equal(phaseAt(WAKE_AT), 'рассвет', 'подъём пришёлся не на рассвет');
    assert.equal(phaseAt(WAKE_AT - 1), 'ночь', 'секундой раньше подъёма уже не ночь');
    assert.equal(nightAt(WAKE_AT), CAMP_NIGHT, 'рассвет начинается не с полной темноты');
    assert.equal(phaseAt(WAKE_AT + AWAKE_SEC), 'ночь', 'бодрствование кончилось не с темнотой');
    assert.equal(SLEEP_SEC + AWAKE_SEC, SHIFT_SEC, 'сон и явь не складываются в смену');
  });

  test('ничего не тикает: свет — функция часов, а не накопленного', () => {
    // То же правило, на котором стоит весь модуль: закрытая вкладка
    // отрабатывает сама, потому что спрашивают часы, а не счётчик.
    const t = WORLD_EPOCH + 1234;
    assert.equal(nightAt(t), nightAt(t));
    assert.equal(nightAt(t + SHIFT_SEC * 1000), nightAt(t));
  });
});

describe('Лагеря соседей (§30)', () => {
  test('лагерь фракции у каждой, и он один', () => {
    assert.equal(CLAN_CAMPS.length, CLANS.length);
    assert.equal(new Set(CLAN_CAMPS.map((c) => `${c.x}:${c.y}`)).size, CLANS.length);
  });

  /**
   * Место вечное — в этом вся разница между соседом и точкой дня. Регион
   * пересобирается каждые сутки, лагерь нет: сосед, переезжающий вместе
   * с раздачей, был бы ещё одной точкой, а не соседом.
   */
  test('лагерь не переезжает вместе с регионом', () => {
    const first = JSON.stringify(CLAN_CAMPS);
    for (let day = DAY0; day < DAY0 + 60; day++) {
      // Регион спрашивается нарочно: если места лагерей однажды начнут
      // считаться от дня, разъедутся они именно здесь.
      regionAt(day);
      assert.equal(JSON.stringify(CLAN_CAMPS), first, `день ${day}`);
    }
  });

  /**
   * Точка дня не садится на чужой лагерь ни в один день — не проверкой
   * в раздаче, а по построению: клетки лагерей вынуты из колоды до неё.
   * Порог тот же, каким `world.rules` меряет зазор между точками.
   */
  test('точки дня не наступают на чужие лагеря', () => {
    const MIN = 0.05;
    for (let day = DAY0; day < DAY0 + 60; day++) {
      for (const node of regionAt(day).nodes) {
        for (const camp of CLAN_CAMPS) {
          const d = Math.hypot(node.x - camp.x, node.y - camp.y);
          assert.ok(d >= MIN, `день ${day}: «${node.name}» в ${d.toFixed(3)} от лагеря ${camp.id}`);
        }
      }
    }
  });

  test('колода вмещает самый людный день и после выемки клеток', () => {
    // 22 вылазки и до девяти прогулок — 31 точка; клеток остаётся столько же.
    let most = 0;
    for (let day = DAY0; day < DAY0 + 400; day++) most = Math.max(most, regionAt(day).nodes.length);
    assert.ok(most >= 26, `самый людный день из четырёхсот — всего ${most} точек`);
  });

  test('рост фракции без округления — тот же уровень, только целый', () => {
    for (let k = 0; k < CLANS.length; k++) {
      const t = WORLD_EPOCH + 3 * DAY_SEC;
      assert.equal(Math.floor(clanGrowth(k, t)), clanState(k, t).level, `фракция ${k}`);
    }
  });
});

describe('Чужие заходы (§30.6)', () => {
  const spot = quietNode();

  /** Метка соседа в ту же смену, что и своя: список у них общий по форме. */
  const at = (node: number, t: number): Visit => ({ node, shift: shiftAt(t) });

  test('чужой заход тратит богатство ровно как свой', () => {
    const mine = worldAt(spot.t, [at(spot.node, spot.t)], [])[spot.node]!;
    const theirs = worldAt(spot.t, [], [at(spot.node, spot.t)])[spot.node]!;
    assert.equal(theirs.rich, mine.rich, 'чужой заход стоит локации не столько же');
    assert.equal(theirs.restShifts, mine.restShifts, 'срок восстановления разошёлся');
  });

  test('чужие заходы считаются, свои — нет', () => {
    const both = worldAt(spot.t, [at(spot.node, spot.t)], [at(spot.node, spot.t)])[spot.node]!;
    assert.equal(both.others, 1, 'посчитан не тот заход');
    assert.equal(worldAt(spot.t, [at(spot.node, spot.t)])[spot.node]!.others, 0);
  });

  /**
   * Смена, в которую сходили и я, и сосед, стоит локации **один** заход:
   * богатство считается сменами, а не людьми. Иначе двое в одну смену
   * выработали бы жилу вдвое быстрее, чем один за две.
   */
  test('своя и чужая метка в одну смену — один заход', () => {
    const alone = worldAt(spot.t, [at(spot.node, spot.t)])[spot.node]!.rich;
    const together = worldAt(spot.t, [at(spot.node, spot.t)], [at(spot.node, spot.t)])[spot.node]!;
    assert.equal(together.rich, alone, 'смена посчитана дважды');
    assert.equal(together.others, 1, 'сосед пропал из счёта');
  });

  test('чужая метка вне окна не считается ни в чём', () => {
    const old = { node: spot.node, shift: shiftAt(spot.t) - RICH_WINDOW - 1 };
    const state = worldAt(spot.t, [], [old])[spot.node]!;
    assert.equal(state.rich, RICH_MAX, 'просроченная метка тронула богатство');
    assert.equal(state.others, 0);
  });

  test('без соседей мир такой же, каким был до облака', () => {
    assert.deepEqual(worldAt(spot.t, [], []), worldAt(spot.t, []));
  });
});

describe('Кромка живых лагерей (§30.7)', () => {
  const IDS = Array.from({ length: 200 }, (_, i) => `сосед-${i}-${i * 7919}`);
  const spotsOf = (ids: readonly string[]): Map<string, { x: number; y: number }> =>
    new Map(liveCampSpots(ids).map((s) => [s.id, { x: s.x, y: s.y }]));

  test('место лагеря не зависит от того, кто рядом сильнее', () => {
    const six = IDS.slice(0, LIVE_SHOWN);
    const one = spotsOf(six);
    // Тот же состав в другом порядке — те же места: раскладка идёт по имени,
    // а не по силе, и от чужого роста лагерь не переезжает.
    const two = spotsOf([...six].reverse());
    for (const id of six) assert.deepEqual(one.get(id), two.get(id), id);
  });

  test('кромка лежит ниже региона и не наступает на точки дня', () => {
    for (const spot of liveCampSpots(IDS)) {
      assert.ok(spot.y > 0.85, `${spot.id}: лагерь заехал в регион (y ${spot.y})`);
      assert.ok(spot.y < 1 && spot.x > 0 && spot.x < 1, `${spot.id}: лагерь ушёл за карту`);
    }
    // Точки дня раздаются по сетке и ниже 0,85 не спускаются — проверяем это
    // самой раздачей, а не памятью о числе.
    for (let day = DAY0; day < DAY0 + 60; day++) {
      for (const node of regionAt(day).nodes) {
        assert.ok(node.y < 0.85, `день ${day}: точка «${node.name}» въехала в кромку`);
      }
    }
  });

  test('на кромку помещается не больше, чем помещается', () => {
    assert.equal(liveCampSpots(IDS).length, LIVE_SHOWN);
    assert.equal(liveCampSpots([]).length, 0);
  });

  test('середина кромки оставлена своему лагерю', () => {
    for (const spot of liveCampSpots(IDS)) {
      assert.ok(Math.abs(spot.x - 0.5) > 0.09, `${spot.id} сел на свой лагерь`);
    }
  });

  /**
   * Тот самый замер, ради которого раскладка перестала считаться из одного
   * имени: место по хешу сажало двоих вплотную — худший зазор из двухсот имён
   * выходил 0,004 ширины при пороге выбора 0,09, то есть тап попадал не в тот
   * лагерь. Слоты это чинят по построению, и правило это сторожит.
   */
  test('соседи на кромке различимы пальцем', () => {
    const PICK = 0.09; // порог выбора на карте — доля ширины
    let worst = 1;
    for (let i = 0; i + LIVE_SHOWN <= IDS.length; i += LIVE_SHOWN) {
      const spots = liveCampSpots(IDS.slice(i, i + LIVE_SHOWN));
      for (let a = 0; a < spots.length; a++) {
        for (let b = a + 1; b < spots.length; b++) {
          worst = Math.min(worst, Math.abs(spots[a]!.x - spots[b]!.x));
        }
      }
    }
    assert.ok(worst >= PICK, `худший зазор на кромке ${worst.toFixed(3)} при пороге ${PICK}`);
  });
});
