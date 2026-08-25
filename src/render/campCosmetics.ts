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
  private readonly motePositions = new Float32Array(6 * 3);
  private readonly moteGeometry = new THREE.BufferGeometry();
  private readonly moteMaterial = new THREE.PointsMaterial({
    color: '#ffd27a',
    size: 0.065,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  private readonly motes = new THREE.Points(this.moteGeometry, this.moteMaterial);
  private readonly glintGeometry = new THREE.RingGeometry(0.055, 0.13, 4);
  private readonly glintMaterial = new THREE.MeshBasicMaterial({
    color: C.lat,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly shieldGlint = new THREE.Mesh(this.glintGeometry, this.glintMaterial);
  private current: CampDecorStyle = 'none';
  private currentArea = -1;

  constructor() {
    this.moteGeometry.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
  }

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
      this.group.add(this.motes);
    } else if (style === 'sentinel') {
      this.addRack(1.1, area - 1.05, 0.35);
      this.addRack(area - 1.1, 1.05, Math.PI + 0.35);
      this.addShield(area * 0.5, area - 0.72);
      this.shieldGlint.position.set(area * 0.5, 0.67, area - 0.82);
      this.group.add(this.shieldGlint);
    }
  }

  update(day: number, now = 0): void {
    setLampsNight(1 - day, this.glow, this.lights);
    const seconds = now / 1000;
    if (this.current === 'wayfarer') {
      const night = Math.min(1, Math.max(0, 1 - day));
      this.motes.visible = night > 0.08;
      this.moteMaterial.opacity = night * (0.48 + Math.sin(seconds * 2.7) * 0.12);
      for (let i = 0; i < 6; i++) {
        const secondLamp = i >= 3;
        const phase = seconds * (0.34 + (i % 3) * 0.055) + i * 1.73;
        const baseX = secondLamp ? this.currentArea - 1.1 : 1.1;
        const baseZ = secondLamp ? this.currentArea - 1.1 : 1.1;
        const at = i * 3;
        this.motePositions[at] = baseX + Math.sin(phase * 2.2) * 0.23;
        this.motePositions[at + 1] = 1.15 + (phase % 1) * 0.72;
        this.motePositions[at + 2] = baseZ + Math.cos(phase * 1.7) * 0.2;
      }
      this.moteGeometry.getAttribute('position').needsUpdate = true;
    } else {
      this.motes.visible = false;
    }
    if (this.current === 'sentinel') {
      const pulse = 0.5 + Math.sin(seconds * 1.9) * 0.5;
      this.glintMaterial.opacity = 0.08 + pulse * 0.24;
      this.shieldGlint.rotation.z = seconds * 0.34;
      this.shieldGlint.scale.setScalar(0.85 + pulse * 0.3);
    } else {
      this.glintMaterial.opacity = 0;
    }
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
    this.moteGeometry.dispose();
    this.moteMaterial.dispose();
    this.glintGeometry.dispose();
    this.glintMaterial.dispose();
  }
}

/** A clan banner can be reused in the personal camp and on the clan glade. */
export class ClanHeraldryLayer {
  readonly group = new THREE.Group();
  private readonly material = blockingMaterial();
  private geometry: THREE.BufferGeometry | null = null;
  private current: ClanHeraldry = 'plain';
  private readonly uniforms: Record<string, THREE.IUniform> = {
    uBannerTime: { value: 0 },
  };

  constructor() {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uBannerTime;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Only cloth and its emblem move: the pole and crossbar remain rigid.
          if (position.x > 0.1 && position.y > 1.4 && position.y < 2.82) {
            float loose = clamp((position.x - 0.1) / 1.35, 0.0, 1.0);
            transformed.z += sin(uBannerTime * 1.75 + position.x * 3.2) * 0.055 * loose;
            transformed.y += cos(uBannerTime * 1.25 + position.x * 2.4) * 0.012 * loose;
          }`,
        );
    };
    this.material.customProgramCacheKey = () => 'clan-banner-sway-v1';
  }

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

  update(now: number): void {
    this.uniforms['uBannerTime']!.value = now / 1000;
  }

  dispose(): void {
    this.geometry?.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
