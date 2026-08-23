import * as THREE from 'three';
import { MATERIAL, PALETTE } from './palette';

/**
 * Первый вид Фермы: отдельная соседняя локация с огородом первого уровня.
 * Пока она не считает урожай — это сцена-награда и основа для будущих грядок.
 */
export class FarmView {
  readonly group = new THREE.Group();
  readonly center = { x: 4.5, z: 4.5 };
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor() {
    this.buildGround();
    this.buildBeds();
    this.buildFence();
    this.buildShed();
    this.group.visible = false;
  }

  private geometry<T extends THREE.BufferGeometry>(value: T): T {
    this.geometries.push(value);
    return value;
  }

  private material<T extends THREE.Material>(value: T): T {
    this.materials.push(value);
    return value;
  }

  private box(
    size: [number, number, number],
    color: number,
    at: [number, number, number],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.geometry(new THREE.BoxGeometry(...size)),
      this.material(new THREE.MeshLambertMaterial({ color })),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildGround(): void {
    this.box([10, 0.35, 10], PALETTE.grassBase, [4.5, -0.2, 4.5]);
    // Тропа связывает вход с сараем и делит поле на читаемые участки.
    this.box([1.1, 0.06, 8.6], MATERIAL['солома'], [4.5, 0.01, 4.7]);
  }

  private buildBeds(): void {
    const soil = MATERIAL['земля'];
    const green = MATERIAL['трава'];
    const leaf = MATERIAL['хвоя'];
    const stemGeo = this.geometry(new THREE.CylinderGeometry(0.025, 0.035, 0.28, 5));
    const leafGeo = this.geometry(new THREE.ConeGeometry(0.12, 0.25, 5));
    const stemMat = this.material(new THREE.MeshLambertMaterial({ color: green }));
    const leafMat = this.material(new THREE.MeshLambertMaterial({ color: leaf }));

    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const x = 4.5 + side * (1.45 + row * 0.72);
        this.box([0.48, 0.14, 6.4], soil, [x, 0, 4.7]);
        for (let z = 2; z <= 7.4; z += 0.9) {
          const stem = new THREE.Mesh(stemGeo, stemMat);
          stem.position.set(x, 0.2, z);
          const crown = new THREE.Mesh(leafGeo, leafMat);
          crown.position.set(x, 0.43, z);
          crown.rotation.y = (row + z) * 0.7;
          crown.castShadow = true;
          this.group.add(stem, crown);
        }
      }
    }
  }

  private buildFence(): void {
    const wood = MATERIAL['дерево'];
    for (let x = 0; x <= 9; x++) {
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 0]);
      this.box([0.09, 0.65, 0.09], wood, [x, 0.3, 9]);
    }
    for (let z = 1; z < 9; z++) {
      this.box([0.09, 0.65, 0.09], wood, [0, 0.3, z]);
      this.box([0.09, 0.65, 0.09], wood, [9, 0.3, z]);
    }
    this.box([9, 0.1, 0.1], wood, [4.5, 0.48, 0]);
    this.box([9, 0.1, 0.1], wood, [4.5, 0.48, 9]);
    this.box([0.1, 0.1, 9], wood, [0, 0.48, 4.5]);
    this.box([0.1, 0.1, 9], wood, [9, 0.48, 4.5]);
  }

  private buildShed(): void {
    const wall = MATERIAL['дерево-свет'];
    const dark = MATERIAL['дерево-тень'];
    this.box([2.2, 1.55, 1.8], wall, [4.5, 0.78, 8.05]);
    this.box([0.65, 1.2, 0.08], dark, [4.5, 0.58, 7.1]);
    const roof = this.box([2.65, 0.18, 2.15], dark, [4.5, 1.68, 8.05]);
    roof.rotation.z = 0.08;
    // Бочки и ящики дают масштабу хозяйственный, а не декоративный смысл.
    this.box([0.55, 0.55, 0.55], MATERIAL['солома'], [6.2, 0.27, 8.1]);
    const barrel = new THREE.Mesh(
      this.geometry(new THREE.CylinderGeometry(0.32, 0.32, 0.65, 10)),
      this.material(new THREE.MeshLambertMaterial({ color: dark })),
    );
    barrel.position.set(2.9, 0.32, 8.1);
    barrel.castShadow = true;
    this.group.add(barrel);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

