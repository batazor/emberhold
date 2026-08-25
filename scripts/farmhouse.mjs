/**
 * Конвертация зданий из Farmhouse Pack (FBX) в лёгкие GLB для фермы.
 *
 * Архив не хранится в репозитории: у набора не объявлена лицензия. Скрипт
 * принимает распакованный архив и оставляет в игре только производный меш.
 *
 * Запуск:
 *   npm run farmhouse -- /path/to/unpacked/archive
 *   npm run farmhouse -- /path/to/unpacked/archive --write
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = resolve(import.meta.dirname, '..');
const MODELS = [
  { id: 'fbf2a4a2-1478-4fb6-b18f-7c63f11a74d4', name: 'Barn', file: 'barn.glb' },
  { id: '23eeffda-fb6e-481e-9b93-ffc781b80c5f', name: 'Farmhouse', file: 'farmhouse.glb' },
];
const sourceRoot = process.argv.slice(2).find((value) => !value.startsWith('-'));
const write = process.argv.includes('--write');

if (sourceRoot === undefined) {
  throw new Error('Укажите папку распакованного farmhousezip.zip');
}

await MeshoptSimplifier.ready;

// GLTFExporter в Node нужен только для упаковки ArrayBuffer в Blob.
globalThis.FileReader ??= class FileReader {
  result = null;
  onloadend = null;
  onerror = null;

  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    }, (reason) => this.onerror?.(reason));
  }
};

for (const model of MODELS) {
  const source = resolve(sourceRoot, model.id, 'Pbr', 'base.fbx');
  const bytes = readFileSync(source);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loaded = new FBXLoader().parse(buffer, `${dirname(source)}/`);
  const sourceMesh = loaded.getObjectByProperty('isMesh', true);
  if (!(sourceMesh instanceof THREE.Mesh)) throw new Error(`В FBX не найден меш ${model.name}`);

  const welded = mergeVertices(sourceMesh.geometry, 1e-4);
  const sourceIndex = welded.index;
  if (sourceIndex === null) throw new Error(`Не удалось индексировать меш ${model.name}`);
  const indices = new Uint32Array(sourceIndex.array);
  const positions = welded.getAttribute('position');
  const [simplified, error] = MeshoptSimplifier.simplify(
    indices,
    positions.array,
    positions.itemSize,
    30_000 * 3,
    0.006,
    ['Prune'],
  );
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified);
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(simplified, 1));
  for (const name of ['position', 'normal', 'uv']) {
    const sourceAttribute = welded.getAttribute(name);
    const TargetArray = sourceAttribute.array.constructor;
    const compact = new TargetArray(vertexCount * sourceAttribute.itemSize);
    for (let oldIndex = 0; oldIndex < remap.length; oldIndex += 1) {
      const newIndex = remap[oldIndex];
      if (newIndex === 0xffffffff) continue;
      for (let component = 0; component < sourceAttribute.itemSize; component += 1) {
        compact[newIndex * sourceAttribute.itemSize + component] =
          sourceAttribute.array[oldIndex * sourceAttribute.itemSize + component];
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(compact, sourceAttribute.itemSize));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff }));
  mesh.name = `FarmhousePack${model.name}`;
  const exported = await new GLTFExporter().parseAsync(mesh, { binary: true, onlyVisible: true });
  if (!(exported instanceof ArrayBuffer)) throw new Error('GLTFExporter вернул не GLB');
  const output = resolve(ROOT, 'public/assets/farm', model.file);
  console.log(JSON.stringify({
    model: model.name,
    sourceTriangles: sourceIndex.count / 3,
    triangles: simplified.length / 3,
    vertices: vertexCount,
    relativeError: error,
    bytes: exported.byteLength,
    output,
  }, null, 2));
  if (write) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, new Uint8Array(exported));
  }
}
