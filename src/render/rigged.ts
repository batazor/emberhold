import * as THREE from 'three';
import { bakedGeometry, decode } from './baked';
import type { Fit, Part } from './baked';
import { RIG_BIND, RIG_BONES, RIG_CLIPS, RIG_PARENT } from './rig.data';
import type { RigClipName } from './rig.data';

/**
 * Проигрыватель скелетной анимации (§17). Загрузчика glTF в игре по-прежнему
 * нет: скелет, веса и дорожки уже разложены `npm run models`, и здесь из них
 * собираются `THREE.Skeleton`, `SkinnedMesh` и `AnimationClip` — то есть
 * three делает скиннинг на видеокарте, а не мы в цикле.
 *
 * Модуль общий, а не «скелетный»: и противники, и герой стоят на одном риге
 * `Rig_Medium`, поэтому клипы у них одни и те же, а платит каждый набор только
 * за свой скин.
 *
 * Геометрия и материал у особей общие, **скелет — свой**: пять противников
 * с одним скелетом махали бы одновременно.
 */
export type { RigClipName };

/** Состояния §17.1 и как каждое себя ведёт. */
const STATE = {
  'покой': { loop: true },
  'ходьба': { loop: true },
  'удар': { loop: false },
  'урон': { loop: false },
  'падение': { loop: false, hold: true },
  // §14.3 — натяжение держит последний кадр: лук остаётся натянутым, пока
  // не придёт выстрел. Отпустить его самому означало бы показать выстрел,
  // которого не было.
  'натяжение': { loop: false, hold: true },
  'выстрел': { loop: false },
  'блок': { loop: false },
  // §15 — подъём играется один раз на пробуждение и переходит в покой сам.
  'подъём': { loop: false },
  // Знакомство у прогалины. «Присесть» держит последний кадр по той же
  // причине, что натяжение: отпустить его самому значило бы показать
  // вставание, которого не было. «Встаёт» переходит в покой сам — дальше
  // поселенец идёт.
  'присесть': { loop: false, hold: true },
  'сидит': { loop: true },
  'встаёт': { loop: false },
} as const satisfies Record<RigClipName, { loop: boolean; hold?: boolean }>;

/** §17.1 — переходы смешиванием, а не подменой: резкая смена читается как сбой. */
const BLEND = 0.12;

const bind = new Float32Array(decode(RIG_BIND).buffer);

/** Дерево костей в позе привязки. Новое на каждую особь. */
function makeBones(): THREE.Bone[] {
  const bones = RIG_BONES.map((name, at) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(bind[at * 10]!, bind[at * 10 + 1]!, bind[at * 10 + 2]!);
    bone.quaternion.set(bind[at * 10 + 3]!, bind[at * 10 + 4]!, bind[at * 10 + 5]!, bind[at * 10 + 6]!);
    bone.scale.set(bind[at * 10 + 7]!, bind[at * 10 + 8]!, bind[at * 10 + 9]!);
    return bone;
  });
  bones.forEach((bone, at) => {
    const up = RIG_PARENT[at]!;
    if (up >= 0) bones[up]!.add(bone);
  });
  // Мировые матрицы позы привязки — руками: three обновляет их на отрисовке,
  // а обратные матрицы `THREE.Skeleton` выводит из них прямо в конструкторе.
  // Без этого он выводит их из единичных, скин остаётся в позе набора и по нему
  // едут кости — руки уходят в тело, ноги в пол.
  bones[0]!.updateMatrixWorld(true);
  return bones;
}

const clips = new Map<RigClipName, THREE.AnimationClip>();

/**
 * Клип three из запечённых дорожек. Кватернионы лежат долями единицы,
 * сдвиги — долями `move`: и то, и другое разворачивается здесь один раз
 * на игру, а не на каждую особь.
 */
