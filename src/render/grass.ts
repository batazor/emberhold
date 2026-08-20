import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { idx } from '../sim/grid';
import type { GameLocation } from '../sim/types';
import type { Gust } from './cursorWind';
import { PALETTE } from './palette';

/**
 * Трава: одна InstancedMesh на всю локацию, один вызов отрисовки.
 *
 * Почему не как у Jarl (jarl-game.com/blog/2d-gpu-grass-rendering) — там
 * трава растеризуется compute-шейдером в atomic-буфер, потому что игра 2D
 * и глубину приходится писать руками. У нас §6: «сортировка по глубине
 * не пишется» — её делает z-буфер, и половина того шейдера решала бы
 * задачу, которой здесь нет. Compute к тому же требует WebGPU, а мы на
 * WebGLRenderer.
 *
 * Что оттуда взято: свойства травинки выводятся из хеша координаты корня
 * (никаких буферов на травинку), ветер — основная волна плюс гармоника
 * 0.4×, а суммарный изгиб гасится через 1-exp(-x), поэтому травинка
 * подходит к пределу асимптотически и никогда не ложится плашмя.
 *
 * Что взято из FluffyGrass (MIT, © 2023 Ebenezer): сам приём
 * «MeshLambertMaterial + onBeforeCompile». Но там подменяются оба шейдера
 * целиком, и вместе с ними теряются точечные источники — трава считается
 * только по направленному свету. Нам так нельзя: ночь и фонарь — это и есть
 * механика обзора (§11.4), трава обязана гаснуть вне круга света. Поэтому
 * тут дописаны ровно две вставки — смещение вершины и нормаль, — а туман,
 * тени, фонарь и тонмаппинг остаются штатными. Кода оттуда не скопировано.
 *
 * Текстур нет (§6.1): форма травинки — геометрия, вариация цвета — вершинный
 * градиент и цвет инстанса.
 */

/** Сегментов вдоль травинки: 3 → 7 вершин, 5 треугольников. */
const SEGMENTS = 3;

/** Ёмкость под травинку на клетку. Плотность меняется через mesh.count. */
export const GRASS_MAX_PER_TILE = 64;

/** Сколько источников толчка учитывает шейдер: герой и ближайшие враги. */
const PUSHERS = 6;

/**
 * Радиус порыва в клетках. Толчок героя гаснет за клетку, потому что это
 * раздвинутая ногами трава; ветру хватает примерно того же — пятно у
 * курсора, а не полполя.
 */
const GUST_RADIUS = 1.1;

/**
 * Сила полного порыва против 1.2 у шага героя: курсор ведут поверху,
 * и класть траву, как это делают ноги, ему не по чину.
 */
const GUST_PUSH = 0.65;

/**
 * Насколько полный наклон кладёт поле. Больше собственного размаха волны
 * (0.34): наклон обязан читаться как новое состояние поля, а не как
 * «ветер чуть посвежел».
 */
const TILT_BEND = 0.22;

/** Насколько полный наклон разгоняет саму волну. */
const TILT_GUST = 0.35;

/** Круговая частота отыгрыша, рад/с: качок туда-обратно за секунду. */
const GUST_SWING = 7;

/**
 * Волновое число, рад на клетку. Дальняя травинка получает толчок позже
 * ближней — на этом отставании порыв и читается волной, а не пятном,
 * которое включили и выключили целиком.
 */
const GUST_WAVE = 1.5;

export interface Pusher {
  readonly x: number;
  readonly z: number;
  /** Сила толчка; 0 — слот пустой. */
  readonly strength: number;
}

/**
 * Тот же шум, по которому проседает земля в raidView. Общий, потому что
 * травинка обязана стоять ровно на крышке своей клетки: разъехавшись,
 * они повиснут в воздухе на одних клетках и утонут на других.
 */
