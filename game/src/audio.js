// Procedural audio (no sample files): engines, turbo, wind, tyres, impacts, UI and a
// 150 BPM eurobeat-style BGM sequencer.
import { clamp } from './util.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

class EngineVoice {
  constructor(ctx, out, { cylinders = 6, character = 'flat6' } = {}) {
    this.ctx = ctx;
    this.cyl = cylinders;
    const real = new Float32Array(24), imag = new Float32Array(24);
    for (let n = 1; n < 24; n++) {
      // Boxer six: strong low orders, gritty upper harmonics. V12: smoother, brighter.
      const base = character === 'v12' ? 1 / Math.pow(n, 0.8) : 1 / Math.pow(n, 1.05);
      imag[n] = base * (n % 3 === 0 ? 1.5 : 1) * (character === 'v12' && n % 2 === 0 ? 1.3 : 1);
      real[n] = (n % 2 ? 0.2 : -0.15) * base;
    }
    this.wave = ctx.createPeriodicWave(real, imag);
    this.o1 = ctx.createOscillator(); this.o1.setPeriodicWave(this.wave);
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.o3 = ctx.createOscillator(); this.o3.type = 'triangle';
    this.g1 = ctx.createGain(); this.g2 = ctx.createGain(); this.g3 = ctx.createGain();
    this.g1.gain.value = 0.5; this.g2.gain.value = character === 'v12' ? 0.12 : 0.22; this.g3.gain.value = 0.35;
    // Uneven firing / rumble: amplitude modulation.
    this.am = ctx.createOscillator(); this.am.type = 'sine';
    this.amGain = ctx.createGain(); this.amGain.gain.value = character === 'v12' ? 0.08 : 0.22;
    this.sum = ctx.createGain(); this.sum.gain.value = 0.8;
    this.am.connect(this.amGain); this.amGain.connect(this.sum.gain);
    this.shaper = ctx.createWaveShaper();
    this.setDrive(2.5);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 2.2;
    this.peak = ctx.createBiquadFilter(); this.peak.type = 'peaking'; this.peak.frequency.value = character === 'v12' ? 1800 : 380; this.peak.gain.value = 5; this.peak.Q.value = 1.2;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.o1.connect(this.g1); this.o2.connect(this.g2); this.o3.connect(this.g3);
    this.g1.connect(this.sum); this.g2.connect(this.sum); this.g3.connect(this.sum);
    this.sum.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.peak); this.peak.connect(this.out);
    this.out.connect(out);
    for (const o of [this.o1, this.o2, this.o3, this.am]) o.start();
    this.character = character;
  }
  setDrive(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
    this.shaper.curve = c;
  }
  set(rpm, throttle, volume) {
    const t = this.ctx.currentTime;
    const f = rpm / 60 * (this.cyl / 2);
    const tc = 0.03;
    this.o1.frequency.setTargetAtTime(f, t, tc);
    this.o2.frequency.setTargetAtTime(f * 0.5 * 1.004, t, tc);
    this.o3.frequency.setTargetAtTime(f * (this.character === 'v12' ? 2.0 : 0.25), t, tc);
    this.am.frequency.setTargetAtTime(f / 3, t, tc);
    this.lp.frequency.setTargetAtTime(350 + rpm * 0.32 + throttle * 2600, t, 0.05);
    this.out.gain.setTargetAtTime(volume * (0.45 + 0.55 * throttle), t, 0.05);
  }
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicVol = 0.5;
    this.sfxVol = 0.9;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicOn ? this.musicVol * 0.5 : 0; this.music.connect(this.master);
    // Simple stereo delay for the music.
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.3;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.28;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.22;
    this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.delayOut); this.delayOut.connect(this.music);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.player = new EngineVoice(ctx, this.sfx, { cylinders: 6, character: 'flat6' });
    this.rivalPan = ctx.createStereoPanner(); this.rivalPan.connect(this.sfx);
    this.rival = new EngineVoice(ctx, this.rivalPan, { cylinders: 12, character: 'v12' });

    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
      return { f, g };
    };
    this.wind = loop('bandpass', 500, 0.6);
    this.turbo = loop('bandpass', 3200, 3);
    this.squeal = loop('bandpass', 950, 9);
    this.scrape = loop('bandpass', 1700, 0.9);
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG); this.whineG.connect(this.sfx); this.whine.start();
    this.seq = new Sequencer(this);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  setMusic(on) {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? this.musicVol * 0.5 : 0, this.ctx.currentTime, 0.3);
  }

  /** Per-frame engine/ambience update. */
  update(p) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = p.active ? 1 : 0;
    this.player.set(p.rpm, p.throttle, 0.34 * on);
    const v = p.speed;
    this.wind.f.frequency.setTargetAtTime(300 + v * 9, t, 0.1);
    this.wind.g.gain.setTargetAtTime(on * Math.min(0.32, Math.pow(v / 90, 2) * 0.32), t, 0.1);
    this.turbo.g.gain.setTargetAtTime(on * p.boost * p.throttle * 0.07, t, 0.05);
    this.whine.frequency.setTargetAtTime(1500 + p.boost * 5200, t, 0.05);
    this.whineG.gain.setTargetAtTime(on * p.boost * 0.018, t, 0.05);
    this.squeal.g.gain.setTargetAtTime(on * clamp((Math.abs(p.slip) - 0.06) * 2.2, 0, 0.35) * clamp(v / 20, 0, 1), t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(850 + Math.random() * 250, t, 0.02);
    this.scrape.g.gain.setTargetAtTime(on * p.wall * clamp(v / 40, 0, 1) * 0.45, t, 0.03);
    // Rival: distance attenuation + pan.
    const rg = p.rival ? clamp(1 - p.rival.dist / 140, 0, 1) ** 1.6 * 0.42 : 0;
    this.rival.set(p.rival ? p.rival.rpm : 1000, p.rival ? p.rival.throttle : 0, rg * on);
    if (p.rival) this.rivalPan.pan.setTargetAtTime(clamp(p.rival.pan, -0.9, 0.9), t, 0.05);
  }

  burst({ freq = 1200, q = 1, dur = 0.4, gain = 0.3, type = 'bandpass', sweep = 0, pan = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    src.connect(f); f.connect(g); g.connect(pn); pn.connect(this.sfx);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(bus || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  bov(amount = 1) { this.burst({ freq: 2600, q: 1.4, dur: 0.5, gain: 0.22 * amount, sweep: 0.5 }); this.burst({ freq: 700, q: 0.7, dur: 0.25, gain: 0.08 * amount }); }
  shift() { this.burst({ freq: 300, q: 0.8, dur: 0.12, gain: 0.12, type: 'lowpass' }); }
  backfire() { for (let i = 0; i < 3; i++) this.burst({ freq: 400 + Math.random() * 300, q: 0.7, dur: 0.07, gain: 0.25, type: 'lowpass', delay: i * 0.06 + Math.random() * 0.03 }); }
  impact(strength = 1, pan = 0) {
    this.burst({ freq: 900, q: 0.6, dur: 0.35 + strength * 0.2, gain: Math.min(0.6, 0.2 + strength * 0.2), type: 'lowpass', pan });
    this.tone(70, 0.35, { gain: Math.min(0.5, 0.25 * strength), slide: 0.5 });
    this.burst({ freq: 3500, q: 2, dur: 0.18, gain: 0.08 * strength, delay: 0.02, pan });
  }
  passBy(pan, strength = 1) { this.burst({ freq: 1400, q: 0.9, dur: 0.55, gain: 0.16 * strength, sweep: 0.35, pan }); }
  beep(hi = false) { this.tone(hi ? 1320 : 660, hi ? 0.7 : 0.25, { type: 'square', gain: 0.12 }); }
  select() { this.tone(980, 0.08, { type: 'square', gain: 0.08 }); }
  confirm() { this.tone(660, 0.1, { type: 'square', gain: 0.09 }); this.tone(1320, 0.18, { type: 'square', gain: 0.09, delay: 0.08 }); }
  checkpoint() { [0, 4, 7, 12].forEach((n, i) => this.tone(NOTE(76 + n), 0.22, { type: 'square', gain: 0.08, delay: i * 0.07 })); }
  nearMiss() { this.tone(NOTE(88), 0.12, { type: 'triangle', gain: 0.07 }); this.tone(NOTE(95), 0.18, { type: 'triangle', gain: 0.07, delay: 0.06 }); }
  fanfare(win) {
    const seq = win ? [72, 76, 79, 84, 79, 84, 88] : [69, 67, 64, 60];
    seq.forEach((n, i) => this.tone(NOTE(n), win ? 0.32 : 0.5, { type: 'sawtooth', gain: 0.07, delay: i * (win ? 0.12 : 0.22), bus: this.music }));
  }
}

// ---------------------------------------------------------------------------------
// BGM: eurobeat-ish, A minor, 150 BPM. Two sections, 8 bars each.
class Sequencer {
  constructor(a) {
    this.a = a;
    this.bpm = 150;
    this.step = 0;
    this.playing = false;
    this.next = 0;
    this.timer = null;
    this.song = 'race';
  }
  start(song = 'race') {
    const ctx = this.a.ctx;
    if (!ctx) return;
    this.song = song;
    this.bpm = song === 'title' ? 128 : 150;
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
  }
  stop() { this.playing = false; clearInterval(this.timer); }
  tick() {
    const ctx = this.a.ctx;
    const spb = 60 / this.bpm / 4;
    while (this.next < ctx.currentTime + 0.14) {
      this.play(this.step, this.next, spb);
      this.next += spb;
      this.step = (this.step + 1) % 256;
    }
  }
  play(step, t, spb) {
    const a = this.a, ctx = a.ctx, bus = a.music;
    const bar = Math.floor(step / 16) % 16, s = step % 16;
    const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64], [53, 57, 60], [55, 59, 62], [55, 59, 62]];
    const chord = prog[bar % 8];
    const sectionB = bar >= 8;
    const title = this.song === 'title';
    const env = (node, g, dur, at = 0.004) => { node.gain.setValueAtTime(0, t); node.gain.linearRampToValueAtTime(g, t + at); node.gain.exponentialRampToValueAtTime(0.0005, t + dur); };
    // Kick (four on the floor)
    if (s % 4 === 0 && !(title && bar % 4 === 3 && s === 12)) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      env(g, title ? 0.5 : 0.75, 0.22);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.25);
    }
    // Clap on 2 and 4
    if (s === 4 || s === 12) {
      const src = ctx.createBufferSource(); src.buffer = a.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 1.1;
      const g = ctx.createGain(); env(g, 0.32, 0.18);
      src.connect(f); f.connect(g); g.connect(bus); g.connect(a.delay); src.start(t, Math.random()); src.stop(t + 0.2);
    }
    // Hats
    {
      const open = s % 4 === 2;
      const src = ctx.createBufferSource(); src.buffer = a.noise;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      const g = ctx.createGain(); env(g, open ? 0.13 : 0.045, open ? 0.12 : 0.03);
      src.connect(f); f.connect(g); g.connect(bus); src.start(t, Math.random()); src.stop(t + 0.14);
    }
    // Eurobeat octave bass on 8ths.
    if (s % 2 === 0) {
      const root = chord[0] - 24 + (s % 4 === 2 ? 12 : 0);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(root);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(240, t + spb * 1.6);
      const g = ctx.createGain(); env(g, 0.2, spb * 1.8);
      o.connect(f); f.connect(g); g.connect(bus); o.start(t); o.stop(t + spb * 2);
    }
    // Off-beat supersaw stabs.
    if (s % 4 === 2 && !title) {
      for (const n of chord) for (const det of [-9, 0, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n + 12); o.detune.value = det;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
        const g = ctx.createGain(); env(g, 0.018, spb * 1.5);
        o.connect(f); f.connect(g); g.connect(bus); g.connect(a.delay); o.start(t); o.stop(t + spb * 1.6);
      }
    }
    // Lead: arpeggio in B, hook melody in A.
    let lead = null;
    if (sectionB) {
      const arp = [0, 1, 2, 1, 0, 1, 2, 3];
      const i = arp[s % 8];
      lead = (i === 3 ? chord[0] + 12 : chord[i]) + 12;
    } else {
      const hook = [12, -1, 12, 14, -1, 15, 14, -1, 12, -1, 10, -1, 7, -1, 10, 12];
      const h = hook[s];
      if (h >= 0 && (bar % 2 === 0 || s < 12)) lead = 57 + h + (bar % 8 >= 4 ? 2 : 0) - (bar % 8 === 3 ? 2 : 0);
    }
    if (lead !== null && !(title && !sectionB)) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = NOTE(lead);
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = NOTE(lead); o2.detune.value = 7;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
      const g = ctx.createGain(); env(g, 0.045, spb * 1.4);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(bus); g.connect(a.delay);
      o.start(t); o2.start(t); o.stop(t + spb * 1.5); o2.stop(t + spb * 1.5);
    }
    // Pad on bar starts.
    if (s === 0) {
      for (const n of chord) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.3); g.gain.linearRampToValueAtTime(0, t + spb * 16);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + spb * 16 + 0.05);
      }
    }
  }
}
