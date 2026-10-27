// Autopilot that drives the player's Vehicle for the attract/demo mode.
import { LANES } from './track.js';
import { clamp, wrapAngle } from './util.js';

export class Autopilot {
  constructor(track, traffic) {
    this.track = track;
    this.traffic = traffic;
    this.targetD = 0;
    this.cool = 0;
    this.cruise = 235 / 3.6;
  }

  inputs(veh, dt) {
    const tr = this.track;
    this.cool -= dt;
    const lead = d => {
      let gap = 260, vLead = 999;
      for (const c of this.traffic.cars) {
        if (!c.active) continue;
        const ds = c.s - veh.s;
        if (ds < -3 || ds > 260) continue;
        if (Math.abs(c.d - d) < c.halfW + 1.3) { const g = ds - c.halfL - 2.2; if (g < gap) { gap = g; vLead = c.v; } }
      }
      return { gap, vLead };
    };
    const cur = lead(this.targetD);
    const need = 40 + Math.max(0, veh.v - cur.vLead) * 3.6;
    if (this.cool <= 0 && cur.gap < need) {
      let best = this.targetD, bestScore = cur.gap;
      for (const l of LANES) {
        if (Math.abs(l - this.targetD) < 0.1) continue;
        const side = this.traffic.cars.some(c => c.active && c.s - veh.s > -9 && c.s - veh.s < 12 && Math.abs(c.d - (l + veh.d) / 2) < 2.4);
        const o = lead(l);
        const score = o.gap - Math.abs(l - veh.d) * 3;
        if (!side && score > bestScore + 10) { bestScore = score; best = l; }
      }
      if (best !== this.targetD) { this.targetD = best; this.cool = 0.9; }
    }
    // Speed: corner limit and the car ahead in our lane.
    const look = 30 + veh.v * 2;
    let k = 0;
    for (let x = veh.s; x < veh.s + look; x += 8) k = Math.max(k, Math.abs(tr.curvature(x)));
    let vT = Math.min(this.cruise, k > 1e-5 ? Math.sqrt(12.2 / k) : 999);
    const here = lead(veh.d);
    if (here.gap < 200) vT = Math.min(vT, here.vLead + Math.max(0, here.gap - 6) * 0.7);
    const throttle = veh.v < vT ? clamp((vT - veh.v) * 0.3, 0.25, 1) : 0;
    const brake = veh.v > vT + 2 ? clamp((veh.v - vT) * 0.12, 0, 1) : 0;
    // Steering: feed-forward curvature + PD on lateral/heading error.
    const s2 = veh.s + Math.max(6, veh.v * 0.35);
    const heading = tr.heading(s2);
    const he = wrapAngle(heading - veh.yaw);
    const le = this.targetD - veh.d;
    const kmh = veh.v * 3.6;
    const maxSteer = 0.5 + (0.055 - 0.5) * Math.pow(clamp(kmh / 300, 0, 1), 0.7);
    const ff = Math.atan(tr.curvature(veh.s + veh.v * 0.3) * veh.spec.wheelbase) / maxSteer;
    const steer = clamp(ff + (he * 1.6 + le * 0.06) / maxSteer * 0.35, -1, 1);
    return { throttle, brake, steer, handbrake: false };
  }
}
