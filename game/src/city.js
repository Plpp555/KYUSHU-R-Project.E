// Fukuoka at night: sea/land mask, emissive city ground with street grid, the sea
// with planar reflections, thousands of instanced buildings with procedural windows,
// the 西公園 hill over the tunnel, and rooftop aviation lights.
import * as THREE from 'three';
import { GLSL_NOISE, LAYER, setLayers, mulberry32, clamp, fbm } from './util.js';
import { TUNNEL } from './course.js';
import { MOON_DIR } from './sky.js';
import { U } from './lighting.js';

/** Spatial hash over track samples for fast nearest-centreline queries. */
export class TrackIndex {
  constructor(track, step = 8, cell = 160) {
    this.track = track; this.cell = cell;
    this.map = new Map();
    this.pts = [];
    for (let s = 0; s <= track.length; s += step) {
      const i = track.index(s);
      const p = { s, x: track.x[i], z: track.z[i], lx: track.fz[i], lz: -track.fx[i], y: track.y[i] };
      this.pts.push(p);
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(p);
    }
  }
  key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }
  nearest(x, z, out = {}) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = null, bd = Infinity, extra = 1;
    for (let r = 0; r < 5; r++) {
      if (best && extra-- <= 0) break;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const arr = this.map.get(this.key(cx + i, cz + j));
        if (!arr) continue;
        for (const p of arr) {
          const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d2 < bd) { bd = d2; best = p; }
        }
      }
    }
    if (!best) {
      // Far from the course: coarse brute force, then refine locally.
      const P = this.pts;
      let bi = 0;
      for (let i = 0; i < P.length; i += 6) {
        const d2 = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      for (let i = Math.max(0, bi - 6); i < Math.min(P.length, bi + 7); i++) {
        const d2 = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
        if (d2 <= bd) { bd = d2; bi = i; }
      }
      best = P[bi];
    }
    out.s = best.s; out.dist = Math.sqrt(bd);
    out.d = (x - best.x) * best.lx + (z - best.z) * best.lz;
    out.y = best.y;
    return out;
  }
}

// Sea (博多湾) relative to the course, in track coordinates.
export function waterAt(s, d) {
  const wob = 60 * Math.sin(s * 0.0031) + 40 * Math.sin(s * 0.011 + 1.7);
  if (d > 2600) return true;
  if (s < 2550) return d > 520 + wob;
  if (s < 3450) return d > 300 + wob * 0.5;
  if (s < 4380) return Math.abs(s - 3915) < 430 + wob * 0.6 ? d > -700 : d > 260 + wob;
  if (s < 5000) return d > 280 + wob;
  if (s < 6400) return d > 560 + wob;
  return false;
}

export function buildCity(track, quality) {
  const group = new THREE.Group();
  group.name = 'city';
  const index = new TrackIndex(track);

  // ---- bounds & sea mask -----------------------------------------------------
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.n; i += 10) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const pad = 3200;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const W = maxX - minX, H = maxZ - minZ;
  const RES = 512;
  const raw = new Float32Array(RES * RES);
  const q = {};
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const x = minX + (i + 0.5) / RES * W, z = minZ + (j + 0.5) / RES * H;
    index.nearest(x, z, q);
    let w = waterAt(q.s, q.d) ? 1 : 0;
    // Beyond the course ends, keep the sea to the north.
    if (q.s < 1 && z < track.z[0] - 400) w = 1;
    raw[j * RES + i] = w;
  }
  const blurred = blur(raw, RES, 3);
  const data = new Uint8Array(RES * RES);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(blurred[i] * 255);
  const mask = new THREE.DataTexture(data, RES, RES, THREE.RedFormat, THREE.UnsignedByteType);
  mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;
  const bounds = new THREE.Vector4(minX, minZ, W, H);
  const isWater = (x, z) => {
    const i = clamp(Math.floor((x - minX) / W * RES), 0, RES - 1), j = clamp(Math.floor((z - minZ) / H * RES), 0, RES - 1);
    return blurred[j * RES + i] > 0.3;
  };

  // ---- ground + sea ------------------------------------------------------------
  const groundUniforms = {
    uMask: { value: mask }, uBounds: { value: bounds },
    uWaterRefl: { value: null }, uWaterMat: { value: new THREE.Matrix4() }, uWaterReflOn: { value: 0 },
    uMoonDir: { value: MOON_DIR },
    uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity,
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H, 1, 1).rotateX(-Math.PI / 2).translate(minX + W / 2, 0, minZ + H / 2),
    new THREE.ShaderMaterial({ uniforms: groundUniforms, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, extensions: { derivatives: true } }),
  );
  ground.frustumCulled = false;
  setLayers(ground, LAYER.MAIN, LAYER.ENV);
  group.add(ground);
  // Low-cost copy for the road reflection (no recursive sea reflection).
  group.userData.groundUniforms = groundUniforms;

  // ---- buildings -------------------------------------------------------------
  const buildings = buildBuildings(track, index, isWater, quality, { minX, minZ, W, H });
  group.add(buildings.mesh);
  group.add(buildings.aviation);
  group.userData.buildings = buildings;

  group.add(buildHill(track, index));

  return { group, index, isWater, bounds, groundUniforms };
}

