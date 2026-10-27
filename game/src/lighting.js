// Shared lighting state for the custom track shaders (road deck, parapets, tunnel)
// and helpers to keep three.js lit materials (cars, piers) consistent with it.
//
// Street lamps are periodic along the track, so the shaders evaluate the nearest
// lamps analytically from track coordinates (s, d) instead of using real lights.
// Car headlights / tail lights are fed in as small uniform arrays every frame.
import * as THREE from 'three';
import { TUNNEL } from './course.js';
import { GLSL_NOISE } from './util.js';

export const MAX_SPOTS = 6;
export const MAX_POINTS = 10;

export const LAMP = {
  spacing: 36,
  offset: 12,
  rows: [-4.1, -10.4],     // lamp head lateral offsets (median twin-arm poles)
  poleD: -7.25,
  height: 10.6,
  color: new THREE.Color(1.0, 0.78, 0.52),
  intensity: 950,
  tunnelSpacing: 6,
  tunnelRows: [4.6, -4.6],
  tunnelHeight: 5.3,
  tunnelColor: new THREE.Color(1.0, 0.52, 0.16),
  tunnelIntensity: 85,
};

const vec3s = n => Array.from({ length: n }, () => new THREE.Vector3());

export const U = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0.022, 0.021, 0.036) },
  uFogDensity: { value: 0.0016 },
  uWet: { value: 0.85 },
  uRain: { value: 0 },
  uSkyAmb: { value: new THREE.Color(0.018, 0.024, 0.045) },
  uGroundAmb: { value: new THREE.Color(0.05, 0.03, 0.018) },
  uLampSpacing: { value: LAMP.spacing },
  uLampOffset: { value: LAMP.offset },
  uLampRows: { value: new THREE.Vector2(...LAMP.rows) },
  uLampH: { value: LAMP.height },
  uLampCol: { value: LAMP.color.clone().multiplyScalar(LAMP.intensity) },
  uTunnel: { value: new THREE.Vector2(TUNNEL.s0, TUNNEL.s1) },
  uTunnelCol: { value: LAMP.tunnelColor.clone().multiplyScalar(LAMP.tunnelIntensity) },
  uSpotPos: { value: vec3s(MAX_SPOTS) },
  uSpotDir: { value: vec3s(MAX_SPOTS) },
  uSpotCol: { value: vec3s(MAX_SPOTS) },
  uPtPos: { value: vec3s(MAX_POINTS) },
  uPtCol: { value: vec3s(MAX_POINTS) },
  uReflTex: { value: null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uEnvTint: { value: new THREE.Color(0.03, 0.035, 0.06) },
};

