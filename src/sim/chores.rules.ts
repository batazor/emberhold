/**
 * Правила рутины жильцов (`chores.ts`). Меряется то же, что у обходов
 * двора: маршрут замкнут, идёт по проходимому, лицо смотрит по ходу,
 * а кадр остаётся функцией времени. Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHOP_PAUSE, UNLOAD_PAUSE, choreAt, choresOf } from './chores';
import type { Chore, ChoreSite } from './chores';
import { idx } from './grid';
import type { Resident } from './residents';

/**
 * Площадка на руках: рамка — лес, четыре дерева внутри, костёр в середине.
 * Синтетика, а не снимок поляны, по той же причине, что у всех правил
 * симуляции: тест обязан читаться глазами целиком.
 */
function site(): ChoreSite {
  const size = 16;
  const blocked = new Uint8Array(size * size);
  for (let i = 0; i < size; i++) {
    blocked[idx(size, i, 0)] = 1;
    blocked[idx(size, i, size - 1)] = 1;
    blocked[idx(size, 0, i)] = 1;
    blocked[idx(size, size - 1, i)] = 1;
  }
  for (const [x, z] of [[4, 4], [11, 5], [5, 11], [10, 10]]) {
    blocked[idx(size, x!, z!)] = 1;
  }
  return { size, blocked, fire: { x: 8, z: 8 }, seed: 7 };
}

const folk = (rows: Partial<Resident>[]): Resident[] =>
  rows.map((r, i) => ({
    name: `ж${i}`,
    look: 'поселенец',
    seed: 100 + i * 17,
    answer: 'строим',
    rest: false,
    ...r,
  }));

describe('Рутина жильцов', () => {
  test('отдыхающий и безкрышный маршрута не получают', () => {
    const residents = folk([{ answer: 'строим' }, { rest: true }, { answer: 'ходим' }]);
    // Крыши хватает первым двум: третий — «ходим» — остаётся у костра.
    const chores = choresOf(site(), residents, (i) => i < 2);
    assert.ok(chores[0] !== null, 'работник с крышей обязан выйти на маршрут');
    assert.equal(chores[1], null, 'отдыхающий сидит у костра');
    assert.equal(chores[2], null, 'безкрышный за работу не берётся (workDone)');
  });

  test('маршрут замкнут, шаги соседние и все по проходимому', () => {
    const s = site();
    const chores = choresOf(s, folk([{ answer: 'строим' }, { answer: 'ходим' }]), () => true);
    for (const c of chores) {
      assert.ok(c !== null);
      assert.ok(c.cycle > 0);
      for (let i = 0; i < c.path.length; i++) {
        const a: { x: number; z: number } = c.path[i]!;
        const b: { x: number; z: number } = c.path[(i + 1) % c.path.length]!;
        assert.ok(
          Math.hypot(b.x - a.x, b.z - a.z) <= Math.SQRT2 + 1e-9,
          `разрыв маршрута между (${a.x};${a.z}) и (${b.x};${b.z})`,
        );
        assert.equal(s.blocked[idx(s.size, a.x, a.z)], 0, `шаг в занятую (${a.x};${a.z})`);
      }
    }
  });

  test('кадр — функция времени: тот же t даёт то же место, цикл замыкается', () => {
    const c = choresOf(site(), folk([{}]), () => true)[0] as Chore;
    for (const t of [0, 3.7, 11.2, 40.9]) {
      const a = choreAt(c, t);
      const b = choreAt(c, t);
      assert.deepEqual(a, b);
      const wrapped = choreAt(c, t + c.cycle);
      assert.ok(Math.hypot(wrapped.x - a.x, wrapped.z - a.z) < 1e-6, 'через цикл — то же место');
    }
  });

  test('идущий смотрит по ходу, работает только стоя', () => {
    const c = choresOf(site(), folk([{}]), () => true)[0] as Chore;
    let walked = 0;
    let worked = 0;
    for (let t = 0; t < c.cycle; t += 0.25) {
      const now = choreAt(c, t);
      const next = choreAt(c, t + 0.05);
      const dx = next.x - now.x;
      const dz = next.z - now.z;
      if (now.walking && next.walking && Math.hypot(dx, dz) > 1e-3) {
        walked++;
        // Ходячий кадр обязан смотреть туда, куда движется, — ровно тот
        // разворот спиной вперёд, который правила гарнизона однажды поймали.
        const diff = Math.abs(Math.atan2(dx, dz) - now.facing) % (Math.PI * 2);
        assert.ok(Math.min(diff, Math.PI * 2 - diff) < 0.01, `спиной вперёд на t=${t}`);
      }
      if (now.working) {
        worked++;
        assert.equal(now.walking, false, 'работают стоя, а не на бегу');
      }
    }
    assert.ok(walked > 0, 'за цикл жилец обязан походить');
    assert.ok(worked * 0.25 >= CHOP_PAUSE * 0.8, 'рабочая стоянка обязана быть видимой частью цикла');
  });

  test('носящий камень не работает: его дело — дорога', () => {
    const c = choresOf(site(), folk([{ answer: 'ходим' }]), () => true)[0] as Chore;
    for (let t = 0; t < c.cycle; t += 0.2) {
      assert.equal(choreAt(c, t).working, false);
    }
  });

  test('рутина дороже стоянки у костра: дом — разворот, а не цель', () => {
    // Не замер, а связь конструкции: у работника стоянка дела длиннее
    // домашней, иначе рутина читается сидением с вылазками за дровами.
    assert.ok(CHOP_PAUSE > UNLOAD_PAUSE * 2);
  });
});
