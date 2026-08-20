import * as THREE from 'three';
import { PALETTE } from './palette';

/**
 * §6: ортокамера с азимутом 45° и наклоном 30° — это проекция 2:1.
 * Камера стоит близко к сцене намеренно: туман считается от камеры, и при
 * большом отлёте он съедает всю картинку (проверено прототипом).
 */
const ELEVATION = (30 * Math.PI) / 180;
const CAM_DIST = 42;

/* Цвета неба: считаются один раз, а не заводятся каждый кадр в update. */
const SKY_NIGHT = new THREE.Color(0x27324d);
const SKY_DAY = new THREE.Color(0xbcd2e8);
const FOG_NIGHT = new THREE.Color(PALETTE.night);
const FOG_DAY = new THREE.Color(PALETTE.day);

export class SceneRig {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  readonly world = new THREE.Group();

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly torch: THREE.PointLight;
  private readonly fog: THREE.Fog;
  private readonly target = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();

  private azimuth = Math.PI / 4;
  private azimuthGoal = Math.PI / 4;
  private frustum = 18;
  private frustumGoal = 18;
  /** 0 — день, 1 — ночь. */
  night = 1;

  constructor(canvasParent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Подобрано замером по буферу, а не на глаз: см. комментарий у фонаря.
    this.renderer.toneMappingExposure = 1.25;
    canvasParent.appendChild(this.renderer.domElement);

    this.fog = new THREE.Fog(new THREE.Color(PALETTE.night), CAM_DIST + 10, CAM_DIST + 70);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(PALETTE.night);
    this.scene.add(this.world);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140);

