/**
 * Обмер и запекание готовых наборов моделей (§6.1: «готовые наборы теперь
 * применимы», формат glTF, плоское затенение без текстур, палитра обязательна).
 *
 * Наборов два: KayKit Forest (§6.1.1) и KayKit Dungeon (§6.1.2). Оба раскрашены
 * атласом — это прямо противоречит «нет текстурных ассетов», поэтому цвет
 * снимается с атласа здесь, на запекании: треугольник получает слот палитры,
 * а картинка в игру не едет вовсе. Слот — это индекс, цвет ему назначает
 * render/palette.ts, то есть палитра остаётся одним списком и правится
 * в одном месте.
 *
 * Набор с пустым `adopted` измеряется, но в бандл не едет: каталог и страница
 * артбука есть, запечённой геометрии нет. Это состояние «набор взвешен,
 * решение не принято», а не недоделка.
 *
 * Запуск:
 *   npm run models                    — отчёт: треугольники, габариты, цвета
 *   npm run models -- --pack=dungeon  — то же по одному набору
 *   npm run models -- --write         — переписать каталоги и forest.data.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');

/* ---------- наборы: чем набор описывается ---------- */

/**
 * Насыщенность, ниже которой цвет считается серым, — значение по умолчанию.
 * Серое не участвует в замере диапазонов яркости: у леса это пустое поле
 * атласа под платные варианты, у подземелья — белая ткань и чёрные решётки.
 * И то и другое растянуло бы шкалу градиента на весь диапазон. Набор,
 * у которого серое — материал, а не пустота, задаёт свой порог (`Pack.grey`).
 */
const GREY = 0.08;

interface Ramp {
  readonly id: string;
  readonly title: string;
  /** Ступени градиента: имена слотов палитры, от тёмной к светлой. */
  readonly slots: readonly string[];
  /** Окно оттенка в градусах, [от, до); `от > до` — окно через ноль. */
  readonly hue: readonly [number, number];
  /** Окно насыщенности, [от, до] включительно. */
  readonly sat: readonly [number, number];
  /**
   * Окно яркости, [от, до). Нужно там, где оттенка мало: у скелетов кость
   * и кожа сидят в одном тёплом углу атласа и различаются только светлотой.
   * Без окна они делили бы один градиент, и кость уезжала бы в дерево.
   */
  readonly lum?: readonly [number, number];
}

interface Pack {
  readonly id: string;
  /** Как набор называется в каталоге и в реестре лицензий. */
  readonly title: string;
  readonly dir: string;
  /**
   * Атлас набора — и ответ для моделей, которые своей картинки не называют:
   * у леса так отдана трава, меш без материала. Набор персонажей называет
   * атлас каждой моделью свой, и этому полю там достаётся роль запасного.
   */
  readonly atlas: string;
  /**
   * Папки с моделями внутри `dir`. У первых трёх наборов одна, `gltf`;
   * у персонажей две — реквизит парами .gltf + .bin и сами персонажи по .glb.
   */
  readonly sources?: readonly string[];
  /** Порядок объявления — очерёдность примерки окон: первое подошедшее и берут. */
  readonly ramps: readonly Ramp[];
  /** Нумерация слотов. Отдельно от градиентов: очерёдность примерки и порядок
   *  в палитре — разные вещи, и у подземелья они разошлись. */
  readonly slots: readonly string[];
  /**
   * Откуда берётся шкала яркости градиента: `atlas` — вся картинка, `used` —
   * только те цвета, которые действительно оказались под треугольниками.
   * У леса атлас и есть градиент, у подземелья три четверти картинки не задето
   * ни одной моделью, и шкала по всей картинке врёт.
   */
  readonly range: 'atlas' | 'used';
  /** Куда падает всё, что не попало ни в одно окно, — включая серое. */
  readonly fallback: string;
  readonly categoryOf: (name: string) => string;
  /** Что берёт игра. Пустой список — набор измерен, но в бандл не едет. */
  readonly adopted: readonly string[];
  /** Файл запечённой геометрии; без него набор остаётся каталогом. */
  readonly data?: { readonly file: string; readonly prefix: string; readonly type: string };
  /**
   * Ниже какой насыщенности цвет считается серым и не участвует в замере шкалы.
   * У леса и подземелья серое — пустое поле атласа и белая ткань, и оно шкалу
   * растягивает. У скелетов серое — сталь, полноценный материал набора,
   * поэтому порог там опущен почти до нуля.
   */
  readonly grey?: number;
  /**
   * Поза, в которой обмеряется и запекается скинованная модель. Без неё
   * скелет остаётся в позе привязки — то есть в T-позе, руки в стороны:
   * так набор нарисован, но так он не стоит ни в одном кадре игры.
   */
  readonly pose?: { readonly file: string; readonly clip: string; readonly at: number };
  /**
   * Узлы скелета, мировая матрица которых сохраняется вместе с моделью.
   * Набор держит оружие в отдельном узле `handslot.r`; сохранив его,
   * рендер вкладывает предмет в руку по матрице набора, а не по подобранному
   * на глаз смещению.
   */
  readonly attach?: readonly string[];
}

/**
 * Атлас леса — три градиента (листва, кора, камень) и четвёртый, серый:
 * незакрашенные слоты, из которых платные тарифы делают цветовые варианты.
 * Каждый градиент режется на четыре ступени — это и есть плоское затенение
 * из §6.1: у модели ровно столько цветов, сколько ступеней она задела.
 *
 * Имена ступеней — из палитры артбука (artbook.html, группы «Растительность»,
 * «Земля и дерево», «Камень и соль»). Здесь только имена: hex живёт
 * в render/palette.ts, потому что палитра — один список на игру, а не два.
 */
const FOREST: Pack = {
  id: 'forest',
  title: 'KayKit Forest Nature Pack 1.0 FREE',
  dir: 'assets/kaykit-forest',
  atlas: 'forest_texture.png',
  ramps: [
    { id: 'leaf', title: 'листва', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [60, 170], sat: [GREY, 1] },
    { id: 'bark', title: 'кора', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 60], sat: [GREY, 1] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [170, 330], sat: [GREY, 1] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
  ],
  range: 'atlas',
  fallback: 'stone',
  categoryOf: (name) => name.split('_')[0]!,
  /**
   * Взятое из набора. Список короткий намеренно: запечённая геометрия едет
   * в бандл, и каждая лишняя модель — килобайты у всех игроков, а не файл
   * на диске. Варианты нужны только чтобы соседние камни не были близнецами.
   *
   * Деревьев в вылазке нет и не будет: локация под землёй, там лес не растёт.
   * Деревья стоят вокруг лагеря, который на поляне.
   */
  adopted: [
    'Rock_1_D_Color1',
    'Rock_1_E_Color1',
    'Rock_1_G_Color1',
    'Rock_2_D_Color1',
    'Rock_3_G_Color1',
    'Rock_3_H_Color1',
    'Tree_1_A_Color1',
    'Tree_2_B_Color1',
    'Tree_4_A_Color1',
    'Tree_Bare_2_B_Color1',
  ],
  data: { file: 'src/render/forest.data.ts', prefix: 'FOREST', type: 'Forest' },
};

