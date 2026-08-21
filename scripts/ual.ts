/**
 * Обмер набора Quaternius «Universal Animation Library» (§6.1; animation.html —
 * правила, которым клип обязан соответствовать, чтобы попасть в игру).
 *
 * Набор пришёл не как пополнение KayKit, а как кандидат со своим скелетом:
 * 65 костей в конвенции Unreal против наших 23 в конвенции KayKit. Клипы
 * в игре ложатся на персонажей по именам костей без ретаргета — поэтому
 * первый и главный замер здесь не скорость и не петля, а совместимость:
 * сколько имён из нашего Rig_Medium набор вообще знает. Ответ решает,
 * библиотека это для сегодняшних персонажей или задел под ретаргет.
 *
 * Наш риг читается из настоящего персонажа (Barbarian.glb), а не из списка
 * в памяти: совпадение имён — факт файла, и мерить его нужно по файлу.
 *
 * Остальные замеры те же, что у clips.ts, тем же кодом (scripts/glb.ts):
 *
 *   проскальзывание — скорость земли под опорной ногой (файл Standard,
 *                     корень выключен — как требует animation.html, 01);
 *   петля           — расхождение первой и последней позы;
 *   снос корня      — в Standard обязан быть нулём; в файле _RM корень
 *                     наоборот несёт правду о скорости клипа, и его ход
 *                     за длительность — авторская скорость, которой
 *                     проскальзывание обязано соответствовать.
 *
 * Запуск:
 *   npm run ual            — отчёт: совместимость, категории, скорости, петли
 *   npm run ual -- --write — переписать assets/quaternius-ual/catalog.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_SPEED } from '../src/sim/config';
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK = 'assets/quaternius-ual';
const STANDARD = 'gltf/UAL1_Standard.glb';
const ROOT_MOTION = 'gltf/UAL1_Standard_RM.glb';

/** Персонаж, по которому меряется совместимость: любой наш, все на Rig_Medium. */
const OUR_CHARACTER = 'assets/kaykit-adventurers/characters/Barbarian.glb';

/** Рост героя игры (render/models.ts) — тот же якорь масштаба, что в clips.ts. */
const HERO_HEIGHT = 1.11;

/** Пороги «стоит/идёт» и «петля/не петля» — те же, что у clips.ts. */
const STILL = 0.2;
const OPEN = 0.01;

/**
 * Конечности, по которым ищется удар. Оружейных слотов у рига нет —
 * бьют кисти и стопы.
 */
const LIMBS = ['hand_l', 'hand_r', 'foot_l', 'foot_r'];

/** Опорные носки рига: ball — подушечка стопы, аналог наших toes. */
const TOES = ['ball_l', 'ball_r'];

/**
 * Категории — по имени клипа: у набора один файл на всё, и второго слова
 * имени файла, которым категоризирует KayKit, здесь не существует.
 * Правила упорядочены: первое совпавшее слово решает.
 */
const CATEGORIES: readonly [RegExp, string][] = [
  [/^(Walk|Jog|Sprint|Swim_Fwd|Crouch_Fwd|Push)/, 'Ход'],
  [/^(Jump|Roll|Crouch_Idle)/, 'Манёвры'],
  [/^(Punch|Sword)/, 'Ближний бой'],
  [/^(Pistol|Spell)/, 'Дальний бой'],
  [/^(Idle|Death|Hit|Dance)/, 'Общее'],
  [/^(Sitting|Interact|PickUp|Fixing|Driving|Swim_Idle)/, 'Быт'],
];
const ORDER = ['Ход', 'Манёвры', 'Ближний бой', 'Дальний бой', 'Общее', 'Быт'];

const categoryOf = (name: string): string =>
  CATEGORIES.find(([re]) => re.test(name))?.[1] ?? 'Прочее';

/* ---------- совместимость рига ---------- */

const bonesOf = (file: string): string[] => {
  const gltf = readGlb(join(ROOT, file));
  const joints = gltf.json.skins?.[0]?.joints ?? [];
  return joints.map((j) => gltf.json.nodes[j]!.name ?? '?');
};

const ours = bonesOf(OUR_CHARACTER);
const theirs = bonesOf(join(PACK, STANDARD));
/**
 * Совпадение — точное: three.js привязывает дорожку к кости по имени,
 * и «Head ≈ head» для него такая же чужая кость, как «pelvis ≈ hips».
 */
const matched = ours.filter((b) => theirs.includes(b));

/* ---------- обмер клипов ---------- */

