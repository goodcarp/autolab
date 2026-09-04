// Orbit rig with a perspective ↔ orthographic projection blend and eased view transitions.
// Presets frame by fit: `fitW` is the frustum width (m) at the target so the vehicle fills the same
// fraction of the sheet as the reference regardless of window aspect; `groundFrac` pins the ground
// datum to a fraction of the stage height in the elevations.
import * as THREE from 'three';
import { easeInOut, lerp } from './geom.js';

const D2R = Math.PI / 180;

export const PRESETS = {
  iso:   { az: 52,  el: 22,   fitW: 6.6,  ortho: 0, up: [0, 1, 0],  drift: true,  ty: 0.72 },
  q34f:  { az: 68,  el: 16,   fitW: 6.0,  ortho: 0, up: [0, 1, 0],  drift: false, ty: 0.75 },
  q34r:  { az: 322, el: 18,   fitW: 6.2,  ortho: 0, up: [0, 1, 0],  drift: false, ty: 0.75 },
  side:  { az: 0,   el: 0,    fitW: 6.85, ortho: 1, up: [0, 1, 0],  drift: false, groundFrac: 0.70 },
  front: { az: 90,  el: 0,    fitW: 4.8,  ortho: 1, up: [0, 1, 0],  drift: false, groundFrac: 0.76 },
  top:   { az: 0,   el: 89.8, fitW: 6.75, ortho: 1, up: [0, 0, -1], drift: false, ty: 0.0 },
};

