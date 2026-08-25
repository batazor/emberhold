import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  COSMETIC_CATEGORIES,
  CLAN_CAMP_ICONS,
  PERSONAL_CAMP_ICONS,
  campDecorStyle,
  campFireStyle,
  categoriesOf,
  clanHeraldry,
  clanCampIcon,
  clanCampIconUrl,
  cosmeticCollectionAction,
  personalCampIcon,
  personalCampIconUrl,
} from './cosmetics';

function pngSize(url: string): readonly [number, number] {
  const bytes = readFileSync(new URL(url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('каталог оформления лагеря', () => {
  test('каждая линия имеет отдельный sku, бесплатный первый вариант и два платных', () => {
    assert.equal(new Set(COSMETIC_CATEGORIES.map((category) => category.sku)).size, COSMETIC_CATEGORIES.length);
    for (const category of COSMETIC_CATEGORIES) assert.equal(category.values.length, 3);
    assert.deepEqual(categoriesOf('player').map((category) => category.kind), ['personal-icon', 'fire', 'decor']);
    assert.deepEqual(categoriesOf('clan').map((category) => category.kind), ['clan-icon', 'heraldry']);
  });

  test('неизвестное значение всегда возвращает бесплатный облик', () => {
    assert.equal(personalCampIcon('anything'), 'default');
    assert.equal(clanCampIcon(null), 'default');
    assert.equal(campFireStyle('paid_in_save'), 'standard');
    assert.equal(campDecorStyle({ style: 'sentinel' }), 'none');
    assert.equal(clanHeraldry('dragon'), 'plain');
  });

  test('карточки знаков сохраняют отдельные квадратные retina-PNG', () => {
    const personal = PERSONAL_CAMP_ICONS.map(personalCampIconUrl);
    const clan = CLAN_CAMP_ICONS.map(clanCampIconUrl);
    assert.equal(new Set(personal.slice(1)).size, 2);
    assert.equal(new Set(clan.slice(1)).size, 2);
    for (const url of [...personal, ...clan]) assert.deepEqual(pngSize(url), [128, 128]);
  });

  test('предпросмотр не считается применением', () => {
    assert.equal(cosmeticCollectionAction({
      signedIn: true, clanExists: true, available: true, equipped: false, canEquip: true,
    }), 'equip');
    assert.equal(cosmeticCollectionAction({
      signedIn: true, clanExists: true, available: false, equipped: false, canEquip: true,
    }), 'obtain');
    assert.equal(cosmeticCollectionAction({
      signedIn: true, clanExists: true, available: true, equipped: true, canEquip: true,
    }), 'equipped');
  });

  test('клановое оформление не применяет участник без роли', () => {
    assert.equal(cosmeticCollectionAction({
      signedIn: true, clanExists: true, available: true, equipped: false, canEquip: false,
    }), 'role');
    assert.equal(cosmeticCollectionAction({
      signedIn: true, clanExists: false, available: false, equipped: false, canEquip: false,
    }), 'create-clan');
  });
});
