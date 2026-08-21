import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, type Fit } from './baked';
import { PROPS_MODELS, PROPS_SLOTS } from './props.data';
import type { PropModelName } from './props.data';
import { PROPS_PALETTE, PALETTE } from './palette';
import { CASTLE_CELL } from '../sim/castle';
import type { RoadTile } from '../sim/roads';

/**
 * Дороги и фонари набора craftpix (§6.1.12) в виде геометрии three.
 * Распаковка общая (`baked.ts`); здесь — то, что относится к набору:
 * масштаб, словарь «форма плитки → модель» и разделение фонаря на столб
 * и плафон.
 */
if (PROPS_PALETTE.length !== PROPS_SLOTS.length) {
  throw new Error(
    `палитра пропсов рассинхронизирована: слотов ${PROPS_SLOTS.length}, цветов ${PROPS_PALETTE.length}`,
  );
}

export type { PropModelName };

/** Семейство дороги: камень мостит замок, доски — лагерь на поляне. */
export type RoadFamily = 'камень' | 'дерево';

/** Плитка набора — 6 единиц по стороне. Объявление автора, не замер. */
const ROAD_SPAN = 6;

/**
 * Масштаб дороги: плитка встаёт в клетку стены — `CASTLE_CELL` клеток
 * локации. Ширина полотна у набора — половина плитки, то есть ровно
 * клетка локации: дорога совпадает с шагом, которым ходит герой.
 */
export const ROAD_SCALE = CASTLE_CELL / ROAD_SPAN;

/**
 * Словарь плиток. Всё в нём — **замер, а не вкус**: открытые рёбра каждой
 * модели промерены по запечённой геометрии тестом «точка у середины ребра
 * накрыта полотном» (см. историю в описании коммита).
 *
 * `turn` — сколько четвертей добавить к повороту симуляции: канон
 * `roads.ts` (прямая — север–юг, поворот — юг–восток, тройник открыт
 * всюду, кроме севера) против того, как модель нарисована. Единственное
 * расхождение — каменный поворот: он сворачивает с юга на **запад**,
 * зеркально деревянному, и доводится четвертью.
 *
 * `anchor` — где у модели середина клетки, в единицах набора. Начало
 * координат у всех плиток набора стоит в середине южного ребра; прямая
 * и крест несут полотно посередине клетки, а у поворота и тройника
 * сквозная полоса прижата к дальней половине — их клетка стоит на 1,5
 * единицы дальше. За это их рукав выступает за клетку на пол-единицы
 * и ложится **поверх** плиты соседа; `lift` разводит их по высоте,
 * чтобы плита не мерцала о плиту.
 */
const ROAD_TILES: Record<RoadFamily, Record<RoadTile, { model: PropModelName; turn: number; anchor: number; lift: number }>> = {
  'камень': {
    'прямая': { model: 'Road_stone_1', turn: 0, anchor: -3, lift: 0 },
    'поворот': { model: 'Road_stone_2', turn: 1, anchor: -4.5, lift: 0.008 },
    'тройник': { model: 'Road_stone_4', turn: 0, anchor: -4.5, lift: 0.016 },
    'крест': { model: 'Road_stone_3', turn: 0, anchor: -3, lift: 0 },
  },
  'дерево': {
    'прямая': { model: 'road_wood_4', turn: 0, anchor: -3, lift: 0 },
    'поворот': { model: 'Road_wood_1', turn: 0, anchor: -4.5, lift: 0.008 },
    'тройник': { model: 'Road_wood_2', turn: 0, anchor: -4.5, lift: 0.016 },
    'крест': { model: 'Road_wood_3', turn: 0, anchor: -3, lift: 0 },
  },
};

const cache = new Map<string, THREE.BufferGeometry>();

/** Геометрия плитки; поворот и подъём отдаются числами, а не геометрией. */
export function roadGeometry(
  family: RoadFamily,
  tile: RoadTile,
): { geometry: THREE.BufferGeometry; turn: number; lift: number } {
  const { model, turn, anchor, lift } = ROAD_TILES[family][tile];
  const key = `road:${model}`;
  const hit = cache.get(key);
  if (hit !== undefined) return { geometry: hit, turn, lift };
  const m = PROPS_MODELS[model];
  // Якорь — по регистрации набора (начало в середине южного ребра),
  // а не по габариту: у поворота габарит несимметричен рукаву.
  const fit: Fit = { scale: ROAD_SCALE, shift: [0, m.min[1], anchor] };
  const geometry = bakedGeometry([{ model: m, palette: PROPS_PALETTE }], fit);
  cache.set(key, geometry);
  return { geometry, turn, lift };
}

