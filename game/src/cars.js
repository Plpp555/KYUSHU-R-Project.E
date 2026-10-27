// Car models: loading, material upgrades (clear-coat paint, glass, emissive lamps),
// wheel pivots (spin + steer), glow sprites and the contact shadow.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LAYER, setLayers, glowTexture, streakTexture, canvasTexture } from './util.js';

export const CAR_DEFS = {
  porsche930: {
    file: 'models/porsche930.glb', name: 'PORSCHE 911 TURBO (930)',
    paint: /^Material\.001$/, glass: /^Material\.(013|014|010|011|012)$/, head: /^Material\.013$/, tail: /^Material\.006$/,
    paintTune: { metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 },
  },
  countach: {
    file: 'models/countach.glb', name: 'LAMBORGHINI COUNTACH LPI 800-4',
    paint: /^Material\.012$/, glass: /^Material\.(004|008)$/, head: /^Material\.005$/, tail: /^Material\.009$/,
    paintTune: { metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03 },
  },
  integra: {
    file: 'models/integra.glb', name: 'HONDA INTEGRA TYPE R (DB8)',
    paint: /^(paint|logo_paint)$/, glass: /^(glass|glasslight|taillights)$/, head: /^glasslight$/, tail: /^taillights$/,
    paintTune: { metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 },
  },
  rav4: {
    file: 'models/rav4.glb', name: 'TOYOTA RAV4 HYBRID',
    paint: /^Tdummy_material_0_085$|^Color_2$/, glass: /^(glass_D|red_glass|Tdummy_material_3_012)$/, head: /^Tdummy_material_2_027$/, tail: /^red_glass$/,
    paintTune: { metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 },
  },
  townace: {
    file: 'models/townace.glb', name: 'TOYOTA TOWNACE GL',
    paint: /^Material$/, glass: /^Material\.004$/, head: /^Material\.006$/, tail: /^Material\.002$/,
    paintTune: { metalness: 0.2, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.08 },
  },
};

export const NPC_COLORS = [0xf2f2f0, 0xe8e8e8, 0x1a1a1c, 0x9aa0a6, 0x2b3a55, 0x7a1418, 0xc9c3b4, 0x3f4f47, 0x101820];

const loader = new GLTFLoader();

function shadowTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.55);
    grd.addColorStop(0, 'rgba(0,0,0,0.95)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.75)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.save(); g.scale(1, 1); g.fillRect(0, 0, w, h); g.restore();
  }, { srgb: false });
}

