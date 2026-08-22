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

  test('домой с ношей, обратно налегке', () => {
    // Половина круга с полными руками — это и есть ответ на вопрос,
    // зачем он ходил. Проверяется порядок, а не доля: за круг руки
    // наполняются и пустеют ровно по разу, и ноша занимает не весь круг.
    for (const answer of ['строим', 'ходим'] as const) {
      const c = choresOf(site(), folk([{ answer }]), () => true)[0] as Chore;
      const step = 0.2;
      let flips = 0;
      let laden = 0;
      let prev = choreAt(c, 0).carrying;
      for (let t = step; t <= c.cycle; t += step) {
        const now = choreAt(c, t).carrying;
        if (now) laden++;
        if (now !== prev) flips++;
        prev = now;
      }
      assert.equal(flips, 2, `${answer}: ноша меняется ${flips} раз за круг вместо двух`);
      assert.ok(laden > 0, `${answer}: ноша не появилась ни разу`);
      assert.ok(laden * step < c.cycle, `${answer}: ноша не выпускается из рук весь круг`);
    }
  });

  test('ношу берут у дела, а кладут дома', () => {
    // Обе подмены приходятся на первый шаг после стоянки — и это решение:
    // предмет, возникающий на ходу посреди поляны, читался бы сбоем,
    // а на развороте подмены не видно.
    for (const answer of ['строим', 'ходим'] as const) {
      const c = choresOf(site(), folk([{ answer }]), () => true)[0] as Chore;
      const home = c.path[0]!;
      const step = 0.1;
      for (let t = 0; t < c.cycle; t += step) {
        const now = choreAt(c, t);
        const next = choreAt(c, t + step);
        if (now.carrying === next.carrying) continue;
        assert.equal(now.walking, false, `${answer}: ноша сменилась на бегу, t=${t}`);
        const far = Math.hypot(now.x - home.x, now.z - home.z);
        if (next.carrying) assert.ok(far > 1, `${answer}: ноша взялась у костра, t=${t}`);
        else assert.ok(far < 1e-6, `${answer}: ношу бросили по дороге, t=${t}`);
      }
    }
  });

  test('пара приходит домой в одну секунду и говорит одновременно', () => {
    const residents = folk([{ answer: 'строим' }, { answer: 'ходим' }]);
    const [a, b] = choresOf(site(), residents, () => true) as [Chore, Chore];
    assert.equal(a.partner, 1);
    assert.equal(b.partner, 0);
    // Общий круг — это и есть механика встречи: разойдись циклы, и пара
    // виделась бы раз в общее кратное, то есть никогда.
    assert.equal(a.cycle, b.cycle);
    assert.equal(a.phase, b.phase);
    let together = 0;
    for (let t = 0; t < a.cycle * 3; t += 0.25) {
      const fa = choreAt(a, t);
      const fb = choreAt(b, t);
      assert.equal(
        fa.talk === null,
        fb.talk === null,
        `на t=${t} говорит один из пары, а второй нет`,
      );
      if (fa.talk === null || fb.talk === null) continue;
      together++;
      assert.equal(fa.talk.round, fb.talk.round, 'у пары разошёлся номер встречи');
      assert.ok(Math.abs(fa.talk.since - fb.talk.since) < 1e-9, 'разговор идёт вразнобой');
      // Разговаривают, стоя рядом: через весь лагерь это перекличка.
      assert.ok(Math.hypot(fa.x - fb.x, fa.z - fb.z) <= 4, 'напарники встали слишком далеко');
    }
    assert.ok(together > 0, 'за три круга пара ни разу не встретилась');
  });

  test('одиночке пары не досталось, и он всё равно ходит', () => {
    // Нечётный работник — не дефект: он ходит и молчит, как ходили все
    // до разговора.
    const chores = choresOf(site(), folk([{}, {}, { answer: 'ходим' }]), () => true);
    assert.deepEqual(chores.map((c) => (c === null ? 'без тропы' : c.partner)), [1, 0, null]);
    const lone = chores[2] as Chore;
    for (let t = 0; t < lone.cycle; t += 0.5) {
      assert.equal(choreAt(lone, t).talk, null, 'одиночка заговорил сам с собой');
    }
  });
});
