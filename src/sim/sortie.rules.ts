/**
 * Правила отправки отряда (`sortie.ts`). Главный вопрос здесь не «работает
 * ли механика», а **не отменяет ли она игру**: §1 держится на том, что
 * возвращение из вылазки игрок проводит руками, и всё, что делает ручной
 * заход необязательным, дороже любой добавленной удобности.
 *
 * Поэтому первое правило — арифметическое, а не вкусовое: добыча за минуту
 * ожидания обязана быть строго ниже добычи за минуту вылазки, и на каждом
 * ярусе, куда отправка ходит. Числа в §26 назначены; проверка держит их
 * честными при любой правке доли и таймера.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mulberry32 } from '../core/rng';
import { POLICIES, playRaid } from './bot';
import { EVENT_ORDER } from './events';
import type { EventId } from './events';
import { emptyGear } from './gear';
import { createHero, createRoster } from './heroes';
import type { HeroState } from './heroes';
import {
  SORTIE_LOOT,
  SORTIE_MAX_TIER,
  freeHero,
  reportOf,
  sortieBlock,
  sortieDue,
  sortieRaid,
  sortieSeconds,
  ticketOf,
} from './sortie';
import type { ReportId, SortieInput } from './sortie';
import type { Tier } from './types';

const input = (kitchen = 2, storage = 2): SortieInput => ({
  kitchen,
  storage,
  loot: 1,
  event: null,
  gear: emptyGear(),
  offhand: 'torch',
  arrows: 0,
});

const hero = (): HeroState => createHero('knight', 0);

const TIERS: readonly Tier[] = [0, 1];
const RUNS = 60;

/** Прогон отправок одного яруса: столько же сидов, сколько у ручного замера. */
function sorties(tier: Tier, event: EventId | null = null): { carried: number; failed: boolean }[] {
  const out: { carried: number; failed: boolean }[] = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const h = hero();
    const at: SortieInput = { ...input(), event };
    const report = reportOf(ticketOf(0, tier, seed, h, at, 0), h);
    out.push({ carried: report.total, failed: report.failed });
  }
  return out;
}

/**
 * Сколько минут стоит ручная вылазка **человеку**. Собственные `durationSec`
 * бота брать нельзя: он решает мгновенно и проходит ярус за 12–18 секунд,
 * то есть завышает ручную выработку впятеро и делает проверку легче,
 * чем она есть. Берётся медленный край §17.4 — три минуты: это самая
 * невыгодная для отправки оценка, и пройти её она обязана.
 */
const RAID_MINUTES = 3;

