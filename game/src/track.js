// Track centreline math: builds a smooth clothoid-like path from turn segments and
// offers frame queries (position / forward / left / up at distance s), world→track
// projection, and lane geometry constants.
import * as THREE from 'three';
import { SEGMENTS } from './course.js';
import { clamp } from './util.js';

export const DS = 2;                 // sample spacing (m)
export const LANE_W = 3.5;
export const HALF_W = 6.25;          // carriageway half width (3 lanes + shoulders)
export const LANES = [LANE_W, 0, -LANE_W];   // lane centre offsets (left, middle, right)
export const MEDIAN_D = -7.25;       // median barrier centre
export const ONCOMING_D = -14.5;     // opposite carriageway centre
export const DECK_LEFT = HALF_W + 0.55;
export const DECK_RIGHT = ONCOMING_D - HALF_W - 0.55;

function boxSmooth(arr, radius) {
  const n = arr.length, out = new Float64Array(n);
  let acc = 0, cnt = 0;
  for (let i = -radius; i <= radius; i++) { const j = clamp(i, 0, n - 1); acc += arr[j]; cnt++; }
  for (let i = 0; i < n; i++) {
    out[i] = acc / cnt;
    const add = clamp(i + radius + 1, 0, n - 1), rem = clamp(i - radius, 0, n - 1);
    acc += arr[add] - arr[rem];
  }
  return out;
}

export class Track {
  constructor(segments = SEGMENTS, { heading0 = Math.PI / 2, origin = [0, 0] } = {}) {
    const total = segments.reduce((a, s) => a + s[0], 0);
    const n = Math.floor(total / DS) + 1;
    this.n = n;
    this.length = (n - 1) * DS;

    // Curvature and height profiles.
    let k = new Float64Array(n), hRaw = new Float64Array(n);
    const ends = [[0, segments[0][2]]];
    let s0 = 0;
    for (const [len, turn, h] of segments) {
      const kk = (turn * Math.PI / 180) / len;
      for (let i = Math.floor(s0 / DS); i < Math.min(n, Math.floor((s0 + len) / DS) + 1); i++) k[i] = kk;
      s0 += len;
      ends.push([s0, h]);
    }
    // Height: monotone-ish cubic through segment end heights.
    for (let i = 0; i < n; i++) {
      const s = i * DS;
      let j = 0;
      while (j < ends.length - 2 && ends[j + 1][0] < s) j++;
      const [sa, ha] = ends[j], [sb, hb] = ends[j + 1];
      const t = clamp((s - sa) / (sb - sa), 0, 1);
      hRaw[i] = ha + (hb - ha) * (t * t * (3 - 2 * t));
    }
    k = boxSmooth(boxSmooth(k, 30), 30);
    const h = boxSmooth(boxSmooth(hRaw, 25), 25);

    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.fx = new Float32Array(n); this.fz = new Float32Array(n);
    this.k = new Float32Array(n); this.bank = new Float32Array(n); this.slope = new Float32Array(n);
    let th = heading0, px = origin[0], pz = origin[1];
    for (let i = 0; i < n; i++) {
      this.x[i] = px; this.z[i] = pz; this.y[i] = h[i];
      this.fx[i] = Math.sin(th); this.fz[i] = Math.cos(th);
      this.k[i] = k[i];
      // Integrate with midpoint heading for accuracy.
      const thMid = th + k[i] * DS * 0.5;
      px += Math.sin(thMid) * DS; pz += Math.cos(thMid) * DS;
      th += k[i] * DS;
    }
    const bank = new Float64Array(n);
    for (let i = 0; i < n; i++) bank[i] = -clamp(k[i] * 1100, -1, 1) * 0.075;
    const bs = boxSmooth(bank, 20);
    for (let i = 0; i < n; i++) {
      this.bank[i] = bs[i];
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      this.slope[i] = (this.y[b] - this.y[a]) / ((b - a) * DS);
    }
    this._v = new THREE.Vector3();
  }

  index(s) { return clamp(Math.floor(s / DS), 0, this.n - 2); }

  /** Frame at distance s. Writes into out = {pos, fwd, left, up, k, bank} (Vector3s preallocated). */
  frame(s, out) {
    const i = this.index(s);
    const t = clamp((s - i * DS) / DS, 0, 1);
    const j = i + 1;
    const x = this.x[i] + (this.x[j] - this.x[i]) * t;
    const y = this.y[i] + (this.y[j] - this.y[i]) * t;
    const z = this.z[i] + (this.z[j] - this.z[i]) * t;
    let fx = this.fx[i] + (this.fx[j] - this.fx[i]) * t;
    let fz = this.fz[i] + (this.fz[j] - this.fz[i]) * t;
    const fl = Math.hypot(fx, fz); fx /= fl; fz /= fl;
    const bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    const slope = this.slope[i] + (this.slope[j] - this.slope[i]) * t;
    const cb = Math.cos(bank), sb = Math.sin(bank);
    out.pos.set(x, y, z);
    out.left.set(fz * cb, sb, -fx * cb);
    out.fwd.set(fx, slope, fz).normalize();
    out.up.crossVectors(out.fwd, out.left).normalize();
    out.k = this.k[i] + (this.k[j] - this.k[i]) * t;
    out.bank = bank;
    out.heading = Math.atan2(fx, fz);
    return out;
  }

  /** World point at (s, d, h above deck). */
  point(s, d, h = 0, out = new THREE.Vector3()) {
    const f = this._f || (this._f = makeFrame());
    this.frame(s, f);
    return out.copy(f.pos).addScaledVector(f.left, d).addScaledVector(f.up, h);
  }

  heading(s) {
    const i = this.index(s);
    return Math.atan2(this.fx[i], this.fz[i]);
  }

  /** Projects world (x,z) onto the track near hint s. Returns {s, d}. */
  project(x, z, hintS = null, out = { s: 0, d: 0 }) {
    let best = -1, bestD = Infinity;
    let a = 0, b = this.n - 1;
    if (hintS !== null) {
      const hi = this.index(hintS);
      a = Math.max(0, hi - 30); b = Math.min(this.n - 1, hi + 30);
    }
    const step = hintS === null ? 4 : 1;
    for (let i = a; i <= b; i += step) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (hintS === null) {
      const lo = Math.max(0, best - 4), hi = Math.min(this.n - 1, best + 4);
      for (let i = lo; i <= hi; i++) {
        const dx = x - this.x[i], dz = z - this.z[i];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
    }
    const i = best;
    const dx = x - this.x[i], dz = z - this.z[i];
    const along = dx * this.fx[i] + dz * this.fz[i];
    const lat = dx * this.fz[i] - dz * this.fx[i];
    out.s = clamp(i * DS + along, 0, this.length);
    out.d = lat / Math.cos(this.bank[i]);
    return out;
  }

  /** Deck height at (s, d). */
  heightAt(s, d) {
    const i = this.index(s);
    const t = clamp((s - i * DS) / DS, 0, 1);
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    const b = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    return y + Math.sin(b) * d;
  }

  curvature(s) { return this.k[this.index(s)]; }
}

export function makeFrame() {
  return { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), k: 0, bank: 0, heading: 0 };
}
