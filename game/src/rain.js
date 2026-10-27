// Rain: thousands of streaks animated entirely on the GPU. Drops are anchored in world
// space (wrapped in a box around the camera), so driving through them gives correct
// parallax, and each streak is stretched along the drop's velocity relative to the camera.
import * as THREE from 'three';
import { LAYER, setLayers } from './util.js';

export class Rain {
  constructor(count = 7000) {
    const g = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    this.uniforms = {
      uTime: { value: 0 }, uCamVel: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(46, 26, 46) },
      uSpeed: { value: 11 }, uIntensity: { value: 0 },
    };
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime; uniform vec3 uCamVel; uniform vec3 uBox; uniform float uSpeed;
        varying vec2 vUv; varying float vFade;
        void main(){
          vUv = uv;
          vec3 p = aSeed * uBox * 7.0;
          p.y -= uTime * uSpeed * (0.85 + aSeed.x * 0.3);
          p.x += uTime * 1.2;
          vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 center = cameraPosition + rel;
          vec3 vel = vec3(1.2, -uSpeed, 0.3) - uCamVel;
          float len = clamp(length(vel) * 0.02, 0.3, 2.4);
          vec3 dir = normalize(vel);
          vec3 toCam = normalize(cameraPosition - center);
          vec3 side = normalize(cross(dir, toCam)) * 0.02;
          vec3 pos = center - dir * position.y * len + side * position.x;
          float r = length(rel);
          vFade = smoothstep(0.8, 3.5, r) * (1.0 - smoothstep(13.0, 21.0, r));
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uIntensity; varying vec2 vUv; varying float vFade;
        void main(){
          float w = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float l = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(0.7, 0.75, 0.85) * w * l * vFade * uIntensity, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    setLayers(this.mesh, LAYER.MAIN);
    this.last = new THREE.Vector3();
    this.vel = new THREE.Vector3();
  }

  setIntensity(k) {
    this.uniforms.uIntensity.value = k;
    this.mesh.visible = k > 0;
  }

  update(dt, camera) {
    if (!this.mesh.visible || dt <= 0) { this.last.copy(camera.position); return; }
    this.uniforms.uTime.value += dt;
    const v = this.vel.copy(camera.position).sub(this.last).divideScalar(dt);
    if (v.lengthSq() > 200 * 200) v.set(0, 0, 0);   // teleport (camera cut)
    this.uniforms.uCamVel.value.lerp(v, 0.25);
    this.last.copy(camera.position);
  }
}