interface Measured {
  readonly name: string;
  readonly category: string;
  readonly duration: number;
  readonly keys: number;
  readonly joints: number;
  readonly bytes: number;
  readonly slide: number;
  readonly loop: number;
  readonly drift: number;
  readonly strike: number;
  readonly peak: number;
  /** Ход корня в файле _RM за секунду — авторская скорость клипа. */
  readonly rmSpeed: number;
}

const gltf = readGlb(join(ROOT, PACK, STANDARD));
const rm = readGlb(join(ROOT, PACK, ROOT_MOTION));

const index = new Map<string, number>();
gltf.json.nodes.forEach((n, i) => {
  if (n.name !== undefined) index.set(n.name, i);
});
const joints = gltf.json.skins?.[0]?.joints ?? [];
const toes = TOES.map((n) => index.get(n)).filter((n): n is number => n !== undefined);
const limbs = LIMBS.map((n) => index.get(n)).filter((n): n is number => n !== undefined);
const rootNode = index.get('root') ?? -1;

const rmIndex = new Map<string, number>();
rm.json.nodes.forEach((n, i) => {
  if (n.name !== undefined) rmIndex.set(n.name, i);
});
const rmRoot = rmIndex.get('root') ?? -1;
const rmByName = new Map((rm.json.animations ?? []).map((a) => [a.name, a]));

/** Рост манекена — из геометрии, как у clips.ts: сравнивать можно только рост. */
let low = Infinity;
let high = -Infinity;
let tris = 0;
for (const mesh of gltf.json.meshes ?? []) {
  for (const p of mesh.primitives) {
    if (p.indices !== undefined) tris += gltf.json.accessors[p.indices]!.count / 3;
    const position = gltf.json.accessors[p.attributes['POSITION']!]!;
    low = Math.min(low, position.min?.[1] ?? Infinity);
    high = Math.max(high, position.max?.[1] ?? -Infinity);
  }
}
const height = high - low;
const scale = HERO_HEIGHT / height;

const all: Measured[] = (gltf.json.animations ?? []).map((anim) => {
  const pose = new Posed(gltf, anim);
  const strike = measureStrike(pose, limbs);
  const rmAnim = rmByName.get(anim.name);
  const rmDrift = rmAnim === undefined || rmRoot < 0 ? 0 : measureDrift(new Posed(rm, rmAnim), rmRoot);
  return {
    name: anim.name,
    category: categoryOf(anim.name),
    duration: round(pose.duration, 3),
    keys: pose.keys,
    joints: pose.animated,
    bytes: bytesOf(gltf, anim),
    slide: round(measureSlide(pose, toes), 3),
    loop: round(measureLoop(pose, joints), 4),
    drift: round(rootNode < 0 ? 0 : measureDrift(pose, rootNode), 3),
    strike: round(strike.at, 3),
    peak: round(strike.peak, 2),
    rmSpeed: round(pose.duration === 0 ? 0 : rmDrift / pose.duration, 3),
  };
});

/** A_TPose — опора для переноса, не клип; как T-Pose у KayKit. */
const clips = all.filter((c) => c.name !== 'A_TPose');
const moving = clips.filter((c) => c.duration > 0);

/* ---------- отчёт ---------- */

console.log(
  `Набор: ${PACK} — ${clips.length} клипов + A_TPose, манекен ${theirs.length} костей, ` +
    `${tris} тр., рост ${round(height)}`,
);
console.log(`Масштаб к игре: рост ${round(height)} → ${HERO_HEIGHT} = ×${round(scale, 3)}\n`);

console.log(`совместимость с нашим ригом (${OUR_CHARACTER.split('/').pop()}, ${ours.length} костей):`);
console.log(
  `  совпало имён ${matched.length} из ${ours.length}` +
    (matched.length > 0 ? ` — ${matched.join(', ')}` : ''),
);
console.log(
  matched.length < ours.length / 2
    ? '  клипы на наших персонажей по именам НЕ ложатся: без ретаргета набор — библиотека, не замена'
    : '  клипы ложатся по именам',
);

console.log('\nкатегория        клипов   сек.  средн.  самый длинный');
for (const category of [...ORDER, 'Прочее']) {
  const list = clips.filter((c) => c.category === category);
  if (list.length === 0) continue;
  const total = list.reduce((s, c) => s + c.duration, 0);
  const longest = list.reduce((a, b) => (a.duration > b.duration ? a : b));
  console.log(
    `${category.padEnd(15)} ${String(list.length).padStart(6)}` +
      ` ${total.toFixed(1).padStart(6)} ${(total / list.length).toFixed(2).padStart(7)}  ${longest.name}`,
  );
}

