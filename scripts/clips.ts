/**
 * Обмер набора скелетных анимаций (§6.1: готовые наборы применимы; animation.html —
 * правила, которым клип обязан соответствовать, чтобы попасть в игру).
 *
 * Набор один: KayKit Character Animations 1.1 FREE (CC0, см. assets/LICENSES.md).
 * Он не текстурный и не геометрический — в нём нет ничего, что можно запечь
 * в палитру, как лес и подземелье. Мерить в нём нужно другое: сколько клип
 * длится, замыкается ли он в петлю и с какой скоростью под ним обязана
 * проезжать земля. Последнее — единственный вопрос, на который артбук отвечает
 * числом, а не картинкой: скорость героя закреплена как 1,67 тайла/с (§17.4),
 * и клип либо укладывается в неё скоростью воспроизведения, либо нет.
 *
 * Три замера на клип, и ни один не оценка:
 *
 *   проскальзывание — сколько метров земли проезжает под опорной ногой
 *                     за секунду. Для шага это и есть скорость клипа; для
 *                     стойки — ноль, и различать их вручную не требуется.
 *   петля           — насколько разъезжаются первая и последняя позы. Ноль
 *                     значит «можно зациклить», всё остальное — «нужен переход».
 *   снос корня      — сдвинул ли клип персонажа. animation.html требует, чтобы
 *                     не сдвигал: позицию держит симуляция, клип только рисует.
 *
 * Запуск:
 *   npm run clips            — отчёт: категории, длительности, скорости, петли
 *   npm run clips -- --write — переписать assets/kaykit-animations/catalog.json
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_ATTACK_INTERVAL, HERO_SPEED } from '../src/sim/config';
import {
  Posed,
  bytesOf,
  measureDrift,
  measureLoop,
  measureSlide,
  measureStrike,
  readGlb,
  round,
} from './glb';
import { ENEMY_STATS } from '../src/sim/enemies';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK = 'assets/kaykit-animations';

/**
 * Смешивания из animation.html, 03. В коде их нет: клипы игра пока не играет,
 * и завести им константу негде — но в бюджет они входят, поэтому лежат здесь
 * и названы так же, как в таблице переходов.
 */
const BLEND_IN = 0.06;

/**
 * Конечности, по которым ищется удар. Чем бы персонаж ни бил — мечом, кулаком
 * или ногой, — бьёт он одной из них, и какой именно, решает замер, а не имя
 * клипа: «Kick» в наборе разгоняет руку сильнее, чем ногу.
 */
const LIMBS = ['handslot.r', 'handslot.l', 'foot.r', 'foot.l'];

/**
 * Ниже этого пика конечность не бьёт, а стоит: у стоек набора пик 0,1–0,2,
 * у всего, что заносится, — от 2,2. Порог посреди этого разрыва.
 */
const SWUNG = 1;

/**
 * Короткие подписи для шапки таблицы. Полные имена врагов живут в sim/enemies.ts
 * и берутся оттуда же; здесь только то, что помещается в столбец.
 */
const SHORT: Record<string, string> = {
  scavenger: 'падальщик',
  spearman: 'копейщик',
  golem: 'голем',
};

/**
 * Кто бьёт в игре: у каждого свой замах и свой интервал (§17.3, §15).
 * У героя замаха нет — он не телеграфирует, он бьёт; ему важен только интервал.
 */
const ACTORS = [
  { id: 'герой', name: 'герой', telegraph: 0, interval: HERO_ATTACK_INTERVAL },
  ...Object.values(ENEMY_STATS).map((e) => ({
    id: SHORT[e.kind] ?? e.kind,
    name: e.name,
    telegraph: e.telegraph,
    interval: e.attackInterval,
  })),
];

/**
 * Рост персонажа игры: от подошвы до макушки следопыта (render/models.ts).
 * Набор нарисован в своём масштабе, и сравнивать его скорости с игровыми
 * можно только приведя одно к другому — иначе «медленно» окажется свойством
 * не клипа, а того, что манекен вдвое выше нашего героя.
 */
const HERO_HEIGHT = 1.11;

/**
 * Ниже этого проскальзывание — не ход, а поворот стопы на месте. Порог взят
 * от игры, а не от набора: 0,2 единицы набора — это 0,1 тайла в секунду,
 * шестнадцатая часть скорости героя. За шаг в 600 мс такая земля проезжает
 * шесть сотых клетки, и увидеть это на экране нечем.
 */
const STILL = 0.2;

