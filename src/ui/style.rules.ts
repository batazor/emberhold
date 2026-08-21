/**
 * Правила словаря панелей (DESIGN §6.2).
 *
 * Проверяется не то, как интерфейс выглядит, — это решает глаз, — а четыре
 * обещания, которые карта стилей даёт и которые молча протухают. Все четыре
 * уже были нарушены к моменту, когда словарь появился: экран возврата стоял
 * в файле дважды целиком, тридцать цветов лежали мимо `:root`, строка
 * «слева подпись, справа значение» была написана руками тринадцать раз,
 * а коробка с рамкой — десять.
 *
 * Разошлись они не потому, что кто-то так решил, а потому, что решать было
 * не обо что: правила не было, и каждая новая панель заводила своё. Ревью
 * помнит хуже теста — отсюда этот файл.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/** Карта без комментариев: внутри них живут и цвета, и селекторы-примеры. */
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Три слова словаря, которым коробку объявлять можно, и `button` — он и есть
 * коробка по умолчанию. `.map-cv` — единственное названное исключение: это
 * холст, и набить его отступом нельзя, а край карте нужен (§4.2).
 */
const BOXES = new Set(['.card', '.panel', '.chip', 'button', '.map-cv']);

/** Заголовок правила и его тело, по порядку. Медиазапросы разбираются наравне. */
interface Rule {
  readonly selector: string;
  readonly body: string;
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selector = m[1]!.replace(/\s+/g, ' ').trim();
    if (selector === '' || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2]! });
  }
  return out;
}

const ALL = rules(BARE);

/**
 * То же, но без медиазапросов: внутри них селектор повторяется законно —
 * в этом и смысл запроса. Дубликаты ищутся только по основному потоку.
 */
const FLAT = rules(BARE.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''));

/** Тело правила `:root` — единственное место, где цвет объявляется значением. */
const ROOT = ALL.filter((r) => r.selector === ':root').map((r) => r.body).join('\n');

describe('словарь панелей', () => {
  test('ни один селектор не объявлен дважды', () => {
    const seen = new Map<string, number>();
    for (const { selector } of FLAT) seen.set(selector, (seen.get(selector) ?? 0) + 1);
    const twice = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
    assert.deepEqual(
      twice,
      [],
      'селектор объявлен больше одного раза — второе объявление либо мёртвое, ' +
        'либо молча перебивает первое:\n' + twice.join('\n'),
    );
  });

  test('цвет объявляется только в :root', () => {
    // Медиазапросы и вложенность уже сняты разбором: сравнивается тело правила.
    const stray: string[] = [];
    for (const { selector, body } of ALL) {
      if (selector === ':root') continue;
      for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
        stray.push(`${selector} → ${m[0]}`);
      }
    }
    assert.deepEqual(
      stray,
      [],
      'цвет значением вне :root. Заведите токен и возьмите его через var():\n' +
        stray.join('\n'),
    );
  });

  test('строку «слева подпись, справа значение» объявляет только .row', () => {
    const stray = ALL.filter(
      (r) =>
        r.selector !== '.row' &&
        /justify-content:\s*space-between/.test(r.body) &&
        /align-items:\s*baseline/.test(r.body),
    ).map((r) => r.selector);
    assert.deepEqual(
      stray,
      [],
      'это `.row`, а не своя строка. Не хватает поведения — добавьте модификатор ' +
        'к `.row`, а не второе правило:\n' + stray.join('\n'),
    );
  });

  test('коробку с краем объявляет только .card', () => {
    const stray = ALL.filter(
      (r) =>
        !BOXES.has(r.selector) &&
        /border:\s*1px solid var\(--line\)/.test(r.body) &&
        /border-radius/.test(r.body),
    ).map((r) => r.selector);
    assert.deepEqual(
      stray,
      [],
      'своя коробка вместо словаря. Возьмите `.card` (карточка внутри листа), ' +
        '`.panel` (лист поверх сцены) или `.chip` (метка):\n' + stray.join('\n'),
    );
  });

  test('каждый токен :root кем-то взят', () => {
    const declared = [...ROOT.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
    assert.notEqual(declared.length, 0, 'в :root не нашлось ни одного токена');
    const dead = declared.filter((name) => !BARE.includes(`var(${name})`));
    assert.deepEqual(
      dead,
      [],
      'токен объявлен и никем не взят — либо панель его забыла, либо он лишний:\n' +
        dead.join('\n'),
    );
  });
});