function clipOf(name: RigClipName): THREE.AnimationClip {
  const found = clips.get(name);
  if (found !== undefined) return found;

  const source = RIG_CLIPS[name];
  const bone = decode(source.bone);
  const path = decode(source.path);
  const count = new Uint16Array(decode(source.count).buffer);
  const time = new Uint16Array(decode(source.time).buffer);
  const value = new Int16Array(decode(source.value).buffer);

  const tracks: THREE.KeyframeTrack[] = [];
  let timeAt = 0;
  let valueAt = 0;
  for (let c = 0; c < bone.length; c++) {
    const keys = count[c]!;
    const size = path[c] === 1 ? 4 : 3;
    const times = new Float32Array(keys);
    for (let k = 0; k < keys; k++) times[k] = time[timeAt + k]! / 1000;
    const values = new Float32Array(keys * size);
    const scale = path[c] === 1 ? 1 / 32767 : source.move / 32767;
    for (let k = 0; k < keys * size; k++) values[k] = value[valueAt + k]! * scale;
    timeAt += keys;
    valueAt += keys * size;

    const target = RIG_BONES[bone[c]!]!;
    tracks.push(path[c] === 1
      ? new THREE.QuaternionKeyframeTrack(`${target}.quaternion`, times, values)
      : new THREE.VectorKeyframeTrack(`${target}.position`, times, values));
  }

  const clip = new THREE.AnimationClip(name, source.duration, tracks);
  clips.set(name, clip);
  return clip;
}

/** Узлы рук набора. Их два, и оба живут на одном риге (§14.2). */
export type HandSlot = 'handslot.r' | 'handslot.l';

/** Что нужно, чтобы поставить особь: тело со скином, предметы в руки и рост. */
export interface RiggedParts {
  /** Вершины в единицах набора: приводит их трансформ, а не правка вершин. */
  readonly body: THREE.BufferGeometry;
  /**
   * Что в какой руке. Карта, а не одно поле: §14.2 отдаёт левую руку под
   * щит, факел или вторую половину лука, и «предмет» в единственном числе
   * этот выбор попросту не выражает.
   */
  readonly hold?: Partial<Record<HandSlot, THREE.BufferGeometry>>;
  readonly fit: Fit;
}

/**
 * Геометрия со скином. `bakedGeometry` собирает позиции и цвет, здесь к ним
 * добавляются кости и веса: three ждёт по четыре на вершину, в наборе их три,
 * а третий вес выводится — сумма равна единице.
 */
export function skinnedGeometry(parts: readonly Part[]): THREE.BufferGeometry {
  const geometry = bakedGeometry(parts);
  const verts = parts.reduce((sum, p) => sum + p.model.verts, 0);
  const index = new Uint16Array(verts * 4);
  const weight = new Float32Array(verts * 4);
  let at = 0;

  for (const part of parts) {
    const bone = part.model.bone === undefined ? null : decode(part.model.bone);
    const packed = part.model.weight === undefined ? null : decode(part.model.weight);
    for (let v = 0; v < part.model.verts; v++) {
      if (bone === null || packed === null) {
        weight[(at + v) * 4] = 1;
        continue;
      }
      const first = packed[v * 2]! / 255;
      const second = packed[v * 2 + 1]! / 255;
      const third = Math.max(0, 1 - first - second);
      const w = [first, second, third];
      for (let k = 0; k < 3; k++) {
        index[(at + v) * 4 + k] = bone[v * 3 + k]!;
        weight[(at + v) * 4 + k] = w[k]!;
      }
    }
    at += part.model.verts;
  }

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
  return geometry;
}

/** Особь: свой скелет, свой проигрыватель, общая геометрия. */
export class Rigged {
  /** Что ставит в сцену вызывающий: положение и поворот — его дело. */
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly bones: THREE.Bone[];
  private readonly skeleton: THREE.Skeleton;
  private current: RigClipName | null = null;
  private action: THREE.AnimationAction | null = null;
  private readonly skins: THREE.Mesh[] = [];
  /** Что сейчас в руках. Нужно, чтобы предмет можно было сменить, не собирая
   *  особь заново: §14.2 разрешает перекладывать левую руку перед выходом. */
  private readonly hands = new Map<HandSlot, THREE.Mesh>();

