// Normalizes and optimizes the source car models for the game.
//  - bakes every node transform into the vertices (flat hierarchy)
//  - rotates so the car faces +Z, scales to the real-world length, puts the tyres on y=0
//  - detects the four wheels, straightens pre-steered front wheels (PCA of the tyre),
//    and re-parents each wheel under a pivot node (wheel_FL/FR/RL/RR) at the hub centre
//  - strips hidden parts, merges draw calls per material, optionally simplifies,
//    and re-encodes textures as WebP
// Usage: node tools/optimize-models.mjs <source-dir> [id...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, prune, simplify, weld, textureCompress, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { existsSync, mkdirSync } from 'node:fs';
import { join as pjoin, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = pjoin(here, '..', 'public', 'models');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: optimize-models.mjs <source-dir> [id...]'); process.exit(1); }

const CARS = [
  { id: 'porsche930', head: /^Material\.013$/, tail: /^Material\.006$/, file: 'porsche_911_930_turbo_1975.glb', length: 4.29, forward: +1,
    tire: /^Material\.008$/, tex: 2048 },
  { id: 'countach', head: /^Material\.005$/, tail: /^Material\.009$/, file: '2021_lamborghini_countach_lpi_800-4.glb', length: 4.87, forward: -1,
    tire: /^Material\.025$/, tex: 2048 },
  { id: 'integra', head: /^glasslight$/, tail: /^taillights$/, file: 'integra/scene.gltf', length: 4.52, forward: +1,
    tire: /^rubber\.00[2-4]$|^rubber$/, tex: 1024, simplify: 0.6 },
  { id: 'rav4', head: /^Tdummy_material_2_027$/, tail: /^red_glass$/, file: 'rav4/scene.gltf', length: 4.60, forward: +1,
    tire: /^Tdummy_material_0_133$/, tex: 1024, simplify: 0.12, simplifyError: 0.004,
    remove: [/SM_Engine/, /SK_Suspension/, /SK_Exhaust/] },
  { id: 'townace', head: /^Material\.006$/, tail: /^Material\.002$/, file: 'townace/scene.gltf', length: 4.45, forward: +1,
    tire: /^Material\.009$/, tex: 1024, simplify: 0.8 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function nodePath(node) {
  const names = [];
  for (let n = node; n; n = n.getParentNode()) names.push(n.getName());
  return names.reverse().join('/');
}

/** Deep-copies a primitive's vertex streams so in-place edits never leak to other users. */
function ownPrimitive(prim) {
  for (const sem of prim.listSemantics()) prim.setAttribute(sem, prim.getAttribute(sem).clone());
  const idx = prim.getIndices();
  if (idx) prim.setIndices(idx.clone());
}

function transformPrim(prim, m4) {
  const nm = new THREE.Matrix3().getNormalMatrix(m4);
  const v = new THREE.Vector3();
  const pos = prim.getAttribute('POSITION');
  const el = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, el); v.fromArray(el).applyMatrix4(m4); pos.setElement(i, v.toArray());
  }
  const nor = prim.getAttribute('NORMAL');
  if (nor) for (let i = 0; i < nor.getCount(); i++) {
    nor.getElement(i, el); v.fromArray(el).applyMatrix3(nm).normalize(); nor.setElement(i, v.toArray());
  }
  const tan = prim.getAttribute('TANGENT');
  if (tan) {
    const e4 = [0, 0, 0, 0];
    const flip = m4.determinant() < 0 ? -1 : 1;
    for (let i = 0; i < tan.getCount(); i++) {
      tan.getElement(i, e4); v.set(e4[0], e4[1], e4[2]).transformDirection(m4);
      tan.setElement(i, [v.x, v.y, v.z, e4[3] * flip]);
    }
  }
  // A mirroring transform flips winding; swap indices to keep faces front-facing.
  if (m4.determinant() < 0) {
    const idx = prim.getIndices();
    if (idx) {
      const a = idx.getArray();
      for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      idx.setArray(a);
    }
  }
}

function meshBox(mesh) {
  const box = new THREE.Box3();
  const el = [0, 0, 0];
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, el); box.expandByPoint(new THREE.Vector3().fromArray(el)); }
  }
  return box;
}