export function tileNoise(x: number, z: number): number {
  return ((((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) + 1) % 1);
}

/** Верх клетки земли в мировых координатах. */
export const tileTop = (x: number, z: number): number => -tileNoise(x, z) * 0.04;

export interface GrassPlan {
  /** Корни травинок: x, y, z подряд. Порядок — проход за проходом. */
  readonly roots: Float32Array;
  /** Травинок в одном проходе, оно же — число травяных клеток. */
  readonly perPass: number;
  readonly passes: number;
}

/**
 * Где растёт трава. Чистая функция: считается без three и проверяется
 * в Node (grass.rules.ts).
 *
 * Раскладка «проход за проходом», а не «клетка за клеткой», сделана ради
 * плотности: mesh.count = perPass × n прореживает поле равномерно, а не
 * оставляет половину локации лысой.
 */
export function plantGrass(loc: GameLocation, perTile: number): GrassPlan {
  const { size, blocked, evac, containers } = loc;

  // Клетки, где трава запрещена. Луч эвакуации и добыча обязаны читаться
  // с любой глубины (§11.1, §11.4) — трава перед ними встаёт вторым,
  // неуправляемым источником непрозрачности.
  const banned = new Set<number>([idx(size, evac.x, evac.z)]);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = evac.x + dx;
    const z = evac.z + dz;
    if (x >= 0 && z >= 0 && x < size && z < size) banned.add(idx(size, x, z));
  }
  for (const c of containers) banned.add(idx(size, c.x, c.z));

  const tiles: number[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = idx(size, x, z);
      if (blocked[i] === 1 || banned.has(i)) continue;
      tiles.push(i);
    }
  }

  // Сид локации, а не Math.random: та же локация обязана выглядеть так же
  // (§6 — воспроизводимость).
  const rng = mulberry32((loc.seed ^ 0x5f3a91) | 0);
  const roots = new Float32Array(tiles.length * perTile * 3);
  let w = 0;
  for (let pass = 0; pass < perTile; pass++) {
    for (const tile of tiles) {
      const tx = tile % size;
      const tz = (tile - tx) / size;
      const x = tx + rng() - 0.5;
      const z = tz + rng() - 0.5;
      roots[w++] = x;
      roots[w++] = tileTop(tx, tz);
      roots[w++] = z;
    }
  }

  return { roots, perPass: tiles.length, passes: perTile };
}

