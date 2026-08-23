/**
 * Правила макета страницы персонажа (`items.ts`).
 *
 * Вещи здесь черновые, и правила про них — тоже не про баланс: числа этого
 * макета ничего в игре не меняют, мерить в них нечего. Проверяется другое —
 * что раскладка не врёт руками игрока: вещь не размножается перекладыванием,
 * не пропадает при обмене и не встаёт в чужой слот. Всё три ломаются молча
 * и выглядят как «экран подглючил», а не как ошибка.
 *
 * Ещё одно правило — про честность самого макета: у каждой вещи есть цена.
 * §14 держится на том, что снаряжение расширяет выбор, а не множит урон,
 * и вещь без цены сделала бы из куклы «надеть всё».
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BAG_CELLS,
  FREE_SLOTS,
  ITEM,
  ITEMS,
  MAX_FREE_SLOTS,
  SLOTS,
  equip,
  fits,
  slotFor,
  startPack,
  unequip,
} from './items';
import type { PackState } from './items';
import { raidSummary } from './summary';
import { emptyGear, gearMods } from '../../sim/gear';

/** Все вещи раскладки — надетые и лежащие: их число обязано быть постоянным. */
function everything(pack: PackState): string[] {
  return [...pack.worn.values(), ...pack.bag].filter((id): id is string => id !== null).sort();
}

