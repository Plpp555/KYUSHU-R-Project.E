// Game controller: arcade flow (attract → select → rival intro → countdown → race →
// finish → result / continue), race rules, collisions, dynamic car lights, camera, HUD, audio.
import * as THREE from 'three';
import { CarVisual } from './cars.js';
import { Vehicle, SPECS } from './physics.js';
import { Rival } from './rival.js';
import { Traffic, collide } from './traffic.js';
import { Autopilot } from './autopilot.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { setCarLights, U } from './lighting.js';
import { LANES, makeFrame } from './track.js';
import { START_S, GOAL_S, CHECKPOINTS, TIME_START, TIME_EXTEND, ZONES, RIVAL } from './course.js';
import { clamp, lerp, wrapAngle, setLayers, LAYER } from './util.js';
import { PRESETS, QUALITY_ORDER } from './quality.js';

const HEAD_COL = new THREE.Color(1, 0.95, 0.86);
const BREAKAWAY = 500;

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx);   // renderer, world, fx, camera, quality, settings, templates, audio, input, hud, ui
    const { world, templates } = this;
    this.track = world.track;
    this.scene = world.scene;
    this.frame = makeFrame();

    // Player: black 930 Turbo.
    this.playerVis = new CarVisual(templates.porsche930, { beams: true });
    this.scene.add(this.playerVis.root);
    this.player = new Vehicle(this.track, SPECS.porsche930);
    // Rival: white Countach.
    this.rivalVis = new CarVisual(templates.countach, { beams: true });
    this.scene.add(this.rivalVis.root);
    this.rival = new Rival(this.track, this.rivalVis, 1);
    this.traffic = new Traffic(world, [templates.integra, templates.rav4, templates.townace], this.quality);
    this.autopilot = new Autopilot(this.track, this.traffic);
    this.rig = new CameraRig(this.camera, this.track);
    this.rig.setMode(this.settings.camera || 'CHASE');
    this.fxp = new Effects(this.scene);

    // Real headlights for lit (standard) materials: cars ahead, piers, signs.
    this.headSpots = [];
    for (let i = 0; i < 2; i++) {
      const sl = new THREE.SpotLight(HEAD_COL, 1400, 140, 0.42, 0.55, 2);
      this.scene.add(sl); this.scene.add(sl.target);
      this.headSpots.push(sl);
    }
    this.spots = Array.from({ length: 6 }, () => ({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), col: new THREE.Color() }));
    this.points = Array.from({ length: 10 }, () => ({ pos: new THREE.Vector3(), col: new THREE.Color() }));

    this.state = 'title';
    this.stateT = 0;
    this.mode = 'battle';
    this.timeScale = 1;
    this.best = JSON.parse(localStorage.getItem('kr_best') || '{}');
    this.passState = new Map();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this.enterTitle();
  }

  // ------------------------------------------------------------------ states
  setState(s) {
    this.state = s; this.stateT = 0;
    if (this.onState) this.onState(s);
  }

  enterTitle() {
    this.setState('title');
    this.ui.title();
    this.hud.visible = false;
    this.input.showTouch(false);
    this.player.reset(420, 0, 180 / 3.6);
    this.autopilot.targetD = 0;
    this.rivalVis.root.visible = false;
    this.traffic.reset(420);
    this.rig.resetCine(0);
    if (this.audio.seq) this.audio.seq.start('title');
  }

  mainMenu() {
    this.setState('menu');
    const it = [
      { label: 'BATTLE', jp: 'バトル — VS 白い亡霊', action: () => this.startRace('battle') },
      { label: 'TIME ATTACK', jp: 'タイムアタック', action: () => this.startRace('timeattack') },
      { label: 'FREE RUN', jp: 'フリーラン', action: () => this.startRace('free') },
      { label: 'SETTINGS', jp: '設定', action: () => this.settingsMenu(() => this.mainMenu()) },
      { label: 'CREDITS', jp: 'クレジット', action: () => this.ui.credits(() => this.mainMenu()) },
    ];
    this.ui.menu('MODE SELECT', it, { onBack: () => this.enterTitle() });
  }

  settingsMenu(back) {
    const s = this.settings;
    const prev = this.state;
    this.pausedSettings = prev === 'pause';
    this.setState('settings');
    const save = () => localStorage.setItem('kr_settings', JSON.stringify(s));
    const cycle = (arr, cur, dir) => arr[(arr.indexOf(cur) + dir + arr.length) % arr.length];
    const items = [
      { label: 'QUALITY', jp: '画質', value: s.quality, action: (dir) => { s.quality = cycle(QUALITY_ORDER, s.quality, dir); this.ui.setValue(0, s.quality + (s.quality !== this.quality.label ? ' *' : '')); save(); } },
      { label: 'STEERING', jp: '操作', value: s.steering, action: (dir) => { s.steering = cycle(['TOUCH', 'TILT'], s.steering, dir); this.input.mode = s.steering.toLowerCase(); this.ui.setValue(1, s.steering); save(); } },
      { label: 'AUTO ACCEL', jp: 'オートアクセル', value: s.autoAccel ? 'ON' : 'OFF', action: () => { s.autoAccel = !s.autoAccel; this.input.autoAccel = s.autoAccel; this.ui.setValue(2, s.autoAccel ? 'ON' : 'OFF'); save(); } },
      { label: 'CAMERA', jp: '視点', value: s.camera, action: (dir) => { s.camera = cycle(['CHASE', 'NEAR', 'BUMPER'], s.camera, dir); this.rig.setMode(s.camera); this.ui.setValue(3, s.camera); save(); } },
      { label: 'WEATHER', jp: '天候・路面', value: s.road, action: (dir) => { s.road = cycle(['WET', 'RAIN', 'DAMP', 'DRY'], s.road, dir); this.applyRoad(); this.ui.setValue(4, s.road); save(); } },
      { label: 'BGM', jp: '音楽', value: s.bgm ? 'ON' : 'OFF', action: () => { s.bgm = !s.bgm; this.audio.setMusic(s.bgm); this.ui.setValue(5, s.bgm ? 'ON' : 'OFF'); save(); } },
      { label: 'DYNAMIC RES', jp: '解像度自動調整', value: s.dynamicRes ? 'ON' : 'OFF', action: () => { s.dynamicRes = !s.dynamicRes; this.ui.setValue(6, s.dynamicRes ? 'ON' : 'OFF'); save(); } },
      { label: 'APPLY & BACK', jp: '戻る', action: () => { save(); if (s.quality !== this.quality.label) location.reload(); else { this.state = prev; this.pausedSettings = false; back(); } } },
    ];
    this.ui.menu('SETTINGS', items, { onBack: () => items[7].action(), hint: '←→ CHANGE   * = RESTART' });
  }

  applyRoad() { this.world.setWeather(this.settings.road); }

  startRace(mode) {
    this.mode = mode;
    const p = this.player;
    p.reset(START_S, mode === 'battle' ? 1.75 : 0, 0);
    this.rivalVis.root.visible = mode === 'battle';
    this.rival.reset(START_S, -1.75);
    this.rival.targetD = -3.5;
    this.rival.difficulty = 1;
    this.autopilot.targetD = mode === 'battle' ? 3.5 : 0;
    this.traffic.reset(START_S, START_S);
    for (const c of this.traffic.cars) if (c.s < START_S + 160) this.traffic.spawnSafe(c, START_S + 160 + Math.random() * 500);
    this.timeLeft = mode === 'free' ? Infinity : TIME_START;
    this.elapsed = 0;
    this.cpIndex = 0;
    this.nearMiss = 0; this.crashes = 0;
    this.zoneIndex = -1;
    this.finished = null;
    this.slipMsgT = 0;
    this.passState = new Map();
    this.timeScale = 1;
    this.rig.resetFollow();
    this.rig.resetCine(0);
    this.hud.visible = false;
    this.audio.seq && this.audio.seq.stop();
    if (mode === 'battle') { this.setState('intro'); this.ui.rivalCard(RIVAL); }
    else { this.setState('countdown'); this.ui.clear(); }
  }

  pause() {
    if (this.state !== 'race' && this.state !== 'countdown') return;
    this.pausedFrom = this.state;
    this.setState('pause');
    this.input.showTouch(false);
    this.ui.pauseMenu({
      resume: () => this.resume(),
      retry: () => this.startRace(this.mode),
      settings: () => this.settingsMenu(() => { this.state = 'pause'; this.pause2(); }),
      quit: () => this.enterTitle(),
    });
  }
  pause2() { this.pausedFrom = this.pausedFrom || 'race'; this.state = 'race'; this.pause(); }
  resume() { this.ui.clear(); this.setState(this.pausedFrom || 'race'); this.input.showTouch(true); }

  onBack() {
    if (this.state === 'race' || this.state === 'countdown') { this.pause(); return 'ok'; }
    if (this.state === 'pause') { this.resume(); return 'ok'; }
    if (this.ui.onBack) { this.ui.onBack(); return 'ok'; }
    if (this.state === 'title') return 'exit';
    this.enterTitle();
    return 'ok';
  }

  // ------------------------------------------------------------------ frame
  update(dtReal) {
    const inp = this.input.poll();
    this.stateT += dtReal;
    const dt = dtReal * this.timeScale;
    const st = this.state;
    if (this.input.pressed('KeyC') && (st === 'race' || st === 'countdown')) {
      this.settings.camera = this.rig.cycle();
      localStorage.setItem('kr_settings', JSON.stringify(this.settings));
    }
    if (this.input.pressed('Escape', 'KeyP') && (st === 'race' || st === 'countdown')) { this.pause(); this.input.endFrame(); return; }
    if (st !== 'race' && st !== 'countdown' && st !== 'pause') this.ui.handle(this.input);

    switch (st) {
      case 'title': this.updateAttract(dt, true); if (this.input.anyPress) { this.audio.init(); this.applyAudio(); this.audio.confirm(); this.mainMenu(); } break;
      case 'menu': this.updateAttract(dt, false); break;
      case 'settings': if (!this.pausedSettings) this.updateAttract(dt, false); break;
      case 'intro': this.updateIntro(dt); break;
      case 'countdown': this.updateCountdown(dt, inp); break;
      case 'race': this.updateRace(dt, inp); break;
      case 'finish': this.updateFinish(dt, inp); break;
      case 'result': this.updateIdleRace(dt); if (this.stateT > 1.2 && (this.input.anyPress)) this.afterResult(); break;
      case 'continue': this.updateContinue(dt); break;
      case 'pause': this.ui.handle(this.input); break;
    }
    if (st !== 'pause' && !(st === 'settings' && this.pausedSettings)) {
      this.fxp.update(dt);
      this.world.update(dt, { s: this.player.s, pos: this.player.pos });
      this.updateLights();
    }
    this.hud.draw(dtReal, this.hudState());
    this.input.endFrame();
  }

  applyAudio() { this.audio.setMusic(this.settings.bgm); if (this.state === 'title' || this.state === 'menu') this.audio.seq.start('title'); }

  updateAttract(dt, title) {
    const p = this.player;
    const inp = this.autopilot.inputs(p, dt);
    p.step(dt, inp);
    if (p.s > GOAL_S - 300) { p.reset(420, 0, 180 / 3.6); this.traffic.reset(420); this.rig.resetCine(0); }
    this.traffic.update(dt, p.s, this.camera);
    this.collideTraffic(true);
    this.syncPlayerVisual(dt);
    this.rig.cinematic(dt, this.carTarget(), { shotLen: 5.5 });
    this.audio.update({ active: 1, rpm: p.rpm, throttle: p.throttle * 0.6, boost: p.boost, speed: p.v, slip: p.slip, wall: p.wallContact, rival: null });
    this.lens(p.v * 0.6);
  }

  updateIntro(dt) {
    // Cars parked on the grid; slow cinematic pass over both.
    this.player.updatePose(dt);
    this.syncPlayerVisual(dt);
    this.rival.update(dt, this.player, this.traffic, false);
    this.traffic.update(dt, this.player.s + 200, this.camera);
    const other = { pos: this.rivalVis.root.position, quat: this.rivalVis.root.quaternion };
    this.rig.cinematic(dt, this.carTarget(), { shotLen: 2.6, shots: ['rivalFront', 'grid'], other });
    this.audio.update({ active: 1, rpm: 1000, throttle: 0.05, boost: 0, speed: 0, slip: 0, wall: 0, rival: this.rivalAudio() });
    if (this.stateT > 5.2 || (this.stateT > 1.0 && this.input.anyPress)) { this.ui.clear(); this.setState('countdown'); this.rig.resetFollow(); }
    this.lens(0);
  }

  updateCountdown(dt, inp) {
    const p = this.player;
    if (this.autodrive) inp = { throttle: this.stateT > 2.5 ? 1 : 0, brake: 0, steer: 0 };
    if (this.stateT < 0.05) { this.hud.visible = true; this.input.showTouch(true); this.countN = 4; }
    // Free revving on the line.
    p.throttle = lerp(p.throttle, inp.throttle, 1 - Math.exp(-10 * dt));
    p.rpm = lerp(p.rpm, p.spec.idle + p.throttle * (p.spec.redline - 1500), 1 - Math.exp(-(inp.throttle > p.throttle ? 9 : 4) * dt));
    p.boost = lerp(p.boost, p.throttle * 0.4, 1 - Math.exp(-2 * dt));
    p.steer = inp.steer;
    p.updatePose(dt);
    this.syncPlayerVisual(dt);
    if (this.mode === 'battle') this.rival.update(dt, p, this.traffic, false);
    this.traffic.update(dt, p.s + 200, this.camera);
    this.rig.follow(dt, this.carTarget());
    const n = 3 - Math.floor(this.stateT - 0.6);
    if (this.stateT > 0.6 && n !== this.countN && n >= 1) { this.countN = n; this.hud.message(String(n), { color: '#38d8ff', dur: 0.9, size: 1.8 }); this.audio.beep(false); }
    if (this.stateT > 3.6) {
      this.hud.message('GO!!', { color: '#ff2b3a', dur: 1.0, size: 2 });
      this.audio.beep(true);
      this.audio.seq && this.settings.bgm && this.audio.seq.start('race');
      this.setState('race');
      p.v = 0.5;
      if (p.throttle > 0.6 && p.rpm > 4500) { p.v = 6; this.hud.message('GOOD START', { sub: 'ROCKET!', color: '#7dff9a', dur: 1.2, size: 0.6 }); }
    }
    this.audio.update({ active: 1, rpm: p.rpm, throttle: p.throttle, boost: p.boost, speed: 0, slip: 0, wall: 0, rival: this.mode === 'battle' ? this.rivalAudio() : null });
    this.lens(0);
  }

  updateRace(dt, inp) {
    const p = this.player;
    if (this.autodrive) { inp = this.autopilot.inputs(p, dt); this.autopilot.cruise = 330 / 3.6; }
    this.elapsed += dt;
    if (this.mode !== 'free') this.timeLeft -= dt;
    p.step(dt, inp);
    if (this.mode === 'battle') this.rival.update(dt, p, this.traffic, true);
    this.traffic.update(dt, p.s, this.camera, this.mode === 'battle' ? [p, this.rival] : [p]);
    this.slipstream(dt);
    this.collideTraffic(false);
    if (this.mode === 'battle') this.collideRival();
    this.handleEvents();
    this.syncPlayerVisual(dt);
    this.rig.follow(dt, this.carTarget());
    this.raceLogic();
    this.audio.update({ active: 1, rpm: p.rpm, throttle: p.throttle, boost: p.boost, speed: p.v, slip: p.slip, wall: p.wallContact, rival: this.mode === 'battle' ? this.rivalAudio() : null });
    this.lens(p.v);
  }

  updateIdleRace(dt) {
    // After the finish: car coasts on autopilot.
    const p = this.player;
    const a = this.autopilot.inputs(p, dt);
    a.throttle *= 0.35;
    p.step(dt, a);
    if (this.mode === 'battle') this.rival.update(dt, p, this.traffic, true);
    this.traffic.update(dt, p.s, this.camera);
    this.syncPlayerVisual(dt);
    this.audio.update({ active: 1, rpm: p.rpm, throttle: p.throttle, boost: p.boost, speed: p.v, slip: 0, wall: 0, rival: this.mode === 'battle' ? this.rivalAudio() : null });
  }

  updateFinish(dt) {
    this.updateIdleRace(dt);
    this.rig.cinematic(dt, this.carTarget(), { shotLen: 3.2, shots: ['front', 'orbit'] });
    this.timeScale = lerp(this.timeScale, this.stateT < 2.4 ? 0.3 : 1, 0.06);
    this.lens(this.player.v * 0.4);
    if (this.stateT > 3.4) {
      this.timeScale = 1;
      this.setState('result');
      this.hud.visible = false;
      this.input.showTouch(false);
      this.ui.result(this.finished);
      this.audio.fanfare(this.finished.outcome === 'win' || this.finished.outcome === 'goal');
    }
  }

  afterResult() {
    const o = this.finished.outcome;
    if (o === 'lose' || o === 'timeup') { this.setState('continue'); this.contN = 10; }
    else this.enterTitle();
  }

  updateContinue(dt) {
    this.updateIdleRace(dt);
    const n = Math.max(0, 9 - Math.floor(this.stateT));
    if (n !== this.contN) { this.contN = n; this.ui.continueScreen(n); this.audio.beep(false); }
    if (this.input.anyPress && this.stateT > 0.4) { this.audio.confirm(); this.startRace(this.mode); }
    else if (this.stateT > 10) this.enterTitle();
  }

  // ------------------------------------------------------------------ race logic
  raceLogic() {
    const p = this.player;
    // Zone banners.
    const zi = ZONES.findIndex(z => p.s >= z.s0 && p.s < z.s1);
    if (zi !== this.zoneIndex) {
      this.zoneIndex = zi;
      if (zi >= 0 && this.stateT > 1.5) this.hud.section(ZONES[zi].name, ZONES[zi].en);
    }
    // Checkpoints.
    if (this.cpIndex < CHECKPOINTS.length && p.s >= CHECKPOINTS[this.cpIndex]) {
      if (this.mode !== 'free') {
        const add = TIME_EXTEND[this.cpIndex];
        this.timeLeft += add;
        this.hud.message('CHECK POINT', { sub: `EXTENDED TIME +${add}`, color: '#ffd21a', dur: 2.2, size: 0.8 });
      }
      this.audio.checkpoint();
      this.cpIndex++;
    }
    if (this.finished) return;
    const gap = p.s - this.rival.s;
    if (this.mode === 'battle') {
      if (p.s >= GOAL_S) return this.finish('win', 'GOAL — 先にゴール！');
      if (this.rival.s >= GOAL_S) return this.finish('lose', 'カウンタックが先にゴール');
      if (gap > BREAKAWAY) return this.finish('win', `${BREAKAWAY}m 引き離した！`);
    } else if (p.s >= GOAL_S) return this.finish('goal', '');
    if (this.timeLeft <= 0) { this.timeLeft = 0; return this.finish('timeup', ''); }
  }

  finish(outcome, reason) {
    const p = this.player;
    const key = this.mode;
    let best = this.best[key];
    if ((outcome === 'win' || outcome === 'goal') && (!best || this.elapsed < best)) { best = this.elapsed; this.best[key] = best; localStorage.setItem('kr_best', JSON.stringify(this.best)); }
    const top = p.topSpeedReached * 3.6;
    let grade = 'C';
    if (outcome === 'win' || outcome === 'goal') {
      const score = (150 - this.elapsed) + this.nearMiss * 2 - this.crashes * 4;
      grade = score > 22 ? 'S' : score > 12 ? 'A' : score > 2 ? 'B' : 'C';
    } else grade = 'D';
    this.finished = { outcome, reason, time: this.elapsed, best, top, nearMiss: this.nearMiss, crashes: this.crashes, gap: this.mode === 'battle' ? p.s - this.rival.s : null, grade };
    const big = outcome === 'win' ? 'YOU WIN' : outcome === 'lose' ? 'YOU LOSE' : outcome === 'timeup' ? 'TIME UP' : 'GOAL';
    this.hud.message(big, { color: outcome === 'win' || outcome === 'goal' ? '#ffd21a' : '#5a7aff', dur: 3.0, size: 1.4 });
    this.setState('finish');
    this.rig.resetCine(0);
  }

  slipstream(dt) {
    const p = this.player;
    let best = 0;
    const consider = (s, d) => {
      const ds = s - p.s;
      if (ds < 4 || ds > 42 || Math.abs(d - p.d) > 1.5) return;
      best = Math.max(best, 1 - (ds - 4) / 38);
    };
    for (const c of this.traffic.cars) if (c.active) consider(c.s, c.d);
    if (this.mode === 'battle') consider(this.rival.s, this.rival.d);
    const active = p.v > 120 / 3.6 ? best : 0;
    p.slipstream = lerp(p.slipstream, active, 1 - Math.exp(-3 * dt));
    this.slipMsgT -= dt;
    if (p.slipstream > 0.55 && this.slipMsgT <= 0) { this.hud.message('SLIPSTREAM', { color: '#38d8ff', dur: 1.2, size: 0.6 }); this.slipMsgT = 6; }
  }

  bodyOf(o) { return { s: o.s, d: o.d, halfL: o.halfL, halfW: o.halfW, mass: o.mass, vS: o.v, vD: o.dVel || o.vD || 0 }; }

  playerBody() {
    const p = this.player;
    const th = this.track.heading(p.s);
    const rel = wrapAngle(p.course - th);
    return { s: p.s, d: p.d, halfL: p.spec.halfLength, halfW: p.spec.halfWidth, mass: p.spec.mass, vS: Math.cos(rel) * p.v, vD: Math.sin(rel) * p.v };
  }

  movePlayer(ds, dd) {
    const f = this.track.frame(this.player.s, this.frame);
    this.player.x += f.fwd.x * ds + f.left.x * dd;
    this.player.z += f.fwd.z * ds + f.left.z * dd;
    this.player.s += ds; this.player.d += dd;
  }

  collideTraffic(attract) {
    const p = this.player;
    const pb = this.playerBody();
    for (const c of this.traffic.cars) {
      if (!c.active || Math.abs(c.s - p.s) > 9) {
        this.trackPass(c, pb, attract);
        continue;
      }
      const hit = collide(pb, this.bodyOf(c));
      this.trackPass(c, pb, attract);
      if (!hit) continue;
      if (hit.axis === 's') {
        this.movePlayer(-hit.sgn * hit.depth * hit.wa, 0);
        c.s += hit.sgn * hit.depth * hit.wb;
        if (hit.vrel < 0) {
          const j = -(1.25) * hit.vrel;
          p.applyImpulse(-hit.sgn * j * hit.wa, 0);
          c.v = Math.max(0, c.v + hit.sgn * j * hit.wb); c.bumped = 2.5;
          c.yawVel += (Math.random() - 0.5) * 2.5;
          this.impact(Math.abs(hit.vrel), c.d - p.d);
        }
      } else {
        this.movePlayer(0, -hit.sgn * hit.depth * hit.wa);
        c.d += hit.sgn * hit.depth * hit.wb;
        if (hit.vrel < 0) {
          const j = -(1.4) * hit.vrel;
          p.applyImpulse(-Math.abs(hit.vrel) * 0.12 * p.v / 30, -hit.sgn * j * hit.wa);
          c.yawVel += hit.sgn * j * 0.25;
          this.impact(Math.abs(hit.vrel) * 0.7, c.d - p.d);
        }
      }
      pb.s = p.s; pb.d = p.d;
    }
    // Rival vs traffic: the AI mostly avoids; resolve overlaps simply.
    if (this.mode === 'battle' && this.state === 'race') {
      const r = this.rival;
      for (const c of this.traffic.cars) {
        if (!c.active || Math.abs(c.s - r.s) > 8) continue;
        const hit = collide(this.bodyOf(r), this.bodyOf(c));
        if (!hit) continue;
        if (hit.axis === 's') { r.s -= hit.sgn * hit.depth; r.v = Math.min(r.v, c.v + 2); c.bumped = 1.5; c.v += 2; }
        else { r.d -= hit.sgn * hit.depth * 0.6; c.d += hit.sgn * hit.depth * 0.4; r.bump(-hit.sgn * 0.6); }
      }
    }
  }

  trackPass(c, pb, attract) {
    if (!c.active) return;
    const ds = c.s - pb.s;
    const prev = this.passState.get(c);
    this.passState.set(c, ds);
    if (prev === undefined || attract) return;
    if (prev > 0 && ds <= 0) {
      const gapD = Math.abs(c.d - pb.d) - c.halfW - pb.halfW;
      const p = this.player;
      if (gapD < 3.2 && p.v > 15) this.audio.passBy(clamp((c.d - pb.d) * -0.3, -1, 1), clamp(p.v / 60, 0.3, 1.2));
      if (gapD > 0 && gapD < 0.85 && p.v * 3.6 > 140 && p.v - c.v > 14) {
        this.nearMiss++;
        this.hud.message('NEAR MISS!', { sub: `×${this.nearMiss}`, color: '#ff60c0', dur: 1.0, size: 0.6 });
        this.audio.nearMiss();
        if (this.mode !== 'free') this.timeLeft += 0.5;
      }
    }
  }

  collideRival() {
    const p = this.player, r = this.rival;
    const hit = collide(this.playerBody(), this.bodyOf(r));
    if (!hit) return;
    if (hit.axis === 's') {
      this.movePlayer(-hit.sgn * hit.depth * hit.wa, 0);
      r.s += hit.sgn * hit.depth * hit.wb;
      if (hit.vrel < 0) {
        const j = -1.2 * hit.vrel;
        p.applyImpulse(-hit.sgn * j * hit.wa, 0);
        r.v = Math.max(0, r.v + hit.sgn * j * hit.wb);
        r.bump((Math.random() - 0.5) * 0.8);
        this.impact(Math.abs(hit.vrel), r.d - p.d);
      }
    } else {
      this.movePlayer(0, -hit.sgn * hit.depth * hit.wa);
      r.d += hit.sgn * hit.depth * hit.wb;
      if (hit.vrel < 0) {
        const j = -1.3 * hit.vrel;
        p.applyImpulse(0, -hit.sgn * j * hit.wa);
        r.vD += hit.sgn * j * hit.wb;
        r.bump(hit.sgn * 0.5);
        this.impact(Math.abs(hit.vrel) * 0.8, r.d - p.d);
      }
    }
  }

  impact(strength, side) {
    if (strength < 1 || this.state !== 'race') return;
    this.crashes += strength > 6 ? 1 : 0;
    this.audio.impact(clamp(strength / 8, 0.3, 2), clamp(-side * 0.4, -1, 1));
    this.rig.addShake(clamp(strength / 10, 0.2, 1.2));
    this.input.haptic(Math.min(120, 20 + strength * 8));
    this.rig.fovKick = 0;
    this.fx.grade.uniforms.get('uFlash').value = Math.min(0.25, strength * 0.02);
  }

  handleEvents() {
    const p = this.player;
    for (const e of p.events) {
      if (e.type === 'shift') { this.audio.shift(); if (e.up && p.throttle > 0.8) this.exhaustFlame(this.playerVis, false); }
      if (e.type === 'bov') { this.audio.bov(e.amount); if (Math.random() < 0.6) { this.audio.backfire(); this.exhaustFlame(this.playerVis, false); } }
      if (e.type === 'wall') {
        this.audio.impact(clamp(e.impact / 8, 0.25, 1.6), e.side * -0.7);
        this.rig.addShake(clamp(e.impact / 12, 0.15, 1));
        this.input.haptic(Math.min(100, 15 + e.impact * 6));
        if (e.impact > 6) this.crashes++;
      }
    }
    p.events.length = 0;
    for (const e of this.rival.events) if (e.type === 'shift' && this.rival.v > 20) this.exhaustFlame(this.rivalVis, true);
    this.rival.events.length = 0;
    // Sparks while scraping a wall.
    if (p.wallContact > 0.5 && p.v > 8) {
      const f = this.track.frame(p.s, this.frame);
      const side = p.d > 0 ? 1 : -1;
      const pt = this._v.copy(p.pos).addScaledVector(f.left, side * p.spec.halfWidth).addScaledVector(f.up, 0.35);
      this.fxp.sparksAt(pt, this._v2.copy(f.fwd).multiplyScalar(-0.3), p.v * 0.5, 4);
      this.fx.grade.uniforms.get('uFlash').value = 0;
    }
  }

  exhaustFlame(vis, blue) {
    const z = -vis.meta.size[2] / 2 - 0.05;
    for (const x of vis === this.playerVis ? [-0.42] : [-0.14, 0.14]) {
      const p = this._v.set(x, 0.38, z).applyMatrix4(vis.root.matrixWorld);
      this.fxp.flame(p, 0.9, blue && Math.random() < 0.5);
    }
  }

  // ------------------------------------------------------------------ visuals
  carTarget() {
    const p = this.player;
    return { pos: p.pos, quat: p.quat, yaw: p.yaw, speed: p.v, steer: p.steer, slip: p.slip, s: p.s };
  }

  syncPlayerVisual(dt) {
    const p = this.player, v = this.playerVis;
    v.root.position.copy(p.pos);
    v.root.quaternion.copy(p.quat);
    v.body.rotation.z = p.bodyRoll;
    v.body.rotation.x = p.bodyPitch;
    v.body.position.y = Math.abs(p.bodyRoll) * 0.2;
    v.root.updateMatrixWorld(true);
    const kmh = p.v * 3.6;
    const steerAngle = p.steer * lerp(0.5, 0.055, clamp(kmh / 300, 0, 1) ** 0.7);
    v.update(dt, p.v, steerAngle);
    v.setBrake(Math.max(p.brake, this.state === 'countdown' ? 1 : 0));
    v.faceCamera(this.camera);
    this.rivalVis.faceCamera(this.camera);
    // Spray from the rear tyres on the wet deck.
    if (U.uWet.value > 0.3 && p.v > 25 && this.quality.label !== 'LOW') {
      const n = Math.min(3, Math.floor(p.v / 25));
      for (const x of [0.7, -0.7]) {
        const pt = this._v.set(x, 0.15, -1.6).applyMatrix4(v.root.matrixWorld);
        this.fxp.sprayAt(pt, this._v2.set(Math.sin(p.course) * p.v, 0, Math.cos(p.course) * p.v).multiplyScalar(0.25), n, new THREE.Color(1, 0.85, 0.7));
      }
    }
  }

  rivalAudio() {
    const r = this.rival;
    const cam = this.camera;
    const rel = this._v.copy(r.visual.root.position).sub(cam.position);
    const dist = rel.length();
    const right = this._v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    return { dist, rpm: r.rpm, throttle: r.throttle, pan: rel.dot(right) / Math.max(dist, 1) };
  }

  lens(v) {
    const kmh = v * 3.6;
    const l = this.fx.lens.uniforms;
    l.get('uBlur').value = clamp((kmh - 150) / 220, 0, 1) * 0.075 * this.quality.lensBlur + this.player.slipstream * 0.02;
    l.get('uCA').value = 0.0008 + clamp(kmh / 340, 0, 1) * 0.0016;
    const fl = this.fx.grade.uniforms.get('uFlash');
    fl.value = Math.max(0, fl.value - 0.02);
  }

  updateLights() {
    const p = this.player, pv = this.playerVis;
    const spots = [], points = [];
    const addHeads = (m, meta, intensity) => {
      const fwd = this._v2.set(m.elements[8], m.elements[9] - 0.06, m.elements[10]).normalize();
      for (const h of meta.lights.head) {
        const s = this.spots[spots.length];
        if (!s) break;
        s.pos.set(h[0], h[1], h[2] + 0.1).applyMatrix4(m);
        s.dir.copy(fwd);
        s.col.copy(HEAD_COL).multiplyScalar(intensity);
        spots.push(s);
      }
    };
    const addTail = (m, meta, brake) => {
      const pt = this.points[points.length];
      if (!pt) return;
      const t = meta.lights.tail[0];
      pt.pos.set(0, t ? t[1] : 0.7, -meta.size[2] / 2 - 0.25).applyMatrix4(m);
      pt.col.setRGB(1, 0.04, 0.02).multiplyScalar(3.5 + brake * 12);
      points.push(pt);
    };
    pv.root.updateMatrixWorld();
    addHeads(pv.root.matrixWorld, pv.meta, 1150);
    addTail(pv.root.matrixWorld, pv.meta, p.brake);
    if (this.rivalVis.root.visible) {
      this.rivalVis.root.updateMatrixWorld();
      addHeads(this.rivalVis.root.matrixWorld, this.rivalVis.meta, 1050);
      addTail(this.rivalVis.root.matrixWorld, this.rivalVis.meta, this.rival.brake);
    }
    // Nearest traffic.
    const near = this.traffic.cars.filter(c => c.active && Math.abs(c.s - p.s) < 160).sort((a, b) => Math.abs(a.s - p.s) - Math.abs(b.s - p.s));
    for (const c of near) {
      if (points.length >= this.points.length) break;
      addTail(c.matrix, c.meta, c.brake);
    }
    const ahead = near.find(c => c.s > p.s + 8);
    if (ahead && spots.length < 6) addHeads(ahead.matrix, ahead.meta, 900);
    setCarLights(spots, points);
    // Three.js spotlights follow the player's headlights.
    for (let i = 0; i < 2; i++) {
      const s = spots[i], sl = this.headSpots[i];
      sl.position.copy(s.pos);
      sl.target.position.copy(s.pos).addScaledVector(s.dir, 30);
      sl.target.updateMatrixWorld();
    }
  }

  hudState() {
    const p = this.player;
    const battle = this.mode === 'battle' && this.state !== 'title' && this.state !== 'menu';
    let rivalBehind = false, rivalSide = 0;
    if (battle && this.state === 'race') {
      const ds = this.rival.s - p.s;
      if (ds < -3 && ds > -35) { rivalBehind = true; rivalSide = this.rival.d > p.d ? 1 : -1; }
    }
    const zone = ZONES[Math.max(0, this.zoneIndex)];
    return {
      showGauges: this.state === 'race' || this.state === 'countdown' || this.state === 'finish',
      speed: p.v * 3.6, rpm: p.rpm, redline: p.spec.redline, gear: this.state === 'countdown' ? 'N' : p.gear,
      boost: p.spec.turbo ? p.boost : null, boostBar: p.throttle > 0.3 ? lerp(-0.2, 1.1, p.boost) : -0.6 + p.boost * 0.4,
      timeLeft: this.mode === 'free' ? 0 : this.timeLeft ?? TIME_START, elapsed: this.elapsed || 0,
      s: p.s, rivalS: battle ? this.rival.s : null, mode: this.mode, zoneName: zone ? zone.name : '',
      rivalBehind, rivalSide,
    };
  }
}

export function defaultSettings() {
  const saved = JSON.parse(localStorage.getItem('kr_settings') || '{}');
  return Object.assign({ quality: 'ULTRA', steering: 'TOUCH', autoAccel: false, camera: 'CHASE', road: 'WET', bgm: true, dynamicRes: true }, saved);
}

export { PRESETS, LANES, setLayers, LAYER };
