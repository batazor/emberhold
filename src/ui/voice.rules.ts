/**
 * Голос игры — то, чем она говорит с игроком поверх картинки.
 *
 * Канал физически один: полоса лагеря и строка вылазки, где подсказка кадра
 * ждёт под сообщением (`banner.ts`). Работ у этого канала три — сказать, что
 * делать, сказать, почему нельзя, и сказать, что случилось, — и до сих пор
 * они различались только тем, кто писал строку. Слова расходились молча:
 * одна и та же причина живёт в двух таблицах разными словами, а полоса
 * то приказывает, то докладывает.
 *
 * Проверять это глазами нечем: строк под сотню, лежат они в шести файлах,
 * и вопрос «кем игра считает игрока в этой строке» — про весь корпус сразу,
 * а не про кадр. Поэтому корпус собирается из исходников и меряется здесь.
 *
 * **Что тут правило, а что замер.** Правил ровно три: перепись не протухла,
 * новых таблиц голоса не завелось, и на «ты» в интерфейсе не говорят.
 * Остальное — записанные числа: расхождения близнецов, приказы в канале
 * событий, обращения по каналам. Они не объявлены дефектом и не чинятся
 * этим файлом; они зафиксированы, чтобы не росли молча. Уменьшать список
 * можно и нужно — тогда правится запись рядом.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = new URL('../..', import.meta.url).pathname;

/* ---------- откуда берётся корпус ---------- */

/**
 * Канал строки. Не «где она лежит», а какую работу делает: подсказка висит
 * до конца кадра, отказ отвечает на жест, событие сообщает о случившемся,
 * диалог — речь человека, а не игры.
 *
 * `состояние` каналом не является: это подпись в панели, а не строка полосы.
 * Числится здесь затем, что таблица с таким именем существует, и правило
 * «новых таблиц не завелось» обязано её знать.
 */
type Channel = 'подсказка' | 'отказ' | 'событие' | 'диалог' | 'состояние';

/** Таблицы строк, известные поимённо. Ключ — имя, значение — канал. */
const TABLES: Readonly<Record<string, Channel>> = {
  ONB_HINT: 'подсказка',
  PITCH_HINT: 'подсказка',
  CHOP_DENY: 'отказ',
  MINE_DENY: 'отказ',
  BLOCK_REASON: 'отказ',
  GEAR_REASON: 'отказ',
  TRAIN_REASON: 'отказ',
  BLOCK_TEXT: 'отказ',
  GEAR_BLOCK_TEXT: 'отказ',
  TRAIN_TEXT: 'отказ',
  TENT_REASON: 'отказ',
  ENTRY_REASON: 'отказ',
  STATUS_TEXT: 'состояние',
};

/** Вызовы, за которыми стоит строка полосы. Ключ — что ищем, значение — канал. */
const CALLS: Readonly<Record<string, Channel>> = {
  setHint: 'подсказка',
  setSticky: 'подсказка',
  notify: 'событие',
  'events.push': 'событие',
  setReason: 'событие',
};

/** Речь человека берётся из панели знакомства и только оттуда. */
const DIALOGUE_FILE = 'src/ui/meetPanel.ts';

interface Line {
  readonly text: string;
  readonly where: string;
  readonly channel: Channel;
  /** Имя таблицы или вызова — чтобы расхождение можно было починить. */
  readonly from: string;
  /** Ключ причины; у строк не из таблиц отказов его нет. */
  readonly key?: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!name.startsWith('.')) walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.rules.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sources = new Map(
  walk(join(ROOT, 'src')).map((f) => [relative(ROOT, f).replaceAll('\\', '/'), readFileSync(f, 'utf8')]),
);

/**
 * Подстановки схлопываются в «⟨⟩»: голос мерится словами игры, а не тем,
 * какое имя подставится. Вложенные шаблоны сворачиваются изнутри наружу,
 * поэтому цикл, а не одна замена.
 */
