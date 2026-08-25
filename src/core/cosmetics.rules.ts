import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  COSMETIC_CATEGORIES,
  CAMP_DECOR_STYLES,
  CAMP_FIRE_STYLES,
  CLAN_CAMP_ICONS,
  CLAN_HERALDRY,
  PERSONAL_CAMP_ICONS,
  campDecorStyle,
  campFireStyle,
  categoriesOf,
  clanHeraldry,
  clanCampIcon,
  clanCampIconUrl,
  cosmeticCollectionAction,
  cosmeticPreviewUrl,
  personalCampIcon,
  personalCampIconAvailable,
  personalCampIconUrl,
} from './cosmetics';

function pngSize(url: string): readonly [number, number] {
  const bytes = readFileSync(new URL(url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('каталог оформления лагеря', () => {
  test('каждая линия имеет отдельный sku и бесплатный первый вариант', () => {
    assert.equal(new Set(COSMETIC_CATEGORIES.map((category) => category.sku)).size, COSMETIC_CATEGORIES.length);
    for (const category of COSMETIC_CATEGORIES) {
      assert.ok(category.values.length >= 3);
      assert.match(category.price, /^\$\d+\.\d{2}$/);
      assert.ok(Number.isInteger(category.stars) && category.stars > 0);
    }
    assert.deepEqual(categoriesOf('player').map((category) => category.kind), ['personal-icon', 'fire', 'decor']);
    assert.deepEqual(categoriesOf('clan').map((category) => category.kind), ['clan-icon', 'heraldry']);
    assert.equal(PERSONAL_CAMP_ICONS.length, 4, 'четвёртый личный знак — отдельная реферальная награда');
  });

  test('неизвестное значение всегда возвращает бесплатный облик', () => {
    assert.equal(personalCampIcon('anything'), 'default');
    assert.equal(personalCampIcon('bond_beacon'), 'bond_beacon');
    assert.equal(clanCampIcon(null), 'default');
    assert.equal(campFireStyle('paid_in_save'), 'standard');
    assert.equal(campDecorStyle({ style: 'sentinel' }), 'none');
    assert.equal(clanHeraldry('dragon'), 'plain');
  });

  test('карточки знаков сохраняют отдельные квадратные retina-PNG', () => {
    const personal = PERSONAL_CAMP_ICONS.map(personalCampIconUrl);
    const clan = CLAN_CAMP_ICONS.map(clanCampIconUrl);
    assert.equal(new Set(personal.slice(1)).size, 3);
    assert.equal(new Set(clan.slice(1)).size, 2);
    for (const url of [...personal, ...clan]) assert.deepEqual(pngSize(url), [128, 128]);
  });

  test('платные наборы показывают финальные PNG, а не временные SVG', () => {
    const previews = [
      ...CAMP_FIRE_STYLES.slice(1).map((value) => cosmeticPreviewUrl('fire', value)),
      ...CAMP_DECOR_STYLES.slice(1).map((value) => cosmeticPreviewUrl('decor', value)),
      ...CLAN_HERALDRY.slice(1).map((value) => cosmeticPreviewUrl('heraldry', value)),
    ];
    assert.equal(new Set(previews).size, 6);
    for (const url of previews) {
      const [width, height] = pngSize(url);
      assert.equal(Math.max(width, height), 384);
      assert.ok(Math.min(width, height) >= 256);
    }
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

  test('платный набор не открывает реферальный маяк и наоборот', () => {
    assert.equal(personalCampIconAvailable('watchfire', true, false), true);
    assert.equal(personalCampIconAvailable('bond_beacon', true, false), false);
    assert.equal(personalCampIconAvailable('bond_beacon', false, true), true);
    assert.equal(personalCampIconAvailable('horned_tent', false, true), false);
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
