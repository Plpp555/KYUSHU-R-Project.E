// Planar reflection for the wet road. The mirror plane follows the deck under the
// camera; the road shader samples the (mip-mapped) result projectively and blurs it
// by roughness, which gives the classic rain-soaked night expressway look.
import * as THREE from 'three';
import { LAYER } from './util.js';

export class PlanarReflection {
  constructor(scale = 0.5) {
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(LAYER.REFLECT);
    this.textureMatrix = new THREE.Matrix4();
    this.plane = new THREE.Plane();
    this.clipPlane = new THREE.Vector4();
    this._v = { view: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3(),
      camPos: new THREE.Vector3(), rot: new THREE.Matrix4(), q: new THREE.Vector4() };
    this.enabled = true;
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(16, Math.floor(w * this.scale)), Math.max(16, Math.floor(h * this.scale)));
  }

  update(renderer, scene, camera, point, normal) {
    if (!this.enabled) return false;
    const { view, target, look, camPos, rot, q } = this._v;
    const vc = this.camera;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(point, camPos);
    if (view.dot(normal) > 0) return false;
    view.reflect(normal).negate().add(point);

    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(point, look).reflect(normal).negate().add(point);

    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.updateMatrixWorld();
    // Same projection as the main camera but with a nearer far plane (cheaper culling);
    // the sky is drawn at the far plane in clip space so it still appears.
    const far0 = camera.far;
    camera.far = Math.min(far0, this.far || 1600);
    camera.updateProjectionMatrix();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    camera.far = far0;
    camera.updateProjectionMatrix();

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane = mirror plane, so nothing below the deck leaks in.
    this.plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(vc.matrixWorldInverse);
    const cp = this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = vc.projectionMatrix.elements;
    q.x = (Math.sign(cp.x) + pm[8]) / pm[0];
    q.y = (Math.sign(cp.y) + pm[9]) / pm[5];
    q.z = -1.0;
    q.w = (1.0 + pm[10]) / pm[14];
    cp.multiplyScalar(2.0 / cp.dot(q));
    pm[2] = cp.x; pm[6] = cp.y; pm[10] = cp.z + 1.0 - 0.003; pm[14] = cp.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevAuto;
    return true;
  }
}
