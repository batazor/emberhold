import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  CLAN_CAMP_ICONS,
  PERSONAL_CAMP_ICONS,
  clanCampIcon,
  clanCampIconUrl,
  personalCampIcon,
  personalCampIconUrl,
} from './cosmetics';

function pngSize(url: string): readonly [number, number] {
  const bytes = readFileSync(new URL(url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('Платные знаки лагерей', () => {
  test('неизвестное значение всегда откатывается к стандартной палатке', () => {
    assert.equal(personalCampIcon('anything'), 'default');
    assert.equal(clanCampIcon(null), 'default');
  });

  test('все знаки имеют отдельные квадратные retina-PNG', () => {
    const personal = PERSONAL_CAMP_ICONS.map(personalCampIconUrl);
    const clan = CLAN_CAMP_ICONS.map(clanCampIconUrl);
    assert.equal(new Set(personal.slice(1)).size, 2);
    assert.equal(new Set(clan.slice(1)).size, 2);
    for (const url of [...personal, ...clan]) assert.deepEqual(pngSize(url), [128, 128]);
  });
});