/** Loads and prepares one car template (shared geometry for all instances). */
export async function loadCar(id, onProgress) {
  const def = CAR_DEFS[id];
  const gltf = await loader.loadAsync(def.file, e => onProgress && e.total && onProgress(e.loaded / e.total));
  const scene = gltf.scene;
  const carNode = scene.getObjectByName('car') || scene;
  const meta = carNode.userData.carMeta;
  const lamps = { head: [], tail: [] };
  const paints = [];

  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    const m = o.material;
    const name = m.name || '';
    if (def.glass.test(name) && !def.tail.test(name) && !def.head.test(name)) {
      o.material = new THREE.MeshPhysicalMaterial({
        name, color: new THREE.Color(0.02, 0.022, 0.026), metalness: 0, roughness: 0.04,
        transparent: true, opacity: 0.55, envMapIntensity: 1.6, clearcoat: 0, depthWrite: false,
        side: THREE.FrontSide,
      });
      o.renderOrder = 2;
    } else if (def.tail.test(name)) {
      const t = m.clone();
      t.transmission = 0; t.transparent = false; t.opacity = 1;
      t.color = new THREE.Color(0.3, 0.01, 0.01);
      t.emissive = new THREE.Color(1, 0.04, 0.02);
      if (m.map) t.emissiveMap = m.map;
      t.emissiveIntensity = 3;
      t.roughness = 0.2;
      o.material = t;
      lamps.tail.push(t);
    } else if (def.head.test(name)) {
      const t = m.clone();
      t.transmission = 0; t.transparent = true; t.opacity = 0.9;
      t.emissive = new THREE.Color(1, 0.95, 0.86);
      t.emissiveIntensity = 2.5;
      t.depthWrite = true;
      o.material = t;
      lamps.head.push(t);
    } else if (def.paint.test(name)) {
      const p = m.isMeshPhysicalMaterial ? m : THREE.MeshStandardMaterial.prototype.copy.call(new THREE.MeshPhysicalMaterial(), m);
      Object.assign(p, def.paintTune);
      p.envMapIntensity = 1.25;
      o.material = p;
      paints.push(o);
    } else {
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.6); }
      m.envMapIntensity = 1.0;
    }
  });

  // Wheel pivots: pivot (steer about Y) -> spin node (rotate about X).
  const wheels = {};
  for (const key of ['FL', 'FR', 'RL', 'RR']) {
    const w = scene.getObjectByName('wheel_' + key);
    if (!w) continue;
    const pivot = new THREE.Group();
    pivot.name = 'pivot_' + key;
    pivot.position.copy(w.position);
    w.parent.add(pivot);
    pivot.add(w);
    w.position.set(0, 0, 0);
    wheels[key] = pivot.name;
  }

  setLayers(scene, LAYER.MAIN, LAYER.REFLECT);
  return { id, def, scene, meta, lampNames: { head: lamps.head.map(m => m.name), tail: lamps.tail.map(m => m.name) } };
}

