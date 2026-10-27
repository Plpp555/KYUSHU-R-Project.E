// NPC traffic on both carriageways (Integra / RAV4 / TownAce), plus the shared
// track-space collision helper used by player, rival and traffic.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CarVisual, NPC_COLORS } from './cars.js';
import { LANES, ONCOMING_D, makeFrame } from './track.js';
import { orientOnTrack } from './physics.js';
import { LAYER, setLayers, mulberry32, clamp, lerp } from './util.js';
import { TUNNEL } from './course.js';

const LOD_DIST = 95;

/** Single-draw stand-in used beyond LOD_DIST (at night only the silhouette and lamps read). */
function proxyGeometry(meta) {
  const [w, h, l] = meta.size;
  const bw = Math.min(w, 2.0) * 0.98;
  const lower = new THREE.BoxGeometry(bw, h * 0.48, l * 0.97).translate(0, h * 0.32, 0);
  const cabin = new THREE.BoxGeometry(bw * 0.84, h * 0.4, l * 0.5).translate(0, h * 0.74, -l * 0.04);
  return mergeGeometries([lower, cabin]);
}

class NPC {
  constructor(template, color, rng, oncoming) {
    this.template = template;
    this.visual = new CarVisual(template, { paint: color, beams: oncoming });
    this.lod = new THREE.LOD();
    this.proxyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35, envMapIntensity: 1.2 });
    const proxy = new THREE.Mesh(template.proxyGeo, this.proxyMat);
    const far = new THREE.Group();
    far.add(proxy);
    // Lamps stay visible on the proxy.
    for (const s of this.visual.tailGlows) far.add(s.clone());
    for (const s of this.visual.headGlows) if (s.scale.x < 2) far.add(s.clone());
    this.lod.addLevel(this.visual.root, 0);
    this.lod.addLevel(far, LOD_DIST);
    this.root = new THREE.Group();
    this.root.add(this.lod);
    setLayers(this.root, LAYER.MAIN, LAYER.REFLECT);
    this.visual.root.traverse(o => { if (o.material && o.material.alphaMap) o.layers.set(LAYER.MAIN); });
    this.oncoming = oncoming;
    this.halfL = template.meta.size[2] / 2 - 0.1;
    this.halfW = Math.min(template.meta.size[0], 2.0) / 2 - 0.05;
    this.mass = template.id === 'townace' ? 1500 : template.id === 'rav4' ? 1650 : 1200;
    this.rng = rng;
    this.active = false;
    this.blink = 0;
    this.quat = new THREE.Quaternion();
  }

  spawn(s, lane, v) {
    this.s = s; this.lane = lane; this.targetLane = lane;
    this.d = this.laneD(lane);
    this.v = v; this.cruise = v;
    this.dVel = 0;
    this.laneTimer = 4 + this.rng() * 10;
    this.active = true;
    this.root.visible = true;
    this.bumped = 0;
    this.yawOffset = 0; this.yawVel = 0;
  }

  laneD(lane) { return this.oncoming ? ONCOMING_D - LANES[lane] : LANES[lane]; }
}

export class Traffic {
  constructor(world, templates, quality) {
    this.world = world;
    this.track = world.track;
    this.rng = mulberry32(4242);
    this.cars = [];
    this.oncoming = [];
    for (const t of templates) if (!t.proxyGeo) t.proxyGeo = proxyGeometry(t.meta);
    const pick = () => templates[Math.floor(this.rng() * templates.length)];
    const color = () => NPC_COLORS[Math.floor(this.rng() * NPC_COLORS.length)];
    for (let i = 0; i < quality.traffic; i++) {
      const n = new NPC(pick(), color(), this.rng, false);
      this.cars.push(n); world.scene.add(n.root);
    }
    for (let i = 0; i < quality.oncoming; i++) {
      const n = new NPC(pick(), color(), this.rng, true);
      this.oncoming.push(n); world.scene.add(n.root);
    }
    this.frame = makeFrame();
    this.ahead = 950; this.behind = 220;
  }

  reset(focusS, clearAroundS = null) {
    const r = this.rng;
    this.cars.forEach((c, i) => {
      let s = focusS + 120 + (i / this.cars.length) * (this.ahead - 120) + r() * 25;
      if (clearAroundS !== null && Math.abs(s - clearAroundS) < 90) s += 140;
      this.spawnSafe(c, s);
    });
    this.oncoming.forEach((c, i) => {
      const s = focusS - 100 + (i / this.oncoming.length) * (this.ahead + 200);
      c.spawn(s, Math.floor(r() * 3), (70 + r() * 35) / 3.6);
    });
  }

  spawnSafe(c, s) {
    const r = this.rng;
    for (let k = 0; k < 6; k++) {
      const lane = Math.floor(r() * 3);
      const ok = this.cars.every(o => o === c || !o.active || o.lane !== lane || Math.abs(o.s - s) > 26);
      if (ok) { c.spawn(s, lane, (62 + r() * 48) / 3.6); return; }
      s += 20;
    }
    c.spawn(s, Math.floor(r() * 3), 70 / 3.6);
  }

