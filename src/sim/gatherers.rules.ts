/**
 * Правила местных у кустов (`gatherers.ts`). Сторожат одно: **кадр выведен
 * из формулы, а не считается рядом с ней.** Всё остальное — маршрут, шаг,
 * замкнутость круга — уже проверено рутиной лагеря (`chores.rules.ts`),
 * и второй копии тех проверок здесь нет намеренно: аппарат один.
 *
 * Гоняются по настоящим площадкам, а не по синтетике. Синтетика тут ничего
 * бы не доказала: вопрос в том, ложится ли рутина на поле замка, которое
 * генератор выдаёт разным на каждом сиде.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RIPEN_SECONDS, localsOf, takenBushes, worldRipe } from './berries';
import type { Bush, Locals } from './berries';
import { choreAt } from './chores';
import { GATHERERS_MAX, gatherersOf } from './gatherers';
import type { GatherSite } from './gatherers';
import { generateCastleSite } from './castleSite';
import { generateGraveSite } from './graveSite';
import { idx } from './grid';
import { SHIFT_SEC, WAKE_AT } from './world';

/** Сидов и окон созревания: хватает, чтобы редкая раскладка успела выпасть. */
const SEEDS = 40;
const EPOCHS = 8;

interface Probe {
  readonly site: GatherSite;
  readonly bushes: readonly Bush[];
  readonly locals: Locals | null;
  readonly seed: number;
}

const castles = (): Probe[] => {
  const out: Probe[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const site = generateCastleSite(s);
    const locals = localsOf(site.gate, site.bushes);
    out.push({
      site: {
        seed: site.loc.seed,
        size: site.loc.size,
        blocked: site.loc.blocked,
        bushes: site.bushes,
        locals,
      },
      bushes: site.bushes,
      locals,
      seed: site.loc.seed,
    });
  }
  return out;
};

const epochs = (): number[] => Array.from({ length: EPOCHS }, (_, e) => e * RIPEN_SECONDS + 11);

describe('Местные у кустов (§13.8)', () => {
  test('собиратель стоит только у куста, который формула отдала местным', () => {
    // Главное правило раздела: у кадра нет своего мнения. Собиратель, сидящий
    // у узла, который формула считает полным, был бы вторым источником
    // правды — игрок видел бы ягоды и человека, уносящего те же ягоды.
    let seen = 0;
    for (const p of castles()) {
      for (const now of epochs()) {
        const taken = takenBushes(p.seed, p.bushes, p.locals, now);
        for (const g of gatherersOf(p.site, now)) {
          seen++;
          assert.ok(
            taken.some((b) => b.id === g.bush.id),
            `сид ${p.seed}: собиратель у куста ${g.bush.id}, которого местные не обирают`,
          );
          assert.equal(
            worldRipe(p.seed, 'замок', g.bush, p.locals, {}, now),
            false,
            `сид ${p.seed}: куст ${g.bush.id} полон для игрока и обираем местным разом`,
          );
        }
      }
    }
    assert.ok(seen > 0, 'ни одного собирателя не выпало — проверять нечего');
  });

  test('у каждого свой куст, и в кадре их не больше потолка', () => {
    for (const p of castles()) {
      for (const now of epochs()) {
        const folk = gatherersOf(p.site, now);
        assert.ok(folk.length <= GATHERERS_MAX, `сид ${p.seed}: вышло ${folk.length}`);
        const ids = new Set(folk.map((g) => g.bush.id));
        assert.equal(ids.size, folk.length, `сид ${p.seed}: двое сели к одному кусту`);
      }
    }
  });

  test('обирать некому — никто и не ходит', () => {
    // Кладбище (§6.1.7.1): живых там не живёт. Прежде формула объявляла
    // дичок обобранным, а показать было некого.
    for (let s = 1; s <= SEEDS; s++) {
      const site = generateGraveSite(s);
      for (const now of epochs()) {
        const folk = gatherersOf(
          {
            seed: site.loc.seed,
            size: site.loc.size,
            blocked: site.loc.blocked,
            bushes: site.bushes,
            locals: null,
          },
          now,
        );
        assert.equal(folk.length, 0, `сид ${s}: на кладбище вышел собиратель`);
      }
    }
  });

  test('круг выходит из ворот и по ним же мерится близость', () => {
    // Дом маршрута и точка, от которой формула считает «далеко», — одна
    // и та же. Иначе доля обобранного падала бы с расстоянием, к которому
    // ноги не имеют отношения.
    for (const p of castles()) {
      const hub = p.locals!.hub;
      for (const now of epochs()) {
        for (const g of gatherersOf(p.site, now)) {
          const home = g.chore.path[0]!;
          assert.ok(
            Math.hypot(home.x - hub.x, home.z - hub.z) <= 3.5,
            `сид ${p.seed}: дом круга в (${home.x};${home.z}), ворота в (${hub.x};${hub.z})`,
          );
        }
      }
    }
  });

  test('круг идёт по проходимому и замкнут', () => {
    for (const p of castles()) {
      for (const now of epochs()) {
        for (const g of gatherersOf(p.site, now)) {
          const path = g.chore.path;
          for (let i = 0; i < path.length; i++) {
            const a = path[i]!;
            const b = path[(i + 1) % path.length]!;
            assert.ok(
              Math.hypot(b.x - a.x, b.z - a.z) <= Math.SQRT2 + 1e-9,
              `сид ${p.seed}: разрыв круга у (${a.x};${a.z})`,
            );
            assert.equal(
              p.site.blocked[idx(p.site.size, a.x, a.z)],
              0,
              `сид ${p.seed}: круг идёт сквозь занятую (${a.x};${a.z})`,
            );
          }
        }
      }
    }
  });

  test('ночи у места нет: собиратель не пропадает и не замирает на смену', () => {
    // Свет замка назначен сценой (день), и сон по мировым часам оставил бы
    // человека стоять у ворот посреди нарисованного полудня.
    let checked = 0;
    for (const p of castles()) {
      for (const now of epochs()) {
        for (const g of gatherersOf(p.site, now)) {
          checked++;
          assert.equal(g.chore.awake, SHIFT_SEC, 'у местного отобрали половину смены');
          const spots = new Set<string>();
          for (let t = 0; t < SHIFT_SEC; t += 31) {
            const f = choreAt(g.chore, WAKE_AT + t);
            assert.equal(f.hidden, false, `сид ${p.seed}: собиратель пропал из кадра`);
            assert.equal(f.talk, null, `сид ${p.seed}: собиратель заговорил`);
            spots.add(`${f.x.toFixed(1)}:${f.z.toFixed(1)}`);
          }
          assert.ok(spots.size > 4, `сид ${p.seed}: круг встал`);
        }
      }
    }
    assert.ok(checked > 0, 'ни одного круга не выпало — проверять нечего');
  });

  test('кадр — функция времени: тот же час даёт того же человека', () => {
    // На этом держится всё остальное: заход в замок не двигает местных,
    // а только спрашивает, где они.
    const p = castles()[0]!;
    const now = 3 * RIPEN_SECONDS + 11;
    const a = gatherersOf(p.site, now);
    const b = gatherersOf(p.site, now);
    assert.deepEqual(
      a.map((g) => [g.bush.id, g.chore.path[0]]),
      b.map((g) => [g.bush.id, g.chore.path[0]]),
      'два вопроса — два разных ответа',
    );
  });
});