const ground = moving.filter((c) => c.slide >= STILL);
const cycles = ground.filter((c) => c.loop <= OPEN).sort((a, b) => b.slide - a.slide);

console.log(`\nциклы хода: ${cycles.length} из ${moving.length} — петля замкнута, земля едет`);
console.log('клип                       длит.  ед./с  тайл/с  темп к 1,67  корень _RM ед./с');
for (const c of cycles) {
  const speed = c.slide * scale;
  console.log(
    `${c.name.padEnd(25)} ${c.duration.toFixed(2).padStart(6)} ${c.slide.toFixed(2).padStart(6)}` +
      ` ${speed.toFixed(2).padStart(7)}  ×${(HERO_SPEED / speed).toFixed(2).padStart(10)}` +
      ` ${c.rmSpeed.toFixed(2).padStart(9)}`,
  );
}

const drifting = moving.filter((c) => c.drift > 0.01);
console.log(
  `\nсдвигают корень (файл Standard): ${drifting.length}` +
    (drifting.length > 0
      ? ` (${drifting.map((c) => `${c.name} ${round(c.drift)}`).join(', ')})`
      : ' — корень чист, как и обещает README набора'),
);

const carried = moving.filter((c) => c.rmSpeed >= STILL * 0.5);
console.log(`несёт корень файл _RM: ${carried.length} — авторская скорость сверяет проскальзывание`);

const open = moving.filter((c) => c.loop > OPEN).sort((a, b) => b.loop - a.loop);
console.log(`\nне замыкаются в петлю (расхождение поз > ${OPEN}): ${open.length} из ${moving.length}`);
for (const c of open.slice(0, 12)) console.log(`  ${c.name.padEnd(25)} ${round(c.loop, 3)}`);
if (open.length > 12) console.log(`  … и ещё ${open.length - 12}`);

const bytes = clips.reduce((s, c) => s + c.bytes, 0);
console.log(
  `\nдорожки всех клипов: ${Math.round(bytes / 1024)} КБ сырых float` +
    ` (${Math.round(bytes / 1024 / clips.length)} КБ на клип)`,
);

/* ---------- ретаргет ---------- */

/**
 * Rig_Medium_UAL.glb — те же клипы, пересаженные на наш риг Blender'ом
 * (scripts/retarget_ual.py). Проверок три, и все — замером, не глазами:
 * имена костей теперь обязаны совпадать все, скорость цикла на нашем
 * скелете обязана остаться скоростью источника (риг уже в масштабе игры,
 * пересчёта нет), петля обязана остаться петлёй.
 */
const RETARGET = 'gltf/Rig_Medium_UAL.glb';

interface Retargeted {
  readonly name: string;
  readonly duration: number;
  readonly slide: number;
  readonly loop: number;
  readonly drift: number;
  readonly bytes: number;
  readonly strike: number;
  readonly peak: number;
}

const measureRetarget = (): Retargeted[] | undefined => {
  let rt: ReturnType<typeof readGlb>;
  try {
    rt = readGlb(join(ROOT, PACK, RETARGET));
  } catch {
    return undefined;
  }
  const names = new Map<string, number>();
  rt.json.nodes.forEach((n, i) => {
    if (n.name !== undefined) names.set(n.name, i);
  });
  const rtBones = (rt.json.skins?.[0]?.joints ?? []).map((j) => rt.json.nodes[j]!.name ?? '?');
  const missing = ours.filter((b) => !rtBones.includes(b));
  console.log(
    `\nретаргет: ${RETARGET} — костей ${rtBones.length}, совпадают с нашим ригом ` +
      `${ours.length - missing.length} из ${ours.length}` +
      (missing.length > 0 ? `; НЕ хватает: ${missing.join(', ')}` : ' — все'),
  );
  const rtToes = ['toes.l', 'toes.r'].map((n) => names.get(n)).filter((n): n is number => n !== undefined);
  // Конечности нашего рига — те же, что у clips.ts: удар ищется и в кисти,
  // и в оружейном слоте, и в стопе.
  const rtLimbs = ['handslot.r', 'handslot.l', 'foot.r', 'foot.l']
    .map((n) => names.get(n))
    .filter((n): n is number => n !== undefined);
  const rtJoints = rt.json.skins?.[0]?.joints ?? [];
  const rtRoot = names.get('root') ?? -1;
  return (rt.json.animations ?? [])
    .filter((a) => a.name !== 'A_TPose')
    .map((anim) => {
      const pose = new Posed(rt, anim);
      const strike = measureStrike(pose, rtLimbs);
      return {
        name: anim.name,
        duration: round(pose.duration, 3),
        slide: round(measureSlide(pose, rtToes), 3),
        loop: round(measureLoop(pose, rtJoints), 4),
        drift: round(rtRoot < 0 ? 0 : measureDrift(pose, rtRoot), 3),
        bytes: bytesOf(rt, anim),
        strike: round(strike.at, 3),
        peak: round(strike.peak, 2),
      };
    });
};

