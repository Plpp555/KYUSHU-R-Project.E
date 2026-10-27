// Overhead gantries: green guide signs, orange LED information boards, speed limit
// signs, arcade CHECK POINT banners and the GOAL gate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SIGNS, CHECKPOINTS, GOAL_S } from './course.js';
import { makeFrame, MEDIAN_D, HALF_W } from './track.js';
import { canvasTexture, LAYER, setLayers } from './util.js';

const JP = '"Dela Gothic One", "Noto Sans JP", sans-serif';
const EN = '"Russo One", "Roboto", sans-serif';
const ALL = [LAYER.MAIN, LAYER.ENV, LAYER.REFLECT];

function guideTexture(sign) {
  const panels = sign.lines.length;
  return canvasTexture(512 * panels, 384, (g, w, h) => {
    for (let p = 0; p < panels; p++) {
      const x0 = p * 512;
      g.fillStyle = '#0a6b45';
      g.fillRect(x0 + 6, 6, 500, h - 12);
      g.strokeStyle = '#f4f4f0'; g.lineWidth = 8;
      g.beginPath(); g.roundRect(x0 + 16, 16, 480, h - 32, 18); g.stroke();
      const [jp, en, sub] = sign.lines[p];
      g.fillStyle = '#f7f7f2'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `110px ${JP}`;
      g.fillText(jp, x0 + 256, 150, 440);
      g.font = `44px ${EN}`;
      g.fillText(en, x0 + 256, 236, 440);
      // Distance / exit plate.
      if (sub) {
        const exit = /EXIT|出口/.test(sub);
        g.fillStyle = exit ? '#f4f4f0' : 'rgba(0,0,0,0)';
        if (exit) { g.beginPath(); g.roundRect(x0 + 136, 280, 240, 70, 10); g.fill(); }
        g.fillStyle = exit ? '#0a6b45' : '#f7f7f2';
        g.font = `48px ${JP}`;
        g.fillText(sub, x0 + 256, 318, 230);
      }
      // Arrow pointing down to the lanes.
      g.fillStyle = '#f7f7f2';
      const ax = x0 + 64;
      g.beginPath(); g.moveTo(ax, 300); g.lineTo(ax + 34, 300); g.lineTo(ax + 17, 340); g.closePath(); g.fill();
      g.fillRect(ax + 11, 262, 12, 40);
    }
    if (sign.route) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(w - 140, 26, 112, 64, 12); g.fill();
      g.fillStyle = '#0a4f9b'; g.beginPath(); g.roundRect(w - 134, 32, 100, 52, 9); g.fill();
      g.fillStyle = '#fff'; g.font = `38px ${JP}`; g.textAlign = 'center'; g.fillText(sign.route, w - 84, 60);
    }
  });
}

function ledTexture(text, color = '#ff9a1a') {
  return canvasTexture(1024, 160, (g, w, h) => {
    g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.font = `96px ${JP}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 6, w - 40);
    // Dot-matrix mask.
    g.fillStyle = '#050505';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 3, h);
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 3);
  });
}

function speedTexture(limit) {
  return canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, 124, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d81e1e'; g.lineWidth = 28; g.beginPath(); g.arc(w / 2, w / 2, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1b3fa0'; g.font = `bold 120px ${EN}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(limit), w / 2, w / 2 + 6);
  });
}