function fold(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(/\$\{[^{}]*\}/g, '⟨⟩');
    if (next === out) return out;
    out = next;
  }
}

/**
 * Строка ли это игрока. Слова, а не одни подстановки: «⟨⟩: ⟨⟩» — не голос,
 * а рамка, в которую голос кладут с обеих сторон.
 */
const speech = (text: string): boolean => /[А-Яа-яЁё]/.test(text);

/** Все строковые литералы куска кода, уже свёрнутые. */
function literals(code: string): string[] {
  const out: string[] = [];
  for (const m of fold(code).matchAll(/'([^'\n]*)'|`([^`]*)`/g)) {
    const text = m[1] ?? m[2] ?? '';
    if (speech(text)) out.push(text);
  }
  return out;
}

/** Аргументы вызова, начинающегося на `at`: до парной скобки, со строками внутри. */
function argsOf(code: string, at: number): string {
  let depth = 0;
  let quote = '';
  for (let i = at; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '`' || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return code.slice(at, i);
  }
  return '';
}

const corpus: Line[] = [];
/** Имена таблиц голоса, найденные в исходниках. Наружу — ради правила о новых. */
const found = new Set<string>();

for (const [file, code] of sources) {
  const line = (index: number): string => `${file}:${code.slice(0, index).split('\n').length}`;

  // Таблицы: `const NAME... = { ключ: 'строка', ... };`
  for (const m of code.matchAll(/(?:^|\n)(?:export )?const ([A-Z][A-Z_]*)[^=\n]*=\s*\{\n([\s\S]*?)\n\};/g)) {
    const name = m[1]!;
    if (!/(REASON|DENY|HINT|TEXT)$/.test(name)) continue;
    found.add(name);
    const channel = TABLES[name];
    if (channel === undefined || channel === 'состояние') continue;
    for (const row of m[2]!.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']*)'/gm)) {
      // Пустая строка — это «отказа нет» (`ok` у рубки и добычи), а не слова.
      if (row[2] === '') continue;
      corpus.push({ text: row[2]!, where: line(m.index), channel, from: name, key: row[1]! });
    }
  }

  // Вызовы: строка, отданная полосе прямо в аргументе.
  for (const [call, channel] of Object.entries(CALLS)) {
    const re = new RegExp(`\\b${call.replace('.', '\\.')}\\(`, 'g');
    for (const m of code.matchAll(re)) {
      const at = m.index + m[0].length - 1;
      for (const text of literals(argsOf(code, at))) {
        corpus.push({ text, where: line(m.index), channel, from: call });
      }
    }
  }

  // Речь: у знакомства свой способ говорить — присваивание в строку панели.
  if (file === DIALOGUE_FILE) {
    for (const m of code.matchAll(/\.textContent\s*=\s*([^;]+);/g)) {
      for (const text of literals(m[1]!)) {
        corpus.push({ text, where: line(m.index), channel: 'диалог', from: 'meetPanel' });
      }
    }
  }
}

const inChannel = (...channels: Channel[]): Line[] => corpus.filter((l) => channels.includes(l.channel));

/* ---------- разбор слов ---------- */

const words = (text: string): string[] => text.toLowerCase().replaceAll('ё', 'е').split(/[^а-я]+/).filter(Boolean);

/**
 * Слова на «-ите/-йте/-ьте/-есь», которые не приказ. Список короткий и таким
 * останется: канал говорит о лесе, камне и палатке, а не о чём угодно.
 */
const NOT_ORDERS = new Set(['здесь', 'весь']);

/** Приказ ли строка: есть ли в ней глагол в повелительном наклонении на «вы». */
const orders = (text: string): boolean =>
  words(text).some((w) => w.length >= 5 && /(ите|йте|ьте|есь|ись)$/.test(w) && !NOT_ORDERS.has(w));

type Person = 'вы' | 'ты' | 'я' | 'никто';

/**
 * К кому обращена строка. Игрок за клавиатурой, хозяин лагеря и сам герой —
 * три разных лица, и грамматика единственное место, где видно, какое из них
 * имелось в виду. Треугольник и его разбор — у Нельсона,
 * inform-fiction.org/manual/html/s48.html.
 */
