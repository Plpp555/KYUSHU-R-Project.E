// Autopilot that drives the player's Vehicle for the attract/demo mode.
import * as THREE from 'three';
import { LANES } from './track.js';
import { clamp } from './util.js';

export class Autopilot {
  constructor(track, traffic) {
    this.track = track;
    this.traffic = traffic;
    this.targetD = 0;
    this.cool = 0;
    this.cruise = 235 / 3.6;
    this._p = new THREE.Vector3();
    this.others = [];   // extra obstacles (the rival in a battle)
  }

  inputs(veh, dt) {
    const tr = this.track;
    this.cool -= dt;
    const aBrk = 8.0 * (veh.gripScale ?? 1);
    const H = 520;   // look far ahead: braking from 300 km/h takes a few hundred metres
    const cars = this.others.length ? this.traffic.cars.concat(this.others) : this.traffic.cars;
    const lead = (d, range = H) => {
      let gap = H, vLead = 999;
      for (const c of cars) {
        if (c.active === false) continue;
        const ds = c.s - veh.s;
        if (ds < -3 || ds > range) continue;
        if (Math.abs(c.d - d) < c.halfW + 1.3) { const g = ds - c.halfL - 2.2; if (g < gap) { gap = g; vLead = c.v; } }
      }
      return { gap, vLead };
    };
    // Speed we can carry in a lane and still brake down behind its next car.
    const capOf = o => o.vLead > 900 ? 999 : Math.sqrt(o.vLead * o.vLead + 2 * aBrk * 0.85 * Math.max(0, o.gap - 6 - o.vLead * 0.35));
    const cur = lead(this.targetD);
    const curCap = capOf(cur) + Math.min(cur.gap, 400) * 0.02;
    if (this.cool <= 0 && capOf(cur) < this.cruise) {
      let best = this.targetD, bestCap = curCap;
      for (const l of LANES) {
        if (Math.abs(l - this.targetD) < 0.1) continue;
        // The lanes we cross must be clear alongside.
        const lo = Math.min(l, veh.d), hi = Math.max(l, veh.d);
        const side = cars.some(c => c.active !== false && c.s - veh.s > -10 && c.s - veh.s < 14 + Math.max(0, veh.v - c.v) * 0.8 && c.d > lo - 2.2 && c.d < hi + 2.2 && Math.abs(c.d - veh.d) > 1.5);
        const o = lead(l);
        const cap = capOf(o) + Math.min(o.gap, 400) * 0.02 - Math.abs(l - veh.d) * 0.5;
        if (!side && cap > bestCap + 3) { bestCap = cap; best = l; }
      }
      if (best !== this.targetD) { this.targetD = best; this.cool = 0.8; }
    }
    // Speed: braking-point planner over the curvature ahead, and the cars ahead.
    const aLat = 8.2 * (veh.gripScale ?? 1);
    let vT = this.cruise;
    for (let x = 0; x < 40 + veh.v * 3.2; x += 8) {
      const k = Math.abs(tr.curvature(veh.s + x));
      if (k < 1e-5) continue;
      vT = Math.min(vT, Math.sqrt(aLat / k + 2 * aBrk * x));
    }
    vT = Math.min(vT, capOf(lead(this.targetD)));
    // While still crossing over, mind the car directly ahead too.
    if (Math.abs(veh.d - this.targetD) > 1) vT = Math.min(vT, capOf(lead(veh.d, 60)));
    const throttle = veh.v < vT ? clamp((vT - veh.v) * 0.3, 0.25, 1) : 0;
    const brake = veh.v > vT + 1 ? clamp((veh.v - vT) * 0.15, 0, 1) : 0;
    // Steering: pure pursuit on a look-ahead point of the target lane, damped by yaw rate.
    const Ld = clamp(9 + veh.v * 0.55, 10, 60);
    const tp = tr.point(veh.s + Ld, this.targetD, 0, this._p);
    const sy = Math.sin(veh.yaw), cy = Math.cos(veh.yaw);
    const dx = tp.x - veh.x, dz = tp.z - veh.z;
    const xl = dx * sy + dz * cy, yl = dx * cy - dz * sy;
    const kDes = 2 * yl / (xl * xl + yl * yl);
    const L = veh.spec.wheelbase;
    const delta = Math.atan(kDes * L * (1 + 0.0016 * veh.v * veh.v)) - (veh.yawRate - kDes * veh.v) * 0.012;
    const steer = clamp(delta / Math.max(veh.maxDelta(), 1e-3), -1, 1);
    return { throttle, brake, steer, handbrake: false };
  }
}