  constructor(parts: RiggedParts, material: THREE.Material) {
    this.bones = makeBones();
    // Обратные матрицы three выводит из позы костей сам — но только если поза
    // уже посчитана в мировых координатах, чем и занят `makeBones`.
    this.skeleton = new THREE.Skeleton(this.bones);

    const mesh = new THREE.SkinnedMesh(parts.body, material);
    mesh.castShadow = true;
    this.skins.push(mesh);
    // Кости — не потомки меша, а соседи: иначе трансформ меша применился бы
    // к ним дважды.
    mesh.bind(this.skeleton);

    for (const slot of ['handslot.r', 'handslot.l'] as const) {
      const geometry = parts.hold?.[slot];
      if (geometry === undefined) continue;
      // Предмет висит на кости кисти. В позе привязки её мировая матрица и есть
      // та, по которой предмет ставился неподвижным, — поэтому местный
      // трансформ единичный, а рука уносит его сама.
      const hand = this.bones[RIG_BONES.indexOf(slot)]!;
      const held = new THREE.Mesh(geometry, material);
      held.castShadow = true;
      this.skins.push(held);
      this.hands.set(slot, held);
      hand.add(held);
    }

    const inner = new THREE.Group();
    inner.position.set(-parts.fit.shift[0], -parts.fit.shift[1], -parts.fit.shift[2]);
    inner.add(this.bones[0]!, mesh);
    this.root.scale.setScalar(parts.fit.scale);
    this.root.add(inner);

    this.mixer = new THREE.AnimationMixer(inner);
    this.play('покой');
  }

  /**
   * Сменить состояние. `rate` растягивает клип — им ходьба подгоняется
   * под скорость шага (§17.4), иначе ноги едут по полу.
   */
  play(state: RigClipName, rate = 1): void {
    if (this.current === state) {
      if (this.action !== null) this.action.timeScale = rate;
      return;
    }
    const next = this.mixer.clipAction(clipOf(state));
    next.reset();
    next.timeScale = rate;
    next.setLoop(STATE[state].loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = 'hold' in STATE[state] && STATE[state].hold === true;
    if (this.action === null) next.play();
    else next.crossFadeFrom(this.action, BLEND, false).play();
    this.action = next;
    this.current = state;
  }

  /** Одиночный клип поверх текущего: удар и урон не отменяют ходьбу навсегда. */
  get state(): RigClipName | null {
    return this.current;
  }

  /** Доигрался ли одиночный клип: по нему возвращаются в покой или гаснут. */
  /**
   * Начать текущий клип заново. Нужен повторяемому одиночному действию —
   * рубке (§13.3): десять замахов это один клип, сыгранный десять раз,
   * а `play` тем же именем ничего не делает намеренно, иначе удар
   * перезапускался бы каждый кадр.
   */
  replay(): void {
    this.action?.reset().play();
  }

  get finished(): boolean {
    if (this.action === null || this.current === null) return true;
    if (STATE[this.current].loop) return false;
    return this.action.time >= clipOf(this.current).duration - 1e-3;
  }

  /**
   * Сменить предмет в руке, не пересобирая особь. Геометрия общая и лежит
   * в кэше набора, поэтому снятая **не уничтожается**: её держат другие.
   */
  setHeld(slot: HandSlot, geometry: THREE.BufferGeometry | null): void {
    const had = this.hands.get(slot);
    if (had !== undefined) {
      had.removeFromParent();
      const at = this.skins.indexOf(had);
      // Из skins тоже вычёркиваем: setMaterial иначе красил бы снятый меш,
      // а он уже ничей.
      if (at >= 0) this.skins.splice(at, 1);
      this.hands.delete(slot);
    }
    if (geometry === null) return;
    const mesh = new THREE.Mesh(geometry, this.skins[0]?.material ?? undefined);
    mesh.castShadow = true;
    this.skins.push(mesh);
    this.hands.set(slot, mesh);
    this.bones[RIG_BONES.indexOf(slot)]!.add(mesh);
  }

  /** Материал целиком, вместе с предметами в руках: телеграф §17.3 красит
   *  противника, а не половину противника. */
  setMaterial(material: THREE.Material): void {
    for (const mesh of this.skins) mesh.material = material;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
