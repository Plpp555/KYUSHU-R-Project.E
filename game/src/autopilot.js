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
    const free = d => {
      let gap = 220;
      for (const c of this.traffic.cars) {
        if (!c.active) continue;
        const ds = c.s - veh.s;
        if (ds < -3 || ds > 220) continue;
        if (Math.abs(c.d - d) < c.halfW + 1.25) gap = Math.min(gap, ds - 5);
      }
      return gap;
    };
    const need = 25 + veh.v * 1.8;
    if (this.cool <= 0 && free(this.targetD) < need) {
      let best = this.targetD, bg = free(this.targetD);
      for (const l of LANES) {
        const g = free(l);
        const side = this.traffic.cars.some(c => c.active && Math.abs(c.s - veh.s) < 8 && Math.abs(c.d - (l + veh.d) / 2) < 2.3);
        if (!side && g > bg + 12) { bg = g; best = l; }
      }
      if (best !== this.targetD) { this.targetD = best; this.cool = 1.4; }
    }
    // Speed: corner limit and traffic.
    let look = 30 + veh.v * 2;
    let k = 0;
    for (let x = veh.s; x < veh.s + look; x += 8) k = Math.max(k, Math.abs(tr.curvature(x)));
    let vT = Math.min(this.cruise, k > 1e-5 ? Math.sqrt(11.5 / k) : 999);
    const g = free(veh.d);
    if (g < 30 + veh.v) vT = Math.min(vT, 18 + g * 0.6);
    const throttle = veh.v < vT ? clamp((vT - veh.v) * 0.25, 0.2, 1) : 0;
    const brake = veh.v > vT + 3 ? clamp((veh.v - vT) * 0.1, 0, 1) : 0;
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
