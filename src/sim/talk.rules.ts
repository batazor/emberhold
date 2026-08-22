/**
 * Правила речи жильцов (`talk.ts`): тишина длиннее слов, голос один,
 * и каждый когда-нибудь говорит. Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TALK_GAP, TALK_SECONDS, TALK_TEXT, phraseAt } from './talk';
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
