import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CAMP_MODELS, CAMP_SLOTS } from './camp.data';
import { CAMP_SLOT_ORDER, MATERIAL } from './palette';
import {
  DOOR, DOORS, WINDOWS, doorAngle, glassMaterial, hutParts, setHutNight, stepDoor, windowLight,
} from './hut';
import type { DoorId, WindowId } from './hut';
import { decode } from './baked';

/**
 * Хижина, собранная из частей (§6.1.11). Проверяется не «красиво ли», а три
 * обещания, каждое из которых протухает молча.
 *
 * Первое: вариант встаёт в проём. Матрица узла запечена вместе с домом,
 * и разъехаться она может при любой правке скрипта сборки — а видно это
 * будет как дверь, висящая в воздухе рядом со стеной.
 *
 * Второе: стекло — отдельная часть и единственная со своим слотом. Стоит
 * слоту «стекло» появиться в теле дома, и ночью засветится сруб.
 *
 * Третье: огонёк окна стоит в окне. Свет, уехавший от стекла, читается
 * не «в доме горит», а «рядом с домом что-то светится».
 */
const HEIGHT = 2.4;
const DOOR_IDS = Object.keys(DOORS) as DoorId[];
const WINDOW_IDS = Object.keys(WINDOWS) as WindowId[];

/** Габарит геометрии по осям. */
function boundsOf(geometry: { getAttribute: (n: string) => { array: ArrayLike<number> } }): {
  min: number[];
  max: number[];
} {
  const p = geometry.getAttribute('position').array;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c]!, p[i + c]!);
      max[c] = Math.max(max[c]!, p[i + c]!);
    }
  }
  return { min, max };
}

