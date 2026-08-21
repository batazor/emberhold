import * as THREE from 'three';
import type { BuildingId } from '../sim/camp';
import type { DwellerLook } from '../sim/garrison';
import type { HeroClassId } from '../sim/heroes';
import type { EnemyKind, RaidEnemyKind } from '../sim/types';
import { adventurerGeometry, adventurerHeld, adventurerParts } from './adventurers';
import type { Held } from './adventurers';
import { WEAPONS_MODELS } from './weapons.data';
import { weaponOf } from './weapons';
import { WEAPONS_PALETTE } from './palette';
import type { AdventurerModelName } from './adventurers.data';
import { C, box, cone, cyl, merge, put, pyr, rod, wedge } from './blocking';
import type { Piece } from './blocking';
import type { RiggedParts } from './rigged';
import { graveyardGeometry } from './graveyard';
import { skeletonGeometry, skeletonParts } from './skeleton';

/**
 * Модели из артбука. Формы взяты из `artbook.html` (раздел 03 — здания,
 * раздел 04 — персонажи) и `buildart.html`, где палатка, костёр и склад
 * доведены до финального блокинга.
 *
 * Правило §6.1 остаётся дословным: **уровень читается по силуэту, а не
 * по цифре.** Первая стадия — временная конструкция, вторая — дерево,
 * третья — камень. Стадия это замена модели, а не отдельный рисунок.
 *
 * Чего в артбуке нет — Мастерской — собрано здесь из того же словаря форм
 * и тех же 28 цветов. Это дополнение, а не перенос, и его следует
 * утверждать отдельно.
 *
 * Противники отсюда ушли все трое: их силуэт утверждён на примитивах,
 * как §6.1 и предписывает, а рисует их теперь готовый набор (§6.1.3).
 */

/** §6.1 — три стадии роста на шесть уровней здания. */
export const stageOf = (level: number): 0 | 1 | 2 => (level <= 2 ? 0 : level <= 4 ? 1 : 2);

const hash = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Где у здания горит огонь: сдвиг в единицах модели и размер пламени.
 * Само пламя модель больше не несёт — оно живёт шейдером (`fire.ts`),
 * потому что единственная деталь здания, которой нельзя стоять неподвижно,
 * это огонь. Запись осталась здесь, рядом с моделью: место огня — свойство
 * здания, а не сцены, и сцена его спрашивает, а не назначает.
 */
export type FireSpot = readonly [x: number, y: number, z: number, size: number];

/**
 * Открытый огонь по зданиям и стадиям. `null` — стадия, где огня снаружи нет:
 * каменная кухня уносит очаг под трубу, каменная кузница закрывает горн.
 * Стадия — та же, что у моделей (`stageOf`).
 */
const FIRE_SPOTS: Record<BuildingId, readonly (FireSpot | null)[]> = {
  hq: [null, null, null],
  kitchen: [[0, 0.12, 0, 1], [1.4, 0.1, 0.5, 0.6], null],
  storage: [null, null, null],
  forge: [[-0.75, 0.78, -0.35, 0.55], null, null],
};

/** Доля высоты пламени, на которой стоит его свет: середина языка, не подошва. */
export const FIRE_MID = 0.45;

/** Огонь здания на его уровне. Ноль — не построено, значит и не горит. */
export const fireOf = (id: BuildingId, level: number): FireSpot | null =>
  level <= 0 ? null : FIRE_SPOTS[id][stageOf(level)] ?? null;

/* ---------- Жильё ---------- */

/**
 * Палатка (`buildart.html`, раздел 02). Конус, стоявший здесь в первой версии
 * артбука, провалил требование «иметь перёд»: у конуса нет направления.
 * Двускатная ткань задаёт ось, вход — под фронтоном.
 */