    this.hemi = new THREE.HemisphereLight(0xbcd2e8, 0x2b2519, 1);
    // §6: один источник с тенями. Второй — отдельное решение, а не мелочь.
    this.sun = new THREE.DirectionalLight(PALETTE.sun, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -14,
      right: 14,
      top: 14,
      bottom: -14,
      near: 1,
      far: 80,
    });
    this.sun.shadow.bias = -0.0011;
    this.sun.shadow.normalBias = 0.035;
    this.torch = new THREE.PointLight(PALETTE.torch, 0, 10, 1.15);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.torch);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    const fh = this.frustum;
    const fw = fh * (w / h);
    this.camera.left = -fw / 2;
    this.camera.right = fw / 2;
    this.camera.top = fh / 2;
    this.camera.bottom = -fh / 2;
    this.camera.updateProjectionMatrix();
  }

  lookAt(x: number, z: number, instant = false): void {
    this.target.set(x, 0, z);
    if (instant) this.focus.copy(this.target);
  }

  rotate(steps: number): void {
    this.azimuthGoal += (steps * Math.PI) / 2;
  }

  zoom(delta: number): void {
    this.frustumGoal = Math.min(34, Math.max(10, this.frustumGoal + delta));
  }

  /** Текущая цель зума — от неё считает щипок, чтобы кадр не прыгал. */
  get zoomLevel(): number {
    return this.frustumGoal;
  }

  setZoom(value: number, instant = false): void {
    this.frustumGoal = Math.min(34, Math.max(10, value));
    if (instant) {
      this.frustum = this.frustumGoal;
      this.resize();
    }
  }

  /** Экран → координаты земли. Плоскость, а не рейкаст по мешам: земля плоская. */
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();

  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    this.ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (this.ray.ray.intersectPlane(this.plane, this.hit) === null) return null;
    return { x: this.hit.x, z: this.hit.z };
  }

  /**
   * §6.1 / §11.4: обзор — это дальность фонаря, а не наложенная маска.
   * visionRadius приходит из симуляции, чтобы число на экране и то, что видно,
   * не разъезжались.
   */
  update(dt: number, heroX: number, heroZ: number, visionRadius: number): void {
    const day = 1 - this.night;

    // §11.4 — вне фонаря темно, и это механика: обзор и есть дальность света.
    // Пробовал добавить лунный подсвет ради силуэтов (0.2 и 0.16 вместо
    // 0.05 и 0.07) — не понадобилось: чернил экран не свет, а тёмное стекло
    // в style.css, общее у HUD с экраном возврата. Если силуэты за кругом
    // света всё-таки нужны, весь рычаг — эти две константы.
    this.sun.intensity = 0.05 + day * 1.75;
    this.sun.color.setHSL(0.09 + this.night * 0.5, 0.55 - day * 0.25, 0.55 + day * 0.12);
    this.hemi.intensity = 0.07 + day * 0.58;
    this.hemi.color.lerpColors(SKY_NIGHT, SKY_DAY, day);

    const sunAngle = (0.25 + day * 0.5) * Math.PI;
    this.sun.position.set(heroX + Math.cos(sunAngle) * 24, 12 + day * 20, heroZ + 14);
    this.sun.target.position.set(heroX, 0, heroZ);
    this.sun.target.updateMatrixWorld();

    // Сила света задана в физических единицах: начиная с three r155 точечный
    // свет считается по канделам с делением на квадрат расстояния, и прежние
    // 5 кд остались от старой модели (useLegacyLights), которой больше нет.
    // Замер по кадру: при 5 кд освещённая земля у героя давала яркость 49
    // из 255 при фоне 40 — пятно не отличалось от темноты. При 22 это 154,
    // а затухание не меняется вовсе: обзор остаётся дальностью фонаря (§11.4).
    this.torch.intensity = 7 + this.night * 15;
    this.torch.distance = visionRadius + 1.5;
    // Фонарь смещён к камере: в собственном свете герой иначе стоит силуэтом.
    this.torch.position.set(
      heroX + Math.cos(this.azimuth) * 0.75,
      1.35,
      heroZ + Math.sin(this.azimuth) * 0.75,
    );

    this.fog.color.lerpColors(FOG_NIGHT, FOG_DAY, day * day);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    // §6: «туман — только дымка позади сцены». Он и начинается позади:
    // при ортокамере глубина считается от камеры, и near = CAM_DIST + 2
    // затягивал дымкой дальнюю половину самой локации — та самая размытость.
    // 18 — половина диагонали самой большой локации (§11.1, ярус 3: 20 клеток).
    this.fog.near = CAM_DIST + 18 + day * 6;
    this.fog.far = CAM_DIST + 48 + day * 40;

    this.focus.lerp(this.target, Math.min(1, dt * 3.5));
    this.azimuth += (this.azimuthGoal - this.azimuth) * Math.min(1, dt * 6);
    if (Math.abs(this.frustum - this.frustumGoal) > 0.01) {
      this.frustum += (this.frustumGoal - this.frustum) * Math.min(1, dt * 8);
      this.resize();
    }

    const ce = Math.cos(ELEVATION);
    this.camera.position.set(
      this.focus.x + Math.cos(this.azimuth) * ce * CAM_DIST,
      Math.sin(ELEVATION) * CAM_DIST,
      this.focus.z + Math.sin(this.azimuth) * ce * CAM_DIST,
    );
    this.camera.lookAt(this.focus);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Туман наружу: заставка ставит свой, экспоненциальный (как в демке
   * FluffyGrass), и возвращает этот на выходе. Линейный туман §6 считается
   * от камеры и на свободной камере ведёт себя не так, как задумано.
   */
  setFog(fog: THREE.Fog | THREE.FogExp2 | null): void {
    this.scene.fog = fog;
  }

  get linearFog(): THREE.Fog {
    return this.fog;
  }

  /** Доля дня: 1 — полдень, 0 — ночь. Трава заставки и лагеря светится сама
   *  и обязана знать время суток числом. */
  get dayFactor(): number {
    return 1 - this.night;
  }

  /** Цвет неба этого кадра. Чужой туман обязан держаться его же цвета. */
  get skyColor(): THREE.Color {
    return this.scene.background as THREE.Color;
  }

  /**
   * Отрисовка чужой камерой. Ортоизометрия — правило игры (§6), но у
   * заставки камера свободная: там нет ни сетки, ни пути назад, ни
   * «персонажа за стеной», ради которых правило существует.
   */
  renderWith(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  /* Отладочные окна в свет: ими смотрят замером, а не глазом (?bench=1). */
  get sunIntensity(): number {
    return this.sun.intensity;
  }

  get backgroundHex(): string {
    return `#${(this.scene.background as THREE.Color).getHexString()}`;
  }
}
