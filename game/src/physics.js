// Arcade vehicle model for the player car.
// Heading (where the car points) and course (where it travels) are separate so the car
// can slide; grip pulls the course back towards the heading. Walls are resolved in track
// space so the car glances off parapets like in the arcade highway games.
import * as THREE from 'three';
import { makeFrame, HALF_W, MEDIAN_D } from './track.js';
import { clamp, lerp, wrapAngle } from './util.js';

export const SPECS = {
  porsche930: {
    mass: 1250, power: 470000, cdA: 0.66, grip: 1.32, wheelbase: 2.27, topSpeed: 340 / 3.6,
    gears: [3.2, 2.15, 1.6, 1.25, 1.02, 0.84], final: 3.15, redline: 7600, idle: 950, wheelR: 0.318,
    turbo: true, halfWidth: 0.88, halfLength: 2.1,
  },
  countach: {
    mass: 1595, power: 600000, cdA: 0.7, grip: 1.36, wheelbase: 2.7, topSpeed: 345 / 3.6,
    gears: [3.0, 2.0, 1.52, 1.22, 1.0, 0.85], final: 3.4, redline: 8500, idle: 1000, wheelR: 0.35,
    turbo: false, halfWidth: 1.0, halfLength: 2.4,
  },
};

export const WALL_LEFT = HALF_W;               // parapet inner face
export const WALL_RIGHT = MEDIAN_D + 0.3;      // median barrier face (-6.95)

export class Vehicle {
  constructor(track, spec) {
    this.track = track;
    this.spec = spec;
    this.frame = makeFrame();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.events = [];
    this.reset(0, 0);
  }

  reset(s, d, speed = 0) {
    const f = this.track.frame(s, this.frame);
    this.x = f.pos.x + f.left.x * d;
    this.z = f.pos.z + f.left.z * d;
    this.s = s; this.d = d;
    this.yaw = f.heading;       // heading
    this.course = f.heading;    // velocity direction
    this.v = speed;
    this.yawRate = 0;
    this.steer = 0;
    this.gear = 1;
    this.rpm = this.spec.idle;
    this.boost = 0;
    this.shiftTimer = 0;
    this.throttle = 0; this.brake = 0;
    this.slip = 0;
    this.latAcc = 0; this.lonAcc = 0;
    this.bodyRoll = 0; this.bodyPitch = 0; this.rollVel = 0; this.pitchVel = 0;
    this.wallContact = 0;
    this.slipstream = 0;
    this.topSpeedReached = 0;
    this.distance = 0;
    this.updatePose(0);
  }

  get speedKmh() { return this.v * 3.6; }

  /** input: {throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake bool} */
  step(dt, input) {
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.integrate(h, input);
    this.updatePose(dt);
  }

  integrate(dt, input) {
    const sp = this.spec;
    const g = 9.81;
    // --- Inputs (smoothed) ---
    const steerRate = 3.2;
    this.steer += clamp(input.steer - this.steer, -steerRate * dt, steerRate * dt);
    this.throttle = lerp(this.throttle, input.throttle, 1 - Math.exp(-14 * dt));
    this.brake = lerp(this.brake, input.brake, 1 - Math.exp(-18 * dt));

    // --- Engine / gearbox (automatic) ---
    const v = this.v;
    const wheelRps = v / (2 * Math.PI * sp.wheelR);
    const ratio = sp.gears[this.gear - 1] * sp.final;
    const engineRpm = Math.max(sp.idle, wheelRps * ratio * 60);
    this.rpm = lerp(this.rpm, this.shiftTimer > 0 ? this.rpm * 0.995 : engineRpm, 1 - Math.exp(-20 * dt));
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftTimer <= 0) {
      if (engineRpm > sp.redline * 0.95 && this.gear < sp.gears.length) { this.gear++; this.shiftTimer = 0.16; this.events.push({ type: 'shift', up: true }); }
      else if (this.gear > 1 && engineRpm < sp.redline * 0.52) {
        const lower = wheelRps * sp.gears[this.gear - 2] * sp.final * 60;
        if (lower < sp.redline * 0.88) { this.gear--; this.shiftTimer = 0.1; this.events.push({ type: 'shift', up: false }); }
      }
    }
    // Turbo spool (lag), wastegate at 1.
    if (sp.turbo) {
      const target = this.throttle > 0.5 && this.shiftTimer <= 0 ? clamp((this.rpm - 2800) / 3200, 0, 1) : 0;
      const prev = this.boost;
      this.boost += (target - this.boost) * (target > this.boost ? 1.6 : 6) * dt;
      if (prev > 0.55 && this.throttle < 0.3 && this.boost < prev && !this._bov) { this._bov = true; this.events.push({ type: 'bov', amount: prev }); }
      if (this.throttle > 0.6) this._bov = false;
    } else this.boost = this.throttle;