/** Тот же бот и те же сиды, но заход ручной: сравнивать иначе не с чем. */
function manual(tier: Tier): { carried: number; minutes: number }[] {
  const out: { carried: number; minutes: number }[] = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = playRaid(
      { seed, tier, kitchenLevel: 2, storageLevel: 2 },
      POLICIES.cautious,
      mulberry32(seed),
    );
    out.push({ carried: r.carriedTotal, minutes: RAID_MINUTES });
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('Отправка отряда', () => {
  test('отправка — плохая сделка: добыча за минуту ниже ручной на каждом ярусе', () => {
    for (const tier of TIERS) {
      const byHand = manual(tier);
      const perHandMinute = mean(byHand.map((r) => r.carried)) / mean(byHand.map((r) => r.minutes));
      const perSortieMinute = mean(sorties(tier).map((r) => r.carried)) / (sortieSeconds(tier) / 60);
      // Не «строго ниже», а ниже с запасом: равенство в пределах округления
      // означало бы, что отправка стала альтернативой игре, а не уступкой.
      assert.ok(
        perSortieMinute * 4 < perHandMinute,
        `ярус ${tier}: отправка даёт ${perSortieMinute.toFixed(2)} за минуту против ${perHandMinute.toFixed(2)} у вылазки — ` +
          'ходить руками стало незачем',
      );
    }
  });

  test('доля добычи срезана ровно на объявленную', () => {
    // Не «примерно меньше», а именно `SORTIE_LOOT`: доля — единственный
    // рычаг, которым механика гасится, и он обязан быть виден числом.
    for (let seed = 1; seed <= 12; seed++) {
      const h = hero();
      const ticket = ticketOf(0, 1, seed, h, input(), 0);
      const raw = sortieRaid(ticket, h);
      const report = reportOf(ticket, h);
      const expected =
        Math.floor(raw.carried.stone * SORTIE_LOOT) +
        Math.floor(raw.carried.wood * SORTIE_LOOT) +
        Math.floor(raw.carried.iron * SORTIE_LOOT) +
        Math.floor(raw.carried.crystal * SORTIE_LOOT);
      assert.equal(report.total, expected, `сид ${seed}: доля отправки не совпала с объявленной`);
    }
  });

  test('глубина остаётся ручной', () => {
    const roster = createRoster();
    for (const tier of [2, 3] as Tier[]) {
      assert.equal(sortieBlock(null, roster, tier), 'tier', `ярус ${tier} отправке открыт`);
    }
    assert.equal(sortieBlock(null, roster, SORTIE_MAX_TIER as Tier), 'ok');
  });

  test('билет один, и он занимает слот', () => {
    const roster = createRoster();
    const ticket = ticketOf(0, 1, 7, roster.heroes[0]!, input(), 100);
    assert.equal(sortieBlock(ticket, roster, 0), 'slot');
    assert.equal(sortieDue(ticket, ticket.endsAt - 1), false);
    assert.equal(sortieDue(ticket, ticket.endsAt), true);
    assert.equal(sortieDue(null, 1e9), false, 'пустой слот не может быть готов');
  });

  test('раненый и занятый не идут', () => {
    const roster = createRoster();
    const one = roster.heroes[0]!;
    one.wounds = 1;
    assert.equal(freeHero(roster), null, 'раненого отправили без игрока');
    assert.equal(sortieBlock(null, roster, 0), 'hero');
    one.wounds = 0;
    one.status = 'healing';
    assert.equal(freeHero(roster), null, 'занятого отправили без игрока');
    one.status = 'ready';
    assert.equal(freeHero(roster), one);
  });

  test('поход — чистая функция: тот же билет даёт тот же отчёт', () => {
    const ticket = ticketOf(0, 1, 99, hero(), input(), 0);
    assert.deepEqual(reportOf(ticket, hero()), reportOf(ticket, hero()));
    // И не зависит от того, каким стал лагерь после выхода: вход заморожен
    // билетом, а не читается заново.
    const later = ticketOf(0, 1, 99, hero(), input(6, 6), 0);
    assert.notDeepEqual(reportOf(ticket, hero()).carried, reportOf(later, hero()).carried);
  });

  test('мёртвых исходов нет: все три отчёта выпадают', () => {
    // Прогон идёт и по событиям места (§11.6): риск отправки живёт не
    // в ярусе, а в том, что на месте сегодня, и без событий исход `lost`
    // числился бы мёртвым — при том что он выпадает под «Жилой».
    const seen = new Set<ReportId>();
    for (const tier of TIERS) {
      for (const event of [null, ...EVENT_ORDER]) {
        for (let seed = 1; seed <= RUNS; seed++) {
          const h = hero();
          seen.add(reportOf(ticketOf(0, tier, seed, h, { ...input(), event }, 0), h).id);
        }
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      ['back', 'hurt', 'lost'],
      'исход, который не выпадает, — это мёртвая строка, а не запас',
    );
  });

  test('замер: риск отправки живёт в событии места, а не в ярусе', () => {
    // Поход без риска — подарок, а за подарок не платят (`events.rules.ts`).
    // Замер говорит, где именно за отправку платят: на спокойном месте
    // осторожный отряд с ярусов 0–1 возвращается всегда, и цена там —
    // раны и время; провалы приносит «Жила», объявленная картой до отправки.
    assert.equal(sorties(1).filter((r) => r.failed).length, 0, 'спокойное место стало опасным');
    assert.ok(
      sorties(1, 'vein').filter((r) => r.failed).length > 0,
      `под «Жилой» за ${RUNS} отправок не провалилась ни одна — риска у отправки нет вовсе`,
    );
    // Раны — вторая половина цены, и она есть всегда: отряд, возвращающийся
    // целым каждый раз, не платил бы ничем, кроме ожидания.
    const hurt = Array.from({ length: RUNS }, (_, i) => {
      const h = hero();
      return reportOf(ticketOf(0, 1, i + 1, h, input(), 0), h).wounds;
    }).filter((w) => w > 0).length;
    assert.ok(hurt > 0, 'отряд не привозит ран — Лазарет отправке ничего не стоит');
  });
});
