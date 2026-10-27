// Arcade HUD drawn on a 2D canvas: tachometer + speedometer, boost gauge, time,
// rival gap meter / course progress, minimap and animated popup messages.
import { clamp } from './util.js';
import { CHECKPOINTS, GOAL_S, START_S } from './course.js';

const NUM = 'Orbitron, "Russo One", sans-serif';
const EN = '"Russo One", Orbitron, sans-serif';
const JP = '"Dela Gothic One", "Noto Sans JP", sans-serif';

export class HUD {
  constructor(canvas, track) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.track = track;
    this.msgs = [];
    this.banner = null;
    this.visible = false;
    this.buildMap();
  }

  buildMap() {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.n; i += 20) { minX = Math.min(minX, t.x[i]); maxX = Math.max(maxX, t.x[i]); minZ = Math.min(minZ, t.z[i]); maxZ = Math.max(maxZ, t.z[i]); }
    this.map = { minX, maxX, minZ, maxZ };
  }

  resize() {
    // Safe-area insets (display cutouts) so nothing important sits under a notch.
    if (!this.probe) {
      this.probe = document.createElement('div');
      this.probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(this.probe);
    }
    const cs = getComputedStyle(this.probe);
    this.safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
  }

  message(text, { sub = '', color = '#ffd21a', dur = 1.6, size = 1, jp = false } = {}) {
    this.msgs = this.msgs.filter(m => m.text !== text);
    this.msgs.push({ text, sub, color, dur, t: 0, size, jp });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  section(name, en) { this.banner = { name, en, t: 0 }; }

  clear() { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.c.width, this.c.height); }

  draw(dt, st) {
    const g = this.g;
    this.clear();
    if (!this.visible) return;
    const sf = this.safe || { l: 0, r: 0, t: 0, b: 0 };
    g.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * sf.l, this.dpr * sf.t);
    const W = this.w - sf.l - sf.r, H = this.h - sf.t - sf.b, u = Math.min(W, H * 1.6) / 100;
    this.u = u;
    if (st.showGauges) {
      this.gauges(st, W, H, u);
      this.timePanel(st, W, H, u);
      this.progress(st, W, H, u);
      this.minimap(st, W, H, u);
    }
    this.banners(dt, W, H, u);
    this.popups(dt, W, H, u);
    if (st.rivalBehind) this.rivalWarn(st, W, H, u);
  }

  glowText(text, x, y, font, fill, glow, blur = 12, align = 'center') {
    const g = this.g;
    g.font = font; g.textAlign = align; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = blur;
    g.fillStyle = fill; g.fillText(text, x, y);
    g.shadowBlur = 0;
  }

  gauges(st, W, H, u) {
    const g = this.g;
    const R = u * 13.5;
    const cx = W - R - u * 3.2, cy = H - R - u * 2.2;
    // Backplate
    const grd = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.08);
    grd.addColorStop(0, 'rgba(10,12,22,0.82)'); grd.addColorStop(0.85, 'rgba(4,5,10,0.78)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 1.08, 0, Math.PI * 2); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const maxRpm = 9000;
    const ang = r => a0 + (a1 - a0) * clamp(r / maxRpm, 0, 1);
    // Rev arc fill
    const rpm = st.rpm;
    g.lineCap = 'butt';
    g.lineWidth = R * 0.1;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath(); g.arc(cx, cy, R * 0.86, a0, a1); g.stroke();
    const hot = rpm > st.redline * 0.93;
    const arcGrad = g.createLinearGradient(cx - R, cy, cx + R, cy);
    arcGrad.addColorStop(0, '#38d8ff'); arcGrad.addColorStop(0.7, '#9af0ff'); arcGrad.addColorStop(1, '#ff2b3a');
    g.strokeStyle = hot ? '#ff2b3a' : arcGrad;
    g.shadowColor = hot ? '#ff2b3a' : '#38d8ff'; g.shadowBlur = R * 0.12;
    g.beginPath(); g.arc(cx, cy, R * 0.86, a0, ang(rpm)); g.stroke();
    g.shadowBlur = 0;
    // Red zone
    g.strokeStyle = 'rgba(255,43,58,0.85)'; g.lineWidth = R * 0.035;
    g.beginPath(); g.arc(cx, cy, R * 0.97, ang(st.redline), a1); g.stroke();
    // Ticks and numerals
    for (let k = 0; k <= 9; k++) {
      const a = ang(k * 1000);
      const ca = Math.cos(a), sa = Math.sin(a);
      g.strokeStyle = k * 1000 >= st.redline ? '#ff4a55' : '#e8f4ff';
      g.lineWidth = R * 0.025;
      g.beginPath(); g.moveTo(cx + ca * R * 0.98, cy + sa * R * 0.98); g.lineTo(cx + ca * R * 0.78, cy + sa * R * 0.78); g.stroke();
      g.font = `700 ${R * 0.13}px ${NUM}`; g.fillStyle = k * 1000 >= st.redline ? '#ff6a72' : '#cfe6ff';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(k), cx + ca * R * 0.64, cy + sa * R * 0.64);
      if (k < 9) {
        const am = ang(k * 1000 + 500);
        g.lineWidth = R * 0.012; g.strokeStyle = 'rgba(232,244,255,0.6)';
        g.beginPath(); g.moveTo(cx + Math.cos(am) * R * 0.98, cy + Math.sin(am) * R * 0.98); g.lineTo(cx + Math.cos(am) * R * 0.88, cy + Math.sin(am) * R * 0.88); g.stroke();
      }
    }
    // Needle
    const na = ang(rpm);
    g.save();
    g.translate(cx, cy); g.rotate(na);
    g.shadowColor = '#ff2b3a'; g.shadowBlur = R * 0.1;
    g.fillStyle = '#ff3b45';
    g.beginPath(); g.moveTo(-R * 0.12, -R * 0.018); g.lineTo(R * 0.93, 0); g.lineTo(-R * 0.12, R * 0.018); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, R * 0.07, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#555'; g.lineWidth = 2; g.stroke();
    // Speed digits
    const kmh = Math.round(st.speed);
    this.glowText(String(kmh).padStart(3, ' '), cx + R * 0.05, cy + R * 0.36, `900 ${R * 0.42}px ${NUM}`, '#ffffff', '#38d8ff', R * 0.12);
    g.font = `700 ${R * 0.1}px ${NUM}`; g.fillStyle = '#9fd8ff'; g.textAlign = 'center';
    g.fillText('km/h', cx + R * 0.05, cy + R * 0.62);
    // Gear
    const gx = cx + R * 0.0, gy = cy - R * 0.25;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.strokeStyle = hot ? '#ff2b3a' : 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(gx - R * 0.15, gy - R * 0.17, R * 0.3, R * 0.32, R * 0.05); g.fill(); g.stroke();
    this.glowText(String(st.gear), gx, gy, `900 ${R * 0.26}px ${NUM}`, hot ? '#ff5a62' : '#ffd21a', hot ? '#ff2b3a' : '#ff9a1a', R * 0.1);
    // Boost gauge (left of tach)
    if (st.boost !== null) {
      const bx = cx - R * 1.32, by = cy + R * 0.48, br = R * 0.36;
      g.fillStyle = 'rgba(6,8,14,0.78)'; g.beginPath(); g.arc(bx, by, br * 1.1, 0, Math.PI * 2); g.fill();
      const b0 = Math.PI * 0.8, b1 = Math.PI * 2.2;
      g.lineWidth = br * 0.16; g.strokeStyle = 'rgba(255,255,255,0.1)';
      g.beginPath(); g.arc(bx, by, br * 0.8, b0, b1); g.stroke();
      const bv = clamp((st.boostBar + 0.6) / 1.8, 0, 1);
      g.strokeStyle = '#ffb21a'; g.shadowColor = '#ff9a1a'; g.shadowBlur = br * 0.3;
      g.beginPath(); g.arc(bx, by, br * 0.8, b0, b0 + (b1 - b0) * bv); g.stroke(); g.shadowBlur = 0;
      g.font = `700 ${br * 0.26}px ${NUM}`; g.fillStyle = '#ffd99a'; g.textAlign = 'center';
      g.fillText('BOOST', bx, by + br * 0.5);
      g.font = `900 ${br * 0.36}px ${NUM}`; g.fillStyle = '#fff';
      g.fillText(st.boostBar.toFixed(1), bx, by + br * 0.06);
    }
    // Driving-aid warning lamps (flash while intervening, steady amber when switched off).
    const lx = cx - R * 1.32, ly = cy - R * 0.2, lw = R * 0.34, lh = R * 0.15;
    const blink = (performance.now() % 240) < 140;
    const lamps = st.assist === 'OFF' ? [['ESC OFF', true]] : [['TCS', st.tcs && blink], ['ESC', st.esc && blink]];
    lamps.forEach(([label, on], i) => {
      const y = ly + i * lh * 1.3;
      const w = label.length > 3 ? lw * 1.5 : lw;
      g.fillStyle = on ? 'rgba(255,170,20,0.92)' : 'rgba(6,8,14,0.6)';
      g.strokeStyle = on ? '#ffd27a' : 'rgba(255,190,90,0.25)'; g.lineWidth = 1.5;
      g.beginPath(); g.roundRect(lx - w / 2, y - lh / 2, w, lh, lh * 0.3); g.fill(); g.stroke();
      g.font = `900 ${lh * 0.62}px ${NUM}`; g.fillStyle = on ? '#1a0e00' : 'rgba(255,200,120,0.35)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, lx, y + lh * 0.04);
    });
  }

  timePanel(st, W, H, u) {
    const g = this.g;
    const x = u * 3, y = u * 3.2;
    g.font = `700 ${u * 1.7}px ${NUM}`; g.fillStyle = '#ffd21a'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const free = st.mode === 'free';
    g.fillText(free ? 'FREE RUN' : 'TIME', x, y);
    const t = free ? st.elapsed : Math.max(0, st.timeLeft);
    const warn = !free && t < 10 && Math.floor(t * 4) % 2 === 0;
    const sec = Math.floor(t), cs = Math.floor((t - sec) * 100);
    const secText = String(sec).padStart(2, '0');
    this.glowText(secText, x, y + u * 4.2, `900 ${u * 7}px ${NUM}`, warn ? '#ff3b45' : '#ffffff', warn ? '#ff2b3a' : '#ff9a1a', u * 1.2, 'left');
    g.font = `900 ${u * 7}px ${NUM}`;
    const w2 = g.measureText(secText).width;
    this.glowText('.' + String(cs).padStart(2, '0'), x + w2 + u * 0.4, y + u * 5.4, `900 ${u * 3}px ${NUM}`, warn ? '#ff3b45' : '#ffffff', '#ff9a1a', u * 0.6, 'left');
    // Elapsed
    const e = st.elapsed;
    const m = Math.floor(e / 60), s = Math.floor(e % 60), c = Math.floor((e * 100) % 100);
    g.font = `700 ${u * 1.5}px ${NUM}`; g.fillStyle = '#cfe6ff'; g.textAlign = 'left';
    g.fillText(`${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`, x, y + u * 9.3);
    if (st.mode === 'battle') {
      g.font = `400 ${u * 1.4}px ${JP}`; g.fillStyle = '#9ad8ff';
      g.fillText(st.zoneName || '', x, y + u * 11.6);
    }
  }

  progress(st, W, H, u) {
    const g = this.g;
    const x0 = W * 0.3, x1 = W * 0.7, y = u * 2.6;
    const total = GOAL_S - START_S;
    const px = s => x0 + (x1 - x0) * clamp((s - START_S) / total, 0, 1);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = u * 0.35;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.strokeStyle = '#ffd21a'; g.lineWidth = u * 0.35;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(px(st.s), y); g.stroke();
    for (const c of CHECKPOINTS) { g.fillStyle = '#ffd21a'; g.fillRect(px(c) - 1, y - u * 0.7, 2, u * 1.4); }
    g.fillStyle = '#fff'; g.fillRect(x1 - 2, y - u, 4, u * 2);
    g.font = `700 ${u * 1.1}px ${NUM}`; g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText('GOAL', x1 + u * 4.5, y);
    const tri = (x, col, up) => {
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8;
      g.beginPath();
      if (up) { g.moveTo(x, y + u * 0.4); g.lineTo(x - u * 0.8, y + u * 1.8); g.lineTo(x + u * 0.8, y + u * 1.8); }
      else { g.moveTo(x, y - u * 0.4); g.lineTo(x - u * 0.8, y - u * 1.8); g.lineTo(x + u * 0.8, y - u * 1.8); }
      g.closePath(); g.fill(); g.shadowBlur = 0;
    };
    if (st.rivalS !== null) tri(px(st.rivalS), '#e8f0ff', false);
    tri(px(st.s), '#ff2b3a', true);
    if (st.rivalS !== null) {
      const gap = st.s - st.rivalS;
      const lead = gap >= 0;
      const txt = (lead ? '+' : '−') + Math.abs(gap).toFixed(0) + 'm';
      this.glowText(txt, W / 2, y + u * 4.4, `900 ${u * 3.4}px ${NUM}`, lead ? '#7dff9a' : '#ff5a62', lead ? '#20ff60' : '#ff2b3a', u);
      g.font = `400 ${u * 1.2}px ${EN}`; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'center';
      g.fillText(lead ? 'LEAD' : 'BEHIND', W / 2, y + u * 6.8);
      // Break-away meter (win by 500m gap)
      const k = clamp(Math.abs(gap) / 500, 0, 1);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(W / 2 - u * 8, y + u * 8, u * 16, u * 0.5);
      g.fillStyle = lead ? '#7dff9a' : '#ff5a62'; g.fillRect(W / 2 - u * 8, y + u * 8, u * 16 * k, u * 0.5);
    }
  }

  minimap(st, W, H, u) {
    const g = this.g, t = this.track, m = this.map;
    const size = u * 15;
    const x0 = W - size - u * 3, y0 = u * 3;
    const sx = (m.maxX - m.minX), sz = (m.maxZ - m.minZ);
    const sc = size / Math.max(sx, sz);
    const ox = x0 + (size - sx * sc) / 2, oy = y0 + (size - sz * sc) / 2;
    const P = (x, z) => [ox + (x - m.minX) * sc, oy + (z - m.minZ) * sc];
    g.fillStyle = 'rgba(4,6,14,0.55)'; g.beginPath(); g.roundRect(x0 - u, y0 - u, size + 2 * u, size + 2 * u, u); g.fill();
    g.strokeStyle = 'rgba(160,210,255,0.85)'; g.lineWidth = u * 0.45; g.lineJoin = 'round';
    g.shadowColor = '#38d8ff'; g.shadowBlur = 6;
    g.beginPath();
    for (let i = 0; i < t.n; i += 10) { const [x, y] = P(t.x[i], t.z[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    const dot = (s, col, r) => { const i = t.index(s); const [x, y] = P(t.x[i], t.z[i]); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    dot(GOAL_S, '#ffffff', u * 0.6);
    if (st.rivalS !== null) dot(st.rivalS, '#e8f0ff', u * 0.75);
    dot(st.s, '#ff2b3a', u * 0.85);
  }

  banners(dt, W, H, u) {
    const b = this.banner;
    if (!b) return;
    b.t += dt;
    const g = this.g;
    const inT = clamp(b.t / 0.35, 0, 1), outT = clamp((b.t - 2.6) / 0.4, 0, 1);
    if (outT >= 1) { this.banner = null; return; }
    const x = -W * 0.4 + (W * 0.4 + u * 3) * (1 - Math.pow(1 - inT, 3)) - outT * W * 0.5;
    const y = H * 0.36;
    g.globalAlpha = 1 - outT;
    const grd = g.createLinearGradient(x, 0, x + W * 0.42, 0);
    grd.addColorStop(0, 'rgba(255,43,58,0.85)'); grd.addColorStop(1, 'rgba(255,43,58,0)');
    g.fillStyle = grd; g.fillRect(x - u * 3, y - u * 2.6, W * 0.45, u * 5.6);
    this.glowText(b.name, x, y - u * 0.3, `400 ${u * 3.6}px ${JP}`, '#fff', '#000', 6, 'left');
    g.font = `400 ${u * 1.3}px ${EN}`; g.fillStyle = '#ffd7a8'; g.textAlign = 'left';
    g.fillText(b.en, x + u * 0.2, y + u * 2.3);
    g.globalAlpha = 1;
  }

  popups(dt, W, H, u) {
    const g = this.g;
    let yOff = 0;
    for (const m of this.msgs) {
      m.t += dt;
      const k = m.t / m.dur;
      if (k >= 1) continue;
      const pop = m.t < 0.15 ? 1.6 - (m.t / 0.15) * 0.6 : 1;
      const a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      g.globalAlpha = a;
      const size = u * 6.5 * m.size * pop;
      const y = H * 0.42 + yOff;
      g.save();
      g.translate(W / 2, y);
      g.transform(1, 0, -0.18, 1, 0, 0);
      this.glowText(m.text, 0, 0, m.jp ? `400 ${size}px ${JP}` : `italic 900 ${size}px ${NUM}`, '#fff', m.color, u * 2.2);
      g.lineWidth = Math.max(1, size * 0.03); g.strokeStyle = m.color; g.strokeText(m.text, 0, 0);
      if (m.sub) this.glowText(m.sub, 0, size * 0.75, `700 ${size * 0.32}px ${NUM}`, m.color, '#000', 4);
      g.restore();
      g.globalAlpha = 1;
      yOff += size * 1.25;
    }
    this.msgs = this.msgs.filter(m => m.t < m.dur);
  }

  rivalWarn(st, W, H, u) {
    const g = this.g;
    const blink = Math.floor(performance.now() / 180) % 2;
    if (!blink) return;
    const x = st.rivalSide > 0 ? W * 0.32 : W * 0.68;
    const y = H * 0.7;
    g.fillStyle = 'rgba(255,43,58,0.9)'; g.shadowColor = '#ff2b3a'; g.shadowBlur = 16;
    g.beginPath();
    const d = st.rivalSide > 0 ? -1 : 1;
    g.moveTo(x + d * u * 2.5, y); g.lineTo(x - d * u * 0.5, y - u * 2.2); g.lineTo(x - d * u * 0.5, y + u * 2.2); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.font = `700 ${u * 1.3}px ${NUM}`; g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText('RIVAL', x - d * u * 0.2, y + u * 3.6);
  }
}