function tent(): Piece[] {
  const m: Piece[] = [];
  const HW = 1.4;
  const H = 1.5;
  const D = 2.0;
  const RX = HW + 0.3;
  m.push(cyl(0, -0.04, 0, 2.0, 0.05, 16, C.zem));
  const pegs: [number, number][] = [[-1.95, -1.3], [1.95, -1.3], [-1.95, 1.3], [1.95, 1.3]];
  for (const p of pegs) {
    m.push(rod([p[0], 0.24, p[1]], [p[0] + (p[0] > 0 ? 0.14 : -0.14), 0, p[1]], 0.05, 4, C.derT));
  }
  m.push(rod([-RX, H, 0], [RX, H, 0], 0.055, 6, C.derT));
  m.push(rod([-HW + 0.12, 0, 0], [-HW + 0.12, H, 0], 0.06, 5, C.derT));
  m.push(rod([HW - 0.12, 0, 0], [HW - 0.12, H, 0], 0.06, 5, C.derT));
  // Растяжки выносят силуэт за габарит ткани и не дают палатке быть коробкой.
  for (const p of pegs) m.push(rod([p[0] > 0 ? RX : -RX, H, 0], [p[0], 0.22, p[1]], 0.018, 3, C.solT));
  m.push(wedge(0, 0, 0, 2.8, H, D, C.solom));
  m.push(wedge(1.365, 0, 0, 0.07, H * 0.78, D * 0.76, C.mrak));
  m.push(put(box(0, 0, 0, 0.06, 1.05, 0.62, C.derS), -0.3, 1.44, 0, 0.62));
  for (let i = -1; i <= 1; i++) {
    m.push(put(box(0, 0, 0, 0.3, 0.16, 0.24, i ? C.solT : C.skol), hash(i, 3), i * 0.85, 0, D / 2 - 0.03));
    m.push(put(box(0, 0, 0, 0.3, 0.16, 0.24, i ? C.skol : C.solT), hash(i, 7), i * 0.85, 0, -D / 2 + 0.03));
  }
  // Вымпел = уровень: единственная деталь цвета пламени во всём здании.
  m.push(rod([RX, H, 0], [RX, H + 0.55, 0], 0.03, 4, C.derT));
  m.push(box(RX, H + 0.14, 0, 0.02, 0.3, 0.42, C.plam));
  return m;
}

/** Жильё ур. 2 — бревенчатый дом со знаменем (артбук, 03). */
function hqLodge(): Piece[] {
  return [
    cyl(0, -0.04, 0, 2.9, 0.05, 16, C.zem),
    box(0, 0, 0, 2.4, 1.2, 2, C.der),
    wedge(0, 1.2, 0, 2.7, 0.85, 2.3, C.derT),
    box(0, 0, 1.02, 0.7, 0.95, 0.06, C.mrak),
    rod([1.7, 0, -0.3], [1.7, 2.7, -0.3], 0.07, 5, C.derT),
    box(1.7, 2.2, -0.3, 0.02, 0.5, 0.7, C.plam),
  ];
}

/** Жильё ур. 3 — каменный замок с башней. Вымпел переехал на башню. */
function hqKeep(): Piece[] {
  return [
    cyl(0, -0.04, 0, 3.4, 0.05, 16, C.zem),
    box(0, 0, 0, 3, 1.6, 2.4, C.kam),
    wedge(0, 1.6, 0, 3.3, 0.9, 2.7, C.kamT),
    cyl(1.25, 0, -0.9, 0.62, 3.2, 8, C.kamS),
    cone(1.25, 3.2, -0.9, 0.78, 0.95, 8, C.zhar),
    box(0, 0, 1.22, 0.85, 1.25, 0.06, C.mrak),
    box(0, 1.3, 1.24, 1.1, 0.08, 0.04, C.lat),
  ];
}

/* ---------- Кухня ---------- */

/**
 * Костёр (`buildart.html`, раздел 03). Кухня первого уровня — единственный
 * источник света в ночном лагере, поэтому шалаш раскрыт шире, чем нужно
 * поленьям: между ними должно быть видно огонь.
 */
function campfire(): Piece[] {
  const m: Piece[] = [cyl(0, -0.03, 0, 0.98, 0.04, 14, C.zemT)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.76 + hash(i, 1) * 0.09;
    m.push(
      put(
        box(0, 0, 0, 0.3 + hash(i, 2) * 0.1, 0.2 + hash(i, 4) * 0.12, 0.22,
          i % 3 === 0 ? C.skol : i % 3 === 1 ? C.kam : C.solT),
        a + hash(i, 5) * 0.7, Math.cos(a) * r, 0, Math.sin(a) * r,
      ),
    );
  }
  m.push(cyl(0, 0, 0, 0.6, 0.07, 10, C.ugol));
  m.push(rod([-0.58, 0, -0.36], [0.04, 0.52, 0.05], 0.085, 5, C.derT));
  m.push(rod([0.6, 0, -0.24], [-0.05, 0.52, 0.07], 0.085, 5, C.derT));
  m.push(rod([0.08, 0, 0.62], [0, 0.52, -0.06], 0.085, 5, C.derT));
  m.push(rod([-0.78, 0.09, 0.52], [0.64, 0.09, 0.68], 0.1, 5, C.der));
  m.push(cyl(0, 0.08, 0, 0.46, 0.06, 9, C.zhar));
  return m;
}

