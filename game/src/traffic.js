// NPC traffic on both carriageways (Integra / RAV4 / TownAce). Simulation is in track
// space; rendering is fully instanced via TrafficRenderer. Also exports the shared
// track-space collision helper used by player, rival and traffic.
import * as THREE from 'three';
import { NPC_COLORS } from './cars.js';
import { LANES, ONCOMING_D, makeFrame } from './track.js';
import { orientOnTrack } from './physics.js';
import { TrafficRenderer } from './npcbatch.js';
import { mulberry32, clamp } from './util.js';
import { TUNNEL } from './course.js';

class NPC {
  constructor(template, color, rng, oncoming) {
    this.template = template;
    this.meta = template.meta;
    this.color = new THREE.Color(color);
    this.matrix = new THREE.Matrix4();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.oncoming = oncoming;
    this.halfL = template.meta.size[2] / 2 - 0.1;
    this.halfW = Math.min(template.meta.size[0], 2.0) / 2 - 0.05;
    this.mass = template.id === 'townace' ? 1500 : template.id === 'rav4' ? 1650 : 1200;
    this.rng = rng;
    this.active = false;
    this.blink = 0;
    this.spin = 0;
    this.brake = 0;
  }

  spawn(s, lane, v) {
    this.s = s; this.lane = lane; this.targetLane = lane;
    this.d = this.laneD(lane);
    this.v = v; this.cruise = v;
    this.dVel = 0;
    this.laneTimer = 4 + this.rng() * 10;
    this.active = true;
    this.bumped = 0;
    this.yawOffset = 0; this.yawVel = 0;
  }

  laneD(lane) { return this.oncoming ? ONCOMING_D - LANES[lane] : LANES[lane]; }
}

const ONE = new THREE.Vector3(1, 1, 1);

export class Traffic {
  constructor(world, templates, quality) {
    this.world = world;
    this.track = world.track;
    this.rng = mulberry32(4242);
    this.cars = [];
    this.oncoming = [];
    const pick = () => templates[Math.floor(this.rng() * templates.length)];
    const color = () => NPC_COLORS[Math.floor(this.rng() * NPC_COLORS.length)];
    for (let i = 0; i < quality.traffic; i++) this.cars.push(new NPC(pick(), color(), this.rng, false));
    for (let i = 0; i < quality.oncoming; i++) this.oncoming.push(new NPC(pick(), color(), this.rng, true));
    this.renderer = new TrafficRenderer(world.scene, templates, quality.traffic + quality.oncoming);
    this.frame = makeFrame();
    this.ahead = 1100; this.behind = 220;
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

  update(dt, focusS, camera, racers = []) {
    for (const c of this.cars) {
      if (!c.active) continue;
      if (c.s < focusS - this.behind || c.s > focusS + this.ahead + 300) {
        this.spawnSafe(c, focusS + this.ahead * (0.65 + this.rng() * 0.35));
      }
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
      c.laneTimer -= dt;
      if (c.laneTimer < 0 && c.targetLane === c.lane) {
        c.laneTimer = 6 + this.rng() * 12;
        const nl = clamp(c.lane + (this.rng() < 0.5 ? -1 : 1), 0, 2);
        const free = this.cars.every(o => o === c || !o.active || Math.abs(o.d - LANES[nl]) > 2 || Math.abs(o.s - c.s) > 22)
          // Don't cut in front of a fast car coming from behind (player / rival).
          && racers.every(r => { const ds = c.s - r.s; return ds < -10 || ds > 30 + Math.max(0, r.v - c.v) * 3.5 || Math.abs(r.d - LANES[nl]) > 2.6; });
        if (nl !== c.lane && free && !(c.s > TUNNEL.s0 && c.s < TUNNEL.s1)) { c.targetLane = nl; c.blink = 2.6; }
      }
      const dT = c.laneD(c.targetLane);
      const prevD = c.d;
      c.d += clamp(dT - c.d, -1.3 * dt, 1.3 * dt);
      if (Math.abs(c.d - dT) < 0.05) c.lane = c.targetLane;
      c.dVel = (c.d - prevD) / Math.max(dt, 1e-4);
      c.blink = Math.max(0, c.blink - dt);
      c.s += c.v * dt;
      this.place(c, dt);
    }
    for (const c of this.oncoming) {
      if (c.s > focusS + this.ahead + 800) c.spawn(focusS + this.ahead + this.rng() * 300, Math.floor(this.rng() * 3), (70 + this.rng() * 35) / 3.6);
      if (c.s < focusS - 300) c.spawn(focusS + this.ahead + this.rng() * 400, Math.floor(this.rng() * 3), (70 + this.rng() * 35) / 3.6);
      c.s -= c.v * dt;
      c.dVel = 0;
      this.place(c, dt);
    }
    this.draw(camera);
  }

  place(c, dt) {
    const f = this.track.frame(c.s, this.frame);
    c.pos.copy(f.pos).addScaledVector(f.left, c.d);
    c.pos.y = this.track.heightAt(c.s, c.d);
    c.yawVel += (-c.yawOffset * 30 - c.yawVel * 7) * dt;
    c.yawOffset += c.yawVel * dt;
    const lat = Math.atan2(c.dVel, Math.max(c.v, 3)) * (c.oncoming ? -1 : 1);
    const yaw = f.heading + (c.oncoming ? Math.PI : 0) + lat + c.yawOffset;
    orientOnTrack(c.quat, f, yaw);
    c.matrix.compose(c.pos, c.quat, ONE);
    c.spin += c.v * dt;
  }

  draw(camera) {
    const r = this.renderer;
    r.begin();
    const cs = this.world.camS ?? 0;
    for (const list of [this.cars, this.oncoming]) {
      for (const c of list) {
        if (!c.active || Math.abs(c.s - cs) > 1300) continue;
        c.blinkRight = c.targetLane > c.lane;
        r.add(c, camera);
      }
    }
    r.end();
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
