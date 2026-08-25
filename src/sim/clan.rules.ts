/**
 * Правила своего клана и порога, за которым мир перестаёт быть пустым (§30).
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { createRoster } from './heroes';
import { load, save, wipe } from './save';
import { CLANS } from './world';
import {
  CLAN_BUILD_SECONDS,
  CLAN_BUILDINGS,
  CLAN_BUILDING_ORDER,
  CLAN_FROM_RESIDENTS,
  CLAN_NAME_MAX,
  CLAN_START_RESOURCES,
  NAME_REASON,
  advanceClanConstruction,
  assignClanBuilder,
  clanBuildBlock,
  clanTaskOpen,
  createClanLocation,
  ensureClanLocation,
  foundClan,
  joinClan,
  nameBlock,
  neighboursOpen,
  placeClanBuilding,
} from './clan';
import type { CampState } from './camp';
import { residentUuid } from './residents';
import type { Resident } from './residents';

const folk = (name: string): Resident => ({
  name,
  look: 'поселенец',
  seed: name.length,
  answer: 'строим',
  rest: false,
});

const withFolk = (n: number): CampState => {
  const camp = createCamp();
  for (let i = 0; i < n; i++) camp.residents.push(folk(`Гость ${i + 1}`));
  return camp;
};

describe('Соседи: порог', () => {
  test('пока в лагере один человек, мира на карте нет', () => {
    for (let n = 0; n < CLAN_FROM_RESIDENTS; n++) {
      assert.equal(neighboursOpen(withFolk(n)), false, `жильцов ${n}`);
    }
  });

  test('со вторым жильцом слой открывается и больше не закрывается', () => {
    for (let n = CLAN_FROM_RESIDENTS; n < CLAN_FROM_RESIDENTS + 3; n++) {
      assert.equal(neighboursOpen(withFolk(n)), true, `жильцов ${n}`);
    }
  });

  test('задание про клан живёт ровно между порогом и основанием', () => {
    const camp = withFolk(CLAN_FROM_RESIDENTS - 1);
    assert.equal(clanTaskOpen(camp), false, 'задание пришло раньше срока');
    camp.residents.push(folk('Второй'));
    assert.equal(clanTaskOpen(camp), true, 'задание не пришло с порогом');
    assert.ok(foundClan(camp, 'Артель Гиты', 100));
    assert.equal(clanTaskOpen(camp), false, 'задание осталось после основания');
  });
});

describe('Клан: имя', () => {
  test('у каждого отказа есть своя причина словами', () => {
    assert.equal(nameBlock('   '), 'empty');
    assert.equal(nameBlock('я'), 'short');
    assert.equal(nameBlock('я'.repeat(CLAN_NAME_MAX + 1)), 'long');
    for (const block of ['empty', 'short', 'long', 'world'] as const) {
      assert.ok(NAME_REASON[block].length > 0, `${block} без причины`);
    }
  });

  /**
   * Имя фракции занято миром. Две строки таблицы с одним именем — это
   * не таблица, а §10.3 отдельно запрещает изображать своими тех, кто
   * фракция.
   */
  test('именем фракции назваться нельзя', () => {
    for (const clan of CLANS) {
      assert.equal(nameBlock(clan.name), 'world', clan.name);
      assert.equal(nameBlock(clan.name.toUpperCase()), 'world', 'регистр обошёл запрет');
    }
  });

  test('годное имя принимается и обрезается по краям', () => {
    const camp = withFolk(2);
    assert.equal(nameBlock('  Артель Гиты  '), 'ok');
    assert.ok(foundClan(camp, '  Артель Гиты  ', 42));
    assert.equal(camp.clan?.name, 'Артель Гиты');
    assert.equal(camp.clan?.at, 42);
    assert.ok(camp.clan?.location, 'у основанного клана нет своей локации');
    assert.ok((camp.clan?.location?.glade.size ?? 0) > 0, 'у клановой локации нет поляны');
    assert.deepEqual(camp.clan?.location?.resources, {
      stone: CLAN_START_RESOURCES,
      wood: CLAN_START_RESOURCES,
      iron: CLAN_START_RESOURCES,
    });
  });

  test('клановая опушка воспроизводится из имени и часа основания', () => {
    assert.deepEqual(createClanLocation('Артель Гиты', 42), createClanLocation('Артель Гиты', 42));
    assert.notDeepEqual(createClanLocation('Артель Гиты', 42), createClanLocation('Другой клан', 42));
  });

  test('приглашение ставит серверное имя, время и роль участника', () => {
    const camp = withFolk(2);
    assert.ok(joinClan(camp, '  Северный дозор  ', 1234));
    assert.deepEqual(camp.clan, { name: 'Северный дозор', at: 1234, leader: false });
    assert.equal(joinClan(camp, 'я', 1234), false);
  });

  test('старый клан без локации получает её при первом входе', () => {
    const camp = withFolk(2);
    camp.clan = { name: 'Старый клан', at: 7 };
    const location = ensureClanLocation(camp);
    assert.ok(location);
    assert.equal(camp.clan.location, location);
  });

  test('негодное имя лагерь не записывает', () => {
    const camp = withFolk(2);
    assert.equal(foundClan(camp, ' ', 1), false);
    assert.equal(camp.clan ?? null, null, 'пустое имя всё-таки записалось');
  });
});