function person(text: string): Person {
  const w = words(text);
  if (w.some((x) => /^(тебя|тебе|тобой|тво[йяе]|возьми)$/.test(x))) return 'ты';
  if (w.some((x) => /^(вас|вам|вами)$/.test(x)) || orders(text)) return 'вы';
  if (w.some((x) => /^(я|мы|нас|нам|ждем|наш[аеи]?)$/.test(x))) return 'я';
  return 'никто';
}

/** Перепись по каналу: сколько строк какого обращения. */
function census(channel: Channel): Record<Person, number> {
  const out: Record<Person, number> = { вы: 0, ты: 0, я: 0, никто: 0 };
  for (const l of corpus) if (l.channel === channel) out[person(l.text)]++;
  return out;
}

/* ---------- замеры, записанные на 2026-08-21 ---------- */

/**
 * Пары «одна причина — две таблицы». Слева строка, которую полоса приклеивает
 * после двоеточия, справа — подпись той же причины в панели. Пока таблиц две,
 * слова обязаны совпадать: игрок видит один и тот же отказ.
 */
const TWINS: readonly (readonly [string, string])[] = [
  ['BLOCK_REASON', 'BLOCK_TEXT'],
  ['GEAR_REASON', 'GEAR_BLOCK_TEXT'],
  ['TRAIN_REASON', 'TRAIN_TEXT'],
];

/** Причины, у которых близнецы разошлись словами. Список — замер, а не норма. */
const DIVERGED: readonly string[] = [
  'BLOCK_REASON/BLOCK_TEXT hq-cap: «выше Жилья нельзя» ≠ «Жильё не пускает выше»',
  'TRAIN_REASON/TRAIN_TEXT cap: «потолок — на два уровня ниже лучшего» ≠ «потолок — на два ниже лучшего»',
];

/**
 * Таблицы отказов, где у ключа `ok` лежит текст. Отказа при `ok` нет,
 * и строка там — это слова на случай, которого не бывает: `CHOP_DENY`
 * и `MINE_DENY` держат в этом ключе пустоту, а эти две — «не вышло».
 */
const SPEAKS_WITHOUT_REFUSAL: readonly string[] = ['BLOCK_REASON: не вышло', 'GEAR_REASON: не вышло'];

/** Подсказки, которые не приказывают, а называют, чего в мире нет. */
const HINTS_WITHOUT_ORDER: readonly string[] = [
  'Теперь костёр',
  'Мастерской нужен камень — его нет на поляне',
  'Дальше — ещё один сундук',
  'Железо — у торговца в замке',
];

/** События, которые приказывают. Канал взял на себя работу подсказки. */
const EVENTS_WITH_ORDER: readonly string[] = [
  '⟨⟩: коснитесь свободного места',
  'Стены: выберите карточку, дальше жест по земле',
  'Регион пересобрался — выберите место заново',
];

/** Сколько строк в каком канале. Падение числа — повод посмотреть, не протух ли разбор. */
const SIZES: Readonly<Record<string, number>> = { подсказка: 11, отказ: 39, событие: 36, диалог: 5 };

/** Обращения по каналам. Здесь весь треугольник виден разом. */
const CENSUS: Readonly<Record<string, Record<Person, number>>> = {
  подсказка: { вы: 7, ты: 0, я: 0, никто: 4 },
  отказ: { вы: 0, ты: 0, я: 0, никто: 39 },
  событие: { вы: 4, ты: 0, я: 1, никто: 31 },
  диалог: { вы: 1, ты: 3, я: 1, никто: 0 },
};

/** Длиннее этого строка не помещается в полосу и переносится. */
const LIMIT = 60;

/* ---------- правила ---------- */