    const powerFactor = sp.turbo ? 0.62 + 0.38 * this.boost : 1;
    const shiftCut = this.shiftTimer > 0 ? 0.25 : 1;
    let drive = this.throttle * sp.power * powerFactor * shiftCut / Math.max(v, 6);
    drive = Math.min(drive, sp.grip * sp.mass * g * 0.95);
    const drag = (sp.cdA * (1 - this.slipstream * 0.42)) * 0.6 * v * v;
    const roll = 0.012 * sp.mass * g + 18 * v;
    const brakeF = this.brake * 1.25 * sp.mass * g;
    let a = (drive - drag - roll - (v > 0.5 ? brakeF : 0)) / sp.mass;
    if (v < 0.5 && this.throttle < 0.05) a = Math.min(a, 0);
    this.lonAcc = lerp(this.lonAcc, a, 1 - Math.exp(-6 * dt));

    // --- Steering / yaw ---
    const kmh = v * 3.6;
    const maxSteer = lerp(0.5, 0.055, clamp(kmh / 300, 0, 1) ** 0.7);
    const delta = this.steer * maxSteer;
    let rTarget = v * Math.tan(delta) / sp.wheelbase;
    const drifting = input.handbrake || (this.brake > 0.5 && Math.abs(this.steer) > 0.6 && kmh > 90);
    if (drifting) rTarget *= 1.55;
    this.yawRate = lerp(this.yawRate, rTarget, 1 - Math.exp(-(drifting ? 5 : 9) * dt));
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // Course follows heading within the lateral grip budget.
    const latMax = sp.grip * g * (drifting ? 0.72 : 1);
    let diff = wrapAngle(this.yaw - this.course);
    const gripRate = drifting ? 2.2 : 9;
    let dc = diff * Math.min(1, gripRate * dt);
    const maxDc = v > 1 ? (latMax / v) * dt : Math.abs(dc);
    const want = this.yawRate * dt + dc;
    const turn = clamp(want, -maxDc - Math.abs(this.yawRate * dt) * 0.0, maxDc);
    this.course = wrapAngle(this.course + turn);
    diff = wrapAngle(this.yaw - this.course);
    // Large slides recover (no spin-outs: arcade).
    if (Math.abs(diff) > 0.6) { this.course = wrapAngle(this.yaw - Math.sign(diff) * 0.6); diff = Math.sign(diff) * 0.6; }
    this.slip = diff;
    this.latAcc = lerp(this.latAcc, v * (turn / Math.max(dt, 1e-4)), 1 - Math.exp(-8 * dt));
    // Sliding scrubs speed.
    a -= Math.abs(Math.sin(diff)) * v * (drifting ? 0.55 : 0.9);

    this.v = Math.max(0, this.v + a * dt);
    this.x += Math.sin(this.course) * this.v * dt;
    this.z += Math.cos(this.course) * this.v * dt;
    this.distance += this.v * dt;

    // --- Track constraint (parapet / median barrier) ---
    const pr = this.track.project(this.x, this.z, this.s);
    const f = this.track.frame(pr.s, this.frame);
    this.s = pr.s; this.d = pr.d;
    const hw = sp.halfWidth;
    const lim = [WALL_RIGHT + hw, WALL_LEFT - hw];
    this.wallContact = Math.max(0, this.wallContact - dt * 4);
    if (this.d > lim[1] || this.d < lim[0]) {
      const side = this.d > lim[1] ? 1 : -1;
      const dTarget = side > 0 ? lim[1] : lim[0];
      // Push back onto the deck.
      this.x += f.left.x * (dTarget - this.d);
      this.z += f.left.z * (dTarget - this.d);
      this.d = dTarget;
      // Velocity relative to the wall.
      const th = f.heading;
      const rel = wrapAngle(this.course - th);
      const vn = Math.sin(rel) * this.v;    // + = towards the left wall
      const vt = Math.cos(rel) * this.v;
      if (Math.sign(vn) === side) {
        const impact = Math.abs(vn);
        const newVt = Math.max(0, vt * (1 - Math.min(0.45, impact * 0.035)));
        const bounce = -vn * 0.18;
        this.v = Math.hypot(newVt, bounce);
        this.course = wrapAngle(th + Math.atan2(bounce, newVt));
        this.yaw = wrapAngle(th + clamp(wrapAngle(this.yaw - th), -0.12, 0.12) * 0.5 - side * 0.02);
        this.yawRate *= 0.3;
        if (impact > 1.2) this.events.push({ type: 'wall', impact, side });
      }
      this.v *= 1 - 0.35 * dt;   // scraping
      this.wallContact = 1;
    }
    this.topSpeedReached = Math.max(this.topSpeedReached, this.v);
  }

  /** Bumps from car collisions: impulse along/against the track. */
  applyImpulse(dv, dd) {
    const th = this.track.frame(this.s, this.frame).heading;
    const vx = Math.sin(this.course) * this.v + Math.sin(th) * dv + Math.cos(th) * dd;
    const vz = Math.cos(this.course) * this.v + Math.cos(th) * dv - Math.sin(th) * dd;
    this.v = Math.hypot(vx, vz);
    if (this.v > 0.1) this.course = Math.atan2(vx, vz);
  }

  updatePose(dt) {
    const f = this.track.frame(this.s, this.frame);
    const y = this.track.heightAt(this.s, this.d);
    this.pos.set(this.x, y, this.z);
    // Suspension: body roll / pitch springs driven by accelerations.
    if (dt > 0) {
      const k = 90, c = 13;
      const rollT = clamp(-this.latAcc * 0.0065, -0.07, 0.07);
      const pitchT = clamp(-this.lonAcc * 0.0045, -0.05, 0.05);
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