/* ---------- фонари ---------- */

/** Какой фонарь где стоит: чугунный уличный — замку, деревянный — лагерю. */
export const LAMP_OF: Record<RoadFamily, PropModelName> = {
  'камень': 'Lamp_2',
  'дерево': 'Lamp_1',
};

/**
 * Высота фонаря в клетках локации. Уличный выше деревянного: он стоит
 * у стены в два роста героя, и наравне с прохожим читался бы вешалкой.
 */
const LAMP_HEIGHT: Record<PropModelName, number> = {
  'Lamp_2': 2.4,
  'Lamp_1': 1.8,
} as Record<PropModelName, number>;

/** Слот плафона — единственное, что у фонаря светится. */
const GLOW_SLOT = PROPS_SLOTS.indexOf('латунь');

export interface LampParts {
  /** Столб и корпус — обычный запечённый материал. */
  readonly post: THREE.BufferGeometry;
  /** Плафон: ночью ему поднимают эмиссию, как стеклу хижины (§6.1.11). */
  readonly glow: THREE.BufferGeometry;
  /** Где у фонаря свет, в клетках локации от подошвы. */
  readonly lampAt: readonly [number, number, number];
}

const lampCache = new Map<string, LampParts>();

export function lampParts(name: PropModelName): LampParts {
  const hit = lampCache.get(name);
  if (hit !== undefined) return hit;
  const model = PROPS_MODELS[name];
  const span = model.max[1] - model.min[1];
  const height = LAMP_HEIGHT[name] ?? 2;
  const fit: Fit = {
    scale: span > 0 ? height / span : 1,
    shift: [(model.min[0] + model.max[0]) / 2, model.min[1], (model.min[2] + model.max[2]) / 2],
  };
  const all = new Set(PROPS_SLOTS.map((_, i) => i));
  all.delete(GLOW_SLOT);
  const parts: LampParts = {
    post: bakedGeometry([{ model, palette: PROPS_PALETTE, only: all }], fit),
    glow: bakedGeometry([{ model, palette: PROPS_PALETTE, only: new Set([GLOW_SLOT]) }], fit),
    // Плафоны висят у макушки; свет — чуть ниже неё, серединой фонаря.
    lampAt: [0, height * 0.78, 0],
  };
  lampCache.set(name, parts);
  return parts;
}

/** Материал набора: тот же запечённый, что у всех. */
export const propsMaterial = bakedMaterial;

/** Дальность и спад огонька фонаря — как у окна хижины: тот же тёплый свет. */
const LAMP_RANGE = 7;
const LAMP_DECAY = 1.4;
/** Сила огонька в полную ночь. */
const LAMP_NIGHT = 2.6;

/**
 * Материал плафона. Днём — латунь из палитры; ночью тот же кусок светится
 * тёплым. Светится плафон, а не фонарь: светящийся столб читался бы
 * не «фонарь горит», а «фонарь сделан из лампы» (§6.1.11 — то же у хижины).
 */
export function lampGlowMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.emissive = new THREE.Color(PALETTE.torch);
  material.emissiveIntensity = 0;
  return material;
}

/** Огонёк фонаря. Точечный, без теней и мерцания — по тем же причинам,
 *  что у окна хижины: тени — у солнца, дрожь — у пламени. */
export function lampLight(): THREE.PointLight {
  return new THREE.PointLight(PALETTE.torch, 0, LAMP_RANGE, LAMP_DECAY);
}

/**
 * Ночь фонарям: 0 — день, 1 — ночь. Плафоны и огоньки ведёт одна функция —
 * тёмный плафон при горящем свете читался бы сбоем.
 */
export function setLampsNight(
  night: number,
  glow: THREE.MeshLambertMaterial,
  lights: readonly THREE.PointLight[],
): void {
  const k = Math.min(1, Math.max(0, night));
  glow.emissiveIntensity = k;
  for (const light of lights) light.intensity = LAMP_NIGHT * k;
}
