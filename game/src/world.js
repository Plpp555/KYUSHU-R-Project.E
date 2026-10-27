// Assembles the static world and owns the per-frame "pre-render" work:
// dynamic environment cube (car paint reflections), road and sea planar reflections,
// and a pool of real point lights that follow the street lamps around the player.
import * as THREE from 'three';
import { Track, makeFrame, MEDIAN_D } from './track.js';
import { buildTrack } from './trackmesh.js';
import { buildCity } from './city.js';
import { buildSky, MOON_DIR } from './sky.js';
import { buildLandmarks } from './landmarks.js';
import { buildSigns } from './signs.js';
import { buildJunction } from './junction.js';
import { Rain } from './rain.js';
import { PlanarReflection } from './reflection.js';
import { U, LAMP } from './lighting.js';
import { LAYER } from './util.js';
import { TUNNEL, BRIDGE } from './course.js';

export class World {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(U.uFogColor.value.clone(), U.uFogDensity.value);
    this.track = new Track();
    this.frame = makeFrame();

    this.sky = buildSky();
    this.scene.add(this.sky);
    this.trackGroup = buildTrack(this.track);
    this.scene.add(this.trackGroup);
    this.city = buildCity(this.track, quality);
    this.scene.add(this.city.group);
    this.landmarks = buildLandmarks(this.track);
    this.scene.add(this.landmarks.group);
    this.signs = buildSigns(this.track);
    this.scene.add(this.signs.group);
    this.junction = buildJunction(this.track);
    this.scene.add(this.junction.group);
    this.rain = new Rain(quality.label === 'LOW' ? 3000 : 7000);
    this.scene.add(this.rain.mesh);

    // Global lights (match the custom shaders' ambient terms; see lighting.js).
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    hemi.color.copy(U.uSkyAmb.value).multiplyScalar(Math.PI);
    hemi.groundColor.copy(U.uGroundAmb.value).multiplyScalar(Math.PI);
    this.scene.add(hemi);
    this.hemi = hemi;
    const moon = new THREE.DirectionalLight(0x9fb2ff, 0.06);
    moon.position.copy(MOON_DIR).multiplyScalar(100);
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moon = moon;

