/**
 * Правила веера (`fan.ts`).
 *
 * Проверяется то, что глазом на телефоне не ловится: слоты не налезают
 * ни на каком радиусе, прокрутка не теряет людей и не показывает одного
 * дважды, а пустой обвод не выдаёт себя за замер. Само «удобно ли пальцу»
 * тестом не проверяется вовсе — на то и упражнение в сцене.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FITS,
  QUADRANT,
  SHAPE,
  TAP,
  calibrated,
  capacity,
  clampOffset,
  emptyReach,
  layout,
  makeDrill,
  maxOffset,
  minRadius,
  tight,
  answer,
  reachAt,
  reached,
  record,
  result,
  scrolls,
  step,
  target,
} from './fan';
import type { FanShape } from './fan';

const shape = (over: Partial<FanShape> = {}): FanShape => ({ ...SHAPE, ...over });

const RADII = [110, 130, 180, 240, 320];
const SIZES = [36, 44, 56, 72];

describe('Веер под большой палец', () => {
  /**
   * **Мест на дуге столько, сколько решено, и радиус этого не меняет.**
   * Пока ёмкость выводилась из радиуса, «сколько человек в веере» зависело
   * от ручки, а не от решения, — и число, на котором стоит весь контрол,
   * менялось само собой.
   */
  test('мест на дуге четыре при любом радиусе', () => {
    assert.equal(FITS, 4, 'решение о числе мест переписано мимо документа');
    assert.equal(SHAPE.fits, FITS);
    for (const radius of RADII) {
      assert.equal(capacity(shape({ radius })), FITS, `r=${radius}: мест стало другое число`);
      assert.equal(layout(shape({ radius }), FITS).length, FITS, `r=${radius}: слот пропал`);
    }
  });

  /**
   * **Главное геометрическое свойство.** Соседние слоты не сходятся ближе
   * `size + gap` по прямой — иначе два кружка сливаются в один, и промах
   * перестаёт быть промахом пальца, становясь промахом раскладки.
   * Считать это дугой, а не хордой, на малом радиусе уже неверно.
   */
  test('на потребном радиусе слоты не налезают, ниже него — признают тесноту', () => {
    for (const size of SIZES) {
      const need = minRadius(shape({ size }));
      const s = shape({ size, radius: Math.ceil(need) });
      assert.equal(tight(s), false, `size=${size}: потребный радиус объявлен тесным`);
      const slots = layout(s, s.fits);
      for (let i = 1; i < slots.length; i++) {
        const a = slots[i - 1]!;
        const b = slots[i]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(
          d + 1e-6 >= s.size + s.gap,
          `size=${size}: соседи в ${d.toFixed(1)} px при нужных ${s.size + s.gap}`,
        );
      }
      assert.equal(tight(shape({ size, radius: Math.floor(need) - 1 })), true, 'теснота промолчала');
    }
  });

  /** Потребный радиус растёт с поперечником слота и не бывает нулём. */
  test('крупному слоту нужна дуга шире', () => {
    let prev = 0;
    for (const size of SIZES) {
      const need = minRadius(shape({ size }));
      assert.ok(need > 0 && Number.isFinite(need), `size=${size}: потребный радиус — не число`);
      assert.ok(need > prev, `size=${size}: слот вырос, а радиус не потребовался больше`);
      prev = need;
    }
  });

  /** Вырожденный радиус не роняет сцену: ручка крутится до упора. */
  test('крохотный радиус не даёт NaN, а называется теснотой', () => {
    const s = shape({ radius: 1 });
    assert.ok(Number.isFinite(step(s)), 'шаг перестал быть числом');
    assert.equal(tight(s), true, 'на пятачке теснота не признана');
    assert.equal(layout(s, 9).length, FITS, 'мест стало другое число');
  });

  /**
   * Прокрутка появляется ровно тогда, когда люди перестали помещаться,
   * и не раньше. Жест, который есть, но ничего не двигает, читается поломкой:
   * палец тянет дугу, дуга стоит.
   */
  test('пока все помещаются — крутить нечего', () => {
    for (const radius of RADII) {
      const s = shape({ radius });
      const fits = s.fits;
      assert.equal(maxOffset(s, fits), 0, `r=${radius}: дуга крутится, хотя все влезли`);
      assert.equal(scrolls(s, fits), false);
      assert.ok(maxOffset(s, fits + 1) > 0, `r=${radius}: лишний человек не включил прокрутку`);
      assert.equal(scrolls(s, fits + 1), true);
    }
  });

  /**
   * Ни один человек не пропадает совсем: до каждого можно докрутить.
   * Это то самое свойство, которым список отличается от обрезанного списка,
   * и ломается оно молча — крайний просто не показывается никогда.
   */
  test('прокрутка достаёт каждого и никого не двоит', () => {
    const s = shape({ radius: 130 });
    const count = 24;
    const seen = new Set<number>();
    const top = maxOffset(s, count);
    for (let k = 0; k <= 40; k++) {
      const slots = layout(s, count, clampOffset(s, count, (top * k) / 40));
      const here = slots.map((x) => x.i);
      assert.equal(new Set(here).size, here.length, 'один человек показан дважды');
      for (const i of here) seen.add(i);
    }
    assert.equal(seen.size, count, `докрутить удалось лишь до ${seen.size} из ${count}`);
  });

  test('дуга упирается в концы, а не проматывается за них', () => {
    const s = shape();
    const count = 20;
    assert.equal(clampOffset(s, count, -5), 0, 'ушли до начала');
    assert.equal(clampOffset(s, count, 99), maxOffset(s, count), 'ушли за конец');
    const first = layout(s, count, 0);
    assert.equal(first[0]!.i, 0, 'в начале не видно первого');
    const last = layout(s, count, maxOffset(s, count));
    assert.equal(last[last.length - 1]!.i, count - 1, 'в конце не видно последнего');
  });

  /** Левая рука — зеркало правой, и ничего больше. */
  test('рука зеркалит дугу, а не меняет её', () => {
    const right = layout(shape({ hand: 'правая' }), 4);
    const left = layout(shape({ hand: 'левая' }), 4);
    assert.equal(right.length, left.length);
    for (let i = 0; i < right.length; i++) {
      assert.ok(Math.abs(right[i]!.x + left[i]!.x) < 1e-9, `слот ${i}: x не зеркален`);
      assert.ok(Math.abs(right[i]!.y - left[i]!.y) < 1e-9, `слот ${i}: y уехал`);
    }
  });

  /* ---------- обвод ---------- */

  /**
   * **Пустой обвод не врёт.** Досягаемость до замера неизвестна, и назначить
   * её числом из статьи значило бы получить ответ, не проведя замера.
   * Поэтому по умолчанию не достижимо ничего, а сцена говорит «не обведено».
   */
  test('без обвода не достижимо ничего', () => {
    const reach = emptyReach();
    assert.equal(calibrated(reach), false);
    for (const slot of layout(shape(), 6)) {
      assert.equal(reached(reach, slot), false, 'слот объявлен достижимым до обвода');
    }
  });

  test('обвод поднимает только обведённый сектор и берёт дальнюю точку', () => {
    const reach = emptyReach();
    record(reach, QUADRANT / 2, 100);
    record(reach, QUADRANT / 2, 60);
    assert.equal(reachAt(reach, QUADRANT / 2), 100, 'ближняя точка затёрла дальнюю');
    assert.equal(reachAt(reach, 0), 0, 'соседний сектор поднялся сам');
    assert.equal(calibrated(reach), true);
    record(reach, -0.1, 300);
    record(reach, QUADRANT + 0.1, 300);
    assert.equal(reachAt(reach, 0), 0, 'точка вне четверти попала в обвод');
  });

  test('слот достижим ровно до обведённого радиуса', () => {
    const s = shape({ radius: 130 });
    const reach = emptyReach();
    const slots = layout(s, capacity(s));
    for (const slot of slots) record(reach, slot.angle, 130);
    for (const slot of slots) assert.ok(reached(reach, slot), 'обведённый слот не достижим');
    const far = layout(shape({ radius: 134 }), capacity(s));
    for (const slot of far) assert.ok(!reached(reach, slot), 'слот за обводом объявлен достижимым');
  });

  /* ---------- упражнение ---------- */

  test('тот же сид — то же упражнение', () => {
    assert.deepEqual(makeDrill(5, 3, 7).order, makeDrill(5, 3, 7).order);
  });

  test('каждого просят поровну и никого не просят дважды подряд', () => {
    for (const count of [2, 3, 5, 12, 20]) {
      const drill = makeDrill(count, 3, count);
      const seen = new Map<number, number>();
      for (const i of drill.order) seen.set(i, (seen.get(i) ?? 0) + 1);
      assert.equal(seen.size, count, `${count}: кого-то не просят вовсе`);
      for (const [who, n] of seen) assert.equal(n, 3, `${count}: человека ${who} просят ${n} раз`);
      for (let k = 1; k < drill.order.length; k++) {
        assert.notEqual(
          drill.order[k],
          drill.order[k - 1],
          `${count}: задание ${k} повторяет предыдущее — время выйдет не про поиск`,
        );
      }
    }
  });

  /**
   * Промах записывается промахом и в медиану не входит: иначе достаточно
   * бить мимо быстро, и веер получится тем удобнее, чем хуже он работает.
   */
  test('промах считается промахом и не ускоряет медиану', () => {
    const drill = makeDrill(4, 1, 3);
    const order = [...drill.order];
    answer(drill, order[0]!, 600);
    answer(drill, -1, 10);
    answer(drill, order[2]!, 800);
    const r = result(drill);
    assert.equal(r.заданий, 3);
    assert.equal(r.промахов, 1);
    assert.equal(r.попаданий, 2);
    assert.equal(r.медиана, 700, 'десять миллисекунд промаха попали в медиану');
  });

  test('упражнение кончается и не просит сверх списка', () => {
    const drill = makeDrill(3, 1, 5);
    for (let i = 0; i < 3; i++) answer(drill, target(drill)!, 500);
    assert.equal(target(drill), null, 'упражнение просит четвёртое из трёх');
    answer(drill, 0, 100);
    assert.equal(result(drill).заданий, 3, 'после конца записалось лишнее');
  });

  /** Нижняя граница нажатия — не украшение: слот меньше неё не берётся. */
  test('слот по умолчанию не мельче нижней границы нажатия', () => {
    assert.ok(SHAPE.size >= TAP, `слот ${SHAPE.size} px мельче ${TAP} px`);
  });

  /** Раскладка по умолчанию обязана быть рабочей, а не «поправьте радиус». */
  test('раскладка по умолчанию не тесная', () => {
    assert.equal(
      tight(SHAPE),
      false,
      `радиус ${SHAPE.radius} мельче потребных ${Math.ceil(minRadius(SHAPE))}`,
    );
  });
});
