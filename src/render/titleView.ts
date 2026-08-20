import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// Шрифт берётся из three и уезжает в сборку отдельным файлом: своей копии
// в репозитории не заводим, чтобы она не разъехалась с версией three.
// Лицензия — assets/LICENSES.md.
import fontUrl from 'three/examples/fonts/droid/droid_sans_bold.typeface.json?url';
import type { Gust } from './cursorWind';
import { FluffyGrass } from './fluffyGrass';
import type { SceneRig } from './scene';

/**
 * Стартовый экран: буквы стоят в траве, камера свободная — как в демке
 * FluffyGrass, с которой это и снято. Перспектива и орбита вместо
 * ортоизометрии: правило §6 про ортокамеру существует ради сетки, пути
 * назад и «персонажа за стеной», а на заставке нет ни одного из них.
 *
 * Трава — тоже оттуда, целиком (render/fluffyGrass.ts): своя, из вылазки,
 * умеет считаться с фонарём и растёт по клеткам, но здесь не нужно ни
 * первое, ни второе.
 */

/** Остров: радиус, колец и долек. Круглый и неровный — как в демке. */
const RADIUS = 27;
const RINGS = 40;
const SEGMENTS = 96;
const TITLE = 'Emberhold';

/**
 * Рельеф острова. Тремя синусами, а не шумовой текстурой: холмы нужны
 * пологие и повторяемые, а текстура — это ассет и ещё одна загрузка ради
 * трёх строк арифметики.
 */
function height(x: number, z: number): number {
  const h =
    Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.7 +
    Math.sin(x * 0.23 + 1.3) * Math.cos(z * 0.19 + 0.7) * 0.85 +
    Math.sin(x * 0.47 + 2.1) * Math.cos(z * 0.41 + 1.9) * 0.3;
  // Площадка под заголовком: буквы лежат плашмя, и на склоне половина слова
  // уходит в траву. Холмы гасятся к середине и набирают силу к краю.
  const r = Math.hypot(x, z);
  const open = Math.min(1, Math.max(0, (r - 6) / 10));
  return h * open * open;
}

/** Камера демки, взята оттуда как есть. */
const CAMERA_AT = new THREE.Vector3(-17, 12, -10);

/**
 * Ширина заголовка в мировых единицах. Задана шириной, а не кеглем: кегль
 * зависит от длины слова, и подобранный на глаз перестал бы влезать
 * в портретный экран при первой же смене названия.
 */
const TITLE_WIDTH = 15;

/** Плотность тумана из демки. С ней край острова уходит в дымку, а не в срез. */
const FOG_DENSITY = 0.02;

export class TitleView {
  readonly group = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  /** Куда светить: центр поля. */
  readonly center = { x: 0, z: 0 };