/** Категория подземелья — по первому слову имени файла набора. */
const DUNGEON_CATEGORIES: Record<string, string> = {
  wall: 'Стены',
  pillar: 'Стены',
  column: 'Стены',
  barrier: 'Стены',
  ceiling: 'Стены',
  floor: 'Полы',
  rubble: 'Полы',
  stairs: 'Лестницы',
  barrel: 'Тара',
  box: 'Тара',
  chest: 'Тара',
  crates: 'Тара',
  keg: 'Тара',
  trunk: 'Тара',
  shelf: 'Тара',
  shelves: 'Тара',
  table: 'Мебель',
  chair: 'Мебель',
  stool: 'Мебель',
  bed: 'Мебель',
  bottle: 'Утварь',
  plate: 'Утварь',
  candle: 'Утварь',
  torch: 'Утварь',
  coin: 'Утварь',
  key: 'Утварь',
  keyring: 'Утварь',
  sword: 'Утварь',
  banner: 'Знамёна',
};

/**
 * Атлас подземелья устроен иначе, чем лесной: это не три ровных градиента,
 * а раскрашенная картинка — 1148 разных цветов оказывается под треугольниками.
 * Поэтому окна заданы и по оттенку, и по насыщенности: золото отличается
 * от дерева не тоном (и то и другое — оранжевое), а тем, что оно вдвое
 * насыщеннее. По той же причине окна пересекаются, и порядок примерки решает:
 * золото раньше дерева, иначе дерево забирает его целиком.
 *
 * Слоты — те же двенадцать, что у леса, и в том же порядке: палитра одна
 * на игру, и второй набор обязан ложиться в неё, а не заводить свою.
 * Тринадцатый, «золото», — единственное, чего в списке слотов нет; цвет для
 * него у игры уже есть (PALETTE.loot), не заведён только слот моделей.
 * Синее и алое сукно знамён в такую палитру не ложится вовсе и уходит
 * в камень — это ответ про геральдику, а не дефект набора.
 */
const DUNGEON: Pack = {
  id: 'dungeon',
  title: 'KayKit Dungeon Pack 1.1 FREE',
  dir: 'assets/kaykit-dungeon',
  atlas: 'dungeon_texture.png',
  ramps: [
    { id: 'gold', title: 'золото', slots: ['золото'], hue: [20, 60], sat: [0.62, 1] },
    { id: 'moss', title: 'зелень', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [60, 200], sat: [0.3, 1] },
    { id: 'wood', title: 'дерево', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 60], sat: [0.3, 1] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [150, 330], sat: [GREY, 0.62] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
    'золото',
  ],
  range: 'used',
  fallback: 'stone',
  categoryOf: (name) => DUNGEON_CATEGORIES[name.split('_')[0]!] ?? 'Прочее',
  /**
   * Пусто, и это решение, а не пропуск: набор измерен, страница есть, в бандл
   * не едет ничего. Что из подземелья заслуживает килобайтов у всех игроков —
   * вопрос к тому дню, когда вылазке понадобится не камень, а предмет.
   */
  adopted: [],
};

/**
 * Третий набор — противники. Разница с первыми двумя не в содержимом,
 * а в устройстве файла: скелеты приходят одним `.glb` со скином, скелетом
 * и встроенным атласом, а клипы лежат отдельно. Отсюда всё, что этот набор
 * добавил инструменту: контейнер GLB, скиннинг, поза из клипа и окно яркости
 * у градиента.
 */
const SKELETON_CATEGORIES: Record<string, string> = {
  Mage: 'Скелеты',
  Minion: 'Скелеты',
  Rogue: 'Скелеты',
  Warrior: 'Скелеты',
  Axe: 'Оружие',
  Blade: 'Оружие',
  Crossbow: 'Оружие',
  Staff: 'Оружие',
  Shield: 'Щиты',
  Arrow: 'Снаряды',
  Quiver: 'Снаряды',
};

/**
 * Атлас скелетов — картинка с запечённой светотенью: 998 цветов под
 * треугольниками там, где у леса было четыре градиента по четыре ступени.
 * Градиентов пять, и один из них заведён не оттенком, а яркостью.
 *
 * Окна, как и у первых двух наборов, не пересекаются. Свечение глаз попадает
 * в то же тёплое окно оттенка, что и кость, и разводит их насыщенность:
 * 0,86 у свечения против 0,42 у самой яркой кости.
 */
const SKELETONS: Pack = {
  id: 'skeletons',
  title: 'KayKit Character Pack: Skeletons 1.1 FREE',
  dir: 'assets/kaykit-skeletons',
  atlas: 'skeleton_texture.png',
  ramps: [
    { id: 'glow', title: 'свечение', slots: ['латунь'], hue: [40, 60], sat: [0.62, 1] },
    /**
     * Нижняя граница насыщенности у кости и дерева — порог серого набора,
     * а не круглое число. Пока она стояла выше, два треугольника цвета
     * `#fbf7f2` (насыщенность 3,6%) не попадали ни в одно окно, падали
     * в запасную сталь и растягивали её шкалу с 0,71 до 0,97 — на шесть
     * тысяч треугольников доспеха оставался один оттенок из трёх.
     */
    {
      id: 'bone', title: 'кость', slots: ['соль-тень', 'соль', 'соль-свет', 'иней'],
      hue: [15, 45], sat: [0.02, 0.6], lum: [0.55, 1.01],
    },
    {
      id: 'wood', title: 'дерево и кожа', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'],
      hue: [15, 45], sat: [0.02, 0.6], lum: [0, 0.55],
    },
    { id: 'cloth', title: 'сукно', slots: ['сукно-тень', 'сукно', 'сукно-свет'], hue: [300, 15], sat: [0.25, 1] },
    { id: 'steel', title: 'сталь', slots: ['металл-тень', 'металл', 'сталь'], hue: [60, 300], sat: [0, 1] },
  ],
  slots: [
    'сукно-тень', 'сукно', 'сукно-свет',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'металл-тень', 'металл', 'сталь',
    'соль-тень', 'соль', 'соль-свет', 'иней',
    'латунь',
  ],
  range: 'used',
  fallback: 'steel',
  /** Серого поля у этого атласа нет: сталь набора и есть почти серое. */
  grey: 0.02,
  /**
   * Клип берётся из соседнего набора анимаций, а не из своего: скелеты
   * приехали с двумя файлами клипов, и оба побайтно совпадают с файлами
   * `kaykit-animations` — тот же риг, те же дорожки. Хранить их дважды значит
   * держать полтора мегабайта одного и того же и две строки в реестре
   * лицензий на один и тот же файл.
   */
  pose: { file: '../kaykit-animations/gltf/Rig_Medium_General.glb', clip: 'Idle_A', at: 0 },
  attach: ['handslot.r'],
  categoryOf: (name) => SKELETON_CATEGORIES[name.split('_')[1]!] ?? 'Прочее',
  /**
   * Трое из четырёх и два предмета — по одному противнику §15 на скелет.
   * Список короткий по той же причине, что у леса, но цена здесь другого
   * порядка: модель набора — пять тысяч треугольников, а не двести.
   * Что взято и чем оплачено — `enemyart.html`.
   *
   * Разбойника не берём: от Воина он отличается капюшоном вместо шлема,
   * а стоит столько же. Четвёртого противника §15 не предусматривает,
   * и брать модель «про запас» — это килобайты у всех игроков за то,
   * чего в игре нет.
   */
  adopted: [
    'Skeleton_Minion',
    'Skeleton_Warrior', 'Skeleton_Axe',
    'Skeleton_Mage', 'Skeleton_Staff',
  ],
  data: { file: 'src/render/skeleton.data.ts', prefix: 'SKELETON', type: 'Skeleton' },
};

