import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILDING_ORDER, campArea } from './camp';
import { SIMULATED_CAMPS, simulatedCamp } from './neighbourCamps';
import { campLevel, campPower } from './standing';

describe('Симулированные лагеря соседей', () => {
  test('дают два разных и доступных для осмотра аккаунта', () => {
    assert.equal(SIMULATED_CAMPS.length, 2);
    assert.equal(new Set(SIMULATED_CAMPS.map((item) => item.id)).size, 2);
    for (const item of SIMULATED_CAMPS) {
      assert.equal(item.inspectable, true);
      assert.equal(simulatedCamp(item.id), item);
      assert.equal(item.power, campPower(item.camp));
      assert.equal(item.level, campLevel(item.camp));
      assert.equal(item.folk, item.camp.residents.length + 1);
      assert.ok(item.camp.residents.length >= 3, `${item.id}: пустой лагерь`);
    }
  });

  test('все здания и малые постройки помещаются на площадке', () => {
    for (const item of SIMULATED_CAMPS) {
      const area = campArea(item.camp.levels.hq);
      for (const id of BUILDING_ORDER) {
        if (item.camp.levels[id] === 0) continue;
        const at = item.camp.layout[id];
        assert.ok(at.x >= 0 && at.z >= 0 && at.x + 2 <= area && at.z + 2 <= area, `${item.id}:${id}`);
      }
      for (const [kind, spots] of [['палатка', item.camp.tents], ['сундук', item.camp.chests]] as const) {
        for (const at of spots) {
          assert.ok(at.x >= 0 && at.z >= 0 && at.x < area && at.z < area, `${item.id}:${kind}`);
        }
      }
    }
  });
});