  private readonly controls: OrbitControls;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly grass: FluffyGrass;
  private readonly onResize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };
  private readonly fog = new THREE.FogExp2(0xffffff, FOG_DENSITY);
  private title: THREE.Mesh | null = null;
  private disposed = false;

  constructor(private readonly rig: SceneRig) {
    const terrain = this.buildTerrain();
    this.group.add(terrain);

    this.grass = new FluffyGrass(terrain, { fieldSize: RADIUS * 2, count: 14000, scale: 5 });
    this.group.add(this.grass.group);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
    this.camera.position.copy(CAMERA_AT).setY(CAMERA_AT.y + height(0, 0));
    addEventListener('resize', this.onResize);

    this.fog.color.copy(rig.skyColor);
    rig.setFog(this.fog);

    this.controls = new OrbitControls(this.camera, rig.renderer.domElement);
    this.controls.enableDamping = true;
    // Автоповорота нет: заголовок стоит там, где его оставили.
    this.controls.autoRotate = false;
    // Три ограничителя, которых в демке не было, потому что там остров и его
    // не жалко: под землю не уходим, за край поля не улетаем, цель не таскаем.
    // Иначе заставку можно оставить смотрящей в небо, и она такой и откроется.
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 46;
    this.controls.enablePan = false;
    // Цель на высоте букв, а не на земле: иначе камера смотрит в поле,
    // а заголовок оказывается полоской у нижнего края.
    this.controls.target.set(0, height(0, 0), 0);
    this.controls.update();

    this.loadTitle();
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /**
   * Остров: радиальная сетка, а не плоскость. Круг из CircleGeometry —
   * веер из центра, и по нему рельеф ложится длинными спицами; кольцами
   * же треугольники ровные, и сэмплер травы раскидывает по ним равномерно,
   * потому что раскидывает по площади.
   *
   * Геометрия сразу в мировой ориентации: сэмплер работает в локальных
   * координатах, и на повёрнутом меше трава легла бы стоймя.
   */
  private buildTerrain(): THREE.Mesh {
    const position: number[] = [];
    const index: number[] = [];

    for (let ring = 0; ring <= RINGS; ring++) {
      const t = ring / RINGS;
      const r = t * RADIUS;
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const a = (seg / SEGMENTS) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        // Край обрывается вниз: остров, а не блин. Обрыв начинается
        // за видимой частью, поэтому холмы им не срезаются.
        const edge = Math.max(0, (t - 0.82) / 0.18);
        position.push(x, height(x, z) - edge * edge * 9, z);
      }
    }
    // Юбка: вертикальный борт вниз от последнего кольца. Без неё остров
    // просвечивает насквозь, когда камера опускается к горизонту.
    const skirt = RINGS + 1;
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = (seg / SEGMENTS) * Math.PI * 2;
      position.push(Math.cos(a) * RADIUS, -26, Math.sin(a) * RADIUS);
    }

    for (let ring = 0; ring < RINGS + 1; ring++) {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const next = (seg + 1) % SEGMENTS;
        const a = ring * SEGMENTS + seg;
        const b = ring * SEGMENTS + next;
        const c = (ring + 1) * SEGMENTS + seg;
        const d = (ring + 1) * SEGMENTS + next;
        // Обмотка против часовой при взгляде сверху: при обратной земля
        // отсекается как изнанка, и сквозь просветы между кустиками травы
        // видно небо.
        // Центр — вырожденное кольцо: треугольники в нём нулевой площади,
        // сэмплер их просто не выберет.
        index.push(a, b, c, b, d, c);
      }
    }
    void skirt;

    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();

    const mat = this.track(new THREE.MeshLambertMaterial({ color: 0x5e875e, flatShading: true }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Шрифт грузится отдельным файлом и не задерживает первый кадр: поле
   * с травой встаёт сразу, буквы приходят следом.
   */
  private loadTitle(): void {
    new FontLoader().load(fontUrl, (font: Font) => {
      // Экран мог смениться, пока шрифт ехал.
      if (this.disposed) return;
      const geo = this.track(
        new TextGeometry(TITLE, {
          font,
          size: 4,
          depth: 1,
          curveSegments: 4,
          bevelEnabled: true,
          bevelThickness: 0.08,
          bevelSize: 0.06,
          bevelSegments: 1,
        }),
      );
      // Сначала под ширину кадра, потом центрируем: TextGeometry считает
      // от левого нижнего угла первой буквы, и без сдвига заголовок уезжает
      // вбок и вниз.
      geo.computeBoundingBox();
      const raw = geo.boundingBox;
      if (raw === null) return;
      geo.scale(...(Array(3).fill(TITLE_WIDTH / (raw.max.x - raw.min.x)) as [number, number, number]));
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      if (box === null) return;
      // Центр по всем трём осям: лежачий текст ложится серединой на середину
      // острова, а не углом первой буквы.
      geo.translate(
        -(box.max.x + box.min.x) / 2,
        -(box.max.y + box.min.y) / 2,
        -(box.max.z + box.min.z) / 2,
      );

      // Буквы лежат в траве, а не стоят: как в демке, куда текст положен
      // плашмя и читается сверху. Материал и цвет тоже оттуда —
      // MeshPhongMaterial 0x333333.
      geo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geo, this.track(new THREE.MeshPhongMaterial({ color: 0x333333 })));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(0, height(0, 0) + 1.15, 0);
      // Верх букв смотрит от камеры: лежачий текст читается только с той
      // стороны, с которой его положили.
      mesh.rotation.y = Math.atan2(CAMERA_AT.x, CAMERA_AT.z);
      this.title = mesh;
      this.group.add(mesh);
    });
  }

  /** Порыв от курсора; null — ветра нет (render/cursorWind.ts). */
  setGust(gust: Gust | null): void {
    this.grass.setGust(gust);
  }

  update(timeSec: number): void {
    // Небо меняет цвет вместе со временем суток — туман обязан идти за ним,
    // иначе горизонт уходит в дымку другого цвета, чем небо над ней.
    this.fog.color.copy(this.rig.skyColor);
    this.grass.update(timeSec);
    this.grass.setLight(0.35 + this.rig.dayFactor * 0.65);
    // Затухание требует update каждый кадр, иначе камера дёргается.
    this.controls.update();
  }

  get blades(): number {
    return this.grass.blades;
  }

  /** Есть ли уже буквы: нужно проверке, а не игре. */
  get titleReady(): boolean {
    return this.title !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.rig.setFog(this.rig.linearFog);
    removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.grass.dispose();
    this.title = null;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
