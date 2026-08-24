import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatter } from '@lingui/format-po';
import { gameMessages } from './gameMessages';

const CYRILLIC = /[А-Яа-яЁё]/;
const catalog = await formatter({ lineNumbers: false }).parse(
  readFileSync(new URL('../locales/en/messages.po', import.meta.url), 'utf8'),
  { locale: 'en', sourceLocale: 'ru', filename: 'src/locales/en/messages.po' },
);

const migratedUi = [
  '../ui/startScreen.ts',
  '../ui/authCard.ts',
  '../ui/clanPanel.ts',
  '../ui/clanBuildBar.ts',
  '../ui/settings.ts',
] as const;

function cyrillicLiteralLine(source: string): number | null {
  let line = 1;
  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '\n') {
      line++;
      index++;
    } else if (char === '/' && next === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) return null;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const comment = source.slice(index, end < 0 ? source.length : end + 2);
      line += (comment.match(/\n/g) ?? []).length;
      index = end < 0 ? source.length : end + 2;
    } else if (char === "'" || char === '"' || char === '`') {
      const startLine = line;
      const quote = char;
      let literal = '';
      index++;
      while (index < source.length) {
        const part = source[index];
        if (part === '\n') line++;
        if (part === '\\') {
          literal += source.slice(index, index + 2);
          index += 2;
        } else if (part === quote) {
          index++;
          break;
        } else {
          literal += part;
          index++;
        }
      }
      if (CYRILLIC.test(literal)) return startLine;
    } else index++;
  }
  return null;
}

describe('Lingui: explicit game UI', () => {
  test('every generated game message has an English translation', () => {
    for (const [id, message] of Object.entries(catalog)) {
      const generated = message.origin?.some(([path]) => path === 'locales/game-messages.ts') ?? false;
      if (!generated) continue;
      assert.equal(typeof message.translation, 'string', `missing English translation: ${id}`);
      assert.notEqual(message.translation, '', `missing English translation: ${id}`);
      assert.ok(!CYRILLIC.test(message.translation ?? ''), `Cyrillic remains in English: ${id}`);
    }
  });

  test('every game descriptor is extracted and translated', () => {
    for (const descriptor of Object.values(gameMessages)) {
      const extracted = catalog[descriptor.id];
      assert.ok(extracted, `message was not extracted: ${descriptor.id}`);
      if (descriptor.translation !== undefined) {
        assert.equal(extracted.translation, descriptor.translation, `catalog drift: ${descriptor.id}`);
      }
      assert.equal(typeof extracted.translation, 'string', `missing English translation: ${descriptor.id}`);
      assert.ok(!CYRILLIC.test(extracted.translation ?? ''), `Cyrillic remains in English: ${descriptor.id}`);
      assert.ok(
        extracted.origin?.some(([path]) => path === 'locales/game-messages.ts'),
        `game extraction origin is missing: ${descriptor.id}`,
      );
    }
  });

  test('migrated UI files contain no hard-coded Cyrillic string literals', () => {
    for (const relative of migratedUi) {
      const url = new URL(relative, import.meta.url);
      const source = readFileSync(url, 'utf8');
      const line = cyrillicLiteralLine(source);
      assert.equal(line, null, `${relative}:${line ?? 0} has raw UI text`);
    }
  });
});