describe('Клан: сохранение', () => {
  test('клан переживает перезапуск', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const camp = withFolk(2);
    foundClan(camp, 'Артель Гиты', 777);
    save(camp, createRoster(), 1000);
    assert.equal(load().camp.clan?.name, 'Артель Гиты');
    assert.deepEqual(load().camp.clan?.location, camp.clan?.location);
    wipe();
    // Лагерь без клана открывается без клана, а не с пустым именем.
    save(createCamp(), createRoster(), 1000);
    assert.equal(load().camp.clan ?? null, null);
    wipe();
  });
});

describe('Клан: здания на общей опушке', () => {
  const freeCell = (camp: CampState): { x: number; z: number } => {
    const size = camp.clan?.location?.glade.size ?? 0;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        if (clanBuildBlock(camp, 'hall', { x, z }) === 'ok') return { x, z };
      }
    }
    throw new Error('на клановой опушке нет места под здание');
  };

  test('глава ставит стройплощадку в свободный след 2×2', () => {
    const camp = withFolk(2);
    assert.ok(foundClan(camp, 'Артель Гиты', 42));
    const cell = freeCell(camp);
    assert.equal(placeClanBuilding(camp, 'hall', cell), 'ok');
    assert.deepEqual(camp.clan?.location?.buildings, []);
    assert.deepEqual(camp.clan?.location?.construction, { kind: 'hall', ...cell, work: 0 });
    assert.deepEqual(camp.clan?.location?.resources, { wood: 8, stone: 10, iron: 14 });
    assert.equal(clanBuildBlock(camp, 'hall', cell), 'built');
  });

  test('цены трёх зданий вместе равны стартовому складу', () => {
    for (const resource of ['wood', 'stone', 'iron'] as const) {
      const total = CLAN_BUILDING_ORDER.reduce(
        (sum, kind) => sum + CLAN_BUILDINGS[kind].cost[resource],
        0,
      );
      assert.equal(total, CLAN_START_RESOURCES, resource);
    }
  });

  test('при нехватке ресурсов стройка не начинается и склад не меняется', () => {
    const camp = withFolk(2);
    assert.ok(foundClan(camp, 'Артель Гиты', 42));
    const cell = freeCell(camp);
    camp.clan!.location!.resources.wood = CLAN_BUILDINGS.hall.cost.wood - 1;
    const before = { ...camp.clan!.location!.resources };
    assert.equal(placeClanBuilding(camp, 'hall', cell), 'resources');
    assert.equal(camp.clan?.location?.construction, null);
    assert.deepEqual(camp.clan?.location?.resources, before);
  });

  test('член клана без роли главы размещать здания не может', () => {
    const camp = withFolk(2);
    assert.ok(foundClan(camp, 'Артель Гиты', 42));
    camp.clan!.leader = false;
    assert.equal(placeClanBuilding(camp, 'hall', { x: 1, z: 1 }), 'leader');
    assert.deepEqual(camp.clan?.location?.buildings, []);
    assert.equal(camp.clan?.location?.construction, null);
  });

  test('стройка, рабочие и склад переживают перезапуск', () => {
    const camp = withFolk(2);
    assert.ok(foundClan(camp, 'Артель Гиты', 42));
    const cell = freeCell(camp);
    assert.equal(placeClanBuilding(camp, 'store', cell, undefined, 100), 'ok');
    const builderId = residentUuid(camp.residents[0]!);
    assert.equal(assignClanBuilder(camp, builderId, true, 100), true);
    save(camp, createRoster(), 1000);
    const location = load().camp.clan?.location;
    assert.deepEqual(location?.buildings, []);
    assert.deepEqual(location?.construction, { kind: 'store', ...cell, work: 0 });
    assert.deepEqual(location?.builders, [builderId]);
    assert.deepEqual(location?.resources, { stone: 9, wood: 10, iron: 13 });
    wipe();
  });

  test('без назначенных жителей стройка не движется', () => {
    const camp = withFolk(2);
    assert.ok(foundClan(camp, 'Артель Гиты', 7 * 3600));
    const cell = freeCell(camp);
    assert.equal(placeClanBuilding(camp, 'hall', cell, undefined, 7 * 3600), 'ok');
    assert.deepEqual(advanceClanConstruction(camp, 18 * 3600), { worked: 0, completed: null });
    assert.equal(camp.clan?.location?.construction?.work, 0);
  });

  test('назначенный житель заканчивает стройку своей рабочей сменой', () => {
    const camp = withFolk(2);
    const start = 7 * 3600;
    assert.ok(foundClan(camp, 'Артель Гиты', start));
    const cell = freeCell(camp);
    assert.equal(placeClanBuilding(camp, 'workshop', cell, undefined, start), 'ok');
    assert.equal(assignClanBuilder(camp, residentUuid(camp.residents[0]!), true, start), true);
    const result = advanceClanConstruction(camp, 18 * 3600);
    assert.equal(result.worked, CLAN_BUILD_SECONDS);
    assert.equal(result.completed, 'workshop');
    assert.deepEqual(camp.clan?.location?.buildings, [{ kind: 'workshop', ...cell }]);
    assert.equal(camp.clan?.location?.construction, null);
    assert.deepEqual(camp.clan?.location?.builders, []);
  });
});
