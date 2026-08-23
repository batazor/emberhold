import { ADVENTURERS_MODELS } from './adventurers.data';
import { DUNGEON_MODELS } from './dungeon.data';
import { PROPS_MODELS } from './props.data';
import { WEAPONS_MODELS } from './weapons.data';
import {
  ADVENTURERS_PALETTE,
  DUNGEON_PALETTE,
  PROPS_PALETTE,
  WEAPONS_PALETTE,
} from './palette';
import { bakedGeometry } from './baked';
import type { Part } from './baked';
import { weaponOf } from './weapons';
import { GEAR_ORDER } from '../sim/gear';
import type { GearSlot } from '../sim/gear';

/**
 * Значки снаряжения (§14) — вещь в списке Мастерской видна вещью, а не
 * строкой. Картинок в игре нет и здесь не заводится: §6.1 запрещает
 * текстурные ассеты, и значок рисуется из той же запечённой геометрии,
 * которой набран весь мир, — теми же цветами палитры и тем же плоским
 * затенением. Ничего не скачивается и ничего не хранится: PNG собирается
 * в браузере при первом показе и живёт в кэше вкладки.
 *
 * Рисует не three, а 2D-канвас художником: дальние треугольники первыми,
 * z-буфера нет и не нужно. Так значок стоит одного канваса на предмет
 * вместо второго контекста WebGL под каждой строкой списка — тот же приём,
 * которым эти значки нарисованы в артбуке `inventory.html`, откуда пришло
 * и соответствие «слот → модель».
 *
 * Своей модели нет у брони, сумки и кольца ни в одном наборе (`inventory.html`):
 * броню изображает фигура в доспехе, сумку — колчан, кольцо — связка.
 * Это подписано в артбуке как временное, и меняется здесь одной строкой.
 */

/** Что показывает слот. Левая рука §14.2 — два рода вещей, а не один. */
export type GearIconKind = GearSlot | 'shield';

export const GEAR_ICON_KINDS: readonly GearIconKind[] = [...GEAR_ORDER, 'shield'];

/** Модель слота. У оружия она растёт лестницей §14, у прочих одна. */
function partOf(kind: GearIconKind, level: number): Part {
  switch (kind) {
    case 'weapon':
      // Тот самый клинок, который окажется в руке героя в вылазке: значок
      // и рука обязаны показывать одну вещь, иначе ковка меняет картинку
      // в списке и не меняет ничего на герое.
      return { model: WEAPONS_MODELS[weaponOf(level)], palette: WEAPONS_PALETTE };
    case 'armor':
      return { model: ADVENTURERS_MODELS.Knight, palette: ADVENTURERS_PALETTE };
    case 'torch':
      return { model: PROPS_MODELS.Lamp_1, palette: PROPS_PALETTE };
    case 'shield':
      return { model: ADVENTURERS_MODELS.shield_round, palette: ADVENTURERS_PALETTE };
    case 'bag':
      return { model: ADVENTURERS_MODELS.quiver, palette: ADVENTURERS_PALETTE };
    case 'ring':
      return { model: DUNGEON_MODELS.keyring, palette: DUNGEON_PALETTE };
  }
}

/* ---------- камера и свет: те же, что у сцены ---------- */

const AZ = (45 * Math.PI) / 180;
const EL = (30 * Math.PI) / 180;
/** Направление света — то же, что у солнца сцены: значок не спорит с игрой. */
const LIGHT = ((): readonly [number, number, number] => {
  const v: [number, number, number] = [-0.55, 0.78, -0.31];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
})();

/** Ортогональная проекция 45°/30°. Возвращает экранные x, y и глубину. */
function project(x: number, y: number, z: number): [number, number, number] {
  const ca = Math.cos(AZ);
  const sa = Math.sin(AZ);
  const ce = Math.cos(EL);
  const se = Math.sin(EL);
  const rx = x * ca - z * sa;
  const rz = x * sa + z * ca;
  return [rx, y * ce - rz * se, y * se + rz * ce];
}

/**
 * Линейный цвет в sRGB. Нужен ровно из-за границы, которую легко не заметить:
 * `bakedGeometry` кладёт в вершины цвет через `THREE.Color`, а тот переводит
 * палитру в линейное рабочее пространство — сцена рисует его шейдером
 * и возвращает обратно сама. Канвас так не умеет: линейные числа, положенные
 * в него напрямую, темнеют втрое, и значки выходили почти чёрными (яркость
 * 17 из 255 при палитре, которая на солнце читается).
 */
