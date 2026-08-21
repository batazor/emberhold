/**
 * Правила жителей замка (§6.1.6). Замок обещает игроку прогулку по
 * населённой постройке, и это обещание распадается на четыре проверяемых:
 *
 * Первое: **жители есть, и двор ими не забит.** Проверяется плотность,
 * а не счёт: двор замка выпадает разный, и число, верное на одном,
 * на другом означало бы толпу или пустоту.
 *
 * Второе: **житель ходит по двору и только по нему.** Ворота проезжие,
 * и обход, посчитанный по всей локации, имел бы полное право выйти в лес.
 *
 * Третье: **житель не мешает герою.** Он не занимает клетку и не значится
 * противником: в замке не с кем драться, и это состояние объявлено.
 *
 * Четвёртое: **один сид — один замок с теми же жителями.** На этом держится
 * §4: точка карты обязана держать форму весь день.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CASTLE_CELL } from './castle';
import { FOLK_LOOKS, FOLK_SPEED, stepFolk } from './castleFolk';
import { generateCastleSite } from './castleSite';
import { idx } from './grid';

const SEEDS = [1, 2, 3, 7, 42, 1337, 90210, 2718, 555, 31337, 4, 5, 6, 8, 9];
const sites = SEEDS.map(generateCastleSite);

/** Клетки двора в клетках локации — та же раскладка, что в `castleFolk.ts`,
 *  посчитанная здесь заново: правило, зовущее ту же функцию, проверяло бы
 *  опечатку, а не решение. */
function yardOf(site: (typeof sites)[number]): Set<string> {
  const out = new Set<string>();
  for (const spot of site.castle.yard) {
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) {
        out.add(`${site.at.x + spot.x * CASTLE_CELL + dx}:${site.at.z + spot.z * CASTLE_CELL + dz}`);
      }
    }
  }
  return out;
}

describe('Замок населён: кто здесь живёт', () => {
  test('жители есть на каждом сиде, и двор ими не забит', () => {
    for (const site of sites) {
      const { folk } = site;
      assert.ok(folk.length >= 2, `сид ${site.loc.seed}: замок пуст`);
      assert.ok(folk.length <= 5, `сид ${site.loc.seed}: жителей ${folk.length} — это толпа`);
      const yard = yardOf(site);
      let free = 0;
      for (const key of yard) {
        const [x, z] = key.split(':').map(Number) as [number, number];
        if (site.loc.blocked[idx(site.loc.size, x, z)] === 0) free++;
      }
      /**
       * Десять — измеренный минимум на пятистах сидах, и берётся он не
       * плотностью, а нижним порогом в двоих: на самом тесном дворе порог
       * плотность перебивает. Двое на два десятка клеток — всё ещё двор,
       * а не толпа, и порог сохранён именно поэтому: замок без жителей
       * не выполняет обещания карточки.
       */
      assert.ok(
        free / folk.length >= 10,
        `сид ${site.loc.seed}: ${free} свободных клеток двора на ${folk.length} жителей`,
      );
    }
  });

  test('облики разные: двор не собран из одинаковых', () => {
    const seen = new Set(sites.flatMap((s) => s.folk.map((f) => f.look)));
    assert.equal(seen.size, FOLK_LOOKS.length, `обликов встретилось ${seen.size}`);
    for (const site of sites) {
      const looks = new Set(site.folk.map((f) => f.look));
      assert.ok(looks.size > 1, `сид ${site.loc.seed}: все жители на одно лицо`);
    }
  });
});