export const GLSL_TRACK_LIGHT = /* glsl */`
#define PI 3.14159265
uniform float uTime;
uniform vec3 uFogColor; uniform float uFogDensity;
uniform float uWet; uniform float uRain;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb;
uniform float uLampSpacing; uniform float uLampOffset; uniform vec2 uLampRows; uniform float uLampH; uniform vec3 uLampCol;
uniform vec2 uTunnel; uniform vec3 uTunnelCol;
uniform vec3 uSpotPos[${MAX_SPOTS}]; uniform vec3 uSpotDir[${MAX_SPOTS}]; uniform vec3 uSpotCol[${MAX_SPOTS}];
uniform vec3 uPtPos[${MAX_POINTS}]; uniform vec3 uPtCol[${MAX_POINTS}];
${GLSL_NOISE}

float D_GGX(float a, float NoH){ float a2 = a*a; float d = NoH*NoH*(a2-1.0)+1.0; return a2/(PI*d*d + 1e-6); }
float V_Smith(float a, float NoV, float NoL){ float k = a*0.5; return 0.25/((NoV*(1.0-k)+k)*(NoL*(1.0-k)+k)); }

// Diffuse + GGX specular from a point light at Lp.
vec3 brdfLight(vec3 P, vec3 N, vec3 V, vec3 Lp, vec3 col, vec3 albedo, float rough, float f0){
  vec3 Lv = Lp - P; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float NoL = max(dot(N, L), 0.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  float NoH = max(dot(N, H), 0.0), NoV = max(dot(N, V), 1e-3);
  float a = max(rough*rough, 0.012);   // punctual lights: avoid razor-thin, ultra-bright highlights
  float F = f0 + (1.0-f0)*pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
  float spec = D_GGX(a, NoH) * V_Smith(a, NoV, NoL) * F;
  return col * NoL * (albedo / PI + spec) / (d2 + 0.6);
}

// Street lamps + tunnel lamps around (s,d,h) in the local track frame (F,L,Up).
vec3 trackLamps(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float f0, float s, float d, float h, vec3 F, vec3 L, vec3 Up){
  vec3 sum = vec3(0.0);
  bool tunnel = s > uTunnel.x && s < uTunnel.y;
  if (tunnel) {
    float sp = 6.0;
    float base = floor(s / sp + 0.5) * sp;
    for (int k = -2; k <= 2; k++) {
      float sk = base + float(k) * sp;
      for (int r = 0; r < 2; r++) {
        float dl = r == 0 ? 4.6 : -4.6;
        vec3 Lp = P + F*(sk - s) + L*(dl - d) + Up*(5.3 - h);
        sum += brdfLight(P, N, V, Lp, uTunnelCol, albedo, rough, f0);
      }
    }
  } else {
    float sp = uLampSpacing;
    float base = floor((s - uLampOffset) / sp + 0.5) * sp + uLampOffset;
    for (int k = -1; k <= 1; k++) {
      float sk = base + float(k) * sp;
      if (sk > uTunnel.x - 4.0 && sk < uTunnel.y + 4.0) continue;
      for (int r = 0; r < 2; r++) {
        float dl = r == 0 ? uLampRows.x : uLampRows.y;
        vec3 Lv = F*(sk - s) + L*(dl - d) + Up*(uLampH - h);
        vec3 Ld = normalize(Lv);
        // Cut-off luminaire: mostly downward, soft wide spread.
        float distrib = 0.1 + 0.9 * pow(clamp(dot(Ld, Up), 0.0, 1.0), 3.0);
        sum += brdfLight(P, N, V, P + Lv, uLampCol * distrib, albedo, rough, f0);
      }
    }
  }
  return sum;
}

vec3 carLights(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float f0, out float headLit){
  vec3 sum = vec3(0.0);
  headLit = 0.0;
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    vec3 Lv = uSpotPos[i] - P; float d2 = dot(Lv, Lv);
    if (!(d2 < 40000.0) || dot(uSpotCol[i], uSpotCol[i]) < 1e-4) continue;
    vec3 L = Lv * inversesqrt(d2);
    float c = dot(-L, uSpotDir[i]);
    float cone = smoothstep(0.86, 0.985, c) * 0.85 + smoothstep(0.6, 0.9, c) * 0.15;
    // Low-beam cut-off: less light above the horizon line of the lamp.
    float cut = smoothstep(-0.02, 0.08, -Lv.y * inversesqrt(d2));
    vec3 col = uSpotCol[i] * cone * mix(1.0, 0.35, cut);
    sum += brdfLight(P, N, V, uSpotPos[i], col, albedo, rough, f0);
    headLit += cone / (d2 * 0.002 + 1.0) * max(dot(N, L), 0.0);
  }
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    vec3 Lv = uPtPos[i] - P; float d2 = dot(Lv, Lv);
    if (!(d2 < 144.0)) continue;
    float fade = 1.0 - smoothstep(30.0, 144.0, d2);
    sum += brdfLight(P, N, V, uPtPos[i], uPtCol[i] * fade, albedo, rough, f0);
  }
  return sum;
}

vec3 ambientLight(vec3 N, vec3 albedo){
  return albedo * mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
}

vec3 applyFog(vec3 col, vec3 P){
  float dist = length(P - cameraPosition);
  float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  // Low-lying haze glows a little warmer (city light).
  vec3 fc = mix(uFogColor * vec3(1.25, 1.0, 0.85), uFogColor, smoothstep(0.0, 80.0, P.y));
  return mix(col, fc, f);
}
`;

/** Pushes the frame's car lights into the shared uniforms. */
export function setCarLights(spots, points) {
  for (let i = 0; i < MAX_SPOTS; i++) {
    const s = spots[i];
    if (s) {
      U.uSpotPos.value[i].copy(s.pos); U.uSpotDir.value[i].copy(s.dir); U.uSpotCol.value[i].set(s.col.r, s.col.g, s.col.b);
    } else U.uSpotCol.value[i].set(0, 0, 0);
  }
  for (let i = 0; i < MAX_POINTS; i++) {
    const p = points[i];
    if (p) { U.uPtPos.value[i].copy(p.pos); U.uPtCol.value[i].set(p.col.r, p.col.g, p.col.b); }
    else U.uPtCol.value[i].set(0, 0, 0);
  }
}
