/**
 * Правила артбука. Проверяется не то, как модель выглядит, — это решает глаз, —
 * а два обещания, которые артбук даёт числами и которые молча протухают:
 * бюджет треугольников и палитра артбука.
 *
 * До сих пор оба держались на ревью («проверяется на ревью при добавлении
 * модели, а не скриптом на CI» — артбук, раздел 02). Ревью помнит хуже теста.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, test } from 'node:test';
import { BUILDING_ORDER } from '../sim/camp';
import { CLASS_ORDER } from '../sim/heroes';
import type { EnemyKind } from '../sim/types';
import { C, triangles } from './blocking';
import { ADVENTURERS_MODELS } from './adventurers.data';
import { adventurerGeometry } from './adventurers';
import { HERO_MODELS, buildingGeometry, enemyGeometry, heroGeometry, stageOf } from './models';
import { dwellerParts } from './models';
import { DWELLER_LOOKS, type DwellerLook } from '../sim/garrison';
import { FOLK_MODELS, FOLK_SLOTS } from './folk.data';
import { FOREST_SLOTS } from './forest.data';
import { CASTLE_MODELS, CASTLE_SLOTS } from './castle.data';
import { CASTLE_SCALE, castleGeometry } from './castle';
import {
  CASTLE_SURROUNDINGS,
  FIXED_BRIDGES,
  FREE_STAIRS,
  GATE_LEAVES,
  HEX_TOWER,
  INNER_WALLS,
  PARTS,
  STAIR_PARTS,
  TOWER,
  TOWER_MAX,
  WALL_BANNERS,
  WALK,
  WALL_TOP,
  towerHeight,
} from '../sim/castle';
import { ELEVATION } from './scene';
import {
  CASTLE_SLOT_ORDER,
  DUNGEON_SLOT_ORDER,
  FOREST_SLOT_ORDER,
  GRAVEYARD_SLOT_ORDER,
  MATERIAL,
  FOLK_SLOT_ORDER,
  PROPS_SLOT_ORDER,
  SKELETON_SLOT_ORDER,
  WEAPONS_SLOT_ORDER,
} from './palette';
import { DUNGEON_SLOTS } from './dungeon.data';
import { WEAPONS_MODELS, WEAPONS_SLOTS } from './weapons.data';
import { WEAPON_LADDER, weaponOf } from './weapons';
import { MAX_ITEM_LEVEL } from '../sim/gear';
import { GRAVEYARD_MODELS, GRAVEYARD_SLOTS } from './graveyard.data';
import { PROPS_MODELS, PROPS_SLOTS } from './props.data';
import { cryptGeometry, FENCE_SCALE, fenceGeometry } from './graveyard';
import { FENCE, FENCE_MATERIALS } from '../sim/fence';
import { CRYPT_STYLES } from '../sim/graveSite';
import { SKELETON_SLOTS } from './skeleton.data';

/**
 * Артбук, раздел 03: здание ≤ 1500. Персонажа в списке больше нет.
 *
 * Бюджет в треугольниках — про модель, которую рисуют руками: §6.1 объясняет
 * его двумя вещами, «читалась на пяти сантиметрах экрана» и «рисовалась
 * за вечер». Противника в списке нет и не будет: он берётся готовым, и обе
 * половины обоснования к нему не относятся — рисовать нечего, а силуэт
 * треугольниками не меряется. Цена готовой модели одна и она другая:
 * килобайты в бандле у всех игроков (§6.1.3).
 *
 * **Герою потолка в треугольниках нет** (§6.1). Девятьсот считались, когда
 * героев в кадре предполагалось много; их один — и в лагере, и в вылазке.
 * К моделям набора потолок не применялся никогда (они втрое-вдесятеро тяжелее),
 * к своим — тоже: поселенец и торговец идут по 2400–3100. Правило оставалось
 * строчкой, которую нечему было нарушить, и снято целиком. Цену персонажа
 * меряют килобайты: потолок набора ниже и потолок своей модели рядом с ним.
 */