/** Категория персонажей — по первому слову имени файла, регистр не в счёт. */
const ADVENTURER_CATEGORIES: Record<string, string> = {
  barbarian: 'Персонажи', knight: 'Персонажи', mage: 'Персонажи',
  ranger: 'Персонажи', rogue: 'Персонажи',
  axe: 'Ближний бой', dagger: 'Ближний бой', sword: 'Ближний бой',
  arrow: 'Стрелковое', bow: 'Стрелковое', crossbow: 'Стрелковое', quiver: 'Стрелковое',
  shield: 'Щиты',
  staff: 'Магия', wand: 'Магия', spellbook: 'Магия',
  mug: 'Прочее', smokebomb: 'Прочее',
};

/**
 * Четвёртый набор — герой, которым играют (§6.1.4). Скелеты добавили
 * инструменту контейнер GLB, скиннинг и позу из клипа; этот добавил одно,
 * и оно структурное: **атлас у набора не один**. У каждого персонажа своя
 * картинка 1024×1024, и модель называет её сама — реквизит ссылкой на соседний
 * файл, персонаж куском внутри своего `.glb`. Шкала яркости при этом остаётся
 * одна на набор: одинаковая кожа обязана попасть в одну ступень, с картинки
 * рыцаря она прочитана или с картинки мага.
 *
 * Слоты — те же имена, что у скелетов, и это не совпадение, а условие: сталь,
 * кость и сукно у живых и у нежити обязаны читаться одинаково. Своё у героев
 * одно — кожа, которой у скелетов не бывает.
 */
const ADVENTURERS: Pack = {
  id: 'adventurers',
  title: 'KayKit Adventurers 2.0 FREE',
  dir: 'assets/kaykit-adventurers',
  /** Запасной: каждая модель набора называет атлас сама, и до него не доходит. */
  atlas: 'barbarian_texture.png',
  sources: ['characters', 'gltf'],
  ramps: [
    // Кожа отличается от дерева не тоном (оба оранжевые) и не насыщенностью
    // (0,31 против 0,44), а яркостью — поэтому окно у неё по третьей оси.
    { id: 'skin', title: 'кожа', slots: ['кожа'], hue: [8, 45], sat: [0.22, 0.62], lum: [0.62, 1.01] },
    { id: 'gold', title: 'латунь', slots: ['латунь'], hue: [35, 65], sat: [0.55, 1] },
    { id: 'moss', title: 'зелень', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [65, 200], sat: [0.35, 1] },
    // Холодное серое — сталь, а не камень. Окно узкое по тону и с потолком
    // насыщенности: всё, что ярче, — уже не металл, а бирюза разбойника.
    { id: 'steel', title: 'сталь', slots: ['металл-тень', 'металл', 'сталь'], hue: [170, 260], sat: [GREY, 0.62] },
    { id: 'wood', title: 'дерево', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 65], sat: [0.28, 1] },
    // Тёплое ненасыщенное делится по яркости: светлое — мех и кость, остальное —
    // сукно. В камень они уходили оба и делали персонажа каменным.
    { id: 'bone', title: 'кость', slots: ['соль-свет'], hue: [300, 70], sat: [GREY, 0.28], lum: [0.55, 1.01] },
    { id: 'cloth', title: 'сукно', slots: ['сукно-тень', 'сукно', 'сукно-свет'], hue: [300, 70], sat: [GREY, 0.28] },
    // Всё остальное — камень: холодное, нейтральное и вовсе бесцветное.
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [0, 360], sat: [GREY, 0.62] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
    'латунь', 'кожа',
    'металл-тень', 'металл', 'сталь',
    'сукно-тень', 'сукно', 'сукно-свет',
    'соль-свет',
  ],
  range: 'used',
  fallback: 'stone',
  /**
   * Клип берётся из набора анимаций, а не из своего: персонажи приехали
   * с теми же двумя файлами, и оба побайтно совпадают с файлами
   * `kaykit-animations` — тот же риг, те же дорожки.
   */
  pose: { file: '../kaykit-animations/gltf/Rig_Medium_General.glb', clip: 'Idle_A', at: 0 },
  attach: ['handslot.r'],
  categoryOf: (name) => ADVENTURER_CATEGORIES[name.split('_')[0]!.toLowerCase()] ?? 'Прочее',
  /**
   * Герой, которым играют с первой вылазки, и то, что у него в руке.
   *
   * Оружие §14 зовётся «Кайло», и кирки в наборе нет — `axe_1handed` взят
   * как ближайшее по чтению: одноручное, с рукоятью в начале координат,
   * 274 треугольника. Это замена палке примитива, а не выбор оружия героя:
   * уровень предмета из Кузницы моделью пока не читается.
   *
   * Остальные пять персонажей и тридцать предметов измерены и ждут: персонаж
   * тяжелее камня в тридцать раз, и «весь набор на всякий случай» тут дороже,
   * чем в лесу.
   */
  adopted: ['Barbarian', 'axe_1handed'],
  data: { file: 'src/render/adventurers.data.ts', prefix: 'ADVENTURERS', type: 'Adventurer' },
};

const PACKS: readonly Pack[] = [FOREST, DUNGEON, SKELETONS, ADVENTURERS];

/* ---------- png ---------- */

interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 байта на пиксель. */
  readonly rgba: Uint8Array;
}

/**
 * Минимальный декодер PNG: 8 бит на канал, без чересстрочности — ровно то,
 * чем являются оба атласа. Внешней зависимости ради двух картинок не берём.
 */
function decodePng(file: string): Image {
  return decodePngBytes(readFileSync(file));
}

/** То же из байтов: у персонажей атлас лежит внутри `.glb`, а не рядом. */
function decodePngBytes(buf: Buffer): Image {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];

  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8]!;
      const colorType = data[9]!;
      if (depth !== 8) throw new Error(`PNG: глубина ${depth}, ожидалось 8`);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6] ?? 0;
      if (channels === 0) throw new Error(`PNG: тип цвета ${colorType} не поддержан`);
      if (data[12] !== 0) throw new Error('PNG: чересстрочный не поддержан');
    } else if (type === 'IDAT') {
      parts.push(Buffer.from(data));
    } else if (type === 'IEND') break;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let read = 0;
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[read++]!;
    const line = new Uint8Array(raw.subarray(read, read + stride));
    read += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 255;
    }
    out.set(line, y * stride);
    prev = line;
  }

  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    rgba[i * 4] = out[s]!;
    rgba[i * 4 + 1] = out[s + (channels >= 3 ? 1 : 0)]!;
    rgba[i * 4 + 2] = out[s + (channels >= 3 ? 2 : 0)]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