export class Rig {
  constructor() {
    this.fov = 30; this.near = 0.5; this.far = 80;
    this.aspect = 1.6; this.fitScale = 1; this.tyOffset = 0; this._orthoFade = false;
    // tx/tz offset the orbit target off the vehicle centreline. Presets never use them, but framing
    // one component does: orbiting the origin at close range puts the camera inside the body.
    this.cur = { az: 52, el: 22, dist: 9.0, ortho: 0, up: new THREE.Vector3(0, 1, 0), ty: 0.72, tx: 0, tz: 0 };
    this.from = null; this.to = null; this.t = 0; this.dur = 1.15;
    this.driftOn = true; this.view = 'iso'; this.settled = true; this.onSettle = null; this.userZoom = false;
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, this.near, this.far);
    this._P = new THREE.Matrix4(); this._Po = new THREE.Matrix4(); this._Pp = new THREE.Matrix4();
  }
  frame(p, aspect) {
    const hw = p.fitW * this.fitScale / 2, hh = hw / aspect;
    const dist = hh / Math.tan(this.fov * D2R / 2);
    const ty = (p.groundFrac !== undefined ? (p.groundFrac - 0.5) * 2 * hh : p.ty) + this.tyOffset;
    return { dist, ty };
  }
  goTo(name, dur = 1.15) {
    const p = PRESETS[name]; if (!p) return;
    this.view = name; this.driftOn = !!p.drift; this.settled = false; this.userZoom = false; this._orthoFade = false;
    let az = p.az;
    const c = this.cur.az; const d = (((az - c) % 360) + 540) % 360 - 180; az = c + d;
    const f = this.frame(p, this.aspect);
    this.from = { ...this.cur, up: this.cur.up.clone() };
    this.to = { az, el: p.el, dist: f.dist, ortho: p.ortho, up: new THREE.Vector3(...p.up), ty: f.ty, tx: 0, tz: 0 };
    this.t = 0; this.dur = dur;
    if (dur <= 0) { Object.assign(this.cur, this.to, { up: this.to.up.clone() }); this.from = this.to = null; this.settled = true; }
  }
  // user interaction: break the tween, fall back to perspective
  grab() {
    if (this.from) { this.from = null; this.to = null; }
    this.driftOn = false; this.settled = false; this.view = null;
    if (this.cur.el > 84) this.cur.el = 84; // never blend the up-vector at the pole
    if (this.cur.ortho > 0) { this._orthoFade = true; }
  }
  orbit(dx, dy) { this.cur.az -= dx * 0.35; this.cur.el = Math.max(2, Math.min(86, this.cur.el + dy * 0.3)); }
  zoom(f) { this.userZoom = true; const cl = (d) => Math.max(3.5, Math.min(22, d * f)); this.cur.dist = cl(this.cur.dist); if (this.from && this.to) { this.from.dist = cl(this.from.dist); this.to.dist = cl(this.to.dist); } }
  update(dt) {
    if (this.from && this.to) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const k = easeInOut(this.t), f = this.from, g = this.to, c = this.cur;
      c.az = lerp(f.az, g.az, k); c.el = lerp(f.el, g.el, k); c.dist = lerp(f.dist, g.dist, k);
      c.ortho = lerp(f.ortho, g.ortho, k); c.ty = lerp(f.ty, g.ty, k);
      c.tx = lerp(f.tx || 0, g.tx || 0, k); c.tz = lerp(f.tz || 0, g.tz || 0, k);
      c.up.copy(f.up).lerp(g.up, k).normalize();
      if (this.t >= 1) { this.from = this.to = null; this.settled = true; if (this.onSettle) this.onSettle(this.view); }
    } else {
      if (this._orthoFade) { this.cur.ortho = Math.max(0, this.cur.ortho - dt * 2.2); this.cur.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 4)).normalize(); if (this.cur.ortho === 0 && this.cur.up.y > 0.999) this._orthoFade = false; }
      if (this.driftOn) this.cur.az -= dt * 1.6;
      // keep a settled preset framed correctly when the window aspect changes
      if (this.view && this.settled && !this.userZoom) { const f = this.frame(PRESETS[this.view], this.aspect); this.cur.dist = f.dist; this.cur.ty = f.ty; }
    }
  }
  apply(aspect) {
    this.aspect = aspect;
    const c = this.cur, cam = this.camera;
    const az = c.az * D2R, el = c.el * D2R;
    const target = new THREE.Vector3(c.tx || 0, c.ty, c.tz || 0);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    cam.position.copy(target).addScaledVector(dir, c.dist);
    cam.up.copy(c.up); cam.lookAt(target); cam.updateMatrixWorld(true);
    cam.aspect = aspect;
    const hh = c.dist * Math.tan(this.fov * D2R / 2), hw = hh * aspect;
    this._Pp.makePerspective(-hw * this.near / c.dist, hw * this.near / c.dist, hh * this.near / c.dist, -hh * this.near / c.dist, this.near, this.far);
    this._Po.makeOrthographic(-hw, hw, hh, -hh, this.near, this.far);
    const a = this._Pp.elements, b = this._Po.elements, o = this._P.elements;
    for (let i = 0; i < 16; i++) o[i] = a[i] + (b[i] - a[i]) * c.ortho;
    cam.projectionMatrix.copy(this._P); cam.projectionMatrixInverse.copy(this._P).invert();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  }
  ray(nx, ny) {
    const p0 = new THREE.Vector3(nx, ny, -1).unproject(this.camera);
    const p1 = new THREE.Vector3(nx, ny, 1).unproject(this.camera);
    return new THREE.Ray(p0, p1.sub(p0).normalize());
  }
  // world → CSS px. returns {x,y,z,behind}
  project(v, w, h, out = {}) {
    const p = _tmp.copy(v).applyMatrix4(this.camera.matrixWorldInverse);
    out.behind = p.z > -this.near;
    p.applyMatrix4(this.camera.projectionMatrix);
    out.x = (p.x + 1) * 0.5 * w; out.y = (1 - p.y) * 0.5 * h; out.z = p.z;
    return out;
  }
  // world segment → clipped CSS px segment or null
  projectSegment(a, b, w, h) {
    const pa = _ta.copy(a).applyMatrix4(this.camera.matrixWorldInverse);
    const pb = _tb.copy(b).applyMatrix4(this.camera.matrixWorldInverse);
    const zn = -this.near;
    if (pa.z > zn && pb.z > zn) return null;
    if (pa.z > zn) { const t = (zn - pb.z) / (pa.z - pb.z); pa.copy(pb).lerp(_ta, t); }
    else if (pb.z > zn) { const t = (zn - pa.z) / (pb.z - pa.z); pb.copy(pa).lerp(_tb, t); }
    pa.applyMatrix4(this.camera.projectionMatrix); pb.applyMatrix4(this.camera.projectionMatrix);
    return [(pa.x + 1) * 0.5 * w, (1 - pa.y) * 0.5 * h, (pb.x + 1) * 0.5 * w, (1 - pb.y) * 0.5 * h];
  }
  viewDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); }
}
const _tmp = new THREE.Vector3(), _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