describe('Хижина: дом собирается из частей', () => {
  test('порядок слотов в палитре — тот же, что в запечённом наборе', () => {
    assert.deepEqual([...CAMP_SLOT_ORDER], [...CAMP_SLOTS]);
  });

  test('каждый слот набора есть среди цветов артбука', () => {
    for (const name of CAMP_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  test('у дома есть оба узла вставки', () => {
    for (const node of ['doorslot', 'winslot'] as const) {
      assert.ok(CAMP_MODELS.Hut.hand?.[node] !== undefined, `у хижины нет узла ${node}`);
    }
  });

  test('каждый вариант двери и окна есть в наборе и не пуст', () => {
    for (const name of [...Object.values(DOORS), ...Object.values(WINDOWS), 'Glass'] as const) {
      const model = CAMP_MODELS[name as keyof typeof CAMP_MODELS];
      assert.ok(model !== undefined, `в наборе нет модели ${name}`);
      assert.ok(model.tris > 0, `${name}: пустая геометрия`);
    }
  });

  /**
   * Проём объявлен домом, вставка нарисована отдельно, и совпадать они обязаны
   * в единицах игры, а не в единицах чьего-то замысла. Мерка — габарит: дверь
   * стоит у передней стены, не шире проёма и не выше его.
   */
  test('вставка попадает в проём, а не висит рядом', () => {
    const hut = boundsOf(hutParts({ door: 'plank', window: 'cross' }, HEIGHT).body);
    for (const door of DOOR_IDS) {
      for (const win of WINDOW_IDS) {
        const parts = hutParts({ door, window: win }, HEIGHT);
        const whole = boundsOf(parts.body);
        const leaf = boundsOf(parts.door);
        for (const c of [0, 1, 2]) {
          whole.min[c] = Math.min(whole.min[c]!, leaf.min[c]!);
          whole.max[c] = Math.max(whole.max[c]!, leaf.max[c]!);
        }
        // Вставки не расширяют дом: створки ставни выходят за раму, но
        // остаются под свесом крыши.
        for (const c of [0, 2]) {
          assert.ok(
            whole.min[c]! >= hut.min[c]! - 0.02 && whole.max[c]! <= hut.max[c]! + 0.02,
            `${door}+${win}: вставка вылезла за габарит дома по оси ${c}`,
          );
        }
        assert.ok(whole.min[1]! >= -0.01, `${door}+${win}: вставка ушла под землю`);
        assert.ok(whole.max[1]! <= HEIGHT + 0.01, `${door}+${win}: вставка выше конька`);
      }
    }
  });

  /**
   * Дверь висит на петле дома. Проверяется не угол, а то, что закрытая створка
   * стоит в проёме, а открытая из него уходит: петля, подобранная в коде,
   * даёт дверь, которая при повороте разъезжается со стеной, и увидеть это
   * можно только глазом и только в движении.
   */
  test('закрытая дверь стоит в проёме, открытая уходит наружу', () => {
    const parts = hutParts({ door: 'plank', window: 'cross' }, HEIGHT);
    const door = boundsOf(parts.door);
    for (const c of [0, 1, 2]) {
      assert.ok(
        parts.hinge[c]! >= door.min[c]! - 0.06 && parts.hinge[c]! <= door.max[c]! + 0.06,
        `петля вне полотна по оси ${c}`,
      );
    }
    // Створка распахивается наружу — от дома, а не в темноту проёма.
    assert.ok(doorAngle(1) < 0, 'дверь открывается внутрь');
    assert.ok(Math.abs(doorAngle(1)) < Math.PI / 2, 'створка встала поперёк проёма');
    assert.equal(Math.abs(doorAngle(0)), 0, 'закрытая дверь повёрнута');
  });

  test('ход двери считается временем, а не кадрами', () => {
    // Полный ход занимает DOOR.time секунд при любой частоте кадров.
    for (const fps of [30, 60, 144]) {
      let open = 0;
      const dt = 1 / fps;
      let frames = 0;
      while (open < 1 && frames < fps * 5) {
        open = stepDoor(open, true, dt);
        frames++;
      }
      const seconds = frames / fps;
      assert.ok(
        Math.abs(seconds - DOOR.time) <= dt * 1.5,
        `${fps} кадров: дверь открылась за ${seconds}, а не за ${DOOR.time}`,
      );
    }
    // И закрывается тем же ходом, не застревая на краях.
    let open = 1;
    for (let i = 0; i < 100; i++) open = stepDoor(open, false, 1 / 60);
    assert.equal(open, 0);
  });

  test('стекло — отдельная часть, и слота «стекло» в теле дома нет', () => {
    const glassAt = CAMP_SLOTS.indexOf('стекло');
    assert.ok(glassAt >= 0, 'в наборе нет слота «стекло»');
    for (const [name, model] of Object.entries(CAMP_MODELS)) {
      const used = new Set(decode(model.slot));
      if (name === 'Glass') {
        assert.deepEqual([...used], [glassAt], 'стекло красится не только слотом «стекло»');
      } else {
        assert.ok(!used.has(glassAt), `${name}: слот «стекло» вне модели стекла — засветится не окно`);
      }
    }
  });

  /**
   * Стёкол в доме два: окно стены и окошко фронтона. Второе появилось потому,
   * что чёрная отдушина читалась дырой — ровно тем, за что до неё выкинули
   * чёрный проём окна. Мерка простая: стекло вставлено дважды, а модель
   * стекла в наборе по-прежнему одна.
   */
  test('оба проёма застеклены одной моделью стекла', () => {
    const parts = hutParts({ door: 'plank', window: 'cross' }, HEIGHT);
    const panes = parts.glass.getIndex()!.count / 3;
    assert.equal(panes, CAMP_MODELS.Glass.tris * 2, 'застеклён не каждый проём');
    assert.ok(CAMP_MODELS.Hut.hand?.['ventslot'] !== undefined, 'у фронтона нет узла');
  });

  test('огонёк окна стоит в самом окне', () => {
    const parts = hutParts({ door: 'plank', window: 'cross' }, HEIGHT);
    const glass = boundsOf(parts.glass);
    for (let c = 0; c < 3; c++) {
      assert.ok(
        parts.lamp[c]! >= glass.min[c]! - 0.05 && parts.lamp[c]! <= glass.max[c]! + 0.05,
        `огонёк вне стекла по оси ${c}: ${parts.lamp[c]} вне [${glass.min[c]}, ${glass.max[c]}]`,
      );
    }
    // Свет один и стоит у окна жилья: огонёк под коньком светил бы чердаку.
    const win = CAMP_MODELS.Hut.hand!['winslot']!;
    assert.ok(Math.abs(parts.lamp[1]!) < HEIGHT * 0.75, 'огонёк уехал под конёк');
    assert.ok(win[13]! < CAMP_MODELS.Hut.hand!['ventslot']![13]!, 'узлы окна и фронтона перепутаны');
  });

  /**
   * Ночь ведёт одна функция, и разъехаться свету со стеклом нельзя: тёмное
   * окно при горящем фонаре читается сбоем, а светящееся при погашенном —
   * дырой в стене.
   */
  test('день гасит и стекло, и свет; ночь зажигает оба', () => {
    const glass = glassMaterial();
    const light = windowLight();
    setHutNight(0, glass, light);
    assert.equal(glass.emissiveIntensity, 0);
    assert.equal(light.intensity, 0);
    setHutNight(1, glass, light);
    assert.ok(glass.emissiveIntensity > 0 && light.intensity > 0);
    // Свет окна слабее костра (20 в fire.ts): окно светит жильём, а не площадью.
    assert.ok(light.intensity < 20, 'окно светит ярче костра');
    setHutNight(4, glass, light);
    assert.equal(glass.emissiveIntensity, 1, 'ночь ярче единицы ничего не меняет');
  });

  test('дом с вариантами укладывается в свой потолок — килобайты', () => {
    /**
     * 20 КБ — взятое сейчас, округлённое вверх: дом, две двери, два окна
     * и стекло. Считается тем же способом, что у скелетов, героев и жильцов —
     * по самому файлу и в gzip.
     */
    const source = readFileSync(new URL('./camp.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= 20, `постройки лагеря: ${kb} КБ gzip > 20 КБ`);
  });

  /**
   * Смысл сборки из частей — в том, что общие брёвна лежат в бандле один раз.
   * Проверка на это и стоит: четыре вида дома обязаны стоить дешевле, чем
   * четыре дома.
   */
  test('четыре вида дома дешевле четырёх домов', () => {
    const whole = DOOR_IDS.length * WINDOW_IDS.length * CAMP_MODELS.Hut.tris;
    const kit = Object.values(CAMP_MODELS).reduce((sum, m) => sum + m.tris, 0);
    assert.ok(kit < whole, `набор ${kit} против ${whole} у четырёх готовых домов`);
  });
});
