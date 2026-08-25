import * as THREE from 'three';
import { C } from './blocking';
import { FIRE_MID, fireOf } from './models';
import type { FireSpot } from './models';
import { PALETTE } from './palette';
import { campFireStyle, type CampFireStyle } from '../core/cosmetics';

/**
 * Огонь: пламя и его свет. Костёр под открытым небом, очаг под навесом.
 *
 * **Свет.** §6 держит на тенях один источник, солнце, и второй теневой заявлен
 * там отдельным решением, а не мелочью. Костёр к нему и не просится: точечный
 * свет без теней — ровно то, чем в игре уже светит фонарь героя, и стоит он
 * столько же. Силуэты вокруг костра рисует солнце, костёр красит землю.
 *
 * **Пламя.** Единственная деталь здания, которой стоять неподвижно нельзя:
 * неподвижный огонь читается не как огонь, а как оранжевый конус. Поэтому
 * пламя ушло из запечённой модели сюда и живёт шейдером. Приём тот же, что
 * у травы (`grass.ts`): не свой материал с нуля, а штатный с двумя вставками,
 * — но материал взят Basic, а не Lambert: огонь светит сам, и солнце ему
 * не указ. Форма при этом осталась ровно та, что стояла в артбуке, — два
 * конуса и три цвета палитры; движение добавлено, силуэт не тронут.
 *
 * Модуль общий у поляны и лагеря: палатка с костром ставятся в прологе
 * (`raidView`) и остаются лагерем (`campView`), и это один и тот же костёр.
 * Гореть на поляне и погаснуть в лагере он не имеет права.
 */

/**
 * Сила света в канделах: с three r155 точечный свет делится на квадрат
 * расстояния, и подбирать её на глаз нечестно — рядом в `scene.ts` фонарь
 * героя уже приведён замером по кадру (5 кд давали 49 из 255 при фоне 40,
 * то есть ничего; 22 кд — 154). Костёр меньше фонаря и стоит на земле,
 * поэтому ночью он взят чуть слабее фонаря, а днём остаётся заметным пятном:
 * гасить его руками не нужно, в полуденном солнце он тонет сам.
 */
const FIRE_DAY = 9;
const FIRE_NIGHT = 20;

/** Докуда достаёт: три клетки. Костёр греет место, а не освещает лагерь. */
const FIRE_RANGE = 6.5;

/** Затухание. Мягче квадрата: у костра нет одной точки, из которой он светит. */
const FIRE_DECAY = 1.3;

const FIRE_STYLE: Readonly<Record<CampFireStyle, {
  readonly hot: string;
  readonly cool: string;
  readonly ember: string;
  readonly light: string | number;
  readonly wisp: string | number;
}>> = {
  standard: { hot: C.lat, cool: C.plam, ember: C.zhar, light: PALETTE.torch, wisp: C.lat },
  ghostfire: { hot: '#f4ffff', cool: '#75d9d1', ember: '#315d5a', light: '#9ff5ed', wisp: '#c9ffff' },
  witchfire: { hot: '#f2ddff', cool: '#a258e8', ember: '#4c216e', light: '#c37cff', wisp: '#e8b9ff' },
};

/** Paid flames get a tiny render-only corona; the light numbers above stay untouched. */
const WISP_COUNT = 12;

/**
 * Языки пламени в единицах модели, размер 1. Числа те же, которыми пламя
 * было записано в `models.ts`, — конус побольше снаружи, поменьше и ярче
 * внутри: артбук от переезда в шейдер ничего не потерял.
 */
const CONES = [
  { r: 0.34, h: 0.98, seg: 7, y: 0, core: 0 },
  { r: 0.18, h: 0.7, seg: 6, y: 0.08, core: 1 },
] as const;

/**
 * Геометрия пламени. `aRise` — доля высоты языка: по ней шейдер и качает,
 * и красит, поэтому качается верхушка, а подошва стоит на углях.
 * `aCore` отделяет внутренний язык от внешнего.
 */
function flameGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const rise: number[] = [];
  const core: number[] = [];
  for (const c of CONES) {
    const geo = new THREE.ConeGeometry(c.r, c.h, c.seg)
      .translate(0, c.y + c.h / 2, 0)
      .toNonIndexed();
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      rise.push(Math.min(1, Math.max(0, (p.getY(i) - c.y) / c.h)));
      core.push(c.core);
    }
    geo.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aRise', new THREE.Float32BufferAttribute(rise, 1));
  geometry.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1));
  return geometry;
}

/** Материал пламени: штатный Basic с двумя вставками. */
function flameMaterial(uniforms: Record<string, THREE.IUniform>): THREE.MeshBasicMaterial {
  // Тумана огню не положено — по той же причине, по которой его нет
  // у фонаря героя: он источник света в кадре, а не деталь позади него.
  const material = new THREE.MeshBasicMaterial({ fog: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFireTime;
        attribute float aRise;
        attribute float aCore;
        varying float vRise;
        varying float vCore;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRise = aRise;
        vCore = aCore;
        // Качается верхушка: амплитуда идёт квадратом высоты, поэтому
        // подошва пламени стоит на месте, а язык ходит.
        float fLean = aRise * aRise;
        transformed.x += (sin(uFireTime * 4.7 + transformed.z * 3.1) * 0.06
                        + sin(uFireTime * 9.1) * 0.025) * fLean;
        transformed.z += (cos(uFireTime * 5.9 + transformed.x * 2.6) * 0.05
                        + sin(uFireTime * 7.7) * 0.02) * fLean;
        // Дыхание: пламя тянется вверх и опадает, сужаясь и толстея, —
        // объём остаётся, а высота ходит. Две несоразмерные волны, чтобы
        // дыхание не стало метрономом.
        float fBreath = 1.0 + sin(uFireTime * 6.1) * 0.11 + sin(uFireTime * 11.3) * 0.05;
        transformed.y *= fBreath;
        transformed.xz *= 1.0 - (fBreath - 1.0) * 0.5;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFireTime;
        uniform vec3 uFireHot;
        uniform vec3 uFireCool;
        uniform vec3 uFireEmber;
        varying float vRise;
        varying float vCore;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Снизу вверх: угли, тело пламени, остывающий язык. Внутренний
        // конус — сам жар, он не остывает.
        vec3 fCol = mix(uFireCool, uFireHot, 1.0 - vRise);
        fCol = mix(fCol, uFireEmber, smoothstep(0.22, 0.0, vRise));
        fCol = mix(fCol, uFireHot, vCore);
        // Подрагивание яркости: тот же огонь, что дышит формой, дышит и светом.
        fCol *= 1.0 + sin(uFireTime * 9.3 + vRise * 5.0) * 0.09;
        diffuseColor.rgb = fCol;`,
      );
  };
  return material;
}

export class Fire {
  /** Что ставит в сцену вызывающий: пламя и свет ходят вместе. */
  readonly group = new THREE.Group();
  private readonly light = new THREE.PointLight(PALETTE.torch, 0, FIRE_RANGE, FIRE_DECAY);
  private readonly uniforms: Record<string, THREE.IUniform> = {
    uFireTime: { value: 0 },
    uFireHot: { value: new THREE.Color(C.lat) },
    uFireCool: { value: new THREE.Color(C.plam) },
    uFireEmber: { value: new THREE.Color(C.zhar) },
  };
  private readonly geometry = flameGeometry();
  private readonly material = flameMaterial(this.uniforms);
  private readonly flame = new THREE.Mesh(this.geometry, this.material);
  private readonly wispPositions = new Float32Array(WISP_COUNT * 3);
  private readonly wispGeometry = new THREE.BufferGeometry();
  private readonly wispMaterial = new THREE.PointsMaterial({
    color: C.lat,
    size: 0.075,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  private readonly wisps = new THREE.Points(this.wispGeometry, this.wispMaterial);
  private spot: FireSpot | null = null;
  private style: CampFireStyle = 'standard';

  constructor() {
    this.wispGeometry.setAttribute('position', new THREE.BufferAttribute(this.wispPositions, 3));
    this.group.add(this.light, this.flame, this.wisps);
    this.clear();
  }

  /** Cosmetic fire changes colour only; size, range and intensity stay on the balance path above. */
  setStyle(value: unknown): void {
    this.style = campFireStyle(value);
    const style = FIRE_STYLE[this.style];
    (this.uniforms['uFireHot']!.value as THREE.Color).set(style.hot);
    (this.uniforms['uFireCool']!.value as THREE.Color).set(style.cool);
    (this.uniforms['uFireEmber']!.value as THREE.Color).set(style.ember);
    this.light.color.set(style.light);
    this.wispMaterial.color.set(style.wisp);
    this.wisps.visible = this.spot !== null && this.style !== 'standard';
  }

  /**
   * Поставить огонь здания на клетку. Где именно он горит, решает не сцена,
   * а модель: `fireOf` отдаёт ту же запись, по которой пламя стояло в артбуке,
   * поэтому свет и пламя не могут оказаться в стороне друг от друга. Стадия
   * без открытого огня — каменная кухня, каменная кузница — гасит огонь,
   * а не двигает его.
   */
  set(id: Parameters<typeof fireOf>[0], level: number, x: number, z: number, scale: number): void {
    this.spot = fireOf(id, level);
    if (this.spot === null) {
      this.clear();
      return;
    }
    const [dx, dy, dz, size] = this.spot;
    this.light.visible = true;
    this.flame.visible = true;
    this.flame.position.set(x + dx * scale, dy * scale, z + dz * scale);
    this.flame.scale.setScalar(size * scale);
    this.wisps.position.copy(this.flame.position);
    this.wisps.scale.setScalar(size * scale);
    this.wisps.visible = this.style !== 'standard';
    // Свет стоит в середине языка пламени, а не в его подошве: из подошвы
    // костёр светил бы себе под угли.
    this.light.position.set(x + dx * scale, (dy + FIRE_MID * size) * scale, z + dz * scale);
    this.light.distance = FIRE_RANGE * size;
  }

  /** Огня нет: место не занято, здание не построено. */
  clear(): void {
    this.spot = null;
    this.light.visible = false;
    this.flame.visible = false;
    this.wisps.visible = false;
  }

  /** now — миллисекунды сессии, day — доля дня (1 — полдень). */
  update(now: number, day: number): void {
    if (this.spot === null) return;
    this.uniforms['uFireTime']!.value = now / 1000;
    if (this.style !== 'standard') {
      const time = now / 1000;
      for (let i = 0; i < WISP_COUNT; i++) {
        const phase = (time * (0.22 + (i % 3) * 0.035) + i * 0.173) % 1;
        const turn = time * (1.1 + (i % 4) * 0.13) + i * 2.17;
        const radius = 0.08 + phase * 0.22;
        const at = i * 3;
        this.wispPositions[at] = Math.sin(turn) * radius;
        this.wispPositions[at + 1] = 0.16 + phase * 1.28;
        this.wispPositions[at + 2] = Math.cos(turn * 0.91) * radius;
      }
      this.wispGeometry.getAttribute('position').needsUpdate = true;
      this.wispMaterial.opacity = 0.58 + Math.sin(time * 5.7) * 0.14;
    }
    // Мерцание света двумя несоразмерными волнами — тот же приём, что
    // у дыхания пламени, но волны другие: свет и форма не обязаны совпадать.
    const flicker = 1 + Math.sin(now / 90) * 0.06 + Math.sin(now / 37) * 0.035;
    // Очаг под навесом меньше костра — и светит соразмерно, а не одинаково.
    this.light.intensity = (FIRE_DAY + (1 - day) * (FIRE_NIGHT - FIRE_DAY)) * this.spot[3] * flicker;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.wispGeometry.dispose();
    this.wispMaterial.dispose();
  }
}