/* ---------- glTF ---------- */

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: number[];
  max?: number[];
}
interface Node {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface Skin {
  joints: number[];
  inverseBindMatrices?: number;
}
interface Animation {
  name?: string;
  channels: { sampler: number; target: { node?: number; path: string } }[];
  samplers: { input: number; output: number; interpolation?: string }[];
}
interface Gltf {
  accessors: Accessor[];
  images?: { name?: string; uri?: string; bufferView?: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  nodes?: Node[];
  skins?: Skin[];
  animations?: Animation[];
  scenes?: { nodes: number[] }[];
  scene?: number;
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Файл набора вместе с его буфером: `.gltf` рядом с `.bin` или один `.glb`. */
interface Doc {
  readonly gltf: Gltf;
  readonly bin: Buffer;
  /** Путь файла: по нему ищется атлас, лежащий рядом. */
  readonly file: string;
}

/**
 * Чтение файла модели. Два контейнера одного формата: лес и подземелье
 * отдали `.gltf` с буфером рядом, скелеты — `.glb`, где JSON и буфер лежат
 * кусками в одном файле. Дальше по коду разницы нет.
 */
function loadDoc(file: string): Doc {
  if (!file.endsWith('.glb')) {
    const gltf = JSON.parse(readFileSync(file, 'utf8')) as Gltf;
    const uri = gltf.buffers[0]?.uri;
    if (uri === undefined) throw new Error(`${basename(file)}: буфер без uri`);
    return { gltf, bin: readFileSync(join(file, '..', decodeURIComponent(uri))), file };
  }

  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${basename(file)}: не GLB`);
  let at = 12;
  let gltf: Gltf | undefined;
  let bin: Buffer | undefined;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32LE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === 'JSON') gltf = JSON.parse(data.toString('utf8')) as Gltf;
    else if (type.startsWith('BIN')) bin = Buffer.from(data);
    at += 8 + length;
  }
  if (gltf === undefined || bin === undefined) throw new Error(`${basename(file)}: GLB без чанка`);
  return { gltf, bin, file };
}

function readAccessor(gltf: Gltf, bin: Buffer, index: number): Float64Array {
  const acc = gltf.accessors[index]!;
  const view = gltf.bufferViews[acc.bufferView]!;
  const size = TYPE_SIZE[acc.type]!;
  const compSize = COMPONENT_SIZE[acc.componentType]!;
  const stride = view.byteStride ?? size * compSize;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float64Array(acc.count * size);

  for (let i = 0; i < acc.count; i++) {
    const at = start + i * stride;
    for (let c = 0; c < size; c++) {
      const o = at + c * compSize;
      out[i * size + c] =
        acc.componentType === 5126
          ? bin.readFloatLE(o)
          : acc.componentType === 5125
            ? bin.readUInt32LE(o)
            : acc.componentType === 5123
              ? bin.readUInt16LE(o)
              : bin.readUInt8(o);
    }
  }
  return out;
}

/** Матрица 4×4 по столбцам — как её задаёт glTF. */
type Mat4 = readonly number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/**
 * Собственный трансформ узла. У леса его нет ни у одной модели, у подземелья
 * есть у четырёх — крышка сундука и створка двери вынесены отдельными узлами,
 * чтобы их можно было анимировать. Игнорировать трансформ значит собрать
 * сундук с крышкой внутри ящика, поэтому обмер ходит по сцене, а не по мешам.
 *
 * Кадр клипа, если он задан, заменяет собственный TRS узла: это и есть поза.
 */
function localOf(node: Node, pose?: Pose): Mat4 {
  const frame = node.name === undefined ? undefined : pose?.get(node.name);
  if (node.matrix !== undefined && frame === undefined) return node.matrix;
  const [x, y, z, w] = frame?.r ?? node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = frame?.s ?? node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = frame?.t ?? node.translation ?? [0, 0, 0];
  const rot = [
    1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! + z! * w!), 2 * (x! * z! - y! * w!),
    2 * (x! * y! - z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! + x! * w!),
    2 * (x! * z! + y! * w!), 2 * (y! * z! - x! * w!), 1 - 2 * (x! * x! + y! * y!),
  ];
  return [
    rot[0]! * sx!, rot[1]! * sx!, rot[2]! * sx!, 0,
    rot[3]! * sy!, rot[4]! * sy!, rot[5]! * sy!, 0,
    rot[6]! * sz!, rot[7]! * sz!, rot[8]! * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

/* ---------- поза: клип из отдельного файла ---------- */

/** Переопределение TRS узла по имени — ровно то, чем является кадр клипа. */
type Pose = ReadonlyMap<string, { t?: number[]; r?: number[]; s?: number[] }>;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Кратчайшая дуга между кватернионами. Линейная смесь на резких кадрах
 *  укорачивает кости, и на клипе смерти это видно. */
function slerp(a: number[], b: number[], t: number): number[] {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const to = dot < 0 ? b.map((v) => -v) : b.slice();
  dot = Math.abs(dot);
  if (dot > 0.9995) return a.map((v, i) => lerp(v, to[i]!, t));
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return a.map((v, i) => v * wa + to[i]! * wb);
}

/**
 * Кадр клипа как таблица «имя узла → TRS». Клипы лежат отдельным файлом
 * с манекеном, а не в самой модели: у набора один скелет `Rig_Medium` на всех
 * четверых, и клипы записаны один раз для него. Связывает их имя узла —
 * индексы у манекена и у скелета свои.
 */
function loadPose(file: string, clipName: string, at: number): Pose {
  const { gltf, bin } = loadDoc(file);
  const clip = gltf.animations?.find((a) => a.name === clipName);
  if (clip === undefined) {
    const have = (gltf.animations ?? []).map((a) => a.name).join(', ');
    throw new Error(`${basename(file)}: клипа «${clipName}» нет. Есть: ${have}`);
  }

  const out = new Map<string, { t?: number[]; r?: number[]; s?: number[] }>();
  for (const channel of clip.channels) {
    const node = channel.target.node === undefined ? undefined : gltf.nodes?.[channel.target.node];
    const name = node?.name;
    if (name === undefined) continue;
    const sampler = clip.samplers[channel.sampler]!;
    if (sampler.interpolation === 'CUBICSPLINE') {
      throw new Error(`${basename(file)}: клип ${clipName} в CUBICSPLINE, а он не разобран`);
    }
    const times = readAccessor(gltf, bin, sampler.input);
    const values = readAccessor(gltf, bin, sampler.output);
    const size = values.length / times.length;

    // Кадр слева от времени; за концом клипа берётся последний.
    let i = 0;
    while (i + 1 < times.length && times[i + 1]! <= at) i++;
    const j = Math.min(i + 1, times.length - 1);
    const span = times[j]! - times[i]!;
    const t = span > 0 ? Math.min(1, Math.max(0, (at - times[i]!) / span)) : 0;
    const from = Array.from(values.slice(i * size, i * size + size));
    const to = Array.from(values.slice(j * size, j * size + size));

    const entry = out.get(name) ?? {};
    if (channel.target.path === 'rotation') entry.r = slerp(from, to, t);
    else if (channel.target.path === 'translation') entry.t = from.map((v, k) => lerp(v, to[k]!, t));
    else if (channel.target.path === 'scale') entry.s = from.map((v, k) => lerp(v, to[k]!, t));
    out.set(name, entry);
  }
  return out;
}

interface Mesh {
  /** Треугольники подряд: 9 чисел (три вершины) на треугольник. */
  readonly positions: Float64Array;
  /** UV центра треугольника: 2 числа на треугольник. */
  readonly uvs: Float64Array;
  readonly tris: number;
  readonly verts: number;
  /** Узлов с собственным трансформом — их и ради них ходим по сцене. */
  readonly moved: number;
  /** Скинованных примитивов: у первых двух наборов их нет ни одного. */
  readonly skinned: number;
  /** Мировые матрицы затребованных узлов — из них рендер берёт руку. */
  readonly attach: Record<string, Mat4>;
  /** Атлас, который модель назвала своим. */
  readonly atlas: string;
  readonly atlasImage: Image;
}

/**
 * Атлас модели называет сама модель, а не набор: у первых трёх это всегда одна
 * картинка рядом с файлом, у персонажей — своя на каждого, и у половины набора
 * она упакована внутрь `.glb`. Картинки тяжёлые, поэтому читаются раз на путь.
 */
const atlasCache = new Map<string, Image>();

function atlasOf(doc: Doc, pack: Pack, packDir: string): { name: string; image: Image } {
  const image = doc.gltf.images?.[0];
  const uri = image?.uri ?? (image === undefined ? pack.atlas : undefined);
  if (uri !== undefined) {
    // Модель зовёт атлас соседним файлом, а в репозитории он лежит в корне
    // набора: одна картинка на сотню моделей рядом с каждой не нужна.
    const named = decodeURIComponent(uri);
    const beside = join(doc.file, '..', named);
    const path = existsSync(beside) ? beside : join(packDir, named);
    let decoded = atlasCache.get(path);
    if (decoded === undefined) {
      decoded = decodePng(path);
      atlasCache.set(path, decoded);
    }
    return { name: basename(path), image: decoded };
  }
  if (image?.bufferView === undefined) throw new Error(`${basename(doc.file)}: атлас ни в файле, ни рядом`);
  const key = `${doc.file}#${image.bufferView}`;
  let decoded = atlasCache.get(key);
  if (decoded === undefined) {
    const view = doc.gltf.bufferViews[image.bufferView]!;
    const from = view.byteOffset ?? 0;
    decoded = decodePngBytes(doc.bin.subarray(from, from + view.byteLength));
    atlasCache.set(key, decoded);
  }
  return { name: `${image.name ?? basename(doc.file, '.glb')}.png`, image: decoded };
}

function loadMesh(
  file: string,
  pack: Pack,
  packDir: string,
  pose?: Pose,
  attach: readonly string[] = [],
): Mesh {
  const doc = loadDoc(file);
  const { gltf, bin } = doc;
  const { name: atlas, image: atlasImage } = atlasOf(doc, pack, packDir);

  const positions: number[] = [];
  const uvs: number[] = [];
  let verts = 0;
  let moved = 0;
  let skinned = 0;

  /** Мировая матрица каждого узла: скиннингу нужны все, а не только те,
   *  под которыми висит меш. */
  const world = new Array<Mat4>(gltf.nodes?.length ?? 0).fill(IDENTITY);

  const walk = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    const local = localOf(node, pose);
    if (JSON.stringify(local) !== JSON.stringify(IDENTITY)) moved++;
    world[index] = multiply(parent, local);
    for (const child of node.children ?? []) walk(child, world[index]!);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene !== undefined) for (const root of scene.nodes) walk(root, IDENTITY);

  const put = (m: Mat4, p: readonly number[]): void => {
    for (let c = 0; c < 3; c++) {
      positions.push(m[c]! * p[0]! + m[4 + c]! * p[1]! + m[8 + c]! * p[2]! + m[12 + c]!);
    }
  };

  const takeMesh = (index: number, model: Mat4, skin: number | undefined): void => {
    for (const prim of gltf.meshes[index]!.primitives) {
      const posIndex = prim.attributes['POSITION'];
      const uvIndex = prim.attributes['TEXCOORD_0'];
      if (posIndex === undefined || uvIndex === undefined || prim.indices === undefined) continue;
      const pos = readAccessor(gltf, bin, posIndex);
      const uv = readAccessor(gltf, bin, uvIndex);
      const idx = readAccessor(gltf, bin, prim.indices);
      verts += gltf.accessors[posIndex]!.count;

      /**
       * Скиннинг. Позиции скинованного примитива записаны в пространстве
       * скелета, и собственный трансформ узла с мешем glTF велит
       * игнорировать: положение вершины целиком задают кости.
       */
      const jointsIndex = prim.attributes['JOINTS_0'];
      const weightsIndex = prim.attributes['WEIGHTS_0'];
      let vertexMatrix: ((v: number) => Mat4) | null = null;
      if (skin !== undefined && jointsIndex !== undefined && weightsIndex !== undefined) {
        skinned++;
        const joints = readAccessor(gltf, bin, jointsIndex);
        const weights = readAccessor(gltf, bin, weightsIndex);
        const bones = gltf.skins![skin]!;
        const inverse = bones.inverseBindMatrices === undefined
          ? null
          : readAccessor(gltf, bin, bones.inverseBindMatrices);
        const boneMatrix = bones.joints.map((node, k) => {
          const bind = inverse === null ? IDENTITY : Array.from(inverse.slice(k * 16, k * 16 + 16));
          return multiply(world[node] ?? IDENTITY, bind);
        });
        vertexMatrix = (v: number): Mat4 => {
          const out = new Array<number>(16).fill(0);
          for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k]!;
            if (w === 0) continue;
            const m = boneMatrix[joints[v * 4 + k]!] ?? IDENTITY;
            for (let c = 0; c < 16; c++) out[c] = out[c]! + m[c]! * w;
          }
          return out;
        };
      }

      for (let i = 0; i < idx.length; i += 3) {
        let cu = 0;
        let cv = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx[i + k]!;
          const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
          put(vertexMatrix === null ? model : vertexMatrix(v), p);
          cu += uv[v * 2]!;
          cv += uv[v * 2 + 1]!;
        }
        uvs.push(cu / 3, cv / 3);
      }
    }
  };

  // Второй проход, в порядке сцены. Порядок треугольников — контракт
  // с каталогом: страница артбука раскрашивает их по списку слотов и обязана
  // получить тот же порядок, что получило запекание.
  const collect = (index: number): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    if (node.mesh !== undefined) takeMesh(node.mesh, world[index]!, node.skin);
    for (const child of node.children ?? []) collect(child);
  };

  if (scene === undefined) {
    // Сцены нет — набор отдал голые меши; берём их как есть, без трансформа.
    for (let i = 0; i < gltf.meshes.length; i++) takeMesh(i, IDENTITY, undefined);
  } else {
    for (const root of scene.nodes) collect(root);
  }

  // Узла может не быть, и это нормально: рука есть у скелета, а не у топора.
  const held: Record<string, Mat4> = {};
  for (const name of attach) {
    const index = (gltf.nodes ?? []).findIndex((n) => n.name === name);
    if (index >= 0) held[name] = world[index]!;
  }

  return {
    positions: Float64Array.from(positions),
    uvs: Float64Array.from(uvs),
    tris: uvs.length / 2,
    verts,
    moved,
    skinned,
    attach: held,
    atlas,
    atlasImage,
  };
}