/** Травинка: лента, сужающаяся к кончику, с градиентом низ→верх. */
function bladeGeometry(): THREE.BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const normal: number[] = [];
  const base = new THREE.Color(PALETTE.grassBase);
  const tip = new THREE.Color(PALETTE.grassTip);
  const c = new THREE.Color();

  const push = (x: number, y: number): void => {
    position.push(x, y, 0);
    normal.push(0, 0, 1);
    // Градиент низ→верх вместо запечённого AO: у корня темно, к кончику
    // светлее. У Jarl это «base darkness → tip brightness», и оно же держит
    // объём поля без единой текстуры.
    c.copy(base).lerp(tip, y);
    color.push(c.r, c.g, c.b);
  };

  for (let i = 0; i < SEGMENTS; i++) {
    const h = i / SEGMENTS;
    const half = 0.5 * (1 - h * 0.8);
    push(-half, h);
    push(half, h);
  }
  push(0, 1); // кончик

  const index: number[] = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (SEGMENTS - 1) * 2;
  index.push(last, last + 1, SEGMENTS * 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geo.setIndex(index);
  return geo;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly plan: GrassPlan;
  private readonly uniforms = {
    uGrassTime: { value: 0 },
    // xz — направление ветра, z — длина волны по полю, w — скорость.
    uGrassWind: { value: new THREE.Vector4(0.86, 0.51, 0.55, 1.6) },
    // Наклон устройства: куда и насколько лежит поле (render/tiltWind.ts).
    uGrassTilt: { value: new THREE.Vector2() },
    uGrassSway: { value: 0.34 },
    uGrassLean: { value: 0.22 },
    uGrassMaxBend: { value: 0.42 },
    uGrassPushers: {
      value: Array.from({ length: PUSHERS }, () => new THREE.Vector3()),
    },
    // xy — где курсор, z — сила порыва (0 — ветра нет), w — его возраст.
    uGrassGust: { value: new THREE.Vector4(0, 0, 0, 0) },
    /** Куда дует. Отдельно от позиции: в vec4 места уже нет. */
    uGrassGustDir: { value: new THREE.Vector2(1, 0) },
  };

  constructor(loc: GameLocation, perTile: number, maxPerTile = GRASS_MAX_PER_TILE) {
    // Ёмкость отдельным доводом: у заставки поле вчетверо больше локации,
    // и держать под ним запас на 64 травинки с клетки — впустую занятая память.
    this.plan = plantGrass(loc, Math.max(perTile, maxPerTile));
    this.geometry = bladeGeometry();
    this.material = new THREE.MeshLambertMaterial({
      // Травинка плоская, и её видно с обеих сторон. Прозрачности нет
      // намеренно: alphaTest и очередь прозрачных — самый дорогой режим
      // для мобильного тайлового GPU, а форму нам даёт геометрия.
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.patch(this.material);

    const total = this.plan.perPass * this.plan.passes;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, total);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // Тени трава не отбрасывает: §6 держит бюджет теней жёстко, и карта
    // 1024 на всю локацию всё равно не разрешит травинку. Принимает —
    // иначе тень камня по ней не проходит и камень висит над полем.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const rng = mulberry32((loc.seed ^ 0x2b1d07) | 0);
    for (let i = 0; i < total; i++) {
      const h = 0.3 + rng() * 0.2;
      // Поворот не в матрицу инстанса: он выводится в шейдере из хеша корня,
      // и матрица остаётся сдвигом с масштабом. Тогда локальные оси совпадают
      // с мировыми, и изгиб считается прямо в них, без обратных поворотов.
      dummy.position.set(this.plan.roots[i * 3]!, this.plan.roots[i * 3 + 1]!, this.plan.roots[i * 3 + 2]!);
      dummy.scale.set(0.055 + rng() * 0.03, h, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      // Цвет инстанса — множитель около единицы, а не второй цвет: он
      // перемножается с вершинным градиентом, и полноценный цвет здесь
      // умножал бы траву саму на себя и топил её в черноте.
      // setRGB пишет в рабочее (линейное) пространство — как раз множитель.
      const v = (0.82 + rng() * 0.36) * (1 - loc.tier * 0.05);
      tint.setRGB(v * (0.94 + rng() * 0.12), v, v * (0.88 + rng() * 0.14));
      this.mesh.setColorAt(i, tint);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();

    this.setDensity(perTile);
  }

  /** Травинок на клетку. Меняется на лету: пересборки нет, режется count. */
  setDensity(perTile: number): void {
    const passes = Math.max(0, Math.min(this.plan.passes, Math.round(perTile)));
    this.mesh.count = this.plan.perPass * passes;
  }

  get blades(): number {
    return this.mesh.count;
  }

  /**
   * pushers — герой и ближайшие враги. Толчок от скорости, как у Jarl,
   * пока упрощён до присутствия: движение читается и так, а скорость
   * потребует хранить прошлую позицию каждого врага.
   */
  /**
   * Ветер от наклона устройства: (x, z) — мировое направление, strength —
   * 0..1. Поле ложится в эту сторону и качается сильнее.
   */
  setTilt(x: number, z: number, strength: number): void {
    this.uniforms.uGrassTilt.value.set(x * strength * TILT_BEND, z * strength * TILT_BEND);
    this.uniforms.uGrassSway.value = 0.34 * (1 + strength * TILT_GUST);
  }

  update(timeSec: number, pushers: readonly Pusher[], gust: Gust | null = null): void {
    this.uniforms.uGrassTime.value = timeSec;
    const slots = this.uniforms.uGrassPushers.value;
    for (let i = 0; i < PUSHERS; i++) {
      const p = pushers[i];
      if (p === undefined) slots[i]!.set(0, 0, 0);
      else slots[i]!.set(p.x, p.z, p.strength);
    }

    // Курсор — не седьмой толчок: он не тело, а источник ветра, и живёт
    // своей силой (render/cursorWind.ts).
    if (gust === null) {
      this.uniforms.uGrassGust.value.set(0, 0, 0, 0);
    } else {
      this.uniforms.uGrassGust.value.set(gust.x, gust.z, gust.strength * GUST_PUSH, gust.age);
      this.uniforms.uGrassGustDir.value.set(gust.dirX, gust.dirZ);
    }
  }

  /**
   * Выкосить траву на клетке. Под зданием её быть не должно: шатёр, стоящий
   * в нетронутом поле, читается как декорация, поставленная сверху, а не как
   * расчищенное место, на котором решили остаться.
   *
   * Травинки не удаляются, а схлопываются в ноль: количество экземпляров
   * задаёт прореживание по плотности (`setDensity`), и вырезать из середины
   * значило бы пересобирать весь план.
   */
  clearCell(x: number, z: number, radius = 0.62): void {
    const total = this.plan.perPass * this.plan.passes;
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    let cut = 0;
    for (let i = 0; i < total; i++) {
      const rx = this.plan.roots[i * 3]!;
      const rz = this.plan.roots[i * 3 + 2]!;
      if (Math.abs(rx - x) > radius || Math.abs(rz - z) > radius) continue;
      dummy.position.set(rx, this.plan.roots[i * 3 + 1]!, rz);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      cut++;
    }
    if (cut > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * Две вставки в штатный шейдер Lambert. Всё остальное — свет, тени, туман,
   * тонмаппинг — остаётся как есть, и трава гаснет вместе со сценой.
   */
  private patch(material: THREE.MeshLambertMaterial): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uGrassTime;
          uniform vec4 uGrassWind;
          uniform float uGrassSway;
          uniform float uGrassLean;
          uniform float uGrassMaxBend;
          uniform vec3 uGrassPushers[${PUSHERS}];
          uniform vec4 uGrassGust;
          uniform vec2 uGrassGustDir;
          uniform vec2 uGrassTilt;

          // hash22: два независимых числа из координаты корня. Свойства
          // травинки не хранятся нигде — они выводятся, как у Jarl.
          vec2 grassHash(vec2 p) {
            vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
            q += dot(q, q.yzx + 33.33);
            return fract((q.xx + q.yz) * q.zy);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          vec3 gRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 gHash = grassHash(gRoot.xz);
          float gYaw = gHash.x * 6.2831853;
          vec2 gDir = vec2(cos(gYaw), sin(gYaw));
          // Нормаль задрана вверх, а не строго поперёк травинки: плоская
          // травинка иначе мигает при повороте камеры и проваливается
          // в черноту боком к фонарю.
          objectNormal = normalize(vec3(-gDir.y * 0.55, 1.0, gDir.x * 0.55));`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // position.y здесь 0..1 — доля высоты: высота задана масштабом инстанса.
          float gH = transformed.y;
          transformed.xz = gDir * transformed.x;

          float gPhase = gHash.y * 6.2831853;
          float gWave = dot(uGrassWind.xy, gRoot.xz) * uGrassWind.z;
          // Основная волна плюс гармоника на 0.4× частоты: одна синусоида
          // читается как расчёсанное поле.
          float gSway = sin(uGrassTime * uGrassWind.w + gWave + gPhase)
                      + 0.35 * sin(uGrassTime * uGrassWind.w * 0.4 + gWave * 1.7 + gPhase);
          vec2 gBend = uGrassWind.xy * gSway * uGrassSway;
          gBend += vec2(cos(gPhase), sin(gPhase)) * uGrassLean;
          // Наклон устройства: ровный, постоянный крен всего поля. Он
          // складывается с волной, а не заменяет её, поэтому наклонённое
          // поле продолжает жить, а не застывает лежащим.
          gBend += uGrassTilt;

          for (int i = 0; i < ${PUSHERS}; i++) {
            vec3 p = uGrassPushers[i];
            if (p.z <= 0.0) continue;
            vec2 d = gRoot.xz - p.xy;
            float dist = length(d) + 1e-4;
            gBend += (d / dist) * p.z * exp(-dist * dist * 1.6);
          }

          // Порыв от курсора. Две доли: по ходу курсора — сам ветер, врозь
          // от точки — то, чем ветер обтекает препятствие. Одной первой мало:
          // поле причёсывалось бы гребёнкой, и точка, откуда дует, пропадала.
          if (uGrassGust.z > 0.0) {
            vec2 gToBlade = gRoot.xz - uGrassGust.xy;
            float gGustDist = length(gToBlade);
            float gGustFall = exp(-gGustDist * gGustDist / (${GUST_RADIUS.toFixed(3)} * ${GUST_RADIUS.toFixed(3)}));
            vec2 gFlow = uGrassGustDir + (gToBlade / (gGustDist + 1e-4)) * 0.5;
            // Волна: толчок расходится от курсора и отыгрывает назад.
            // Косинус уходит в минус — трава качается обратно, как после
            // настоящего порыва, а не встаёт по линейке.
            float gWaveT = cos(uGrassGust.w * ${GUST_SWING.toFixed(3)} - gGustDist * ${GUST_WAVE.toFixed(3)});
            gBend += gFlow * uGrassGust.z * gGustFall * gWaveT;
          }

          // 1-exp(-x): изгиб подходит к пределу асимптотически. Без этого
          // герой в толпе травы клал бы её плашмя.
          float gLen = length(gBend);
          gBend = gLen > 1e-5 ? (gBend / gLen) * (1.0 - exp(-gLen)) * uGrassMaxBend : vec2(0.0);
          // Кончик гнётся сильнее середины, и согнутая травинка ниже прямой.
          float gCurve = gH * gH;
          // Матрица инстанса сжимает локальный x в ширину травинки (≈0.07),
          // а z оставляет как есть. Изгиб задан в мировых единицах, поэтому
          // его x-часть делится на этот масштаб: иначе ветер вдоль x слабее
          // поперечного в четырнадцать раз, и поле качается только по одной
          // оси. Ровно из-за этого не читался ни толчок героя, ни курсор.
          float gScaleX = length(instanceMatrix[0].xyz);
          transformed.x += gBend.x * gCurve / gScaleX;
          transformed.z += gBend.y * gCurve;
          transformed.y -= gLen * gLen * 0.18 * gCurve;`,
        );
    };
  }
}