describe('Замок населён: житель ходит по двору', () => {
  test('обход есть у каждого, замкнут и лежит целиком во дворе', () => {
    for (const site of sites) {
      const yard = yardOf(site);
      for (const f of site.folk) {
        assert.ok(f.route.length > 0, `сид ${site.loc.seed}: житель ${f.id} стоит без обхода`);
        for (const c of f.route) {
          assert.ok(yard.has(`${c.x}:${c.z}`), `сид ${site.loc.seed}: обход вышел за двор в ${c.x},${c.z}`);
          assert.equal(
            site.loc.blocked[idx(site.loc.size, c.x, c.z)],
            0,
            `сид ${site.loc.seed}: обход идёт сквозь занятую клетку ${c.x},${c.z}`,
          );
        }
        const last = f.route[f.route.length - 1]!;
        assert.ok(
          Math.abs(last.x - f.x) < 1e-6 && Math.abs(last.z - f.z) < 1e-6,
          `сид ${site.loc.seed}: обход не замкнут — кончается не там, где начался`,
        );
      }
    }
  });

  test('за пять минут никто не застрял и не ушёл со двора', () => {
    for (const site of sites) {
      const yard = yardOf(site);
      const start = site.folk.map((f) => ({ x: f.x, z: f.z }));
      let walked = site.folk.map(() => 0);
      for (let tick = 0; tick < 60 * 300; tick++) {
        stepFolk(site.folk, 1 / 60);
        site.folk.forEach((f, i) => {
          walked[i]! += Math.hypot(f.x - f.prevX, f.z - f.prevZ);
        });
      }
      site.folk.forEach((f, i) => {
        // Пять минут при остановках на углах — сотни клеток пути. Житель,
        // прошедший меньше собственного обхода, застрял.
        assert.ok(
          walked[i]! > f.route.length,
          `сид ${site.loc.seed}: житель ${f.id} прошёл ${walked[i]!.toFixed(1)} при обходе в ${f.route.length}`,
        );
        assert.ok(
          yard.has(`${Math.round(f.x)}:${Math.round(f.z)}`),
          `сид ${site.loc.seed}: житель ${f.id} оказался вне двора`,
        );
        assert.ok(start[i] !== undefined);
      });
    }
  });

  test('за кадр житель проходит не больше своего шага', () => {
    for (const site of sites) {
      for (let tick = 0; tick < 600; tick++) {
        stepFolk(site.folk, 1 / 60);
        for (const f of site.folk) {
          const step = Math.hypot(f.x - f.prevX, f.z - f.prevZ);
          assert.ok(
            step <= FOLK_SPEED / 60 + 1e-6,
            `сид ${site.loc.seed}: житель ${f.id} прыгнул на ${step.toFixed(3)}`,
          );
        }
      }
    }
  });
});

describe('Замок населён: житель герою не мешает', () => {
  test('жители не занимают клеток и не значатся противниками', () => {
    for (const site of sites) {
      assert.equal(site.loc.enemies.length, 0, `сид ${site.loc.seed}: в замке завёлся противник`);
      assert.equal(site.loc.containers.length, 0, `сид ${site.loc.seed}: в замке завелась добыча`);
      for (const f of site.folk) {
        assert.equal(
          site.loc.blocked[idx(site.loc.size, Math.round(f.x), Math.round(f.z))],
          0,
          `сид ${site.loc.seed}: житель ${f.id} стоит в занятой клетке`,
        );
      }
    }
  });
});

describe('Замок населён: один сид — те же жители', () => {
  test('два вызова с одним сидом дают одних и тех же', () => {
    for (const seed of SEEDS) {
      const a = generateCastleSite(seed);
      const b = generateCastleSite(seed);
      assert.deepEqual(a.folk, b.folk);
    }
  });

  test('шаг детерминирован: две одинаковые площадки идут одинаково', () => {
    const a = generateCastleSite(2718);
    const b = generateCastleSite(2718);
    for (let tick = 0; tick < 60 * 60; tick++) {
      stepFolk(a.folk, 1 / 60);
      stepFolk(b.folk, 1 / 60);
    }
    assert.deepEqual(
      a.folk.map((f) => [f.x.toFixed(6), f.z.toFixed(6), f.at, f.wait.toFixed(6)]),
      b.folk.map((f) => [f.x.toFixed(6), f.z.toFixed(6), f.at, f.wait.toFixed(6)]),
    );
  });
});