/** Кухня ур. 2 — навес, очаг снаружи (`buildart.html`, кадр 08). */
function kitchenShed(): Piece[] {
  return [
    cyl(0, -0.04, 0, 2.1, 0.05, 16, C.zem),
    box(-0.35, 0, 0, 2.0, 1.0, 1.7, C.der),
    wedge(-0.35, 1.0, 0, 2.35, 0.72, 2.0, C.solom),
    box(-0.35, 0, 0.86, 0.6, 0.85, 0.06, C.mrak),
    rod([0.95, 1.72, 0], [0.95, 2.2, 0], 0.03, 4, C.derT),
    box(0.95, 1.86, 0, 0.02, 0.28, 0.4, C.plam),
    cyl(1.4, 0, 0.5, 0.6, 0.1, 10, C.ugol),
  ];
}

/** Кухня ур. 3 — каменная кухня с трубой (артбук, 03). */
function kitchenStone(): Piece[] {
  return [
    cyl(0, -0.04, 0, 3.2, 0.05, 16, C.zem),
    box(-0.2, 0, 0, 2.6, 1.35, 2.1, C.kam),
    wedge(-0.2, 1.35, 0, 2.9, 0.8, 2.4, C.solom),
    box(1.05, 0, -0.6, 0.55, 2.9, 0.55, C.kamT),
    box(-0.2, 0, 1.07, 0.7, 1.05, 0.06, C.mrak),
    cyl(-1.75, 0, 0.7, 0.34, 0.5, 8, C.derS),
    cyl(-1.75, 0, -0.3, 0.3, 0.45, 8, C.derS),
  ];
}

/* ---------- Склад ---------- */

/**
 * Склад (`buildart.html`). Выдаёт рюкзак, а не хранит ресурсы, — отсюда короб
 * на колышке как главный предмет, а не гора мешков.
 */
function storagePlatform(): Piece[] {
  const m: Piece[] = [cyl(0, -0.04, 0, 2.05, 0.05, 16, C.zem)];
  for (const p of [[-1.0, -0.72], [1.0, -0.72], [1.0, 0.72], [-1.0, 0.72]] as [number, number][]) {
    m.push(rod([p[0], 0, p[1]], [p[0], 0.26, p[1]], 0.12, 6, C.derT));
  }
  m.push(box(0, 0.26, 0, 2.45, 0.16, 1.95, C.der));
  m.push(put(box(0, 0.42, 0, 0.64, 0.52, 0.52, C.derS), 0.14, -0.62, 0, -0.3));
  m.push(put(box(0, 0.94, 0, 0.5, 0.4, 0.42, C.der), -0.35, -0.6, 0, -0.26));
  m.push(put(box(0, 0.42, 0, 0.58, 0.46, 0.5, C.der), -0.2, 0.6, 0, -0.42));
  m.push(put(cyl(0, 0.42, 0, 0.3, 0.34, 7, C.sol), 0, 0.55, 0, 0.42));
  m.push(put(cyl(0, 0.42, 0, 0.26, 0.3, 7, C.solS), 0, -0.05, 0, 0.5));
  m.push(rod([-1.25, 0, -0.95], [-1.25, 1.18, -0.95], 0.05, 5, C.derT));
  m.push(rod([1.25, 0, -0.95], [1.25, 1.18, -0.95], 0.05, 5, C.derT));
  m.push(rod([-1.25, 0.35, 0.95], [-1.25, 1.18, -0.95], 0.02, 3, C.solT));
  m.push(rod([1.25, 0.35, 0.95], [1.25, 1.18, -0.95], 0.02, 3, C.solT));
  m.push(wedge(0, 1.1, -0.5, 2.6, 0.22, 1.15, C.solom));
  m.push(rod([1.5, 0, 1.0], [1.5, 1.15, 1.0], 0.06, 5, C.derT));
  m.push(box(1.5, 0.62, 1.0, 0.4, 0.46, 0.32, C.derS));
  m.push(box(1.5, 0.78, 1.0, 0.42, 0.07, 0.34, C.travS));
  return m;
}