describe('Голос игры', () => {
  test('перепись не протухла: все известные таблицы найдены', () => {
    // Разбор идёт регулярками по исходникам, и главный способ такому
    // инструменту соврать — тихо ничего не найти после переименования.
    for (const name of Object.keys(TABLES)) {
      assert.ok(found.has(name), `таблица ${name} не найдена — разбор не видит её больше`);
    }
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(SIZES).map((c) => [c, inChannel(c as Channel).length]),
      ),
      SIZES,
      'корпус изменился — посмотрите, что добавилось, и поправьте запись',
    );
  });

  test('новых таблиц голоса не завелось', () => {
    // Седьмая таблица причин — это седьмой способ сказать то же самое.
    // Заводить её можно, но не молча: имя вносится в TABLES вместе с каналом.
    const unknown = [...found].filter((name) => TABLES[name] === undefined);
    assert.deepEqual(unknown, [], 'таблица строк заведена мимо переписи');
  });

  test('на «ты» говорят только люди', () => {
    // Единственное из трёх лиц, которое проект уже выбрал делом: интерфейс
    // обращается на «вы», а на «ты» зовёт поселенец в знакомстве — потому
    // что это его речь, а не голос игры.
    const slips = inChannel('подсказка', 'отказ', 'событие')
      .filter((l) => person(l.text) === 'ты')
      .map((l) => `${l.where} ${l.text}`);
    assert.deepEqual(slips, [], 'интерфейс заговорил на «ты»');
  });

  test('строка помещается в полосу и не кончается точкой', () => {
    // Полоса одна и живёт четыре секунды: абзац в ней не прочитывается,
    // а точка в конце просит следующего предложения, которого не будет.
    // Речь человека — исключение: она предложение и есть.
    for (const l of inChannel('подсказка', 'отказ', 'событие')) {
      assert.ok(l.text.length <= LIMIT, `${l.where} длиннее ${LIMIT}: ${l.text}`);
      assert.ok(!l.text.endsWith('.'), `${l.where} кончается точкой: ${l.text}`);
    }
  });

  test('замер: одна причина — две таблицы и разные слова', () => {
    const same = (text: string): string => text.toLowerCase().replaceAll('ё', 'е');
    const diverged: string[] = [];
    for (const [left, right] of TWINS) {
      const byKey = (from: string): Map<string, string> =>
        new Map(corpus.filter((l) => l.from === from && l.key).map((l) => [l.key!, l.text]));
      const a = byKey(left);
      const b = byKey(right);
      for (const [key, text] of a) {
        const twin = b.get(key);
        if (twin !== undefined && same(text) !== same(twin)) {
          diverged.push(`${left}/${right} ${key}: «${text}» ≠ «${twin}»`);
        }
      }
    }
    assert.deepEqual(diverged, DIVERGED, 'близнецы разошлись не так, как записано');
  });

  test('замер: отказ говорит там, где отказа нет', () => {
    const speaking = corpus
      .filter((l) => l.key === 'ok' && l.text !== '')
      .map((l) => `${l.from}: ${l.text}`);
    assert.deepEqual(speaking, SPEAKS_WITHOUT_REFUSAL, 'изменился список строк при `ok`');
  });

  test('замер: подсказка приказывает, событие рассказывает — но не всегда', () => {
    // Обе стороны меряются вместе: это одна болезнь — канал у них общий,
    // и работа перетекает туда, где строку удобнее было дописать.
    assert.deepEqual(
      inChannel('подсказка').filter((l) => !orders(l.text)).map((l) => l.text),
      HINTS_WITHOUT_ORDER,
      'изменился список подсказок без приказа',
    );
    assert.deepEqual(
      inChannel('событие').filter((l) => orders(l.text)).map((l) => l.text),
      EVENTS_WITH_ORDER,
      'изменился список событий с приказом',
    );
  });

  test('замер: кем игра считает игрока', () => {
    assert.deepEqual(
      Object.fromEntries(Object.keys(CENSUS).map((c) => [c, census(c as Channel)])),
      CENSUS,
      'обращения разъехались — посмотрите, кто именно заговорил иначе',
    );
  });
});
