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
    // Иначе снятие упирается в место, и «снял — потерял» становится вопросом
    // везения: у макета столько вещей, что клеток обязано хватать всем.
    assert.ok(
      BAG_CELLS >= ITEMS.length - SLOTS.length,
      `клеток ${BAG_CELLS} мало для ${ITEMS.length} вещей при ${SLOTS.length} слотах`,
    );
  });

  test('раскладка начинается с известных вещей', () => {
    const pack = startPack();
    for (const id of everything(pack)) {
      assert.ok(ITEM.has(id), `в раскладке вещь, которой нет в списке: ${id}`);
    }
  });
});