function blur(src, n, passes) {
  const a = Float32Array.from(src), b = new Float32Array(n * n);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -2; k <= 2; k++) { const x = i + k; if (x >= 0 && x < n) { s += a[j * n + x]; c++; } }
      b[j * n + i] = s / c;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -2; k <= 2; k++) { const y = j + k; if (y >= 0 && y < n) { s += b[y * n + i]; c++; } }
      a[j * n + i] = s / c;
    }
  }
  return a;
}

const GROUND_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const GROUND_FRAG = /* glsl */`
uniform sampler2D uMask; uniform vec4 uBounds;
uniform sampler2D uWaterRefl; uniform mat4 uWaterMat; uniform float uWaterReflOn;
uniform vec3 uMoonDir; uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
varying vec3 vW;
${GLSL_NOISE}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Emissive city floor seen from the viaduct: street grid, lamp pools, moving traffic.
vec3 land(vec2 p, float px){
  float district = smoothstep(0.45, 0.55, fbm3(p * 0.00035 + 3.0));
  vec2 q = rot(mix(0.12, 0.78, district)) * p;
  vec2 bs = vec2(92.0, 70.0);
  vec2 id = floor(q / bs);
  vec2 f = q - id * bs;
  vec2 e = min(f, bs - f);                 // distance to block edge
  float main = step(0.75, hash12(vec2(id.x, 3.0)));
  float mainZ = step(0.75, hash12(vec2(id.y, 7.0)));
  float sw = 7.0;
  float aa = px * 1.5 + 0.5;
  float stX = 1.0 - smoothstep(sw - aa, sw + aa, e.x * 2.0);
  float stZ = 1.0 - smoothstep(sw - aa, sw + aa, e.y * 2.0);
  float street = max(stX, stZ);
  float lot = hash12(id * 1.7 + 0.3);
  vec3 col = vec3(0.004, 0.0042, 0.005) * (0.6 + 0.8 * lot);
  // lit lots (parking, gas stations, plazas)
  if (lot > 0.93) col += vec3(0.11, 0.105, 0.09) * smoothstep(8.0, 20.0, min(e.x, e.y));
  col = mix(col, vec3(0.012, 0.011, 0.01), street);
  // Lamp pools along the streets.
  float lampDetail = 1.0 - smoothstep(1.5, 5.0, px);
  vec2 lp = vec2(mod(q.x, 26.0) - 13.0, mod(q.y, 26.0) - 13.0);
  float poolX = exp(-(lp.x * lp.x) / 40.0) * stZ;
  float poolZ = exp(-(lp.y * lp.y) / 40.0) * stX;
  vec3 sodium = vec3(1.0, 0.55, 0.2);
  col += sodium * (poolX + poolZ) * 0.18 * mix(0.6, 1.0, lampDetail);
  float ey = e.y * 2.0 - sw, ex = e.x * 2.0 - sw;
  float dotX = exp(-(lp.x * lp.x + ey * ey) / max(0.8, px * px)) * stZ;
  float dotZ = exp(-(lp.y * lp.y + ex * ex) / max(0.8, px * px)) * stX;
  col += sodium * (dotX + dotZ) * 3.0 * lampDetail;
  // Moving traffic on main streets.
  float trafX = main * stX, trafZ = mainZ * stZ;
  float carA = smoothstep(0.92, 1.0, fract((q.y + uTime * 14.0 + id.x * 31.0) / 37.0));
  float carB = smoothstep(0.92, 1.0, fract((q.y - uTime * 12.0 + id.x * 17.0) / 41.0));
  float carC = smoothstep(0.92, 1.0, fract((q.x + uTime * 13.0 + id.y * 23.0) / 39.0));
  float carD = smoothstep(0.92, 1.0, fract((q.x - uTime * 11.0 + id.y * 11.0) / 43.0));
  float side1 = step(f.x, bs.x * 0.5), side2 = step(f.y, bs.y * 0.5);
  col += vec3(1.0, 0.92, 0.8) * (carA * side1 * trafX + carC * side2 * trafZ) * 1.6 * lampDetail;
  col += vec3(1.0, 0.08, 0.04) * (carB * (1.0 - side1) * trafX + carD * (1.0 - side2) * trafZ) * 1.2 * lampDetail;
  // Far away: average glow of all of the above.
  vec3 avg = vec3(0.006) + sodium * 0.035 + vec3(0.02, 0.018, 0.016) * step(0.93, lot);
  return mix(col, avg, smoothstep(3.0, 9.0, px));
}

vec3 sea(vec3 P, vec3 V){
  vec2 p = P.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 0.35 + t * 1.1) * 0.03;
  g += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 0.52 + t * 1.4) * 0.025;
  g += vec2(0.2, -0.7) * cos(dot(p, vec2(0.2, -0.7)) * 1.3 + t * 2.1) * 0.015;
  g += (vec2(vnoise(p * 0.15 + t * 0.2), vnoise(p * 0.15 - t * 0.17 + 5.0)) - 0.5) * 0.06;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float NoV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 refl;
  if (uWaterReflOn > 0.5) {
    vec4 rc = uWaterMat * vec4(P, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * 0.08;
    refl = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      refl += textureLod(uWaterRefl, ruv + vec2(0.0, -fi * 0.006), 1.0 + fi * 0.5).rgb * exp(-fi * 0.45);
    }
    refl /= 2.9;
  } else {
    refl = mix(vec3(0.08, 0.05, 0.06), vec3(0.01, 0.012, 0.03), clamp(reflect(-V, N).y * 3.0, 0.0, 1.0));
  }
  vec3 R = reflect(-V, N);
  float moon = pow(max(dot(R, uMoonDir), 0.0), 900.0) * 30.0 + pow(max(dot(R, uMoonDir), 0.0), 60.0) * 0.4;
  return vec3(0.001, 0.003, 0.005) + refl * F + vec3(0.8, 0.82, 0.9) * moon;
}

void main(){
  vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
  float w = texture2D(uMask, uv).r;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  float px = length(fwidth(vW.xz));
  vec3 col;
  float isSea = smoothstep(0.42, 0.58, w);
  vec3 lc = isSea < 0.999 ? land(vW.xz, px) : vec3(0.0);
  vec3 sc = isSea > 0.001 ? sea(vW, V) : vec3(0.0);
  col = mix(lc, sc, isSea);
  // Promenade lights along the shore (百道浜 / ベイサイド).
  float shore = smoothstep(0.25, 0.4, w) * (1.0 - smoothstep(0.4, 0.5, w));
  float ld = fract(dot(vW.xz, vec2(0.7071)) / 22.0);
  col += vec3(1.0, 0.85, 0.65) * shore * (0.15 + 2.5 * smoothstep(0.9, 1.0, ld) * (1.0 - smoothstep(2.0, 6.0, px)));
  float f = 1.0 - exp(-pow(uFogDensity * dist * 0.8, 2.0));
  col = mix(col, uFogColor * vec3(1.2, 1.0, 0.9), f);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(64.0)), 1.0);
}`;

