/**
 * Правила резонанса жилы (§13.11).
 *
 * Проверяются обещания, данные словами таблицы: «до ×2 кликами», «3 за
 * 0,9 с», «×3 → ×4 → ×5 попаданиями», «perfect даёт время», «мимо —
 * короткое замедление, ступень остаётся», «перестал кликать — тихо
 * дотаивает до ×1». Каждое из них — ручка, которую соблазнительно
 * подкрутить на глаз, и без теста подкрутка молча съела бы соседнее
 * обещание: так уже было с полкой, продлеваемой кликами, — она держала
 * ×5 без единого попадания, и заметил это тест, а не глаз.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mulberry32 } from '../core/rng';
import {
  APPROACH_SECONDS,
  CHEER_MAX,
  COMBO_MULS,
  FADE_SECONDS,
  HOLD_SECONDS,
  MISS_MUL,
  MISS_SECONDS,
  PERFECT_EXTRA,
  PERFECT_WINDOW,
  SPOT_SECONDS,
  WARMUP_TAPS,
  WARMUP_WINDOW,
  startTempo,
  stepTempo,
  tempoBeat,
  tempoBoost,
  tempoSpotNow,
} from './tempo';
import type { Tempo } from './tempo';

const rng = (): ReturnType<typeof mulberry32> => mulberry32(7);

/** Разогнать серию до открытой точки: три быстрых клика по добыче. */
function opened(at = 0): { t: Tempo; now: number } {
  const t = startTempo();
  const r = rng();
  let now = at;
  for (let i = 0; i < WARMUP_TAPS; i++) {
    tempoBeat(t, now, r, null);
    now += WARMUP_WINDOW / (WARMUP_TAPS + 1);
  }
  return { t, now };
}

/** Попасть в круг ровно на совпадении колец — perfect по построению. */
const hitOnBeat = (t: Tempo, r: ReturnType<typeof mulberry32>): number => {
  const beatAt = t.spot!.bornAt + APPROACH_SECONDS;
  const verdict = tempoBeat(t, beatAt, r, 'spot');
  assert.equal(verdict, 'perfect');
  return beatAt;
};