describe('вещи страницы персонажа', () => {
  test('у каждой вещи есть и прибавка, и цена', () => {
    const free = ITEMS.filter((it) => it.effect.trim() === '' || it.cost.trim() === '');
    assert.deepEqual(
      free.map((it) => it.name),
      [],
      'вещь без цены превращает куклу в «надеть всё» (§14)',
    );
  });

  test('у каждой вещи есть значок', () => {
    const blank = ITEMS.filter((it) => it.icon === undefined && it.picture === undefined);
    assert.deepEqual(
      blank.map((it) => it.name),
      [],
      'вещь без модели должна иметь PNG-пиктограмму инвентаря',
    );
  });

  test('свободных слотов не больше потолка', () => {
    assert.ok(
      FREE_SLOTS >= 1 && FREE_SLOTS <= MAX_FREE_SLOTS,
      `свободных слотов ${FREE_SLOTS} при потолке ${MAX_FREE_SLOTS}`,
    );
    assert.equal(
      SLOTS.filter((s) => s.kind === 'свободное').length,
      FREE_SLOTS,
      'число свободных слотов в раскладке разошлось с объявленным',
    );
  });

  test('слот принимает своё, а свободный — любое', () => {
    for (const item of ITEMS) {
      for (const slot of SLOTS) {
        const ok = fits(slot, item);
        if (slot.kind === 'свободное') {
          assert.ok(ok, `${item.name} не встал в свободный слот`);
        } else {
          assert.equal(ok, slot.kind === item.kind, `${item.name} → ${slot.name}: чужой слот`);
        }
      }
    }
  });

  test('вещи не пропадают и не размножаются', () => {
    const pack = startPack();
    const start = everything(pack);
    assert.equal(new Set(start).size, start.length, 'раскладка началась с двойника');
    // Перебор «каждую вещь в каждый слот» — это и есть то, что игрок делает
    // пальцем за минуту: тащит всё подряд и смотрит, где подсветится.
    for (const item of ITEMS) {
      for (const slot of SLOTS) {
        equip(pack, item.id, slot.id);
        const now = everything(pack);
        assert.deepEqual(now, start, `${item.name} → ${slot.name}: набор вещей поплыл`);
        assert.equal(new Set(now).size, now.length, `${item.name} → ${slot.name}: вещь раздвоилась`);
      }
    }
  });

  test('снятое возвращается в сумку, а не пропадает', () => {
    const pack = startPack();
    for (const slot of SLOTS) {
      const worn = pack.worn.get(slot.id) ?? null;
      if (worn === null) continue;
      assert.ok(unequip(pack, slot.id), `${slot.name}: снять не вышло, хотя место есть`);
      assert.ok(pack.bag.includes(worn), `${slot.name}: снятое не доехало до сумки`);
      assert.equal(pack.worn.get(slot.id) ?? null, null, `${slot.name}: слот остался занят`);
    }
  });

  test('в чужой слот вещь не встаёт и раскладку не трогает', () => {
    const pack = startPack();
    const before = everything(pack);
    for (const item of ITEMS) {
      for (const slot of SLOTS) {
        if (fits(slot, item)) continue;
        assert.equal(equip(pack, item.id, slot.id), false, `${item.name} влез в ${slot.name}`);
      }
    }
    assert.deepEqual(everything(pack), before, 'промах переставил вещи');
  });

  test('тап находит слот каждой вещи', () => {
    const pack = startPack();
    for (const item of ITEMS) {
      const slot = slotFor(pack, item);
      assert.notEqual(slot, null, `${item.name}: тапу некуда её деть`);
      assert.ok(fits(slot!, item), `${item.name}: тап предложил чужой слот`);
    }
  });

  test('сумка вмещает всё, что можно снять', () => {
    // Снять можно всё сразу, и тогда в сумке оказывается каждая вещь макета.
    // Клеток меньше — и «снял — потерял» становится вопросом везения,
    // а не решением игрока. Это уже ловилось: две новые вещи в сумке,
    // и четвёртое снятие упёрлось в место.
    assert.ok(
      BAG_CELLS >= ITEMS.length,
      `клеток ${BAG_CELLS} мало для ${ITEMS.length} вещей макета`,
    );
  });

  test('сводка вылазки не переписывает формулы игры', () => {
    const gear = { ...emptyGear(), weapon: 3, armor: 2, torch: 2, bag: 1, ring: 1 };
    const mods = gearMods(gear, 'torch');
    const rows = raidSummary(gear, 'torch', false).rows;
    const value = (name: string): string | undefined => rows.find((r) => r.name === name)?.now;
    assert.equal(value('Атака'), `${mods.attack}`, 'атака в сводке не та, что считает игра');
    assert.equal(value('Обзор'), `+${mods.vision}`, 'обзор в сводке не тот, что считает игра');
    assert.equal(value('Рюкзак'), `${mods.capacity}`, 'рюкзак в сводке не тот, что считает игра');
  });

  test('цена левой руки видна до того, как рука переложена', () => {
    // §14.2 — весь смысл слота в том, что обзор и защита стоят рядом.
    // Со фонарём в руке строка «Защита» обязана показывать, чем станет
    // защита со щитом, и наоборот.
    const gear = { ...emptyGear(), torch: 3 };
    const withTorch = raidSummary(gear, 'torch', false).rows;
    const defense = withTorch.find((r) => r.name === 'Защита');
    const vision = withTorch.find((r) => r.name === 'Обзор');
    assert.notEqual(defense?.other, null, 'щит не обещает защиты — выбора не видно');
    assert.notEqual(vision?.other, null, 'фонарь не обещает обзора — выбора не видно');

    // А там, где рука ничего не меняет, третьей колонки нет: «→ 0» рядом
    // с нулём — шум, а не выбор.
    const bare = raidSummary(emptyGear(), 'torch', false).rows;
    assert.deepEqual(
      bare.filter((r) => r.other !== null).map((r) => r.name),
      [],
      'у невыкованного снаряжения рука ничего не меняет, а колонка есть',
    );
  });

  test('колчан показывается только стрелку', () => {
    const gear = { ...emptyGear(), weapon: 2 };
    const near = raidSummary(gear, 'torch', false).rows.map((r) => r.name);
    const far = raidSummary(gear, 'torch', true).rows.map((r) => r.name);
    assert.ok(!near.includes('Колчан'), 'ближнику показали колчан');
    assert.ok(far.includes('Колчан'), 'стрелку колчан не показали');
  });

  test('раскладка начинается с известных вещей', () => {
    const pack = startPack();
    for (const id of everything(pack)) {
      assert.ok(ITEM.has(id), `в раскладке вещь, которой нет в списке: ${id}`);
    }
  });
});