/** Smallest-variance axis of the tyre vertices = the axle direction. */
function axleOf(mesh, center) {
  const c = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  const el = [0, 0, 0];
  let n = 0;
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      const x = el[0] - center.x, y = el[1] - center.y, z = el[2] - center.z;
      c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z; n++;
    }
  }
  const m = new THREE.Matrix3().set(c[0], c[1], c[2], c[1], c[3], c[4], c[2], c[4], c[5]);
  // Inverse power iteration -> eigenvector of the smallest eigenvalue.
  const inv = m.clone().invert();
  let v = new THREE.Vector3(1, 0.1, 0.1).normalize();
  for (let i = 0; i < 64; i++) v = v.applyMatrix3(inv).normalize();
  return v;
}

async function processCar(car) {
  const src = pjoin(SRC, car.file);
  if (!existsSync(src)) { console.warn('skip (missing):', src); return; }
  console.log(`\n== ${car.id}  <- ${car.file}`);
  const doc = await io.read(src);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];

  // 1. Bake world transforms into geometry, collect mesh nodes.
  const items = [];
  const seenMesh = new Set();
  for (const node of root.listNodes()) {
    let mesh = node.getMesh();
    if (!mesh) continue;
    const path = nodePath(node);
    if (car.remove && car.remove.some(r => r.test(path))) continue;
    if (seenMesh.has(mesh)) mesh = mesh.clone();
    seenMesh.add(mesh);
    const prims = mesh.listPrimitives();
    for (const p of prims) {
      if (p.getMode() !== 4) { mesh.removePrimitive(p); continue; }
      const q = p.clone();
      ownPrimitive(q);
      mesh.removePrimitive(p);
      mesh.addPrimitive(q);
    }
    const wm = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) transformPrim(p, wm);
    items.push({ mesh, path, mat: () => mesh.listPrimitives()[0]?.getMaterial()?.getName() || '' });
  }
  // Detach all original nodes.
  for (const n of root.listNodes()) n.dispose();

  // 2. Normalize: forward +Z, scale to real length, centre, tyres on the ground.
  const all = new THREE.Box3();
  for (const it of items) all.union(meshBox(it.mesh));
  const size = all.getSize(new THREE.Vector3());
  const scale = car.length / size.z;
  // Tyre candidates: right material and a wheel-like bounding box (tall and thin, or a
  // pre-steered wheel whose footprint is still no longer than its height).
  const tyres = items.filter(it => {
    if (!it.mesh.listPrimitives().some(p => car.tire.test(p.getMaterial()?.getName() || ''))) return false;
    const s = meshBox(it.mesh).getSize(new THREE.Vector3());
    return Math.max(s.x, s.z) <= s.y * 1.25 && Math.min(s.x, s.z) < s.y * 0.97;
  });
  const tyreBox = new THREE.Box3();
  for (const t of tyres) tyreBox.union(meshBox(t.mesh));
  const ctr = all.getCenter(new THREE.Vector3());
  const N = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .premultiply(new THREE.Matrix4().makeRotationY(car.forward > 0 ? 0 : Math.PI));
  const T = new THREE.Matrix4().makeTranslation(-ctr.x, -tyreBox.min.y, -ctr.z);
  N.multiply(T);
  for (const it of items) for (const p of it.mesh.listPrimitives()) transformPrim(p, N);
  console.log(`  raw size ${size.toArray().map(v => v.toFixed(2))} scale ${scale.toFixed(3)} tyres=${tyres.length}`);

  // Lamp centroids (left/right halves), used for glow sprites and light sources at runtime.
  const lamp = (re, front) => {
    const acc = [[0, 0, 0, 0], [0, 0, 0, 0]];
    const el = [0, 0, 0];
    for (const it of items) for (const p of it.mesh.listPrimitives()) {
      if (!re || !re.test(p.getMaterial()?.getName() || '')) continue;
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        if (front ? el[2] < car.length * 0.25 : el[2] > -car.length * 0.25) continue;
        const a = acc[el[0] > 0 ? 0 : 1];
        a[0] += el[0]; a[1] += el[1]; a[2] += el[2]; a[3]++;
      }
    }
    return acc.filter(a => a[3]).map(a => [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map(v => +v.toFixed(3)));
  };
  const lights = { head: lamp(car.head, true), tail: lamp(car.tail, false) };
  console.log('  lights', JSON.stringify(lights));

  // 3. Wheels.
  const wheels = [];
  for (const t of tyres) {
    const b = meshBox(t.mesh);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    const r = s.y / 2;
    if (r < 0.2 || r > 0.5) continue;
    let w = wheels.find(w => w.center.distanceTo(c) < r);
    if (!w) { w = { center: c.clone(), r, tyres: [] }; wheels.push(w); }
    w.tyres.push(t);
  }
  if (wheels.length !== 4) console.warn(`  !! found ${wheels.length} wheels`);
  for (const w of wheels) {
    w.key = (w.center.z > 0 ? 'F' : 'R') + (w.center.x > 0 ? 'L' : 'R');
    w.members = [];
  }
  const body = [];
  for (const it of items) {
    const b = meshBox(it.mesh);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    const w = wheels.find(w => c.distanceTo(w.center) < w.r * 0.95 && Math.max(s.x, s.y, s.z) < w.r * 2.3);
    (w ? w.members : body).push(it);
  }
  const carNode = doc.createNode('car');
  scene.addChild(carNode);
  const bodyNode = doc.createNode('body');
  carNode.addChild(bodyNode);
  for (const it of body) bodyNode.addChild(doc.createNode('b').setMesh(it.mesh));

  const meta = { id: car.id, length: car.length, wheels: {}, lights };
  for (const w of wheels) {
    const tyreMesh = w.tyres[0].mesh;
    const axle = axleOf(tyreMesh, w.center);
    let yaw = Math.atan2(-axle.z, axle.x);
    if (yaw > Math.PI / 2) yaw -= Math.PI; else if (yaw < -Math.PI / 2) yaw += Math.PI;
    const M = new THREE.Matrix4().makeTranslation(-w.center.x, -w.center.y, -w.center.z);
    if (Math.abs(yaw) > THREE.MathUtils.degToRad(1)) {
      M.premultiply(new THREE.Matrix4().makeRotationY(-yaw));
      console.log(`  ${w.key}: straightened ${THREE.MathUtils.radToDeg(yaw).toFixed(1)} deg`);
    }
    for (const it of w.members) for (const p of it.mesh.listPrimitives()) transformPrim(p, M);
    w.straightened = Math.abs(yaw) > THREE.MathUtils.degToRad(1);
  }
  // Pre-steered wheels pivot around an offset kingpin, so their hubs sit at different z.
  // Put each axle back to a symmetric, straight-ahead position.
  for (const axle of ['F', 'R']) {
    const pair = wheels.filter(w => w.key[0] === axle);
    if (pair.length === 2 && pair.some(w => w.straightened)) {
      const z = (pair[0].center.z + pair[1].center.z) / 2;
      const x = (Math.abs(pair[0].center.x) + Math.abs(pair[1].center.x)) / 2;
      for (const w of pair) { w.center.z = z; w.center.x = Math.sign(w.center.x) * x; }
    }
  }
  for (const w of wheels) {
    const wn = doc.createNode('wheel_' + w.key).setTranslation(w.center.toArray());
    carNode.addChild(wn);
    for (const it of w.members) wn.addChild(doc.createNode('w').setMesh(it.mesh));
    meta.wheels[w.key] = { x: +w.center.x.toFixed(4), y: +w.center.y.toFixed(4), z: +w.center.z.toFixed(4), r: +w.r.toFixed(4) };
    console.log(`  ${w.key}: centre ${w.center.toArray().map(v => v.toFixed(3))} r=${w.r.toFixed(3)} parts=${w.members.length}`);
  }
  const nb = new THREE.Box3();
  for (const it of items) nb.union(meshBox(it.mesh).applyMatrix4(new THREE.Matrix4()));
  meta.size = all.clone().applyMatrix4(N).getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3));
  carNode.setExtras({ carMeta: meta });

  // Remove now-unused meshes/nodes, merge draw calls.
  await doc.transform(
    prune({ keepLeaves: false }),
    dedup(),
    join({ keepNamed: false }),
    weld(),
  );
  for (const p of root.listMeshes().flatMap(m => m.listPrimitives())) {
    if (!p.getAttribute('NORMAL')) { await doc.transform(normals({ overwrite: false })); break; }
  }
  if (car.simplify) {
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: car.simplify, error: car.simplifyError || 0.0008, lockBorder: true }));
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [car.tex, car.tex], quality: 92,
      slots: /^(?!normalTexture).*$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [car.tex, car.tex], lossless: true,
      slots: /^normalTexture$/ }),
    prune(), dedup(),
  );

  let tris = 0, draws = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { tris += p.getIndices() ? p.getIndices().getCount() / 3 : 0; draws++; }
  mkdirSync(OUT, { recursive: true });
  const out = pjoin(OUT, car.id + '.glb');
  await io.write(out, doc);
  console.log(`  -> ${out}  tris=${tris} draws=${draws} size=${meta.size}`);
}

const only = process.argv.slice(3);
for (const car of CARS) if (!only.length || only.includes(car.id)) await processCar(car);
