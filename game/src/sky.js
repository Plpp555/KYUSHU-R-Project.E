// Night sky dome: light-polluted horizon, city-lit clouds, sparse stars and the moon.
import * as THREE from 'three';
import { GLSL_NOISE, LAYER, setLayers } from './util.js';

export const MOON_DIR = new THREE.Vector3(-0.45, 0.42, 0.78).normalize();

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: MOON_DIR },
      uGlowDir: { value: new THREE.Vector3(0.6, 0, 0.8).normalize() },
      uCloud: { value: 0.65 },
      uMoonVis: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 4000.0, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoonDir; uniform vec3 uGlowDir; uniform float uCloud; uniform float uMoonVis;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float h = max(y, 0.0);
        // Base gradient (zenith -> horizon), with orange/purple light pollution.
        vec3 zen = vec3(0.004, 0.006, 0.016);
        vec3 mid = vec3(0.014, 0.017, 0.04);
        vec3 hor = vec3(0.11, 0.065, 0.075);
        float towardCity = 0.55 + 0.45 * dot(normalize(vec3(d.x, 0.0, d.z)), uGlowDir);
        vec3 col = mix(mid, zen, smoothstep(0.0, 0.7, h));
        col = mix(col, hor * (0.6 + 0.6 * towardCity), exp(-h * 9.0));
        col += vec3(0.05, 0.022, 0.012) * exp(-h * 28.0) * towardCity;
        // Below the horizon: dark haze.
        if (y < 0.0) col = mix(hor * 0.6, vec3(0.015, 0.014, 0.02), 1.0 - smoothstep(-0.25, 0.0, y));

        // Stars (few, it is a city), hidden by clouds.
        vec3 sd = d * 420.0;
        vec3 cell = floor(sd);
        float star = hash13(cell);
        float sb = smoothstep(0.9975, 1.0, star) * smoothstep(0.05, 0.4, h);
        vec3 fp = fract(sd) - 0.5;
        sb *= (1.0 - smoothstep(0.0, 0.35, length(fp))) * (0.6 + 0.4 * sin(uTime * 3.0 + star * 90.0));

        // Moon.
        float md = dot(d, uMoonDir);
        float disc = smoothstep(0.99986, 0.99991, md) * uMoonVis;
        float halo = (pow(max(md, 0.0), 260.0) * 0.35 + pow(max(md, 0.0), 18.0) * 0.04) * mix(0.35, 1.0, uMoonVis);
        vec2 mp = (d - uMoonDir * md).xy * 900.0;
        float maria = 0.75 + 0.25 * vnoise(mp * 0.6 + 4.0);

        // Clouds lit from below by the city.
        vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
        float c = fbm(cp) * 0.75 + fbm(cp * 3.1 + 9.0) * 0.25;
        float cov = smoothstep(0.62 - uCloud * 0.3, 0.92 - uCloud * 0.2, c) * smoothstep(-0.02, 0.12, y);
        vec3 cloudCol = mix(vec3(0.07, 0.045, 0.05), vec3(0.02, 0.022, 0.035), smoothstep(0.0, 0.5, h)) * (0.8 + 0.6 * towardCity);
        cloudCol += vec3(0.25, 0.27, 0.32) * halo * 3.0;

        vec3 sky = col + vec3(sb) * 1.2 + vec3(1.6, 1.55, 1.4) * disc * maria * 1.5 + vec3(0.6, 0.62, 0.7) * halo;
        sky = mix(sky, cloudCol, cov * 0.9);
        gl_FragColor = vec4(sky, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  setLayers(mesh, LAYER.MAIN, LAYER.ENV, LAYER.REFLECT, LAYER.WATER);
  return mesh;
}
