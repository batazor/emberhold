import * as THREE from 'three';
import { resourceGeometry, resourceMaterial } from './resources';
import type { ResourceModelName } from './resources';
import { builtBuildings, campArea } from '../sim/camp';
import type { CampState } from '../sim/camp';

/**
 * Толкаемый реквизит лагеря: дрова и камни у костра, которые герой задевает
 * при проходе. Физика — Rapier, и живёт она целиком здесь, в рендере:
 * симуляция про эти тела не знает, они ничего не стоят, не блокируют клетку
 * и не переживают перезагрузку. Это то же место в архитектуре, где стоят
 * ветер травы и дрожание валуна, — картинка, а не мир.
 *
 * Пакет — `rapier3d-compat`: WASM зашит в JS строкой, и Vite не нужно
 * учить отдавать `.wasm`. Грузится он лениво и асинхронно; пока не загрузился,
 * реквизит стоит там, куда положен, — просто ещё не отвечает на толчок.
 */
type Rapier = typeof import('@dimforge/rapier3d-compat');

/**
 * Клетка лагеря в метрах. Житель ростом в клетку с небольшим (VILLAGER_SCALE),
 * то есть клетка — примерно человеческий рост: 1,7 м. Через это число
 * пересчитывается земная гравитация — не подобранное «чтобы красиво падало»,
 * а размер мира, которым уже нарисовано всё остальное.
 */
const METERS_PER_CELL = 1.7;
const GRAVITY = -9.81 / METERS_PER_CELL;

/** Шаг физики — тот же тик, что у симуляции (`core/loop.ts`): 60 Гц. */
const STEP = 1 / 60;
/** Кадр длиннее — это свёрнутая вкладка, а не десять шагов физики разом. */
const MAX_FRAME = 0.1;

/** След героя в клетках: чем он толкает. Уже фигуры — толчок плечом
 *  выглядит толчком, а не сносом бульдозером. */
const HERO_RADIUS = 0.3;

/** Рост поленницы — тот же, что у ресурса в контейнере вылазки:
 *  это одно и то же бревно, и в двух сценах оно одного размера. */
const PROP_HEIGHT = 0.52;

/**
 * Демпфирование сильнее земного: бревно на утоптанной поляне останавливается
 * за метр, а не скользит по ней, как по льду. Юз без него читался бы
 * не «толкнул дрова», а «дрова поехали».
 */
const DAMPING = { linear: 1.2, angular: 1.6 };

/** Что лежит у костра. Смещения — от угла кухни в сторону двора; кучка,
 *  а не ряд: дрова свалены, их так и носят. */
const SPAWN: readonly { model: ResourceModelName; dx: number; dz: number }[] = [
  { model: 'Wood_Log_A', dx: -0.55, dz: 0.15 },
  { model: 'Wood_Log_A', dx: -0.15, dz: -0.2 },
  { model: 'Wood_Log_A', dx: 0.3, dz: 0.1 },
  { model: 'Wood_Log_A', dx: -0.05, dz: 0.45 },
  { model: 'Stone_Chunks_Small', dx: 0.75, dz: -0.35 },
  { model: 'Stone_Chunks_Small', dx: 1.05, dz: 0.05 },
];

interface Prop {
  /** Пивот стоит в центре тела; сам меш сдвинут так, что центр габарита —
   *  в нуле пивота: у запечённой геометрии начало в подошве, а физика
   *  вертит тело вокруг центра масс. */
  readonly pivot: THREE.Group;
  body: import('@dimforge/rapier3d-compat').RigidBody | null;
}

export class CampProps {
  readonly group = new THREE.Group();
  private readonly props: Prop[] = [];
  private readonly material: THREE.MeshLambertMaterial;
  private R: Rapier | null = null;
  private world: import('@dimforge/rapier3d-compat').World | null = null;
  private hero: import('@dimforge/rapier3d-compat').RigidBody | null = null;
  private acc = 0;
  private signature = '';
  private disposed = false;

  constructor(private camp: CampState) {
    this.material = resourceMaterial();
    this.rebuild();
    // Загрузка не ждётся: сцена лагеря обязана открыться и без физики,
    // и открывается — реквизит просто лежит, где положен.
    void this.load();
  }

  private async load(): Promise<void> {
    const R = await import('@dimforge/rapier3d-compat');
    await R.init();
    if (this.disposed) return;
    this.R = R;
    this.buildWorld();
  }

