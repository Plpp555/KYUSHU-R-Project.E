// Custom shaders for the expressway: wet asphalt deck with procedural markings and
// planar reflections, and the concrete / tile / metal surfaces around it.
import * as THREE from 'three';
import { U, GLSL_TRACK_LIGHT } from './lighting.js';

const VERT = /* glsl */`
attribute vec3 aTrack;   // s, d, h
attribute vec3 aF;       // track forward
attribute vec3 aL;       // track left
varying vec3 vWorld; varying vec3 vTrack; varying vec3 vF; varying vec3 vL; varying vec3 vN;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vTrack = aTrack; vF = aF; vL = aL;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const BUMP = /* glsl */`
vec3 perturbN(vec3 pos, vec3 n, float H){
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(H), dFdy(H));
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}
float lineMask(float x, float w){ float fw = fwidth(x) * 1.0 + 1e-4; return 1.0 - smoothstep(w*0.5 - fw, w*0.5 + fw, abs(x)); }
`;

const ROAD_FRAG = /* glsl */`
${GLSL_TRACK_LIGHT}
${BUMP}
uniform sampler2D uReflTex; uniform mat4 uReflMat; uniform float uReflOn;
uniform vec3 uEnvTint;
varying vec3 vWorld; varying vec3 vTrack; varying vec3 vF; varying vec3 vL; varying vec3 vN;
#include <logdepthbuf_pars_fragment>

float dash(float s, float on, float period){
  float m = mod(s, period);
  float fw = fwidth(s) + 1e-3;
  return smoothstep(-fw, fw, m) * (1.0 - smoothstep(on - fw, on + fw, m));
}

