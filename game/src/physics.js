// Vehicle dynamics for the player car: a planar two-axle ("bicycle") model with
//  - Pacejka-style lateral tyre curves per axle, friction circle (combined slip),
//  - longitudinal / lateral load transfer with tyre load sensitivity and aero downforce,
//  - engine torque curve, turbo lag, 6-speed automatic gearbox, clutch slip at launch,
//    wheelspin (power oversteer), engine braking, ABS brakes with front bias,
//  - driving aids (traction control, stability control, speed-sensitive steering limit),
//  - rigid-body impulses against the parapet / median barrier (the car rotates off walls).
// World frame: yaw 0 faces +Z, positive yaw / steer / yaw rate = turning left.
import * as THREE from 'three';
import { makeFrame, HALF_W, MEDIAN_D } from './track.js';
import { clamp, lerp, wrapAngle } from './util.js';

// Full-boost engine torque (N·m) at 0, 1000, 2000 … 9000 rpm.
const TORQUE_930 = [150, 260, 330, 450, 610, 690, 680, 615, 520, 380];

export const SPECS = {
  porsche930: {
    // Tuned 3.3 flat-six turbo ("Blackbird"), ~600 PS at 7000 rpm.
    mass: 1380, wheelbase: 2.272, frontWeight: 0.39, cgHeight: 0.48, trackF: 1.43, trackR: 1.50,
    inertia: 2050, rollShareF: 0.6,
    muF: 1.12, muR: 1.17, BF: 15, BR: 16.6, C: 1.6, loadSens: 0.1, loadNom: 4000,
    cdA: 0.68, clAF: 0.1, clAR: 0.46,
    torque: TORQUE_930, offBoost: 0.42, turbo: true,
    gears: [3.2, 2.15, 1.6, 1.25, 1.02, 0.84], final: 3.15, efficiency: 0.88, shiftTime: 0.16,
    redline: 7600, limiter: 7800, idle: 950, wheelR: 0.318,
    brakeMax: 1.45, brakeBias: 0.64, lock: 0.6,
    halfWidth: 0.88, halfLength: 2.1, topSpeed: 345 / 3.6,
  },
  countach: {
    mass: 1595, wheelbase: 2.7, halfWidth: 1.0, halfLength: 2.4, redline: 8500, idle: 1000, turbo: false,
    topSpeed: 345 / 3.6,
  },
};

// Driving aids. steer: front slip angle allowed beyond the kinematic angle (× peak slip angle).
export const ASSISTS = {
  FULL: { tcs: 0.93, esc: true, betaMax: 0.07, yawGain: 1.0, steer: 0.9 },
  SPORT: { tcs: 1.0, esc: true, betaMax: 0.14, yawGain: 0.5, steer: 1.05 },
  OFF: { tcs: 0, esc: false, betaMax: 0, yawGain: 0, steer: 1.25 },
};

export const WALL_LEFT = HALF_W;               // parapet inner face
export const WALL_RIGHT = MEDIAN_D + 0.3;      // median barrier face (-6.95)

const G = 9.81, RHO = 1.225;
const SUB = 1 / 240;

function torqueAt(curve, rpm) {
  const x = clamp(rpm / 1000, 0, curve.length - 1.001);
  const i = Math.floor(x), t = x - i;
  return curve[i] + (curve[i + 1] - curve[i]) * t;
}

export class Vehicle {
  constructor(track, spec) {
    this.track = track;
    this.spec = spec;
    this.frame = makeFrame();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.events = [];
    this.assist = ASSISTS.SPORT;
    this.gripScale = 1;          // road surface (wet < 1)
    const sp = spec;
    this.a = sp.wheelbase * (1 - sp.frontWeight);   // CG → front axle
    this.b = sp.wheelbase * sp.frontWeight;         // CG → rear axle
    this.peakF = Math.tan(Math.PI / (2 * sp.C)) / sp.BF;   // slip angle of peak lateral force
    this.reset(0, 0);
  }

