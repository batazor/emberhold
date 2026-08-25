import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import {
  activeRoadMission,
  bridgeDecisionBlock,
  completeRoadMission,
  reportBridgeShortfall,
  settleBridge,
  startBridgeStory,
} from './roadBridge';
import type { SupplyRoute } from './roadStory';

function campAfter(route: SupplyRoute) {
  const camp = createCamp();
  camp.roadStory = { step: 'done', route };
  assert.ok(startBridgeStory(camp));
  return camp;
}

describe('Вторая глава: старый мост', () => {
  test('начинается только после завершённого обоза и не перезапускается', () => {
    const camp = createCamp();
    assert.equal(startBridgeStory(camp), false);
    camp.roadStory = { step: 'done', route: 'work' };
    assert.ok(startBridgeStory(camp));
    assert.equal(startBridgeStory(camp), false);
    assert.deepEqual(camp.bridgeStory, { step: 'maintenance', completed: 0, lastDay: -1 });
  });

  test('первые поручения продолжают сыгранный способ открыть дорогу', () => {
    assert.equal(activeRoadMission(campAfter('work'), 4)?.id, 'inspect-bridge');
    assert.equal(activeRoadMission(campAfter('trade'), 4)?.id, 'buy-iron');
    assert.equal(activeRoadMission(campAfter('force'), 4)?.id, 'patrol-road');
  });

  test('неверное действие не считается, а в одни сутки второго поручения нет', () => {
    const camp = campAfter('work');
    assert.equal(completeRoadMission(camp, 7, 'trade'), null);
    assert.equal(camp.bridgeStory?.completed, 0);
    assert.equal(completeRoadMission(camp, 7, 'cross-trail')?.id, 'inspect-bridge');
    assert.equal(activeRoadMission(camp, 7), null);
    assert.equal(completeRoadMission(camp, 7, 'cross-trail'), null);
  });

  test('два разных дня приводят к недостаче без штрафа за пропущенный день', () => {
    const camp = campAfter('trade');
    assert.ok(completeRoadMission(camp, 2, 'trade'));
    assert.equal(activeRoadMission(camp, 20)?.id, 'buy-provisions');
    assert.ok(completeRoadMission(camp, 20, 'trade'));
    assert.equal(camp.bridgeStory?.step, 'shortfall');
    assert.ok(reportBridgeShortfall(camp));
    assert.equal(camp.bridgeStory?.step, 'find-crew');
  });

  test('решения требуют названную плату и открывают разные ротации', () => {
    const labor = campAfter('work');
    labor.bridgeStory = { step: 'find-crew', completed: 2, lastDay: 4 };
    labor.resources.wood = 9;
    assert.equal(bridgeDecisionBlock(labor, 'work'), 'wood');
    assert.equal(settleBridge(labor, 'work', 5), false);
    labor.resources.wood = 10;
    assert.ok(settleBridge(labor, 'work', 5));
    assert.equal(labor.resources.wood, 0);
    assert.equal(activeRoadMission(labor, 6)?.id, 'escort-cart');

    const toll = campAfter('trade');
    toll.bridgeStory = { step: 'find-crew', completed: 2, lastDay: 4 };
    toll.coins = 4;
    assert.equal(bridgeDecisionBlock(toll, 'trade'), 'coins');
    toll.coins = 5;
    assert.ok(settleBridge(toll, 'trade', 5));
    assert.equal(toll.coins, 0);
    assert.equal(activeRoadMission(toll, 6)?.id, 'buy-iron');

    const guard = campAfter('force');
    guard.bridgeStory = { step: 'find-crew', completed: 2, lastDay: 4 };
    assert.ok(settleBridge(guard, 'force', 5));
    assert.equal(activeRoadMission(guard, 6)?.id, 'patrol-road');
  });
});
