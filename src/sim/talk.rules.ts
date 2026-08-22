/**
 * Правила речи жильцов (`talk.ts`): тишина длиннее слов, голос один,
 * и каждый когда-нибудь говорит. Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CHAT_LINES,
  CHAT_SECONDS,
  TALK_GAP,
  TALK_SECONDS,
  TALK_TEXT,
  chatAt,
  phraseAt,
} from './talk';
import type { Talker } from './talk';

const folk: Talker[] = [
  { seed: 11, mood: 'строим' },
  { seed: 23, mood: 'ходим' },
  { seed: 37, mood: 'отдых' },
  { seed: 41, mood: 'без крыши' },
  { seed: 59, mood: 'строим' },
];

describe('Речь жильцов', () => {
  test('пауза длиннее реплики: тишина — фон, речь — событие', () => {
    assert.ok(TALK_GAP >= TALK_SECONDS * 2);
  });

  test('в любой момент говорит не больше одного', () => {
    for (let t = 0; t < TALK_GAP * folk.length * 6; t += 0.5) {
      const speaking = folk.filter((_, i) => phraseAt(folk, i, t) !== null);
      assert.ok(speaking.length <= 1, `на t=${t} говорят ${speaking.length}`);
    }
  });

  test('кадр — функция времени: та же секунда — те же слова', () => {
    for (const t of [1, 13.4, 47.2, 200.8]) {
      for (let i = 0; i < folk.length; i++) {
        assert.equal(phraseAt(folk, i, t), phraseAt(folk, i, t));
      }
    }
  });

  test('каждый когда-нибудь говорит, и не одно и то же', () => {
    for (let i = 0; i < folk.length; i++) {
      const heard = new Set<string>();
      for (let t = 0; t < TALK_GAP * folk.length * 40; t += 1) {
        const said = phraseAt(folk, i, t);
        if (said !== null) heard.add(said);
      }
      assert.ok(heard.size >= 2, `жилец ${i} за сорок кругов сказал ${heard.size} реплик`);
    }
  });

  test('безкрышный говорит о крыше, а не о погоде', () => {
    const alone: Talker[] = [{ seed: 41, mood: 'без крыши' }];
    for (let t = 0; t < TALK_GAP * 60; t += 1) {
      const said = phraseAt(alone, 0, t);
      if (said === null) continue;
      assert.ok(
        Object.entries(TALK_TEXT).some(([k, v]) => k.startsWith('home-') && v === said),
        `безкрышный сказал чужое: ${said}`,
      );
    }
  });

  test('реплика помещается в пузырь', () => {
    // Порог — строка полосы (`voice.rules.ts`): читалка у игрока одна.
    for (const [key, text] of Object.entries(TALK_TEXT)) {
      assert.ok(text.length <= 60, `${key} длиннее пузыря: ${text}`);
    }
  });
});

describe('Разговор двоих', () => {
  const a = folk[0]!;
  const b = folk[1]!;

  test('в разговоре звучит один голос за раз и все реплики разные', () => {
    for (const round of [0, 1, 2, 7]) {
      const heard: string[] = [];
      let last: number | null = null;
      for (let s = 0; s < CHAT_SECONDS; s += 0.5) {
        const line = chatAt(a, b, s, round);
        assert.notEqual(line, null, `тишина посреди разговора на ${s}-й секунде`);
        if (line === null) continue;
        if (last !== null && line.who !== last) heard.push('—');
        last = line.who;
        if (heard.at(-1) !== line.text) heard.push(line.text);
      }
      const lines = heard.filter((t) => t !== '—');
      assert.equal(lines.length, CHAT_LINES, `в разговоре ${lines.length} реплик`);
      assert.equal(new Set(lines).size, CHAT_LINES, `в разговоре повторились слова: ${lines.join(' / ')}`);
    }
  });

  test('говорят по очереди: мысль — отклик — мысль — отклик', () => {
    const replies = new Set(
      Object.entries(TALK_TEXT).filter(([k]) => k.startsWith('reply-')).map(([, v]) => v),
    );
    for (const round of [0, 1, 4, 9]) {
      const said = Array.from({ length: CHAT_LINES }, (_, i) =>
        chatAt(a, b, i * TALK_SECONDS + 0.1, round)!);
      // Оба высказались и оба откликнулись: разговор, а не доклад одного.
      assert.deepEqual(
        said.map((l) => replies.has(l.text)),
        [false, true, false, true],
        `сбился порядок мысли и отклика на встрече ${round}`,
      );
      assert.deepEqual(
        said.map((l) => l.who),
        round % 2 === 0 ? [0, 1, 1, 0] : [1, 0, 0, 1],
        `говорящие идут не по очереди на встрече ${round}`,
      );
      assert.equal(new Set(said.map((l) => l.who)).size, 2, 'разговор вышел монологом');
    }
  });

  test('заговаривает то один, то другой', () => {
    const starters = new Set([0, 1, 2, 3].map((r) => chatAt(a, b, 0, r)!.who));
    assert.equal(starters.size, 2, 'начинает всегда один и тот же');
  });

  test('встречи не повторяют друг друга словом в слово', () => {
    const rounds = [0, 1, 2, 3, 4, 5].map((r) =>
      Array.from({ length: CHAT_LINES }, (_, i) => chatAt(a, b, i * TALK_SECONDS, r)!.text).join('|'));
    assert.ok(new Set(rounds).size >= 4, `шесть встреч дали ${new Set(rounds).size} разговоров`);
  });

  test('после последней реплики — тишина, а не круг заново', () => {
    // Пара стоит у костра дольше, чем говорит: молчание в конце и есть
    // то, ради чего пауза существует.
    assert.equal(chatAt(a, b, CHAT_SECONDS, 0), null);
    assert.equal(chatAt(a, b, CHAT_SECONDS + 3, 0), null);
    assert.equal(chatAt(a, b, -1, 0), null);
  });

  test('разговор — функция времени: та же встреча, те же слова', () => {
    for (const s of [0, 3.9, 8.2]) {
      assert.deepEqual(chatAt(a, b, s, 3), chatAt(a, b, s, 3));
    }
  });
});