  /**
   * Куда класть кучку: за след кухни (2×2), в сторону центра площади.
   * В сторону центра — не вкус, а гарантия: кухня может стоять у самого
   * края, и кучка, положенная наружу, легла бы в лес.
   */
  private anchor(): { x: number; z: number } {
    const at = this.camp.levels.kitchen > 0 ? this.camp.layout.kitchen : this.camp.layout.hq;
    const area = campArea(this.camp.levels.hq);
    const cx = at.x + 1;
    const cz = at.z + 1;
    const dx = area / 2 - cx;
    const dz = area / 2 - cz;
    const len = Math.max(1e-3, Math.hypot(dx, dz));
    return { x: cx + (dx / len) * 2.1, z: cz + (dz / len) * 2.1 };
  }

  /**
   * Пересборка вида и мира разом. Подпись — раскладка и площадь: переехала
   * кухня — переехали и дрова. Раскиданное при этом собирается обратно
   * в кучку, и это честнее, чем кажется: дрова у костра складывают заново.
   */
  rebuild(camp?: CampState): void {
    if (camp !== undefined) this.camp = camp;
    const area = campArea(this.camp.levels.hq);
    const signature =
      builtBuildings(this.camp)
        .map((id) => `${id}@${this.camp.layout[id].x},${this.camp.layout[id].z}`)
        .join('|') + `#${area}`;
    if (signature === this.signature) return;
    this.signature = signature;

    for (const p of this.props) p.pivot.removeFromParent();
    this.props.length = 0;

    const at = this.anchor();
    for (const s of SPAWN) {
      const geometry = resourceGeometry(s.model, PROP_HEIGHT);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.position.copy(center).negate();
      const pivot = new THREE.Group();
      pivot.add(mesh);
      pivot.position.set(at.x + s.dx + center.x, center.y, at.z + s.dz + center.z);
      this.group.add(pivot);
      this.props.push({ pivot, body: null });
    }
    this.buildWorld();
  }

  /** Мир собирается заново целиком: тел десяток, и правка мира по одному
   *  телу стоила бы больше кода, чем весь этот файл. */
  private buildWorld(): void {
    const R = this.R;
    if (R === null) return;
    this.world?.free();
    this.world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    const world = this.world;

    // Земля. Не полуплоскость, а плита с запасом за края площади:
    // за краем луг, и упавшее с него бревно падало бы вечно.
    world.createCollider(R.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));

    // Постройки — статичные коробки по следу 2×2. Без них толкнутое бревно
    // уезжает сквозь стену кухни, и вся затея читается наоборот:
    // не «в лагере есть вес», а «в лагере есть привидения».
    for (const id of builtBuildings(this.camp)) {
      const p = this.camp.layout[id];
      world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(p.x + 1, 1, p.z + 1));
    }
    for (const t of this.camp.tents) {
      world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(t.x + 0.5, 0.5, t.z + 0.5));
    }

    // Герой — кинематический столбик: физика его не двигает (им ведёт
    // симуляция), но тела он двигает.
    this.hero = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(R.ColliderDesc.capsule(0.35, HERO_RADIUS), this.hero);

    for (const p of this.props) {
      const mesh = p.pivot.children[0] as THREE.Mesh;
      const box = mesh.geometry.boundingBox!;
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(p.pivot.position.x, p.pivot.position.y, p.pivot.position.z)
          .setLinearDamping(DAMPING.linear)
          .setAngularDamping(DAMPING.angular),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.9).setRestitution(0.15),
        body,
      );
      p.body = body;
    }
  }

  /**
   * Кадр физики. Шаг фиксированный и тот же, что у симуляции, — не ради
   * детерминизма (его тут не с чем сверять), а чтобы поведение тел
   * не зависело от герцовки экрана.
   */
  update(dt: number, hero: { x: number; y: number; z: number }): void {
    const world = this.world;
    const heroBody = this.hero;
    if (world === null || heroBody === null) return;
    this.acc = Math.min(this.acc + dt, MAX_FRAME);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      // Капсула стоит подошвой на полу: центр — на половине роста.
      heroBody.setNextKinematicTranslation({ x: hero.x, y: hero.y + 0.65, z: hero.z });
      world.step();
    }
    for (const p of this.props) {
      const body = p.body;
      if (body === null) continue;
      const t = body.translation();
      const q = body.rotation();
      p.pivot.position.set(t.x, t.y, t.z);
      p.pivot.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Ручка отладочной сцены: подбросить всё разом. Ходить до кучки,
   *  чтобы проверить, что физика жива, — незачем. */
  kick(): void {
    for (const p of this.props) {
      p.body?.applyImpulse({ x: (Math.random() - 0.5) * 0.4, y: 0.9, z: (Math.random() - 0.5) * 0.4 }, true);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.world?.free();
    this.world = null;
    this.hero = null;
    for (const p of this.props) p.pivot.removeFromParent();
    this.props.length = 0;
    this.group.removeFromParent();
    // Геометрия — общий кэш `resources.ts`, освобождается только материал.
    this.material.dispose();
  }
}
