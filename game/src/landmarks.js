// Fukuoka landmarks: 福岡タワー (Halloween illumination), ドーム, シーホーク-style hotel,
// 博多駅ビル, 博多ポートタワー, and airliners on approach to 福岡空港.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, LAYER, setLayers, canvasTexture } from './util.js';
import { U } from './lighting.js';
import { buildingMaterial } from './city.js';

const ALL = [LAYER.MAIN, LAYER.ENV, LAYER.REFLECT, LAYER.WATER];

function groundPoint(track, s, d) {
  const p = track.point(s, d);
  p.y = 0;
  return p;
}

// ---- 福岡タワー -------------------------------------------------------------------
function fukuokaTower(pos, facing) {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = facing;
  const H = 234, side = 24;
  // Triangular (rhombic-ish) prism clad in half-mirror glass.
  const shape = new THREE.Shape();
  const r = side / Math.sqrt(3);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.82;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  body.rotateX(-Math.PI / 2);
  body.scale(1, 182, 1);
  body.translate(0, 8, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying float vH;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vH = position.y; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vW; varying vec3 vN; varying float vH;
      ${GLSL_NOISE}
      void main(){
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        if (abs(N.y) > 0.5) { gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0); return; }
        // Half-mirror glass reflecting the night sky.
        vec3 R = reflect(-V, N);
        vec3 sky = mix(vec3(0.09, 0.055, 0.07), vec3(0.008, 0.01, 0.03), clamp(R.y * 2.5, 0.0, 1.0));
        float F = 0.15 + 0.85 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 4.0);
        // LED illumination (Halloween: orange & purple bands sweeping upward).
        float h = vH;
        float grid = step(0.4, fract(h / 1.6)) * step(0.15, fract((vW.x + vW.z) / 1.4));
        float wave = 0.5 + 0.5 * sin(h * 0.045 - uTime * 1.3);
        float band = 0.5 + 0.5 * sin(h * 0.18 + uTime * 0.6);
        vec3 orange = vec3(1.0, 0.36, 0.04), purple = vec3(0.45, 0.08, 1.0);
        vec3 led = mix(purple, orange, smoothstep(0.35, 0.65, band)) * (0.6 + 1.6 * wave) * 1.6;
        float pumpkin = smoothstep(0.86, 0.9, sin(h * 0.03 + uTime * 0.25)) * 0.8;
        led += vec3(1.0, 0.55, 0.05) * pumpkin * 2.0;
        float ledMask = smoothstep(14.0, 20.0, h) * (1.0 - smoothstep(112.0, 115.0, h)) + smoothstep(128.0, 132.0, h) * (1.0 - smoothstep(186.0, 190.0, h));
        vec3 col = sky * F + led * grid * ledMask * 0.85 + led * ledMask * 0.12;
        // Observation deck windows.
        float deck = smoothstep(115.0, 116.0, h) * (1.0 - smoothstep(127.0, 128.0, h));
        col += vec3(1.0, 0.9, 0.75) * deck * (0.8 + 0.4 * step(0.5, fract((vW.x - vW.z) / 2.0))) * 2.5;
        float dist = length(cameraPosition - vW);
        col = mix(col, uFogColor, 1.0 - exp(-pow(uFogDensity * dist * 0.7, 2.0)));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  g.add(new THREE.Mesh(body, mat));
  // Base hall and antenna.
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.35 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(46, 8, 34).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(0.5, 0.38, 0.25), emissiveIntensity: 0.5 })));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 44, 8).translate(0, 190 + 22, 0), steel));
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.03).multiplyScalar(12) });
  for (const y of [200, 218, 233]) g.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6).translate(0, y, 0), red));
  g.userData.blink = red;
  setLayers(g, ...ALL);
  return g;
}

