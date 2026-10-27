// Builds all expressway geometry along the track: deck, parapets, median, sound walls,
// tunnel, piers, lamp posts, glare screens, delineators and the cable-stayed bridge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeFrame, HALF_W, MEDIAN_D, ONCOMING_D } from './track.js';
import { LAMP } from './lighting.js';
import { TUNNEL, BRIDGE, ZONES, PORTAL } from './course.js';
import { makeRoadMaterial, makeSurfaceMaterial } from './trackmaterials.js';
import { LAYER, setLayers, mulberry32, canvasTexture } from './util.js';

const CHUNK = 1000;
const LEFT_EDGE = HALF_W;                 // 6.25
const RIGHT_EDGE = ONCOMING_D - HALF_W;   // -20.75

function zoneAt(s) { return ZONES.find(z => s >= z.s0 && s < z.s1) || ZONES[ZONES.length - 1]; }
const inTunnel = s => s > TUNNEL.s0 && s < TUNNEL.s1;
const soundWallAt = s => { const t = zoneAt(s).type; return t === 'city' || t === 'jct' || t === 'hakata'; };

/** Extrudes a (d,h) polyline along the track between s0 and s1. Each profile segment is hard-edged. */
export function extrude(track, profile, s0, s1, step = 2) {
  const f = makeFrame();
  const rows = Math.max(1, Math.ceil((s1 - s0) / step));
  const segs = profile.length - 1;
  const vCount = (rows + 1) * segs * 2;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const trk = new Float32Array(vCount * 3), aF = new Float32Array(vCount * 3), aL = new Float32Array(vCount * 3);
  const idx = [];
  let v = 0;
  const n2 = [];
  for (let j = 0; j < segs; j++) {
    const [d0, h0] = profile[j], [d1, h1] = profile[j + 1];
    const td = d1 - d0, th = h1 - h0, l = Math.hypot(td, th) || 1;
    n2.push([th / l, -td / l]);
  }
  for (let r = 0; r <= rows; r++) {
    const s = Math.min(s1, s0 + r * step);
    track.frame(s, f);
    for (let j = 0; j < segs; j++) {
      const [nd, nh] = n2[j];
      for (let e = 0; e < 2; e++) {
        const [d, h] = profile[j + e];
        const i3 = v * 3;
        pos[i3] = f.pos.x + f.left.x * d + f.up.x * h;
        pos[i3 + 1] = f.pos.y + f.left.y * d + f.up.y * h;
        pos[i3 + 2] = f.pos.z + f.left.z * d + f.up.z * h;
        nor[i3] = f.left.x * nd + f.up.x * nh;
        nor[i3 + 1] = f.left.y * nd + f.up.y * nh;
        nor[i3 + 2] = f.left.z * nd + f.up.z * nh;
        trk[i3] = s; trk[i3 + 1] = d; trk[i3 + 2] = h;
        aF[i3] = f.fwd.x; aF[i3 + 1] = f.fwd.y; aF[i3 + 2] = f.fwd.z;
        aL[i3] = f.left.x; aL[i3 + 1] = f.left.y; aL[i3 + 2] = f.left.z;
        v++;
      }
    }
  }
  const stride = segs * 2;
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < segs; j++) {
      const a = r * stride + j * 2, b = a + 1, c = a + stride, dd = c + 1;
      idx.push(a, b, c, b, dd, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aTrack', new THREE.BufferAttribute(trk, 3));
  g.setAttribute('aF', new THREE.BufferAttribute(aF, 3));
  g.setAttribute('aL', new THREE.BufferAttribute(aL, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const mirror = (profile, c) => profile.map(([d, h]) => [2 * c - d, h]).reverse();

// Cross-section profiles (d, h), oriented so faces point the right way (see extrude()).
const PARAPET_L = [[LEFT_EDGE + 0.6, -2.0], [LEFT_EDGE + 0.6, 1.1], [LEFT_EDGE + 0.17, 1.1], [LEFT_EDGE + 0.08, 0.32], [LEFT_EDGE, 0]];
const PARAPET_R = mirror(PARAPET_L, (LEFT_EDGE + RIGHT_EDGE) / 2);
const MEDIAN = [[MEDIAN_D + 0.3, 0], [MEDIAN_D + 0.15, 0.9], [MEDIAN_D - 0.15, 0.9], [MEDIAN_D - 0.3, 0]];
const UNDERSIDE = [[RIGHT_EDGE - 0.6, -2.0], [LEFT_EDGE + 0.6, -2.0]];
const SOUNDWALL_L = [[LEFT_EDGE + 0.42, 2.9], [LEFT_EDGE + 0.42, 1.1]];
const SOUNDWALL_R = mirror(SOUNDWALL_L, (LEFT_EDGE + RIGHT_EDGE) / 2);
const ROAD = (() => {
  const ds = [LEFT_EDGE, 5.4, 5.2, 3.5, 1.85, 1.65, 0, -1.65, -1.85, -3.5, -5.2, -5.4, -6.25, -7.25, -8.25];
  const p = ds.map(d => [d, 0]);
  for (const d of [-5.4, -5.2, -3.5, -1.85, -1.65, 0, 1.65, 1.85, 3.5, 5.2, 5.4]) p.push([ONCOMING_D - d, 0]);
  p.push([RIGHT_EDGE, 0]);
  return p;
})();
function tunnelProfile() {
  const p = [[-6.95, 0], [-6.95, 3.2]];
  for (let i = 1; i <= 24; i++) {
    const t = Math.PI - (i / 24) * Math.PI;
    p.push([6.95 * Math.cos(t), 3.2 + 4.0 * Math.sin(t)]);
  }
  p.push([6.95, 0]);
  return p;
}

function chunked(track, profile, s0, s1, pred, step = 2) {
  // Splits [s0,s1] into CHUNK-long pieces, and further by predicate on/off runs.
  const out = [];
  let runStart = null;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const on = pred ? pred(s) : true;
    if (on && runStart === null) runStart = s;
    const end = runStart !== null && (!on || s >= s1 || s - runStart >= CHUNK);
    if (end) {
      const e = on ? s : s - step;
      if (e > runStart) out.push(extrude(track, profile, runStart, e, step));
      runStart = on && s < s1 ? s : null;
    }
  }
  return out;
}

function addMeshes(group, geoms, mat, layers) {
  for (const g of geoms) {
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    setLayers(m, ...layers);
    group.add(m);
  }
}

function instanced(geom, mat, mats, layers) {
  const im = new THREE.InstancedMesh(geom, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.frustumCulled = true;
  setLayers(im, ...layers);
  return im;
}

/** Track-aligned matrix at (s,d,h): local x=left, y=up, z=forward. */
function frameMatrix(track, s, d, h, f = makeFrame(), flatUp = false) {
  track.frame(s, f);
  const p = f.pos.clone().addScaledVector(f.left, d).addScaledVector(f.up, h);
  const up = flatUp ? new THREE.Vector3(0, 1, 0) : f.up;
  const left = flatUp ? new THREE.Vector3(f.fwd.z, 0, -f.fwd.x).normalize() : f.left;
  const fwd = flatUp ? new THREE.Vector3().crossVectors(left, up) : f.fwd;
  return new THREE.Matrix4().makeBasis(left, up, fwd).setPosition(p);
}

export function buildTrack(track) {
  const group = new THREE.Group();
  group.name = 'track';
  const L = track.length;
  const ALL = [LAYER.MAIN, LAYER.ENV, LAYER.REFLECT];
  const NOREF = [LAYER.MAIN, LAYER.ENV];

  // Deck surface (road material is not in the reflection layer: it receives it).
  const road = makeRoadMaterial();
  addMeshes(group, chunked(track, ROAD, 0, L, null), road, NOREF);

  const concrete = makeSurfaceMaterial(0);
  const notTunnel = s => !inTunnel(s);
  addMeshes(group, chunked(track, PARAPET_L, 0, L, notTunnel), concrete, ALL);
  addMeshes(group, chunked(track, PARAPET_R, 0, L, null), concrete, ALL);
  addMeshes(group, chunked(track, MEDIAN, 0, L, null), makeSurfaceMaterial(4), ALL);
  addMeshes(group, chunked(track, UNDERSIDE, 0, L, notTunnel, 4), makeSurfaceMaterial(3), ALL);
  const sw = makeSurfaceMaterial(2);
  addMeshes(group, chunked(track, SOUNDWALL_L, 0, L, s => soundWallAt(s) && notTunnel(s)), sw, ALL);
  addMeshes(group, chunked(track, SOUNDWALL_R, 0, L, s => soundWallAt(s) && notTunnel(s)), sw, ALL);
  addMeshes(group, chunked(track, tunnelProfile(), TUNNEL.s0, TUNNEL.s1, null), makeSurfaceMaterial(1), ALL);
  // Second tube for the oncoming carriageway.
  const onTube = tunnelProfile().map(([d, h]) => [d + ONCOMING_D, h]);
  addMeshes(group, chunked(track, onTube, TUNNEL.s0, TUNNEL.s1, null), makeSurfaceMaterial(1), ALL);

  const f = makeFrame();
  const rng = mulberry32(1234);

  // --- Lamp posts (median twin-arm) ---------------------------------------
  const lampS = [];
  for (let s = LAMP.offset; s < L; s += LAMP.spacing) if (s < TUNNEL.s0 - 4 || s > TUNNEL.s1 + 4) lampS.push(s);
  const poleH = LAMP.height + 0.35;
  const armSpan = (LAMP.rows[0] - LAMP.rows[1]) / 2 + 0.6;
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.17, poleH, 10, 1).translate(0, poleH / 2 + 0.9, 0),
    new THREE.BoxGeometry(armSpan * 2, 0.12, 0.12).translate(0, poleH + 0.75, 0),
    new THREE.BoxGeometry(0.06, 0.6, 0.06).translate(0, poleH + 0.5, 0),
  ]);
  const housingGeo = mergeGeometries([
    new THREE.BoxGeometry(0.42, 0.14, 0.75).translate(LAMP.rows[0] - MEDIAN_D, LAMP.height + 0.1, 0),
    new THREE.BoxGeometry(0.42, 0.14, 0.75).translate(LAMP.rows[1] - MEDIAN_D, LAMP.height + 0.1, 0),
  ]);
  const lensGeo = mergeGeometries([
    new THREE.BoxGeometry(0.34, 0.03, 0.62).translate(LAMP.rows[0] - MEDIAN_D, LAMP.height + 0.02, 0),
    new THREE.BoxGeometry(0.34, 0.03, 0.62).translate(LAMP.rows[1] - MEDIAN_D, LAMP.height + 0.02, 0),
  ]);
  const lampMats = lampS.map(s => frameMatrix(track, s, MEDIAN_D, 0, f, true));
  const metal = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.45, metalness: 0.7 });
  group.add(instanced(poleGeo, metal, lampMats, ALL));
  group.add(instanced(housingGeo, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }), lampMats, ALL));
  const lensMat = new THREE.MeshBasicMaterial({ color: LAMP.color.clone().multiplyScalar(26) });
  group.add(instanced(lensGeo, lensMat, lampMats, [...ALL, LAYER.WATER]));
  group.add(buildLightCones(track, lampS));
  group.userData.lampS = lampS;

  // --- Tunnel lamps & jet fans ----------------------------------------------
  const tl = [];
  for (let s = Math.ceil(TUNNEL.s0 / 6) * 6; s < TUNNEL.s1; s += 6) {
    tl.push(frameMatrix(track, s, 4.6, 5.3, f), frameMatrix(track, s, -4.6, 5.3, f));
    tl.push(frameMatrix(track, s, ONCOMING_D + 4.6, 5.3, f), frameMatrix(track, s, ONCOMING_D - 4.6, 5.3, f));
  }
  // Entrance (threshold) lighting: extra fixtures in between and two centre rows.
  for (let s = Math.ceil(TUNNEL.s0 / 6) * 6 + 3; s < TUNNEL.s0 + 100; s += 6) {
    tl.push(frameMatrix(track, s, 4.6, 5.3, f), frameMatrix(track, s, -4.6, 5.3, f));
  }
  for (let s = TUNNEL.s0 + 2; s < TUNNEL.s0 + 64; s += 3) {
    tl.push(frameMatrix(track, s, 1.9, 6.75, f), frameMatrix(track, s, -1.9, 6.75, f));
  }
  const tLampMat = new THREE.MeshBasicMaterial({ color: LAMP.tunnelColor.clone().multiplyScalar(14) });
  group.add(instanced(new THREE.BoxGeometry(0.28, 0.1, 1.4), tLampMat, tl, ALL));
  const fans = [];
  for (let s = TUNNEL.s0 + 80; s < TUNNEL.s1 - 60; s += 130) {
    fans.push(frameMatrix(track, s, 2.4, 5.9, f), frameMatrix(track, s, -2.4, 5.9, f));
  }
  const fanGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.62, 0.62, 4.2, 20, 1, true).rotateX(Math.PI / 2),
    new THREE.CylinderGeometry(0.66, 0.66, 0.3, 20).rotateX(Math.PI / 2).translate(0, 0, 2.1),
    new THREE.CylinderGeometry(0.66, 0.66, 0.3, 20).rotateX(Math.PI / 2).translate(0, 0, -2.1),
    new THREE.BoxGeometry(0.1, 0.5, 0.1).translate(0, 0.75, 0),
  ]);
  group.add(instanced(fanGeo, new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }), fans, ALL));

  // --- Piers -------------------------------------------------------------------
  const pierMats = [], capMats = [];
  for (let s = 6; s < L; s += 36) {
    if (inTunnel(s) || (s > BRIDGE.mainSpan[0] && s < BRIDGE.mainSpan[1])) continue;
    track.frame(s, f);
    const deckBottom = f.pos.y - 2.0;
    if (deckBottom < 1.5) continue;
    const c = f.pos.clone().addScaledVector(f.left, (LEFT_EDGE + RIGHT_EDGE) / 2);
    const fl = new THREE.Vector3(f.fwd.x, 0, f.fwd.z).normalize();
    const lf = new THREE.Vector3(fl.z, 0, -fl.x);
    const twin = rng() < 0.5;
    for (const off of twin ? [-6.5, 6.5] : [0]) {
      const p = c.clone().addScaledVector(lf, off);
      const m = new THREE.Matrix4().makeBasis(lf, new THREE.Vector3(0, 1, 0), fl)
        .multiply(new THREE.Matrix4().makeScale(twin ? 0.8 : 1, deckBottom - 1.4, twin ? 0.8 : 1));
      m.setPosition(p.x, 0, p.z);
      pierMats.push(m);
    }
    const cm = new THREE.Matrix4().makeBasis(lf, new THREE.Vector3(0, 1, 0), fl);
    cm.setPosition(c.x, deckBottom - 0.7, c.z);
    capMats.push(cm);
  }
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x6e6c68, roughness: 0.92, metalness: 0 });
  group.add(instanced(new THREE.CylinderGeometry(1.7, 1.9, 1, 20, 1, true).translate(0, 0.5, 0), pierMat, pierMats, ALL));
  group.add(instanced(new THREE.BoxGeometry(LEFT_EDGE - RIGHT_EDGE - 2, 1.4, 2.8), pierMat, capMats, ALL));

  // --- Glare screens on the median ------------------------------------------
  const glare = [];
  for (let s = 0; s < L; s += 0.9) {
    if (inTunnel(s)) continue;
    const m = frameMatrix(track, s, MEDIAN_D, 1.25, f);
    m.multiply(new THREE.Matrix4().makeRotationY(0.45));
    glare.push(m);
  }
  group.add(instanced(new THREE.PlaneGeometry(0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x3d5a46, roughness: 0.6, side: THREE.DoubleSide }), glare, [LAYER.MAIN, LAYER.REFLECT]));
  const glarePost = [];
  for (let s = 0; s < L; s += 4) if (!inTunnel(s)) glarePost.push(frameMatrix(track, s, MEDIAN_D, 0.9, f));
  group.add(instanced(new THREE.BoxGeometry(0.06, 0.05, 4.0).translate(0, 0.62, 0), metal, glarePost, [LAYER.MAIN]));

  // --- Delineators (retro-reflectors on the parapets) ------------------------
  const delW = [], delA = [];
  for (let s = 0; s < L; s += 10) {
    if (!inTunnel(s)) delW.push(frameMatrix(track, s, LEFT_EDGE + 0.12, 0.85, f));
    delA.push(frameMatrix(track, s, MEDIAN_D + 0.2, 0.75, f));
  }
  const refl = new THREE.BoxGeometry(0.04, 0.09, 0.09);
  group.add(instanced(refl, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.0, 1.0).multiplyScalar(2.2) }), delW, [LAYER.MAIN, LAYER.REFLECT]));
  group.add(instanced(refl, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.05).multiplyScalar(2.4) }), delA, [LAYER.MAIN, LAYER.REFLECT]));

  // --- Tunnel portals ----------------------------------------------------------
  group.add(buildPortal(track, TUNNEL.s0, false));
  group.add(buildPortal(track, TUNNEL.s1, true));

  // --- Bridge -------------------------------------------------------------------
  group.add(buildBridge(track));

  return group;
}

