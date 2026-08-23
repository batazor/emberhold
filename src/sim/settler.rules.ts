/**
 * Правила знакомства у прогалины (`settler.ts`).
 *
 * Проверяется здесь не «работает ли разговор» — это видно глазом на `?meet`, —
 * а те два свойства, которые глазом не проверяются и молча ломаются первой же
 * правкой: что ответ не бывает выгодным и что тупика в кадре не бывает.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  GIFT,
  MAX_NAME,
  MEET_ORDER,
  NAMES,
  SELF_ANSWERS,
  advance,
  generateSettler,
  giftWeight,
  setHeroName,
  startMeet,
} from './settler';

describe('Знакомство у прогалины', () => {
  /**
   * Тот же сид — тот же человек. Поселенец нигде не хранится, и если бы он
   * выводился не из сида, второй заход по тому же адресу давал бы другого:
   * отладочная сцена перестала бы быть проверкой, а «а тот ли это был»
   * стало бы вопросом к памяти.
   */
  test('поселенец выводится из сида и не меняется между заходами', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = generateSettler(seed);
      const b = generateSettler(seed);
      assert.deepEqual(a, b, `сид ${seed}: второй заход дал другого человека`);
    }
  });

  /**
   * **Лицо ходит с человеком.** Сид лежит в самом поселенце, потому что
   * из него выводится лицо (`ui/avatar.ts`): без этого встреченный
   * на прогалине входил бы в лагерь с другим лицом, и лицо перестало бы
   * что-либо значить.
   */
  test('поселенец несёт свой сид', () => {
    for (let seed = 1; seed <= 200; seed++) {
      assert.equal(generateSettler(seed).seed, seed, `сид ${seed} потерян по дороге`);
    }
  });

  /**
   * Имя, подставленное игроку, обязано отличаться от имени поселенца:
   * два одинаковых имени в кадре из двух человек читаются ошибкой,
   * а не совпадением.
   */
  test('игроку не подставляется имя поселенца', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const s = generateSettler(seed);
      assert.notEqual(s.offeredName, s.name, `сид ${seed}: игроку подставлено имя поселенца`);
      assert.ok(NAMES.includes(s.name) && NAMES.includes(s.offeredName), `сид ${seed}: имя не из пула`);
    }
  });

  /** Пул — рабочие подписи (§0.1), но подписи обязаны различаться и влезать. */
  test('имена не повторяются и влезают в строку', () => {
    assert.equal(new Set(NAMES).size, NAMES.length, 'в пуле есть повторы');
    for (const name of NAMES) {
      assert.ok(name.length <= MAX_NAME, `«${name}» длиннее ${MAX_NAME} — сломает вёрстку`);
      assert.equal(name.trim(), name, `«${name}» с пробелами по краям`);
    }
  });

  /**
   * **Главное правило кадра.** Ответ на вопрос о себе выбирает состав дара,
   * а не его размер. Стоит одному ответу стать тяжелее другого — и вопрос
   * «кто ты» превращается в вопрос «что выгоднее», то есть перестаёт быть
   * вопросом о себе, а знакомство — знакомством.
   */
  test('ни один ответ не выгоднее другого', () => {
    const weights = SELF_ANSWERS.map((a) => giftWeight(GIFT[a]));
    for (const w of weights) {
      assert.equal(w, weights[0], `дары разной цены: ${SELF_ANSWERS.join('/')} — ${weights.join('/')}`);
    }
  });

  /**
   * Крохи — условие, а не скромность: дар, который заметно двигает экономику,
   * превращает знакомство в награду за прохождение кадра. Потолок взят
   * от цены Мастерской (§16.2, 2 камня): дар не имеет права закрывать
   * первую настоящую постройку.
   */
  test('дар остаётся крохами', () => {
    for (const answer of SELF_ANSWERS) {
      const gift = GIFT[answer];
      assert.ok(giftWeight(gift) <= 4, `«${answer}»: ${giftWeight(gift)} единиц — это уже не крохи`);
      assert.equal(gift.resources.iron, 0, `«${answer}»: у прохожего с собой железо`);
      assert.equal(gift.resources.crystal, 0, `«${answer}»: у прохожего с собой кристалл`);
      assert.ok(gift.things.length > 0, `«${answer}»: ни одной вещи — «возьми, что было» ничем не подтверждено`);
    }
  });

  /**
   * Тупика в кадре знакомства быть не может: «безымянный» — это не решение
   * игрока, а промах пальцем, и поле возвращается к подставленному имени
   * само, без отказа и без запрета.
   */
  test('имя героя не бывает пустым', () => {
    const settler = generateSettler(7);
    for (const raw of ['', '   ', '\t\n', '    ']) {
      const state = startMeet(settler);
      assert.equal(
        setHeroName(state, raw, settler.offeredName),
        settler.offeredName,
        `«${raw}» не откатилось к подставленному`,
      );
    }
  });

  test('имя режется по длине, а не ломает строку', () => {
    const settler = generateSettler(9);
    const state = startMeet(settler);
    const long = 'вавававававававававававава';
    assert.equal(setHeroName(state, long, settler.offeredName).length, MAX_NAME);
    assert.equal(setHeroName(state, '  Тула  ', settler.offeredName), 'Тула', 'пробелы по краям не срезаны');
  });

  /**
   * Разговор идёт только вперёд и упирается в конец, а не за него: шаг
   * за последним кадром означал бы состояние, которого панель не умеет
   * рисовать, — то есть пустой экран вместо разговора.
   */
  test('разговор кончается и не проваливается дальше', () => {
    const state = startMeet(generateSettler(3));
    const seen = [state.step];
    for (let i = 0; i < MEET_ORDER.length + 5; i++) seen.push(advance(state));
    assert.deepEqual(seen.slice(0, MEET_ORDER.length), [...MEET_ORDER], 'кадры идут не по порядку');
    assert.equal(state.step, 'кончено');
  });
});
