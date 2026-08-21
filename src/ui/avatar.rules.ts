/**
 * Правила лиц (`avatar.ts`).
 *
 * Проверяется не «красиво ли» — это видно глазом на `?веер`, — а три вещи,
 * которые ломаются молча: лицо не меняется между перерисовками, виды
 * не сливаются в одно, и цвета взяты из тех самых 34 артбука, а не подобраны
 * рядом с ними.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MATERIAL } from '../core/palette';
import { AVATAR_LOOKS, avatarSvg } from './avatar';

const PALETTE = new Set(
  Object.values(MATERIAL).map((c) => `#${c.toString(16).padStart(6, '0')}`),
);

describe('Лица веера', () => {
  /**
   * Тот же человек — то же лицо. Лицо выводится из сида, как и сам поселенец
   * (`settler.ts`): случайное при каждой отрисовке меняло бы человека
   * на глазах, а веер перерисовывается на каждый кадр прокрутки.
   */
  test('лицо выводится из вида и сида', () => {
    for (const look of AVATAR_LOOKS) {
      for (let seed = 0; seed < 50; seed++) {
        assert.equal(avatarSvg(look, seed), avatarSvg(look, seed), `${look}/${seed}: лицо поплыло`);
      }
    }
  });

  /**
   * Виды различимы силуэтом. Если два вида дают одну разметку, портрет
   * перестаёт что-либо говорить, и веер становится рядом одинаковых кружков.
   */
  test('виды не сливаются друг с другом', () => {
    const seen = new Map<string, string>();
    for (const look of AVATAR_LOOKS) {
      const svg = avatarSvg(look, 1);
      const twin = seen.get(svg);
      assert.equal(twin, undefined, `${look} и ${twin} нарисованы одинаково`);
      seen.set(svg, look);
    }
  });

  /** Сид меняет человека, а не только оттенок фона: лица обязаны различаться. */
  test('сид даёт разные лица внутри одного вида', () => {
    for (const look of AVATAR_LOOKS) {
      const kinds = new Set<string>();
      for (let seed = 0; seed < 30; seed++) kinds.add(avatarSvg(look, seed));
      assert.ok(kinds.size >= 3, `${look}: всего ${kinds.size} лица на 30 сидов`);
    }
  });

  /**
   * **Цвета — из тех же 34** (§6.1). Второй набор рядом с первым читается
   * чужой игрой, и появляется он именно так: один подобранный «почти такой же»
   * серый в прототипе.
   */
  test('все цвета лица взяты из палитры артбука', () => {
    for (const look of AVATAR_LOOKS) {
      for (let seed = 0; seed < 20; seed++) {
        for (const m of avatarSvg(look, seed).matchAll(/#[0-9a-f]{6}/g)) {
          assert.ok(PALETTE.has(m[0]), `${look}: цвет ${m[0]} не из палитры`);
        }
      }
    }
  });

  /**
   * Лицо ничего не грузит: ни картинок, ни шрифтов, ни ссылок наружу.
   * Сорок аватаров на дуге — это сорок запросов, если недоглядеть.
   */
  test('лицо не тянет ничего снаружи', () => {
    for (const look of AVATAR_LOOKS) {
      const svg = avatarSvg(look, 3);
      for (const bad of ['<image', 'href', 'url(', '<script', '<foreignObject']) {
        assert.ok(!svg.includes(bad), `${look}: в разметке ${bad}`);
      }
      assert.ok(svg.startsWith('<svg viewBox="0 0 44 44"'), `${look}: нет своей системы координат`);
      assert.ok(svg.endsWith('</svg>'), `${look}: разметка не закрыта`);
    }
  });
});
