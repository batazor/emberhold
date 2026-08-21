import * as THREE from 'three';

/**
 * Словарь форм артбука, перенесённый в игру.
 *
 * `artbook.html` и `buildart.html` рисуют блокинг настоящей геометрией под той же
 * ортокамерой 45°/30°, что и игра, — и делают это шестью примитивами: коробка,
 * клин, пирамида, цилиндр, конус и жердь между двумя точками. Здесь ровно они,
 * один в один по сигнатурам, чтобы модель переносилась со страницы в код
 * построчно и её можно было сверить глазами, а не переписывать заново.
 *
 * Соглашение артбука: **cy — это низ фигуры, а не центр.** У three наоборот,
 * поэтому перенос делается здесь один раз, а не в каждой модели.
 *
 * Всё собирается в одну геометрию с вершинными цветами: у здания получается
 * один вызов отрисовки вместо десятка мешей. Это же условие §6.1 — цвет задаётся
 * материалом, текстур нет вовсе.
 */

/**
 * 34 цвета на всю игру (артбук, раздел 02). Ключи те же, что в `buildart.html`.
 *
 * Цветов было 28. Кожу и сукно завёл набор персонажей (§6.1.4): телесного тона
 * среди 28 не было — скелетам он был не нужен, — а тёплому ненасыщенному негде
 * было встать между деревом и камнем, и оно уходило в камень, делая персонажа
 * каменным. Сукном красится и сукно скелетов: два набора обязаны читать
 * одинаковое одинаково.
 */
export const C = {
  mrak: '#0e0d0a', ten: '#1a1813', kamT: '#2b2a24', kam: '#3f3d34', kamS: '#57544a',
  skol: '#6f6c60', solT: '#8a8a7e', sol: '#a6a698', solS: '#c6c6b6', iney: '#e2e2d6',
  zemT: '#3b2016', zem: '#6e3826', derT: '#8f4e33', der: '#b06b45', derS: '#cb9160',
  solom: '#e3ba85',
  hvoT: '#1f2b1a', hvo: '#31432a', moh: '#465c39', trav: '#5d7a49', travS: '#7fa361',
  metT: '#2b3138', met: '#474f58', stal: '#7d8892',
  kozh: '#dcd2b0',
  sukT: '#3c332c', suk: '#5c4f43', sukS: '#847263',
  ugol: '#4d2a10', zhar: '#8e4a17', plam: '#c9722a', lat: '#dfa53c',
  krasA: '#d83f35', krasS: '#268eca',
  steklo: '#6f9bb5',
} as const;

export type V3 = readonly [number, number, number];

export interface Piece {
  readonly geo: THREE.BufferGeometry;
  readonly color: string;
}

const piece = (geo: THREE.BufferGeometry, color: string): Piece => ({ geo, color });

/** Коробка. cy — низ. */
export const box = (
  cx: number, cy: number, cz: number,
  w: number, h: number, d: number, color: string,
): Piece => piece(new THREE.BoxGeometry(w, h, d).translate(cx, cy + h / 2, cz), color);

/** Цилиндр. cy — низ. */
export const cyl = (
  cx: number, cy: number, cz: number,
  r: number, h: number, seg: number, color: string,
): Piece =>
  piece(new THREE.CylinderGeometry(r, r, h, seg).translate(cx, cy + h / 2, cz), color);

/** Конус. cy — низ. */
export const cone = (
  cx: number, cy: number, cz: number,
  r: number, h: number, seg: number, color: string,
): Piece => piece(new THREE.ConeGeometry(r, h, seg).translate(cx, cy + h / 2, cz), color);

/**
 * Клин — двускатная крыша. Конёк идёт вдоль X, фронтоны на ±X.
 * Именно он, а не конус, задаёт зданию перёд (`buildart.html`, раздел 02):
 * у конуса нет направления, и лагерь из конусов не компонуется.
 */
export function wedge(
  cx: number, cy: number, cz: number,
  w: number, h: number, d: number, color: string,
): Piece {
  const x = w / 2;
  const z = d / 2;
  const v: V3[] = [
    [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z],
    [-x, h, 0], [x, h, 0],
  ];
  const faces = [[0, 3, 2, 1], [3, 4, 5, 2], [0, 1, 5, 4], [0, 4, 3], [1, 2, 5]];
  return piece(fromFaces(v, faces).translate(cx, cy, cz), color);
}

/** Пирамида с прямоугольным основанием. */
export function pyr(
  cx: number, cy: number, cz: number,
  w: number, h: number, d: number, color: string,
): Piece {
  const x = w / 2;
  const z = d / 2;
  const v: V3[] = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, h, 0]];
  const faces = [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
  return piece(fromFaces(v, faces).translate(cx, cy, cz), color);
}

/** Жердь между двумя точками: стойки, растяжки, поленья. */
export function rod(a: V3, b: V3, r: number, seg: number, color: string): Piece {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length() || 1e-6;
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  geo.applyQuaternion(q);
  geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return piece(geo, color);
}

/** Поворот вокруг Y и перенос — им ставятся камни кольца и повёрнутые детали. */
export function put(p: Piece, angY: number, dx = 0, dy = 0, dz = 0): Piece {
  p.geo.rotateY(angY);
  p.geo.translate(dx, dy, dz);
  return p;
}

/** Многоугольные грани в треугольники: артбук описывает формы гранями. */
function fromFaces(v: readonly V3[], faces: readonly number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      for (const idx of [f[0]!, f[i]!, f[i + 1]!]) {
        const p = v[idx]!;
        pos.push(p[0], p[1], p[2]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Сборка модели в одну геометрию с вершинными цветами.
 *
 * Один вызов отрисовки на здание вместо десятка мешей: бюджет из артбука —
 * ≤1500 треугольников на здание, и он про читаемость силуэта, а не про GPU,
 * но десяток отдельных мешей на каждую постройку упёрся бы уже в вызовы.
 */
export function merge(parts: readonly Piece[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();

  for (const part of parts) {
    const g = part.geo.index === null ? part.geo : part.geo.toNonIndexed();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    // setStyle переводит цвет из sRGB в рабочее пространство — иначе палитра
    // артбука на экране светлее, чем на странице, ровно на гамму.
    c.setStyle(part.color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** Материал блокинга. Один на все модели: цвет приходит вершинами. */
export const blockingMaterial = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Треугольники модели — тем же счётом, каким артбук меряет бюджет.
 *  У индексированной геометрии их считают индексы, а не вершины. */
export const triangles = (geo: THREE.BufferGeometry): number =>
  (geo.index?.count ?? geo.getAttribute('position').count) / 3;
