import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PlayerSignpost } from '../sim/signposts';
import type { Region, WorldNode } from '../sim/world';
import { roadNeighbours } from '../sim/world';

export interface SignBoard {
  readonly text: string;
  readonly turn: number;
}

export interface SignpostSpec {
  readonly x: number;
  readonly z: number;
  readonly boards: readonly SignBoard[];
}

type SignpostKind = 'directions' | 'player';

const MODEL_URL: Record<SignpostKind, string> = {
  directions: `${import.meta.env.BASE_URL}signboards/miiru-signboard-06.glb`,
  player: `${import.meta.env.BASE_URL}signboards/miiru-signboard-05.glb`,
};

const TARGET_HEIGHT: Record<SignpostKind, number> = {
  directions: 2.35,
  player: 2.25,
};

const loader = new GLTFLoader();
const templates = new Map<SignpostKind, Promise<THREE.Object3D>>();

const loadTemplate = (kind: SignpostKind): Promise<THREE.Object3D> => {
  const cached = templates.get(kind);
  if (cached) return cached;
  const loading = loader.loadAsync(MODEL_URL[kind]).then(({ scene }) => {
    scene.updateMatrixWorld(true);
    const initial = new THREE.Box3().setFromObject(scene);
    const size = initial.getSize(new THREE.Vector3());
    scene.scale.setScalar(TARGET_HEIGHT[kind] / Math.max(size.y, 0.001));
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -box.min.y, -center.z);
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return scene;
  });
  templates.set(kind, loading);
  return loading;
};

const labelTexture = (text: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2b2017';
  ctx.font = '700 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shown = text.length > 20 ? `${text.slice(0, 19)}…` : text;
  ctx.fillText(shown, 256, 66, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

interface LabelSlot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

// Координаты поверхностей уже нормализованных оригинальных моделей.
// Нижняя доска №6 смотрит по +X; остальные стрелки остаются чистым декором.
const DIRECTION_SLOTS: readonly LabelSlot[] = [
  { x: 0, y: 1.43, z: 0.53, width: 0.75, height: 0.2 },
];
const PLAYER_SLOT: LabelSlot = { x: 0, y: 1.76, z: 0.102, width: 1.58, height: 0.28 };

/** Указатели MiiruArt с текстом, который остаётся данными игры. */
export class SignpostLayer {
  readonly group = new THREE.Group();
  private readonly disposable: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private revision = 0;

  set(specs: readonly SignpostSpec[]): void {
    this.render(specs, 'directions');
  }

  setPlayers(signs: readonly PlayerSignpost[], offset = { x: 0, z: 0 }): void {
    this.render(signs.map((sign) => ({
      x: sign.x + offset.x,
      z: sign.z + offset.z,
      boards: [{ text: sign.text, turn: sign.turn }],
    })), 'player');
  }

  /** У входа в место — направления по настоящим рёбрам карты. */
  setWorldNode(region: Region, node: WorldNode, at: { x: number; z: number }): void {
    const boards = roadNeighbours(region, node.id).slice(0, 1).map((next) => ({
      text: next.name,
      // Экранная ось y карты становится мировой z. Подписанная стрелка №6 смотрит по +x.
      turn: Math.atan2(-(next.y - node.y), next.x - node.x),
    }));
    this.set(boards.length === 0 ? [] : [{ x: at.x + 0.65, z: at.z + 0.65, boards }]);
  }

  clear(): void {
    this.revision++;
    this.clearObjects();
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private render(specs: readonly SignpostSpec[], kind: SignpostKind): void {
    const revision = ++this.revision;
    this.clearObjects();
    if (specs.length === 0) return;
    void loadTemplate(kind).then((template) => {
      if (revision !== this.revision) return;
      for (const spec of specs) this.addSignpost(template, spec, kind);
      this.group.visible = true;
    }).catch((error: unknown) => {
      console.warn(`Не удалось загрузить модель указателя ${MODEL_URL[kind]}`, error);
    });
  }

  private addSignpost(template: THREE.Object3D, spec: SignpostSpec, kind: SignpostKind): void {
    const post = new THREE.Group();
    post.position.set(spec.x, 0, spec.z);
    post.rotation.y = spec.boards[0]?.turn ?? 0;
    post.add(template.clone(true));

    if (kind === 'player') {
      const board = spec.boards[0];
      if (board) this.addLabel(post, board.text, PLAYER_SLOT);
    } else {
      spec.boards.slice(0, DIRECTION_SLOTS.length).forEach((board, index) => {
        this.addLabel(post, board.text, DIRECTION_SLOTS[index]!);
      });
    }
    this.group.add(post);
  }

  private addLabel(post: THREE.Group, text: string, slot: LabelSlot): void {
    const texture = this.track(labelTexture(text));
    const material = this.track(new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }));
    const geometry = this.track(new THREE.PlaneGeometry(slot.width, slot.height));
    const front = new THREE.Mesh(geometry, material);
    front.position.set(slot.x, slot.y, slot.z);
    front.renderOrder = 2;
    const back = new THREE.Mesh(geometry, material);
    back.position.set(slot.x, slot.y, -slot.z);
    back.rotation.y = Math.PI;
    back.renderOrder = 2;
    post.add(front, back);
  }

  private clearObjects(): void {
    this.group.clear();
    for (const value of this.disposable.splice(0)) value.dispose();
    this.group.visible = false;
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(value: T): T {
    this.disposable.push(value);
    return value;
  }
}
