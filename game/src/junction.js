// 千鳥橋JCT: a second expressway crossing over the course on tall piers, with lamps and
// moving traffic, so the junction reads as a multi-level interchange.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track, makeFrame } from './track.js';
import { extrude } from './trackmesh.js';
import { makeRoadMaterial, makeSurfaceMaterial } from './trackmaterials.js';
import { GlowBatch } from './npcbatch.js';
import { LAMP, U } from './lighting.js';
import { LAYER, setLayers, glowTexture } from './util.js';

export function buildJunction(main, crossS = 6020) {
  const group = new THREE.Group();
  group.name = 'junction';
  const f = makeFrame();
  main.frame(crossS, f);
  const angle = f.heading + 1.15;
  const start = f.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)), -700);
  const h = f.pos.y + 13.5;
  const cross = new Track([[500, 0, h], [400, -6, h + 1], [600, 18, h - 4], [300, 0, h - 8]], { heading0: angle, origin: [start.x, start.z] });

  // Deck: one 2-lane carriageway each way.
  const W = 4.2;
  const road = [[W + 1.0, 0], [W, 0], [0.12, 0], [-0.12, 0], [-W, 0], [-W - 1.0, 0], [-W - 2.2, 0], [-2 * W - 2.2, 0], [-2 * W - 3.2, 0]];
  const parapetL = [[W + 1.5, -1.8], [W + 1.5, 1.05], [W + 1.0, 1.05], [W + 1.0, 0]];
  const parapetR = [[-2 * W - 3.2, 0], [-2 * W - 3.2, 1.05], [-2 * W - 3.7, 1.05], [-2 * W - 3.7, -1.8]];
  const median = [[-W - 1.2, 0], [-W - 1.3, 0.85], [-W - 1.9, 0.85], [-W - 2.0, 0]];
  const under = [[-2 * W - 3.7, -1.8], [W + 1.5, -1.8]];
  const L = cross.length;
  const roadMat = makeRoadMaterial();
  roadMat.uniforms = { ...U, uReflOn: { value: 0 } };
  const add = (geo, mat, layers) => { const m = new THREE.Mesh(geo, mat); setLayers(m, ...layers); group.add(m); };
  const ALL = [LAYER.MAIN, LAYER.ENV, LAYER.REFLECT];
  add(extrude(cross, road, 0, L, 3), roadMat, [LAYER.MAIN, LAYER.ENV]);
  const conc = makeSurfaceMaterial(0);
  add(extrude(cross, parapetL, 0, L, 3), conc, ALL);
  add(extrude(cross, parapetR, 0, L, 3), conc, ALL);
  add(extrude(cross, median, 0, L, 3), makeSurfaceMaterial(4), ALL);
  add(extrude(cross, under, 0, L, 6), makeSurfaceMaterial(3), ALL);

  // Tall piers (skip where they'd stand on the main deck).
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x6e6c68, roughness: 0.92 });
  const pg = [];
  for (let s = 20; s < L; s += 40) {
    cross.frame(s, f);
    const c = f.pos.clone().addScaledVector(f.left, -W - 1.6);
    const pr = main.project(c.x, c.z);
    if (Math.abs(pr.d + 7) < 20 && pr.s > 1) continue;
    const hgt = f.pos.y - 1.8;
    pg.push(new THREE.CylinderGeometry(1.3, 1.5, hgt, 14).translate(c.x, hgt / 2, c.z));
    pg.push(new THREE.BoxGeometry(2 * W + 6, 1.2, 2.2).rotateY(f.heading).translate(c.x, hgt - 0.6, c.z));
  }
  add(mergeGeometries(pg), pierMat, ALL);

  // Lamps on the crossing.
  const heads = [], poles = [];
  for (let s = 10; s < L; s += 34) {
    for (const side of [W + 1.2, -2 * W - 3.4]) {
      const p = cross.point(s, side, 0);
      const inward = side > 0 ? -1 : 1;
      const lp = cross.point(s, side + inward * 2.2, 9.5);
      poles.push(new THREE.CylinderGeometry(0.1, 0.14, 9.6, 8).translate(p.x, p.y + 4.8, p.z));
      heads.push(new THREE.BoxGeometry(0.5, 0.12, 0.5).translate(lp.x, lp.y, lp.z));
    }
  }
  add(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.45, metalness: 0.7 }), ALL);
  add(mergeGeometries(heads), new THREE.MeshBasicMaterial({ color: LAMP.color.clone().multiplyScalar(26) }), ALL);

  // Moving traffic: lamp glows only (seen from below, at a distance).
  const glow = new GlowBatch(80, glowTexture());
  group.add(glow.mesh);
  const cars = [];
  for (let i = 0; i < 18; i++) cars.push({ s: Math.random() * L, lane: i % 4, v: 18 + Math.random() * 10 });
  const v = new THREE.Vector3();
  const update = (dt) => {
    glow.begin();
    for (const c of cars) {
      const dir = c.lane < 2 ? 1 : -1;
      c.s = (c.s + dir * c.v * dt + L) % L;
      const d = [W * 0.5, -W * 0.5 + 0.4, -W - 2.2 - W * 0.5, -W - 2.2 - W * 1.5 + 0.4][c.lane];
      for (const off of [-0.7, 0.7]) {
        // Head pair facing the direction of travel, tail pair behind.
        cross.point(c.s + dir * 2.2, d + off, 0.7, v);
        glow.add(v.x, v.y, v.z, 0.8, 3.5, 3.3, 3.0);
        cross.point(c.s - dir * 2.2, d + off, 0.8, v);
        glow.add(v.x, v.y, v.z, 0.55, 2.2, 0.08, 0.05);
      }
    }
    glow.end();
  };
  return { group, update, cross };
}