function srgb(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const SIZE = 96;
/** Поля вокруг вещи: без них силуэт упирается в край и читается обрезанным. */
const PAD = 8;

/**
 * Готовый значок. Ключ — вид и модель, а не уровень: у оружия ступеней
 * меньше, чем уровней, и рисовать одну картинку дважды незачем.
 */
const cache = new Map<string, string>();

/**
 * Значок вещи как `data:`-URL. Пустая строка — отказ рисовать (нет канваса);
 * список от этого не ломается, у строки просто не будет картинки.
 */
export function gearIcon(kind: GearIconKind, level = 0): string {
  const part = partOf(kind, level);
  const key = `${kind}#${part.model.tris}#${part.model.idx.length}`;
  const ready = cache.get(key);
  if (ready !== undefined) return ready;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return '';

  // Геометрия берётся распаковщиком набора, а не своим разбором: цвет,
  // склейка вершин и фильтр слотов уже решены там и обязаны совпадать
  // с тем, что игрок видит в сцене.
  const geometry = bakedGeometry([part]);
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const index = geometry.getIndex();
  if (index === null) {
    geometry.dispose();
    return '';
  }

  const count = index.count / 3;
  const view = new Float32Array(position.count * 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < position.count; v++) {
    const [x, y, z] = project(position.getX(v), position.getY(v), position.getZ(v));
    view[v * 3] = x;
    view[v * 3 + 1] = y;
    view[v * 3 + 2] = z;
  }
  // Рамка считается по вершинам, на которые вправду ссылаются: у модели
  // с отфильтрованными слотами лишние вершины остаются в буфере и растянули
  // бы значок пустотой.
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    const x = view[v * 3]!;
    const y = view[v * 3 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scale = Math.min(
    (SIZE - PAD * 2) / (maxX - minX || 1),
    (SIZE - PAD * 2) / (maxY - minY || 1),
  );
  const ox = SIZE / 2 - ((minX + maxX) / 2) * scale;
  const oy = SIZE / 2 + ((minY + maxY) / 2) * scale;

  // Художник: дальние треугольники первыми.
  const order = Array.from({ length: count }, (_, t) => t).sort((a, b) => {
    const depth = (t: number): number =>
      (view[index.getX(t * 3) * 3 + 2]! +
        view[index.getX(t * 3 + 1) * 3 + 2]! +
        view[index.getX(t * 3 + 2) * 3 + 2]!) /
      3;
    return depth(b) - depth(a);
  });

  for (const t of order) {
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);
    // Нормаль считается по мировым координатам, а не по экранным: свет
    // падает на вещь, а не на её проекцию.
    const ux = position.getX(b) - position.getX(a);
    const uy = position.getY(b) - position.getY(a);
    const uz = position.getZ(b) - position.getZ(a);
    const vx = position.getX(c) - position.getX(a);
    const vy = position.getY(c) - position.getY(a);
    const vz = position.getZ(c) - position.getZ(a);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const lit = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len);
    // Нижняя граница не ноль: неосвещённая грань обязана остаться цветом
    // вещи, а не чёрным пятном — плоское затенение §6.1 читает силуэт.
    // Порог выше сценового: значок живёт на тёмной плашке в 52 пикселя,
    // и то же затенение, что читается на солнце, здесь сливалось с фоном.
    const k = 0.58 + lit * 0.62;
    // Свет умножает линейный цвет — там он и живёт, — а в канвас уходит
    // уже sRGB: перепутанный порядок сжёг бы света и утопил тени.
    const r = Math.round(srgb(color.getX(a) * k) * 255);
    const g = Math.round(srgb(color.getY(a) * k) * 255);
    const bl = Math.round(srgb(color.getZ(a) * k) * 255);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.beginPath();
    ctx.moveTo(ox + view[a * 3]! * scale, oy - view[a * 3 + 1]! * scale);
    ctx.lineTo(ox + view[b * 3]! * scale, oy - view[b * 3 + 1]! * scale);
    ctx.lineTo(ox + view[c * 3]! * scale, oy - view[c * 3 + 1]! * scale);
    ctx.closePath();
    ctx.fill();
  }
  geometry.dispose();

  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
