// Blueprint renderer: beauty (lighting + shadows) pass, G-buffer (normal / linear depth / part id) pass,
// then a full-screen composite shader that draws ink edges, hatching and the ground grid.
import * as THREE from 'three';
// Framed beside the configurator the drawing shares the GPU: three passes at a retina-scale buffer
// would quietly quadruple the work, so the backing buffer and the shadow map come down.
const FRAMED = (() => { try { return !!window.top && window.top !== window; } catch (e) { return true; } })();
import { cutGLSL } from './geom.js';
import { CUT } from './vehicle.js';

const G_VERT = /* glsl */`
out vec3 vN; out float vD; out vec3 vObj;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vD = -mv.z; vObj = position;
  gl_Position = projectionMatrix * mv;
}`;
const G_FRAG = /* glsl */`
precision highp float;
layout(location = 0) out vec4 gNormal;
layout(location = 1) out vec4 gData;
uniform float uId; uniform float uSub; uniform float uDissolve; uniform float uCut; uniform float uLamp;
in vec3 vN; in float vD; in vec3 vObj;
` + cutGLSL(CUT) + `
void main(){
  if (uCut > 0.5 && inAperture(vObj)) discard;
  if (uDissolve < 1.0) { float dn = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453); if (dn > uDissolve) discard; }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  gNormal = vec4(n, 1.0);
  gData = vec4(vD, uId, uSub, 1.0 + uLamp);   // w: 1 any surface, 2 a lamp, 3 a tail lamp
}`;

// 0 nothing, 1 a lamp (glows with the headlamps and the running-light pulse), 2 a tail lamp (red
// with LIGHTS). A mesh may say so itself (userData.lamp, the Roadster's adapter); otherwise the
// RX2's rule: its lamp parts glow whole, and the tail strip is the tail-pill part's sub 0 plus
// the bar across the tail that the liftgate carries as its sub 8.
export function lampKind(v, p, m) {
  if (m.userData.lamp !== undefined) return m.userData.lamp;
  if (v.lampIds?.includes(p.id)) return 1;
  const sub = m.userData.subId || 0;
  if ((p.id === v.tailIds?.[0] && sub < 0.5) || (p.id === v.tailIds?.[1] && sub === 8)) return 2;
  return 0;
}