describe('резонанс жилы', () => {
  test('пассивная добыча остаётся ×1 — без кликов резонанса просто нет', () => {
    const t = startTempo();
    for (let now = 0; now < 30; now += 0.5) {
      assert.equal(tempoBoost(t, now), 1);
      stepTempo(t, now, rng());
      assert.equal(t.spot, null);
    }
  });

  test('клики наполняют разгон до ×2 и не выше', () => {
    const t = startTempo();
    const r = rng();
    tempoBeat(t, 0, r, null);
    assert.equal(tempoBoost(t, 0), 1.5);
    tempoBeat(t, 0.2, r, null);
    assert.equal(tempoBoost(t, 0.2), CHEER_MAX);
    for (let i = 0; i < 10; i++) tempoBeat(t, 0.3 + i * 0.1, r, null);
    assert.equal(tempoBoost(t, 1.3), CHEER_MAX);
  });

  test('точку открывают три клика в окне, а растянутые три — нет', () => {
    const quick = opened();
    assert.notEqual(quick.t.spot, null);

    const t = startTempo();
    const r = rng();
    const gap = WARMUP_WINDOW * 0.6;
    for (let i = 0; i < WARMUP_TAPS; i++) {
      assert.equal(tempoBeat(t, i * gap, r, null), 'cheer');
    }
    assert.equal(t.spot, null);
  });

  test('лестница попаданий: ×3 → ×4 → ×5 и полка на ×5', () => {
    const { t, now } = opened();
    const r = rng();
    let at = now;
    const seen: number[] = [];
    for (let i = 0; i < COMBO_MULS.length + 2; i++) {
      at += 0.3;
      t.spot = { u: 0, v: 0, bornAt: at - APPROACH_SECONDS };
      tempoBeat(t, at, r, 'spot');
      seen.push(tempoBoost(t, at));
    }
    assert.deepEqual(seen, [3, 4, 5, 5, 5]);
  });

  test('perfect судится окном совпадения, good — всей жизнью точки', () => {
    const { t } = opened();
    const r = rng();
    const beatAt = t.spot!.bornAt + APPROACH_SECONDS;
    assert.equal(tempoBeat(t, beatAt + PERFECT_WINDOW * 0.9, r, 'spot'), 'perfect');

    // Чуть позже окна, но в хвосте жизни точки — good, а не промах:
    // строгий тайминг обещан только награде, не самому попаданию.
    let at = beatAt + 1;
    t.spot = { u: 0, v: 0, bornAt: at };
    assert.equal(tempoBeat(t, at + APPROACH_SECONDS + PERFECT_WINDOW * 1.5, r, 'spot'), 'good');
    // И раньше окна — тоже good: кольцо ещё сжимается, но круг уже круг.
    at += 3;
    t.spot = { u: 0, v: 0, bornAt: at };
    assert.equal(tempoBeat(t, at + 0.1, r, 'spot'), 'good');
  });

  test('perfect держит полку дольше good — ровно на добавку', () => {
    const a = opened();
    const b = opened();
    const r = rng();
    const atA = hitOnBeat(a.t, r);
    b.t.spot = { u: 0, v: 0, bornAt: atA };
    assert.equal(tempoBeat(b.t, atA + 0.3, r, 'spot'), 'good');
    // Сравнение с зазором: сложение секунд плавающей точкой дрожит в 1e-16.
    assert.ok(Math.abs(a.t.holdUntil - atA - (HOLD_SECONDS + PERFECT_EXTRA)) < 1e-9);
    assert.ok(Math.abs(b.t.holdUntil - (atA + 0.3) - HOLD_SECONDS) < 1e-9);
  });

  test('мимо круга — короткое замедление, а ступень остаётся', () => {
    const { t } = opened();
    const r = rng();
    const at = hitOnBeat(t, r);
    assert.equal(tempoBeat(t, at + 0.1, r, 'wide'), 'miss');
    assert.equal(tempoBoost(t, at + 0.2), MISS_MUL);
    // Штраф вышел — вернулась та же ступень, а не начало лестницы.
    assert.equal(tempoBoost(t, at + 0.1 + MISS_SECONDS), COMBO_MULS[0]);
  });

  test('промах полку не продлевает — ×5 не удержать, тыкая мимо', () => {
    const { t } = opened();
    const r = rng();
    const at = hitOnBeat(t, r);
    const hold = t.holdUntil;
    tempoBeat(t, at + 0.1, r, 'wide');
    assert.equal(t.holdUntil, hold);
  });

  test('клик по добыче лестницу не продлевает — таймер комбо обновляют попадания', () => {
    const { t } = opened();
    const r = rng();
    const at = hitOnBeat(t, r);
    const hold = t.holdUntil;
    tempoBeat(t, at + 0.2, r, null);
    assert.equal(t.holdUntil, hold);
  });

  test('перестал кликать — множитель тает плавно и доходит до ×1', () => {
    const { t } = opened();
    const r = rng();
    const at = hitOnBeat(t, r);
    const fadeFrom = t.holdUntil;
    assert.equal(tempoBoost(t, fadeFrom), COMBO_MULS[0]);
    const mid = tempoBoost(t, fadeFrom + FADE_SECONDS / 2);
    assert.ok(mid > 1 && mid < COMBO_MULS[0]!, `посреди спада ${mid}`);
    assert.equal(tempoBoost(t, fadeFrom + FADE_SECONDS), 1);
    void at;
  });

  test('дотаявшая серия начинается заново, а не донашивает старое комбо', () => {
    const { t } = opened();
    const r = rng();
    const at = hitOnBeat(t, r);
    const later = t.holdUntil + FADE_SECONDS + 0.1;
    stepTempo(t, later, r);
    assert.equal(t.spot, null);
    assert.equal(tempoBeat(t, later, r, null), 'cheer');
    assert.equal(t.combo, 0);
    assert.equal(tempoBoost(t, later), 1.5);
    void at;
  });

  test('просроченная точка перескакивает, пока серия жива', () => {
    const { t, now } = opened();
    const r = rng();
    const born = t.spot!;
    stepTempo(t, now + SPOT_SECONDS + 0.05, r);
    assert.notEqual(t.spot, null);
    assert.notEqual(t.spot, born);
  });

  test('точка лежит в зоне кольца — рендеру не приходится её обрезать', () => {
    const r = rng();
    for (let i = 0; i < 200; i++) {
      const { t, now } = opened(i * 10);
      tempoBeat(t, now, r, 'spot');
      const spot = tempoSpotNow(t, now)!;
      assert.ok(Math.hypot(spot.u, spot.v) <= 1, `точка за зоной: ${spot.u}, ${spot.v}`);
    }
  });
});

