/**
 * Гость у стен замка (`castleGuest.ts`): правила и замер.
 *
 * Глазом здесь не проверить главного: гость — функция сида, стоянка законна
 * на любом замке, а доля замков с гостем — та, что объявлена. Смотреть сто
 * замков руками — не проверка, а лотерея (§6), поэтому сто замков смотрит
 * этот файл.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { CASTLE_CELL } from './castle';
import { WOOD, generateCastleSite, spotAt } from './castleSite';
import type { CastleSite } from './castleSite';
import {
  GUEST_FROM_TEXT,
  GUEST_ORDER,
  GUEST_ORIGINS,
  GUEST_SEEKS,
  GUEST_SEEK_TEXT,
  GUEST_SHARE,
  GUEST_WORK,
  advanceGuest,
  castleGuestAt,
  guestPitch,
  startGuestMeet,
} from './castleGuest';
import { idx } from './grid';
import { SELF_ANSWERS } from './settler';
import { tentFits } from './residents';

/** Сиды переписи: сто двадцать замков — та же мерка, что у замера двора. */
const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 1);

const inField = (site: CastleSite, c: { x: number; z: number }): boolean => {
  const size = site.loc.size;
  const keep = {
    x: site.at.x,
    z: site.at.z,
    w: site.castle.width * CASTLE_CELL,
    d: site.castle.depth * CASTLE_CELL,
  };
  return (
    c.x >= WOOD && c.z >= WOOD && c.x < size - WOOD && c.z < size - WOOD
    && (c.x < keep.x || c.z < keep.z || c.x >= keep.x + keep.w || c.z >= keep.z + keep.d)
  );
};

describe('Гость у стен замка', () => {
  test('гость — функция сида: тот же замок, тот же человек, то же место', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const site = generateCastleSite(seed);
      assert.deepEqual(castleGuestAt(site), castleGuestAt(site));
    }
  });

  test('замер: доля замков с гостем — объявленная треть, а не «иногда»', () => {
    const met = SEEDS.filter((seed) => castleGuestAt(generateCastleSite(seed)) !== null).length;
    const share = met / SEEDS.length;
    // Вилка в десятую долю: по 120 сидам треть дышит, но «почти всегда»
    // и «почти никогда» сквозь неё не проходят.
    assert.ok(
      Math.abs(share - GUEST_SHARE) <= 0.1,
      `гость у ${met} из ${SEEDS.length} замков (${share.toFixed(2)}), объявлено ${GUEST_SHARE.toFixed(2)}`,
    );
  });

  test('стоянка законна: в поле, на свободном, мимо дороги и камней', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const site = generateCastleSite(seed);
      const guest = castleGuestAt(site);
      if (guest === null) continue;
      checked++;
      const size = site.loc.size;
      // Дорога в клетках локации — перевод, независимый от генератора гостя.
      const road = new Set<string>();
      for (const plan of site.roads) {
        const base = spotAt(site, plan);
        for (let dz = 0; dz < CASTLE_CELL; dz++) {
          for (let dx = 0; dx < CASTLE_CELL; dx++) road.add(`${base.x + dx}:${base.z + dz}`);
        }
      }
      const stones = new Set(site.loc.stones.map((s) => `${s.x}:${s.z}`));
      const spots = [guest.tent, guest.fire, guest.sit];
      for (const c of spots) {
        assert.ok(inField(site, c), `сид ${seed}: клетка ${c.x}:${c.z} не в поле`);
        assert.equal(site.loc.blocked[idx(size, c.x, c.z)], 0, `сид ${seed}: клетка занята`);
        assert.ok(!road.has(`${c.x}:${c.z}`), `сид ${seed}: стоянка на дороге`);
        assert.ok(!stones.has(`${c.x}:${c.z}`), `сид ${seed}: стоянка на валуне`);
        assert.ok(
          !(c.x === site.loc.evac.x && c.z === site.loc.evac.z),
          `сид ${seed}: стоянка на точке выхода`,
        );
      }
      // Угол 2×2: костёр при палатке, сиделец при костре, и все врозь.
      assert.equal(Math.abs(guest.fire.x - guest.tent.x) + Math.abs(guest.fire.z - guest.tent.z), 1);
      assert.equal(Math.abs(guest.sit.x - guest.fire.x) + Math.abs(guest.sit.z - guest.fire.z), 1);
      assert.equal(new Set(spots.map((c) => `${c.x}:${c.z}`)).size, 3);
    }
    // Перепись обязана что-то проверить: ноль гостей на 120 сидов — это
    // сломанный генератор, а не везение.
    assert.ok(checked >= 20, `гость нашёлся только у ${checked} замков`);
  });

  test('переезд: палатка и костёр встают по правилам места, и место занято', () => {
    for (const seed of [1, 2, 3, 40, 500]) {
      const camp = createCamp();
      const pitch = guestPitch(camp, seed);
      assert.notEqual(pitch, null, 'на стартовой площадке не нашлось места');
      const { tent, fire } = pitch!;
      assert.ok(tentFits(camp, tent.x, tent.z), 'палатка гостя не по правилам места');
      assert.notEqual(fire, null, 'на стартовой площадке не нашлось места костру');
      assert.equal(Math.abs(fire!.x - tent.x) + Math.abs(fire!.z - tent.z), 1, 'костёр не при палатке');
      assert.ok(tentFits(camp, fire!.x, fire!.z), 'костёр гостя не по правилам места');
      // Сам выбрал — и после перезагрузки выбрал бы то же.
      assert.deepEqual(guestPitch(camp, seed), pitch);
      // Поставленное занимает клетки: следующая палатка сюда не встанет.
      camp.tents.push(tent);
      (camp.fires ??= []).push(fire!);
      assert.ok(!tentFits(camp, tent.x, tent.z), 'клетка палатки осталась свободной');
      assert.ok(!tentFits(camp, fire!.x, fire!.z), 'клетка костра осталась свободной');
    }
  });

  test('что гость ищет — выбирает занятие, и таблицы не расходятся', () => {
    assert.deepEqual(Object.keys(GUEST_FROM_TEXT).sort(), [...GUEST_ORIGINS].sort());
    assert.deepEqual(Object.keys(GUEST_SEEK_TEXT).sort(), [...GUEST_SEEKS].sort());
    assert.deepEqual(Object.keys(GUEST_WORK).sort(), [...GUEST_SEEKS].sort());
    for (const seek of GUEST_SEEKS) {
      assert.ok(SELF_ANSWERS.includes(GUEST_WORK[seek]), `занятие «${GUEST_WORK[seek]}» неизвестно жильцам`);
    }
  });

  test('разговор идёт только вперёд и кончается', () => {
    const meet = startGuestMeet();
    assert.equal(meet.step, GUEST_ORDER[0]);
    const seen = [meet.step];
    for (let i = 0; i < GUEST_ORDER.length; i++) seen.push(advanceGuest(meet));
    assert.deepEqual(seen.slice(0, GUEST_ORDER.length), [...GUEST_ORDER]);
    assert.equal(meet.step, 'кончено');
    assert.equal(advanceGuest(meet), 'кончено');
  });
});