  reset(s, d, speed = 0) {
    const f = this.track.frame(s, this.frame);
    this.x = f.pos.x + f.left.x * d;
    this.z = f.pos.z + f.left.z * d;
    this.s = s; this.d = d;
    this.yaw = f.heading;
    this.vx = Math.sin(this.yaw) * speed;
    this.vz = Math.cos(this.yaw) * speed;
    this.yawRate = 0;
    this.steer = 0; this.delta = 0;
    // Gear that suits the speed (rolling starts).
    const sp = this.spec;
    const wheelRpm = speed / sp.wheelR * 60 / (2 * Math.PI);
    this.gear = 1;
    while (this.gear < sp.gears.length && wheelRpm * sp.gears[this.gear - 1] * sp.final > sp.redline * 0.8) this.gear++;
    this.rpm = Math.max(sp.idle, wheelRpm * sp.gears[this.gear - 1] * sp.final);
    this.boost = 0;
    this.shiftTimer = 0;
    this.throttle = 0; this.brake = 0;
    this.slip = 0; this.tireSlip = 0; this.spin = 0;
    this.alphaF = 0; this.alphaR = 0; this.FyR = 0;
    this.latAcc = 0; this.lonAcc = 0;
    this.bodyRoll = 0; this.bodyPitch = 0; this.rollVel = 0; this.pitchVel = 0;
    this.wallContact = 0;
    this.slipstream = 0;
    this.tcsOn = 0; this.escOn = 0;
    this.stuckT = 0; this.recoverT = 0;
    this.topSpeedReached = 0;
    this.distance = 0;
    this.gF = 0; this.gL = 0; this.gN = 1;
    this.updatePose(0);
  }

