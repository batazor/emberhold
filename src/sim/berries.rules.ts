/**
 * Правила ягодного куста (§13.8). Сторожат сделку, ради которой он заведён:
 * куст быстрее добытчика, но платится вниманием, — и ни одно место мира
 * от него не превращается во второе.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BERRY_FOOD_AVG,
  BERRY_FOOD_MAX,
  BERRY_FOOD_MIN,
  BUSHES,
  PICK_SECONDS,
  RIPEN_SECONDS,
  berryYield,
  bushAt,
  pickBlock,
  ripe,
  scatterBushes,
} from './berries';
import { MINE_SECONDS } from './stones';
import { FOOD_PER_MOUTH } from './balance';
import { WORK_SECONDS } from './residents';
import { campBushes, createCamp } from './camp';
import { generateGraveSite } from './graveSite';
import { generateCastleSite } from './castleSite';

test('§13.8 — рвать быстрее, чем добывать', () => {
  assert.ok(
    PICK_SECONDS < MINE_SECONDS,
    `сбор ${PICK_SECONDS} с против валуна ${MINE_SECONDS} с — куст читается вторым валуном`,
  );
});

test('§13.8 — к кусту незачем возвращаться чаще, чем раз в смену', () => {
  assert.ok(
    RIPEN_SECONDS > WORK_SECONDS,
    'куст созревает быстрее рабочего такта — обход превращается в дежурство',
  );
});

test('§13.8 — роща не кормит взрослый лагерь сама', () => {
  // Шесть ртов — лагерь, доросший до второй-третьей палатки. Если вся роща,
  // обираемая идеально вовремя, покрывает его паёк, добытчик не нужен,
  // и выбор между людьми (§13.7) отменяется грядкой.
  const grovePerSecond = (BUSHES.camp * BERRY_FOOD_AVG) / RIPEN_SECONDS;
  const campPerSecond = (6 * FOOD_PER_MOUTH) / WORK_SECONDS;
  assert.ok(
    grovePerSecond < campPerSecond,
    `роща даёт ${grovePerSecond.toFixed(5)} против ${campPerSecond.toFixed(5)} — ` +
      'приказ «Добывать пищу» обесценен кустами',
  );
});

test('§13.8 — куст кормит лагерь ненадолго', () => {
  // Условие смысла: один куст не должен закрывать содержание надолго,
  // иначе пища перестаёт быть решением. Три рта — типичный ранний лагерь.
  const ticks = BERRY_FOOD_AVG / (3 * FOOD_PER_MOUTH);
  assert.ok(ticks <= 3, `один куст кормит троих ${ticks} тактов — это уже склад, а не куст`);
});

test('§13.8 — награда детерминирована клеткой', () => {
  const bush = { id: 0, x: 4, z: 7 };
  const again = { id: 9, x: 4, z: 7 };
  assert.equal(berryYield(bush), berryYield(again), 'тот же куст отдал разное');
  assert.ok(berryYield(bush) >= BERRY_FOOD_MIN && berryYield(bush) <= BERRY_FOOD_MAX);
});

test('§13.8 — обобранный куст созревает, а не исчезает', () => {
  const bush = { id: 0, x: 1, z: 1, pickedAt: 1000 };
  assert.equal(ripe(bush, 1000), false, 'сорванный тут же снова полон');
  assert.equal(ripe(bush, 1000 + RIPEN_SECONDS), true, 'куст не созрел в срок');
  assert.equal(pickBlock(bush, 1000), 'зелёный');
  assert.equal(pickBlock(null, 1000), 'пусто');
});

test('§13.8 — кусты не растут в одной клетке и не липнут друг к другу', () => {
  const size = 12;
  const bushes = scatterBushes(1, size, new Uint8Array(size * size), 6);
  for (const a of bushes) {
    const twins = bushes.filter((b) => b.x === a.x && b.z === a.z);
    assert.equal(twins.length, 1, 'два куста в одной клетке');
    const near = bushes.filter((b) => b.id !== a.id && Math.abs(b.x - a.x) + Math.abs(b.z - a.z) <= 1);
    assert.equal(near.length, 0, 'кусты слиплись — игрок заплатит дважды за одну грядку');
  }
});

test('§13.8 — кусты стоят там, где обещано: лагерь, замок, кладбище', () => {
  assert.ok(campBushes().length > 0, 'на стартовой поляне не выросло ни куста');
  assert.ok(createCamp().bushes !== undefined, 'новый лагерь заводится без кустов');
  assert.equal(generateCastleSite(7).bushes.length > 0, true, 'у замка пусто');
  const grave = generateGraveSite(7);
  assert.ok(
    grave.bushes.length >= BUSHES.castle,
    'на кладбище кустов не больше, чем у замка, — прогулке снова нечего дать',
  );
});

test('§13.8 — куст не встаёт на занятую клетку', () => {
  const camp = createCamp();
  for (const bush of camp.bushes ?? []) {
    assert.ok(
      !camp.stones.some((s) => s.x === bush.x && s.z === bush.z),
      'куст вырос на валуне',
    );
  }
  const grave = generateGraveSite(3);
  for (const bush of grave.bushes) {
    assert.equal(bushAt(grave.bushes, bush), bush, 'куст не находится по своей же клетке');
    assert.ok(
      !grave.marks.some((m) => m.x === bush.x && m.z === bush.z),
      'куст вырос на могиле',
    );
  }
});
