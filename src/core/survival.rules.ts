/**
 * Правила площади под кривой выживания. Проверяется не «числа сошлись
 * на одном примере», а то, ради чего кривая вообще нужна: что она
 * не выбрасывает оборванные наблюдения и что обрезка площади видна.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  fittedHazard,
  hazard,
  kaplanMeier,
  meanOfAll,
  meanOfDeaths,
  powerArea,
  powerFit,
  restrictedMean,
  survivalAt,
  tailArea,
} from './survival';
import type { Observation } from './survival';

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

describe('Кривая выживания (§11.3, §9)', () => {
  test('без обрывов площадь равна среднему времени гибели', () => {
    for (const n of [1, 2, 5, 17, 40]) {
      const obs: Observation[] = [];
      for (let i = 1; i <= n; i += 1) obs.push({ time: i * 0.37, dead: true });
      const curve = kaplanMeier(obs);
      assert.ok(close(curve.tail, 0), `n=${n}: кривая не досчитана до нуля`);
      assert.ok(
        close(restrictedMean(curve), meanOfDeaths(obs)!, 1e-9),
        `n=${n}: площадь ${restrictedMean(curve)} ≠ среднее ${meanOfDeaths(obs)}`,
      );
    }
  });

  /**
   * Главное утверждение модуля. Наблюдение «был жив и ушёл домой позже всех
   * погибших» обязано поднимать оценку: оно говорит, что дальше живут,
   * а среднее по одним погибшим этого не слышит.
   */
  test('обрыв позже всех смертей поднимает оценку над средним по погибшим', () => {
    const deaths: Observation[] = [1, 2, 3, 4].map((time) => ({ time, dead: true }));
    const plain = restrictedMean(kaplanMeier(deaths));
    assert.ok(close(plain, meanOfDeaths(deaths)!));

    let prev = plain;
    for (const survivors of [1, 2, 5, 20]) {
      const obs = [...deaths];
      for (let i = 0; i < survivors; i += 1) obs.push({ time: 10, dead: false });
      const area = restrictedMean(kaplanMeier(obs));
      assert.ok(area > prev, `${survivors} выживших: площадь ${area} не выросла над ${prev}`);
      assert.ok(
        area > meanOfDeaths(obs)!,
        `${survivors} выживших: площадь ${area} ниже среднего по погибшим ${meanOfDeaths(obs)}`,
      );
      prev = area;
    }
  });

  test('обрыв не считается гибелью: среднее по всем — не оценка', () => {
    const obs: Observation[] = [
      { time: 1, dead: true },
      { time: 9, dead: false },
      { time: 9, dead: false },
    ];
    // Среднее по всем засчитывает уход домой как смерть в момент ухода
    // и потому лежит между двумя неверными краями, ничего не оценивая.
    assert.ok(close(meanOfAll(obs), 19 / 3));
    assert.ok(close(meanOfDeaths(obs)!, 1));
    const curve = kaplanMeier(obs);
    // S падает на 1/3 в момент 1 и больше не меняется: площадь = 1 + (2/3)·8.
    assert.ok(close(curve.tail, 2 / 3));
    assert.ok(close(restrictedMean(curve), 1 + (2 / 3) * 8));
  });

  test('S не возрастает и лежит в [0, 1]', () => {
    const obs: Observation[] = [];
    for (let i = 0; i < 200; i += 1) {
      obs.push({ time: ((i * 7919) % 101) / 10, dead: i % 3 !== 0 });
    }
    const curve = kaplanMeier(obs);
    let prev = 1;
    for (const step of curve.steps) {
      assert.ok(step.survival <= prev + 1e-12, `S выросла на ${step.time}`);
      assert.ok(step.survival >= 0 && step.survival <= 1, `S вне [0,1] на ${step.time}`);
      assert.ok(step.deaths <= step.atRisk, `погибших больше живых на ${step.time}`);
      prev = step.survival;
    }
    assert.ok(close(survivalAt(curve, -1), 1), 'до первой ступени S ≠ 1');
    assert.ok(close(survivalAt(curve, curve.horizon), curve.tail));
  });

  test('площадь считается до горизонта, а не дальше', () => {
    const obs: Observation[] = [
      { time: 2, dead: true },
      { time: 2, dead: true },
      { time: 8, dead: false },
      { time: 8, dead: false },
    ];
    const curve = kaplanMeier(obs);
    assert.ok(close(restrictedMean(curve, 2), 2), 'до горизонта 2 площадь ≠ 2');
    assert.ok(close(restrictedMean(curve, 8), 2 + 0.5 * 6), 'до горизонта 8 площадь неверна');
  });

  test('степенная подгонка восстанавливает точную степень', () => {
    const a = 0.83;
    const b = -0.61;
    const points = [1, 2, 3, 7, 14, 30, 60].map((x) => ({ x, y: a * x ** b }));
    const fit = powerFit(points)!;
    assert.ok(close(fit.a, a, 1e-9), `a = ${fit.a}`);
    assert.ok(close(fit.b, b, 1e-9), `b = ${fit.b}`);
    assert.ok(close(fit.r2, 1, 1e-9), `r² = ${fit.r2}`);
  });

  /**
   * Расходящийся хвост — ответ, а не сбой. При `b >= -1` подогнанная кривая
   * обещает бесконечную жизнь, и молчаливый ноль вместо неё превратил бы
   * «данных мало» в «хвоста нет».
   */
  test('хвост отказывается считаться, когда расходится', () => {
    assert.equal(tailArea({ a: 1, b: -1, r2: 1 }, 30), null);
    assert.equal(tailArea({ a: 1, b: -0.5, r2: 1 }, 30), null);
    assert.equal(tailArea({ a: 1, b: -2, r2: 1 }, 0), null);
  });

  test('хвост совпадает с численным интегралом', () => {
    // Сравнивается кусок [from, to]: разность двух хвостов против суммы
    // прямоугольников. Гнать численный интеграл «до бесконечности» здесь
    // нельзя — при b близком к −1 хвост за любой обрезкой ещё весом,
    // и расходилась бы проверка, а не формула.
    for (const b of [-1.4, -2, -3.2]) {
      const fit = { a: 1.7, b, r2: 1 };
      const from = 30;
      const to = 400;
      const analytic = tailArea(fit, from)! - tailArea(fit, to)!;
      let numeric = 0;
      const dx = 0.001;
      for (let x = from; x < to; x += dx) numeric += fit.a * (x + dx / 2) ** b * dx;
      assert.ok(
        Math.abs(analytic - numeric) / analytic < 1e-5,
        `b=${b}: аналитически ${analytic}, численно ${numeric}`,
      );
    }
  });

  /**
   * Опубликованный пример чужой статьи (gdcuffs, «Риск, ARPDAU и LTV»):
   * из своих двух недель автор получает `S(t) = 0,612·t^(−0,34)` и печатает
   * LT = 27,62 дня за полугодие и 44,60 за год.
   *
   * Проверка стоит здесь не ради самой статьи, а ради нас: она привязывает
   * `powerArea` к внешнему числу, которое считал не этот код. Без такой
   * привязки «наша арифметика совпадает с методом» — утверждение без
   * свидетеля, и §22.16 не имел бы права ссылаться на статью, разбирая
   * не арифметику, а выбор горизонта.
   */
  test('powerArea воспроизводит опубликованный пример', () => {
    const fit = { a: 0.612, b: -0.34, r2: 1 };
    assert.ok(
      Math.abs(powerArea(fit, 1, 180)! - 27.62) < 0.01,
      `полугодие: ${powerArea(fit, 1, 180)}`,
    );
    assert.ok(Math.abs(powerArea(fit, 1, 365)! - 44.6) < 0.01, `год: ${powerArea(fit, 1, 365)}`);
  });

  /**
   * Тот же `b`, на котором статья считает LT, для `tailArea` расходится.
   * Две функции обязаны расходиться в ответах именно здесь: конечный срок
   * даёт число, бесконечный — отказ. Совпади они, «LT за год» читалось бы
   * как «LT», а это и есть подмена, ради которой написан §22.16.
   */
  test('конечный срок считается там, где бесконечный хвост расходится', () => {
    const fit = { a: 0.612, b: -0.34, r2: 1 };
    assert.equal(tailArea(fit, 1), null);
    assert.ok(powerArea(fit, 1, 365)! > 0);
  });

  test('powerArea совпадает с численным интегралом', () => {
    for (const b of [-0.34, -1, -1.6]) {
      const fit = { a: 0.9, b, r2: 1 };
      const [from, to] = [1, 200];
      const analytic = powerArea(fit, from, to)!;
      let numeric = 0;
      const dx = 0.001;
      for (let x = from; x < to; x += dx) numeric += fit.a * (x + dx / 2) ** b * dx;
      assert.ok(
        Math.abs(analytic - numeric) / analytic < 1e-5,
        `b=${b}: аналитически ${analytic}, численно ${numeric}`,
      );
    }
  });

  /**
   * Определение функции риска: доля погибших среди доживших. Проверяется
   * на данных, где ответ известен руками, — иначе «ĥ считается правильно»
   * держится на той же арифметике, что и сама ĥ.
   */
  test('риск — это доля погибших среди доживших', () => {
    // Десять наблюдений: по одной гибели в каждой десятой доле времени.
    const obs: Observation[] = [];
    for (let i = 0; i < 10; i += 1) obs.push({ time: i * 0.1 + 0.05, dead: true });
    const bins = hazard(obs, 0.1, 1);
    assert.equal(bins.length, 10);
    bins.forEach((b, i) => {
      assert.equal(b.atRisk, 10 - i, `ведро ${i}: живых ${b.atRisk}`);
      assert.equal(b.deaths, 1);
      // rate = 1 / (10−i) / 0,1 — доля на единицу времени, а не на ведро.
      assert.ok(close(b.rate, 1 / (10 - i) / 0.1, 1e-9), `ведро ${i}: ĥ ${b.rate}`);
    });
  });

  /**
   * Главное, ради чего риск считается отдельно от кривой. Ровный отсев
   * и стена дают одинаково падающую `S`, и различить их можно только по `ĥ`.
   */
  test('стена видна в риске и не видна в кривой', () => {
    const flat: Observation[] = [];
    const wall: Observation[] = [];
    for (let i = 0; i < 100; i += 1) {
      // Ровный отсев: гибели размазаны по всей длине.
      flat.push({ time: (i + 0.5) / 100, dead: i < 50 });
      // Стена: столько же гибелей, но все в последней десятой доле.
      wall.push(i < 50 ? { time: 0.95, dead: true } : { time: (i + 0.5) / 100, dead: false });
    }
    // Обе кривые убывают и кончаются одинаково — по числу выживших не различить.
    assert.equal(kaplanMeier(flat).deaths, kaplanMeier(wall).deaths);

    const rate = (o: readonly Observation[]): number[] => hazard(o, 0.1, 1).map((b) => b.rate);
    const [f, w] = [rate(flat), rate(wall)];
    // У ровного отсева риск нигде не даёт пика: разброс укладывается в разы.
    assert.ok(Math.max(...f) / Math.max(...f.filter((x) => x > 0)) < 2, `ровный: ${f}`);
    // У стены весь риск в одном ведре, а до него — ноль.
    assert.ok(w.slice(0, 9).every((x) => x === 0), `стена: ${w}`);
    assert.ok(w[9]! > Math.max(...f) * 5, `стена: пик ${w[9]} против ровного ${Math.max(...f)}`);
  });

  /**
   * `fittedHazard` — производная логарифма подогнанной кривой, и проверяется
   * она численно: формула `−b/t` записана в модуле руками, и совпадение
   * с наклоном `ln S` — единственное, что подтверждает, что записана верно.
   */
  test('риск подгонки равен наклону логарифма кривой', () => {
    for (const b of [-0.34, -0.9, -1.7]) {
      const fit = { a: 0.612, b, r2: 1 };
      for (const t of [1, 7, 30, 180]) {
        const dt = t * 1e-6;
        const s = (x: number): number => Math.log(fit.a * x ** fit.b);
        const numeric = -(s(t + dt) - s(t - dt)) / (2 * dt);
        assert.ok(
          Math.abs(fittedHazard(fit, t)! - numeric) / numeric < 1e-6,
          `b=${b}, t=${t}: ${fittedHazard(fit, t)} против ${numeric}`,
        );
      }
    }
    assert.equal(fittedHazard({ a: 1, b: -0.5, r2: 1 }, 0), null);
  });

  /**
   * Утверждение о риске, которое степень несёт в себе, — «риск падает».
   * Оно записано здесь затем, чтобы §22.17 мог на него ссылаться: растущий
   * риск по глубине опровергает не точность подгонки, а её семейство.
   */
  test('степенная подгонка умеет только падающий риск', () => {
    for (const b of [-0.1, -0.34, -2]) {
      const fit = { a: 0.9, b, r2: 1 };
      let prev = Infinity;
      for (const t of [0.1, 0.5, 1, 10, 100]) {
        const h = fittedHazard(fit, t)!;
        assert.ok(h < prev, `b=${b}: риск на ${t} не ниже предыдущего`);
        prev = h;
      }
    }
  });

  test('пустые данные не роняют счёт', () => {
    const curve = kaplanMeier([]);
    assert.equal(curve.total, 0);
    assert.equal(curve.deaths, 0);
    assert.ok(close(restrictedMean(curve), 0));
    assert.equal(meanOfDeaths([]), null);
    assert.ok(close(meanOfAll([]), 0));
    assert.equal(powerFit([{ x: 1, y: 1 }]), null);
  });
});