const C_VERT = /* glsl */`
precision highp float;
in vec3 position; in vec2 uv; out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const C_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tBeauty, tNormal, tData;
uniform vec2 uRes; uniform float uDpr;
uniform mat4 uInvVP; uniform float uGridOffset; uniform float uGridAlpha; uniform float uShadowAlpha;
uniform float uHoverId; uniform float uLampGlow; uniform float uLights; uniform float uNose; uniform float uTail; uniform float uSil;
uniform vec3 uInk, uFill, uFillLight, uAccent;
in vec2 vUv; out vec4 fragColor;

// device-pixel hatch: distance to the nearest stroke with a half-pixel AA band
float hatch(vec2 p, float ang, float period, float width){
  float d = p.x*cos(ang) + p.y*sin(ang);
  float f = abs(fract(d/period) - 0.5) * period;
  return 1.0 - smoothstep(width*0.5 - 0.5, width*0.5 + 0.5, f);
}
// Which surfaces glow is a per-mesh flag the G-buffer carries in data.w (see lampKind below), so a
// lamp can be a whole part (the RX2's headlamps) or one mesh of a larger part (the Roadster's).
bool isLamp(float kind){ return abs(kind - 2.0) < 0.01; }
bool isTail(float kind){ return abs(kind - 3.0) < 0.01; }

void main(){
  vec2 px = 1.0 / uRes;
  vec4 d0 = texture(tData, vUv);
  vec3 n0 = texture(tNormal, vUv).xyz;
  float id0 = d0.y, sub0 = d0.z, dep0 = d0.x;
  bool hit = id0 > 0.5;
  float lit = texture(tBeauty, vUv).r;
  vec2 p = gl_FragCoord.xy;
  if (uSil > 0.5) { fragColor = hit ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0); return; } // silhouette capture mode

  // ---- edge detection: one radius, coverage count → anti-aliased single-weight ink ----
  float r1 = 0.95 * uDpr;
  vec2 O[4]; O[0] = vec2(1.0,0.0); O[1] = vec2(0.0,1.0); O[2] = vec2(0.7071,0.7071); O[3] = vec2(-0.7071,0.7071);
  float cnt = 0.0, silD = 0.0, crease = 0.0, idE = 0.0, hoverN = 0.0;
  float thr = 0.006 + 0.0012 * dep0;
  for (int k = 0; k < 4; k++){
    vec2 o = O[k] * px * r1;
    vec4 da = texture(tData, vUv + o), db = texture(tData, vUv - o);
    vec3 na = texture(tNormal, vUv + o).xyz, nb = texture(tNormal, vUv - o).xyz;
    bool ha = da.y > 0.5, hb = db.y > 0.5;
    cnt += float(ha != hit) + float(hb != hit);
    if (hit){
      if (ha && hb){ float sd = abs(da.x + db.x - 2.0*dep0); silD = max(silD, smoothstep(thr, thr*3.0, sd)); }
      if (ha){ crease = max(crease, smoothstep(0.22, 0.5, 1.0 - dot(na, n0))); idE = max(idE, float(abs(da.y-id0) > 0.01 || abs(da.z-sub0) > 0.01)); }
      if (hb){ crease = max(crease, smoothstep(0.22, 0.5, 1.0 - dot(nb, n0))); idE = max(idE, float(abs(db.y-id0) > 0.01 || abs(db.z-sub0) > 0.01)); }
    }
    if (floor(da.y + 0.5) == uHoverId || floor(db.y + 0.5) == uHoverId) hoverN = 1.0;
  }
  float sil = min(cnt / 3.0, 1.0);
  float line = max(max(sil, silD), max(crease, idE));
  bool hov = floor(id0 + 0.5) == uHoverId && uHoverId > 0.5;
  vec3 lineCol = (hov || (hoverN > 0.5 && uHoverId > 0.5)) ? uAccent : uInk;

  if (hit){
    float per = 4.2 * uDpr;
    vec3 col = mix(uFill, uFillLight, smoothstep(0.55, 1.0, lit));
    float mesh = 0.13 + 0.19 * smoothstep(0.985, 0.60, lit);               // fine ±45° mesh on every face, darker when shaded
    float m = max(hatch(p, 0.7854, per, 1.0), hatch(p, -0.7854, per, 1.0));
    col = mix(col, uInk, mesh * m);
    float h1 = smoothstep(0.58, 0.48, lit) * 0.55;                         // ambient-only / self-shadowed faces
    col = mix(col, uInk, h1 * hatch(p, 0.7854, 5.5 * uDpr, 1.0 * uDpr));
    float h2 = smoothstep(0.46, 0.40, lit) * 0.45;
    col = mix(col, uInk, h2 * hatch(p, -0.7854, 5.5 * uDpr, 1.0 * uDpr));
    if (hov) col = mix(col, uAccent, 0.16);
    if (isLamp(d0.w)) col = mix(col, vec3(1.0, 0.93, 0.70), uLampGlow * 0.75);
    if (isTail(d0.w)) col = mix(col, vec3(0.93, 0.28, 0.20), uLights * 0.75);
    col = mix(col, lineCol, line);
    fragColor = vec4(col, 1.0);
  } else {
    // ground: shadow hatch + perspective grid + vehicle silhouette line
    float sh = 1.0 - smoothstep(0.40, 0.70, lit);
    float a = hatch(p, 0.7854, 9.0 * uDpr, 1.0 * uDpr) * sh * 0.40 * uShadowAlpha;
    vec3 col = uInk;
    // grid via ray/plane, evaluated in uniform control flow (fwidth needs it)
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 p0 = uInvVP * vec4(ndc, -1.0, 1.0); p0 /= p0.w;
    vec4 p1 = uInvVP * vec4(ndc,  1.0, 1.0); p1 /= p1.w;
    vec3 dir = p1.xyz - p0.xyz;
    float dy = (abs(dir.y) < 1e-6) ? 1e-6 : dir.y;
    float t = -p0.y / dy;
    vec3 P = p0.xyz + dir * clamp(t, 0.0, 1.0);
    vec2 g = vec2(P.x + uGridOffset, P.z);
    vec2 fw = max(fwidth(g), vec2(1e-4));
    vec2 q = abs(fract(g - 0.5) - 0.5) / fw;
    float l = 1.0 - min(min(q.x, q.y), 1.0);
    float valid = step(0.0, t) * step(t, 1.0);
    float fade = exp(-length(P.xz) * 0.035);
    a = max(a, l * 0.40 * fade * uGridAlpha * valid);
    // headlamp beam pools and tail glow on the ground when the lights are on
    if (uLights > 0.001 && valid > 0.5){
      float dx = P.x - uNose;
      float beam = smoothstep(0.0, 0.5, dx) * (1.0 - smoothstep(0.5, 8.0, dx)) * (1.0 - smoothstep(0.50 + dx * 0.30, 0.90 + dx * 0.42, abs(P.z)));
      float bx = uTail - P.x;
      float tail = smoothstep(0.0, 0.3, bx) * (1.0 - smoothstep(0.3, 2.2, bx)) * (1.0 - smoothstep(0.7, 1.1, abs(P.z)));
      vec3 warm = vec3(0.98, 0.80, 0.42), red = vec3(0.93, 0.28, 0.20);
      float ba = beam * 0.55 * uLights, ta = tail * 0.45 * uLights;
      if (ba > 0.002 || ta > 0.002){ vec3 lc = (ba >= ta) ? warm : red; float la = max(ba, ta); col = mix(lc, col, a / max(a + la, 1e-4)); a = max(a, la); }
    }
    if (line > 0.01){ col = lineCol; a = max(a, line); }
    fragColor = vec4(col, a);
  }
}`;