/** Склад ур. 2 — амбар: ворота на торце, под фронтоном. */
function storageBarn(): Piece[] {
  return [
    cyl(0, -0.04, 0, 2.05, 0.05, 16, C.zem),
    box(0, 0, 0, 2.6, 1.25, 2.0, C.der),
    wedge(0, 1.25, 0, 2.9, 0.85, 2.3, C.solom),
    box(1.32, 0, 0, 0.06, 1.05, 1.35, C.mrak),
    box(1.34, 1.05, 0, 0.06, 0.12, 1.5, C.derT),
    box(1.62, 0, 0, 0.56, 0.14, 1.6, C.derS),
    put(box(0, 0, 0, 0.6, 0.5, 0.5, C.derS), 0.22, 1.0, 0, 1.3),
    put(cyl(0, 0, 0, 0.3, 0.34, 7, C.sol), 0, -1.55, 0, 0.85),
    rod([-1.5, 0, -0.9], [-1.5, 1.1, -0.9], 0.05, 4, C.derT),
    box(-1.5, 0.64, -0.9, 0.36, 0.42, 0.3, C.der),
    box(-1.5, 0.78, -0.9, 0.38, 0.06, 0.32, C.travS),
  ];
}

/* ---------- Мастерская ---------- */

/**
 * Мастерской в артбуке нет — она появилась в §14 позже него. Собрана из того же
 * словаря: горн с тем же пламенем, что у костра, наковальня на чурбаке,
 * навес над рабочим местом. Главный предмет — наковальня, потому что §14
 * обещает ковку без таймера: работа идёт при игроке, а не в его отсутствие.
 */
function forgeOpen(): Piece[] {
  const m: Piece[] = [cyl(0, -0.04, 0, 2.05, 0.05, 16, C.zemT)];
  m.push(box(-0.75, 0, -0.35, 1.15, 0.62, 1.0, C.kam));
  m.push(box(-0.75, 0.62, -0.35, 1.25, 0.1, 1.1, C.kamT));
  m.push(cyl(-0.75, 0.72, -0.35, 0.34, 0.08, 9, C.ugol));
  m.push(rod([-1.25, 0, 0.35], [-1.25, 1.7, 0.35], 0.06, 5, C.derT));
  m.push(rod([0.95, 0, 0.35], [0.95, 1.7, 0.35], 0.06, 5, C.derT));
  m.push(wedge(-0.15, 1.7, -0.2, 2.4, 0.35, 1.5, C.solom));
  m.push(cyl(0.7, 0, 0.55, 0.3, 0.36, 7, C.derT));
  m.push(box(0.7, 0.36, 0.55, 0.72, 0.22, 0.34, C.met));
  m.push(box(1.02, 0.42, 0.55, 0.28, 0.14, 0.22, C.stal));
  m.push(put(box(0, 0, 0, 0.42, 0.36, 0.36, C.derS), 0.3, 1.35, 0, -0.7));
  m.push(rod([1.35, 0.36, -0.7], [1.5, 0.95, -0.7], 0.035, 4, C.derT));
  return m;
}

/** Мастерская ур. 2 — каменная, с мехами и трубой. */
function forgeStone(): Piece[] {
  const m: Piece[] = [...forgeOpen()];
  m.push(box(-0.75, 0, -1.0, 1.35, 1.9, 0.5, C.kamT));
  m.push(box(-0.75, 1.9, -1.0, 0.45, 1.1, 0.45, C.kam));
  m.push(put(box(0, 0.5, 0, 0.5, 0.5, 0.7, C.der), 0, -1.55, 0, -0.35));
  m.push(rod([-1.9, 0.85, -0.35], [-1.2, 0.85, -0.35], 0.05, 5, C.derT));
  return m;
}

/* ---------- персонажи ---------- */