/**
 * Границы приемлемого результата. Мини-игра требует темпа и меткости,
 * и без записанных границ её сложность крутилась бы на глаз: чуть уже
 * окно — и живой палец перестаёт окупаться, чуть шире — и лестница
 * раздаётся даром. Здесь границы записаны прогоном профилей — тем же
 * способом, что замер `npm run tempo`, только вшитым в билд.
 */
describe('границы приемлемого результата', () => {
  /** Профиль за работой `seconds` секунд; возвращает средний множитель. */
  function played(aim: number, jitter: number, seconds: number, seed: number): number {
    const t = startTempo();
    const spots = mulberry32(seed);
    const hand = mulberry32(seed ^ 0x51c6d3);
    const dt = 1 / 60;
    let now = 0;
    let nextCheer = 0;
    let plannedFor = -1;
    let planAt = Infinity;
    let planAim: 'spot' | 'wide' = 'spot';
    let sum = 0;
    let ticks = 0;
    while (now < seconds) {
      if (t.spot === null) {
        if (now >= nextCheer) {
          tempoBeat(t, now, spots, null);
          nextCheer = now + 0.22;
        }
      } else {
        if (t.spot.bornAt !== plannedFor) {
          plannedFor = t.spot.bornAt;
          const off = (hand() * 2 - 1) * jitter;
          planAt = Math.min(plannedFor + APPROACH_SECONDS + off, plannedFor + SPOT_SECONDS);
          planAim = hand() < aim ? 'spot' : 'wide';
        }
        if (now >= planAt) {
          planAt = Infinity;
          tempoBeat(t, now, spots, planAim);
        }
      }
      sum += tempoBoost(t, now);
      ticks++;
      now += dt;
      stepTempo(t, now, spots);
    }
    return sum / ticks;
  }

  test('новичку резонанс обязан окупаться: 60% меткости — не ниже ×2,5', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const avg = played(0.6, 0.3, 60, seed);
      assert.ok(avg >= 2.5, `сид ${seed}: новичок получил ×${avg.toFixed(2)}`);
    }
  });

  test('метроному потолок не пробить: средний × в коридоре [3,5; 5]', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const avg = played(1, 0, 60, seed);
      assert.ok(avg <= COMBO_MULS[COMBO_MULS.length - 1]!, `сид ${seed}: ×${avg.toFixed(2)}`);
      assert.ok(avg >= 3.5, `сид ${seed}: мастерство не окупилось, ×${avg.toFixed(2)}`);
    }
  });

  test('множитель всегда в коридоре [×0,75; ×5] — на любом потоке кликов', () => {
    const events = mulberry32(99);
    const t = startTempo();
    let now = 0;
    for (let i = 0; i < 20000; i++) {
      now += events() * 0.6;
      const roll = events();
      if (roll < 0.5) tempoBeat(t, now, events, null);
      else if (roll < 0.8) tempoBeat(t, now, events, 'spot');
      else tempoBeat(t, now, events, 'wide');
      const boost = tempoBoost(t, now + events() * 0.5);
      assert.ok(
        boost >= MISS_MUL && boost <= COMBO_MULS[COMBO_MULS.length - 1]!,
        `множитель выпал из коридора: ×${boost}`,
      );
    }
  });
});