  /** Nearest car ahead in a lane (by lateral overlap) from position s,d. */
  leader(s, d, halfW, exclude) {
    let best = null, gap = Infinity;
    for (const o of this.cars) {
      if (!o.active || o === exclude) continue;
      const ds = o.s - s;
      if (ds <= 0 || ds > 160) continue;
      if (Math.abs(o.d - d) > o.halfW + halfW + 0.4) continue;
      if (ds < gap) { gap = ds; best = o; }
    }
    return best ? { car: best, gap } : null;
  }

  update(dt, focusS, camera) {
    const tr = this.track;
    for (const c of this.cars) {
      if (!c.active) continue;
      // Recycle cars that fell far behind / far ahead.
      if (c.s < focusS - this.behind || c.s > focusS + this.ahead + 300) {
        this.spawnSafe(c, focusS + this.ahead * (0.65 + this.rng() * 0.35));
      }
      // Car following.
      const lead = this.leader(c.s, c.d, c.halfW, c);
      let target = c.cruise;
      if (lead) {
        const safe = 10 + c.v * 1.1;
        if (lead.gap < safe) target = Math.min(target, lead.car.v - (safe - lead.gap) * 0.25);
      }
      if (c.bumped > 0) { c.bumped -= dt; target = Math.max(target, c.v); }
      const acc = target > c.v ? 2.2 : 6.5;
      c.v = Math.max(0, c.v + clamp(target - c.v, -acc * dt, acc * dt));
      c.brake = target < c.v - 0.3 || (lead && lead.gap < 18) ? 1 : 0;
      // Lane changes.
      c.laneTimer -= dt;
      if (c.laneTimer < 0 && c.targetLane === c.lane) {
        c.laneTimer = 6 + this.rng() * 12;
        const nl = clamp(c.lane + (this.rng() < 0.5 ? -1 : 1), 0, 2);
        const free = this.cars.every(o => o === c || !o.active || Math.abs(o.d - LANES[nl]) > 2 || Math.abs(o.s - c.s) > 22);
        if (nl !== c.lane && free && !(c.s > TUNNEL.s0 && c.s < TUNNEL.s1)) { c.targetLane = nl; c.blink = 2.6; }
      }
      const dT = c.laneD(c.targetLane);
      const prevD = c.d;
      c.d += clamp(dT - c.d, -1.3 * dt, 1.3 * dt);
      if (Math.abs(c.d - dT) < 0.05) c.lane = c.targetLane;
      c.dVel = (c.d - prevD) / Math.max(dt, 1e-4);
      c.blink = Math.max(0, c.blink - dt);
      c.s += c.v * dt;
      this.place(c, dt, camera);
    }
    for (const c of this.oncoming) {
      if (c.s > focusS + 250 || c.s < focusS - 1500 && false) c.spawn(focusS + this.ahead + 200 + this.rng() * 300, Math.floor(this.rng() * 3), (70 + this.rng() * 35) / 3.6);
      if (c.s < focusS - 300) c.spawn(focusS + this.ahead + this.rng() * 400, Math.floor(this.rng() * 3), (70 + this.rng() * 35) / 3.6);
      c.s -= c.v * dt;
      c.dVel = 0;
      this.place(c, dt, camera);
    }
  }

  place(c, dt, camera) {
    const f = this.track.frame(c.s, this.frame);
    const y = this.track.heightAt(c.s, c.d);
    c.root.position.copy(f.pos).addScaledVector(f.left, c.d);
    c.root.position.y = y;
    // Yaw offset from lateral motion, plus a damped wobble after bumps.
    c.yawVel += (-c.yawOffset * 30 - c.yawVel * 7) * dt;
    c.yawOffset += c.yawVel * dt;
    const lat = Math.atan2(c.dVel, Math.max(c.v, 3)) * (c.oncoming ? -1 : 1);
    const yaw = f.heading + (c.oncoming ? Math.PI : 0) + lat + c.yawOffset;
    orientOnTrack(c.root.quaternion, f, yaw);
    c.visual.setBrake(c.brake ? 1 : 0);
    c.visual.update(dt, c.v, 0);
    c.visual.faceCamera && c.visual.faceCamera(camera);
    // Indicator blink on the tail glows.
    if (c.blink > 0) {
      const on = (c.blink * 2.5) % 1 < 0.5;
      const side = c.targetLane > c.lane ? 1 : 0; // lane index grows to the right
      const g = c.visual.tailGlows[side];
      if (g) g.material.color.setRGB(1, on ? 0.45 : 0.03, on ? 0.02 : 0.02).multiplyScalar(on ? 4 : 1.6);
    }
  }
}

/** Track-space collision between two bodies {s,d,halfL,halfW,mass,vS,vD}. Returns null or the contact. */
export function collide(a, b) {
  const ds = b.s - a.s, dd = b.d - a.d;
  const ox = a.halfL + b.halfL - Math.abs(ds);
  const oy = a.halfW + b.halfW - Math.abs(dd);
  if (ox <= 0 || oy <= 0) return null;
  const total = a.mass + b.mass;
  if (oy < ox * 0.6) {
    const sgn = Math.sign(dd) || 1;
    const vrel = (b.vD - a.vD) * sgn;
    return { axis: 'd', depth: oy, sgn, vrel, wa: b.mass / total, wb: a.mass / total };
  }
  const sgn = Math.sign(ds) || 1;
  const vrel = (b.vS - a.vS) * sgn;
  return { axis: 's', depth: ox, sgn, vrel, wa: b.mass / total, wb: a.mass / total };
}

export { lerp };
