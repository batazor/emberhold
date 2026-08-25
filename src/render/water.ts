/**
 * Вода: ров замка и ручей у мельницы (§6.1.6).
 *
 * До этого модуля вода была неподвижным синим квадратом Ламберта, и
 * читалась она не водой, а краской, пролитой по клеткам плана. Двигаться —
 * единственное, что отличает воду от синего пола, поэтому она ушла в шейдер
 * тем же приёмом, что пламя (`fire.ts`) и трава (`grass.ts`): не свой
 * материал с нуля, а штатный Lambert с двумя вставками. Свет, туман и
 * прозрачность остаются штатными — движение добавлено, место в кадре
 * не тронуто.
 *
 * Три слагаемых, все счётные и все от мировых координат, чтобы клетки
 * инстансов складывались в одну поверхность, а не дрожали каждая о своём:
 *
 * 1. **Форма.** Вершины дышат по высоте двумя несоразмерными волнами —
 *    тот же довод, что у пламени: соразмерные волны дают метроном.
 *    Подошва волны стоит на высоте клетки, гребень поднимается над ней,
 *    поэтому вода не ныряет под грунт и не спорит с ним глубиной.
 * 2. **Цвет.** Полосы глубокого и светлого оттенков ходят по поверхности
 *    независимо от формы: у воды блики и толща живут разными скоростями.
 * 3. **Гребень.** Короткая светлая искра на пике волны. Не постоянная
 *    пена — пятно света, которое собирается и расходится.
 *
 * Оттенки выведены из «краски-синей» (#268eca, §6.1): тот же цвет,
 * которым вода была покрашена до шейдера, — темнее в толще, светлее
 * на полосе, почти белый на гребне.
 */
import * as THREE from 'three';

/** Толща, полоса и гребень — все три от «краски-синей» #268eca. */
const DEEP = new THREE.Color('#1b6796');
const LIGHT = new THREE.Color('#3fa9dd');
const CREST = new THREE.Color('#d6f0fa');

/** Насколько гребень поднимается над подошвой волны, в единицах мира. */
const SWELL = 0.05;

/** Единый счётчик секунд на все воды кадра: ров и ручей — одна погода. */
export const waterUniforms = (): Record<string, THREE.IUniform> => ({
  uWaterTime: { value: 0 },
});

/**
 * Клетка воды со складками. Плоскости без сегментов волне не хватило бы
 * вершин: квадрат 2×2 качался бы целиком, как плот, а не как вода.
 */
export function waterGeometry(size: number, segments: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Материал воды. Прозрачность и порядок отрисовки — те же, что были
 * у неподвижного квадрата: их подбирала читаемость плана, а не движение.
 */
export function waterMaterial(
  uniforms: Record<string, THREE.IUniform>,
  opacity: number,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterTime;
        varying vec2 vWaterWorld;
        varying float vWaterLift;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Волна считается в мире: клетки инстансов обязаны сложиться
        // в одну поверхность, а не качаться каждая о своём.
        vec4 wWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wWorld = instanceMatrix * wWorld;
        #endif
        wWorld = modelMatrix * wWorld;
        vWaterWorld = wWorld.xz;
        float wLift = sin(wWorld.x * 1.9 + uWaterTime * 1.3) * 0.5
                    + sin(wWorld.z * 2.6 - uWaterTime * 0.9) * 0.3
                    + sin((wWorld.x + wWorld.z) * 1.1 + uWaterTime * 0.6) * 0.2;
        vWaterLift = wLift * 0.5 + 0.5;
        transformed.y += vWaterLift * ${SWELL.toFixed(3)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterTime;
        uniform vec3 uWaterDeep;
        uniform vec3 uWaterLight;
        uniform vec3 uWaterCrest;
        varying vec2 vWaterWorld;
        varying float vWaterLift;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Полосы цвета ходят своим ходом, не в такт форме: блики и толща
        // у воды живут разными скоростями. Поле .y тут — мировая Z: varying
        // собран из wWorld.xz, а у vec2 поля зовутся x и y.
        float wBand = sin(vWaterWorld.x * 2.3 + vWaterWorld.y * 1.4 + uWaterTime * 1.0)
                    + sin(vWaterWorld.x * 0.8 - vWaterWorld.y * 3.1 - uWaterTime * 0.7);
        float wShade = smoothstep(-1.6, 1.6, wBand);
        vec3 wCol = mix(uWaterDeep, uWaterLight, wShade);
        // Гребень: искра там, где волна на пике И полоса светлая, — пятно
        // собирается и расходится, а не лежит постоянной пеной.
        float wCrest = smoothstep(0.78, 0.97, vWaterLift) * smoothstep(0.9, 1.7, wBand);
        wCol = mix(wCol, uWaterCrest, wCrest * 0.85);
        diffuseColor.rgb = wCol;
        // Светлая полоса чуть прозрачнее толщи: рябь читается и толщиной.
        diffuseColor.a *= 0.94 + wShade * 0.06;`,
      );
    shader.uniforms['uWaterDeep'] = { value: DEEP };
    shader.uniforms['uWaterLight'] = { value: LIGHT };
    shader.uniforms['uWaterCrest'] = { value: CREST };
  };
  return material;
}
