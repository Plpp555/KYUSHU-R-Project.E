import './style.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/russo-one/400.css';
import '@fontsource/dela-gothic-one/400.css';
import * as THREE from 'three';
import { World } from './world.js';
import { PostFX } from './postfx.js';
import { PRESETS } from './quality.js';
import { loadCar } from './cars.js';
import { Game, defaultSettings } from './game.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { CHECKPOINTS } from './course.js';
const CHECKPOINTS_IDX = s => CHECKPOINTS.filter(c => c <= s).length;

const params = new URLSearchParams(location.search);
const settings = defaultSettings();
const quality = PRESETS[params.get('q') || settings.quality] || PRESETS.ULTRA;
settings.quality = quality.label;

const $ = id => document.getElementById(id);
const progress = (k, msg) => { $('ld-fill').style.width = Math.round(k * 100) + '%'; if (msg) $('ld-msg').textContent = msg; };
const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

async function loadFonts() {
  const fams = ['700 40px Orbitron', '900 40px Orbitron', '400 40px "Russo One"', '400 40px "Dela Gothic One"'];
  const sample = '天神博多百道荒津大橋千鳥橋月隈西公園出口香椎空港太宰府福岡都市高速環状線速度注意強風順調分駅中洲屋台焼鳥居酒屋めんたいとんこつラーメンカラオケ九州この先トンネルバトル白い亡霊';
  try { await Promise.race([Promise.all(fams.map(f => document.fonts.load(f, sample))), new Promise(r => setTimeout(r, 4000))]); } catch (e) { /* system fallback */ }
}

async function boot() {
  progress(0.02, 'LOADING FONTS…');
  await loadFonts();
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: params.has('capture') });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); $('ld-msg').textContent = 'GPU RESET…'; $('loading').classList.remove('hide'); });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  progress(0.08, 'BUILDING FUKUOKA…');
  await tick();
  const world = new World(renderer, quality);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 5200);
  const fx = new PostFX(renderer, world.scene, camera, quality);

  progress(0.3, 'LOADING CARS…');
  const ids = ['porsche930', 'countach', 'integra', 'rav4', 'townace'];
  const prog = Object.fromEntries(ids.map(i => [i, 0]));
  const upd = () => progress(0.3 + 0.55 * Object.values(prog).reduce((a, b) => a + b, 0) / ids.length);
  const list = await Promise.all(ids.map(id => loadCar(id, k => { prog[id] = k; upd(); }).then(t => { prog[id] = 1; upd(); return t; })));
  const templates = Object.fromEntries(list.map(t => [t.id, t]));

  const audio = new AudioSys();
  const input = new Input($('touch'));
  input.mode = settings.steering.toLowerCase();
  input.autoAccel = settings.autoAccel;
  const hud = new HUD($('hud'), world.track);
  const ui = new UI($('ui'), audio);
  const game = new Game({ renderer, world, fx, camera, quality, settings, templates, audio, input, hud, ui });
  game.applyRoad();

  let resScale = 1;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const pr = Math.max(0.5, Math.min(quality.maxPixelRatio, dpr, Math.max(1, quality.targetHeight / h)) * resScale);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    fx.setSize(w, h);
    world.setSize(w * pr, h * pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    hud.resize();
  }
  addEventListener('resize', resize);
  resize();

  // Warm up: compile shaders and prime reflections before revealing the game.
  progress(0.9, 'COMPILING SHADERS…');
  await tick();
  game.update(1 / 60);
  world.prerender(camera, game.player.pos);
  if (renderer.compileAsync) { try { await renderer.compileAsync(world.scene, camera); } catch (e) { /* optional */ } }
  fx.render(1 / 60);
  progress(1, 'READY');

  window.__onBack = () => game.onBack();
  window.__appPause = () => { audio.suspend(); if (game.state === 'race' || game.state === 'countdown') game.pause(); };
  window.__appResume = () => audio.resume();
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.__appPause(); else window.__appResume(); });

  // Debug / screenshot hooks: ?race=battle&at=4000
  if (params.has('autodrive')) {
    game.autodrive = true;
    window.__log = [];
    game.onState = st => window.__log.push([st, +game.elapsed?.toFixed?.(2) || 0, Math.round(game.player.s), Math.round(game.rival.s), game.finished && game.finished.outcome]);
  }
  if (params.has('race')) {
    audio.init();
    game.startRace(params.get('race'));
    if (params.has('at')) {
      const at = +params.get('at');
      game.player.reset(at, +(params.get('pd') || 0), +(params.get('pv') || 220) / 3.6);
      game.rival.reset(at + +(params.get('rg') || 25), -3.5); game.rival.v = game.player.v;
      game.traffic.reset(at, at);
      game.ui.clear(); game.hud.visible = true; game.input.showTouch(true);
      game.cpIndex = CHECKPOINTS_IDX(at); game.timeLeft = 90;
      game.setState('race'); game.rig.resetFollow();
    }
    if (params.has('cam')) game.rig.setMode(params.get('cam'));
  }
  window.__game = { game, world, renderer, camera, fx };

  $('loading').classList.add('hide');
  setTimeout(() => { $('loading').style.display = 'none'; }, 900);
  let last = performance.now();
  let frames = 0;
  const fixedDt = params.has('dt') ? +params.get('dt') : 0;
  const noRender = params.has('norender');
  // Dynamic resolution: effects stay on, only the render scale adapts to hold ~40+ fps.
  let ema = 1 / 60, slowT = 0, fastT = 0;
  function adaptResolution(rawDt) {
    if (!settings.dynamicRes || fixedDt) return;
    ema += (Math.min(rawDt, 0.2) - ema) * 0.05;
    if (ema > 1 / 38) { slowT += rawDt; fastT = 0; } else if (ema < 1 / 56) { fastT += rawDt; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT > 1.5 && resScale > 0.6) { resScale = Math.max(0.6, resScale - 0.1); slowT = 0; resize(); }
    if (fastT > 5 && resScale < 1) { resScale = Math.min(1, resScale + 0.05); fastT = 0; resize(); }
  }
  function loop(now) {
    const rawDt = (now - last) / 1000;
    adaptResolution(rawDt);
    let dt = Math.min(0.05, rawDt);
    if (fixedDt) dt = fixedDt;
    last = now;
    renderer.info.autoReset = false;
    renderer.info.reset();
    game.update(dt);
    if (!noRender) {
      world.prerender(camera, game.player.pos);
      fx.render(dt);
    }
    frames++;
    window.__frames = frames;
    window.__stats = Object.assign({}, world.stats, { total: renderer.info.render.calls });
    window.__calls = renderer.info.render.calls; window.__tris = renderer.info.render.triangles;
    if (window.__capture) {
      // Debug capture (same task as the draw, so the drawing buffer is still valid).
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const g2 = c2.getContext('2d');
      g2.drawImage(canvas, 0, 0);
      g2.drawImage($('hud'), 0, 0, c2.width, c2.height);
      window.__shot = c2.toDataURL('image/png');

      window.__capture = false;
    }
    window.__ft = performance.now() - now;
    if (window.__pause) { window.__paused = true; return; }
    if (noRender) setTimeout(() => loop(performance.now()), 0); else requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot().catch(e => {
  console.error(e);
  const m = $('ld-msg');
  if (m) m.textContent = 'ERROR: ' + e.message;
});
