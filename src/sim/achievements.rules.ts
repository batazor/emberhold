import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCamp } from './camp';
import {
  achievementState,
  earnAchievement,
  markAchievementsSeen,
  reconcileAchievements,
  unseenAchievements,
} from './achievements';
import { DAY_SEC } from './world';

describe('ранние награды', () => {
  it('получаются один раз и запоминают личный день', () => {
    const camp = createCamp();
    const start = DAY_SEC * 10 + 20;
    achievementState(camp, start);
    assert.equal(earnAchievement(camp, 'first-camp', start)?.id, 'first-camp');
    assert.equal(earnAchievement(camp, 'first-camp', start + 1), null);
    assert.equal(earnAchievement(camp, 'first-return', start + DAY_SEC * 2)?.id, 'first-return');
    assert.equal(camp.achievements?.earned['first-return']?.day, 3);
  });

  it('непрочитанное гаснет только после открытия коллекции', () => {
    const camp = createCamp();
    earnAchievement(camp, 'first-camp', 100);
    earnAchievement(camp, 'first-return', 200);
    assert.deepEqual(unseenAchievements(camp), ['first-camp', 'first-return']);
    assert.equal(markAchievementsSeen(camp), true);
    assert.deepEqual(unseenAchievements(camp), []);
    assert.equal(markAchievementsSeen(camp), false);
  });

  it('восстанавливает только доказуемые факты старого лагеря', () => {
    const camp = createCamp();
    camp.origin = { x: 3, z: 4 };
    camp.residents.push({ name: 'Гита', look: 'поселенец', seed: 1, answer: 'строим', rest: false });
    camp.tents.push({ x: 0, z: 0 });
    camp.raids = 12;
    assert.deepEqual(reconcileAchievements(camp, 100).map((def) => def.id), ['first-camp', 'first-shelter']);
    assert.equal(camp.achievements?.earned['first-return'], undefined);
  });
});
