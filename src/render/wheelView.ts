import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FluffyGrass } from './fluffyGrass';
import wheelSceneUrl from '../../assets/codepen-carnival-wheel/assets/carnival.glb?url';
import bakedUrl from '../../assets/codepen-carnival-wheel/assets/baked.jpg?url';
import wheelSkinUrl from '../../assets/codepen-carnival-wheel/assets/wheel.jpg?url';
import { gameMessage, setGameText } from '../i18n/game';

/**
 * Колесо призов — локация карты (§4, вид узла «призы»). Одна прокрутка
 * в день: игрок тянет рычаг, колесо крутится и встаёт на сектор, сколько
 * выпало — столько кристаллов он забирает.
 *
 * Сцена и модель — с CodePen Джареда Стэнли (реестр: `assets/LICENSES.md`,
 * разбор: `assets/codepen-carnival-wheel/README.md`), фон — луг стартового
 * экрана (`FluffyGrass`). Живёт оверлеем со своим рендерером поверх карты,
 * а не через `SceneRig`: у рига ортоизометрия и мир вылазки, а тут одна
 * модель и прибитая перспективная камера — тащить их друг в друга значило
 * бы учить риг аттракциону ради единственного кадра.
 *
 * Главное отличие от исходника: там число читалось из угла остановки,
 * здесь наоборот — исход приходит из симуляции доводом (`answer`), а рычаг
 * лишь запускает анимацию, которая обязана довезти до нужного сектора.
 * Импульс подбирается бисекцией по той же арифметике, которой крутится
 * кадр, поэтому сектор сходится точно, а не «почти».
 */

/** Сколько сектор занимает градусов: их десять. */
const SECTOR_DEG = 36;

/** Насколько прирост скорости тает за кадр — темп затухания исходника. */
const DECAY = 0.001;

/** Полных оборотов до сектора: меньше трёх читается подделкой темпа. */
const TURNS = 5;

/** Камера исходника: фронт колеса. Прибита — люфт орбиты не более 5%. */
const CAMERA_AT = new THREE.Vector3(0.11611507465368477, 0, 5.8682635668005005);

/** Сколько тянуть рычаг вниз (px), чтобы отпускание считалось рывком. */
const PULL_MIN = 40;

export interface WheelCallbacks {
  /** Игрок забрал приз — начислить кристаллы и закрыть. */
  onClaim(crystals: number): void;
  /** Ушёл, не крутив (или до результата): ничего не начислять. */
  onLeave(): void;
}

export class WheelView {
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly hint: HTMLElement;
  private readonly claimRow: HTMLElement;