  /** Speed over ground (m/s). Setting it keeps the car pointing where it is and drops any slide. */
  get v() { return Math.hypot(this.vx, this.vz); }
  set v(val) { this.vx = Math.sin(this.yaw) * val; this.vz = Math.cos(this.yaw) * val; this.yawRate = 0; }
  /** Direction of travel. */
  get course() { return this.vx * this.vx + this.vz * this.vz > 0.25 ? Math.atan2(this.vx, this.vz) : this.yaw; }
  /** Forward (wheel) speed. */
  get u() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }
  get speedKmh() { return this.v * 3.6; }

  /** Steering lock available at a speed: the kinematic angle for the grip limit plus the tyre's
   *  peak slip angle, so a full input asks for (about) maximum cornering, not a spin. */
  maxDelta(speed = Math.abs(this.u)) {
    const sp = this.spec;
    const aRef = 0.95 * sp.muF * G * this.gripScale;
    const kin = Math.atan(sp.wheelbase * aRef / Math.max(speed * speed, 1));
    // Variable-ratio rack: a little less slip demand at motorway speeds.
    const hi = clamp((speed - 40) / 40, 0, 1);
    return Math.min(sp.lock, kin + this.peakF * this.assist.steer * (1 - 0.15 * hi));
  }

  /** input: {throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake bool} */
  step(dt, input) {
    // Road gradient / banking under the car (once per frame).
    const f = this.track.frame(this.s, this.frame);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const up = f.up;
    let fx = sy, fy = 0, fz = cy;
    const dn = fx * up.x + fz * up.z;
    fx -= up.x * dn; fy -= up.y * dn; fz -= up.z * dn;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const ly = up.z * fx - up.x * fz;   // (up × fwd).y
    this.gF = -G * fy; this.gL = -G * ly; this.gN = up.y;

    this.updateAssistInputs(dt, input);
    const n = Math.max(1, Math.ceil(dt / SUB - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.integrate(h, input);
    this.recover(dt);
    this.updatePose(dt);
  }

  updateAssistInputs(dt, input) {
    // Steering: rate-limited like turning a wheel; slower at speed, quick to centre.
    const spd = Math.abs(this.u);
    const towards = Math.abs(input.steer) > Math.abs(this.steer) && Math.sign(input.steer) !== -Math.sign(this.steer);
    const rate = towards ? lerp(3.4, 1.25, clamp(spd / 75, 0, 1)) : 5.5;
    this.steer += clamp(input.steer - this.steer, -rate * dt, rate * dt);
    this.throttle = lerp(this.throttle, input.throttle, 1 - Math.exp(-12 * dt));
    this.brake = lerp(this.brake, input.brake, 1 - Math.exp(-16 * dt));
  }

  integrate(h, input) {
    const sp = this.spec, m = sp.mass, L = sp.wheelbase, a = this.a, b = this.b;
    const as = this.assist;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let u = this.vx * sy + this.vz * cy;          // forward
    let w = this.vx * cy - this.vz * sy;          // leftward
    let r = this.yawRate;
    const spd = Math.hypot(u, w);
    const dir = u >= 0 ? 1 : -1;

    const delta = this.steer * this.maxDelta(Math.abs(u));
    this.delta = delta;

    // --- Aero & loads -------------------------------------------------------------
    const q = 0.5 * RHO * u * u;
    const drag = q * sp.cdA * (1 - this.slipstream * 0.42);
    const W = m * G * this.gN;
    const dLon = m * this.lonAcc * sp.cgHeight / L;
    const FzF = Math.max(300, W * b / L - dLon + q * sp.clAF);
    const FzR = Math.max(300, W * a / L + dLon + q * sp.clAR);
    const dLat = m * Math.abs(this.latAcc) * sp.cgHeight;
    const capF = this.axleGrip(FzF, dLat * sp.rollShareF / sp.trackF, sp.muF);
    const capR = this.axleGrip(FzR, dLat * (1 - sp.rollShareF) / sp.trackR, sp.muR);

    // --- Engine / gearbox ---------------------------------------------------------
    const ratio = sp.gears[this.gear - 1] * sp.final;
    const wheelRpm = Math.max(0, u) / sp.wheelR * 60 / (2 * Math.PI);
    const groundRpm = wheelRpm * ratio;
    // Clutch slips below ~2000 rpm in first so the car can pull away.
    const clutchRpm = this.gear === 1 ? lerp(sp.idle, 4200, this.throttle) : sp.idle;
    let rpm = Math.max(groundRpm * (1 + this.spin), clutchRpm, sp.idle);
    if (this.shiftTimer > 0) { this.shiftTimer -= h; rpm = lerp(this.rpm, rpm, 0.05); }
    rpm = Math.min(rpm, sp.limiter + 60);
    this.rpm = lerp(this.rpm, rpm, 1 - Math.exp(-30 * h));
    this.autoShift(groundRpm, wheelRpm);

    if (sp.turbo) {
      const target = this.shiftTimer > 0 ? this.boost * 0.9 : this.throttle * clamp((this.rpm - 2500) / 2100, 0, 1);
      const prev = this.boost;
      this.boost += (target - this.boost) * (target > this.boost ? 1.7 : 6) * h;
      if (prev > 0.55 && this.throttle < 0.3 && this.boost < prev && !this._bov) { this._bov = true; this.events.push({ type: 'bov', amount: prev }); }
      if (this.throttle > 0.6) this._bov = false;
    } else this.boost = this.throttle;

    let torque = torqueAt(sp.torque, this.rpm) * (sp.turbo ? sp.offBoost + (1 - sp.offBoost) * this.boost : 1) * this.throttle;
    if (this.rpm >= sp.limiter) torque = 0;
    const engineBrake = (22 + this.rpm * 0.011) * (1 - this.throttle);
    let drive = this.shiftTimer > 0 ? 0 : (torque - engineBrake) * ratio * sp.efficiency / sp.wheelR;
    if (u < 0.5 && drive < 0) drive = 0;

    // --- Longitudinal tyre forces (friction circle) ----------------------------------
    const prevFyR = this.FyR;
    let tcs = 0;
    // Stability control also cuts engine torque once the car starts to slide.
    // Slip-angle tolerance shrinks with speed (no drifting allowed at motorway speeds).
    const betaMax = as.betaMax * lerp(1, 0.45, clamp((spd - 30) / 50, 0, 1));
    const beta0 = spd > 8 ? Math.atan2(w, Math.abs(u)) : 0;
    if (as.esc && drive > 0) {
      const over = Math.abs(beta0) - betaMax * 0.6;
      if (over > 0) { drive *= clamp(1 - over / (betaMax * 0.6), 0.05, 1); tcs = 1; }
    }
    if (as.tcs > 0 && drive > 0) {
      const avail = Math.sqrt(Math.max(0, capR * capR - prevFyR * prevFyR)) * as.tcs;
      if (drive > avail) { drive = Math.max(0, avail); tcs = 1; }
    }
    const brakeF = this.brake * sp.brakeMax * m * G * clamp(Math.abs(u) / 0.6, 0, 1);
    let FxF = -dir * Math.min(brakeF * sp.brakeBias, capF * 0.97);     // ABS
    let FxR = drive - dir * Math.min(brakeF * (1 - sp.brakeBias), capR * 0.97);
    let latCapF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF));
    let latCapR;
    let spinT = 0;
    if (input.handbrake && Math.abs(u) > 2) {
      FxR = -dir * capR * 0.78;
      latCapR = capR * 0.3;
    } else if (Math.abs(FxR) > capR) {
      // Wheelspin: kinetic friction, little side grip left.
      const excess = Math.abs(FxR) / capR - 1;
      FxR = Math.sign(FxR) * capR * 0.92;
      latCapR = capR * clamp(0.45 - excess * 0.4, 0.2, 0.45);
      if (drive > 0) spinT = clamp(0.15 + excess * 0.8, 0, 0.9);
    } else latCapR = Math.sqrt(capR * capR - FxR * FxR);
    this.spin += (spinT - this.spin) * Math.min(1, (spinT > this.spin ? 10 : 4) * h);

    // --- Lateral tyre forces ----------------------------------------------------------
    // Below walking pace the slip-angle model is singular: blend to kinematic steering.
    const kb = clamp((3.5 - Math.abs(u)) / 2.5, 0, 1);
    const ue = Math.max(Math.abs(u), 3);
    const alphaF = delta * dir - Math.atan2(w + a * r, ue);
    const alphaR = -Math.atan2(w - b * r, ue);
    const C = sp.C;
    let FyF = latCapF * Math.sin(C * Math.atan(sp.BF * alphaF)) * (1 - kb);
    let FyR = latCapR * Math.sin(C * Math.atan(sp.BR * alphaR)) * (1 - kb);
    this.FyR = FyR;
    this.alphaF = alphaF; this.alphaR = alphaR;

    const cd = Math.cos(delta), sd = Math.sin(delta);
    const roll = (0.012 + 4e-6 * u * u) * W;
    let Fx = FxR + FxF * cd - FyF * sd - dir * (drag + (spd > 0.3 ? roll : 0)) + m * this.gF;
    let Fy = FyR + FyF * cd + FxF * sd + m * this.gL;
    let Mz = a * (FyF * cd + FxF * sd) - b * FyR;

    // --- Stability control (differential braking, modelled as a yaw moment + drag) ----
    let esc = 0;
    if (as.esc && spd > 8) {
      const muG = G * this.gripScale * sp.muF;
      let rRef = u * Math.tan(delta) / (L * (1 + 0.0016 * u * u));
      rRef = clamp(rRef, -muG / Math.max(u, 1), muG / Math.max(u, 1));
      const beta = Math.atan2(w, Math.abs(u));
      const over = Math.abs(r) > Math.abs(rRef) + 0.03 && Math.sign(r) === Math.sign(r - rRef);
      let M = 0;
      if (over) M -= (r - rRef) * 9000 * as.yawGain;
      const bx = Math.abs(beta) - betaMax;
      if (bx > 0) M += Math.sign(beta) * bx * 90000;   // turn the nose back towards the travel direction
      M = clamp(M, -9000, 9000);
      if (Math.abs(M) > 200) {
        esc = 1;
        Mz += M;
        Fx -= dir * Math.abs(M) / 0.75 * 0.5;
      }
    }
    this.tcsOn = lerp(this.tcsOn, tcs, 0.2); this.escOn = lerp(this.escOn, esc, 0.2);

    // --- Integrate (world frame) -------------------------------------------------------
    const lx = cy, lz = -sy;
    this.vx += (Fx * sy + Fy * lx) / m * h;
    this.vz += (Fx * cy + Fy * lz) / m * h;
    r += Mz / sp.inertia * h;
    // Kinematic blend at very low speed (and no creeping when stopped).
    if (kb > 0) {
      u = this.vx * sy + this.vz * cy;
      w = this.vx * cy - this.vz * sy;
      const rk = u * Math.tan(delta) / L;
      const k = kb * Math.min(1, 20 * h);
      r += (rk - r) * k;
      w += (rk * b - w) * k;
      if (Math.abs(u) < 0.25 && this.throttle < 0.05) u *= 0.8;
      this.vx = u * sy + w * cy;
      this.vz = u * cy - w * sy;
    }
    this.yawRate = r;
    this.yaw = wrapAngle(this.yaw + r * h);
    this.x += this.vx * h;
    this.z += this.vz * h;
    const spdN = this.v;
    this.distance += spdN * h;

    // Accelerations for load transfer / body motion (filtered: tyres and springs lag).
    const k = 1 - Math.exp(-10 * h);
    this.lonAcc += ((Fx - m * this.gF) / m - this.lonAcc) * k;
    this.latAcc += ((Fy - m * this.gL) / m - this.latAcc) * k;
    this.tireSlip = Math.max(Math.abs(alphaF) - this.peakF * 0.5, Math.abs(alphaR) - this.peakF * 0.45, 0) * 1.4 + this.spin * 0.25 + (input.handbrake && spd > 5 ? 0.2 : 0);
    this.slip = spdN > 1 ? wrapAngle(this.yaw - Math.atan2(this.vx, this.vz)) : 0;

    this.collideWalls(h);
    this.topSpeedReached = Math.max(this.topSpeedReached, spdN);
  }

  axleGrip(Fz, dFz, mu) {
    const sp = this.spec;
    const half = Fz / 2, t = Math.min(Math.abs(dFz), half);
    const muAt = f => mu * clamp(1 - sp.loadSens * (f - sp.loadNom) / sp.loadNom, 0.7, 1.15);
    return (muAt(half + t) * (half + t) + muAt(half - t) * (half - t)) * this.gripScale;
  }

  autoShift(groundRpm, wheelRpm) {
    const sp = this.spec;
    if (this.shiftTimer > 0) return;
    const ratioOf = g => sp.gears[g - 1] * sp.final;
    if (this.gear < sp.gears.length && (groundRpm > sp.limiter || (groundRpm > sp.redline * 0.975 && this.throttle > 0.2))) {
      this.gear++; this.shiftTimer = sp.shiftTime; this.events.push({ type: 'shift', up: true });
      return;
    }
    if (this.gear > 1) {
      const lower = wheelRpm * ratioOf(this.gear - 1);
      const braking = this.brake > 0.3;
      const want = braking ? lower < sp.redline * 0.86 && groundRpm < sp.redline * 0.62 : lower < sp.redline * 0.8 && groundRpm < sp.redline * 0.5;
      if (want) { this.gear--; this.shiftTimer = sp.shiftTime * 0.7; this.events.push({ type: 'shift', up: false }); }
    }
  }

  /** Rigid-body contact against the parapet (left) and the median barrier (right). */
  collideWalls(h) {
    const sp = this.spec, m = sp.mass, I = sp.inertia;
    const pr = this.track.project(this.x, this.z, this.s);
    this.s = pr.s; this.d = pr.d;
    const f = this.track.frame(pr.s, this.frame);
    let tlx = f.left.x, tlz = f.left.z;
    const tl = Math.hypot(tlx, tlz) || 1; tlx /= tl; tlz /= tl;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.wallContact = Math.max(0, this.wallContact - h * 4);
    for (const side of [1, -1]) {
      let best = 0, bpx = 0, bpz = 0;
      for (const cxl of [sp.halfLength, -sp.halfLength]) {
        for (const cyl of [sp.halfWidth, -sp.halfWidth]) {
          const px = sy * cxl + cy * cyl, pz = cy * cxl - sy * cyl;
          const dc = this.d + px * tlx + pz * tlz;
          const pen = side > 0 ? dc - WALL_LEFT : WALL_RIGHT - dc;
          if (pen > best) { best = pen; bpx = px; bpz = pz; }
        }
      }
      if (best <= 0) continue;
      const nx = -side * tlx, nz = -side * tlz;        // into the road
      this.x += nx * best; this.z += nz * best; this.d -= side * best;
      // Velocity of the contact corner.
      const r = this.yawRate;
      const vcx = this.vx + r * bpz, vcz = this.vz - r * bpx;
      const vn = vcx * nx + vcz * nz;
      this.wallContact = 1;
      if (vn >= 0) continue;
      const rn = bpz * nx - bpx * nz;
      const jn = -(1 + 0.22) * vn / (1 / m + rn * rn / I);
      const tx = -nz, tz = nx;
      const vt = vcx * tx + vcz * tz;
      const rt = bpz * tx - bpx * tz;
      const jt = clamp(-vt / (1 / m + rt * rt / I), -0.38 * jn, 0.38 * jn);
      this.vx += (jn * nx + jt * tx) / m;
      this.vz += (jn * nz + jt * tz) / m;
      this.yawRate += (rn * jn + rt * jt) / I;
      if (-vn > 1.2) this.events.push({ type: 'wall', impact: -vn, side });
    }
  }

  /** Spun and stopped facing the wrong way (or nose in a wall): put the car back on its way. */
  recover(dt) {
    const th = this.track.heading(this.s);
    const err = wrapAngle(this.yaw - th);
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      const k = 1 - Math.exp(-5 * dt);
      this.yaw = wrapAngle(this.yaw - err * k);
      this.vx *= 1 - k; this.vz *= 1 - k; this.yawRate = 0;
      const dT = clamp(this.d, WALL_RIGHT + 1.6, WALL_LEFT - 1.6) - this.d;
      if (Math.abs(dT) > 0.01) {
        const f = this.track.frame(this.s, this.frame);
        this.x += f.left.x * dT * k; this.z += f.left.z * dT * k; this.d += dT * k;
      }
      return;
    }
    const slow = this.v < 5;
    if (slow && (Math.abs(err) > 1.2 || (Math.abs(err) > 0.55 && this.wallContact > 0.3))) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.3) { this.stuckT = 0; this.recoverT = 1.1; this.gear = 1; this.events.push({ type: 'recover' }); }
  }

  /** Bumps from car collisions: impulse along/across the track (m/s) and an optional yaw kick (rad/s). */
  applyImpulse(dv, dd, yawKick = 0) {
    const th = this.track.heading(this.s);
    this.vx += Math.sin(th) * dv + Math.cos(th) * dd;
    this.vz += Math.cos(th) * dv - Math.sin(th) * dd;
    this.yawRate += yawKick;
  }

  updatePose(dt) {
    const f = this.track.frame(this.s, this.frame);
    const y = this.track.heightAt(this.s, this.d);
    this.pos.set(this.x, y, this.z);
    // Suspension: body roll / pitch springs driven by accelerations.
    if (dt > 0) {
      const k = 90, c = 13;
      const rollT = clamp(-this.latAcc * 0.0055, -0.07, 0.07);
      const pitchT = clamp(-this.lonAcc * 0.0042, -0.05, 0.05);
      this.rollVel += ((rollT - this.bodyRoll) * k - this.rollVel * c) * dt;
      this.pitchVel += ((pitchT - this.bodyPitch) * k - this.pitchVel * c) * dt;
      this.bodyRoll += this.rollVel * dt;
      this.bodyPitch += this.pitchVel * dt;
    }
    orientOnTrack(this.quat, f, this.yaw);
  }
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3();
/** Quaternion with up = track up, forward = yaw projected onto the deck. */
export function orientOnTrack(q, f, yaw) {
  _up.copy(f.up);
  _z.set(Math.sin(yaw), 0, Math.cos(yaw));
  _z.addScaledVector(_up, -_z.dot(_up)).normalize();
  _x.crossVectors(_up, _z).normalize();
  _m.makeBasis(_x, _up, _z);
  return q.setFromRotationMatrix(_m);
}