let _shadowTex;
const _spriteCache = new Map();
function glowMaterial(color, intensity, tex = glowTexture()) {
  const key = color.getHexString() + intensity + tex.uuid;
  if (_spriteCache.has(key)) return _spriteCache.get(key);
  const m = new THREE.SpriteMaterial({ map: tex, color: color.clone().multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
  _spriteCache.set(key, m);
  return m;
}

/** One drivable/visible car built from a template. */
export class CarVisual {
  constructor(template, { paint = null, headlights = true, beams = false, lod = false } = {}) {
    this.template = template;
    const root = new THREE.Group();
    this.root = root;
    this.body = template.scene.clone(true);
    root.add(this.body);
    this.meta = template.meta;

    // Per-instance materials for lamps (brake light animation) and paint colour.
    this.tailMats = []; this.headMats = [];
    const swapped = new Map();
    this.body.traverse(o => {
      if (!o.isMesh) return;
      const n = o.material.name;
      if (template.lampNames.tail.includes(n) || template.lampNames.head.includes(n) || (paint !== null && template.def.paint.test(n))) {
        if (!swapped.has(o.material)) {
          const c = o.material.clone();
          if (paint !== null && template.def.paint.test(n)) c.color = new THREE.Color(paint);
          swapped.set(o.material, c);
          if (template.lampNames.tail.includes(n)) this.tailMats.push(c);
          if (template.lampNames.head.includes(n)) this.headMats.push(c);
        }
        o.material = swapped.get(o.material);
      }
    });

    this.wheels = [];
    for (const key of ['FL', 'FR', 'RL', 'RR']) {
      const pivot = this.body.getObjectByName('pivot_' + key);
      if (!pivot) continue;
      this.wheels.push({ key, pivot, spin: pivot.children[0], front: key[0] === 'F', r: this.meta.wheels[key]?.r || 0.33 });
    }

    // Contact shadow.
    _shadowTex = _shadowTex || shadowTexture();
    const [w, , l] = this.meta.size;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 2.1) + 0.5, l + 0.7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: _shadowTex, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, alphaMap: _shadowTex }));
    sh.material.map = null;
    sh.position.y = 0.03;
    sh.renderOrder = 1;
    root.add(sh);
    setLayers(sh, LAYER.MAIN);

    // Lamp glows.
    const L = this.meta.lights;
    this.tailGlows = [];
    for (const p of L.tail) {
      const s = new THREE.Sprite(glowMaterial(new THREE.Color(1, 0.03, 0.02), 2.2).clone());
      s.position.set(p[0], p[1], p[2] - 0.05);
      s.scale.setScalar(0.65);
      this.body.add(s);
      this.tailGlows.push(s);
    }
    this.headGlows = [];
    if (headlights) {
      for (const p of L.head) {
        const s = new THREE.Sprite(glowMaterial(new THREE.Color(1, 0.95, 0.85), 2.4));
        s.position.set(p[0], p[1], p[2] + 0.08);
        s.scale.setScalar(0.9);
        this.body.add(s);
        this.headGlows.push(s);
        const st = new THREE.Sprite(glowMaterial(new THREE.Color(0.85, 0.9, 1.0), 0.8, streakTexture()));
        st.position.set(p[0], p[1], p[2] + 0.1);
        st.scale.set(4.5, 0.3, 1);
        this.body.add(st);
        this.headGlows.push(st);
      }
    }
    if (beams) { this.beams = this.makeBeams(L.head); this.body.add(this.beams); }
    setLayers(root, LAYER.MAIN, LAYER.REFLECT);
    sh.layers.set(LAYER.MAIN);

    this.spin = 0;
    this.brake = 0;
    this.setBrake(0);
  }

  makeBeams(heads) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.12, 3.2, 26, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 13.2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(1, 0.95, 0.85).multiplyScalar(0.06) } },
      vertexShader: /* glsl */`
        varying float vZ; varying vec3 vN; varying vec3 vV;
        void main(){ vZ = position.z / 26.0; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; varying float vZ; varying vec3 vN; varying vec3 vV;
        void main(){ float e = pow(abs(dot(normalize(vN), vV)), 2.0); float fz = clamp(1.0 - vZ, 0.0, 1.0); float a = e * fz * fz * smoothstep(0.0, 0.08, vZ); gl_FragColor = vec4(uCol * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (const p of heads) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p[0] * 0.9, p[1], p[2]);
      m.rotation.x = 0.045;
      g.add(m);
    }
    g.layers.set(LAYER.MAIN);
    g.traverse(o => o.layers.set(LAYER.MAIN));
    return g;
  }

  setBrake(b) {
    if (Math.abs(b - this.brake) < 0.02 && this._init) return;
    this._init = true;
    this.brake = b;
    const e = 2.2 + b * 9;
    for (const m of this.tailMats) m.emissiveIntensity = e;
    for (const s of this.tailGlows) {
      s.material.color.setRGB(1, 0.03, 0.02).multiplyScalar(1.6 + b * 6);
      s.scale.setScalar(0.6 + b * 0.5);
    }
  }

  /** Headlight glows/flares only read from the front. */
  faceCamera(camera) {
    if (!this.headGlows.length) return;
    const e = this.root.matrixWorld.elements;
    const fx = e[8], fy = e[9], fz = e[10];
    const dx = camera.position.x - e[12], dy = camera.position.y - e[13], dz = camera.position.z - e[14];
    const l = Math.hypot(dx, dy, dz) || 1;
    const dot = (fx * dx + fy * dy + fz * dz) / l;
    // Volumetric beams read from behind/side; from the front they'd swallow the camera.
    if (this.beams) this.beams.visible = dot < 0.15;
    const k = Math.min(1, Math.max(0, (dot - 0.05) / 0.5));
    for (let i = 0; i < this.headGlows.length; i++) {
      const s = this.headGlows[i];
      s.visible = k > 0.01;
      if (i % 2 === 0) s.scale.setScalar(0.9 * k + 0.05);
      else s.scale.set(4.5 * k * k, 0.3 * k, 1);
    }
  }

  /** speed m/s, steer radians (front wheel angle). */
  update(dt, speed, steer) {
    this.spin += speed * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.spin / w.r;
      if (w.front) w.pivot.rotation.y = steer;
    }
  }
}
