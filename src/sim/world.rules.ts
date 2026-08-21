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
  KIND,
  CLANS,
  DAY_SEC,
  RICH_MAX,
  RICH_WINDOW,
  SHIFTS_PER_DAY,
  SHIFT_SEC,
  WORLD_EPOCH,
  clanState,
  dayAt,
  dayStartShift,
  liveVisits,
  lootMul,
  nodeSeed,
  regionAt,
  shiftAt,
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
