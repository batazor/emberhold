/** Контракт общей карты между `world_snapshot()` и симуляцией. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAY_SEC,
  clearWorldSnapshot,
  eventAt,
  installWorldSnapshot,
  nodeSeed,
  regionAt,
} from './world';

const DAY = 24000;
const FROM = DAY * DAY_SEC;

const snapshot = () => ({
  day: DAY,
  event_from: FROM,
  event_until: FROM + 6 * 60 * 60,
  nodes: Array.from({ length: 16 }, (_, id) => ({
    id,
    name: `Серверное место ${id}`,
    x: 0.1 + id * 0.04,
    y: 0.2 + (id % 4) * 0.1,
    tier: id % 4,
    kind: 'вылазка',
    seed: 1000 + id,
    event: id === 0 ? 'storm' : null,
  })),
});

test('§4 — серверный снимок одной операцией меняет точки, сиды и события', () => {
  try {
    assert.equal(installWorldSnapshot(snapshot()), true);
    assert.equal(regionAt(DAY).nodes[0]?.name, 'Серверное место 0');
    assert.equal(nodeSeed(DAY, 3), 1003);
    assert.equal(eventAt(DAY, 0, FROM + 1), 'storm');
    assert.equal(eventAt(DAY, 1, FROM + 1), null);
  } finally {
    clearWorldSnapshot();
  }
});

test('§4 — частичный серверный снимок целиком уступает офлайн-карте', () => {
  const broken = { ...snapshot(), nodes: snapshot().nodes.slice(0, 3) };
  assert.equal(installWorldSnapshot(broken), false);
  assert.notEqual(regionAt(DAY).nodes[0]?.name, 'Серверное место 0');
});