void main(){
  #include <logdepthbuf_fragment>
  float s = vTrack.x, d = vTrack.y;
  bool oncoming = d < -7.25;
  float dd = oncoming ? -(d + 14.5) : d;     // carriageway-local lateral (mirrored for oncoming)
  float medianM = (1.0 - smoothstep(-6.3, -6.2, d)) * smoothstep(-8.3, -8.2, d);
  float dist = length(vWorld - cameraPosition);
  float detail = 1.0 - smoothstep(25.0, 140.0, dist);

  vec2 ap = vec2(d, s);
  float n1 = vnoise(ap * 11.0);
  float n2 = fbm3(ap * vec2(1.1, 0.45));
  float n3 = fbm3(ap * vec2(0.06, 0.018) + 7.0);
  float patchM = smoothstep(0.62, 0.66, fbm3(vec2(d * 0.03, s * 0.004) + 3.0));
  vec3 albedo = vec3(0.06, 0.061, 0.066) * (0.72 + 0.3 * mix(0.5, n1, detail) + 0.3 * n2) * (0.8 + 0.4 * n3);
  albedo *= mix(1.0, 0.7, patchM);

  // Wheel paths: polished, slightly rutted (holds water).
  float lc = dd - 3.5 * floor(dd / 3.5 + 0.5);
  float wheel = smoothstep(0.55, 0.0, abs(abs(lc) - 0.85));

  // Markings: solid edge lines, 8m/12m dashed lane lines.
  float m = lineMask(dd - 5.3, 0.2) + lineMask(dd + 5.3, 0.2);
  m += (lineMask(dd - 1.75, 0.15) + lineMask(dd + 1.75, 0.15)) * dash(s + (oncoming ? 7.0 : 0.0), 8.0, 20.0);
  m = clamp(m, 0.0, 1.0) * (1.0 - medianM) * (0.78 + 0.22 * n2);

  // Expansion joints at each pier (steel finger joints).
  float joint = lineMask(mod(s - 6.0, 36.0) - 18.0, 0.32) * (1.0 - medianM);

  // Water: puddles from low-frequency noise + ruts.
  float puddle = smoothstep(0.46, 0.64, fbm(vec2(d * 0.21, s * 0.05) + 13.7) + wheel * 0.14);
  float wet = clamp(uWet * (0.6 + 0.4 * puddle), 0.0, 1.0);
  float rough = mix(0.86, 0.36, uWet);
  rough = mix(rough, 0.045, puddle * uWet);
  rough = mix(rough, rough * 0.8, wheel);
  rough = mix(rough, 0.5, m * 0.7);
  rough = mix(rough, 0.28, joint);

  albedo = mix(albedo, vec3(0.58, 0.58, 0.55), m);
  albedo = mix(albedo, vec3(0.16, 0.16, 0.16), medianM);
  albedo = mix(albedo, vec3(0.32, 0.32, 0.34), joint);
  albedo *= mix(1.0, 0.62, wet * (1.0 - 0.6 * m));

  vec3 N = normalize(vN);
  float H = (n1 * 0.004 * detail + n2 * 0.006) * (1.0 - puddle * uWet * 0.95) + m * 0.0015;
  // Rain ripples on the puddles.
  if (uRain > 0.01) {
    vec2 rp = vec2(d, s) * 1.3;
    vec2 cell = floor(rp); vec2 fr = fract(rp) - 0.5;
    float ph = fract(uTime * 1.3 + hash12(cell));
    float ring = sin((length(fr - (hash22(cell) - 0.5) * 0.6) - ph * 0.5) * 60.0) * (1.0 - ph) * smoothstep(0.5, 0.0, length(fr));
    H += ring * 0.0025 * uRain * puddle * detail;
  }
  N = perturbN(vWorld, N, H);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 Up = normalize(cross(vF, vL));
  float f0 = mix(0.04, 0.6, joint);
  vec3 col = ambientLight(N, albedo);
  col += trackLamps(vWorld, N, V, albedo, rough, f0, s, d, 0.0, vF, vL, Up);
  float headLit;
  col += carLights(vWorld, N, V, albedo, rough, f0, headLit);
  // Retro-reflective paint glows in headlights.
  col += m * headLit * vec3(1.0, 0.96, 0.88) * 2.2;

  float NoV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  float reflAmt = F * wet * mix(0.6, 1.0, puddle) * (1.0 - rough * 0.6);
  if (uReflOn > 0.5) {
    vec4 rc = uReflMat * vec4(vWorld, 1.0);
    vec2 ruv = rc.xy / rc.w;
    ruv += (N.xz - Up.xz) * 0.35;
    float lod = clamp(rough * 7.5, 0.0, 6.0);
    vec3 refl = vec3(0.0); float wsum = 0.0;
    // Vertical streaking (light smearing on wet asphalt).
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float w = exp(-fi * 0.6);
      refl += textureLod(uReflTex, ruv + vec2(0.0, -fi * (0.004 + rough * 0.018)), lod).rgb * w;
      wsum += w;
    }
    refl /= wsum;
    col = col * (1.0 - reflAmt * 0.5) + refl * reflAmt;
  } else {
    col += uEnvTint * reflAmt;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

// Surface types: 0 concrete parapet, 1 tunnel, 2 sound wall, 3 deck underside/fascia, 4 median barrier
const SURF_FRAG = /* glsl */`
${GLSL_TRACK_LIGHT}
${BUMP}
uniform int uType;
varying vec3 vWorld; varying vec3 vTrack; varying vec3 vF; varying vec3 vL; varying vec3 vN;
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  float s = vTrack.x, d = vTrack.y, h = vTrack.z;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float dist = length(vWorld - cameraPosition);
  float detail = 1.0 - smoothstep(20.0, 120.0, dist);
  vec3 albedo; float rough = 0.85; float f0 = 0.04; float H = 0.0;
  vec3 emit = vec3(0.0);
  if (uType == 1) {
    // Tunnel: glossy tiles up to 3.2m, painted concrete above.
    vec2 tp = vec2(s / 0.3, h / 0.15);
    float grout = max(lineMask(fract(tp.x) - 0.5, 0.06) * 0.0, 0.0);
    vec2 g = abs(fract(vec2(s / 0.6, h / 0.3)) - 0.5);
    float gr = 1.0 - smoothstep(0.44, 0.48, max(g.x, g.y));
    bool tiles = h < 3.2;
    float dirt = fbm3(vec2(s * 0.08, h * 0.6)) * 0.5 + smoothstep(1.0, 0.0, h) * 0.4;
    albedo = tiles ? mix(vec3(0.55, 0.56, 0.55), vec3(0.3, 0.3, 0.28), dirt) * mix(0.6, 1.0, gr) : vec3(0.08, 0.08, 0.085) * (0.8 + 0.4 * fbm3(vec2(s, h) * 0.5));
    rough = tiles ? mix(0.5, 0.18, gr) : 0.9;
    // Coloured guide stripe at eye level.
    float stripe = smoothstep(1.05, 1.08, h) * (1.0 - smoothstep(1.32, 1.35, h));
    albedo = mix(albedo, vec3(0.45, 0.25, 0.05), stripe * (tiles ? 1.0 : 0.0));
    H = (1.0 - gr) * -0.002 * detail;
  } else if (uType == 2) {
    // Sound wall: ribbed metal panels between H-posts every 2m.
    float px = mod(s, 2.0);
    float post = lineMask(px - 1.0, 0.18);
    float rib = sin(s * 3.14159 * 8.0);
    albedo = mix(vec3(0.17, 0.19, 0.2), vec3(0.08, 0.085, 0.09), post);
    albedo *= 0.85 + 0.25 * fbm3(vec2(s * 0.1, h * 0.8));
    rough = mix(0.55, 0.4, post);
    f0 = 0.08;
    H = rib * 0.0012 * detail * (1.0 - post);
    // Top lip highlight
    albedo = mix(albedo, vec3(0.3), smoothstep(3.45, 3.5, h));
  } else {
    float streaks = fbm3(vec2(s * 0.7, h * 0.12)) * 0.6 + fbm3(vec2(s * 0.05, h)) * 0.4;
    float grime = smoothstep(0.6, -0.3, h) * 0.5;
    albedo = vec3(0.17, 0.17, 0.165) * (0.55 + 0.7 * streaks) * (1.0 - grime);
    if (uType == 3) albedo *= 0.65;
    rough = 0.88;
    H = vnoise(vec2(s, h) * 9.0) * 0.003 * detail;
    // Wet lower part reflects a bit.
    rough = mix(rough, 0.45, uWet * smoothstep(0.35, 0.0, h) * (uType == 3 ? 0.0 : 1.0));
  }
  N = perturbN(vWorld, N, H);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 Up = normalize(cross(vF, vL));
  vec3 col = ambientLight(N, albedo);
  col += trackLamps(vWorld, N, V, albedo, rough, f0, s, d, h, vF, vL, Up);
  float headLit;
  col += carLights(vWorld, N, V, albedo, rough, f0, headLit);
  col += emit;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeRoadMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: VERT,
    fragmentShader: ROAD_FRAG,
    extensions: { derivatives: true },
  });
}

const surfCache = {};
export function makeSurfaceMaterial(type) {
  if (surfCache[type]) return surfCache[type];
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uType: { value: type } },
    vertexShader: VERT,
    fragmentShader: SURF_FRAG,
    side: type === 1 || type === 2 ? THREE.DoubleSide : THREE.FrontSide,
  });
  surfCache[type] = m;
  return m;
}
