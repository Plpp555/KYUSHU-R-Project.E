// Rival AI: the white Countach. Drives in track space with a curvature speed limit,
// picks the lane with the most free road through traffic, and rubber-bands to keep
// the battle close (arcade style).
import * as THREE from 'three';
import { LANES, makeFrame } from './track.js';
import { orientOnTrack, WALL_LEFT, WALL_RIGHT } from './physics.js';
import { clamp, lerp } from './util.js';

export class Rival {
  constructor(track, visual, difficulty = 1) {
    this.track = track;
    this.visual = visual;
    this.frame = makeFrame();
    this.difficulty = difficulty;
    this.halfL = 2.35; this.halfW = 0.98; this.mass = 1600;
    this.top = 338 / 3.6;
    this.events = [];
    this.reset(0, 0);
  }

  reset(s, d) {
    this.s = s; this.d = d; this.v = 0; this.vD = 0;
    this.targetD = d;
    this.gear = 1; this.rpm = 1000;
    this.brake = 0; this.throttle = 0;
    this.laneCooldown = 0;
    this.launch = 0;
    this.yaw = 0;
    this.bumpYaw = 0; this.bumpVel = 0;
    this.finished = false;
    this.place(0);
  }

  maxCornerSpeed(s, v) {
    const look = 40 + v * 2.2;
    let k = 0;
    for (let x = s; x < s + look; x += 8) k = Math.max(k, Math.abs(this.track.curvature(x)));
    const aLat = 13.2 + this.difficulty * 1.2;
    return k > 1e-5 ? Math.sqrt(aLat / k) : 999;
  }

  update(dt, player, traffic, racing) {
    const tr = this.track;
    // --- Lane choice through traffic ---
    this.laneCooldown -= dt;
    const freeAhead = d => {
      let gap = 260;
      for (const c of traffic.cars) {
        if (!c.active) continue;
        const ds = c.s - this.s;
        if (ds < -4 || ds > 260) continue;
        if (Math.abs(c.d - d) < c.halfW + this.halfW + 0.35) gap = Math.min(gap, Math.max(0, ds - c.halfL - this.halfL));
      }
      return gap;
    };
    const cur = freeAhead(this.targetD);
    const need = 30 + this.v * 2.0;
    if (racing && this.laneCooldown <= 0 && cur < need) {
      let best = this.targetD, bestGap = cur;
      for (const l of LANES) {
        if (Math.abs(l - this.targetD) < 0.1) continue;
        // Must not cut through a car alongside.
        const side = traffic.cars.some(c => c.active && Math.abs(c.s - this.s) < 7 && Math.abs(c.d - (l + this.d) / 2) < 2.2);
        const g = freeAhead(l) - Math.abs(l - this.d) * 2;
        if (!side && g > bestGap + 15) { bestGap = g; best = l; }
      }
      if (best !== this.targetD) { this.targetD = best; this.laneCooldown = 1.2; }
    }
    // Drift back to a racing line on free road (inside of the next corner).
    if (racing && cur > need * 1.6 && this.laneCooldown <= -2) {
      const k = tr.curvature(this.s + 120);
      const ideal = Math.abs(k) > 0.0008 ? Math.sign(k) * LANES[0] : LANES[1];
      if (Math.abs(ideal - this.targetD) > 0.1 && freeAhead(ideal) > need * 1.4) { this.targetD = ideal; this.laneCooldown = 1.5; }
    }

    // --- Speed ---
    let vT = Math.min(this.top, this.maxCornerSpeed(this.s, this.v));
    // Rubber band.
    const gap = this.s - player.s;
    if (gap > 120) vT *= clamp(1 - (gap - 120) / 1400, 0.86, 1);
    if (gap < -40) vT *= 1 + clamp((-gap - 40) / 900, 0, 0.09) * this.difficulty;
    const blocked = freeAhead(this.d);
    if (blocked < 25 + this.v * 0.7) {
      const lead = traffic.leader(this.s, this.d, this.halfW, null);
      if (lead) vT = Math.min(vT, lead.car.v + blocked * 0.15);
    }
    if (!racing) vT = 0;
    const accMax = (8.6 + this.difficulty * 0.8) * (1 - Math.pow(this.v / (this.top * 1.02), 2.2)) + 0.3;
    const prevV = this.v;
    if (vT > this.v) { this.v = Math.min(vT, this.v + accMax * dt); this.brake = 0; this.throttle = 1; }
    else { this.v = Math.max(vT, this.v - 11.5 * dt); this.brake = this.v < prevV - 0.02 ? 1 : 0; this.throttle = 0.2; }

    // --- Lateral ---
    const lim = [WALL_RIGHT + this.halfW, WALL_LEFT - this.halfW];
    const err = this.targetD - this.d;
    const vDT = clamp(err * 1.4, -5.2, 5.2);
    this.vD = lerp(this.vD, vDT, 1 - Math.exp(-4 * dt));
    this.d = clamp(this.d + this.vD * dt, lim[0], lim[1]);
    this.s += this.v * dt;

    // Gearbox for sound/afterfire.
    const ratios = [3.0, 2.0, 1.52, 1.22, 1.0, 0.85];
    const rpmFor = g => Math.max(1000, this.v / (2 * Math.PI * 0.35) * ratios[g - 1] * 3.4 * 60);
    this.rpm = rpmFor(this.gear);
    if (this.rpm > 8300 && this.gear < 6) { this.gear++; this.events.push({ type: 'shift' }); }
    else if (this.gear > 1 && rpmFor(this.gear - 1) < 7000) this.gear--;
    this.place(dt);
  }

  bump(yawKick) { this.bumpVel += yawKick; }

  place(dt) {
    const f = this.track.frame(this.s, this.frame);
    const pos = this.visual.root.position;
    pos.copy(f.pos).addScaledVector(f.left, this.d);
    pos.y = this.track.heightAt(this.s, this.d);
    this.bumpVel += (-this.bumpYaw * 26 - this.bumpVel * 6) * dt;
    this.bumpYaw += this.bumpVel * dt;
    this.yaw = f.heading + Math.atan2(this.vD, Math.max(this.v, 4)) + this.bumpYaw;
    orientOnTrack(this.visual.root.quaternion, f, this.yaw);
    this.visual.setBrake(this.brake);
    this.visual.update(dt, this.v, clamp(this.vD * 0.05, -0.2, 0.2));
    this.pos = pos;
  }
}

export const _unused = THREE;
