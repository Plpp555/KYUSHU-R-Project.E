// Post-processing chain (pmndrs/postprocessing):
//   Render → N8AO → Bloom → Lens (radial speed blur + chromatic aberration + vignette)
//   → ACES tone mapping + colour grade + film grain (+ SMAA when MSAA is off)
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  Effect, EffectAttribute, SMAAEffect, SMAAPreset, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

class LensEffect extends Effect {
  constructor() {
    super('LensEffect', /* glsl */`
      uniform float uBlur; uniform float uCA; uniform float uVignette; uniform vec2 uCenter; uniform float uExposure;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec2 dir = uv - uCenter;
        dir.x *= 1.0;
        float r = length(dir);
        float amt = uBlur * smoothstep(0.05, 0.75, r);
        vec3 acc = vec3(0.0);
        float j = h12(uv * 1024.0 + fract(time) * 37.0);
        const int N = 10;
        for (int i = 0; i < N; i++) {
          float t = (float(i) + j) / float(N);
          vec2 o = dir * amt * t;
          vec2 ca = dir * uCA * (0.3 + r * 2.0);
          acc.r += texture2D(inputBuffer, uv - o + ca).r;
          acc.g += texture2D(inputBuffer, uv - o).g;
          acc.b += texture2D(inputBuffer, uv - o - ca).b;
        }
        acc /= float(N);
        float v = smoothstep(0.35, 1.05, r * 1.25);
        acc *= mix(1.0, 1.0 - uVignette, v);
        outputColor = vec4(acc * uExposure, inputColor.a);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uBlur', new THREE.Uniform(0)],
        ['uCA', new THREE.Uniform(0.0012)],
        ['uVignette', new THREE.Uniform(0.42)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.56))],
        ['uExposure', new THREE.Uniform(1.0)],
      ]),
    });
  }
}

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform float uGrain; uniform float uSat; uniform vec3 uShadow; uniform vec3 uHighlight; uniform float uFlash;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        // split toning: cool shadows, warm highlights
        c += uShadow * (1.0 - smoothstep(0.0, 0.35, l)) + uHighlight * smoothstep(0.45, 1.0, l);
        // soft contrast curve
        c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;
        float n = h12(uv * vec2(1920.0, 1080.0) + fract(time * 23.7) * 100.0) - 0.5;
        c += n * uGrain * (1.0 - l * 0.6);
        c = mix(c, vec3(1.0), uFlash);
        outputColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      uniforms: new Map([
        ['uGrain', new THREE.Uniform(0.035)],
        ['uSat', new THREE.Uniform(1.08)],
        ['uShadow', new THREE.Uniform(new THREE.Vector3(-0.004, 0.0, 0.012))],
        ['uHighlight', new THREE.Uniform(new THREE.Vector3(0.02, 0.008, -0.01))],
        ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }
}

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const useAO = quality.ao;
    const msaa = useAO ? 0 : quality.msaa;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (useAO) {
      this.ao = new N8AOPostPass(scene, camera, 16, 16);
      const c = this.ao.configuration;
      c.aoRadius = 1.6;
      c.distanceFalloff = 0.6;
      c.intensity = 2.2;
      c.color = new THREE.Color(0, 0, 0);
      c.halfRes = quality.aoHalf;
      c.gammaCorrection = false;
      this.ao.setQualityMode(quality.aoQuality);
      this.composer.addPass(this.ao);
    }
    this.bloom = new BloomEffect({
      mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.35,
      intensity: quality.bloom, radius: 0.82, levels: quality.bloomLevels,
    });
    this.composer.addPass(new EffectPass(camera, this.bloom));
    this.lens = new LensEffect();
    this.composer.addPass(new EffectPass(camera, this.lens));
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    const finals = [this.tone, this.grade];
    if (!msaa && quality.smaa) finals.unshift(new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.finalPass = new EffectPass(camera, ...finals);
    this.composer.addPass(this.finalPass);
  }
  setCamera(camera) {
    for (const p of this.composer.passes) if (p.mainCamera !== undefined || p.camera !== undefined) p.mainCamera = camera;
    this.renderPass.mainCamera = camera;
    if (this.ao) this.ao.camera = camera;
  }
  setSize(w, h) { this.composer.setSize(w, h, false); }
  render(dt) { this.composer.render(dt); }
}
