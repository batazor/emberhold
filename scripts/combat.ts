/**
 * Замер боя. Отвечает на вопрос, который §11.3 ставит, но сам проверить
 * не может: **делают ли Атака и Защита хоть что-нибудь.**
 *
 * До замены модели боя честный ответ — «нет»: удар стоит одной раны
 * независимо от того, кто бьёт и кто получает, а Атака с Защитой лежат
 * в `heroes.ts` показанными, но не посчитанными. Скрипт написан до правки
 * намеренно, чтобы эта картинка была снята прибором, а не описана словами,
 * и чтобы после правки было с чем сравнивать.
 *
 * Метод — дуэль без локации: пустое поле, герой и один противник в шаге
 * друг от друга, никакой ходьбы и никакого провианта на дорогу. Вылазка
 * меряет всё сразу и потому не отвечает про бой; дуэль отвечает только
 * про бой и потому не отвечает про вылазку. Обе нужны, и путать их нельзя:
 * §22 прямо предупреждает, что дуэльная цена врага не равна цене
 * его присутствия в настоящей вылазке.
 *
 * Запуск: npx tsx scripts/combat.ts
 */
import { TICK } from '../src/core/loop';
import { ENEMY_STATS } from '../src/sim/enemies';
import { emptyGear } from '../src/sim/gear';
import type { GearState } from '../src/sim/gear';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout } from '../src/sim/heroes';
import type { HeroClassId, HeroLoadout } from '../src/sim/heroes';
import { POLICIES, botBattlePlan } from '../src/sim/bot';
import { commandBattle, commandMove, createRaid, damageOf, inBattle, stepRaid } from '../src/sim/raid';
import { distanceField } from '../src/sim/grid';
import type { EnemyKind, GameLocation } from '../src/sim/types';

/** Сколько секунд дуэли считаем безнадёжными: столько бой не длится нигде. */
const GIVE_UP = 60;
/** Поле дуэли. Маленькое: ходить в нём некуда и не нужно. */
const SIZE = 9;

/**
 * Поле для дуэли: всё проходимо, герой в центре, противник рядом. Стены нет
 * намеренно — вопрос скрипта про урон, а не про геометрию, и камень тут
 * добавил бы к ответу то, чего в вопросе не было.
 */
function duelField(kind: EnemyKind, gap: number): GameLocation {
  const mid = (SIZE - 1) / 2;
  const evac = { x: mid, z: mid };
  const blocked = new Uint8Array(SIZE * SIZE);
  return {
    seed: 0,
    tier: 0,
    size: SIZE,
    blocked,
    evac,
    containers: [],
    stones: [],
    enemies: [
      {
        id: 0,
        kind,
        x: mid + gap,
        z: mid,
        prevX: mid + gap,
        prevZ: mid,
        hp: ENEMY_STATS[kind].hp,
        awake: true,
        telegraph: 0,
        cooldown: 0,
      },
    ],
    backSteps: distanceField(SIZE, blocked, evac),
  };
}

interface Duel {
  /** Секунд до падения противника; null — не упал за GIVE_UP. */
  readonly ttk: number | null;
  /** Ударов героя до падения. */
  readonly swings: number;
  /** Урона, снятого с героя за дуэль. */
  readonly damage: number;
  /** Выжил ли герой. */
  readonly won: boolean;
}

/**
 * Одна дуэль. Провиант и голод выключены: дуэль меряет бой, а голодная
 * смерть на пустом поле сказала бы только то, что мы долго ждали.
 */
function duel(cls: HeroClassId, gear: GearState, kind: EnemyKind): Duel {
  const hero: HeroLoadout = loadout(createHero(cls, 0));
  const state = createRaid({
    seed: 0,
    tier: 0,
    kitchenLevel: 9,
    storageLevel: 9,
    loadout: hero,
    gear,
    // Ставим на дистанции выстрела стрелка либо на длину оружия ближнего:
    // в обоих случаях это то расстояние, с которого противник начинает бить,
    // а герой уже идёт.
    loc: duelField(kind, Math.min(ENEMY_STATS[kind].reach * 0.9, 4)),
    food: 9999,
    hunger: false,
  });

  const enemy = state.loc.enemies[0]!;
  const startHp = state.hero.hp;
  let swings = 0;
  let before = enemy.hp;
  let t = 0;

  while (t < GIVE_UP && enemy.hp > 0 && state.status === 'running') {
    // Герой сам идёт на противника. Со стрелком иначе нельзя: он стоит
    // далеко именно затем, чтобы до него шли, и неподвижный герой мерил бы
    // не бой, а собственную неподвижность. Лучник по дороге стреляет —
    // и это ровно то, чем он отличается.
    // §11.3 — бой пошаговый, и стенд обязан в нём ходить теми же правилами,
    // что бот. Иначе дуэль мерила бы не бой, а неподвижность героя.
    if (inBattle(state)) {
      if (!commandBattle(state, botBattlePlan(state, POLICIES.cautious))) {
        commandBattle(state, { kind: 'wait' });
      }
    } else if (state.path.length === 0) {
      commandMove(state, { x: Math.round(enemy.x), z: Math.round(enemy.z) });
    }
    stepRaid(state, TICK, false, hero.knowledge);
    if (enemy.hp < before) {
      swings += 1;
      before = enemy.hp;
    }
    t += TICK;
  }

  return {
    ttk: enemy.hp <= 0 ? t : null,
    swings,
    damage: startHp - state.hero.hp,
    won: enemy.hp <= 0 && state.status === 'running',
  };
}

const KINDS = Object.keys(ENEMY_STATS) as EnemyKind[];