/** Выше этого расхождение поз — клип не петля, его нельзя гонять по кругу. */
const OPEN = 0.01;

/** Категория — второе слово имени файла: Rig_Medium_CombatMelee → CombatMelee. */
const CATEGORIES: Record<string, string> = {
  MovementBasic: 'Ход',
  MovementAdvanced: 'Манёвры',
  CombatMelee: 'Ближний бой',
  CombatRanged: 'Дальний бой',
  General: 'Общее',
  Tools: 'Инструменты',
  Simulation: 'Быт',
  Special: 'Нежить',
};

/** Порядок категорий в отчёте и в каталоге — от хода к частному. */
const ORDER = Object.keys(CATEGORIES);

const RIGS: Record<string, string> = { Rig_Medium: 'средний', Rig_Large: 'крупный' };

interface Measured {
  readonly name: string;
  readonly rig: string;
  readonly category: string;
  readonly file: string;
  readonly duration: number;
  readonly keys: number;
  readonly joints: number;
  readonly bytes: number;
  /** Метров земли под опорной ногой в секунду — скорость клипа. */
  readonly slide: number;
  /** Расхождение первой и последней позы, в единицах сцены. */
  readonly loop: number;
  /** Сдвиг корня за клип. */
  readonly drift: number;
  /** Момент удара — пик скорости конечности, с. */
  readonly strike: number;
  /** Сам пик, ед./с: ниже SWUNG конечность не бьёт. */
  readonly peak: number;
}

function measureFile(file: string): Measured[] {
  const gltf = readGlb(join(ROOT, PACK, 'gltf', file));
  const stem = file.replace(/\.glb$/, '');
  const [, rig, category] = /^(Rig_[A-Za-z]+)_(.+)$/.exec(stem) ?? [];
  if (rig === undefined || category === undefined) throw new Error(`${file}: имя не разобрано`);

  const index = new Map<string, number>();
  gltf.json.nodes.forEach((n, i) => {
    if (n.name !== undefined) index.set(n.name, i);
  });
  const joints = gltf.json.skins?.[0]?.joints ?? [];
  const toes = ['toes.l', 'toes.r'].map((n) => index.get(n)).filter((n): n is number => n !== undefined);
  const limbs = LIMBS.map((n) => index.get(n)).filter((n): n is number => n !== undefined);
  const root = index.get('root') ?? -1;

  return (gltf.json.animations ?? []).map((anim) => {
    const pose = new Posed(gltf, anim);
    const strike = measureStrike(pose, limbs);
    return {
      name: anim.name,
      rig: RIGS[rig] ?? rig,
      category: CATEGORIES[category] ?? category,
      file,
      // Округление одно на всех: отчёт и каталог обязаны сравнивать с порогом
      // одно и то же число, иначе на границе они расходятся на клип.
      duration: round(pose.duration, 3),
      keys: pose.keys,
      joints: pose.animated,
      bytes: bytesOf(gltf, anim),
      slide: round(measureSlide(pose, toes), 3),
      loop: round(measureLoop(pose, joints), 4),
      drift: round(root < 0 ? 0 : measureDrift(pose, root), 3),
      strike: round(strike.at, 3),
      peak: round(strike.peak, 2),
    };
  });
}

/** Манекен набора: на нём клипы и нарисованы, и его габарит задаёт масштаб. */
function measureRig(file: string): {
  readonly file: string;
  readonly joints: number;
  readonly bones: string[];
  readonly tris: number;
  readonly height: number;
} {
  const gltf = readGlb(join(ROOT, PACK, 'rig', file));
  const skin = gltf.json.skins?.[0];
  let tris = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const mesh of gltf.json.meshes ?? []) {
    for (const p of mesh.primitives) {
      if (p.indices !== undefined) tris += gltf.json.accessors[p.indices]!.count / 3;
      const position = gltf.json.accessors[p.attributes['POSITION']!]!;
      low = Math.min(low, position.min?.[1] ?? Infinity);
      high = Math.max(high, position.max?.[1] ?? -Infinity);
    }
  }
  return {
    file,
    joints: skin?.joints.length ?? 0,
    bones: (skin?.joints ?? []).map((j) => gltf.json.nodes[j]!.name ?? '?'),
    tris,
    height: high - low,
  };
}

/* ---------- отчёт ---------- */

const files = readdirSync(join(ROOT, PACK, 'gltf'))
  .filter((f) => f.endsWith('.glb'))
  .sort();
