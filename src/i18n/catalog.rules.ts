import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatter } from '@lingui/format-po';

const CYRILLIC = /[А-Яа-яЁё]/;
const catalog = await formatter({ lineNumbers: false }).parse(
  readFileSync(new URL('../locales/en/messages.po', import.meta.url), 'utf8'),
  { locale: 'en', sourceLocale: 'ru', filename: 'src/locales/en/messages.po' },
);

describe('Lingui: legacy catalog', () => {
  test('every extracted legacy phrase has a complete English translation', () => {
    const legacy = Object.entries(catalog).filter(([, message]) =>
      message.origin?.some(([path]) => path === 'locales/legacy-messages.ts'),
    );

    assert.ok(legacy.length > 6_000, `only ${legacy.length} legacy messages were extracted`);
    for (const [source, message] of legacy) {
      assert.ok(message.translation, `missing translation: ${source}`);
      assert.ok(!CYRILLIC.test(message.translation), `Cyrillic remains in English: ${source}`);
    }
  });
});
