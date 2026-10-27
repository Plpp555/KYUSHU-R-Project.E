// Chase / bumper cameras with speed-dependent FOV and shake, plus cinematic shots for
// the attract mode, the rival intro and the finish.
import * as THREE from 'three';
import { clamp, damp, wrapAngle, vnoise } from './util.js';

const MODES = [
  { name: 'CHASE', dist: 6.3, height: 1.85, look: 0.95, fov: 60 },
  { name: 'NEAR', dist: 4.7, height: 1.4, look: 0.85, fov: 62 },
  { name: 'BUMPER', bumper: true, fov: 66 },
];

export class CameraRig {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.modeIndex = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.time = 0;
    this.fovKick = 0;
    this.cine = { shot: 0, t: 0, fixed: new THREE.Vector3() };
    this._f = new THREE.Vector3(); this._l = new THREE.Vector3(); this._u = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.initialized = false;
  }

  get mode() { return MODES[this.modeIndex]; }
  cycle() { this.modeIndex = (this.modeIndex + 1) % MODES.length; return this.mode.name; }
  setMode(name) { const i = MODES.findIndex(m => m.name === name); if (i >= 0) this.modeIndex = i; }

  basis(t) {
    // Car basis from its quaternion: x=left, y=up, z=forward.
    this._f.set(0, 0, 1).applyQuaternion(t.quat);
    this._l.set(1, 0, 0).applyQuaternion(t.quat);
    this._u.set(0, 1, 0).applyQuaternion(t.quat);
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  applyShake(dt, kmh) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const hs = clamp((kmh - 180) / 160, 0, 1) * 0.018;
    const a = this.shake * 0.12 + hs;
    if (a <= 0) return;
    const t = this.time * 22;
    this.camera.position.x += (vnoise(t, 1.3) - 0.5) * a;
    this.camera.position.y += (vnoise(t, 7.1) - 0.5) * a;
    this.camera.position.z += (vnoise(t, 13.7) - 0.5) * a;
  }

  /** Gameplay camera. t: {pos, quat, yaw, speed (m/s), steer, slip} */
  follow(dt, t) {
    const cam = this.camera;
    const m = this.mode;
    const kmh = t.speed * 3.6;
    this.basis(t);
    if (m.bumper) {
      cam.position.copy(t.pos).addScaledVector(this._u, 0.98).addScaledVector(this._f, 0.35);
      this.look.copy(cam.position).addScaledVector(this._f, 20).addScaledVector(this._u, -0.6);
      cam.up.copy(this._u);
      cam.lookAt(this.look);
    } else {
      if (!this.initialized) { this.yaw = t.yaw; this.initialized = true; }
      // Yaw lags behind the car (shows slides), position springs.
      this.yaw += wrapAngle(t.yaw - t.slip * 0.4 - this.yaw) * (1 - Math.exp(-7 * dt));
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const dist = m.dist + clamp(kmh / 300, 0, 1) * 0.9 - this.fovKick * 0.6;
      const target = this._v.copy(t.pos);
      target.x -= fx * dist; target.z -= fz * dist;
      target.addScaledVector(this._u, m.height);
      if (!this._init2) { this.pos.copy(target); this._init2 = true; }
      this.pos.x = damp(this.pos.x, target.x, 14, dt);
      this.pos.z = damp(this.pos.z, target.z, 14, dt);
      this.pos.y = damp(this.pos.y, target.y, 9, dt);
      cam.position.copy(this.pos);
      this.look.copy(t.pos).addScaledVector(this._u, m.look);
      this.look.x += fx * 4.0; this.look.z += fz * 4.0;
      cam.up.set(0, 1, 0).applyAxisAngle(this._f, -t.steer * 0.012);
      cam.lookAt(this.look);
    }
    const fov = m.fov + clamp((kmh - 60) / 260, 0, 1) * 14 + this.fovKick * 6;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = damp(cam.fov, fov, 4, dt); cam.updateProjectionMatrix(); }
    this.fovKick = Math.max(0, this.fovKick - dt * 1.5);
    this.applyShake(dt, kmh);
  }

  resetFollow() { this.initialized = false; this._init2 = false; }

  /** Cinematic shots around a target car. Returns true when a cut happened. */
  cinematic(dt, t, { shotLen = 5.2, shots = null, other = null } = {}) {
    const c = this.cine;
    c.t += dt;
    let cut = false;
    const list = shots || ['front', 'side', 'orbit', 'static', 'heli', 'wheel', 'chaseLow'];
    if (c.t > shotLen) { c.t = 0; c.shot = (c.shot + 1) % list.length; cut = true; c.init = false; }
    const shot = list[c.shot];
    const cam = this.camera;
    this.basis(t);
    const P = cam.position;
    let fov = 48;
    const k = c.t / shotLen;
    switch (shot) {
      case 'front':
        P.copy(t.pos).addScaledVector(this._f, 7.5 - k * 2.0).addScaledVector(this._l, 3.6).addScaledVector(this._u, 0.7);
        this.look.copy(t.pos).addScaledVector(this._u, 0.6);
        fov = 38;
        break;
      case 'side':
        P.copy(t.pos).addScaledVector(this._l, -4.4).addScaledVector(this._f, 2.8 - k * 5.5).addScaledVector(this._u, 0.55);
        this.look.copy(t.pos).addScaledVector(this._u, 0.55);
        fov = 42;
        break;
      case 'orbit': {
        const a = k * 2.2 + 0.6;
        P.copy(t.pos).addScaledVector(this._f, Math.cos(a) * 6.5).addScaledVector(this._l, Math.sin(a) * 6.5).addScaledVector(this._u, 1.2);
        this.look.copy(t.pos).addScaledVector(this._u, 0.6);
        fov = 45;
        break;
      }
      case 'static': {
        if (!c.init) {
          const s = t.s + 70, f = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3() };
          this.track.frame(s, f);
          c.fixed.copy(f.pos).addScaledVector(f.left, 5.6).addScaledVector(f.up, 1.1);
          c.init = true;
        }
        P.copy(c.fixed);
        this.look.copy(t.pos).addScaledVector(this._u, 0.6);
        fov = clamp(55 - 30 * (1 - P.distanceTo(t.pos) / 80), 22, 55);
        break;
      }
      case 'heli':
        P.copy(t.pos).addScaledVector(this._f, -22 + k * 10).addScaledVector(this._l, 9).addScaledVector(this._u, 13);
        this.look.copy(t.pos).addScaledVector(this._f, 6);
        fov = 50;
        break;
      case 'wheel':
        P.copy(t.pos).addScaledVector(this._l, 1.35).addScaledVector(this._f, -1.9).addScaledVector(this._u, 0.32);
        this.look.copy(t.pos).addScaledVector(this._f, 12).addScaledVector(this._u, 0.3);
        fov = 62;
        break;
      case 'chaseLow':
        P.copy(t.pos).addScaledVector(this._f, -5.2).addScaledVector(this._u, 0.55).addScaledVector(this._l, -0.6);
        this.look.copy(t.pos).addScaledVector(this._f, 6).addScaledVector(this._u, 0.5);
        fov = 58;
        break;
      case 'rivalFront':
        if (other) {
          this.basis(other);
          P.copy(other.pos).addScaledVector(this._f, 6.5 - k * 1.5).addScaledVector(this._l, -1.8).addScaledVector(this._u, 0.6);
          this.look.copy(other.pos).addScaledVector(this._u, 0.55);
          fov = 36;
        }
        break;
      case 'grid':
        P.copy(t.pos).addScaledVector(this._f, -9 + k * 2).addScaledVector(this._l, -1.8).addScaledVector(this._u, 2.2);
        this.look.copy(t.pos).addScaledVector(this._l, -1.8).addScaledVector(this._f, 4);
        fov = 50;
        break;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return cut;
  }

  resetCine(shot = 0) { this.cine.shot = shot; this.cine.t = 0; this.cine.init = false; }
}