/* ---------- цвет атласа → слот палитры ---------- */

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Оттенок в градусах и насыщенность 0..1 — только чтобы опознать градиент. */
function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue: number;
  if (max === r) hue = ((g - b) / d + 6) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { hue: hue * 60, sat: d / max };
}

/** Ниже какой насыщенности цвет набора считается серым и в шкале не участвует. */
const greyOf = (pack: Pack): number => pack.grey ?? GREY;

/**
 * Какой градиент задет. Окна не пересекаются, поэтому порядок объявления
 * ничего не решает; всё, что мимо окон, — включая серое — идёт в запасной.
 */
function rampOf(pack: Pack, r: number, g: number, b: number): string {
  const { hue, sat } = hueSat(r, g, b);
  const lum = luminance(r, g, b);
  for (const ramp of pack.ramps) {
    if (sat < ramp.sat[0] || sat > ramp.sat[1]) continue;
    if (ramp.lum !== undefined && (lum < ramp.lum[0] || lum >= ramp.lum[1])) continue;
    const [lo, hi] = ramp.hue;
    const inside = lo < hi ? hue >= lo && hue < hi : hue >= lo || hue < hi;
    if (inside) return ramp.id;
  }
  return pack.fallback;
}

/** Цвет атласа в точке UV. В glTF v считается от верхнего края — как строки
 *  в PNG, поэтому переворачивать её не нужно. */
