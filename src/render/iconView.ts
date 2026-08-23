import * as THREE from 'three';
import { PALETTE } from './palette';
import { ADVENTURERS_PALETTE, DUNGEON_PALETTE, PROPS_PALETTE, WEAPONS_PALETTE } from './palette';
import { ADVENTURERS_MODELS } from './adventurers.data';
import { DUNGEON_MODELS } from './dungeon.data';
import { PROPS_MODELS } from './props.data';
import { WEAPONS_MODELS } from './weapons.data';
import { TOOLS_MODELS } from './tools.data';
import { TOOLS_PALETTE } from './palette';
import { bakedGeometry, bakedMaterial } from './baked';

/**
 * Значок вещи — та же модель, что игрок видит в кадре, снятая маленьким
 * кадром.
 *
 * **Зачем не рисованный значок.** Сумка из текстовых плашек читается
 * глазами, а вещь берут пальцем. Рисовать иконки руками значило бы завести
 * второй словарь предметов рядом с наборами: подпись «щит» и щит в руке
 * героя разошлись бы молча — ровно тем же путём, каким расходились панели
 * до словаря (`style.css`). Здесь значок и вещь — одна геометрия.
 *
 * **Один контекст на все значки.** Девять клеток сумки — это девять WebGL,
 * если каждой дать свой холст, а браузер держит их полтора десятка на
 * вкладку и глушит старые. Поэтому рендерер один и общий: он рисует значок
 * и отдаёт его картинкой на обычный двумерный холст, который уже ничего
 * не стоит.
 *
 * **Ракурс игровой.** 45°/30°, как камера лагеря: вещь на значке и вещь
 * в руке обязаны выглядеть одинаково, иначе значок — не про неё.
 *
 * Своей модели нет у большинства слотов — шлема, куртки, сапог, кольца
 * в наборах попросту нет. Такая вещь остаётся подписью, и это записано
 * в `features/character/items.ts` при самой вещи, а не подменяется похожей
 * моделью: похожая читалась бы как «вот эта самая».
 */
export type IconName =
  | 'кайло'
  | 'топор'
  | 'клинок'
  | 'щит'
  | 'лук'
  | 'кинжал'
  | 'фонарь'
  | 'короб'
  | 'колчан';

/** Из какого набора берётся вещь. Пара «модель + палитра», больше ничего. */
const SOURCE: Record<IconName, { model: Parameters<typeof bakedGeometry>[0][number]['model']; palette: readonly number[] }> = {
  кайло: { model: TOOLS_MODELS['pickaxe'], palette: TOOLS_PALETTE },
  топор: { model: TOOLS_MODELS['axe'], palette: TOOLS_PALETTE },
  клинок: { model: WEAPONS_MODELS['sword_C'], palette: WEAPONS_PALETTE },
  щит: { model: ADVENTURERS_MODELS['shield_round'], palette: ADVENTURERS_PALETTE },
  лук: { model: ADVENTURERS_MODELS['bow_withString'], palette: ADVENTURERS_PALETTE },
  кинжал: { model: ADVENTURERS_MODELS['dagger'], palette: ADVENTURERS_PALETTE },
  фонарь: { model: PROPS_MODELS['Lamp_1'], palette: PROPS_PALETTE },
  короб: { model: DUNGEON_MODELS['chest'], palette: DUNGEON_PALETTE },
  колчан: { model: ADVENTURERS_MODELS['arrow_bow'], palette: ADVENTURERS_PALETTE },
};

const geometries = new Map<IconName, THREE.BufferGeometry>();

/** Геометрия вещи в единицах набора. Общая со значком и с рукой фигуры. */
export function iconGeometry(name: IconName): THREE.BufferGeometry {
  const hit = geometries.get(name);
  if (hit !== undefined) return hit;
  const source = SOURCE[name];
  const geometry = bakedGeometry([{ model: source.model, palette: source.palette }]);
  geometries.set(name, geometry);
  return geometry;
}

/* ---------- общий рендерер значков ---------- */

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
let mount: THREE.Mesh | null = null;

function stage(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; mesh: THREE.Mesh } {
  if (renderer === null || scene === null || mount === null) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x2b2519, 1.5));
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.8);
    sun.position.set(-4, 6, 3);
    scene.add(sun);
    mount = new THREE.Mesh(new THREE.BufferGeometry(), bakedMaterial());
    scene.add(mount);
  }
  return { renderer, scene, mesh: mount };
}

const cache = new Map<string, HTMLCanvasElement>();

/** Наклон и поворот кадра — те же, что у камеры лагеря (§6.1). */
const ELEVATION = (30 * Math.PI) / 180;
const AZIMUTH = (45 * Math.PI) / 180;

/**
 * Значок вещи размером `size` — двумерный холст, который можно вставить
 * куда угодно и сколько угодно раз. Один и тот же значок считается один раз.
 */
export function itemIcon(name: IconName, size: number): HTMLCanvasElement {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Клонируется картинка, а не пересчитывается кадр: одна вещь может
    // лежать и в слоте, и в подсказке, и в двойнике под пальцем.
    const copy = document.createElement('canvas');
    copy.width = hit.width;
    copy.height = hit.height;
    copy.getContext('2d')?.drawImage(hit, 0, 0);
    return copy;
  }

  const { renderer: gl, scene: sc, mesh } = stage();
  const geometry = iconGeometry(name);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const centre = box.getCenter(new THREE.Vector3());
  const span = Math.max(1e-3, box.getSize(new THREE.Vector3()).length());

  mesh.geometry = geometry;
  mesh.position.set(-centre.x, -centre.y, -centre.z);

  // Кадр по размеру вещи: кайло и кольцо в одной сетке обязаны занимать
  // клетку одинаково, иначе значок меряет вещь, а не показывает её.
  const half = span * 0.55;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  const dist = 12;
  camera.position.set(
    Math.sin(AZIMUTH) * Math.cos(ELEVATION) * dist,
    Math.sin(ELEVATION) * dist,
    Math.cos(AZIMUTH) * Math.cos(ELEVATION) * dist,
  );
  camera.lookAt(0, 0, 0);

  const px = Math.max(1, Math.round(size * Math.min(devicePixelRatio, 2)));
  gl.setSize(px, px, false);
  gl.render(sc, camera);

  const out = document.createElement('canvas');
  out.width = px;
  out.height = px;
  out.getContext('2d')?.drawImage(gl.domElement, 0, 0);
  cache.set(key, out);
  return itemIcon(name, size);
}