function buildLightCones(track, lampS) {
  const geo = new THREE.CylinderGeometry(0.25, 3.6, LAMP.height - 0.2, 24, 1, true).translate(0, (LAMP.height - 0.2) / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: LAMP.color.clone().multiplyScalar(0.05) } },
    vertexShader: /* glsl */`
      varying float vH; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main(){
        vH = position.y / ${(LAMP.height - 0.2).toFixed(2)};
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = cameraPosition - wp.xyz; vDist = length(vV);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying float vH; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main(){
        float edge = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(edge, 1.5) * pow(clamp(vH, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.25, vH);
        a *= smoothstep(4.0, 14.0, vDist) * exp(-vDist * 0.004);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const f = makeFrame();
  const mats = [];
  for (const s of lampS) for (const d of LAMP.rows) mats.push(frameMatrix(track, s, d, 0.2, f, true));
  return instanced(geo, mat, mats, [LAYER.MAIN]);
}

// --- Tunnel portal --------------------------------------------------------------
// Headwall spanning both tubes with a cut-and-cover box behind it, coping, wing walls
// retaining the hillside cutting, flood masts and the tunnel name plate.
const TUBE_C = [0, ONCOMING_D];

/** Maps a geometry built in portal space (x = sgn*d, y = h, z = depth into the tunnel) onto the track. */
function trackify(track, geo, s, sgn) {
  const f = makeFrame();
  const p = geo.attributes.position, n = p.count;
  const trk = new Float32Array(n * 3), aF = new Float32Array(n * 3), aL = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = sgn * p.getX(i), h = p.getY(i), sv = s + sgn * p.getZ(i);
    track.frame(sv, f);
    p.setXYZ(i, f.pos.x + f.left.x * d + f.up.x * h, f.pos.y + f.left.y * d + f.up.y * h, f.pos.z + f.left.z * d + f.up.z * h);
    trk.set([sv, d, h], i * 3); aF.set([f.fwd.x, f.fwd.y, f.fwd.z], i * 3); aL.set([f.left.x, f.left.y, f.left.z], i * 3);
  }
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo.setAttribute('aTrack', new THREE.BufferAttribute(trk, 3));
  geo.setAttribute('aF', new THREE.BufferAttribute(aF, 3));
  geo.setAttribute('aL', new THREE.BufferAttribute(aL, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function tunnelPlate(sub) {
  return canvasTexture(1024, 192, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2b2d31'); gr.addColorStop(1, '#17181b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b9b4a6'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#f2efe6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '104px "Dela Gothic One", "Noto Sans JP", sans-serif';
    g.fillText('西公園トンネル', w / 2, 82, w - 80);
    g.font = '34px "Russo One", sans-serif';
    g.fillText(sub, w / 2, 156, w - 80);
  });
}

function buildPortal(track, s, exit) {
  const group = new THREE.Group();
  const sgn = exit ? -1 : 1;
  const xa = sgn * PORTAL.dL, xb = sgn * PORTAL.dR;
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
  const mat = makeSurfaceMaterial(5);
  const ALL = [LAYER.MAIN, LAYER.ENV, LAYER.REFLECT];
  // Headwall + box: two arched openings slightly larger than the tube lining.
  const shape = new THREE.Shape();
  shape.moveTo(x0, -2.6); shape.lineTo(x1, -2.6); shape.lineTo(x1, PORTAL.top); shape.lineTo(x0, PORTAL.top); shape.closePath();
  for (const c of TUBE_C) {
    const cx = sgn * c, w = 7.03;
    const hole = new THREE.Path();
    hole.moveTo(cx - w, -0.3); hole.lineTo(cx + w, -0.3);
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI; hole.lineTo(cx + w * Math.cos(t), 3.2 + 4.06 * Math.sin(t)); }
    hole.closePath();
    shape.holes.push(hole);
  }
  const wall = trackify(track, new THREE.ExtrudeGeometry(shape, { depth: PORTAL.depth, bevelEnabled: false, curveSegments: 1 }), s, sgn);
  // Coping overhanging the face.
  const cap = new THREE.Shape();
  cap.moveTo(x0 - 0.4, PORTAL.top - 0.2); cap.lineTo(x1 + 0.4, PORTAL.top - 0.2); cap.lineTo(x1 + 0.4, PORTAL.top + 0.7); cap.lineTo(x0 - 0.4, PORTAL.top + 0.7); cap.closePath();
  const capG = new THREE.ExtrudeGeometry(cap, { depth: 2.0, bevelEnabled: false });
  capG.translate(0, 0, -0.7);
  const parts = [wall, trackify(track, capG, s, sgn)];
  // Wing walls (height falls away from the portal); faces point into the cutting.
  const wingTop = o => 1 + (PORTAL.top - 1) * Math.pow(Math.max(0, 1 - o / PORTAL.wing), 1.4);
  for (const [d, inward] of [[PORTAL.dL, -1], [PORTAL.dR, 1]]) {
    const prof = inward < 0 ? [[d + 0.5, 1], [d, 1], [d, -2.6]] : [[d, -2.6], [d, 1], [d - 0.5, 1]];
    const sA = exit ? s : s - PORTAL.wing, sB = exit ? s + PORTAL.wing : s;
    const g = extrude(track, prof, sA, sB, 2);
    const p = g.attributes.position, tr = g.attributes.aTrack;
    for (let i = 0; i < p.count; i++) {
      if (tr.getZ(i) < 0.5) continue;
      const top = wingTop(Math.abs(tr.getX(i) - s));
      p.setY(i, p.getY(i) + top - 1);
      tr.setZ(i, top);
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    g.computeBoundingSphere();
    parts.push(g);
  }
  for (const g of parts) {
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    setLayers(m, ...ALL);
    group.add(m);
  }
  // Name plates above the opening a driver enters (ours at the entrance, the oncoming one at the exit).
  const f = makeFrame();
  const plateMat = new THREE.MeshBasicMaterial({ map: tunnelPlate(exit ? 'NISHI-KOEN TUNNEL' : 'NISHI-KOEN TUNNEL   L = 640 m'), color: new THREE.Color(0.62, 0.6, 0.56) });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 1.78), plateMat);
  const plateD = exit ? ONCOMING_D : 0;
  track.frame(s - sgn * 0.06, f);
  const pl = f.pos.clone().addScaledVector(f.left, plateD).addScaledVector(f.up, 9.7);
  const fw = new THREE.Vector3(f.fwd.x, 0, f.fwd.z).normalize().multiplyScalar(-sgn);
  const lf = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fw);
  plate.matrix.makeBasis(lf, new THREE.Vector3(0, 1, 0), fw).setPosition(pl);
  plate.matrixAutoUpdate = false;
  setLayers(plate, ...ALL);
  group.add(plate);
  // Flood masts (lighting is analytic, see trackLamps()).
  const ms = s - sgn * LAMP.mast.back;
  const metal = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.5, metalness: 0.7 });
  const lumMat = new THREE.MeshBasicMaterial({ color: LAMP.mast.color.clone().multiplyScalar(30) });
  for (const d of LAMP.mast.rows) {
    track.frame(ms, f);
    const base = f.pos.clone().addScaledVector(f.left, d);
    const H = LAMP.mast.height + 2.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, H, 10).translate(0, H / 2 - 2.6, 0), metal);
    pole.position.copy(base);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.55), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.4), lumMat);
    const aim = new THREE.Group();
    aim.position.copy(base).addScaledVector(f.up, LAMP.mast.height);
    aim.lookAt(track.point(s + sgn * 2, (PORTAL.dL + PORTAL.dR) / 2, 4));
    head.position.z = 0; lens.position.z = 0.28;
    aim.add(head, lens);
    for (const o of [pole, head, lens]) setLayers(o, ...ALL);
    group.add(pole, aim);
  }
  return group;
}

function buildBridge(track) {
  const g = new THREE.Group();
  const f = makeFrame();
  const white = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main(){
        // Uplit white pylon: floodlights from the base, fading with height.
        float up = clamp(vW.y / 110.0, 0.0, 1.0);
        vec3 c = mix(vec3(1.6, 1.7, 1.9), vec3(0.25, 0.3, 0.42), pow(up, 0.7));
        float side = 0.55 + 0.45 * abs(vN.x);
        c *= side;
        float dist = length(vW - cameraPosition);
        c = mix(c, vec3(0.02, 0.022, 0.034), 1.0 - exp(-pow(dist * 0.0012, 2.0)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const cableMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.9, 1.0).multiplyScalar(1.1) });
  const cableGeos = [];
  for (const ps of BRIDGE.pylons) {
    track.frame(ps, f);
    const mid = (LEFT_EDGE + RIGHT_EDGE) / 2;
    const apexH = 72;
    const base = f.pos.y;
    const apex = f.pos.clone().addScaledVector(f.left, mid).add(new THREE.Vector3(0, apexH, 0));
    for (const side of [LEFT_EDGE + 2.2, RIGHT_EDGE - 2.2]) {
      const foot = f.pos.clone().addScaledVector(f.left, side + Math.sign(side - mid) * 6);
      foot.y = 0;
      const deckP = f.pos.clone().addScaledVector(f.left, side);
      const legTop = apex.clone().addScaledVector(f.left, Math.sign(side - mid) * 1.5);
      for (const [a, b, w] of [[foot, deckP, 4.2], [deckP, legTop, 3.0]]) {
        const len = a.distanceTo(b);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w * 1.3), white);
        leg.position.copy(a).add(b).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        // keep the long side aligned with the track
        g.add(leg);
      }
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(LEFT_EDGE - RIGHT_EDGE + 10, 3, 4), white);
    beam.position.copy(f.pos).addScaledVector(f.left, mid).add(new THREE.Vector3(0, -3.5, 0));
    beam.rotation.y = Math.atan2(f.fwd.x, f.fwd.z);
    g.add(beam);
    // Fan of stay cables from the apex to both deck edges.
    for (let i = 1; i <= 12; i++) {
      for (const dir of [-1, 1]) {
        const s = ps + dir * i * 15;
        for (const side of [LEFT_EDGE + 0.9, RIGHT_EDGE - 0.9]) {
          const a = apex.clone().addScaledVector(f.left, 0).add(new THREE.Vector3(0, -i * 1.6, 0));
          const b = track.point(s, side, 0.2);
          const len = a.distanceTo(b);
          const c = new THREE.CylinderGeometry(0.06, 0.06, len, 5, 1, true);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          c.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          cableGeos.push(c);
        }
      }
    }
    void base;
  }
  g.add(new THREE.Mesh(mergeGeometries(cableGeos), cableMat));
  setLayers(g, LAYER.MAIN, LAYER.ENV, LAYER.REFLECT, LAYER.WATER);
  return g;
}
