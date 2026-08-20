/**
 * Правила огня. Пламя ушло из запечённой модели в шейдер (`fire.ts`), и вместе
 * с ним ушла возможность тихо разъехаться: пока огонь был частью здания, он
 * стоял там, где нарисован, по построению. Теперь место огня — запись
 * в `models.ts`, а ставят по ней две разные вещи, свет и пламя.
 *
 * Проверяется поэтому не картинка, а то, что обе стоят по одной записи
 * и гаснут вместе.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as THREE from 'three';
import { Fire } from './fire';
import { fireOf } from './models';

/** Тот же множитель, которым здание приводится к следу 2×2 в обеих сценах. */
const SCALE = 0.55;

const partsOf = (fire: Fire): { light: THREE.PointLight; flame: THREE.Mesh } => {
  const light = fire.group.children.find((o) => (o as THREE.PointLight).isPointLight);
  const flame = fire.group.children.find((o) => (o as THREE.Mesh).isMesh);
  assert.ok(light !== undefined && flame !== undefined, 'у огня нет света или пламени');
  return { light: light as THREE.PointLight, flame: flame as THREE.Mesh };
};

describe('огонь', () => {
  test('горит там, где горел в артбуке', () => {
    assert.deepEqual(fireOf('kitchen', 1), [0, 0.12, 0, 1]);
    assert.deepEqual(fireOf('kitchen', 3), [1.4, 0.1, 0.5, 0.6]);
  });

  test('стадия без открытого огня его не двигает, а гасит', () => {
    // Каменная кухня уносит очаг под трубу, каменная кузница закрывает горн.
    assert.equal(fireOf('kitchen', 5), null);
    assert.equal(fireOf('forge', 3), null);
    // Палатка не горит вовсе, и непостроенное — тоже.
    assert.equal(fireOf('hq', 1), null);
    assert.equal(fireOf('kitchen', 0), null);
  });

  test('пламя и свет встают по одной записи', () => {
    const fire = new Fire();
    fire.set('kitchen', 1, 4.5, 2.5, SCALE);
    const { light, flame } = partsOf(fire);
    const [dx, dy, dz, size] = fireOf('kitchen', 1)!;
    assert.ok(light.visible && flame.visible);
    assert.equal(flame.position.x, 4.5 + dx * SCALE);
    assert.equal(flame.position.z, 2.5 + dz * SCALE);
    assert.equal(flame.position.y, dy * SCALE);
    assert.equal(flame.scale.y, size * SCALE);
    // Свет — над подошвой пламени, но в пределах его языка.
    assert.ok(light.position.y > flame.position.y);
    assert.ok(light.position.y < flame.position.y + size * SCALE);
    assert.equal(light.position.x, flame.position.x);
    assert.equal(light.position.z, flame.position.z);
    fire.dispose();
  });

  test('очаг под навесом меньше костра — и светит слабее', () => {
    const big = new Fire();
    const small = new Fire();
    big.set('kitchen', 1, 0, 0, SCALE);
    small.set('kitchen', 3, 0, 0, SCALE);
    big.update(0, 0);
    small.update(0, 0);
    const a = partsOf(big).light;
    const b = partsOf(small).light;
    assert.ok(b.intensity < a.intensity, `${b.intensity} не меньше ${a.intensity}`);
    assert.ok(b.distance < a.distance);
    big.dispose();
    small.dispose();
  });

  test('ночью костёр светит сильнее, чем днём', () => {
    const fire = new Fire();
    fire.set('kitchen', 1, 0, 0, SCALE);
    fire.update(0, 1);
    const byDay = partsOf(fire).light.intensity;
    fire.update(0, 0);
    const byNight = partsOf(fire).light.intensity;
    assert.ok(byDay > 0, 'днём костёр не гаснет: в солнце он тонет сам');
    assert.ok(byNight > byDay);
    fire.dispose();
  });

  test('погашенный огонь не светит и не рисуется', () => {
    const fire = new Fire();
    fire.set('kitchen', 1, 0, 0, SCALE);
    fire.set('kitchen', 5, 0, 0, SCALE);
    const { light, flame } = partsOf(fire);
    assert.equal(light.visible, false);
    assert.equal(flame.visible, false);
    fire.dispose();
  });

  test('у пламени есть, чем шейдеру качать и красить', () => {
    const fire = new Fire();
    const { flame } = partsOf(fire);
    const rise = flame.geometry.getAttribute('aRise');
    const core = flame.geometry.getAttribute('aCore');
    assert.ok(rise !== undefined && core !== undefined);
    // Доля высоты — от подошвы до кончика, иначе качается не то.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < rise.count; i++) {
      min = Math.min(min, rise.getX(i));
      max = Math.max(max, rise.getX(i));
    }
    assert.equal(min, 0);
    assert.equal(max, 1);
    // Два языка: внешний и внутренний.
    const cores = new Set<number>();
    for (let i = 0; i < core.count; i++) cores.add(core.getX(i));
    assert.deepEqual([...cores].sort(), [0, 1]);
    fire.dispose();
  });
});