export class Blueprint {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.dpr = Math.min(window.devicePixelRatio || 1, FRAMED ? 1.35 : 2);
    // lights (r155+ physical units: Lambert output = (ambient + sun·N·L) / π → lit range ≈ 0.40 .. 1.02)
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.position.set(3.0, 9.0, 4.2); this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -5.2; sc.right = 5.2; sc.top = 5.2; sc.bottom = -5.2; sc.near = 1; sc.far = 30;
    this.sun.shadow.mapSize.set(FRAMED ? 1024 : 2048, FRAMED ? 1024 : 2048); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.01; this.sun.shadow.radius = 3;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    // ground (beauty pass only)
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.scene.add(this.ground);
    // targets
    this.beauty = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, generateMipmaps: false });
    this.gbuf = new THREE.WebGLRenderTarget(2, 2, { count: 2, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
    this.gbuf.textures[0].name = 'normal'; this.gbuf.textures[0].type = THREE.HalfFloatType;
    this.gbuf.textures[1].name = 'data';
    // materials
    this.gMatProto = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: G_VERT, fragmentShader: G_FRAG, uniforms: { uId: { value: 0 }, uSub: { value: 0 }, uDissolve: { value: 1 }, uCut: { value: 0 }, uLamp: { value: 0 } }, side: THREE.DoubleSide });
    const css = getComputedStyle(document.documentElement);
    // colours are authored in sRGB and written raw to the canvas, so keep them un-decoded
    const srgb = (hex) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
    const c = (name, fb) => srgb(css.getPropertyValue(name).trim() || fb);
    this.compMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: C_VERT, fragmentShader: C_FRAG, depthTest: false, depthWrite: false, transparent: false, blending: THREE.NoBlending,
      uniforms: {
        tBeauty: { value: this.beauty.texture }, tNormal: { value: this.gbuf.textures[0] }, tData: { value: this.gbuf.textures[1] },
        uRes: { value: new THREE.Vector2(2, 2) }, uDpr: { value: this.dpr }, uInvVP: { value: new THREE.Matrix4() },
        uGridOffset: { value: 0 }, uGridAlpha: { value: 1 }, uShadowAlpha: { value: 1 }, uHoverId: { value: -1 },
        uLampGlow: { value: 0 }, uLights: { value: 0 }, uNose: { value: 2.31 }, uTail: { value: -2.41 }, uSil: { value: 0 },
        uInk: { value: c('--ink', '#1c2b4f') }, uFill: { value: srgb('#cbd3e2') }, uFillLight: { value: srgb('#eaeef5') },
        uAccent: { value: c('--accent', '#c94b31') },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.vehicleMeshes = [];
    this._vp = new THREE.Matrix4();
  }
  addVehicle(v) {
    this.scene.add(v.root);
    for (const p of v.order) for (const m of p.meshes) {
      const gm = this.gMatProto.clone(); gm.uniforms.uId.value = p.id; gm.uniforms.uSub.value = m.userData.subId || 0; gm.uniforms.uCut.value = m.userData.cut ? 1 : 0;
      gm.uniforms.uLamp.value = lampKind(v, p, m);
      m.userData.gMat = gm; m.userData.beautyMat = m.material; m.userData.shell = p.category === 'shell'; this.vehicleMeshes.push(m);
    }
    this.compMat.uniforms.uNose.value = v.SPEC.NOSE; this.compMat.uniforms.uTail.value = v.SPEC.TAIL;
  }
  // One vehicle is drawn at a time (part ids restart at 1 in every build). Only the per-mesh
  // G-buffer clones made above are disposed; the vehicle's own materials are shared module
  // singletons and stay alive, so the same car can be added again later.
  removeVehicle(v) {
    if (!v) return;
    this.scene.remove(v.root);
    const gone = new Set();
    for (const p of v.order) for (const m of p.meshes) {
      gone.add(m);
      if (m.userData.beautyMat) m.material = m.userData.beautyMat;
      m.userData.gMat?.dispose(); delete m.userData.gMat;
    }
    this.vehicleMeshes = this.vehicleMeshes.filter((m) => !gone.has(m));
  }
  setSize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, FRAMED ? 1.35 : 2);
    this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(w, h, false);
    const W = Math.floor(w * this.dpr), H = Math.floor(h * this.dpr);
    this.beauty.setSize(W, H); this.gbuf.setSize(W, H);
    this.compMat.uniforms.uRes.value.set(W, H); this.compMat.uniforms.uDpr.value = this.dpr;
  }
  render(camera, st) {
    const r = this.renderer;
    // beauty
    r.setRenderTarget(this.beauty); r.setClearColor(0xffffff, 1); r.clear(true, true, true);
    this.ground.visible = true; r.render(this.scene, camera);
    // g-buffer
    const dis = st.shellDissolve ?? 1;
    for (const m of this.vehicleMeshes) { m.material = m.userData.gMat; if (m.userData.shell) m.userData.gMat.uniforms.uDissolve.value = dis; }
    this.ground.visible = false;
    r.setRenderTarget(this.gbuf); r.setClearColor(0x000000, 0); r.clear(true, true, true);
    const sm = r.shadowMap.enabled; r.shadowMap.enabled = false;
    r.render(this.scene, camera);
    r.shadowMap.enabled = sm;
    for (const m of this.vehicleMeshes) m.material = m.userData.beautyMat;
    // composite (straight colour + alpha, no blending; the CSS paper shows through where alpha < 1)
    const u = this.compMat.uniforms;
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvVP.value.copy(this._vp).invert();
    u.uGridOffset.value = st.gridOffset || 0; u.uGridAlpha.value = st.gridAlpha ?? 1; u.uShadowAlpha.value = st.shadowAlpha ?? 1;
    u.uHoverId.value = st.hoverId ?? -1; u.uLampGlow.value = st.lampGlow || 0; u.uLights.value = st.lightsT || 0; u.uSil.value = st.sil ? 1 : 0;
    r.setRenderTarget(null); r.setClearColor(0x000000, 0); r.clear(true, true, true);
    r.render(this.quadScene, this.quadCam);
  }
}
