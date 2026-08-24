import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatter } from '@lingui/format-po';

const input = process.argv[2];
if (!input) throw new Error('usage: npm run i18n:legacy:import -- <translations.json>');

const translations = JSON.parse(readFileSync(resolve(input), 'utf8'));
if (!Array.isArray(translations)) throw new Error('translation input must be an array');

const pairs = new Map();
for (const entry of translations) {
  const source = entry?.source;
  const translation = entry?.translation;
  if (typeof source !== 'string' || source.length === 0) throw new Error('legacy source must be a non-empty string');
  if (typeof translation !== 'string' || translation.length === 0) {
    throw new Error(`missing English translation for ${JSON.stringify(source)}`);
  }
  if (/[А-Яа-яЁё]/.test(translation)) {
    throw new Error(`English translation still contains Cyrillic: ${JSON.stringify(translation)}`);
  }
  pairs.set(source, translation);
}

const sourcePath = resolve('locales/legacy-messages.ts');
let sourceFile = readFileSync(sourcePath, 'utf8');
const existing = new Set();
let nextIndex = 0;
for (const match of sourceFile.matchAll(/legacyMessage(\d+) = defineMessage\(\{ id: ("(?:[^"\\]|\\.)*")/g)) {
  nextIndex = Math.max(nextIndex, Number(match[1]) + 1);
  existing.add(JSON.parse(match[2]));
}

const additions = [];
for (const source of pairs.keys()) {
  if (existing.has(source)) continue;
  const id = String(nextIndex++).padStart(4, '0');
  const literal = JSON.stringify(source);
  const message = JSON.stringify(source.replace(/ZXQPH(\d+)QXZ/g, '{value$1}'));
  additions.push(`export const legacyMessage${id} = defineMessage({ id: ${literal}, message: ${message} });`);
}
if (additions.length > 0) {
  sourceFile = `${sourceFile.trimEnd()}\n${additions.join('\n')}\n`;
  writeFileSync(sourcePath, sourceFile);
}

const patternPath = resolve('src/i18n/legacy.ts');
let patternFile = readFileSync(patternPath, 'utf8');
const patterns = [...pairs.keys()].filter((source) => source.includes('ZXQPH') && !patternFile.includes(JSON.stringify(source)));
if (patterns.length > 0) {
  const closing = patternFile.lastIndexOf('];');
  if (closing < 0) throw new Error('legacy pattern list has no closing bracket');
  const head = patternFile.slice(0, closing).trimEnd();
  const separator = head.endsWith(',') ? '\n' : ',\n';
  const additions = patterns.map((source) => `  {\n    "source": ${JSON.stringify(source)}\n  },\n`).join('');
  patternFile = `${head}${separator}${additions}${patternFile.slice(closing)}`;
  writeFileSync(patternPath, patternFile);
}

execFileSync('npm', ['run', 'i18n:extract'], { stdio: 'inherit' });

const po = formatter({ lineNumbers: false });
const catalogPath = resolve('src/locales/en/messages.po');
const existingPo = readFileSync(catalogPath, 'utf8');
const catalog = po.parse(existingPo);
for (const [source, translation] of pairs) {
  const message = catalog[source];
  if (!message) throw new Error(`Lingui did not extract ${JSON.stringify(source)}`);
  message.translation = translation;
}
writeFileSync(
  catalogPath,
  po.serialize(catalog, { locale: 'en', sourceLocale: 'ru', existing: existingPo }),
);

console.log(`Imported ${pairs.size} legacy translations (${additions.length} new messages, ${patterns.length} patterns).`);