const rigs = readdirSync(join(ROOT, PACK, 'rig'))
  .filter((f) => f.endsWith('.glb'))
  .sort()
  .map(measureRig);

const all = files.flatMap(measureFile);
/** T-Pose лежит в каждом файле как опора для переноса — это не клип. */
const clips = all.filter((c) => c.name !== 'T-Pose');
const poses = clips.filter((c) => c.duration === 0);
const moving = clips.filter((c) => c.duration > 0);

/**
 * Масштаб набора к игре: манекен приводится к росту нашего героя, и все
 * скорости клипов пересчитываются тем же множителем. Без него сравнение
 * с 1,67 тайла/с сравнивало бы разные метры.
 */
const medium = rigs.find((r) => r.file.includes('Medium')) ?? rigs[0]!;
const scale = HERO_HEIGHT / medium.height;

console.log(`Набор: ${PACK} — ${files.length} файлов, ${clips.length} клипов + ${files.length} T-Pose`);
console.log(
  `Манекены: ${rigs
    .map((r) => `${r.file.replace('.glb', '')} — костей ${r.joints}, ${r.tris} тр., рост ${round(r.height)}`)
    .join('; ')}`,
);
console.log(`Масштаб к игре: рост ${round(medium.height)} → ${HERO_HEIGHT} = ×${round(scale, 3)}\n`);

console.log('категория        оснастка  клипов   сек.  средн.  самый длинный');
for (const category of ORDER) {
  const name = CATEGORIES[category]!;
  for (const rig of Object.values(RIGS)) {
    const list = clips.filter((c) => c.category === name && c.rig === rig);
    if (list.length === 0) continue;
    const total = list.reduce((s, c) => s + c.duration, 0);
    const longest = list.reduce((a, b) => (a.duration > b.duration ? a : b));
    console.log(
      `${name.padEnd(15)} ${rig.padEnd(9)} ${String(list.length).padStart(5)}` +
        ` ${total.toFixed(1).padStart(6)} ${(total / list.length).toFixed(2).padStart(7)}  ${longest.name}`,
    );
  }
}

/**
 * Ход набора против константы игры. Циклы и разовые шаги разделены замером,
 * а не списком имён: цикл — это клип, который замкнулся в петлю и под которым
 * при этом едет земля. Выпад мечом землю тоже двигает, но по кругу его гонять
 * нельзя, и в «сколько раз ускорить, чтобы попасть в 1,67» он не участвует.
 */
const ground = moving.filter((c) => c.slide >= STILL);
const cycles = ground.filter((c) => c.loop <= OPEN).sort((a, b) => b.slide - a.slide);
const lunges = ground.filter((c) => c.loop > OPEN);

console.log(`\nциклы хода: ${cycles.length} из ${moving.length} — петля замкнута, земля едет`);
console.log('клип                              оснастка   длит.  ед./с  тайл/с  темп к 1,67');
for (const c of cycles) {
  const speed = c.slide * scale;
  console.log(
    `${c.name.padEnd(33)} ${c.rig.padEnd(9)} ${c.duration.toFixed(2).padStart(6)}` +
      ` ${c.slide.toFixed(2).padStart(6)} ${speed.toFixed(2).padStart(7)}  ×${(HERO_SPEED / speed).toFixed(2)}`,
  );
}

const fastest = cycles[0];
if (fastest !== undefined) {
  const speed = fastest.slide * scale;
  console.log(
    `\nсамый быстрый цикл ${fastest.name} (${fastest.rig}) даёт ${speed.toFixed(2)} тайла/с — ` +
      `это ×${(HERO_SPEED / speed).toFixed(2)} к константе §17.4. Либо темп, либо рост.`,
  );
}

console.log(
  `\nразовый шаг (земля едет, петля не замкнута): ${lunges.length} — ` +
    lunges.map((c) => c.name).join(', '),
);

/**
 * Бой. Старый бюджет складывал клип целиком со смешиваниями и сравнивал
 * с интервалом атаки — и потому объявлял негодным почти весь набор: у выпада
 * возврат вчетверо длиннее замаха. Возврат в бюджет не входит: таблица
 * переходов сама говорит, что он «ничего не сообщает», а значит его можно
 * оборвать смешиванием в следующее действие.
 *
 * Считается то, что действительно обязано уложиться:
 *   вход + замах ≤ интервал   — удар успевает до следующей атаки;
 *   замах ≥ замах актора      — удар видно заранее (§17.3).
 */
const combat = clips
  .filter((c) => (c.category === 'Ближний бой' || c.category === 'Дальний бой') && c.peak >= SWUNG)
  .sort((a, b) => a.strike - b.strike);