// ---------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------
const BLD_VERT = /* glsl */`
attribute vec3 aDims; attribute vec4 aStyle;
varying vec2 vUv2; varying vec3 vN; varying vec3 vW; varying vec3 vDims; varying vec4 vStyle; varying float vFace;
void main(){
  vec3 n = normal;
  vec2 fuv;
  #ifdef USE_GEOM_UV
    fuv = vec2(uv.x * aStyle.w, position.y * aDims.y);
    n = normalize(vec3(n.x, n.y * 4.0, n.z));
  #else
    if (abs(n.x) > 0.5) fuv = vec2((position.z + 0.5) * aDims.z, position.y * aDims.y);
    else fuv = vec2((position.x + 0.5) * aDims.x, position.y * aDims.y);
  #endif
  vFace = abs(n.x) > 0.5 ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : (n.z < 0.0 ? 4.0 : 0.0));
  vUv2 = fuv; vDims = aDims; vStyle = aStyle;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BLD_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
varying vec2 vUv2; varying vec3 vN; varying vec3 vW; varying vec3 vDims; varying vec4 vStyle; varying float vFace;
${GLSL_NOISE}
void main(){
  float seed = vStyle.x, lit = vStyle.y, temp = vStyle.z;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  float kind = hash12(vec2(seed, 3.0));          // <0.4 office, <0.8 apartment, else hotel
  bool office = kind < 0.4, apt = kind >= 0.4 && kind < 0.8;
  vec3 col;
  if (N.y > 0.7) {
    col = vec3(0.005, 0.005, 0.006) * (0.7 + 0.6 * vnoise(vW.xz * 0.2));
  } else {
    float floorH = office ? mix(3.6, 4.2, hash12(vec2(seed, 1.0))) : mix(2.9, 3.2, hash12(vec2(seed, 1.0)));
    float winW = office ? mix(1.6, 3.2, hash12(vec2(seed, 2.0))) : mix(1.2, 2.0, hash12(vec2(seed, 2.0)));
    vec2 g = vec2(vUv2.x / winW, (vUv2.y - 0.8) / floorH);
    vec2 id = floor(g); vec2 f = fract(g);
    vec2 fw = fwidth(g);
    float foot = max(fw.x, fw.y);
    bool ribbon = office && hash12(vec2(seed, 5.0)) > 0.5;
    float wx = ribbon ? 1.0 : smoothstep(0.14, 0.14 + fw.x, f.x) * smoothstep(0.86, 0.86 - fw.x, f.x);
    float wy = smoothstep(office ? 0.22 : 0.3, (office ? 0.22 : 0.3) + fw.y, f.y) * smoothstep(0.88, 0.88 - fw.y, f.y);
    float win = wx * wy * step(0.0, g.y);
    float faceSeed = seed * 13.0 + vFace * 3.7;
    float on;
    vec3 wc;
    float inten;
    if (office) {
      float floorOn = step(hash12(vec2(id.y, faceSeed)), lit);
      float seg = step(0.22, hash12(vec2(floor(g.x / 4.0), id.y + faceSeed)));
      on = floorOn * seg;
      wc = mix(vec3(0.78, 0.9, 1.0), vec3(1.0, 0.94, 0.82), step(0.7, hash12(vec2(id.y, seed))));
      inten = 1.1 + 0.6 * hash12(vec2(id.y, seed * 2.0));
    } else {
      on = step(hash12(id + vec2(faceSeed, 7.0)), lit * (apt ? 0.75 : 1.0));
      float tsel = hash12(id * 0.37 + seed);
      wc = mix(vec3(1.0, 0.58, 0.28), vec3(1.0, 0.82, 0.62), tsel);
      wc = mix(wc, vec3(0.85, 0.92, 1.0), step(0.85, tsel));       // TV glow / LED
      inten = 0.5 + 1.3 * hash12(id * 1.31 + seed * 3.0);
      inten *= 0.75 + 0.35 * smoothstep(0.2, 0.9, f.y);              // curtains, ceiling light
    }
    float NoV = max(dot(N, V), 0.0);
    vec3 glass = mix(vec3(0.008, 0.01, 0.016), vec3(0.04, 0.035, 0.05), pow(1.0 - NoV, 3.0));
    vec3 wall = vec3(0.01, 0.0098, 0.0105) * (0.6 + 0.8 * hash12(vec2(seed, 9.0)));
    wall += vec3(0.06, 0.034, 0.016) * exp(-vUv2.y / 9.0);
    vec3 detailed = mix(wall, mix(glass, wc * inten, on), win);
    // Apartment external corridors: a lamp per unit on one face.
    float corridor = 0.0;
    if (apt && mod(vFace, 2.0) < 1.0 && g.y > 0.0) {
      vec2 cf = vec2(fract(vUv2.x / 4.2) - 0.5, f.y - 0.12);
      float unitOn = step(0.28, hash12(vec2(floor(vUv2.x / 4.2), id.y + seed * 7.0)));
      corridor = exp(-dot(cf * vec2(14.0, 22.0), cf * vec2(14.0, 22.0))) * unitOn * (0.55 + 0.45 * hash12(vec2(id.y, seed)));
      detailed = mix(wall * 1.5, detailed, 0.3) + vec3(1.0, 0.9, 0.78) * corridor * 1.8 + vec3(0.025, 0.022, 0.018) * smoothstep(0.2, 0.0, abs(f.y - 0.12));
    }
    // Ground floor shops.
    float shopId = hash12(vec2(floor(vUv2.x / 7.0), seed));
    float shop = step(vUv2.y, 3.6) * step(0.55, shopId) * step(0.6, vUv2.y);
    vec3 shopC = mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.7, 0.4), hash12(vec2(floor(vUv2.x / 7.0), seed + 1.0))) * 2.2;
    detailed = mix(detailed, shopC, shop * 0.9);
    // Distance: expected value of the pattern (prevents shimmering).
    float area = office ? (ribbon ? 0.66 : 0.48) : 0.4;
    vec3 litAvg = office ? vec3(0.85, 0.92, 1.0) * 1.3 * lit * 0.78 : vec3(1.0, 0.68, 0.4) * 1.1 * lit * (apt ? 0.75 : 1.0);
    vec3 avg = mix(wall, glass, area) + litAvg * area + (apt ? vec3(1.0, 0.86, 0.7) * 0.06 : vec3(0.0));
    col = mix(detailed, avg, smoothstep(0.3, 0.9, foot));
    // Crown lighting on some tall towers.
    float crown = step(90.0, vDims.y) * step(0.65, hash12(vec2(seed, 11.0)))
      * smoothstep(vDims.y - 5.0, vDims.y - 4.6, vUv2.y) * (1.0 - smoothstep(vDims.y - 1.4, vDims.y - 1.0, vUv2.y));
    vec3 crownC = mix(vec3(0.35, 0.6, 1.0), vec3(1.0, 0.85, 0.6), hash12(vec2(seed, 12.0))) * 1.6;
    col = mix(col, crownC, crown);
  }
  float fo = 1.0 - exp(-pow(uFogDensity * dist * 0.8, 2.0));
  col = mix(col, uFogColor * vec3(1.25, 1.0, 1.05), fo);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(64.0)), 1.0);
}`;

