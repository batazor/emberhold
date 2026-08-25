import * as THREE from 'three';
import { type CampDecorStyle, type ClanHeraldry, campDecorStyle, clanHeraldry } from '../core/cosmetics';
import { C, box, merge, rod, type Piece, blockingMaterial } from './blocking';
import { lampGlowMaterial, lampLight, lampParts, propsMaterial, setLampsNight } from './props';

/** Decorative sets are a render-only layer: they never occupy simulation cells. */
export class CampDecorLayer {
  readonly group = new THREE.Group();
  private readonly material = blockingMaterial();
  private readonly props = propsMaterial();
  private readonly glow = lampGlowMaterial();
  private readonly lights: THREE.PointLight[] = [];
  private readonly generated: THREE.BufferGeometry[] = [];
  private current: CampDecorStyle = 'none';
  private currentArea = -1;

  set(value: unknown, area: number): void {
    const style = campDecorStyle(value);
    if (style === this.current && area === this.currentArea && this.group.children.length > 0) return;
    this.clear();
    this.current = style;
    this.currentArea = area;
    if (style === 'wayfarer') {
      this.addLamp(1.1, 1.1, 0.25);
      this.addLamp(area - 1.1, area - 1.1, Math.PI + 0.25);
      this.addBench(area * 0.5, area - 0.75, 0);
    } else if (style === 'sentinel') {
      this.addRack(1.1, area - 1.05, 0.35);
      this.addRack(area - 1.1, 1.05, Math.PI + 0.35);
      this.addShield(area * 0.5, area - 0.72);
    }
  }

  update(day: number): void {
    setLampsNight(1 - day, this.glow, this.lights);
  }

  private addLamp(x: number, z: number, turn: number): void {
    const parts = lampParts('Lamp_1');
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.rotation.y = turn;
    const post = new THREE.Mesh(parts.post, this.props);
    const glow = new THREE.Mesh(parts.glow, this.glow);
    const light = lampLight();
    light.position.set(...parts.lampAt);
    post.castShadow = true;
    post.receiveShadow = true;
    holder.add(post, glow, light);
    this.lights.push(light);
    this.group.add(holder);
  }

  private addBench(x: number, z: number, turn: number): void {
    const parts: Piece[] = [
      box(0, 0.42, 0, 1.65, 0.16, 0.45, C.der),
      box(0, 0.78, -0.18, 1.65, 0.55, 0.12, C.derS),
      rod([-0.66, 0, -0.12], [-0.66, 0.82, -0.12], 0.07, 5, C.derT),
      rod([0.66, 0, -0.12], [0.66, 0.82, -0.12], 0.07, 5, C.derT),
    ];
    this.addGenerated(parts, x, z, turn);
  }

  private addRack(x: number, z: number, turn: number): void {
    const parts: Piece[] = [
      rod([-0.7, 0, 0], [-0.7, 1.45, 0], 0.07, 5, C.derT),
      rod([0.7, 0, 0], [0.7, 1.45, 0], 0.07, 5, C.derT),
      rod([-0.78, 1.2, 0], [0.78, 1.2, 0], 0.08, 5, C.der),
      rod([-0.52, 0.18, 0.02], [0.42, 1.72, 0.02], 0.055, 5, C.stal),
      rod([0.5, 0.18, -0.02], [-0.4, 1.62, -0.02], 0.055, 5, C.stal),
    ];
    this.addGenerated(parts, x, z, turn);
  }

  private addShield(x: number, z: number): void {
    const parts: Piece[] = [
      box(0, 0.1, 0, 0.95, 1.05, 0.15, C.krasA),
      box(0, 0.52, -0.09, 0.18, 0.18, 0.05, C.lat),
      rod([0, 0, 0.18], [0, 1.55, 0.18], 0.06, 5, C.derT),
    ];
    this.addGenerated(parts, x, z, 0);
  }

  private addGenerated(parts: readonly Piece[], x: number, z: number, turn: number): void {
    const geometry = merge(parts);
    this.generated.push(geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = turn;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private clear(): void {
    this.group.clear();
    this.lights.length = 0;
    for (const geometry of this.generated.splice(0)) geometry.dispose();
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.props.dispose();
    this.glow.dispose();
  }
}

/** A clan banner can be reused in the personal camp and on the clan glade. */
export class ClanHeraldryLayer {
  readonly group = new THREE.Group();
  private readonly material = blockingMaterial();
  private geometry: THREE.BufferGeometry | null = null;
  private current: ClanHeraldry = 'plain';

  set(value: unknown, x: number, z: number, turn = 0): void {
    const style = clanHeraldry(value);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = turn;
    if (style === this.current && this.group.children.length > 0) return;
    this.geometry?.dispose();
    this.group.clear();
    this.current = style;
    if (style === 'plain') return;
    const cloth = style === 'raven' ? '#8f2f2b' : '#315d82';
    const emblem = style === 'raven' ? C.mrak : C.lat;
    const parts: Piece[] = [
      rod([0, 0, 0], [0, 3.1, 0], 0.055, 6, C.derT),
      rod([0, 2.9, 0], [1.45, 2.9, 0], 0.045, 6, C.derT),
      box(0.76, 1.45, 0, 1.35, 1.35, 0.07, cloth),
      box(0.76, 1.94, -0.055, style === 'raven' ? 0.72 : 0.58, 0.16, 0.04, emblem),
      box(0.76, 1.66, -0.055, 0.16, style === 'raven' ? 0.72 : 0.58, 0.04, emblem),
      box(0.76, 1.94, 0.055, style === 'raven' ? 0.72 : 0.58, 0.16, 0.04, emblem),
      box(0.76, 1.66, 0.055, 0.16, style === 'raven' ? 0.72 : 0.58, 0.04, emblem),
    ];
    this.geometry = merge(parts);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  dispose(): void {
    this.geometry?.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
