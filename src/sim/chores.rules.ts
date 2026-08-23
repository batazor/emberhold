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
import { AWAKE_SEC, SHIFT_SEC, SLEEP_SEC, WAKE_AT } from './world';
import type { Resident } from './residents';

/** Отсчёт от рассвета: расписание рутины начинается с подъёма (§24). */
const dawn = (s = 0): number => WAKE_AT + s;

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
  // Палатки — по числу жильцов, которым в тесте дают крышу. Стоят они
  // поодаль от костра нарочно: место у огня, оказавшееся вплотную к палатке,
  // не даёт дороге ко сну случиться, и правило про неё проверяло бы пустоту.
  return { size, blocked, fire: { x: 8, z: 8 }, seed: 7, tents: [{ x: 13, z: 13 }, { x: 2, z: 13 }, { x: 13, z: 3 }] };
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
      assert.ok(c.circuit > 0);
      assert.ok(c.laps >= 1);
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
    for (const s of [0, 3.7, 11.2, 40.9]) {
      const a = choreAt(c, dawn(s));
      const b = choreAt(c, dawn(s));
      assert.deepEqual(a, b);
      // Круг замыкается внутри дня, а сутки — через смену: два периода,
      // и оба обязаны повторяться.
      const lap = choreAt(c, dawn(s + c.circuit));
      assert.ok(Math.hypot(lap.x - a.x, lap.z - a.z) < 1e-6, 'через круг — то же место');
      // Через смену — то же место, но не та же встреча: номер круга растёт
      // всегда, иначе разговор повторялся бы слово в слово каждые сутки.
      const shift = choreAt(c, dawn(s) + SHIFT_SEC);
      assert.ok(Math.hypot(shift.x - a.x, shift.z - a.z) < 1e-6, 'через смену расписание не повторилось');
      assert.equal(shift.hidden, a.hidden);
    }
  });

  test('идущий смотрит по ходу, работает только стоя', () => {
    const c = choresOf(site(), folk([{}]), () => true)[0] as Chore;
    let walked = 0;
    let worked = 0;
    for (let s = 0; s < c.circuit; s += 0.25) {
      const t = dawn(s);
      const now = choreAt(c, t);
      const next = choreAt(c, t + 0.05);
      const dx = next.x - now.x;
      const dz = next.z - now.z;
      if (now.walking && next.walking && Math.hypot(dx, dz) > 1e-3) {
        walked++;
        // Ходячий кадр обязан смотреть туда, куда движется, — ровно тот
        // разворот спиной вперёд, который правила гарнизона однажды поймали.
        const diff = Math.abs(Math.atan2(dx, dz) - now.facing) % (Math.PI * 2);
        assert.ok(Math.min(diff, Math.PI * 2 - diff) < 0.01, `спиной вперёд на ${s}-й секунде`);
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
    for (let s = 0; s < c.circuit; s += 0.2) {
      assert.equal(choreAt(c, dawn(s)).working, false);
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
      /**
       * Выборка замкнута в кольцо: последний отсчёт сравнивается с первым.
       * Перелом «сгрузил» приходится ровно на стык кругов, и в разомкнутой
       * выборке его видно, только если шаг сойдётся с длиной круга — то есть
       * правило ловило бы не ношу, а сложение дробей.
       */
      const steps = 400;
      const seen: boolean[] = [];
      for (let k = 0; k < steps; k++) seen.push(choreAt(c, dawn((k / steps) * c.circuit)).carrying);
      const flips = seen.filter((v, k) => v !== seen[(k + steps - 1) % steps]).length;
      const laden = seen.filter(Boolean).length;
      assert.equal(flips, 2, `${answer}: ноша меняется ${flips} раз за круг вместо двух`);
      assert.ok(laden > 0, `${answer}: ноша не появилась ни разу`);
      assert.ok(laden < steps, `${answer}: ноша не выпускается из рук весь круг`);
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
      for (let s = 0; s < c.circuit; s += step) {
        const now = choreAt(c, dawn(s));
        const next = choreAt(c, dawn(s + step));
        if (now.carrying === next.carrying) continue;
        assert.equal(now.walking, false, `${answer}: ноша сменилась на бегу, ${s} с`);
        const far = Math.hypot(now.x - home.x, now.z - home.z);
        if (next.carrying) assert.ok(far > 1, `${answer}: ноша взялась у костра, ${s} с`);
        else assert.ok(far < 1e-6, `${answer}: ношу бросили по дороге, ${s} с`);
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
    assert.equal(a.circuit, b.circuit);
    assert.equal(a.laps, b.laps);
    let together = 0;
    for (let s = 0; s < a.circuit * 3; s += 0.25) {
      const fa = choreAt(a, dawn(s));
      const fb = choreAt(b, dawn(s));
      assert.equal(
        fa.talk === null,
        fb.talk === null,
        `на ${s}-й секунде говорит один из пары, а второй нет`,
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
    for (let s = 0; s < lone.circuit; s += 0.5) {
      assert.equal(choreAt(lone, dawn(s)).talk, null, 'одиночка заговорил сам с собой');
    }
  });
});

describe('Сон жильцов (§24)', () => {
  test('круги укладываются в смену: последний кончается к темноте', () => {
    // Это и есть всё расписание: своих суток у рутины нет, она берёт их
    // у неба. Разойдись числа — жилец ложился бы при свете.
    for (const answer of ['строим', 'ходим'] as const) {
      const c = choresOf(site(), folk([{ answer }]), () => true)[0] as Chore;
      assert.ok(c.laps >= 1, 'на смену не пришлось ни одного круга');
      assert.ok(
        Math.abs(c.circuit * c.laps - AWAKE_SEC) < 1e-6,
        `${answer}: круги дают ${c.circuit * c.laps} с против ${AWAKE_SEC} бодрствования`,
      );
      // К первой секунде темноты жилец обязан быть дома — оттуда и уходит спать.
      const home = c.path[0]!;
      const at = choreAt(c, dawn(AWAKE_SEC));
      assert.ok(Math.hypot(at.x - home.x, at.z - home.z) < 1e-6, `${answer}: темнота застала не дома`);
    }
  });

  test('ночью с крышей спит в палатке, а не стоит у неё', () => {
    const s = site();
    const c = choresOf(s, folk([{}]), () => true)[0] as Chore;
    const tent = s.tents[0]!;
    let hidden = 0;
    for (let n = 0; n < SLEEP_SEC; n += 1) {
      const at = choreAt(c, dawn(AWAKE_SEC + n));
      if (!at.hidden) continue;
      hidden++;
      // Скрытый обязан лежать у своей палатки, а не где попало: по этой
      // точке рендер прячет тело, и уехавшая точка — уехавший жилец.
      assert.ok(Math.hypot(at.x - tent.x, at.z - tent.z) <= Math.SQRT2 + 1e-9, 'спит не у своей палатки');
      assert.equal(at.walking, false, 'спящий идёт');
      assert.equal(at.carrying, false, 'спит с бревном в руках');
    }
    // Большую часть ночи он именно спит, а не ходит туда-обратно.
    assert.ok(hidden > SLEEP_SEC * 0.6, `из ${SLEEP_SEC} с ночи скрыт всего ${hidden}`);
  });

  test('к палатке идут ногами, и туда, и обратно', () => {
    const c = choresOf(site(), folk([{}]), () => true)[0] as Chore;
    const home = c.path[0]!;
    // Первая секунда ночи — ещё дома, последняя — снова дома: между ними
    // дорога в оба конца, а не подмена места.
    const first = choreAt(c, dawn(AWAKE_SEC));
    const last = choreAt(c, dawn(SHIFT_SEC - 0.01));
    assert.ok(Math.hypot(first.x - home.x, first.z - home.z) < 0.2, 'ночь застала не дома');
    assert.ok(Math.hypot(last.x - home.x, last.z - home.z) < 0.2, 'рассвет застал не дома');
    let walked = 0;
    let prev = first;
    for (let n = 0.5; n < SLEEP_SEC; n += 0.5) {
      const at = choreAt(c, dawn(AWAKE_SEC + n));
      if (!at.hidden && !prev.hidden) {
        const step = Math.hypot(at.x - prev.x, at.z - prev.z);
        assert.ok(step < 1, `ночью жилец прыгнул на ${step.toFixed(2)} клетки`);
        walked += step;
      }
      prev = at;
    }
    assert.ok(walked > 1, 'до палатки и обратно жилец не сделал ни шага');
  });

  test('без палатки ночь проводят у огня, а не пропадают', () => {
    // Пропавший без крыши читался бы спящим под крышей, которой нет,
    // и отменял бы задание §16.1 ровно там, где оно должно быть видно.
    const s = { ...site(), tents: [] as { x: number; z: number }[] };
    const c = choresOf(s, folk([{}]), () => true)[0] as Chore;
    const home = c.path[0]!;
    for (let n = 0; n < SLEEP_SEC; n += 5) {
      const at = choreAt(c, dawn(AWAKE_SEC + n));
      assert.equal(at.hidden, false, 'жилец без палатки пропал из кадра');
      assert.ok(Math.hypot(at.x - home.x, at.z - home.z) < 1e-6, 'ночует не там, где стоял');
    }
  });

  test('днём никто не спит, ночью никто не работает', () => {
    const c = choresOf(site(), folk([{}]), () => true)[0] as Chore;
    for (let s = 0; s < AWAKE_SEC; s += 3) {
      assert.equal(choreAt(c, dawn(s)).hidden, false, `спит средь бела дня, ${s} с`);
    }
    for (let n = 0; n < SLEEP_SEC; n += 3) {
      assert.equal(choreAt(c, dawn(AWAKE_SEC + n)).working, false, `рубит ночью, ${n} с`);
    }
  });

  test('лагерь просыпается разом: личной фазы больше нет', () => {
    // Решение, а не упущение: один момент в смене, когда видно, что лагерь
    // проснулся, дороже размазанных выходов. Разъезжаются они всё равно
    // сразу — тропы разной длины.
    const chores = choresOf(site(), folk([{ answer: 'строим' }, { answer: 'ходим' }]), () => true);
    for (const c of chores) {
      if (c === null) continue;
      const home = c.path[0]!;
      const up = choreAt(c, dawn(0.01));
      assert.ok(Math.hypot(up.x - home.x, up.z - home.z) < 0.3, 'на рассвете жилец не дома');
    }
  });
});

describe('Площадка без неба (§13.8 — места мира)', () => {
  test('смена отдана кругам целиком: никто не спит и не замирает', () => {
    // У места мира свет назначен сценой раз и навсегда, и ночь по часам
    // была бы вторыми сутками в одном кадре: собиратель замирал бы у ворот
    // посреди нарисованного полудня.
    const s: ChoreSite = { ...site(), awake: SHIFT_SEC, chats: false, tents: [] };
    const c = choresOf(s, folk([{ answer: 'строим' }]), () => true)[0] as Chore;
    assert.ok(c !== null, 'рутина не выдана');
    assert.equal(c.awake, SHIFT_SEC, 'маршрут держит чужое расписание');
    const seen = new Set<string>();
    for (let t = 0; t < SHIFT_SEC; t += 7) {
      const f = choreAt(c, dawn(t));
      assert.equal(f.hidden, false, `на ${t} с собиратель пропал из кадра`);
      seen.add(`${f.x.toFixed(1)}:${f.z.toFixed(1)}`);
    }
    assert.ok(seen.size > 4, 'круг встал: за смену собиратель не сдвинулся');
  });

  test('по умолчанию небо на месте: лагерь ложится спать', () => {
    // Поле необязательное, и умолчание обязано остаться лагерным — иначе
    // §24 отменялся бы тем, что кто-то забыл его написать.
    const c = choresOf(site(), folk([{ answer: 'строим' }]), () => true)[0] as Chore;
    assert.equal(c.awake, AWAKE_SEC, 'умолчание увело лагерь из-под §24');
  });

  test('без разговора у дома пар не сводят', () => {
    // Пара, вставшая молча на шестнадцать секунд, обещала бы разговор,
    // которого игра для мест не написала: карточек, имён и настроений
    // у местных нет.
    const s: ChoreSite = { ...site(), awake: SHIFT_SEC, chats: false, tents: [] };
    const chores = choresOf(s, folk([{}, {}, {}]), () => true);
    for (const c of chores) {
      if (c === null) continue;
      assert.equal(c.partner, null, 'местным назначили напарника');
      for (let t = 0; t < c.circuit * 2; t += 3) {
        assert.equal(choreAt(c, dawn(t)).talk, null, 'местные заговорили');
      }
    }
  });
});

test('§13.8 — добытчик ходит к кусту, а не к кромке леса', () => {
  const s = site();
  // Куст ставится в середину поляны: кромка далеко, и если добытчик всё же
  // окажется у рамки, значит занятие маршрут не выбирает.
  // Куст — в стороне и от костра (8,8), и от занятых клеток: если добытчик
  // всё же встанет у рамки, значит занятие маршрут не выбирает.
  const bush = { x: 6, z: 6 };
  const withBush = { ...s, bushes: [bush] };
  const [picker, logger] = choresOf(
    withBush,
    folk([{ answer: 'кормим' }, { answer: 'строим' }]),
    () => true,
  );
  assert.ok(picker !== null && logger !== null, 'рутина не выдана');
  // Рабочая стоянка — та, где рендер играет труд; её клетка и есть место,
  // к которому жилец ходит.
  const workCell = (c: Chore): { x: number; z: number } => {
    const stop = c.stops.find((s) => s.working);
    return stop === undefined ? c.path[0]! : c.path[stop.at]!;
  };
  const near = (c: Chore): boolean => {
    const w = workCell(c);
    return Math.abs(w.x - bush.x) + Math.abs(w.z - bush.z) <= 1;
  };
  const w = workCell(picker as Chore);
  assert.ok(near(picker as Chore), `добытчик встал в (${w.x},${w.z}) вместо куста`);
  assert.ok(!near(logger as Chore), 'дровосек ушёл к ягодам');
});
