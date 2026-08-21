/**
 * Правила режиссёра раскадровки. Порядок кадров и условия переходов
 * проверяются в `sim/onboarding.rules.ts` — здесь проверяется то, что
 * раньше было пятью модульными let в main: что кадр меняется один раз,
 * что скриптовая рана выдаётся один раз, что пауза считается от смены
 * кадра и что перезапуск вылазки обнуляет счётчики вместе с ней.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REVEAL_PAUSE } from '../../sim/onboarding';
import type { OnbStep } from '../../sim/onboarding';
import { createRaid } from '../../sim/raid';
import type { RaidState } from '../../sim/raid';
import { createDirector } from './index';
import type { Director } from './index';

/** Стенд: часы двигаются руками, показ и тряска пишутся в ленты. */
function stand(from: OnbStep) {
  const shown: OnbStep[] = [];
  const changed: OnbStep[] = [];
  let shakes = 0;
  let clock = 100;
  const director: Director = createDirector(from, {
    now: () => clock,
    show: (step) => shown.push(step),
    shake: () => {
      shakes += 1;
    },
    changed: (step) => changed.push(step),
  });
  return {
    director,
    shown,
    changed,
    shakes: () => shakes,
    wait: (seconds: number) => {
      clock += seconds;
    },
  };
}

/**
 * Вылазка нулевого яруса — та самая, по которой идёт раскадровка. Выход
 * в ней закрыт: первая вылазка открывает его первой добычей, и main
 * создаёт её именно так.
 */
const firstRaid = (): RaidState =>
  createRaid({ seed: 11, tier: 0, kitchenLevel: 1, storageLevel: 1, evacOpen: false });

describe('Раскадровка: смена кадра', () => {
  test('кадр показывается и записывается один раз', () => {
    const s = stand('move');
    s.director.set('approach');
    assert.deepEqual(s.shown, ['approach']);
    assert.deepEqual(s.changed, ['approach']);
  });

  test('тот же кадр второй раз не стоит ничего', () => {
    const s = stand('move');
    s.director.set('move');
    assert.deepEqual(s.shown, [], 'кадр перерисован без нужды');
    assert.deepEqual(s.changed, [], 'сейв переписан без нужды');
  });

  test('показ по требованию кадр не двигает', () => {
    const s = stand('build');
    s.director.apply();
    assert.deepEqual(s.shown, ['build']);
    assert.deepEqual(s.changed, [], 'вход в лагерь записался как смена кадра');
    assert.equal(s.director.step, 'build');
  });

  test('раскадровка знает, что идёт в вылазке', () => {
    assert.equal(stand('move').director.inRaid, true);
    assert.equal(stand('evac').director.inRaid, true);
    assert.equal(stand('return').director.inRaid, false);
    assert.equal(stand('done').director.inRaid, false);
  });
});

describe('Раскадровка: вылазка ведёт кадры', () => {
  test('шаг переводит с первого кадра на второй', () => {
    const s = stand('move');
    const raid = firstRaid();
    s.director.drive(raid);
    assert.equal(s.director.step, 'move', 'кадр ушёл до первого шага');
    raid.steps = 1;
    s.director.drive(raid);
    assert.equal(s.director.step, 'approach');
  });

  test('скриптовая рана кадра 3 выдаётся ровно один раз', () => {
    const s = stand('approach');
    const raid = firstRaid();
    raid.inFight = true;
    const before = raid.hero.hp;
    s.director.drive(raid);
    assert.equal(s.shakes(), 1, 'рана прошла незамеченной');
    assert.ok(raid.hero.hp < before, 'здоровье не убыло');
    assert.equal(s.director.step, 'wound');
    // Кадр сменился, но даже вернувшись на него, второй раны не будет.
    s.director.set('approach');
    s.director.drive(raid);
    assert.equal(s.shakes(), 1, 'скелет задел дважды');
  });

  test('два открытия от одного события разведены паузой', () => {
    const s = stand('wound');
    const raid = firstRaid();
    // Кадр начат — с него и считается пауза.
    s.director.set('loot');
    s.director.drive(raid);
    assert.equal(s.director.step, 'loot', 'добыча и возврат открылись разом');
    s.wait(REVEAL_PAUSE);
    s.director.drive(raid);
    assert.equal(s.director.step, 'back');
    // Следующая пауза считается заново, а не от начала вылазки.
    s.director.drive(raid);
    assert.equal(s.director.step, 'back', 'ставка открылась без паузы');
    s.wait(REVEAL_PAUSE);
    s.director.drive(raid);
    assert.equal(s.director.step, 'bait');
  });

  test('выход открывается первой добычей, а не номером кадра', () => {
    const s = stand('move');
    const raid = firstRaid();
    s.director.drive(raid);
    assert.equal(raid.evacOpen, false, 'выход открылся с пустым рюкзаком');
    raid.bagTotal = 3;
    s.director.drive(raid);
    assert.equal(raid.evacOpen, true);
  });
});

describe('Раскадровка: перезапуск вылазки', () => {
  test('счётчики обнуляются вместе с вылазкой', () => {
    const s = stand('approach');
    const first = firstRaid();
    first.inFight = true;
    s.director.drive(first);
    assert.equal(s.shakes(), 1);

    // Игрок начал заново: раскадровка возвращается к первому кадру вылазки.
    s.director.set('move');
    const second = firstRaid();
    second.inFight = true;
    s.director.enterRaid(second);
    s.director.set('approach');
    s.director.drive(second);
    assert.equal(s.shakes(), 2, 'вторая вылазка осталась без скриптовой раны');
  });

  test('вход в вылазку показывает кадр и кадра не меняет', () => {
    const s = stand('move');
    s.director.enterRaid(firstRaid());
    assert.deepEqual(s.shown, ['move']);
    assert.deepEqual(s.changed, []);
  });

  test('настоящая рана считается от того, с чем вошли в вылазку', () => {
    const s = stand('approach');
    const raid = firstRaid();
    s.director.enterRaid(raid);
    // Не скриптовая — просто получил в бою.
    raid.hero.hp -= 1;
    s.director.drive(raid);
    assert.equal(s.director.step, 'wound');
    assert.equal(s.shakes(), 0, 'настоящая рана тряхнула экран как скриптовая');
  });
});