/**
 * Персонажи различаются силуэтом раньше, чем цветом: в темноте за пределами
 * фонаря цвет пропадает первым (артбук, 04).
 *
 * Наземный кружок из артбука здесь не нужен — он был подставкой карточки.
 */
const RANGER_CLOTH = '#35454e';

function ranger(): Piece[] {
  return [
    box(-0.11, 0, 0, 0.13, 0.42, 0.15, C.metT),
    box(0.11, 0, 0, 0.13, 0.42, 0.15, C.metT),
    box(0, 0.42, 0, 0.44, 0.52, 0.28, RANGER_CLOTH),
    box(0, 0.62, 0, 0.46, 0.06, 0.3, C.travS),
    pyr(0, 0.94, 0, 0.42, 0.34, 0.36, RANGER_CLOTH),
    box(0, 0.96, 0.1, 0.2, 0.18, 0.12, C.solom),
    rod([0.3, 0.35, -0.05], [0.3, 1.3, -0.05], 0.035, 5, C.derT),
    box(0.3, 1.28, -0.05, 0.05, 0.1, 0.05, C.stal),
  ];
}

function warrior(): Piece[] {
  return [
    box(-0.13, 0, 0, 0.15, 0.4, 0.17, C.metT),
    box(0.13, 0, 0, 0.15, 0.4, 0.17, C.metT),
    box(0, 0.4, 0, 0.56, 0.54, 0.32, C.met),
    box(0, 0.6, 0, 0.58, 0.07, 0.34, C.stal),
    box(0, 0.94, 0, 0.3, 0.26, 0.28, C.solom),
    box(0, 1.14, 0, 0.38, 0.14, 0.34, C.stal),
    rod([0.36, 0.42, 0], [0.36, 1.27, 0], 0.05, 6, C.met),
    box(0.36, 1.27, 0, 0.16, 0.24, 0.05, C.stal),
    box(-0.36, 0.5, 0, 0.08, 0.42, 0.38, C.der),
  ];
}

/**
 * Носильщик. В артбуке его нет — класс появился вместе с §11.7. Силуэт строится
 * от того, что он делает: широкий рюкзак и жбан, из-за которых он несёт больше
 * и идёт медленнее. Дополнение, а не перенос.
 */
function porter(): Piece[] {
  return [
    box(-0.12, 0, 0, 0.14, 0.38, 0.16, C.metT),
    box(0.12, 0, 0, 0.14, 0.38, 0.16, C.metT),
    box(0, 0.38, 0, 0.5, 0.5, 0.3, C.derS),
    box(0, 0.56, 0, 0.52, 0.06, 0.32, C.lat),
    box(0, 0.88, 0, 0.28, 0.24, 0.26, C.solom),
    box(0, 1.06, 0, 0.36, 0.06, 0.32, C.solT),
    box(-0.02, 0.46, -0.28, 0.46, 0.52, 0.3, C.der),
    cyl(-0.02, 0.98, -0.3, 0.16, 0.24, 7, C.sol),
    rod([0.34, 0.3, 0.05], [0.34, 0.92, 0.05], 0.03, 5, C.derT),
  ];
}

/* ---------- сборка ---------- */

const BUILDING_STAGES: Record<BuildingId, [() => Piece[], () => Piece[], () => Piece[]]> = {
  hq: [tent, hqLodge, hqKeep],
  kitchen: [campfire, kitchenShed, kitchenStone],
  storage: [storagePlatform, storageBarn, storageBarn],
  forge: [forgeOpen, forgeStone, forgeStone],
};

const HERO_SHAPES: Record<HeroClassId, () => Piece[]> = {
  ranger,
  warrior,
  porter,
};

/**
 * Противники (§6.1.3, каталог — `enemyart.html`) — три скелета набора KayKit,
 * и различает их снаряжение, а не порода. §15 требует читать тип силуэтом
 * раньше, чем цветом, и здесь силуэт делают ровно три вещи: голые кости,
 * рогатый шлем с топором и посох.
 *
 * Рост задаётся по скелету, а не по тому, что у него в руках. Простой
 * скелет — 0,72 клетки против 1,3 у героя: мелкий он и на вид; воин 0,95,
 * маг 1,0, и за габарит тела его выносит посох, а не рост.
 */
