import * as THREE from 'three';
import { CAMP_MODELS } from './camp.data';
import type { CampModel } from './camp.data';
import { bakedGeometry, fitOf } from './baked';
import type { Fit } from './baked';
import { CAMP_PALETTE, PALETTE } from './palette';

/**
 * Хижина (§6.1.11) — первая постройка, которую игра **собирает**, а не берёт
 * одним куском. Дом, дверь, окно и стекло лежат в наборе отдельными моделями,
 * а место двери и окна дом объявляет узлами `doorslot` и `winslot`.
 *
 * **Почему не один файл на каждый вид дома.** Два варианта двери и два окна
 * дали бы четыре дома, и каждый следующий вариант умножал бы их дальше.
 * Хуже другое: одинаковые брёвна лежали бы в бандле четырежды. Сборка
 * из частей — тот же приём, каким набор персонажей вкладывает оружие в кулак
 * (§6.1.4), и по той же причине: матрица узла запечена вместе с моделью,
 * поэтому дверь встаёт в проём, а не туда, куда её подвинули на глаз.
 *
 * **Стекло — отдельная часть, и это не аккуратность, а требование.** Цвет
 * запечён в вершинах, один слот палитры на треугольник, и перекрасить кусок
 * общей геометрии на ночь нечем. Своя часть — свой материал, а свой материал
 * умеет светиться.
 */

/** Варианты двери. Ключ — то, чем их называет игра; значение — модель набора. */
export const DOORS = {
  plank: 'Door_Plank',
  studded: 'Door_Studded',
} as const;

/** Варианты окна. Стекло у них общее: проём один, и рама вокруг него разная. */
export const WINDOWS = {
  cross: 'Window_Cross',
  shutter: 'Window_Shutter',
} as const;

export type DoorId = keyof typeof DOORS;
export type WindowId = keyof typeof WINDOWS;

export interface HutLook {
  readonly door: DoorId;
  readonly window: WindowId;
}

export interface HutParts {
  /** Сруб с крышей и рамой окна — всё, что не двигается и не светится. */
  readonly body: THREE.BufferGeometry;
  /** Полотно двери. Отдельно, потому что оно открывается. */
  readonly door: THREE.BufferGeometry;
  /**
   * Ось, вокруг которой поворачивается полотно, — в единицах игры.
   * Её объявляет дом узлом `hingeslot`, а не подбирает код: край полотна
   * это свойство проёма, и подобранный он разъедется с моделью молча.
   */
  readonly hinge: readonly [number, number, number];
  /**
   * Стёкла — оба: окно стены и окошко фронтона. Одной геометрией, потому что
   * материал у них один и ночью они зажигаются вместе. Отдельно от дома —
   * потому что перекрасить кусок общей запечённой геометрии нечем.
   */
  readonly glass: THREE.BufferGeometry;
  /**
   * Где ставить огонёк окна: середина стекла в единицах игры. Не сцена решает,
   * а модель — ровно как у костра (`fireOf`): свет и то, что светится, не могут
   * оказаться в стороне друг от друга.
   */
  readonly lamp: readonly [number, number, number];
}

/**
 * Дверь (§6.1.11). Числа здесь — про то, что видно, и потому объявлены рядом.
 *
 * **Открывается наружу.** Внутрь дверь ушла бы в темноту проёма и читалась бы
 * не открытой, а исчезнувшей: внутренности у дома нет, за проёмом стоит слот
 * «мрак». Наружу полотно остаётся на свету и само показывает, что произошло.
 */
export const DOOR = {
  /** Распахнутая дверь. Не 90°: створка, вставшая ровно поперёк, читается
   *  отвалившейся, а не открытой. */
  angle: Math.PI * 0.42,
  /** Секунд на полный ход. Дверь дома — не ворота: её открывают рукой. */
  time: 0.32,
  /** С какого расстояния дверь начинает открываться, в клетках лагеря. */
  near: 1.3,
} as const;

/** Расстояние, на котором свет окна ещё что-то освещает. */
const WINDOW_RANGE = 3.4;
/** Затухание. То же, что у костра: свет в лагере обязан гаснуть одинаково. */
const WINDOW_DECAY = 1.3;
/** Яркость в полную ночь. Костёр даёт 20 — окно светит жильём, а не площадью. */
const WINDOW_NIGHT = 3.2;

const cache = new Map<string, HutParts>();

/** Матрица узла к точке: узлы дома без поворота, но считается честно. */
function place(matrix: readonly number[], p: readonly number[]): [number, number, number] {
  return [0, 1, 2].map(
    (c) => matrix[c]! * p[0]! + matrix[4 + c]! * p[1]! + matrix[8 + c]! * p[2]! + matrix[12 + c]!,
  ) as [number, number, number];
}