/** Снаряжение уровня `l` во всех слотах разом: вопрос не про отдельный слот. */
const gearAt = (level: number): GearState => {
  const g = emptyGear();
  for (const slot of Object.keys(g) as (keyof GearState)[]) g[slot] = level;
  return g;
};

const secs = (x: number | null): string => (x === null ? '  —  ' : `${x.toFixed(2)}с`);

console.log('Дуэли: герой против одного противника, пустое поле, без провианта\n');

for (const level of [0, 3, 5]) {
  const gear = gearAt(level);
  console.log(`══ снаряжение ур. ${level === 0 ? '— (пусто)' : level} ══`);
  console.log('класс      Атака Защита │ ' + KINDS.map((k) => ENEMY_STATS[k].name.padEnd(13)).join(''));
  for (const cls of CLASS_ORDER) {
    const def = HERO_CLASSES[cls];
    const cells = KINDS.map((k) => {
      const d = duel(cls, gear, k);
      return `${secs(d.ttk)}/${d.damage.toFixed(0)}`.padEnd(13);
    });
    console.log(
      `${def.name.padEnd(10)} ${String(def.base.attack).padStart(5)} ${String(def.base.defense).padStart(6)} │ ` +
        cells.join(''),
    );
  }
  console.log('  (время до падения противника / урона снято с героя)\n');
}

/**
 * Пробой напрямую: сколько ран стоит удар каждого типа при каждой Защите.
 *
 * Дуэль показывает итог, а он лумпяный — порог переходится не всегда, — и по
 * нему нельзя понять, Защита ли не работает или просто не дотянула до порога.
 * Таблица показывает сам порог, поэтому вопрос «где начинает окупаться щит»
 * получает ответ числом, а не подбором.
 */
console.log('══ пробой: урона за удар при разной Защите ══');
{
  const defenses = [0, 2, 3, 6, 9, 12, 16];
  console.log('противник      Атака │ ' + defenses.map((d) => `З${d}`.padStart(4)).join(''));
  for (const k of KINDS) {
    const a = ENEMY_STATS[k].attack;
    console.log(
      `${ENEMY_STATS[k].name.padEnd(14)}${String(a).padStart(5)} │ ` +
        defenses.map((d) => String(damageOf(a, d)).padStart(4)).join(''),
    );
  }
  const flat = KINDS.every((k) => {
    const a = ENEMY_STATS[k].attack;
    return defenses.every((d) => damageOf(a, d) === damageOf(a, 0));
  });
  console.log(
    flat
      ? '\n⚠ ЗАЩИТА НИЧЕГО НЕ ДЕЛИТ: строки плоские, и характеристика остаётся\n' +
          '  числом в панели героя.'
      : '\n✓ Защита смягчает удар, и плавно: шкале пороги не нужны.',
  );
  console.log('');
}

/**
 * Проверка чувствительности — то, ради чего скрипт написан. Если прогон
 * с изменённой характеристикой совпадает с исходным, характеристика в бой
 * не входит, и число в панели героя — украшение. Никакое рассуждение
 * этого не показывает, а две одинаковые строки показывают.
 */
console.log('══ чувствительность: меняем характеристику, смотрим на бой ══');

const REF: HeroClassId = 'knight';
const base = KINDS.map((k) => duel(REF, emptyGear(), k));

const bump = (over: Partial<{ attack: number; defense: number }>): Duel[] => {
  const def = HERO_CLASSES[REF];
  const patched = {
    ...def,
    base: { ...def.base, ...over },
  };
  // Правим таблицу на время прогона: `loadout()` читает её, и подменить
  // характеристику иначе нельзя, не заводя ради замера отдельный вход в бой.
  const box = HERO_CLASSES as Record<HeroClassId, typeof def>;
  const saved = box[REF];
  box[REF] = patched;
  try {
    return KINDS.map((k) => duel(REF, emptyGear(), k));
  } finally {
    box[REF] = saved;
  }
};

const rows: [string, Duel[]][] = [
  ['как есть', base],
  ['Атака +3', bump({ attack: HERO_CLASSES[REF].base.attack + 3 })],
  ['Защита +6', bump({ defense: HERO_CLASSES[REF].base.defense + 6 })],
  ['Защита +12', bump({ defense: HERO_CLASSES[REF].base.defense + 12 })],
];

console.log('вариант    │ ' + KINDS.map((k) => ENEMY_STATS[k].name.padEnd(13)).join(''));
for (const [label, got] of rows) {
  console.log(
    `${label.padEnd(10)} │ ` +
      got.map((d) => `${secs(d.ttk)}/${d.damage.toFixed(0)}`.padEnd(13)).join(''),
  );
}

const same = (a: Duel[], b: Duel[]): boolean =>
  a.every((d, i) => d.ttk === b[i]!.ttk && d.damage === b[i]!.damage);

const attackDead = same(base, rows[1]![1]);
const defenseDead = same(base, rows[2]![1]) && same(base, rows[3]![1]);

console.log('');
if (attackDead && defenseDead) {
  console.log(
    '⚠ АТАКА И ЗАЩИТА В БОЙ НЕ ВХОДЯТ: три строки совпали.\n' +
      '  Числа в панели героя — украшение, и §11.3 не выполнен.',
  );
} else {
  if (attackDead) console.log('⚠ Атака не меняет бой: строка «Атака +3» совпала с исходной.');
  if (defenseDead) console.log('⚠ Защита не меняет бой: обе её строки совпали с исходной.');
  if (!attackDead && !defenseDead) console.log('✓ Обе характеристики двигают бой.');
}