/**
 * Рост привидения. Стоит отдельным числом, потому что нужен раньше таблицы
 * ростов: неподвижная модель собирается выше по файлу, а разъехаться этим
 * двум нельзя — иначе одно и то же привидение будет разного размера
 * на странице артбука и в локации.
 */
const GHOST_HEIGHT = 0.62;

const ENEMY_MODELS: Record<EnemyKind, () => THREE.BufferGeometry> = {
  minion: () => skeletonGeometry('Skeleton_Minion', 0.72),
  warrior: () => skeletonGeometry('Skeleton_Warrior', 0.95, 'Skeleton_Axe'),
  mage: () => skeletonGeometry('Skeleton_Mage', 1, 'Skeleton_Staff'),
  // Привидение — из набора кладбища (§6.1.7), и скелета у него нет: и здесь,
  // и в вылазке это одна и та же неподвижная модель.
  ghost: () => graveyardGeometry('character-ghost', GHOST_HEIGHT),
  // Те же числа, что в ENEMY_HEIGHT ниже: неподвижная версия обязана стоять
  // ровно там же, где стоит подвижная.
};

export const buildingGeometry = (id: BuildingId, level: number): THREE.BufferGeometry =>
  merge(BUILDING_STAGES[id][stageOf(level)]());

/**
 * Классы, которым модель набора уже нарисована (§6.1.3). Вписан один — тот,
 * которым играют с первой вылазки; остальные пять персонажей набора измерены
 * и ждут своей строки, потому что каждый стоит килобайтов у всех игроков.
 *
 * Правило §6.1 «силуэт утверждается на примитивах до моделирования» этим
 * не нарушено, а исполнено: примитив был утверждён и стоит рядом — модель
 * приводится к его росту, а не наоборот.
 */
export const HERO_MODELS: Partial<Record<HeroClassId, AdventurerModelName>> = {
  ranger: 'Barbarian',
};

/**
 * Рост примитива, которого модель заменяет. Берётся у него же, а не числом
 * в коде: подмена модели не должна сдвинуть ни камеру, ни тень, ни привязку
 * интерфейса, а два записанных порознь роста разъезжаются молча.
 */
const heroHeights = new Map<HeroClassId, number>();
function heroHeight(cls: HeroClassId): number {
  const known = heroHeights.get(cls);
  if (known !== undefined) return known;
  const geo = merge(HERO_SHAPES[cls]());
  geo.computeBoundingBox();
  const box3 = geo.boundingBox!;
  const height = box3.max.y - box3.min.y;
  geo.dispose();
  heroHeights.set(cls, height);
  return height;
}

/**
 * Что у героя в руке. Раньше здесь стояла строка — одноручный топор из набора
 * персонажей, один на все уровни; комментарий рядом обещал таблицу, когда
 * уровень предмета начнёт читаться моделью. Набор оружия (§6.1.8) это и есть.
 *
 * Классов с моделью пока один, поэтому таблица одномерная: уровень оружия §14
 * выбирает ступень лестницы, а класс — держит ли он её вообще. Появится второй
 * класс с моделью набора — здесь появится второй ключ, а не второй способ.
 */
const HERO_ARMED: Partial<Record<HeroClassId, true>> = {
  ranger: true,
};

/**
 * Предмет в руке по уровню оружия. Уровень 0 — «не выковано»: в руке остаётся
 * деревянный клинок набора, потому что пустая рука в бою читается как ошибка
 * рисовальщика, а не как «Мастерская не построена».
 */
const heldOf = (cls: HeroClassId, weapon: number): Held | undefined => {
  if (HERO_ARMED[cls] !== true) return undefined;
  const name = weaponOf(weapon);
  return { name, model: WEAPONS_MODELS[name], palette: WEAPONS_PALETTE };
};

/** §14 — уровень оружия из Мастерской. 0 — слот пуст, ковки ещё не было. */
export const heroGeometry = (cls: HeroClassId, weapon = 0): THREE.BufferGeometry => {
  const model = HERO_MODELS[cls];
  return model === undefined
    ? merge(HERO_SHAPES[cls]())
    : adventurerGeometry(model, heroHeight(cls), heldOf(cls, weapon));
};

export const enemyGeometry = (kind: EnemyKind): THREE.BufferGeometry => ENEMY_MODELS[kind]();

