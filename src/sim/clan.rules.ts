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
  CLAN_FROM_RESIDENTS,
  CLAN_NAME_MAX,
  NAME_REASON,
  clanTaskOpen,
  foundClan,
  nameBlock,
  neighboursOpen,
} from './clan';
import type { CampState } from './camp';
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
    wipe();
    // Лагерь без клана открывается без клана, а не с пустым именем.
    save(createCamp(), createRoster(), 1000);
    assert.equal(load().camp.clan ?? null, null);
    wipe();
  });
});