/** Точка модели в единицах игры: тот же пересчёт, что делает `bakedGeometry`. */
const fitted = (fit: Fit, p: readonly number[]): [number, number, number] =>
  [0, 1, 2].map((c) => (p[c]! - fit.shift[c]!) * fit.scale) as [number, number, number];

/**
 * Собрать дом. `height` — рост в единицах игры; модель приводится к нему
 * целиком, вместе со вставками, поэтому дверь не может оказаться другого
 * масштаба, чем проём.
 */
export function hutParts(look: HutLook, height: number): HutParts {
  const key = `${look.door}+${look.window}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const hut: CampModel = CAMP_MODELS.Hut;
  const door: CampModel = CAMP_MODELS[DOORS[look.door]];
  const window: CampModel = CAMP_MODELS[WINDOWS[look.window]];
  const glass: CampModel = CAMP_MODELS.Glass;

  const doorAt = hut.hand?.['doorslot'];
  const winAt = hut.hand?.['winslot'];
  if (doorAt === undefined || winAt === undefined) {
    throw new Error('у хижины нет узлов вставки: дверь и окно ставить некуда');
  }

  const ventAt = hut.hand?.['ventslot'];
  const hingeAt = hut.hand?.['hingeslot'];
  if (hingeAt === undefined) throw new Error('у хижины нет петли: дверь вращать не вокруг чего');

  const fit = fitOf(hut, height);
  const parts: HutParts = {
    body: bakedGeometry([
      { model: hut, palette: CAMP_PALETTE },
      { model: window, palette: CAMP_PALETTE, matrix: winAt },
    ], fit),
    door: bakedGeometry([{ model: door, palette: CAMP_PALETTE, matrix: doorAt }], fit),
    hinge: fitted(fit, [hingeAt[12]!, hingeAt[13]!, hingeAt[14]!]),
    // Окошко фронтона — то же стекло, вставленное мельче: масштаб приходит
    // матрицей узла, поэтому второй модели стекла не заведено.
    glass: bakedGeometry([
      { model: glass, palette: CAMP_PALETTE, matrix: winAt },
      ...(ventAt === undefined ? [] : [{ model: glass, palette: CAMP_PALETTE, matrix: ventAt }]),
    ], fit),
    lamp: fitted(fit, place(winAt, [0, 1, 2].map((c) => (glass.min[c]! + glass.max[c]!) / 2))),
  };
  cache.set(key, parts);
  return parts;
}

/**
 * Материал стекла. Днём это обычный запечённый цвет — холодный слот «стекло»
 * из палитры; ночью тот же кусок светится изнутри.
 *
 * **Светится окно, а не дом.** Соблазн покрасить эмиссией всю модель есть
 * ровно до первого кадра: светящийся сруб читается не «внутри горит очаг»,
 * а «дом сделан из лампы».
 */
export function glassMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.emissive = new THREE.Color(PALETTE.torch);
  material.emissiveIntensity = 0;
  return material;
}

/**
 * Огонёк окна. Точечный, тёплый, **без теней и без мерцания**.
 *
 * Теней у него нет по §6.1: источник с тенями в сцене один, и это солнце;
 * второй — отдельное решение, а не мелочь. Мерцания нет потому, что мерцает
 * пламя, а окно — то, что за ним: дрожащее окно читалось бы пожаром.
 * Этим же оно и отличается от костра, у которого дрожь есть (`fire.ts`).
 */
export function windowLight(): THREE.PointLight {
  return new THREE.PointLight(PALETTE.torch, 0, WINDOW_RANGE, WINDOW_DECAY);
}

/**
 * Ход двери за кадр. Возвращает новую долю открытости (0…1).
 *
 * Считается временем, а не шагом на кадр: на шестидесяти кадрах дверь иначе
 * открывается вдвое быстрее, чем на тридцати, и «полсекунды» перестаёт что-либо
 * значить. Сглаживания здесь нет намеренно — оно живёт в `doorAngle`, потому
 * что доля открытости нужна ещё и симуляции, а ей плавность безразлична.
 */
export function stepDoor(open: number, want: boolean, dt: number): number {
  const step = dt / DOOR.time;
  return Math.min(1, Math.max(0, open + (want ? step : -step)));
}

/** Угол полотна по доле открытости: медленный старт и мягкая остановка. */
export function doorAngle(open: number): number {
  const k = Math.min(1, Math.max(0, open));
  return -DOOR.angle * (k * k * (3 - 2 * k));
}

/**
 * Ночь: 0 — день, 1 — ночь. Свет и стекло ведёт одна функция, потому что
 * разъехаться им нельзя — тёмное окно при горящем свете читается сбоем.
 */
export function setHutNight(
  night: number,
  glass: THREE.MeshLambertMaterial,
  light: THREE.PointLight,
): void {
  const k = Math.min(1, Math.max(0, night));
  glass.emissiveIntensity = k;
  light.intensity = WINDOW_NIGHT * k;
}
