// Unified input: keyboard, on-screen touch pedals, tilt steering and gamepads.
import { clamp } from './util.js';

export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.edges = new Set();
    this.touch = { left: false, right: false, accel: false, brake: false };
    this.tilt = 0;
    this.mode = 'touch';      // 'touch' | 'tilt'
    this.autoAccel = false;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.touchRoot = touchRoot;
    this.anyPress = false;
    this.lastPad = {};

    addEventListener('keydown', e => {
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      this.anyPress = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => { this.anyPress = true; });
    addEventListener('devicemotion', e => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.y === null) return;
      const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
      const raw = (ang === 270 || ang === -90 ? g.y : -g.y) / 9.81;
      this.tilt = clamp(raw * 2.4, -1, 1);
    });
    this.buildTouch();
  }

  buildTouch() {
    const root = this.touchRoot;
    root.innerHTML = `
      <div class="tbtn steer left" data-k="left">◀</div>
      <div class="tbtn steer right" data-k="right">▶</div>
      <div class="tbtn brake" data-k="brake"><div class="pedal">BRAKE</div></div>
      <div class="tbtn accel" data-k="accel"><div class="pedal">ACCEL</div></div>
      <div class="tbtn cam" data-k="cam">CAM</div>
      <div class="tbtn pause" data-k="pause">II</div>`;
    const active = new Map();
    const refresh = () => {
      for (const k of Object.keys(this.touch)) this.touch[k] = false;
      for (const k of active.values()) if (k in this.touch) this.touch[k] = true;
      for (const el of root.querySelectorAll('.tbtn')) el.classList.toggle('on', [...active.values()].includes(el.dataset.k));
    };
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const b = el && el.closest && el.closest('.tbtn');
      return b ? b.dataset.k : null;
    };
    root.addEventListener('pointerdown', e => {
      const k = hit(e.clientX, e.clientY);
      if (!k) return;
      e.preventDefault();
      if (k === 'pause' || k === 'cam') { this.edges.add(k === 'pause' ? 'Escape' : 'KeyC'); return; }
      active.set(e.pointerId, k);
      refresh();
      this.haptic(8);
    }, { passive: false });
    // Sliding a thumb between buttons keeps working (classic mobile racer feel).
    addEventListener('pointermove', e => {
      if (!active.has(e.pointerId)) return;
      const k = hit(e.clientX, e.clientY);
      if (k && k !== 'pause' && k !== 'cam' && k !== active.get(e.pointerId)) { active.set(e.pointerId, k); refresh(); }
    });
    const up = e => { if (active.delete(e.pointerId)) refresh(); };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    this.showTouch(false);
  }

  showTouch(v) {
    this.touchRoot.style.display = v && this.isTouchDevice() ? 'block' : 'none';
    for (const el of this.touchRoot.querySelectorAll('.steer')) el.style.display = this.mode === 'tilt' ? 'none' : 'flex';
  }

  isTouchDevice() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || /[?&]touch/.test(location.search); }

  haptic(ms) {
    try {
      if (window.AndroidBridge) window.AndroidBridge.vibrate(ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  }

  pressed(...codes) {
    for (const c of codes) if (this.edges.has(c)) return true;
    return false;
  }

  /** Call once per frame before reading state; edges are consumed by endFrame(). */
  poll() {
    const k = this.keys;
    let steer = 0, throttle = 0, brake = 0, hb = false;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer += 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer -= 1;
    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('Space')) hb = true;
    if (this.touch.left) steer += 1;
    if (this.touch.right) steer -= 1;
    if (this.touch.accel) throttle = 1;
    if (this.touch.brake) brake = 1;
    if (this.mode === 'tilt' && this.touchRoot.style.display !== 'none') steer += this.tilt;
    if (this.autoAccel && brake === 0) throttle = 1;

    // Gamepad (standard mapping).
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer -= ax;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt, p.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt, p.buttons[2]?.pressed ? 1 : 0);
      if (p.buttons[1]?.pressed) hb = true;
      const map = { 9: 'Escape', 0: 'Enter', 1: 'Backspace', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 3: 'KeyC' };
      for (const [i, code] of Object.entries(map)) {
        const b = p.buttons[i]?.pressed;
        const key = p.index + ':' + i;
        if (b && !this.lastPad[key]) { this.edges.add(code); this.anyPress = true; }
        this.lastPad[key] = b;
      }
    }
    const s = this.state;
    s.steer = clamp(steer, -1, 1); s.throttle = throttle; s.brake = brake; s.handbrake = hb;
    return s;
  }

  endFrame() { this.edges.clear(); this.anyPress = false; }
}