const fits = (c: Measured, actor: (typeof ACTORS)[number]): boolean =>
  c.strike >= actor.telegraph && BLEND_IN + c.strike <= actor.interval;

console.log(`\nбой: ${combat.length} клипов с ударом (пик конечности ≥ ${SWUNG} ед./с)`);
console.log(
  `вход ${BLEND_IN * 1000} мс + замах ≤ интервал актора; замах ≥ замаха актора\n`,
);
console.log(
  `${'клип'.padEnd(33)} ${'замах'.padStart(6)} ${'возврат'.padStart(8)}  ` +
    ACTORS.map((a) => a.id.padStart(10)).join(''),
);
for (const c of combat) {
  console.log(
    `${c.name.padEnd(33)} ${c.strike.toFixed(2).padStart(6)}` +
      ` ${(c.duration - c.strike).toFixed(2).padStart(8)}  ` +
      ACTORS.map((a) => (fits(c, a) ? 'да' : '—').padStart(10)).join(''),
  );
}
console.log('');
for (const actor of ACTORS) {
  const ok = combat.filter((c) => fits(c, actor));
  // Не успевшие называются поимённо: их единицы, и каждый — решение «резать
  // или не брать». Слишком резкие только считаются: для голема это половина
  // набора, и список в тридцать имён ничего не сообщает.
  const late = combat.filter((c) => BLEND_IN + c.strike > actor.interval);
  const rushed = combat.filter((c) => c.strike < actor.telegraph);
  console.log(
    `  ${actor.name.padEnd(18)} годятся ${String(ok.length).padStart(2)} из ${combat.length}` +
      `; интервал ${actor.interval} с, замах ${actor.telegraph} с` +
      (rushed.length > 0 ? `; слишком резких ${rushed.length}` : '') +
      (late.length > 0 ? `; не успевают: ${late.map((c) => c.name).join(', ')}` : ''),
  );
}

const drifting = moving.filter((c) => c.drift > 0.01);
console.log(
  `\nсдвигают корень: ${drifting.length}` +
    (drifting.length > 0
      ? ` (${drifting.map((c) => `${c.name} ${round(c.drift)}`).join(', ')})` +
        '\n  — animation.html, 01: клип не двигает персонажа. Этим нужен разбор или срез корня.'
      : ''),
);

const open = moving.filter((c) => c.loop > OPEN).sort((a, b) => b.loop - a.loop);
console.log(`\nне замыкаются в петлю (расхождение поз > ${OPEN}): ${open.length} из ${moving.length}`);
for (const c of open.slice(0, 12)) console.log(`  ${c.name.padEnd(33)} ${round(c.loop, 3)}`);
if (open.length > 12) console.log(`  … и ещё ${open.length - 12}`);

const bytes = clips.reduce((s, c) => s + c.bytes, 0);
console.log(
  `\nдорожки всех клипов: ${Math.round(bytes / 1024)} КБ сырых float` +
    ` (${Math.round(bytes / 1024 / clips.length)} КБ на клип), поз без движения: ${poses.length}`,
);

/* ---------- каталог ---------- */

if (!process.argv.includes('--write')) {
  console.log('\n(--write не задан: файлы не тронуты)');
} else {
  const catalog = {
    pack: 'KayKit Character Animations 1.1 FREE',
    license: 'CC0',
    heroSpeed: HERO_SPEED,
    heroHeight: HERO_HEIGHT,
    scale: round(scale, 4),
    still: STILL,
    open: OPEN,
    swung: SWUNG,
    blendIn: BLEND_IN,
    actors: ACTORS,
    order: ORDER.map((k) => CATEGORIES[k]!),
    rigs: rigs.map((r) => ({
      name: r.file.replace('.glb', ''),
      joints: r.joints,
      bones: r.bones,
      tris: r.tris,
      height: round(r.height, 3),
    })),
    clips: clips.map((c) => ({
      name: c.name,
      rig: c.rig,
      category: c.category,
      file: c.file,
      duration: c.duration,
      keys: c.keys,
      joints: c.joints,
      bytes: c.bytes,
      slide: c.slide,
      loop: c.loop,
      drift: c.drift,
      strike: c.strike,
      peak: c.peak,
    })),
  };
  const out = join(PACK, 'catalog.json');
  writeFileSync(join(ROOT, out), JSON.stringify(catalog) + '\n', 'utf8');
  console.log(`\nзаписано: ${out}`);
}