function colorOf(atlas: Image, u: number, v: number): [number, number, number] {
  const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
  const y = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
  const o = (y * atlas.width + x) * 4;
  return [atlas.rgba[o]!, atlas.rgba[o + 1]!, atlas.rgba[o + 2]!];
}

/** Сколько треугольников набора пришлось на каждый цвет атласа. */
type Usage = ReadonlyMap<number, number>;

function usageOf(meshes: readonly Mesh[]): Usage {
  const out = new Map<number, number>();
  for (const mesh of meshes) {
    for (let t = 0; t < mesh.tris; t++) {
      const [r, g, b] = colorOf(mesh.atlasImage, mesh.uvs[t * 2]!, mesh.uvs[t * 2 + 1]!);
      const key = (r << 16) | (g << 8) | b;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Диапазон яркости каждого градиента. Считается либо по всей картинке, либо
 * по одним задетым цветам: у леса атлас и есть градиент, у подземелья это
 * раскрашенная текстура, и незадетые углы растянули бы шкалу так, что
 * настоящее дерево оказалось бы в самой тёмной ступени.
 */
function rampRanges(
  pack: Pack,
  atlases: readonly Image[],
  usage: Usage | undefined,
): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const r of pack.ramps) out[r.id] = { min: 1, max: 0 };
  const take = (r: number, g: number, b: number): void => {
    if (hueSat(r, g, b).sat < greyOf(pack)) return;
    const band = out[rampOf(pack, r, g, b)]!;
    const l = luminance(r, g, b);
    if (l < band.min) band.min = l;
    if (l > band.max) band.max = l;
  };
  if (usage === undefined) {
    for (const atlas of atlases) {
      for (let i = 0; i < atlas.width * atlas.height; i++) {
        take(atlas.rgba[i * 4]!, atlas.rgba[i * 4 + 1]!, atlas.rgba[i * 4 + 2]!);
      }
    }
  } else {
    for (const key of usage.keys()) take((key >> 16) & 255, (key >> 8) & 255, key & 255);
  }
  return out;
}

interface Sampler {
  /** Слот по точке атласа — так спрашивает запекание. */
  slotOf(atlas: Image, u: number, v: number): number;
  /** Слот по цвету — так спрашивает каталог, у которого UV уже нет. */
  slotOfColor(r: number, g: number, b: number): number;
  colorAt(atlas: Image, u: number, v: number): [number, number, number];
}

/**
 * Шкала яркости у набора одна на все его атласы. Это и есть смысл палитры:
 * одинаковая кожа обязана попасть в одну ступень, с картинки рыцаря она
 * прочитана или с картинки мага.
 */
function makeSampler(pack: Pack, atlases: readonly Image[], usage: Usage | undefined): Sampler {
  const ranges = rampRanges(pack, atlases, usage);
  const index = new Map(pack.slots.map((s, i) => [s, i]));

  const slotOfColor = (r: number, g: number, b: number): number => {
    const ramp = pack.ramps.find((x) => x.id === rampOf(pack, r, g, b))!;
    const steps = ramp.slots.length;
    const { min, max } = ranges[ramp.id]!;
    const t = max > min ? (luminance(r, g, b) - min) / (max - min) : 0;
    const step = Math.min(steps - 1, Math.max(0, Math.round(t * (steps - 1))));
    return index.get(ramp.slots[step]!)!;
  };

  return {
    colorAt: (atlas, u, v) => colorOf(atlas, u, v),
    slotOfColor,
    slotOf(atlas, u, v) {
      const [r, g, b] = colorOf(atlas, u, v);
      return slotOfColor(r, g, b);
    },
  };
}

/* ---------- запекание ---------- */

interface Baked {
  readonly name: string;
  /** Путь внутри набора: страница артбука читает ту же геометрию отсюда. */
  readonly file: string;
  readonly category: string;
  readonly tris: number;
  readonly verts: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
  /** Позиции, 16 бит на ось в габаритах модели: 9 чисел на треугольник. */
  readonly pos: Int16Array;
  /** Слот палитры, один байт на треугольник. */
  readonly slot: Uint8Array;
  /** Треугольники, попавшие в серое поле атласа. */
  readonly grey: number;
  /** Узлов с собственным трансформом. */
  readonly moved: number;
  /** Скинованных примитивов — то есть модель пришла со скелетом. */
  readonly skinned: number;
  /** Мировые матрицы затребованных узлов, в единицах набора. */
  readonly attach: Record<string, Mat4>;
}

function bake(pack: Pack, name: string, file: string, mesh: Mesh, sampler: Sampler): Baked {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const value = mesh.positions[i + c]!;
      if (value < min[c]!) min[c] = value;
      if (value > max[c]!) max[c] = value;
    }
  }

  const pos = new Int16Array(mesh.tris * 9);
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const t = span[c]! > 0 ? (mesh.positions[i + c]! - min[c]!) / span[c]! : 0;
      pos[i + c] = Math.round(t * 65534) - 32767;
    }
  }

  const slot = new Uint8Array(mesh.tris);
  let grey = 0;
  for (let t = 0; t < mesh.tris; t++) {
    const u = mesh.uvs[t * 2]!;
    const v = mesh.uvs[t * 2 + 1]!;
    slot[t] = sampler.slotOf(mesh.atlasImage, u, v);
    const c = sampler.colorAt(mesh.atlasImage, u, v);
    if (hueSat(c[0], c[1], c[2]).sat < greyOf(pack)) grey++;
  }

  return {
    name,
    file,
    category: pack.categoryOf(name),
    tris: mesh.tris,
    verts: mesh.verts,
    min,
    max,
    pos,
    slot,
    grey,
    moved: mesh.moved,
    skinned: mesh.skinned,
    attach: mesh.attach,
  };
}