/**
 * Масштаб нашего рига к игре — из каталога KayKit, а не отсюда: ретаргетнутый
 * клип живёт в единицах Rig_Medium (манекен ростом 2,2), и его скорость
 * приводится к тайлам тем же множителем, что у клипов KayKit. Первая версия
 * обмера подписала сырые единицы как «тайла/с» — и совпала с источником
 * случайно, потому что множители 0,5 и 0,607 разошлись как раз на укорочение
 * чиби-ног. Урок в артбуке: сравнивать можно только приведённые метры.
 */
const kay = JSON.parse(
  readFileSync(join(ROOT, 'assets/kaykit-animations/catalog.json'), 'utf8'),
) as { scale: number };

const retargeted = measureRetarget();
if (retargeted === undefined) {
  console.log('\nретаргет: файла нет — scripts/retarget_ual.py его ещё не собирал');
} else {
  const byName = new Map(clips.map((c) => [c.name, c]));
  console.log(`циклы хода на нашем риге (тайла/с — через масштаб KayKit ×${kay.scale}):`);
  console.log('клип                       длит.  тайл/с  у источника  темп к 1,67');
  for (const c of retargeted.filter((c) => c.slide >= STILL && c.loop <= OPEN)) {
    const original = byName.get(c.name);
    const speed = c.slide * kay.scale;
    const was = original === undefined ? 0 : original.slide * scale;
    console.log(
      `${c.name.padEnd(25)} ${c.duration.toFixed(2).padStart(6)} ${speed.toFixed(2).padStart(7)}` +
        ` ${was.toFixed(2).padStart(12)}  ×${(HERO_SPEED / speed).toFixed(2)}`,
    );
  }
  const brokenLoop = retargeted.filter((c) => {
    const original = byName.get(c.name);
    return original !== undefined && original.loop <= OPEN && c.loop > OPEN;
  });
  console.log(
    `петли, разомкнувшиеся при переносе: ${brokenLoop.length}` +
      (brokenLoop.length > 0 ? ` — ${brokenLoop.map((c) => `${c.name} ${c.loop}`).join(', ')}` : ''),
  );
  const rtDrift = retargeted.filter((c) => c.drift > 0.01);
  console.log(`сдвигают корень: ${rtDrift.length}${rtDrift.length > 0 ? ' — ' + rtDrift.map((c) => c.name).join(', ') : ''}`);
  const rtBytes = retargeted.reduce((s, c) => s + c.bytes, 0);
  console.log(`дорожки: ${Math.round(rtBytes / 1024)} КБ (${Math.round(rtBytes / 1024 / retargeted.length)} КБ на клип)`);
}

/* ---------- каталог ---------- */

if (!process.argv.includes('--write')) {
  console.log('\n(--write не задан: файлы не тронуты)');
} else {
  const catalog = {
    pack: 'Quaternius Universal Animation Library 1 [Standard]',
    license: 'CC0',
    files: [STANDARD, ROOT_MOTION],
    heroSpeed: HERO_SPEED,
    heroHeight: HERO_HEIGHT,
    scale: round(scale, 4),
    still: STILL,
    open: OPEN,
    order: ORDER,
    rig: {
      joints: theirs.length,
      bones: theirs,
      tris,
      height: round(height, 3),
    },
    ourRig: { file: OUR_CHARACTER, joints: ours.length, matched },
    clips: clips.map((c) => ({ ...c })),
    retarget:
      retargeted === undefined
        ? undefined
        : { file: RETARGET, scale: kay.scale, clips: retargeted },
  };
  const out = join(PACK, 'catalog.json');
  writeFileSync(join(ROOT, out), JSON.stringify(catalog) + '\n', 'utf8');
  console.log(`\nзаписано: ${out}`);
}