  private grass: FluffyGrass | null = null;
  private wheel: THREE.Object3D | null = null;
  private lever: THREE.Object3D | null = null;
  private hitArea: THREE.Object3D | null = null;
  private nums: THREE.Object3D[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private panelAction: THREE.AnimationAction | null = null;

  /** Накопленный угол колеса; `rotation.z` каждый кадр равен ему. */
  private speed = 0;
  /** Текущий прирост за кадр; ноль — колесо стоит. */
  private inc = 0;
  private spun = false;
  private done = false;
  private grabbing = false;
  private dragY: number | null = null;
  private dragDist = 0;
  private raf = 0;
  private disposed = false;

  constructor(
    private readonly answer: number,
    private readonly cb: WheelCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:80;background:#bcd2e8;touch-action:none;';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.root.append(this.renderer.domElement);

    // Небо и туман — как на стартовом экране (дневное небо `scene.ts`).
    this.scene.background = new THREE.Color(0xbcd2e8);
    this.scene.fog = new THREE.FogExp2(0xbcd2e8, 0.02);
    this.scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x2b2519, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
    this.camera.position.copy(CAMERA_AT);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    const dist = CAMERA_AT.length();
    const wiggle = (Math.PI / 2) * 0.05;
    const azimuth = Math.atan2(CAMERA_AT.x, CAMERA_AT.z);
    this.controls.minDistance = dist * 0.95;
    this.controls.maxDistance = dist * 1.05;
    this.controls.minPolarAngle = Math.PI / 2 - wiggle;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minAzimuthAngle = azimuth - wiggle;
    this.controls.maxAzimuthAngle = azimuth + wiggle;

    this.hint = document.createElement('div');
    setGameText(this.hint, gameMessage('Потяните рычаг вниз', 'Pull the lever down'));
    this.hint.style.cssText =
      'position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);' +
      'color:#e8e2d4;text-shadow:0 1px 3px rgba(0,0,0,0.6);pointer-events:none;';

    const leave = document.createElement('button');
    leave.className = 'act';
    setGameText(leave, gameMessage('Уйти', 'Leave'));
    leave.style.cssText = 'position:absolute;top:12px;left:12px;';
    leave.addEventListener('click', () => {
      if (!this.done) this.cb.onLeave();
    });

    this.claimRow = document.createElement('div');
    this.claimRow.style.cssText =
      'position:absolute;left:50%;bottom:7vh;transform:translateX(-50%);display:none;';
    const claim = document.createElement('button');
    claim.className = 'cta';
    claim.addEventListener('click', () => this.cb.onClaim(this.answer));
    this.claimRow.append(claim);

    this.root.append(this.hint, leave, this.claimRow);
    document.body.append(this.root);

    this.load();

    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('resize', this.onResize);
    this.tick();
  }

  private load(): void {
    const texLoader = new THREE.TextureLoader();
    const baked = texLoader.load(bakedUrl);
    baked.flipY = false;
    baked.colorSpace = THREE.SRGBColorSpace;
    const skin = texLoader.load(wheelSkinUrl);
    skin.flipY = false;
    skin.colorSpace = THREE.SRGBColorSpace;
    const bakedMat = new THREE.MeshBasicMaterial({ map: baked });
    const skinMat = new THREE.MeshBasicMaterial({ map: skin });
    const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });

    new GLTFLoader().load(wheelSceneUrl, (gltf) => {
      if (this.disposed) return;
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.name === 'hitarea') child.material = ghostMat;
        else if (child.name === 'wheel') child.material = skinMat;
        else child.material = bakedMat;
      });
      this.wheel = gltf.scene.getObjectByName('wheel') ?? null;
      this.lever = gltf.scene.getObjectByName('lever') ?? null;
      this.hitArea = gltf.scene.getObjectByName('hitarea') ?? null;
      if (this.lever !== null) this.lever.rotation.x = 1;
      // Числа результата: `num1..num9`, десятка в модели зовётся `num99`.
      // Порядок обхода GLB совпадает с порядком секторов — как в исходнике.
      this.nums = [];
      gltf.scene.traverse((child) => {
        if (child.name.startsWith('num')) {
          child.visible = false;
          this.nums.push(child);
        }
      });

      const panel = gltf.scene.getObjectByName('result_panel');
      const clip = THREE.AnimationClip.findByName(gltf.animations, 'result_panelAction');
      if (panel !== undefined && clip !== null) {
        this.mixer = new THREE.AnimationMixer(panel);
        this.panelAction = this.mixer.clipAction(clip);
        this.panelAction.clampWhenFinished = true;
        this.panelAction.setLoop(THREE.LoopOnce, 1);
      }

      // Показывается только сам аттракцион: шатёр, прилавок и прочий фон
      // GLB спрятаны — имена уже с подчёркиваниями GLTFLoader'а.
      const keep = new Set([
        'wheel', 'wheel_base', 'lever', 'hitarea', 'result_panel',
        'arrow', 'arrow_sign', 'Nail', 'sign_swing',
        'spin_sign', 'spin_letters', 'star_wheel',
      ]);
      gltf.scene.children.forEach((child) => {
        if (!keep.has(child.name)) child.visible = false;
      });
      this.scene.add(gltf.scene);

      // Луг под колесом: земля от подошвы основания, чуть притопленного —
      // стоя ровно на плоскости, модель читалась парящей.
      const base = gltf.scene.getObjectByName('wheel_base');
      if (base === undefined) return;
      const foot = new THREE.Box3().setFromObject(base);
      const groundY = foot.min.y + 0.08;
      const groundGeo = new THREE.CircleGeometry(20, 48);
      // Поворот запечён в геометрию: сэмплер травы читает локальные координаты.
      groundGeo.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(
        groundGeo,
        new THREE.MeshLambertMaterial({ color: 0x5e875e, flatShading: true }),
      );
      ground.position.y = groundY;
      this.scene.add(ground);
      const pad = 1.0;
      this.grass = new FluffyGrass(ground, {
        fieldSize: 40,
        count: 9000,
        scale: 1.1,
        // Под самой моделью трава не растёт; к камере прогалина шире —
        // та стоит низко, и ближние травинки ложатся в кадре на модель.
        reject: (x, z) =>
          x > foot.min.x - pad && x < foot.max.x + pad &&
          z > foot.min.z - pad && z < foot.max.z + 2,
      });
      this.grass.group.position.y = groundY;
      this.scene.add(this.grass.group);
    });
  }

  /* ---------- жест рычага ---------- */

  private readonly onDown = (e: PointerEvent): void => {
    if (this.spun || this.hitArea === null) return;
    this.pointer.set(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.hitArea).length === 0) return;
    this.grabbing = true;
    this.dragY = e.clientY;
    this.dragDist = 0;
    this.controls.enabled = false;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.grabbing || this.lever === null || this.dragY === null) return;
    const dy = e.clientY - this.dragY;
    this.dragY = e.clientY;
    if (dy > 0) this.dragDist += dy;
    this.lever.rotation.x = Math.min(2, 1 + this.dragDist / 100);
  };

  private readonly onUp = (): void => {
    if (!this.grabbing) return;
    this.grabbing = false;
    this.controls.enabled = true;
    if (this.lever !== null) this.lever.rotation.x = 1;
    if (this.dragDist >= PULL_MIN && !this.spun) this.spin();
    this.dragDist = 0;
    this.dragY = null;
  };

  /* ---------- прокрутка к ответу ---------- */

  /**
   * Импульс, который довезёт ровно до сектора `answer`. Затухание кадровое
   * и точное, поэтому конечный угол — чистая функция импульса: бисекция по
   * той же арифметике сходится к сектору без «доводки» на глазах у игрока.
   */
  private spin(): void {
    const center = ((this.answer - 0.5) * SECTOR_DEG * Math.PI) / 180;
    const target = TURNS * 2 * Math.PI + center;
    const total = (impulse: number): number => {
      let s = 0;
      for (let i = impulse; i > 0; i -= DECAY) s += i;
      return s;
    };
    let lo = 0;
    let hi = 2;
    for (let n = 0; n < 48; n++) {
      const mid = (lo + hi) / 2;
      if (total(mid) < target) lo = mid;
      else hi = mid;
    }
    this.inc = hi;
    this.spun = true;
    this.hint.style.display = 'none';
  }

  private stopSpin(): void {
    this.inc = 0;
    this.done = true;
    const num = this.nums[this.answer - 1];
    if (num !== undefined) num.visible = true;
    if (this.panelAction !== null) {
      this.panelAction.reset();
      this.panelAction.play();
    }
    const claim = this.claimRow.firstElementChild as HTMLButtonElement;
    setGameText(claim, gameMessage('Забрать · кристаллы: {count}', 'Claim · crystals: {count}'), {
      count: this.answer,
    });
    this.claimRow.style.display = 'block';
  }

  /* ---------- цикл ---------- */

  private readonly onResize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };

  private readonly tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    this.controls.update();
    if (this.inc > 0 && this.wheel !== null) {
      this.speed += this.inc;
      this.wheel.rotation.z = this.speed;
      this.inc -= DECAY;
      if (this.inc <= 0) this.stopSpin();
    }
    const dt = this.clock.getDelta();
    this.mixer?.update(dt);
    this.grass?.update(this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.grass?.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
