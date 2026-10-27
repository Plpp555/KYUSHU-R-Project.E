// Particle effects: wall-scrape sparks, exhaust afterfire, and road spray from wet tyres.
import * as THREE from 'three';
import { LAYER, setLayers, glowTexture } from './util.js';

const SPARK_VERT = /* glsl */`
attribute float aLife; attribute vec3 aColor; varying float vLife; varying vec3 vColor;
void main(){ vLife = aLife; vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(260.0 * aLife / -mv.z, 1.0, 22.0); gl_Position = projectionMatrix * mv; }`;
const SPARK_FRAG = /* glsl */`
varying float vLife; varying vec3 vColor;
void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 14.0) * vLife; if (vLife <= 0.0) discard; gl_FragColor = vec4(vColor * a, 1.0); }`;

class PointPool {
  constructor(n, { additive = true } = {}) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.decay = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    setLayers(this.points, LAYER.MAIN);
    this.next = 0;
  }
  emit(p, v, color, life = 1, decay = 2, drag = 1, grav = 9.8) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life; this.decay[i] = decay; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= this.decay[i] * dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.sparks = new PointPool(400);
    this.spray = new PointPool(500, { additive: true });
    scene.add(this.sparks.points, this.spray.points);
    this.flames = [];
    const flameMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(3.5, 1.4, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(flameMat.clone());
      s.visible = false;
      setLayers(s, LAYER.MAIN, LAYER.REFLECT);
      scene.add(s);
      this.flames.push({ s, t: 0 });
    }
    this._v = new THREE.Vector3(); this._c = new THREE.Color();
  }

  sparksAt(p, dir, speed, n = 6) {
    for (let i = 0; i < n; i++) {
      this._v.set(dir.x * speed * (0.4 + Math.random() * 0.6) + (Math.random() - 0.5) * 6,
        Math.random() * 4 + 1, dir.z * speed * (0.4 + Math.random() * 0.6) + (Math.random() - 0.5) * 6);
      this._c.setRGB(4, 1.8 + Math.random(), 0.4).multiplyScalar(1.5);
      this.sparks.emit(p, this._v, this._c, 1, 1.6 + Math.random() * 1.5, 0.8, 9.8);
    }
  }

  /** Mist kicked up by tyres on the wet deck (lit faintly by lamps). */
  sprayAt(p, vel, amount, tint) {
    for (let i = 0; i < amount; i++) {
      this._v.set(vel.x * 0.5 + (Math.random() - 0.5) * 3, Math.random() * 1.6 + 0.3, vel.z * 0.5 + (Math.random() - 0.5) * 3);
      this._c.copy(tint).multiplyScalar(0.06 + Math.random() * 0.05);
      this.spray.emit(p, this._v, this._c, 0.8, 1.3 + Math.random(), 2.2, 2.5);
    }
  }

  flame(p, scale = 1, blue = false) {
    const f = this.flames.find(x => x.t <= 0) || this.flames[0];
    f.t = 0.09 + Math.random() * 0.05;
    f.s.position.copy(p);
    f.s.scale.setScalar((0.5 + Math.random() * 0.4) * scale);
    f.s.material.color.setRGB(blue ? 1.2 : 4, blue ? 1.6 : 1.5, blue ? 4 : 0.4);
    f.s.visible = true;
  }

  update(dt) {
    this.sparks.update(dt);
    this.spray.update(dt);
    for (const f of this.flames) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; } }
  }
}