const BUDGET = { building: 1500 } as const;

/**
 * Потолок принятого набора: сколько он весит в бандле, а не в кадре.
 *
 * **Мерка — gzip, а не base64.** Первая версия этого правила считала символы
 * base64, и это оказалось не тем: при переходе на индексированную запись
 * со скином они выросли на 8%, а то, что скачивает игрок, — на 51%. Индексы
 * и байты костей жмутся заметно хуже квантованных позиций, и потолок
 * в base64 такого прироста просто не видит.
 *
 * Число не выбрано, а посчитано: это **весь состав, который вообще может
 * понадобиться врагам** — четыре скелета и всё их оружие, 252 КБ gzip.
 * Округлено вверх. Смысл потолка в том, что упереться в него можно ровно
 * один раз: за ним не «ещё один противник», а второй набор, и это отдельное
 * решение, а не строка в списке.
 *
 * Сейчас занято 190 КБ из 260 — трое противников §15, топор, посох, скелет
 * и пять состояний §17.1.
 */
const PACK_KB = 260;

/**
 * Потолок набора персонажей — §6.1.4 и §11.7.
 *
 * Считается так же и по той же причине, что у противников: в gzip, по самому
 * файлу, а не перечислением полей. Число тоже посчитано, а не выбрано, но
 * состав другой: «весь набор» здесь — это 520 КБ gzip на шесть персонажей
 * и тридцать один предмет, и потолком такое быть не может. Считаем то, что
 * игре действительно нужно: **три класса §11.7 и по два предмета на каждого**.
 * Округлено вверх.
 *
 * Упереться в него можно ровно один раз: за ним не «ещё предмет»,
 * а четвёртый герой, и это отдельное решение.
 *
 * Было 300, стало 230: маг и посох уехали из набора вместе с жильцами двора,
 * которых теперь рисует свой набор (§6.1.10). Потолок опущен вслед за составом
 * намеренно — оставленный прежним, он молча разрешил бы вернуть семьдесят
 * килобайт, за которые уже заплачено один раз.
 */
const HERO_PACK_KB = 230;

/**
 * §6.1.4 обещает, что этот потолок «проверяет models.rules.ts», — и до сих пор
 * не проверял ничего: в файле стояли только треугольники здания и примитива.
 * Строка держалась на том, что взят был один персонаж и запас казался
 * бесконечным. Он не бесконечен: у самой тяжёлой модели набора запас
 * от потолка — около процента.
 */
const HERO_KB = 200;


/** По одному уровню на каждую стадию роста. */
const LEVEL_OF_STAGE = [1, 3, 5] as const;

const ENEMY_KINDS: readonly EnemyKind[] = ['minion', 'warrior', 'mage'];

