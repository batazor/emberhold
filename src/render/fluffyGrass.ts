import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { Gust } from './cursorWind';

/**
 * Трава стартового экрана — перенос FluffyGrass (MIT, © 2023 Ebenezer,
 * github.com/thebenezer/FluffyGrass), включая его модель кустика, альфу
 * и шум. Реестр — assets/LICENSES.md.
 *
 * Взято как есть, а не переписано: у заставки нет ни фонаря, ни ночи, ни
 * сетки — то есть ни одной причины, по которой траве вылазки (grass.ts)
 * пришлось считаться со штатным светом. Здесь достаточно того, что уже
 * сделано и выглядит как надо.
 *
 * Четыре правки против оригинала:
 *  1. `getShadow` в three 0.180 принимает shadowIntensity — в 0.159, на
 *     которой писался оригинал, этого довода не было;
 *  2. размер поля был числом 100. в шейдере — стал доводом, у нас поле своё;
 *  3. dat.gui выброшен: настройки задаются вызывающим;
 *  4. порыв от курсора (render/cursorWind.ts). Первая правка не вынужденная,
 *     а по делу: у оригинала ветер один на всё поле и ни на что не
 *     отзывается, а курсор в лагере и на заставке — единственное, чем
 *     игрок трогает картинку, пока ничего не нажал;
 *  5. наклон устройства (render/tiltWind.ts). Оттуда же: на телефоне
 *     курсора нет вовсе, и без наклона трава заставки не отзывалась бы
 *     ни на что.
 */

const ASSETS = 'grass/';

/**
 * Радиус порыва — пятно под курсором, а не погода на поле. Считается от
 * кустика (он здесь впятеро крупнее травинки вылазки): три с небольшим
 * единицы — это соседний куст, дальше ветер не идёт.
 */
const GUST_RADIUS = 2.4;

/**
 * Насколько порыв уводит верхушку, в мировых единицах. Меньше ширины
 * куста: трава качнулась, а не легла.
 */
const GUST_PUSH = 0.5;

/** Насколько полный наклон уводит верхушку, в мировых единицах. */
const TILT_PUSH = 0.45;

/** Круговая частота отыгрыша, рад/с: качок туда-обратно за секунду. */
const GUST_SWING = 7;

/**
 * Волновое число, рад на мировую единицу. Меньше, чем у травы вылазки:
 * кустик здесь крупнее, и волна той же длины уложилась бы внутри одного
 * куста, то есть пропала бы.
 */
const GUST_WAVE = 0.55;

export interface FluffyGrassOptions {
  /** Сторона поля в мировых единицах: по ней считается глобальный UV шума. */
  readonly fieldSize: number;
  readonly count: number;
  /** Масштаб кустика. В оригинале модель увеличена в пять раз. */
  readonly scale: number;
  /**
   * Где траве не расти. В оригинале этого нет — там остров и трава по
   * всему острову; у лагеря же есть площадка, и вырастать сквозь Жильё
   * трава не должна.
   */
  readonly reject?: (x: number, z: number) => boolean;
}

export class FluffyGrass {
  readonly group = new THREE.Group();

  private readonly uniforms = {
    uTime: { value: 0 },
    uTerrainSize: { value: 100 },
    uNoiseScale: { value: 1.5 },
    uGrassLightIntensity: { value: 1 },
    uShadowDarkness: { value: 0.5 },
    uBaseColor: { value: new THREE.Color('#313f1b') },
    uTipColor1: { value: new THREE.Color('#9bd38d') },
    uTipColor2: { value: new THREE.Color('#1f352a') },
    uNoiseTexture: { value: null as THREE.Texture | null },
    uGrassAlphaTexture: { value: null as THREE.Texture | null },
    // xy — где курсор, z — сила порыва (0 — ветра нет), w — его возраст.
    uGust: { value: new THREE.Vector4(0, 0, 0, 0) },
    uGustDir: { value: new THREE.Vector2(1, 0) },
    // Наклон устройства: куда и насколько лежит поле (render/tiltWind.ts).
    uTilt: { value: new THREE.Vector2() },
  };

  private readonly material: THREE.MeshLambertMaterial;
  private readonly textures: THREE.Texture[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private disposed = false;

  constructor(
    private readonly terrain: THREE.Mesh,
    private readonly options: FluffyGrassOptions,
  ) {
    this.uniforms.uTerrainSize.value = options.fieldSize;

    this.material = new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide,
      color: 0x229944,
      transparent: true,
      alphaTest: 0.1,
      shadowSide: THREE.BackSide,
    });
    this.patch(this.material);