// ---- ドーム & ホテル --------------------------------------------------------------
function dome(pos) {
  const R = 111.4, cy = -27.4;
  const theta = Math.acos(-cy / R);
  const geo = new THREE.SphereGeometry(R, 96, 32, 0, Math.PI * 2, 0, theta).translate(0, cy, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying vec3 vL;
      void main(){ vL = position; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vW; varying vec3 vN; varying vec3 vL;
      void main(){
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float ang = atan(vL.z, vL.x);
        float panels = step(0.06, fract(ang * 48.0 / 6.2831)) * step(0.05, fract(vL.y / 7.0));
        vec3 R = reflect(-V, N);
        vec3 sky = mix(vec3(0.16, 0.1, 0.11), vec3(0.015, 0.02, 0.045), clamp(R.y * 2.0, 0.0, 1.0));
        float F = 0.3 + 0.7 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
        vec3 col = sky * F * mix(0.6, 1.0, panels);
        // Ring lights at the eaves and the base.
        float y = vL.y;
        col += vec3(0.75, 0.85, 1.0) * (1.0 - smoothstep(0.0, 1.5, abs(y - 10.0))) * 2.4;
        col += vec3(1.0, 0.8, 0.55) * (1.0 - smoothstep(0.0, 0.8, abs(y - 3.0))) * 1.8 * step(0.5, fract(ang * 90.0 / 6.2831));
        // Roof seams glow faintly.
        col += vec3(0.2, 0.25, 0.35) * (1.0 - panels) * 0.5;
        float dist = length(cameraPosition - vW);
        col = mix(col, uFogColor, 1.0 - exp(-pow(uFogDensity * dist * 0.7, 2.0)));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  setLayers(m, ...ALL);
  return m;
}

function towerBuilding(pos, rot, w, d, h, seed, lit = 0.5, temp = 0.5, round = false) {
  let geo;
  if (round) {
    geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1).translate(0, 0.5, 0);
  } else {
    geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  }
  const mesh = new THREE.InstancedMesh(geo, buildingMaterial(round), 1);
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(w, h, d));
  mesh.setMatrixAt(0, m);
  geo.setAttribute('aDims', new THREE.InstancedBufferAttribute(new Float32Array([w, h, d]), 3));
  const perimeter = Math.PI * (w + d) / 2;
  geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array([seed, lit, temp, perimeter]), 4));
  mesh.frustumCulled = false;
  setLayers(mesh, ...ALL);
  return mesh;
}

