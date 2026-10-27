// Instanced rendering for NPC traffic: every mesh part of a car model becomes one
// InstancedMesh shared by all cars of that model (wheels get per-instance spin), plus
// batched billboard lamp glows, contact shadows and far-distance proxies. This keeps
// the draw-call count flat no matter how many cars are on the road.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER, setLayers, glowTexture, streakTexture, canvasTexture } from './util.js';
import { U } from './lighting.js';

const NEAR_DIST = 115;

function proxyGeometry(meta) {
  const [w, h, l] = meta.size;
  const bw = Math.min(w, 2.0) * 0.98;
  const lower = new THREE.BoxGeometry(bw, h * 0.48, l * 0.97).translate(0, h * 0.32, 0);
  const cabin = new THREE.BoxGeometry(bw * 0.84, h * 0.4, l * 0.5).translate(0, h * 0.74, -l * 0.04);
  return mergeGeometries([lower, cabin]);
}

export class CarBatch {
  constructor(template, max) {
    this.template = template;
    this.max = max;
    this.group = new THREE.Group();
    this.parts = [];
    const root = template.scene;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4();
    root.traverse(o => {
      if (!o.isMesh) return;
      let pivot = null;
      for (let p = o.parent; p; p = p.parent) if (p.name && p.name.startsWith('pivot_')) { pivot = p; break; }
      let local;
      if (pivot) {
        const spin = pivot.children[0];
        local = inv.copy(spin.matrixWorld).invert().multiply(o.matrixWorld).clone();
      } else local = o.matrixWorld.clone();
      let mat = o.material;
      const paint = template.def.paint.test(mat.name || '');
      if (paint) { mat = mat.clone(); mat.color = new THREE.Color(1, 1, 1); }
      const im = new THREE.InstancedMesh(o.geometry, mat, max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (paint) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = o.renderOrder;
      setLayers(im, LAYER.MAIN, LAYER.REFLECT);
      this.group.add(im);
      this.parts.push({
        im, local, paint,
        pivotPos: pivot ? pivot.position.clone() : null,
        front: pivot ? pivot.name.endsWith('FL') || pivot.name.endsWith('FR') : false,
        r: pivot ? (template.meta.wheels[pivot.name.slice(6)]?.r || 0.33) : 0,
      });
    });
    // Far proxy.
    this.proxy = new THREE.InstancedMesh(proxyGeometry(template.meta), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35 }), max);
    this.proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.proxy.frustumCulled = false;
    this.proxy.count = 0;
    setLayers(this.proxy, LAYER.MAIN, LAYER.REFLECT);
    this.group.add(this.proxy);
    this._m = new THREE.Matrix4(); this._w = new THREE.Matrix4(); this._r = new THREE.Matrix4();
  }

  begin() { this.n = 0; this.nf = 0; }

  add(matrix, spin, color, camPos) {
    const dx = matrix.elements[12] - camPos.x, dy = matrix.elements[13] - camPos.y, dz = matrix.elements[14] - camPos.z;
    if (dx * dx + dy * dy + dz * dz > NEAR_DIST * NEAR_DIST) {
      if (this.nf < this.max) { this.proxy.setMatrixAt(this.nf, matrix); this.proxy.setColorAt(this.nf, color); this.nf++; }
      return;
    }
    if (this.n >= this.max) return;
    const i = this.n++;
    for (const p of this.parts) {
      if (p.pivotPos) {
        this._r.makeRotationX(spin / p.r);
        this._w.makeTranslation(p.pivotPos.x, p.pivotPos.y, p.pivotPos.z).multiply(this._r).multiply(p.local);
        this._m.multiplyMatrices(matrix, this._w);
      } else this._m.multiplyMatrices(matrix, p.local);
      p.im.setMatrixAt(i, this._m);
      if (p.paint) p.im.setColorAt(i, color);
    }
  }

  end() {
    for (const p of this.parts) {
      p.im.count = this.n;
      p.im.instanceMatrix.needsUpdate = true;
      if (p.paint) p.im.instanceColor.needsUpdate = true;
    }
    this.proxy.count = this.nf;
    this.proxy.instanceMatrix.needsUpdate = true;
    this.proxy.instanceColor.needsUpdate = true;
  }
}

const GLOW_VERT = /* glsl */`
attribute vec4 aGlow;   // xyz world position, w size
attribute vec4 aCol;    // rgb HDR colour, a stretch (x scale factor)
varying vec2 vUv; varying vec3 vCol; varying float vFog;
uniform float uFogDensity;
void main(){
  vUv = uv;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = aGlow.xyz + (right * position.x * aCol.a + up * position.y) * aGlow.w;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.0);
  vFog = exp(-pow(uFogDensity * dist, 2.0));
  vCol = aCol.rgb;
  // Keep distant lamps at least ~1.5px so they read as points of light.
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying vec3 vCol; varying float vFog;
void main(){ float a = texture2D(uMap, vUv).a; gl_FragColor = vec4(vCol * a * vFog, 1.0); }`;

