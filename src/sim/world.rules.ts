/**
 * Правила мира (§4). Числа истощения пришли из артбука `world.html` как
 * предложение, и проверяются здесь тем же способом, что и всё остальное
 * в этом проекте: замером, а не рассуждением.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TIER_KITCHEN_GATE } from './camp';
import {
  CAMP_NODE,
  CLANS,
  NODES,
  RAID_NODES,
  RICH_MAX,
  RICH_WINDOW,
  SHIFT_SEC,
  WORLD_EPOCH,
  WORLD_NODES,
  clanState,
  liveVisits,
  lootMul,
  nodeSeed,
  shiftAt,
  worldAt,
} from './world';
import type { Visit } from './world';

const DAY = 24 * 60 * 60;
/** Третий день мира: кланы уже расселились, а игрок только пришёл. */
const T0 = WORLD_EPOCH + 3 * DAY;

/** Момент и узел, которых кланы не касались всё окно, — чистый стенд. */
function quietNode(): { t: number; node: number } {
  for (let s = 0; s < 500; s++) {
    const t = T0 + s * SHIFT_SEC;
    const now = shiftAt(t);
    for (const node of RAID_NODES) {
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
  throw new Error('в регионе не нашлось узла без кланов на всё окно');
}

describe('Мир: карта локаций', () => {
  test('§4 — регион это один экран: 20 узлов, лагерь среди них', () => {
    assert.equal(NODES.length, WORLD_NODES);
    assert.equal(NODES[CAMP_NODE]!.tier, 0, 'лагерь не бывает опасным местом');
    assert.equal(RAID_NODES.length, WORLD_NODES - 1);
    for (const node of NODES) {
      assert.ok(node.x > 0 && node.x < 1, `${node.name}: за экраном по x`);
      assert.ok(node.y > 0 && node.y < 1, `${node.name}: за экраном по y`);
    }
    // Ярусы обязаны быть все четыре, иначе карта не заменяет список ярусов.
    const tiers = new Set(RAID_NODES.map((n) => n.tier));
    assert.deepEqual([...tiers].sort(), [0, 1, 2, 3], 'на карте есть все ярусы');
  });

  test('§0.1 — место имеет форму: сид узла не меняется со временем', () => {
    const first = RAID_NODES.map((n) => nodeSeed(n.id));
    const again = RAID_NODES.map((n) => nodeSeed(n.id));
    assert.deepEqual(first, again);
    assert.equal(new Set(first).size, first.length, 'два узла не собирают одну пещеру');
  });

  test('§4 — кланы не тикают: состояние это функция от сида и часов', () => {
    for (let k = 0; k < CLANS.length; k++) {
      const t = T0 + 3 * DAY;
      assert.deepEqual(clanState(k, t), clanState(k, t), 'один и тот же момент — один ответ');
      assert.ok(!clanState(k, t).nodes.includes(CAMP_NODE), 'клан не селится в лагере игрока');
      assert.ok(
        clanState(k, WORLD_EPOCH + 30 * DAY).level > clanState(k, WORLD_EPOCH + DAY).level,
        'мир растёт без игрока',
      );
      assert.equal(clanState(k, t).nodes.length, 1, 'клан держит одну локацию (замер ниже)');
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
    // с богатством ≥ 2 на доступных ему ярусах. Если оно нарушается, карта
    // отправляет игрока ждать, а ждёт он вне игры.
    //
    // Нагрузка — верхняя граница сессии по §21: пять вылазок подряд, четыре
    // сессии в сутки, и каждый раз в самое богатое доступное место, то есть
    // игрок выжигает карту так быстро, как позволяют правила.
    for (let kitchen = 1; kitchen <= 3; kitchen++) {
      const open = RAID_NODES.filter((n) => TIER_KITCHEN_GATE[n.tier] <= kitchen);
      const visits: Visit[] = [];
      let worst = { shift: 0, count: open.length };
      for (let s = 0; s < DAY / SHIFT_SEC; s++) {
        const t = T0 + s * SHIFT_SEC;
        if (s % RICH_WINDOW === 0) {
          for (let raid = 0; raid < 5; raid++) {
            const world = worldAt(t, visits);
            const best = [...open].sort((a, b) => world[b.id]!.rich - world[a.id]!.rich)[0]!;
            visits.push({ node: best.id, shift: shiftAt(t) });
          }
        }
        const world = worldAt(t, visits);
        const count = open.filter((n) => world[n.id]!.rich >= 2).length;
        if (count < worst.count) worst = { shift: s, count };
      }
      assert.ok(
        worst.count >= 3,
        `Кухня ур. ${kitchen}: на смене ${worst.shift} осталось ${worst.count} ` +
          `богатых локаций из ${open.length} — карта учит ждать, а не выбирать`,
      );
    }
  });

  test('§6 — в сохранении живут только дельты, и их число ограничено', () => {
    const visits: Visit[] = [];
    for (let s = 0; s < 200; s++) {
      visits.push({ node: RAID_NODES[s % RAID_NODES.length]!.id, shift: shiftAt(T0) + s });
    }
    const t = T0 + 200 * SHIFT_SEC;
    const live = liveVisits(visits, t);
    assert.ok(live.length < RICH_WINDOW * WORLD_NODES, 'старые заходы выброшены');
    assert.deepEqual(
      worldAt(t, live).map((n) => n.rich),
      worldAt(t, visits).map((n) => n.rich),
      'чистка не меняет мир: выброшено то, что уже ни на что не влияет',
    );
  });
});