// ---- 看板 / building-top signs ----------------------------------------------------
export function neonTexture(text, { fg = '#ff3a6a', bg = 'rgba(0,0,0,0)', w = 1024, h = 256, font = 'Dela Gothic One', border = false } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = `${Math.floor(h * 0.62)}px "${font}", "Noto Sans JP", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (border) { g.strokeStyle = fg; g.lineWidth = h * 0.05; g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12); }
    g.shadowColor = fg; g.shadowBlur = h * 0.12;
    g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + h * 0.03);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(text, w / 2, h / 2 + h * 0.03);
  });
}

function signBoard(tex, w, h, intensity = 3.5) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(intensity, intensity, intensity) });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// ---- 飛行機 -------------------------------------------------------------------------
class Airliner {
  constructor(a, b, period, phase) {
    this.a = a; this.b = b; this.period = period; this.phase = phase;
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.3 });
    const body = mergeGeometries([
      new THREE.CylinderGeometry(2.0, 2.0, 38, 14).rotateX(Math.PI / 2),
      new THREE.SphereGeometry(2.0, 14, 8).scale(1, 1, 2.2).translate(0, 0, 19),
      new THREE.ConeGeometry(2.0, 9, 14).rotateX(-Math.PI / 2).translate(0, 0.6, -23.5),
      new THREE.BoxGeometry(36, 0.5, 6).translate(0, -0.6, 1),
      new THREE.BoxGeometry(12, 0.4, 3.2).translate(0, 0.8, -24),
      new THREE.BoxGeometry(0.5, 8, 5).translate(0, 4.8, -24),
      new THREE.CylinderGeometry(1.2, 1.2, 4.5, 10).rotateX(Math.PI / 2).translate(-7, -2.2, 3),
      new THREE.CylinderGeometry(1.2, 1.2, 4.5, 10).rotateX(Math.PI / 2).translate(7, -2.2, 3),
    ]);
    g.add(new THREE.Mesh(body, skin));
    const lamp = (c, x, y, z, s = 0.6) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z); g.add(m); return m;
    };
    lamp(new THREE.Color(1, 0.05, 0.03).multiplyScalar(30), 18, -0.6, 1);
    lamp(new THREE.Color(0.05, 1, 0.2).multiplyScalar(30), -18, -0.6, 1);
    this.strobe = [lamp(new THREE.Color(20, 20, 20), 18.2, -0.6, 0.2), lamp(new THREE.Color(20, 20, 20), -18.2, -0.6, 0.2), lamp(new THREE.Color(20, 20, 20), 0, 8.8, -26, 0.5)];
    this.beacon = lamp(new THREE.Color(1, 0.04, 0.02).multiplyScalar(30), 0, -2.2, 0, 0.5);
    this.landing = [lamp(new THREE.Color(60, 58, 52), 3, -1.2, 4, 0.7), lamp(new THREE.Color(60, 58, 52), -3, -1.2, 4, 0.7)];
    // Cabin windows strip.
    const win = new THREE.Mesh(new THREE.BoxGeometry(4.08, 0.35, 30).translate(0, 0.6, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1) }));
    g.add(win);
    g.scale.setScalar(1);
    this.group = g;
    setLayers(g, LAYER.MAIN, LAYER.REFLECT);
  }
  update(t) {
    const u = ((t + this.phase) % this.period) / this.period;
    this.group.visible = u < 0.85;
    const k = u / 0.85;
    this.group.position.lerpVectors(this.a, this.b, k);
    this.group.lookAt(this.b);
    const st = (t * 1.1) % 1.2;
    for (const s of this.strobe) s.visible = st < 0.06 || (st > 0.15 && st < 0.2);
    this.beacon.visible = (t % 1.0) < 0.12;
  }
}

export function buildLandmarks(track) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const heading = s => track.heading(s);
  const updaters = [];

  // 福岡タワー (seaside, north of the course).
  const tower = fukuokaTower(groundPoint(track, 1720, 330), heading(1720) + 0.4);
  group.add(tower);
  updaters.push(t => { tower.userData.blink.color.setScalar(0).setRGB(1, 0.05, 0.03).multiplyScalar((t % 1.5) < 0.6 ? 14 : 1.5); });

  // ドーム + hotel.
  group.add(dome(groundPoint(track, 2050, 360)));
  const hotelPos = groundPoint(track, 2240, 230);
  group.add(towerBuilding(hotelPos, heading(2240) + 0.3, 78, 30, 143, 41.3, 0.62, 0.2, true));
  // Hotel name light on top.
  const crown = signBoard(neonTexture('SEA HAWK', { fg: '#7fd0ff', font: 'Russo One' }), 40, 10, 4);
  crown.position.copy(hotelPos).add(new THREE.Vector3(0, 146, 0));
  crown.rotation.y = heading(2240) + Math.PI;
  setLayers(crown, ...ALL);
  group.add(crown);

  // 百道 tower blocks around the tower (TNC etc.).
  for (let i = 0; i < 6; i++) {
    const p = groundPoint(track, 1150 + i * 120, -(150 + (i % 2) * 60));
    group.add(towerBuilding(p, heading(1000 + i * 140), 40 + i * 3, 32, 70 + (i * 37) % 60, 10 + i, 0.45, 0.7));
  }

  // 博多ポートタワー: lattice tower lit red.
  {
    const p = groundPoint(track, 4520, 330);
    const lat = [];
    for (let y = 0; y < 90; y += 6) {
      const w = 9 * (1 - y / 120);
      lat.push(new THREE.BoxGeometry(w * 2, 0.4, 0.4).translate(0, y, w), new THREE.BoxGeometry(w * 2, 0.4, 0.4).translate(0, y, -w));
      lat.push(new THREE.BoxGeometry(0.4, 0.4, w * 2).translate(w, y, 0), new THREE.BoxGeometry(0.4, 0.4, w * 2).translate(-w, y, 0));
    }
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = new THREE.Vector3(9 * x, 0, 9 * z), b = new THREE.Vector3(1.5 * x, 100, 1.5 * z);
      const c = new THREE.CylinderGeometry(0.5, 0.7, a.distanceTo(b), 6);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      c.translate((a.x + b.x) / 2, 50, (a.z + b.z) / 2);
      lat.push(c);
    }
    lat.push(new THREE.CylinderGeometry(7, 7, 6, 16).translate(0, 72, 0));
    const pt = new THREE.Mesh(mergeGeometries(lat), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.18, 0.08) }));
    pt.position.copy(p);
    setLayers(pt, ...ALL);
    group.add(pt);
  }

  // 天神 skyline highlights.
  for (let i = 0; i < 10; i++) {
    const s = 4800 + i * 110, d = (i % 2 ? -1 : 1) * (80 + (i * 53) % 90);
    group.add(towerBuilding(groundPoint(track, s, d), heading(s), 30 + (i * 7) % 20, 30, 90 + (i * 29) % 70, 70 + i, 0.55, (i % 3) / 3));
  }

  // 博多駅ビル with a big illuminated name sign.
  {
    const s = 7450, d = -190;
    const p = groundPoint(track, s, d);
    const h = heading(s);
    group.add(towerBuilding(p, h, 210, 70, 62, 91.7, 0.7, 0.4));
    const sign = signBoard(neonTexture('博多駅', { fg: '#ffffff', font: 'Dela Gothic One' }), 60, 15, 5);
    const n = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const left = new THREE.Vector3(n.z, 0, -n.x);
    sign.position.copy(p).addScaledVector(left, 36).add(new THREE.Vector3(0, 52, 0));
    sign.lookAt(sign.position.clone().add(left));
    setLayers(sign, ...ALL);
    group.add(sign);
    const sign2 = signBoard(neonTexture('JR HAKATA CITY', { fg: '#5fd7ff', font: 'Russo One' }), 70, 12, 4);
    sign2.position.copy(p).addScaledVector(left, 36).add(new THREE.Vector3(0, 38, 0));
    sign2.lookAt(sign2.position.clone().add(left));
    setLayers(sign2, ...ALL);
    group.add(sign2);
  }

  // Rooftop neon along the city sections.
  const ads = [
    ['とんこつラーメン', '#ff4040'], ['中洲', '#ff60c0'], ['HAKATA', '#40c8ff'], ['屋台', '#ffb030'],
    ['焼鳥', '#ff7020'], ['カラオケ', '#c060ff'], ['HOTEL', '#60ff9a'], ['めんたい', '#ff3050'],
    ['TENJIN', '#ffd040'], ['九州R', '#ff2a2a'], ['PARKING', '#40a0ff'], ['居酒屋', '#ff8040'],
  ];
  let ai = 0;
  for (let s = 4700; s < 8500; s += 190) {
    const [text, colr] = ads[ai++ % ads.length];
    const side = ai % 2 ? 1 : -1;
    const d = side > 0 ? 58 + (ai * 13) % 50 : -80 - (ai * 17) % 50;
    const p = track.point(s, d);
    p.y = 34 + (ai * 7) % 30;
    const b = signBoard(neonTexture(text, { fg: colr, border: ai % 3 === 0 }), 26, 6.5, 3.2 + (ai % 3));
    b.position.copy(p);
    b.lookAt(track.point(s - 60, -4, p.y - track.heightAt(s, 0)));
    setLayers(b, ...ALL);
    group.add(b);
    if (ai % 4 === 0) updaters.push(t => { b.visible = Math.sin(t * 7 + ai) > -0.85; });
  }

  // Airliners on approach (passing over 博多).
  const planes = [];
  const a1 = track.point(6800, 2200); a1.y = 520;
  const b1 = track.point(7900, -2600); b1.y = 120;
  planes.push(new Airliner(a1, b1, 48, 0), new Airliner(a1.clone().add(new THREE.Vector3(200, 60, 0)), b1.clone().add(new THREE.Vector3(200, 30, 0)), 48, 24));
  const a2 = track.point(9500, -2500); a2.y = 160;
  const b2 = track.point(8800, 2500); b2.y = 640;
  planes.push(new Airliner(a2, b2, 56, 10));
  for (const p of planes) { group.add(p.group); updaters.push(t => p.update(t)); }

  return { group, update: t => { for (const u of updaters) u(t); } };
}