const b64 = (data: Int16Array | Uint8Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

function writeData(pack: Pack, models: Baked[]): string {
  const data = pack.data!;
  const chosen = pack.adopted.map((name) => {
    const m = models.find((x) => x.name === name);
    if (m === undefined) throw new Error(`в наборе нет модели ${name}`);
    return m;
  });

  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const held = [...new Set(chosen.flatMap((m) => Object.keys(m.attach)))].sort();
  const body = chosen
    .map((m) => {
      const fields = [
        `    tris: ${m.tris},`,
        `    min: [${m.min.map(round).join(', ')}],`,
        `    max: [${m.max.map(round).join(', ')}],`,
        `    pos: '${b64(m.pos)}',`,
        `    slot: '${b64(m.slot)}',`,
      ];
      for (const name of held) {
        const matrix = m.attach[name];
        if (matrix !== undefined) fields.push(`    hand: [${matrix.map(round).join(', ')}],`);
      }
      return `  '${m.name}': {\n${fields.join('\n')}\n  },`;
    })
    .join('\n');

  const hand = held.length === 0
    ? ''
    : `
  /**
   * Мировая матрица узла ${held.join(', ')} в позе запекания и в единицах
   * набора: столбцами, как её задаёт glTF. Предмет, умноженный на неё,
   * оказывается в руке — там, где его держит сам набор.
   */
  readonly hand?: readonly number[];
`;

  return `/* СГЕНЕРИРОВАНО \`npm run models -- --write\`. Руками не править. */

/**
 * Геометрия принятых моделей набора ${pack.title} (CC0, см. assets/LICENSES.md),
 * запечённая по §6.1: без текстур, цвет — слот палитры на треугольник.
 * Позиции упакованы в 16 бит на ось в габаритах модели (min/max).
 */
export interface ${data.type}Model {
  readonly tris: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 9 чисел на треугольник, три несклеенные вершины. */
  readonly pos: string;
  /** base64 Uint8Array: индекс в ${data.prefix}_SLOTS, один на треугольник. */
  readonly slot: string;
${hand}}

/** Порядок слотов — контракт с render/palette.ts. */
export const ${data.prefix}_SLOTS = [
${pack.slots.map((s) => `  '${s}',`).join('\n')}
] as const;

export const ${data.prefix}_MODELS = {
${body}
} satisfies Record<string, ${data.type}Model>;

export type ${data.type}ModelName = keyof typeof ${data.prefix}_MODELS;
`;
}

/**
 * Каталог для страницы артбука: геометрию она берёт из самих .gltf, а отсюда —
 * числа и разметку цветов, чтобы не повторять запекание вторым кодом.
 */
function writeCatalog(
  pack: Pack,
  atlases: readonly { name: string; image: Image }[],
  sampler: Sampler,
  models: Baked[],
  usage: Usage | undefined,
): string {
  return JSON.stringify({
    pack: pack.title,
    license: 'CC0',
    // Атласов может быть несколько: у персонажей своя картинка на каждого,
    // и страница обязана показывать их числом, а не одним «атлас 1024×1024».
    atlases: atlases.map((a) => ({ file: a.name, width: a.image.width, height: a.image.height })),
    slots: pack.slots,
    ramps: pack.ramps.map((r) => ({
      id: r.id,
      title: r.title,
      slots: r.slots,
      // Цвет из атласа, который лёг в каждую ступень: это и есть «было → стало».
      // Голоса считаются там же, где и шкала: по картинке или по задетому.
      source: r.slots.map((_, i) => {
        const target = pack.slots.indexOf(r.slots[i]!);
        let best: [number, number, number] = [0, 0, 0];
        let bestCount = 0;
        const counts = new Map<string, number>();
        const vote = (c: [number, number, number], weight: number): void => {
          // Серое поле не участвует: большинством голосов оно выиграло бы
          // у настоящих цветов градиента.
          if (hueSat(c[0], c[1], c[2]).sat < greyOf(pack)) return;
          if (rampOf(pack, c[0], c[1], c[2]) !== r.id) return;
          const key = c.join(',');
          const n = (counts.get(key) ?? 0) + weight;
          counts.set(key, n);
          if (n > bestCount) {
            bestCount = n;
            best = c;
          }
        };
        if (usage === undefined) {
          for (const { image } of atlases) {
            for (let y = 0; y < image.height; y += 2) {
              for (let x = 0; x < image.width; x += 2) {
                const u = (x + 0.5) / image.width;
                const v = (y + 0.5) / image.height;
                if (sampler.slotOf(image, u, v) !== target) continue;
                vote(sampler.colorAt(image, u, v), 1);
              }
            }
          }
        } else {
          for (const [key, tris] of usage) {
            const c: [number, number, number] = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
            if (sampler.slotOfColor(c[0], c[1], c[2]) !== target) continue;
            vote(c, tris);
          }
        }
        return `#${best.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      }),
    })),
    adopted: pack.adopted,
    // Поза, в которой набор обмерен: без неё числа относятся к позе привязки,
    // то есть к T-позе, и габарит врёт на размах рук.
    ...(pack.pose === undefined ? {} : { pose: pack.pose }),
    // Сколько картинки набор вообще трогает: страница объясняет этим, почему
    // шкала градиента считается по задетому, а не по атласу.
    ...(usage === undefined
      ? {}
      : {
          touched: (() => {
            const all = new Map<number, number>();
            let total = 0;
            for (const { image } of atlases) {
              total += image.width * image.height;
              for (let i = 0; i < image.width * image.height; i++) {
                const key = (image.rgba[i * 4]! << 16) | (image.rgba[i * 4 + 1]! << 8) | image.rgba[i * 4 + 2]!;
                all.set(key, (all.get(key) ?? 0) + 1);
              }
            }
            let hit = 0;
            for (const [key, n] of all) if (usage.has(key)) hit += n;
            return {
              colors: usage.size,
              atlasColors: all.size,
              share: Math.round((hit / total) * 1000) / 1000,
            };
          })(),
        }),
    // Потолки, чтобы отчёт в консоли и страница артбука брали их из одного места.
    budgets: { hero: HERO_BUDGET, model: BUDGET },
    models: models.map((m) => ({
      name: m.name,
      file: m.file,
      category: m.category,
      tris: m.tris,
      verts: m.verts,
      size: [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]].map(
        (v) => Math.round(v * 100) / 100,
      ),
      // Модель со скелетом читается иначе: страница обязана уметь показать,
      // что габарит снят с позы, а не с того, как модель лежит в файле.
      ...(m.skinned > 0 ? { skinned: m.skinned } : {}),
      ...(Object.keys(m.attach).length === 0
        ? {}
        : { attach: Object.fromEntries(
            Object.entries(m.attach).map(([k, v]) => [k, v.map((x) => Math.round(x * 1000) / 1000)]),
          ) }),
      slot: b64(m.slot),
    })),
  });
}

/* ---------- отчёт ---------- */

// §6.1 задаёт бюджеты герою, врагу и зданию. Окружению бюджета не было —
// его и меряем: сравнивать окружение с героем нечестно, но потолок нужен.
const BUDGET = 1500;

/** §6.1: «герой ≤ 900 треугольников» — единственный потолок, заданный не нами. */
const HERO_BUDGET = 900;

function report(pack: Pack, write: boolean): void {
  const dir = join(ROOT, pack.dir);
  const files = (pack.sources ?? ['gltf']).flatMap((source) =>
    readdirSync(join(dir, source))
      .filter((f) => f.endsWith('.gltf') || f.endsWith('.glb'))
      .sort()
      .map((f) => join(dir, source, f)),
  );

  if (files.length === 0) {
    console.error(`Набор не найден: ${dir}`);
    process.exit(1);
  }

  // Поза читается один раз на набор: клип общий для всех четверых скелетов,
  // потому что скелет у них тоже один.
  const pose = pack.pose === undefined
    ? undefined
    : loadPose(join(dir, pack.pose.file), pack.pose.clip, pack.pose.at);

  // Два прохода: сначала геометрия, потом цвет. Шкала градиента может зависеть
  // от того, что набор задел, а это известно только после чтения всех моделей.
  const meshes = files.map((f) => ({
    name: basename(f).replace(/\.(gltf|glb)$/, ''),
    rel: f.slice(dir.length + 1),
    mesh: loadMesh(f, pack, dir, pose, pack.attach),
  }));
  // Атласы — те, которые назвали сами модели, в порядке первого упоминания.
  const atlases: { name: string; image: Image }[] = [];
  for (const m of meshes) {
    if (!atlases.some((a) => a.name === m.mesh.atlas)) {
      atlases.push({ name: m.mesh.atlas, image: m.mesh.atlasImage });
    }
  }
  const images = atlases.map((a) => a.image);
  const usage = pack.range === 'used' ? usageOf(meshes.map((m) => m.mesh)) : undefined;
  const sampler = makeSampler(pack, images, usage);
  const models = meshes.map((m) => bake(pack, m.name, m.rel, m.mesh, sampler));
  const slots = pack.slots;


  const byCategory = new Map<string, Baked[]>();
  for (const m of models) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  const atlasLine = atlases.length === 1
    ? `атлас ${images[0]!.width}×${images[0]!.height}`
    : `${atlases.length} атласа по ${images[0]!.width}×${images[0]!.height}`;
  console.log(`\n${pack.title}: ${models.length} моделей, ${atlasLine}\n`);
  console.log('категория   моделей  треугольников   средн.   макс.  самая тяжёлая');
  for (const [cat, list] of [...byCategory].sort()) {
    const total = list.reduce((s, m) => s + m.tris, 0);
    const worst = list.reduce((a, b) => (a.tris > b.tris ? a : b));
    console.log(
      `${cat.padEnd(11)} ${String(list.length).padStart(5)} ${String(total).padStart(14)}` +
        ` ${String(Math.round(total / list.length)).padStart(8)} ${String(worst.tris).padStart(7)}  ${worst.name}`,
    );
  }

  const totalTris = models.reduce((s, m) => s + m.tris, 0);
  console.log(`\nвсего треугольников: ${totalTris}`);

  // Куда легли цвета: если набор массово падает в один слот, палитра врёт.
  const perSlot = new Array<number>(slots.length).fill(0);
  for (const m of models) for (const s of m.slot) perSlot[s] = perSlot[s]! + 1;
  console.log('\nтреугольников по слотам палитры:');
  for (const ramp of pack.ramps) {
    const parts = ramp.slots.map((name) => {
      const share = ((perSlot[slots.indexOf(name)]! / totalTris) * 100).toFixed(1);
      return `${name} ${share}%`;
    });
    console.log(`  ${ramp.title.padEnd(8)} ${parts.join(' · ')}`);
  }

  const grey = models.reduce((s, m) => s + m.grey, 0);
  console.log(
    `\nв сером поле атласа (насыщенность ниже ${greyOf(pack) * 100}%): ${grey} треугольников` +
      ` — ${((grey / totalTris) * 100).toFixed(1)}%`,
  );

  const moved = models.filter((m) => m.moved > 0);
  const movedNames = moved.length > 6 ? `${moved.length} моделей` : moved.map((m) => m.name).join(', ');
  console.log(
    `узлов с собственным трансформом: ${moved.reduce((s, m) => s + m.moved, 0)}` +
      (moved.length > 0 ? ` (${movedNames})` : ''),
  );

  const skinned = models.filter((m) => m.skinned > 0);
  if (skinned.length > 0) {
    const held = models.filter((m) => Object.keys(m.attach).length > 0).length;
    console.log(
      `со скелетом: ${skinned.length} моделей, поза — ${pack.pose?.clip ?? 'привязки'}` +
        `; узел для предмета найден у ${held}`,
    );
  }

  const over = models.filter((m) => m.tris > BUDGET);
  console.log(
    `\nтяжелее ${BUDGET} треугольников: ${over.length}` +
      (over.length > 0 ? ` (${over.map((m) => `${m.name} ${m.tris}`).join(', ')})` : ''),
  );

  if (pack.adopted.length === 0) {
    console.log('\nберёт игра: ничего — набор измерен, в бандл не едет (§6.1.2)');
  } else {
    const adopted = models.filter((m) => pack.adopted.includes(m.name));
    const adoptedTris = adopted.reduce((s, m) => s + m.tris, 0);
    const bytes = adopted.reduce((s, m) => s + m.pos.byteLength + m.slot.byteLength, 0);
    console.log(
      `\nберёт игра: ${adopted.length} моделей, ${adoptedTris} треугольников, ` +
        `${Math.round((bytes / 1024) * 10) / 10} КБ в бандле (base64 ≈ ${Math.round((bytes * 1.34) / 1024)} КБ)`,
    );
  }

  if (!write) return;

  const written: string[] = [];
  if (pack.data !== undefined && pack.adopted.length > 0) {
    writeFileSync(join(ROOT, pack.data.file), writeData(pack, models), 'utf8');
    written.push(pack.data.file);
  }
  const catalog = join(pack.dir, 'catalog.json');
  writeFileSync(join(ROOT, catalog), writeCatalog(pack, atlases, sampler, models, usage), 'utf8');
  written.push(catalog);
  console.log(`\nзаписано: ${written.join(', ')}`);
}

const write = process.argv.includes('--write');
const only = process.argv.find((a) => a.startsWith('--pack='))?.slice('--pack='.length);
const chosen = only === undefined ? PACKS : PACKS.filter((p) => p.id === only);

if (chosen.length === 0) {
  console.error(`Набора «${only}» нет. Есть: ${PACKS.map((p) => p.id).join(', ')}`);
  process.exit(1);
}

for (const pack of chosen) report(pack, write);

if (!write) console.log('\n(--write не задан: файлы не тронуты)');