    // Lamp light pool: the nearest street lamps as real lights for the cars.
    this.lampPool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(LAMP.color, LAMP.intensity, 42, 2);
      this.scene.add(l);
      this.lampPool.push(l);
    }

    // Dynamic environment for reflective car paint.
    this.envRT = new THREE.WebGLCubeRenderTarget(quality.envSize, { type: quality.hdrType ?? THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.5, 2200, this.envRT);
    for (const c of this.cubeCam.children) c.layers.set(LAYER.ENV);
    this.scene.add(this.cubeCam);
    this.scene.environment = this.envRT.texture;
    this.envCounter = 0;
    this.envPrimed = false;

    // Planar reflections.
    this.roadRefl = new PlanarReflection(quality.roadReflection || 0.5, quality.hdrType ?? THREE.HalfFloatType);
    this.roadRefl.enabled = quality.roadReflection > 0;
    U.uReflTex.value = this.roadRefl.rt.texture;
    U.uReflMat.value = this.roadRefl.textureMatrix;
    this.waterRefl = new PlanarReflection(quality.waterReflection || 0.35, quality.hdrType ?? THREE.HalfFloatType);
    this.waterRefl.enabled = quality.waterReflection > 0;
    this.waterRefl.camera.layers.set(LAYER.WATER);
    this.waterRefl.far = 3000;
    this.city.groundUniforms.uWaterRefl.value = this.waterRefl.rt.texture;
    this.city.groundUniforms.uWaterMat.value = this.waterRefl.textureMatrix;

    this.time = 0;
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  setSize(w, h) {
    this.roadRefl.setSize(w, h);
    this.waterRefl.setSize(w, h);
  }

  /** focus = {s, pos} of the player (or camera target). */
  update(dt, focus) {
    this.time += dt;
    this.lastDt = dt;
    U.uTime.value = this.time;
    this.sky.material.uniforms.uTime.value = this.time;
    this.landmarks.update(this.time);
    this.signs.update(this.time, this.camS ?? 0);
    const js = this.camS ?? 0;
    this.junction.group.visible = js > 4800 && js < 7600;
    if (this.junction.group.visible) this.junction.update(dt);

    // Move the lamp pool to the lamps nearest the focus.
    const s = focus.s;
    const inT = s > TUNNEL.s0 - 10 && s < TUNNEL.s1 + 10;
    const f = this.frame;
    if (inT) {
      const base = Math.round(s / 6) * 6;
      for (let i = 0; i < 6; i++) {
        const k = Math.floor(i / 2) - 1;
        const ls = base + k * 6;
        this.track.point(ls, i % 2 ? -4.6 : 4.6, 5.3, this.lampPool[i].position);
        this.lampPool[i].color.copy(LAMP.tunnelColor);
        this.lampPool[i].intensity = LAMP.tunnelIntensity;
        this.lampPool[i].distance = 16;
      }
    } else {
      const sp = LAMP.spacing;
      const base = Math.round((s - LAMP.offset) / sp) * sp + LAMP.offset;
      for (let i = 0; i < 6; i++) {
        const k = Math.floor(i / 2) - 1;
        let ls = base + k * sp;
        if (ls > TUNNEL.s0 - 4 && ls < TUNNEL.s1 + 4) ls = s < TUNNEL.s0 ? TUNNEL.s0 - 30 : TUNNEL.s1 + 30;
        this.track.point(ls, LAMP.rows[i % 2], LAMP.height, this.lampPool[i].position);
        this.lampPool[i].color.copy(LAMP.color);
        this.lampPool[i].intensity = LAMP.intensity;
        this.lampPool[i].distance = 42;
      }
    }
    this.focusS = s;
    void f; void MEDIAN_D;
  }

  /** Renders reflections and the environment cube before the main frame. */
  setWeather(w) {
    const rain = w === 'RAIN';
    U.uWet.value = rain ? 1.0 : w === 'WET' ? 0.85 : w === 'DAMP' ? 0.45 : 0.0;
    U.uRain.value = rain ? 1 : 0;
    U.uFogDensity.value = rain ? 0.0022 : 0.0016;
    this.scene.fog.density = U.uFogDensity.value;
    this.sky.material.uniforms.uCloud.value = rain ? 1.0 : 0.65;
    this.sky.material.uniforms.uMoonVis.value = rain ? 0 : 1;
    this.rain.setIntensity(rain ? 1 : 0);
  }

  prerender(camera, focusPos) {
    const r = this.renderer;
    this.rain.update(this.lastDt || 0, camera);
    const q = this.quality;
    // Environment cube from just above the player car: a few faces per frame (round robin).
    if (!this.envPrimed) {
      this.cubeCam.position.copy(focusPos).add(this._v.set(0, 1.2, 0));
      this.cubeCam.update(r, this.scene);
      this.envRT.texture.needsPMREMUpdate = true;
      this.envPrimed = true;
      this.envFace = 0;
    } else if (q.envFaces > 0) {
      const cc = this.cubeCam;
      cc.position.copy(focusPos).add(this._v.set(0, 1.2, 0));
      cc.updateMatrixWorld(true);
      const prev = r.getRenderTarget();
      for (let k = 0; k < q.envFaces; k++) {
        const i = this.envFace++ % 6;
        r.setRenderTarget(this.envRT, i);
        r.render(this.scene, cc.children[i]);
      }
      r.setRenderTarget(prev);
      this.envRT.texture.needsPMREMUpdate = true;
    }
    const c0 = r.info.render.calls;
    // Road reflection: mirror about the deck under the camera.
    const cp = camera.position;
    const pr = this.track.project(cp.x, cp.z, this.camS ?? null);
    this.camS = pr.s;
    this.track.frame(pr.s, this.frame);
    const onDeck = Math.abs(pr.d - (-7)) < 20 && cp.y > this.frame.pos.y - 1;
    U.uReflOn.value = this.roadRefl.enabled && onDeck && this.roadRefl.update(r, this.scene, camera, this.frame.pos, this.frame.up) ? 1 : 0;
    // Sea reflection only where the sea is in view.
    const c1 = r.info.render.calls;
    const nearSea = (pr.s < 4900 || this.waterAlways) && !(pr.s > TUNNEL.s0 + 30 && pr.s < TUNNEL.s1 - 30);
    const gu = this.city.groundUniforms;
    gu.uWaterReflOn.value = this.waterRefl.enabled && nearSea && this.waterRefl.update(r, this.scene, camera, this._v.set(0, 0, 0), this._n.set(0, 1, 0)) ? 1 : 0;
    this.stats = { env: c0, road: c1 - c0, water: r.info.render.calls - c1 };
    void BRIDGE;
  }
}
