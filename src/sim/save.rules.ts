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
import { createRoster, syncRoster } from './heroes';
import { emptyGear } from './gear';
import { ticketOf } from './sortie';
import { residentUuid } from './residents';
import {
  FARM_DEFAULT_CROP,
  FARM_PLOT_COUNT,
  FARM_STARTING_PLOT_COUNT,
  emptyFarmPlots,
  emptyFarmStory,
} from './farm';
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

  test('старое сохранение получает новые постройки непостроенными', () => {
    const store = fakeStore();
    store.set('emberhold/save', JSON.stringify({
      version: 1,
      levels: { hq: 4, kitchen: 2, storage: 2, forge: 1, infirmary: 0, yard: 0 },
    }));
    const camp = load().camp;
    assert.equal(camp.levels.archery, 0);
    assert.equal(camp.levels.barracks, 0);
    assert.equal(camp.levels.watchtower, 0);
    assert.ok(camp.layout.archery !== undefined);
    assert.ok(camp.layout.barracks !== undefined);
    assert.ok(camp.layout.watchtower !== undefined);
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

  test('репутация, ротация и реликты минотавра переживают перезапуск', () => {
    fakeStore();
    const camp = createCamp();
    camp.minotaurReputation = 7;
    camp.minotaurQuestCycle = 4;
    camp.minotaurRelics = { '42': 'golem-heart' };
    camp.minotaurQuests = {
      '42': {
        id: 'golem-clamps', title: 'Железо для оков голема',
        kind: 'iron', amount: 5, reward: 26, reputation: 2, completed: false,
      },
    };
    save(camp, createRoster(), 0);
    const back = load().camp;
    assert.equal(back.minotaurReputation, 7);
    assert.equal(back.minotaurQuestCycle, 4);
    assert.equal(back.minotaurRelics?.['42'], 'golem-heart');
    assert.equal(back.minotaurQuests?.['42']?.id, 'golem-clamps');
    assert.equal(back.minotaurQuests?.['42']?.reputation, 2);
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
    assert.equal(hero?.skillLevel, 1, 'новое умение начинается с первой ступени');
    assert.equal(hero?.skillPoints, 4, 'старые уровни ретроактивно дали очки умения');
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
    camp.levels = { hq: 4, kitchen: 3, storage: 2, forge: 0, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
    camp.resources = { stone: 50, wood: 40, iron: 20, crystal: 3, food: 0 };
    camp.layout.kitchen = { x: 6, z: 3 };
    camp.supplyPity = 7;
    assert.equal(startUpgrade(camp, 'storage', 500), true);
    save(camp, createRoster(), 777);

    const { camp: back, watermark } = load();
    assert.deepEqual(back.levels, camp.levels);
    assert.deepEqual(back.resources, camp.resources);
    assert.deepEqual(back.layout.kitchen, { x: 6, z: 3 });
    assert.equal(back.construction?.building, 'storage');
    assert.equal(back.supplyPity, 7, 'гарантия ларца сбросилась при перезапуске');
    assert.equal(watermark, 777);
    wipe();
  });

  /**
   * **Лицо переживает перезагрузку.** Лицо жильца выводится из сида
   * (`ui/avatar.ts`), и сид обязан лежать в сейве: без него игрок возвращался
   * бы в лагерь, где все живут с новыми лицами.
   */
  test('жилец возвращается с тем же лицом', () => {
    const camp = createCamp();
    camp.residents = [{ name: 'Гита', look: 'поселенец', seed: 12345, answer: 'строим', rest: false }];
    save(camp, createRoster(), 1);
    assert.deepEqual(load().camp.residents, [{ ...camp.residents[0]!, id: residentUuid(camp.residents[0]!) }]);
    wipe();
  });

  test('счёт лис, смена и незавершённая охота переживают перезагрузку', () => {
    const camp = createCamp();
    camp.foxesCaught = 12;
    camp.residents = [{
      name: 'Гита',
      look: 'поселенец',
      seed: 12345,
      answer: 'строим',
      rest: false,
      schedule: 'поздняя',
      hunt: { startedAt: 100, endsAt: 18100, seed: 77 },
    }];
    save(camp, createRoster(), 101);
    const back = load().camp;
    assert.equal(back.foxesCaught, 12);
    assert.equal(back.residents[0]?.schedule, 'поздняя');
    assert.deepEqual(back.residents[0]?.hunt, camp.residents[0]?.hunt);
    wipe();
  });

  /**
   * **Ремесло переживает перезагрузку** (§6.1.6.3). Лесник куплен за монеты,
   * и потерянное при записи ремесло означало бы, что сотня монет ушла
   * на обычные руки. Внешность у него своя, и мерить её пулом гуляющих
   * (`DWELLER_LOOKS`) нельзя — по нему он не прочитался бы вовсе.
   */
  test('нанятый лесник возвращается лесником', () => {
    const camp = createCamp();
    camp.residents = [{
      name: 'Гита', look: 'лесник', seed: 12345, answer: 'строим', rest: false, craft: 'лесник',
    }];
    save(camp, createRoster(), 1);
    const back = load().camp.residents[0];
    assert.equal(back?.craft, 'лесник', 'ремесло потеряно при перезагрузке');
    assert.equal(back?.look, 'лесник', 'внешность нанятого не прочиталась');
  });

  /** Незнакомое ремесло не выбрасывает человека: он остаётся обычными руками. */
  test('сейв с чужим ремеслом открывается, а ремесло отбрасывается', () => {
    const camp = createCamp();
    camp.residents = [{ name: 'Гита', look: 'поселенец', seed: 7, answer: 'строим', rest: false }];
    save(camp, createRoster(), 1);
    const raw = JSON.parse(localStorage.getItem('emberhold/save')!) as {
      residents: { craft?: string }[];
    };
    raw.residents[0]!.craft = 'звездочёт';
    localStorage.setItem('emberhold/save', JSON.stringify(raw));
    const back = load().camp.residents;
    assert.equal(back.length, 1, 'жилец пропал из-за незнакомого ремесла');
    assert.equal(back[0]?.craft, undefined, 'чужое ремесло прочиталось как своё');
    wipe();
  });

  /**
   * Сейв, записанный до того, как лицо появилось, не роняет игру и не выдаёт
   * жильцу случайное лицо: сид берётся из имени, а имя у жильца не меняется.
   */
  test('жилец из старого сейва получает лицо от имени, а не случайное', () => {
    // Сейв собирается настоящим `save`, а лицо из него вырезается: так
    // «старый сейв» отличается от нынешнего ровно одним полем, а не формой,
    // которую пришлось бы придумать.
    const camp = createCamp();
    camp.residents = [{ name: 'Гита', look: 'поселенец', seed: 999, answer: 'строим', rest: false }];
    save(camp, createRoster(), 1);
    const raw = JSON.parse(localStorage.getItem('emberhold/save')!) as {
      residents: { seed?: number }[];
    };
    delete raw.residents[0]!.seed;
    const old = raw;
    localStorage.setItem('emberhold/save', JSON.stringify(old));
    const first = load().camp.residents[0];
    localStorage.setItem('emberhold/save', JSON.stringify(old));
    const second = load().camp.residents[0];
    assert.ok(first !== undefined && typeof first.seed === 'number', 'жилец без лица');
    assert.equal(first.seed, second?.seed, 'лицо поменялось между загрузками');
    wipe();
  });
});

describe('Сохранение: огород', () => {
  test('новая вместимость сохраняется, а старый шестигрядочный урожай не пропадает', () => {
    const store = fakeStore();
    const camp = createCamp();
    camp.farm = {
      foodAtStart: 10,
      gatheredFood: 30,
      step: 'done',
      unlocked: true,
      activePlots: FARM_STARTING_PLOT_COUNT,
      selectedCrop: 'turnip',
      plots: emptyFarmPlots(),
      story: emptyFarmStory(),
    };
    camp.farm.story.day = 13;
    camp.farm.story.startedDay = 42;
    camp.farm.story.harvestedFood = 55;
    camp.farm.story.caretaker = 'grower';
    camp.farm.story.structures.barn = true;
    save(camp, createRoster(), 100);
    const raw = JSON.parse(store.get('emberhold/save')!) as {
      farm: {
        activePlots?: number;
        selectedCrop?: string;
        plots: ({ plantedAt: number; crop?: string } | null)[];
        story?: { day?: number; structures?: { barn?: boolean } };
      };
    };
    assert.equal(raw.farm.activePlots, FARM_STARTING_PLOT_COUNT);
    assert.equal(raw.farm.selectedCrop, 'turnip');
    assert.equal(raw.farm.story?.day, 13);
    assert.equal(raw.farm.story?.structures?.barn, true);

    const restored = load().camp.farm;
    assert.equal(restored?.story.day, 13);
    assert.equal(restored?.story.harvestedFood, 55);
    assert.equal(restored?.story.caretaker, 'grower');
    assert.equal(restored?.story.structures.barn, true);

    // Срез до балансировки не писал вместимость и позволял сеять все шесть.
    delete raw.farm.activePlots;
    delete raw.farm.selectedCrop;
    delete raw.farm.story;
    raw.farm.plots = Array(FARM_PLOT_COUNT).fill(null);
    raw.farm.plots[5] = { plantedAt: 50 };
    store.set('emberhold/save', JSON.stringify(raw));
    const back = load().camp.farm;
    assert.equal(back?.activePlots, FARM_STARTING_PLOT_COUNT);
    assert.equal(back?.selectedCrop, FARM_DEFAULT_CROP, 'старый сейв остался без выбора культуры');
    assert.equal(back?.story.day, 1, 'старый сейв не начал историю с первой главы');
    assert.deepEqual(
      back?.plots[5],
      { plantedAt: 50, crop: FARM_DEFAULT_CROP },
      'старый урожай потерян',
    );
  });
});

describe('Сохранение: отряд в пути (§26)', () => {
  test('ушедший без игрока остаётся занят, остальные возвращаются готовыми', () => {
    fakeStore();
    const camp = createCamp();
    const roster = createRoster();
    while (syncRoster(roster, 9) !== null) { /* добираем всех, кого пускает Жильё */ }
    const away = roster.heroes[0]!;
    const other = roster.heroes[1] ?? null;
    camp.sortie = ticketOf(3, 1, 77, away, {
      kitchen: 1, storage: 1, loot: 1, event: null,
      gear: emptyGear(), offhand: 'torch', arrows: 0,
    }, 1000);
    away.status = 'raid';
    away.busyUntil = camp.sortie.endsAt;
    // Второй «в вылазке» — тот, кого игрок вёл руками: его вылазка
    // перезапуск не переживает, и он обязан вернуться готовым.
    if (other !== null) {
      other.status = 'raid';
      other.busyUntil = 999999;
    }
    save(camp, roster, 1000);
    const loaded = load();
    const back = loaded.roster.heroes[0]!;
    assert.equal(back.status, 'raid', 'отряд в пути отдали игроку');
    assert.equal(back.busyUntil, camp.sortie.endsAt, 'срок возвращения потерян');
    assert.notEqual(loaded.camp.sortie, null, 'билет не пережил перезагрузку');
    if (other !== null) {
      assert.equal(loaded.roster.heroes[1]!.status, 'ready', 'ручная вылазка пережила перезапуск');
    }
    wipe();
  });

  test('лагерь без отправки открывается без билета', () => {
    fakeStore();
    save(createCamp(), createRoster(), 1000);
    assert.equal(load().camp.sortie ?? null, null);
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
