/**
 * Правила сохранения. Порядок проверок внутри файла значим: первая идёт
 * до того, как появится поддельный localStorage.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp, startUpgrade } from './camp';
import { createRoster } from './heroes';
import { load, save, wipe } from './save';

describe('Сохранение', () => {
  test('save/load не падают без localStorage (Node, приватный режим)', () => {
    const camp = createCamp();
    camp.levels.hq = 3;
    save(camp, createRoster(), 123);
    const loaded = load();
    assert.equal(loaded.camp.levels.hq, 1, 'без хранилища — чистый лагерь');
    wipe();
  });

  test('битый и чужой сейв не роняет игру', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };

    store.set('new-world/save', '{ это не json');
    assert.equal(load().camp.levels.hq, 1);

    store.set('new-world/save', JSON.stringify({ version: 99, levels: { hq: 6 } }));
    assert.equal(load().camp.levels.hq, 1, 'чужая версия игнорируется');

    store.set(
      'new-world/save',
      JSON.stringify({ version: 1, levels: { hq: 999 }, resources: { salt: -5 } }),
    );
    const bad = load().camp;
    assert.equal(bad.levels.hq, 1, 'уровень вне диапазона отбрасывается');
    assert.equal(bad.resources.salt, 0, 'отрицательные ресурсы отбрасываются');
  });

  test('сейв с раскладкой за границей чинится при загрузке', () => {
    const camp = createCamp();
    camp.layout.kitchen = { x: 9, z: 9 }; // площадь при Штабе ур. 1 — 6×6
    save(camp, createRoster(), 0);
    const back = load().camp;
    assert.deepEqual(back.layout.kitchen, createCamp().layout.kitchen);
    wipe();
  });

  test('сейв переживает круг save → load', () => {
    const camp = createCamp();
    camp.levels = { hq: 4, kitchen: 3, storage: 2, forge: 0 };
    camp.resources = { salt: 50, wood: 40, iron: 20, crystal: 3 };
    camp.layout.kitchen = { x: 6, z: 3 };
    assert.equal(startUpgrade(camp, 'storage', 500), true);
    save(camp, createRoster(), 777);

    const { camp: back, watermark } = load();
    assert.deepEqual(back.levels, camp.levels);
    assert.deepEqual(back.resources, camp.resources);
    assert.deepEqual(back.layout.kitchen, { x: 6, z: 3 });
    assert.equal(back.construction?.building, 'storage');
    assert.equal(watermark, 777);
    wipe();
  });
});
