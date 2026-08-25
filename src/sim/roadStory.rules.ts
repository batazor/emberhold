import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { idx } from './grid';
import {
  caravanEncounter,
  caravanSurvivor,
  hearAboutCaravan,
  rescueCaravaner,
  settleSupply,
  startRoadStory,
} from './roadStory';
import { generateTrailSite } from './trailSite';

describe('Первая глава: пропавший обоз', () => {
  test('цепочка идёт только вперёд и не повторяет уже сыгранное', () => {
    const camp = createCamp();
    assert.ok(startRoadStory(camp));
    assert.equal(startRoadStory(camp), false);
    assert.deepEqual(camp.roadStory, { step: 'return-to-trader' });

    assert.ok(hearAboutCaravan(camp));
    assert.equal(hearAboutCaravan(camp), false);
    assert.deepEqual(camp.roadStory, { step: 'find-caravan' });

    assert.ok(rescueCaravaner(camp));
    assert.equal(rescueCaravaner(camp), false);
    assert.deepEqual(camp.roadStory, { step: 'settle-supply' });

    assert.ok(settleSupply(camp, 'work'));
    assert.equal(settleSupply(camp, 'force'), false, 'готовый исход переписан вторым');
    assert.deepEqual(camp.roadStory, { step: 'done', route: 'work' });
  });

  test('обоз стоит на свободных клетках Тропы и не у самого входа', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const site = generateTrailSite(seed);
      const found = caravanEncounter(site);
      for (const cell of [found.survivor, found.wagon, ...found.cargo]) {
        assert.equal(site.loc.blocked[idx(site.loc.size, cell.x, cell.z)], 0, `сид ${seed}: обоз в лесу`);
      }
      assert.notDeepEqual(found.wagon, found.survivor, `сид ${seed}: выживший внутри кузова`);
      assert.ok(
        Math.hypot(found.survivor.x - site.loc.evac.x, found.survivor.z - site.loc.evac.z) > 8,
        `сид ${seed}: обоз виден от входа`,
      );
    }
  });

  test('выживший постоянен для места и не получает занятое имя', () => {
    const first = caravanSurvivor(17, new Set());
    assert.deepEqual(caravanSurvivor(17, new Set()), first);
    const next = caravanSurvivor(17, new Set([first.name]));
    assert.notEqual(next.name, first.name);
  });
});