/**
 * То же, но со скелетом: вылазка ставит противника этим, а неподвижная
 * геометрия выше остаётся страницам и замерам. Рост и предмет — те же,
 * что у неподвижной версии, иначе подмена сдвинула бы силуэт.
 */
export const ENEMY_HEIGHT: Record<EnemyKind, number> = {
  minion: 0.72,
  warrior: 0.95,
  mage: 1,
  // Привидение мельче простого скелета: в наборе это тряпка с руками
  // 0,79 в ширину при 0,66 в высоту, и вытягивать её до роста скелета
  // значило бы рисовать другую модель.
  ghost: GHOST_HEIGHT,
};

const ENEMY_PARTS: Record<RaidEnemyKind, () => RiggedParts> = {
  minion: () => skeletonParts('Skeleton_Minion', ENEMY_HEIGHT.minion),
  warrior: () => skeletonParts('Skeleton_Warrior', ENEMY_HEIGHT.warrior, 'Skeleton_Axe'),
  mage: () => skeletonParts('Skeleton_Mage', ENEMY_HEIGHT.mage, 'Skeleton_Staff'),
};

/** Скелет есть только у ярусных: привидение набора не скиновано вовсе. */
export const enemyParts = (kind: RaidEnemyKind): RiggedParts => ENEMY_PARTS[kind]();

/**
 * Жильцы двора (§6.1.6.1). Гарнизон стережёт, а живёт в замке кто-то ещё,
 * и отличить одно от другого можно только силуэтом — тем же правилом, каким
 * различаются скелеты (§15) и сам гарнизон: снаряжение, а не порода.
 *
 * Предмет у обоих правый: набор отдаёт узел `handslot.r` и только его,
 * поэтому щита в левой руке не бывает ни у кого. Это ответ набора, а не
 * выбор снаряжения: числами жильцы не описаны вовсе.
 */
const DWELLER_MODEL: Record<DwellerLook, readonly [AdventurerModelName, AdventurerModelName]> = {
  маг: ['Mage', 'staff'],
  плут: ['Rogue', 'dagger'],
};

export const dwellerParts = (look: DwellerLook): RiggedParts => {
  const [model, held] = DWELLER_MODEL[look];
  // Рост берётся у героя по той же причине, что у гарнизона: жильцы и герой —
  // люди одного мира, и разный рост читался бы не «другой человек»,
  // а «другой масштаб сцены».
  return adventurerParts(model, heroHeight(GUARD_LIKE), adventurerHeld(held));
};

/** Герой со скелетом — там, где у класса есть модель набора (§6.1.4). */
export function heroParts(cls: HeroClassId, weapon = 0): RiggedParts | null {
  const model = HERO_MODELS[cls];
  return model === undefined
    ? null
    : adventurerParts(model, heroHeight(cls), heldOf(cls, weapon));
}


/**
 * Гарнизон замка (§6.1.6) — рыцарь набора: тот, что по периметру, и тот,
 * что на стене. Персонаж один на обоих, а отличает их предмет в руке —
 * ровно то же правило, каким набор различает своих скелетов (§6.1.3):
 * силуэт делает снаряжение, а не порода.
 *
 * Рост берётся у героя, а не назначается своим числом. Гарнизон и герой —
 * люди одного мира, и разный рост читался бы не «другой человек», а «другой
 * масштаб сцены»; вдобавок мерка героя снята с примитива, который он заменил,
 * и второе записанное число разошлось бы с ней молча.
 */
const GUARD_MODEL: AdventurerModelName = 'Knight';

/** Класс, у которого рост измерен: единственный, кому набор уже вписан. */
const GUARD_LIKE: HeroClassId = 'ranger';

/** Кто в гарнизоне: обходящий периметр и стоящий на стене. */
export type GuardKind = 'дозор' | 'стрелок';

const GUARD_HELD: Record<GuardKind, AdventurerModelName> = {
  'дозор': 'sword_1handed',
  'стрелок': 'bow_withString',
};

export const guardHeight = (): number => heroHeight(GUARD_LIKE);

export const guardParts = (kind: GuardKind): RiggedParts =>
  adventurerParts(GUARD_MODEL, heroHeight(GUARD_LIKE), adventurerHeld(GUARD_HELD[kind]));