/** Batched billboard glows (one draw per texture). */
export class GlowBatch {
  constructor(max, texture, layers = [LAYER.MAIN, LAYER.REFLECT]) {
    this.max = max;
    // InstancedMesh (instance matrices unused) so per-instance attributes bind reliably.
    const g = new THREE.PlaneGeometry(1, 1);
    this.pos = new Float32Array(max * 4); this.col = new Float32Array(max * 4);
    g.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uFogDensity: U.uFogDensity },
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    setLayers(this.mesh, ...layers);
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, r, g, b, stretch = 1) {
    if (this.n >= this.max) return;
    const i = this.n++ * 4;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z; this.pos[i + 3] = size;
    this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b; this.col[i + 3] = stretch;
  }
  end() {
    this.mesh.count = this.n;
    this.geo.attributes.aGlow.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
}

let _shadowTex;
export function shadowTex() {
  if (_shadowTex) return _shadowTex;
  _shadowTex = canvasTexture(128, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.55);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
  return _shadowTex;
}

/** All NPC visuals: per-model batches + lamp glows + shadows. */
export class TrafficRenderer {
  constructor(scene, templates, max) {
    this.batches = new Map();
    for (const t of templates) {
      const b = new CarBatch(t, max);
      this.batches.set(t.id, b);
      scene.add(b.group);
    }
    this.glow = new GlowBatch(max * 6, glowTexture());
    this.streak = new GlowBatch(max * 2, streakTexture(), [LAYER.MAIN]);
    scene.add(this.glow.mesh, this.streak.mesh);
    const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.maxShadows = max;
    this.shadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex(), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), max);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    setLayers(this.shadow, LAYER.MAIN);
    scene.add(this.shadow);
    this._s = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  begin() {
    for (const b of this.batches.values()) b.begin();
    this.glow.begin(); this.streak.begin();
    this.ns = 0;
  }

  /** c: {template, matrix, spin, color, brake, blink, blinkRight, oncoming} */
  add(c, camera) {
    const b = this.batches.get(c.template.id);
    b.add(c.matrix, c.spin, c.color, camera.position);
    const m = c.matrix.elements;
    const meta = c.template.meta;
    // Contact shadow.
    if (this.ns < this.maxShadows) {
      const [w, , l] = meta.size;
      this._s.copy(c.matrix).multiply(new THREE.Matrix4().makeScale(Math.min(w, 2.1) + 0.5, 1, l + 0.7));
      this._s.elements[13] += 0.03;
      this.shadow.setMatrixAt(this.ns++, this._s);
    }
    // Facing factor for headlights.
    const cx = camera.position.x - m[12], cy = camera.position.y - m[13], cz = camera.position.z - m[14];
    const cl = Math.hypot(cx, cy, cz) || 1;
    const facing = Math.max(0, Math.min(1, ((m[8] * cx + m[9] * cy + m[10] * cz) / cl - 0.05) / 0.5));
    const back = Math.max(0, Math.min(1, ((-m[8] * cx - m[9] * cy - m[10] * cz) / cl + 0.3) / 0.5));
    const v = this._v;
    for (let k = 0; k < meta.lights.tail.length; k++) {
      const t = meta.lights.tail[k];
      v.set(t[0], t[1], t[2] - 0.05).applyMatrix4(c.matrix);
      const blinkOn = c.blink > 0 && ((k === 1) === c.blinkRight) && (c.blink * 2.5) % 1 < 0.5;
      const br = 1.3 + c.brake * 3.0;
      if (blinkOn) this.glow.add(v.x, v.y, v.z, 0.75, 3.2, 1.3, 0.06);
      else this.glow.add(v.x, v.y, v.z, 0.5 + c.brake * 0.2, br * (0.35 + 0.65 * back), 0.045 * br, 0.03 * br);
    }
    if (facing > 0.01) {
      for (const h of meta.lights.head) {
        v.set(h[0], h[1], h[2] + 0.1).applyMatrix4(c.matrix);
        this.glow.add(v.x, v.y, v.z, 0.95 * facing, 2.6 * facing, 2.5 * facing, 2.2 * facing);
        this.streak.add(v.x, v.y, v.z, 0.26 * facing, 0.55 * facing, 0.6 * facing, 0.7 * facing, 9 * facing);
      }
    }
  }

  end() {
    for (const b of this.batches.values()) b.end();
    this.glow.end(); this.streak.end();
    this.shadow.count = this.ns;
    this.shadow.instanceMatrix.needsUpdate = true;
  }
}