    const loader = new THREE.TextureLoader();
    const noise = loader.load(`${ASSETS}perlinnoise.webp`);
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    const alpha = loader.load(`${ASSETS}grass.jpeg`);
    this.uniforms.uNoiseTexture.value = noise;
    this.uniforms.uGrassAlphaTexture.value = alpha;
    this.textures.push(noise, alpha);

    new GLTFLoader().load(`${ASSETS}grassLODs.glb`, (gltf) => {
      if (this.disposed) return;
      let geo: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name.includes('LOD00')) {
          geo = child.geometry as THREE.BufferGeometry;
        }
      });
      if (geo === null) return;
      this.plant(geo);
    });
  }

  /** Кустики раскиданы по поверхности земли — как в оригинале, сэмплером. */
  private plant(geo: THREE.BufferGeometry): void {
    const { count, scale } = this.options;
    geo.scale(scale, scale, scale);
    this.geometry = geo;

    const mesh = new THREE.InstancedMesh(geo, this.material, count);
    // Как в оригинале: трава тень принимает, но не отбрасывает — 14 тысяч
    // кустиков во второй проход стоили бы дороже всей заставки.
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.group.add(mesh);
    this.place();
  }

  /**
   * Пересев. Нужен лагерю: площадка растёт вместе с Жильём (§20.4), и трава
   * обязана отступить с новых клеток, а не остаться торчать из-под них.
   */
  replant(): void {
    if (this.mesh !== null) this.place();
  }

  private place(): void {
    const mesh = this.mesh;
    if (mesh === null) return;
    const count = mesh.count;
    const sampler = new MeshSurfaceSampler(this.terrain).build();

    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);

    const reject = this.options.reject;
    for (let i = 0; i < count; i++) {
      sampler.sample(position, normal);
      if (reject !== undefined && reject(position.x, position.z)) {
        // Пересев, а не пропуск: пропуск проредил бы поле там, где запрета
        // нет, — сэмплер выдаёт точки равномерно по всей площади.
        let tries = 8;
        while (tries-- > 0 && reject(position.x, position.z)) sampler.sample(position, normal);
        if (reject(position.x, position.z)) {
          // Не нашли места за восемь попыток — прячем экземпляр под землю.
          matrix.makeTranslation(0, -1000, 0);
          mesh.setMatrixAt(i, matrix);
          continue;
        }
      }
      quaternion.setFromUnitVectors(yAxis, normal);
      spin.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
      quaternion.multiply(spin);
      matrix.compose(position, quaternion, one);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  get blades(): number {
    return this.mesh === null ? 0 : this.mesh.count;
  }

  update(timeSec: number): void {
    this.uniforms.uTime.value = timeSec;
  }

  /**
   * Ветер от наклона устройства: (x, z) — мировое направление, strength —
   * 0..1. Поле ложится в эту сторону, и волна идёт туда же.
   */
  setTilt(x: number, z: number, strength: number): void {
    this.uniforms.uTilt.value.set(x * strength, z * strength);
  }

  /** Порыв от курсора или null, если ветра нет (render/cursorWind.ts). */
  setGust(gust: Gust | null): void {
    if (gust === null) {
      this.uniforms.uGust.value.set(0, 0, 0, 0);
      return;
    }
    this.uniforms.uGust.value.set(gust.x, gust.z, gust.strength * GUST_PUSH, gust.age);
    this.uniforms.uGustDir.value.set(gust.dirX, gust.dirZ);
  }

  /**
   * Яркость по времени суток. У оригинала свет постоянный: трава там сама
   * себе освещение и на сцену не смотрит. В игре это заметно — вечерний
   * лагерь с полуденной травой читается как ошибка.
   */
  setLight(intensity: number): void {
    this.uniforms.uGrassLightIntensity.value = intensity;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.mesh?.dispose();
    this.geometry?.dispose();
    this.material.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
  }

  private patch(material: THREE.MeshLambertMaterial): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = `
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uTime;
      uniform float uTerrainSize;
      uniform vec4 uGust;
      uniform vec2 uGustDir;
      uniform vec2 uTilt;

      varying vec3 vColor;
      varying vec2 vGlobalUV;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec2 vWindColor;
      void main() {
        #include <color_vertex>

        #include <begin_vertex>
        #include <project_vertex>
        #include <fog_vertex>

        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <worldpos_vertex>
        #include <shadowmap_vertex>

        // Направление волны у оригинала было записано числом. Наклон его
        // уводит: поле обязано качаться туда же, куда легло.
        vec2 uWindDirection = normalize(vec2(1.0, 1.0) + uTilt * 0.8);
        float uWindAmp = 0.1;
        float uWindFreq = 50.;
        float uSpeed = 1.0;
        float uNoiseFactor = 5.50;
        float uNoiseSpeed = 0.001;

        vec2 windDirection = normalize(uWindDirection);
        vec4 modelPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);

        vGlobalUV = (uTerrainSize - vec2(modelPosition.xz)) / uTerrainSize;

        vec4 noise = texture2D(uNoiseTexture, vGlobalUV + uTime * uNoiseSpeed);

        float sinWave = sin(uWindFreq * dot(windDirection, vGlobalUV) + noise.g * uNoiseFactor + uTime * uSpeed) * uWindAmp * (1. - uv.y);

        float xDisp = sinWave;
        float zDisp = sinWave;
        modelPosition.x += xDisp;
        modelPosition.z += zDisp;

        // Порыв от курсора: по ходу курсора — сам ветер, врозь от точки —
        // то, чем он обтекает препятствие. Гнётся верхушка, а не корень:
        // (1. - uv.y) — та же доля высоты, что и у общей волны выше.
        if (uGust.z > 0.0) {
          vec2 gToBush = modelPosition.xz - uGust.xy;
          float gDist = length(gToBush);
          float gFall = exp(-gDist * gDist / (${GUST_RADIUS.toFixed(3)} * ${GUST_RADIUS.toFixed(3)}));
          vec2 gFlow = uGustDir + (gToBush / (gDist + 1e-4)) * 0.5;
          // Волна: толчок расходится от курсора и отыгрывает назад. Косинус
          // уходит в минус — куст качается обратно, как после настоящего
          // порыва, а не встаёт по линейке.
          float gWave = cos(uGust.w * ${GUST_SWING.toFixed(3)} - gDist * ${GUST_WAVE.toFixed(3)});
          modelPosition.xz += gFlow * uGust.z * gFall * gWave * (1. - uv.y);
        }

        // Наклон устройства: ровный крен всего поля, поверх волны.
        modelPosition.xz += uTilt * ${TILT_PUSH.toFixed(3)} * (1. - uv.y);

        modelPosition.y += exp(texture2D(uNoiseTexture, vGlobalUV * uNoiseScale).r) * 0.5 * (1. - uv.y);

        vec4 viewPosition = viewMatrix * modelPosition;
        gl_Position = projectionMatrix * viewPosition;

        vUv = vec2(uv.x, 1. - uv.y);
        vNormal = normalize(normalMatrix * normal);
        vWindColor = vec2(xDisp, zDisp);
        vViewPosition = mvPosition.xyz;
      }
      `;

      shader.fragmentShader = `
      #include <alphatest_pars_fragment>
      #include <alphamap_pars_fragment>
      #include <fog_pars_fragment>

      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>

      uniform vec3 uBaseColor;
      uniform vec3 uTipColor1;
      uniform vec3 uTipColor2;
      uniform sampler2D uGrassAlphaTexture;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uGrassLightIntensity;
      uniform float uShadowDarkness;

      varying vec2 vUv;
      varying vec2 vGlobalUV;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 grassAlpha = texture2D(uGrassAlphaTexture, vUv);
        vec4 grassVariation = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale);
        vec3 tipColor = mix(uTipColor1, uTipColor2, grassVariation.r);

        vec4 diffuseColor = vec4(mix(uBaseColor, tipColor, vUv.y), step(0.1, grassAlpha.r));
        vec3 grassFinalColor = diffuseColor.rgb * uGrassLightIntensity;

        float shadow = 0.0;
        float currentShadow = 0.0;
        #if ( NUM_DIR_LIGHTS > 0 )
          DirectionalLight directionalLight;
          IncidentLight directLight;
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            DirectionalLightShadow directionalLightShadow;
          #endif
          #pragma unroll_loop_start
          for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
            directionalLight = directionalLights[ i ];
            getDirectionalLightInfo( directionalLight, directLight );
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
              directionalLightShadow = directionalLightShadows[ i ];
              // three 0.180: у getShadow появился shadowIntensity.
              currentShadow = getShadow(
                directionalShadowMap[ i ],
                directionalLightShadow.shadowMapSize,
                directionalLightShadow.shadowIntensity,
                directionalLightShadow.shadowBias,
                directionalLightShadow.shadowRadius,
                vDirectionalShadowCoord[ i ] );
              currentShadow = all( bvec2( directLight.visible, receiveShadow ) ) ? currentShadow : 1.0;
              float weight = clamp( pow( length( vDirectionalShadowCoord[ i ].xy * 2. - 1. ), 4. ), .0, 1. );
              shadow += mix( currentShadow, 1., weight );
            #else
              shadow += 1.0;
            #endif
          }
          #pragma unroll_loop_end
        #else
          shadow = 1.0;
        #endif
        grassFinalColor = mix( grassFinalColor, grassFinalColor * uShadowDarkness, 1. - shadow );

        #include <alphatest_fragment>
        gl_FragColor = vec4( grassFinalColor, 1.0 );

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
      `;
    };
  }
}