describe('Артбук: бюджет треугольников', () => {
  test('здание укладывается в 1500 на каждой стадии', () => {
    for (const id of BUILDING_ORDER) {
      for (const level of LEVEL_OF_STAGE) {
        const geo = buildingGeometry(id, level);
        const t = triangles(geo);
        geo.dispose();
        assert.ok(t <= BUDGET.building, `${id} ур. ${level}: ${t} > ${BUDGET.building}`);
      }
    }
  });

  /**
   * Потолка в треугольниках у героя больше нет (§6.1), но проверка на его
   * месте остаётся — та же, что у противника: опечатка в `HERO_MODELS` даёт
   * пустую геометрию молча, класс просто не рисуется, а игра работает.
   */
  test('у каждого класса §11.7 есть чем рисоваться', () => {
    for (const cls of CLASS_ORDER) {
      const geo = heroGeometry(cls);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t > 0, `${cls}: пустая геометрия`);
    }
  });

  /**
   * Потолка в треугольниках у противника больше нет, но опечатка в имени
   * модели набора даёт пустую геометрию — и молча: противник просто
   * не рисуется, а игра работает.
   */
  test('у каждого противника §15 есть модель', () => {
    for (const kind of ENEMY_KINDS) {
      const geo = enemyGeometry(kind);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t > 0, `${kind}: пустая геометрия`);
    }
  });

  test('готовый набор противников укладывается в свой потолок — килобайты', () => {
    /**
     * Считается по самому файлу и в gzip: перечислять поля руками — способ
     * не заметить новое. Когда к позициям добавились индексы, кости и веса,
     * прежний счёт по двум полям молча остался прежним, а бандл вырос.
     */
    const source = readFileSync(new URL('./skeleton.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= PACK_KB, `набор скелетов: ${kb} КБ gzip > ${PACK_KB} КБ`);
  });

  test('§6.1.4 — запечённый персонаж укладывается в 200 КБ', () => {
    // По каждой модели отдельно, а не суммой: потолок про одного персонажа,
    // и сумма скрыла бы, что одна модель его пробила, а другие лёгкие.
    const source = readFileSync(new URL('./adventurers.data.ts', import.meta.url), 'utf8');
    const models = [...source.matchAll(/^  '([A-Za-z0-9_]+)': \{([\s\S]*?)^  \},$/gm)];
    assert.ok(models.length > 0, 'в данных персонажей не найдено ни одной модели');
    for (const [, name, body] of models) {
      const blobs = [...body!.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
      if (blobs.length === 0) continue;
      const kb = Math.round((blobs.length / 1024) * 10) / 10;
      assert.ok(kb <= HERO_KB, `${name}: ${kb} КБ base64 > ${HERO_KB} КБ`);
    }
  });

  test('§6.1.4 — набор персонажей укладывается в свой потолок', () => {
    const source = readFileSync(new URL('./adventurers.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= HERO_PACK_KB, `набор персонажей: ${kb} КБ gzip > ${HERO_PACK_KB} КБ`);
  });

  test('§14.2 — у героя две руки, и обе стоят на узлах набора', () => {
    // Не «геометрия непустая», а именно то, ради чего узлы запекаются:
    // модель знает матрицу каждой руки, и вооружённая тяжелее безоружной.
    for (const cls of CLASS_ORDER) {
      const model = HERO_MODELS[cls];
      if (model === undefined) continue;
      const hand = (ADVENTURERS_MODELS[model] as {
        hand?: Readonly<Record<string, readonly number[]>>;
      }).hand;
      assert.ok(hand?.['handslot.r'] !== undefined, `${cls}: нет узла правой руки`);
      assert.ok(hand?.['handslot.l'] !== undefined, `${cls}: нет узла левой руки`);

      const bare = adventurerGeometry(model, 1);
      const armed = heroGeometry(cls);
      assert.ok(
        triangles(armed) > triangles(bare),
        `${cls}: с предметом ${triangles(armed)} не тяжелее безоружного ${triangles(bare)}`,
      );
      bare.dispose();
      armed.dispose();
    }
  });

  test('§14.2 — матрица руки одна и та же у всех персонажей набора', () => {
    // На этом стоит вся конструкция двух рук: риг общий, поза общая, ключ
    // общий, — поэтому предмет, вложенный одному, встаёт в руку любому
    // без единого нового числа. Разъедься матрицы, и щит поехал бы
    // у одного класса, оставшись на месте у другого.
    const hands = Object.values(ADVENTURERS_MODELS)
      .map((m) => (m as { hand?: Readonly<Record<string, readonly number[]>> }).hand)
      .filter((h): h is Readonly<Record<string, readonly number[]>> => h !== undefined);
    assert.ok(hands.length >= 2, 'персонажей с руками меньше двух — сверять нечего');
    for (const slot of ['handslot.r', 'handslot.l'] as const) {
      const first = hands[0]![slot];
      assert.ok(first !== undefined, `узла ${slot} нет ни у кого`);
      for (const h of hands) {
        assert.deepEqual(h[slot], first, `узел ${slot} разъехался между персонажами`);
      }
    }
  });

  test('готовый набор героев укладывается в свой потолок — килобайты', () => {
    /**
     * Взято трое — классы §11.7 — и по паре предметов каждому. Мага и посоха
     * здесь больше нет: магом работал жилец двора, пока жильцов не нарисовали
     * своими (§6.1.10).
     *
     * Персонаж тяжелее любой другой модели в игре: один стоит примерно
     * как весь набор кладбища. Поэтому оставшиеся персонажи набора в этот
     * потолок не влезают **намеренно**: взять ещё одного — решение
     * с обоснованием, а не строка в списке `adopted`.
     *
     * Считается по самому файлу и в gzip, как у скелетов: перечислять поля
     * руками — способ не заметить новое.
     */
    const source = readFileSync(new URL('./adventurers.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= HERO_PACK_KB, `набор героев: ${kb} КБ gzip > ${HERO_PACK_KB} КБ`);
  });

  /**
   * Свои модели (§6.1.6.1). Проверяется то же, что у чужих наборов, и по той же
   * причине: своя модель едет в бандл теми же килобайтами, а её слоты так же
   * молча расходятся с палитрой. Единственное послабление — потолок
   * треугольников: девятьсот считались под модель, рисуемую примитивами,
   * и к скинованному персонажу не относятся ни у чужого набора, ни у своего.
   */
  test('у каждого жильца двора есть модель, и она непустая', () => {
    // Торговец дописан к списку руками, и это не небрежность: `DWELLER_LOOKS` —
    // очередь гуляющих, а он в неё не входит по §13.5, он ставится отдельно
    // и стоит. Проверить при этом надо обоих: опечатка в имени модели даёт
    // пустую геометрию молча — жилец просто не рисуется, а игра работает.
    const looks: readonly DwellerLook[] = [...DWELLER_LOOKS, 'торговец'];
    for (const look of looks) {
      const parts = dwellerParts(look);
      assert.ok(triangles(parts.body) > 0, `${look}: пустая геометрия`);
    }
  });

  test('слоты жильцов не разошлись с палитрой артбука', () => {
    assert.deepEqual([...FOLK_SLOTS], [...FOLK_SLOT_ORDER]);
    for (const name of FOLK_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  /**
   * Обход граней у своих моделей. Проверка не про красоту, а про то, что
   * не видно нигде, кроме игры: **Блендер рисует двусторонне, а игра лицевую
   * сторону**, и вывернутая деталь исчезает — сквозь неё видно нутро модели.
   * Ловилось это трижды глазом и трижды было принято за другое: за щель
   * в оболочке, за неудачный цвет, за кривой силуэт.
   *
   * Мерка — согласованность, а не объём: внутреннее ребро правильной сетки
   * пройдено дважды и в противоположных направлениях. Объём знает только
   * замкнутая оболочка, а запекание дробит вершины по слотам, и половина
   * кусков перестаёт быть замкнутой.
   *
   * Причин вывернутости было две, и обе тихие: зеркальный вызов, у которого
   * минимум оказывался больше максимума, и фаска толще половины детали —
   * на борте кафтана она съедала его целиком. Обе закрыты в `build.py`,
   * и обе вернутся молча, если эту проверку убрать.
   */
  test('у своих моделей все грани смотрят наружу', () => {
    for (const [name, model] of Object.entries(FOLK_MODELS)) {
      // Не `.buffer.slice(0)`: маленькие Buffer живут в общем пуле, и его
      // ArrayBuffer шире самих данных — вид обязан взять свой диапазон.
      const idxB = Buffer.from(model.idx, 'base64');
      const posB = Buffer.from(model.pos, 'base64');
      const idx = new Uint16Array(idxB.buffer, idxB.byteOffset, idxB.length / 2);
      const pos = new Int16Array(posB.buffer, posB.byteOffset, posB.length / 2);
      const key = (v: number): string => `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
      const dir = new Map<string, number>();
      for (let t = 0; t < idx.length / 3; t++) {
        const v = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!].map(key);
        for (let i = 0; i < 3; i++) {
          const a = v[i]!;
          const b = v[(i + 1) % 3]!;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          dir.set(k, (dir.get(k) ?? 0) + (a < b ? 1 : -1));
        }
      }
      let clash = 0;
      let border = 0;
      for (const n of dir.values()) {
        if (n === 0) continue;
        if (Math.abs(n) === 1) border++;
        else clash++;
      }
      assert.equal(clash, 0, `${name}: ${clash} рёбер пройдены дважды в одну сторону`);
      assert.equal(border, 0, `${name}: ${border} рёбер без пары — оболочка не замкнута`);
    }
  });

  test('свои модели укладываются в свой потолок — килобайты', () => {
    /**
     * 90 КБ — взятое сейчас, округлённое вверх до десятка: пятеро жильцов.
     * Пятая — поселенка (женская модель, заведена решением: Мила с мужской
     * моделью читалась перепутанной подписью, а не человеком). Считается
     * тем же способом, что у скелетов и героев.
     */
    const source = readFileSync(new URL('./folk.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= 90, `свои модели: ${kb} КБ gzip > 90 КБ`);
  });

  /**
   * Оружие §14 (§6.1.8). Проверяется не то, красив ли клинок, а три обещания,
   * которые протухают молча: что у каждого уровня есть модель, что ковка
   * действительно меняет фигуру героя и что слоты набора не разъехались
   * с палитрой.
   */
  test('у каждого уровня оружия §14 есть клинок из набора', () => {
    for (let level = 0; level <= MAX_ITEM_LEVEL; level++) {
      const name = weaponOf(level);
      assert.ok(name in WEAPONS_MODELS, `уровень ${level}: «${name}» в бандл не поехал`);
    }
  });

  /**
   * Ступени обязаны различаться геометрией, иначе лестница есть в коде
   * и её нет на экране. Последняя ступень держит два уровня намеренно
   * (§6.1.8): после двуручного в наборе ничего нет.
   */
  test('ковка меняет фигуру героя, а не только число', () => {
    const seen = new Map<number, number>();
    for (let level = 0; level < WEAPON_LADDER.length; level++) {
      const geo = heroGeometry('knight', level);
      const t = triangles(geo);
      geo.dispose();
      const clash = [...seen].find(([, count]) => count === t);
      assert.ok(clash === undefined, `уровни ${clash?.[0]} и ${level} дают одну фигуру: ${t}`);
      seen.set(level, t);
    }
    const top = heroGeometry('knight', WEAPON_LADDER.length - 1);
    const over = heroGeometry('knight', MAX_ITEM_LEVEL);
    assert.equal(triangles(top), triangles(over), 'выше лестницы должна стоять её последняя ступень');
    top.dispose();
    over.dispose();
  });

  test('слоты оружия не разошлись с палитрой артбука', () => {
    assert.deepEqual([...WEAPONS_SLOTS], [...WEAPONS_SLOT_ORDER]);
    for (const name of WEAPONS_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  test('шесть уровней укладываются в три стадии', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(stageOf), [0, 0, 1, 1, 2, 2]);
  });
});

/**
 * Замок (§6.1.6). Проверяется не то, красив ли он, а два обещания, которые
 * иначе протухнут молча: что конструктору есть чем строить и что стена
 * читается стеной, а не забором.
 */
describe('Артбук: замок', () => {
  test('каждая деталь конструктора запечена в бандл', () => {
    const named = [
      ...Object.values(PARTS).flat().map((p) => p.model),
      ...STAIR_PARTS.map((p) => p.model),
      TOWER.base,
      TOWER.keepBase,
      TOWER.cap,
      ...TOWER.body,
      ...TOWER.roofs,
      ...TOWER.flags,
      HEX_TOWER.base,
      HEX_TOWER.body,
      ...HEX_TOWER.tops,
      ...HEX_TOWER.roofs,
      ...INNER_WALLS.stone,
      ...INNER_WALLS.wood,
      ...GATE_LEAVES,
      ...FREE_STAIRS,
      ...FIXED_BRIDGES,
      ...WALL_BANNERS,
      ...CASTLE_SURROUNDINGS,
      'bridge-draw',
    ];
    for (const model of named) {
      assert.ok(
        model in CASTLE_MODELS,
        `«${model}» стоит в словаре конструктора, но в бандл не поехал`,
      );
    }
  });

  test('слоты замка не разошлись с палитрой артбука', () => {
    assert.deepEqual([...CASTLE_SLOTS], [...CASTLE_SLOT_ORDER]);
    for (const name of CASTLE_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  test('слоты пропсов не разошлись с палитрой артбука', () => {
    assert.deepEqual([...PROPS_SLOTS], [...PROPS_SLOT_ORDER]);
    for (const name of PROPS_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  test('дорожные плитки словаря пропсов поехали в бандл все', () => {
    // Словарь рендера (`props.ts`) называет по четыре формы на семейство
    // и по фонарю на локацию; каждая обязана быть в запечённых данных.
    const named = [
      'Road_stone_1', 'Road_stone_2', 'Road_stone_3', 'Road_stone_4',
      'Road_wood_1', 'Road_wood_2', 'Road_wood_3', 'road_wood_4',
      'Lamp_1', 'Lamp_2',
    ];
    for (const model of named) {
      assert.ok(model in PROPS_MODELS, `«${model}» назван рендером, но в бандл не поехал`);
    }
  });

  test('через стену не заглянуть, и ход по ней идёт над головой', () => {
    // Рост героя меряется, а не берётся числом: модель может смениться,
    // и масштаб замка обязан спорить с новой, а не со старой.
    const geo = heroGeometry('archer');
    geo.computeBoundingBox();
    const hero = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
    geo.dispose();
    const wall = WALL_TOP * CASTLE_SCALE;
    const walk = WALK * CASTLE_SCALE;
    assert.ok(
      walk > hero * 1.5,
      `ход поверху ${walk.toFixed(2)} при герое ${hero.toFixed(2)} — не над головой`,
    );
    assert.ok(
      wall > walk && wall > hero * 1.8,
      `стена ${wall.toFixed(2)} при герое ${hero.toFixed(2)} — это забор, а не стена`,
    );
  });

  test('потолок роста башни посчитан камерой, а не выбран', () => {
    /**
     * Камера смотрит с фиксированного наклона, и башня прячет за собой полосу
     * земли длиной H · ctg(наклон). Двор самого большого замка — 7 клеток
     * плана, то есть 14 клеток локации; самого малого — 4 плана, 8 локации.
     *
     * Требование, из которого взят потолок: **на верхнем уровне башня ещё
     * помещается в самый большой двор, а следующий уровень не помещается
     * ни в один**. Ни одно из этих чисел не назначено — все меряются.
     */
    const hides = (level: number): number =>
      (towerHeight(level) * CASTLE_SCALE) / Math.tan(ELEVATION);
    const YARD_MAX = 7 * CASTLE_SCALE;
    const YARD_MIN = 4 * CASTLE_SCALE;

    assert.ok(
      hides(TOWER_MAX) <= YARD_MAX,
      `башня ${TOWER_MAX} уровня прячет ${hides(TOWER_MAX).toFixed(1)} клеток — больше двора ${YARD_MAX}`,
    );
    assert.ok(
      hides(TOWER_MAX + 1) > YARD_MAX,
      `башня ${TOWER_MAX + 1} уровня прячет ${hides(TOWER_MAX + 1).toFixed(1)} — потолок занижен`,
    );
    assert.ok(hides(1) < YARD_MIN, 'первый уровень уже закрывает самый малый двор');
  });

  test('тап по верху стены обязан считаться по верху, а не по земле', () => {
    /**
     * Камера смотрит с фиксированного наклона, и площадка на высоте H
     * смещает пересечение луча с землёй на H·ctg(наклон). Правило утверждает
     * не «иногда неточно», а «промах гарантирован»: смещение больше клетки
     * стены целиком, то есть попадание уезжает мимо соседней детали.
     */
    const deck = WALK * CASTLE_SCALE;
    const shift = deck / Math.tan(ELEVATION);
    assert.ok(
      shift > CASTLE_SCALE,
      `смещение ${shift.toFixed(2)} не дотягивает до клетки стены ${CASTLE_SCALE}`,
    );
  });

  test('слоты кладбища не разошлись с палитрой артбука', () => {
    assert.deepEqual([...GRAVEYARD_SLOTS], [...GRAVEYARD_SLOT_ORDER]);
    for (const name of GRAVEYARD_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  /**
   * Ограда — не дешёвая стена, а другая вещь, и разницу видно ростом.
   * Стена замка обязана быть выше головы (правило выше), ограда — **ниже**:
   * через неё видно, и ровно этим она отличается. Оба числа меряются
   * у геометрии, а не берутся из документа: модель может смениться,
   * и правило обязано спорить с новой.
   */
  test('через ограду видно: она ниже стены и не выше человека намного', () => {
    const hero = heroGeometry('archer');
    hero.computeBoundingBox();
    const tall = hero.boundingBox!.max.y - hero.boundingBox!.min.y;
    hero.dispose();

    const wall = WALL_TOP * CASTLE_SCALE;
    for (const material of FENCE_MATERIALS) {
      for (const name of FENCE[material].spans) {
        const geo = fenceGeometry(name as Parameters<typeof fenceGeometry>[0]);
        geo.computeBoundingBox();
        const top = geo.boundingBox!.max.y;
        assert.ok(top < wall, `${name}: ${top.toFixed(2)} — это стена, а не ограда`);
        assert.ok(
          top < tall * 1.35,
          `${name}: ${top.toFixed(2)} при герое ${tall.toFixed(2)} — через неё уже не видно`,
        );
        assert.ok(
          top > tall * 0.7,
          `${name}: ${top.toFixed(2)} при герое ${tall.toFixed(2)} — это бордюр, а не ограда`,
        );
      }
    }
  });

  test('пролёт ограды приходит в клетку локации, а не в единицы набора', () => {
    const geo = fenceGeometry('stone-wall');
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    assert.ok(
      Math.abs(box.max.x - box.min.x - FENCE_SCALE) < 0.02,
      `пролёт шириной ${(box.max.x - box.min.x).toFixed(2)} при клетке ${FENCE_SCALE}`,
    );
    assert.ok(Math.abs(box.min.y) < 0.02, 'основание ограды не на нуле');
  });

  test('каждая часть пяти склепов запечена, а сборные стоят на одном основании', () => {
    for (const style of CRYPT_STYLES) {
      for (const name of [style.body, style.roof, style.door]) {
        if (name === null) continue;
        assert.ok(name in GRAVEYARD_MODELS, `${name}: генератор знает модель, которой нет в бандле`);
      }
      const geo = cryptGeometry(style);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      assert.ok(Math.abs(box.min.y) < 0.02, `${style.body}: склеп висит над землёй`);
      if (style.roof !== null) {
        assert.ok(box.max.y > 2.4 && box.max.y < 2.5, `${style.body}: крыша разошлась с корпусом`);
      }
    }
  });

  test('готовое кладбище укладывается в свой потолок — килобайты', () => {
    const source = readFileSync(new URL('./graveyard.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    // Потолок посчитан, а не выбран: 66 КБ после подключения восьми частей
    // склепов округлены вверх до десятка. Набор закрывает ограды, лес,
    // кладбище, пять силуэтов склепа и противника; следующий рост снова
    // потребует отдельного решения, а не незаметно раздует общий бандл.
    assert.ok(kb <= 70, `набор кладбища: ${kb} КБ gzip > 70 КБ`);
  });

  test('готовый замок укладывается в свой потолок — килобайты', () => {
    const source = readFileSync(new URL('./castle.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    // После второго прохода набор закрывает не только внешнее кольцо, но ещё
    // ров, внутренние укрепления, второй стиль башен и собственное окружение.
    // Фактический размер округлён вверх до десятка; следующий рост снова
    // потребует осознанно поднять этот потолок.
    assert.ok(kb <= 70, `набор замка: ${kb} КБ gzip > 70 КБ`);
  });

  test('геометрия детали приходит в клетку локации, а не в единицы набора', () => {
    const geo = castleGeometry('wall');
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    assert.ok(
      Math.abs(box.max.x - box.min.x - CASTLE_SCALE) < 0.02,
      `стена шириной ${(box.max.x - box.min.x).toFixed(2)} при клетке ${CASTLE_SCALE}`,
    );
    assert.ok(Math.abs(box.min.y) < 0.02, 'основание стены не на нуле');
  });
});

describe('Артбук: палитра', () => {
  /**
   * Цвет берётся из палитры, а не назначается на месте. Исходник читается
   * текстом по той же причине, по какой это делает `scripts/arch.ts`: цвет
   * запечён в вершины при сборке модели, и обратно из геометрии его не достать.
   */
  test('в моделях нет цветов мимо палитры', () => {
    const src = readFileSync(new URL('./models.ts', import.meta.url), 'utf8');
    const palette = new Set(Object.values(C).map((c) => c.toLowerCase()));
    /**
     * Один цвет взят из самого артбука, где он тоже стоит литералом мимо
     * списка, — ткань Лучника. Исключение названо здесь, чтобы оно было
     * видно, а не растворилось среди прочих литералов. Второе исключение,
     * глаза противника, ушло вместе с примитивными врагами: их рисует набор.
     */
    const fromArtbook = new Set(['#35454e']);

    const stray = [...src.matchAll(/'(#[0-9a-fA-F]{6})'/g)]
      .map((m) => m[1]!.toLowerCase())
      .filter((hex) => !palette.has(hex) && !fromArtbook.has(hex));

    assert.deepEqual([...new Set(stray)], [], 'цвет мимо палитры артбука');
  });

  test('палитра — ровно 35 цветов', () => {
    assert.equal(Object.keys(C).length, 35);
  });

  /**
   * Тот же список третьей копией — образцами в `artbook.html`, где он и есть
   * арт-байбл. Сверяются значения, а не подписи: подписи на странице
   * человеческие, в коде короткие, и приводить их друг к другу значило бы
   * завести четвёртый список.
   */
  test('палитра артбука и палитра кода — один список', () => {
    const src = readFileSync(new URL('../../artbook.html', import.meta.url), 'utf8');
    const shown = [...src.matchAll(/\["[^"]+","(#[0-9a-f]{6})"\]/g)].map((m) => m[1]!);
    const code = Object.values(C).map((c) => c.toLowerCase());
    assert.deepEqual([...shown].sort(), [...code].sort(), 'artbook.html и blocking.ts разошлись');
  });

  /**
   * Список цветов один, а имён у него два: короткие латинские ключи, которыми
   * красятся примитивы, и русские имена слотов, которыми красятся готовые
   * наборы. Разойтись они могут молча — и тогда «единая палитра» из §6.1
   * станет двумя палитрами, похожими друг на друга.
   */
  /**
   * Порядок слотов набора живёт в двух местах: его пишет `npm run models`
   * рядом с геометрией и повторяет `palette.ts`, чтобы страницам не приходилось
   * тянуть геометрию ради имён. Расходятся такие пары молча — и тогда набор
   * перекрашивается со сдвигом на слот, а выглядит это как «художник ошибся».
   */
  test('порядок слотов в палитре — тот же, что в запечённом наборе', () => {
    assert.deepEqual([...FOREST_SLOT_ORDER], [...FOREST_SLOTS]);
    assert.deepEqual([...SKELETON_SLOT_ORDER], [...SKELETON_SLOTS]);
    assert.deepEqual([...DUNGEON_SLOT_ORDER], [...DUNGEON_SLOTS]);
  });

  test('цвета примитивов и цвета наборов — один список', () => {
    const primitives = [...new Set(Object.values(C).map((c) => c.toLowerCase()))].sort();
    const slots = [...new Set(Object.values(MATERIAL).map((n) => `#${n.toString(16).padStart(6, '0')}`))].sort();
    assert.deepEqual(slots, primitives);
  });
});
