/**
 * Правила сохранения. Порядок проверок внутри файла значим: первая идёт
 * до того, как появится поддельный localStorage.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { campArea, createCamp, startUpgrade } from './camp';
import { cycleTower, putStairs, raiseWall, toggleGate } from './campWalls';
import { createRoster } from './heroes';
import { load, save, wipe } from './save';

/** Поддельный localStorage: тесты сейва живут без браузера. */
function fakeStore(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

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

    store.set('emberhold/save', '{ это не json');
    assert.equal(load().camp.levels.hq, 1);

    store.set('emberhold/save', JSON.stringify({ version: 99, levels: { hq: 6 } }));
    assert.equal(load().camp.levels.hq, 1, 'чужая версия игнорируется');

    store.set(
      'emberhold/save',
      JSON.stringify({ version: 1, levels: { hq: 999 }, resources: { stone: -5 } }),
    );
    const bad = load().camp;
    assert.equal(bad.levels.hq, 1, 'уровень вне диапазона отбрасывается');
    assert.equal(bad.resources.stone, 0, 'отрицательные ресурсы отбрасываются');
  });

  test('сейв, записанный когда камень звался солью, открывается камнем', () => {
    const store = fakeStore();
    store.set(
      'emberhold/save',
      JSON.stringify({ version: 1, resources: { salt: 42, wood: 7 } }),
    );
    const camp = load().camp;
    assert.equal(camp.resources.stone, 42, 'соль приехала в камень');
    assert.equal(camp.resources.wood, 7, 'остальные ресурсы не задеты');
  });

  test('герой, записанный Солеваром, открывается Бандитом с опытом', () => {
    const store = fakeStore();
    store.set(
      'emberhold/save',
      JSON.stringify({
        version: 1,
        levels: { hq: 4, kitchen: 1, storage: 1, forge: 0 , infirmary: 0, yard: 0},
        heroes: { active: 0, list: [{ cls: 'salter', level: 5, xp: 120, wounds: 0, status: 'ready' }] },
      }),
    );
    const hero = load().roster.heroes[0];
    // Два переименования подряд: Солевар → Носильщик → Бандит. Сейв про
    // промежуточное имя не знает и знать не обязан — LEGACY_CLASS ведёт
    // сразу в нынешний класс.
    assert.equal(hero?.cls, 'rogue', 'класс переехал через оба переименования');
    assert.equal(hero?.level, 5, 'уровень уцелел');
    assert.equal(hero?.xp, 120, 'опыт уцелел');
  });

  test('§11.7 — три старых класса открываются тремя разными новыми', () => {
    const store = fakeStore();
    store.set(
      'emberhold/save',
      JSON.stringify({
        version: 1,
        levels: { hq: 6, kitchen: 1, storage: 1, forge: 0 , infirmary: 0, yard: 0},
        heroes: {
          active: 0,
          list: [
            { cls: 'ranger', level: 3, xp: 10, wounds: 0, status: 'ready' },
            { cls: 'warrior', level: 2, xp: 20, wounds: 0, status: 'ready' },
            { cls: 'porter', level: 1, xp: 30, wounds: 0, status: 'ready' },
          ],
        },
      }),
    );
    // Отображение обязано быть биекцией: readRoster дубликаты не схлопывает,
    // и два старых класса, ведущих в один новый, дали бы отряд из двух
    // одинаковых героев — с чужим опытом на одном из них.
    const got = load().roster.heroes.map((h) => h.cls);
    assert.equal(new Set(got).size, got.length, 'ни один класс не задвоился');
    assert.deepEqual(got.slice(0, 3), ['archer', 'knight', 'rogue'], 'каждый переехал по роли');
  });

  test('новое имя сильнее старого: stone побеждает salt в одном сейве', () => {
    const store = fakeStore();
    store.set(
      'emberhold/save',
      JSON.stringify({ version: 1, resources: { stone: 3, salt: 99 } }),
    );
    assert.equal(load().camp.resources.stone, 3);
  });

  test('сейв с раскладкой за границей чинится при загрузке', () => {
    const camp = createCamp();
    camp.layout.kitchen = { x: 9, z: 9 }; // площадь при Жилье ур. 1 — 6×6
    save(camp, createRoster(), 0);
    const back = load().camp;
    assert.deepEqual(back.layout.kitchen, createCamp().layout.kitchen);
    wipe();
  });

  test('сейв, записанный до переименования игры, открывается', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };

    // Ключ старого имени проекта. Игра сменила имя — лагерь у игрока
    // остаётся: перенос молчаливый, первое сохранение ляжет под новый ключ.
    store.set(
      'new-world/save',
      JSON.stringify({ version: 1, savedAt: 0, watermark: 0, levels: { hq: 3, kitchen: 2, storage: 1, forge: 0 , infirmary: 0, yard: 0} }),
    );
    assert.equal(load().camp.levels.hq, 3, 'старый ключ прочитан');

    save(load().camp, createRoster(), 7);
    assert.ok(store.has('emberhold/save'), 'запись идёт под новый ключ');
    assert.equal(load().camp.levels.hq, 3, 'после перезаписи лагерь тот же');
    wipe();
  });

  test('сейв переживает круг save → load', () => {
    const camp = createCamp();
    camp.levels = { hq: 4, kitchen: 3, storage: 2, forge: 0 , infirmary: 0, yard: 0};
    camp.resources = { stone: 50, wood: 40, iron: 20, crystal: 3 };
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

describe('Сохранение: стены лагеря', () => {
  test('построенное переживает перезагрузку', () => {
    const camp = createCamp();
    camp.levels.hq = 5;
    const site = { area: campArea(5), layout: {}, levels: {} };
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    cycleTower(camp.walls!, site, { x: 3, z: 0 });
    toggleGate(camp.walls!, { x: 1, z: 0 });
    putStairs(camp.walls!, site, { x: 1, z: 1 });

    save(camp, createRoster(), 0);
    const back = load().camp;
    assert.deepEqual(back.walls?.cells, camp.walls!.cells, 'стены не вернулись');
    assert.deepEqual(back.walls?.towers, camp.walls!.towers, 'башни не вернулись');
    assert.deepEqual(back.walls?.gates, camp.walls!.gates, 'ворота не вернулись');
    assert.deepEqual(back.walls?.stairs, camp.walls!.stairs, 'лестницы не вернулись');
  });

  test('лагерь без стройки возвращается пустым, а не сломанным', () => {
    // Сейв, записанный до появления стен, поля не содержит вовсе: загрузка
    // обязана открыть такой лагерь, а не уронить его.
    const camp = createCamp();
    save(camp, createRoster(), 0);
    const back = load().camp;
    assert.ok(back.walls !== undefined, 'лагерь вернулся без поля стен');
    assert.deepEqual(back.walls?.cells, []);
    assert.deepEqual(back.walls?.stairs, {});
  });
});