function bannerTexture(text, a = '#ffd21a', b = '#000') {
  return canvasTexture(1024, 192, (g, w, h) => {
    g.fillStyle = b; g.fillRect(0, 0, w, h);
    const sq = 24;
    for (let x = 0; x < w; x += sq) for (const y of [0, h - sq]) {
      g.fillStyle = ((x / sq) % 2) ? '#fff' : '#111'; g.fillRect(x, y, sq, sq);
    }
    g.fillStyle = a; g.font = `italic 118px ${EN}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = a; g.shadowBlur = 20;
    g.fillText(text, w / 2, h / 2 + 6);
  });
}

function placeAt(obj, track, s, d, h, f) {
  track.frame(s, f);
  const p = f.pos.clone().addScaledVector(f.left, d).addScaledVector(f.up, h);
  const left = new THREE.Vector3(f.fwd.z, 0, -f.fwd.x).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, new THREE.Vector3(0, 1, 0));
  obj.matrix.makeBasis(left, new THREE.Vector3(0, 1, 0), fwd).setPosition(p);
  obj.matrixAutoUpdate = false;
  obj.matrixWorldNeedsUpdate = true;
  return obj;
}

function gantry(span, height, steel) {
  // Two posts + a box truss beam. Local: x across (left = +x), y up, z forward.
  const geos = [];
  const [dl, dr] = span;
  for (const d of [dl, dr]) geos.push(new THREE.BoxGeometry(0.45, height + 0.8, 0.45).translate(d, (height + 0.8) / 2, 0));
  const w = dl - dr, cx = (dl + dr) / 2;
  geos.push(new THREE.BoxGeometry(w, 0.18, 0.18).translate(cx, height, 0.5));
  geos.push(new THREE.BoxGeometry(w, 0.18, 0.18).translate(cx, height, -0.5));
  geos.push(new THREE.BoxGeometry(w, 0.18, 0.18).translate(cx, height + 0.9, 0.5));
  geos.push(new THREE.BoxGeometry(w, 0.18, 0.18).translate(cx, height + 0.9, -0.5));
  for (let x = dr; x <= dl; x += 1.2) {
    geos.push(new THREE.BoxGeometry(0.08, 0.9, 0.08).translate(x, height + 0.45, 0.5));
    geos.push(new THREE.BoxGeometry(0.08, 0.9, 0.08).translate(x, height + 0.45, -0.5));
  }
  return new THREE.Mesh(mergeGeometries(geos), steel);
}

export function buildSigns(track) {
  const group = new THREE.Group();
  group.name = 'signs';
  const f = makeFrame();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9096, metalness: 0.8, roughness: 0.4 });
  const leds = [];
  const signLightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.7) });

  for (const sign of SIGNS) {
    const g = new THREE.Group();
    g.add(gantry([HALF_W + 0.5, MEDIAN_D], 6.6, steel));
    if (sign.kind === 'guide') {
      const panels = sign.lines.length;
      const pw = 5.6 * panels, ph = 4.2;
      const tex = guideTexture(sign);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) }));
      m.position.set(-0.3, 6.6 + ph / 2 - 0.7, -0.62);
      m.rotation.y = Math.PI;
      g.add(m);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 }));
      back.position.set(-0.3, 6.6 + ph / 2 - 0.7, -0.6);
      g.add(back);
      // Sign lights under the panel.
      const lg = [];
      for (let x = -pw / 2 + 1; x < pw / 2; x += 2.4) lg.push(new THREE.BoxGeometry(0.5, 0.12, 0.25).translate(x - 0.3, 6.6 - 0.85, -1.2));
      g.add(new THREE.Mesh(mergeGeometries(lg), signLightMat));
    } else {
      const tex = ledTexture(sign.text);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), mat);
      m.position.set(-0.4, 7.4, -0.62);
      m.rotation.y = Math.PI;
      g.add(m);
      const box = new THREE.Mesh(new THREE.BoxGeometry(10.4, 2.0, 0.5), new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.5, roughness: 0.6 }));
      box.position.set(-0.4, 7.4, -0.3);
      g.add(box);
      leds.push(mat);
    }
    placeAt(g, track, sign.s, 0, 0, f);
    g.updateMatrixWorld(true);
    setLayers(g, LAYER.MAIN, LAYER.REFLECT);
    group.add(g);
  }

  // Speed limit signs (60 km/h — the real limit on the urban expressway).
  const spTex = speedTexture(60);
  const spMat = new THREE.MeshBasicMaterial({ map: spTex, transparent: true, color: new THREE.Color(1.2, 1.2, 1.2) });
  const poles = [], discs = [];
  const tmp = new THREE.Object3D();
  for (let s = 260; s < GOAL_S; s += 900) {
    placeAt(tmp, track, s, HALF_W + 0.35, 0, f);
    poles.push(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3 + 1.1, 0).applyMatrix4(tmp.matrix));
    discs.push(new THREE.CircleGeometry(0.6, 32).rotateY(Math.PI).translate(0, 3.6, 0).applyMatrix4(tmp.matrix));
  }
  const speedSigns = new THREE.Group();
  speedSigns.add(new THREE.Mesh(mergeGeometries(poles), steel), new THREE.Mesh(mergeGeometries(discs), spMat));
  setLayers(speedSigns, LAYER.MAIN, LAYER.REFLECT);
  group.add(speedSigns);

  // Arcade banners.
  const cpTex = bannerTexture('CHECK POINT');
  for (const s of CHECKPOINTS) {
    const g = new THREE.Group();
    g.add(gantry([HALF_W + 0.5, MEDIAN_D], 6.4, steel));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 2.3), new THREE.MeshBasicMaterial({ map: cpTex, color: new THREE.Color(2.2, 2.2, 2.2) }));
    m.position.set(-0.4, 7.6, -0.62); m.rotation.y = Math.PI;
    g.add(m);
    placeAt(g, track, s, 0, 0, f);
    g.updateMatrixWorld(true);
    setLayers(g, ...ALL);
    group.add(g);
  }
  const goal = new THREE.Group();
  goal.add(gantry([HALF_W + 0.5, MEDIAN_D], 6.4, steel));
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 2.6), new THREE.MeshBasicMaterial({ map: bannerTexture('GOAL', '#ff3030'), color: new THREE.Color(2.6, 2.6, 2.6) }));
  gm.position.set(-0.4, 7.7, -0.62); gm.rotation.y = Math.PI;
  goal.add(gm);
  placeAt(goal, track, GOAL_S, 0, 0, f);
  goal.updateMatrixWorld(true);
  setLayers(goal, ...ALL);
  group.add(goal);

  const gantries = group.children.filter(c => c !== speedSigns);
  for (const g of gantries) { g.userData.s = track.project(g.matrix.elements[12], g.matrix.elements[14]).s; }
  return {
    group,
    update(t, camS = 0) {
      for (const m of leds) m.color.setScalar(2.0 + 0.3 * Math.sin(t * 2.0));
      for (const g of gantries) g.visible = Math.abs(g.userData.s - camS) < 1400;
    },
  };
}