export function buildingMaterial(geomUV = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    vertexShader: BLD_VERT, fragmentShader: BLD_FRAG,
    defines: geomUV ? { USE_GEOM_UV: '' } : {},
    extensions: { derivatives: true },
  });
}

function buildBuildings(track, index, isWater, quality, area) {
  const rng = mulberry32(777);
  const q = {};
  // Urban intensity peaks around 天神 (s≈5200) and 博多 (s≈7400).
  const centres = [[5100, 0, 1.0], [7400, -250, 0.95], [1600, 150, 0.45], [9300, 0, 0.35], [4400, -300, 0.6]]
    .map(([s, d, w]) => { const p = track.point(s, d); return [p.x, p.z, w]; });
  const urban = (x, z) => {
    let u = 0.18;
    for (const [cx, cz, w] of centres) u += w * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * 900 * 900));
    return Math.min(1, u);
  };
  const list = [];
  const tryPlace = (x, z, far) => {
    if (isWater(x, z)) return;
    index.nearest(x, z, q);
    if (q.s > TUNNEL.s0 - 200 && q.s < TUNNEL.s1 + 150 && Math.abs(q.d + 7) < 350) return; // park hill
    const u = urban(x, z);
    const clear = far ? 120 : 34 + (u > 0.6 ? 0 : 10);
    if (q.dist < clear) return;
    if (rng() > (far ? 0.55 : 0.35 + u * 0.6)) return;
    const hx = rng();
    let h = 9 + Math.pow(hx, 2.2) * (30 + u * 140);
    if (u > 0.7 && rng() < 0.08) h += 60 + rng() * 60;
    const w = 14 + rng() * (18 + u * 22), dpt = 12 + rng() * (16 + u * 18);
    // Align to the course near it, to a city grid farther out.
    const heading = q.dist < 260 ? track.heading(q.s) : (fbm(x * 0.00035 + 3, z * 0.00035 + 3, 3) > 0.5 ? 0.78 : 0.12);
    list.push({ x, z, w, d: dpt, h, rot: heading + (rng() - 0.5) * 0.05, u });
  };
  const near = quality.buildingDensity;
  const cellN = 44 / Math.sqrt(near);
  for (const p of index.pts) {
    if (p.s % 40 !== 0) continue;
    // Corridor: sample a strip of cells across the course on both sides.
    for (let k = -1500; k <= 1500; k += cellN) {
      const jx = (rng() - 0.5) * cellN * 0.8, jz = (rng() - 0.5) * 40 * 0.8;
      tryPlace(p.x + p.lx * k + jx, p.z + p.lz * k + jz, false);
    }
  }
  // Far skyline ring.
  for (let i = 0; i < 2600 * near; i++) {
    const x = area.minX + rng() * area.W, z = area.minZ + rng() * area.H;
    index.nearest(x, z, q);
    if (q.dist < 1500) continue;
    tryPlace(x, z, true);
  }

  const n = list.length;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Drop the bottom face (never visible).
  const idx = geo.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    if (geo.attributes.normal.getY(a) < -0.5) continue;
    keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  geo.setIndex(keep);
  const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), n);
  const dims = new Float32Array(n * 3), style = new Float32Array(n * 4);
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const avPos = [], avSeed = [];
  list.forEach((b, i) => {
    qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
    sc.set(b.w, b.h, b.d); ps.set(b.x, 0, b.z);
    m.compose(ps, qt, sc);
    mesh.setMatrixAt(i, m);
    dims.set([b.w, b.h, b.d], i * 3);
    const lit = rng() < 0.1 ? 0.03 : 0.08 + rng() * rng() * 0.45 + b.u * 0.12;
    style.set([rng() * 100, lit, rng(), 0], i * 4);
    if (b.h > 55) {
      for (const [cx, cz] of [[-0.45, -0.45], [0.45, 0.45], [0.45, -0.45], [-0.45, 0.45]]) {
        const v = new THREE.Vector3(cx * b.w, b.h + 1.2, cz * b.d).applyQuaternion(qt).add(ps);
        avPos.push(v.x, v.y, v.z); avSeed.push(rng());
      }
    }
  });
  geo.setAttribute('aDims', new THREE.InstancedBufferAttribute(dims, 3));
  geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  setLayers(mesh, LAYER.MAIN, LAYER.ENV, LAYER.REFLECT);

  // Blinking red aviation obstruction lights.
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(avPos, 3));
  ag.setAttribute('aSeed', new THREE.Float32BufferAttribute(avSeed, 1));
  const aviation = new THREE.Points(ag, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float blink = step(0.5, fract(uTime * 0.75 + aSeed * 0.3));
        vA = blink;
        gl_PointSize = clamp(uScale * 2.2 / -mv.z, 1.5, 14.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 18.0); gl_FragColor = vec4(vec3(1.0, 0.05, 0.02) * 9.0 * a * vA, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  aviation.frustumCulled = false;
  setLayers(aviation, LAYER.MAIN, LAYER.REFLECT);
  return { mesh, aviation, count: n };
}

// 西公園: wooded hill the tunnel runs under.
function buildHill(track, index) {
  const mid = (TUNNEL.s0 + TUNNEL.s1) / 2;
  const c = track.point(mid, -7);
  const size = 1300, seg = 110;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2).translate(c.x, 0, c.z);
  const pos = geo.attributes.position;
  const q = {};
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    index.nearest(x, z, q);
    const deck = track.heightAt(q.s, -7);
    const ad = Math.abs(q.d + 7);
    const along = q.s < TUNNEL.s0 ? TUNNEL.s0 - q.s : q.s > TUNNEL.s1 ? q.s - TUNNEL.s1 : 0;
    let h = (deck + 13) * Math.exp(-(ad * ad) / (2 * 260 * 260)) * Math.exp(-(along * along) / (2 * 120 * 120));
    h += fbm(x * 0.01, z * 0.01, 4) * 10 * Math.min(1, h / 10);
    if (along > 0 && ad < 24) h = Math.min(h, deck - 2.5);
    pos.setY(i, Math.max(-1, h - 0.5));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b140d, roughness: 1, metalness: 0 });
  const m = new THREE.Mesh(geo, mat);
  setLayers(m, LAYER.MAIN, LAYER.ENV, LAYER.REFLECT);
  return m;
}
