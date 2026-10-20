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

// G-buffer ids that are not car parts. A car's parts count up from 1; the props a run puts on the
// sheet (the ramp, its frame, the start line) take 200..239, one id per prop; the gas takes 250.
export const PROP_ID_MIN = 200, PROP_ID_MAX = 239, GAS_ID = 250;

// The same G-buffer output for a prop that is an InstancedMesh: each instance's matrix first.
// (three.js declares instanceMatrix for an InstancedMesh; non-uniform scale is undone on the
// normal the way its own shaders do it.)
const G_VERT_INST = /* glsl */`
out vec3 vN; out float vD; out vec3 vObj;
void main(){
  vec4 lp = instanceMatrix * vec4(position, 1.0);
  mat3 im = mat3(instanceMatrix);
  vec3 on = im * (normal / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
  vec4 mv = modelViewMatrix * lp;
  vN = normalize(normalMatrix * on);
  vD = -mv.z; vObj = lp.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// The gas in the G-buffer. A puff is a sphere drawn on a disc that faces the camera (the disc
// where the eye's tangent cone touches it, about its centre): the fragment shader finds the
// sphere along each pixel's ray for its normal, and puts in the normal target's w how far
// inside its own outline the pixel is, in device px, so the composite can ink an exact,
// anti-aliased round outline. Its depth is the disc's: puffs stack as round cut-outs (the one
// in front shows whole, its outline over the one behind) and are hidden by the car and the
// ramp where they are behind that disc. (A per-pixel sphere depth, gl_FragDepth, turns off the
// GPU's early depth test and costs three times as much in a dense cloud.) data.z is a number
// of its own per puff (so neighbouring puffs never read as one surface), data.w is 4 + its tone
// + 2 x its radius in device px. Anything under the ground (y < 0) is cut away, so a puff on
// the ground is a dome sitting on it.
const GAS_PUFF_VERT = /* glsl */`
uniform float uSubBase; uniform float uNear; uniform vec4 uEye;
in float aTone;
out vec3 vC; out float vR; out float vTone; out float vCy; out float vD; flat out float vSub;
void main(){
  vec4 wc = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  float r = length((modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xyz);
  vec3 c = (viewMatrix * wc).xyz;
  // gas drifting at the camera (a chase camera sits in the exhaust) shrinks away before it
  // reaches the lens instead of filling the view: from 4 m of clear air to 1 m past the near plane
  float dEye = uEye.w > 1e-6 ? length(c - uEye.xyz / uEye.w) : -c.z;
  r *= smoothstep(uNear + 1.0, uNear + 4.0, dEye - r);
  vC = c; vR = r; vTone = aTone; vCy = wc.y; vSub = uSubBase + float(gl_InstanceID);
  // empty, or (still) so near the camera it would fill the view: not drawn
  if (r <= 1e-4 || -c.z - r < uNear + 0.25) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // Every ray from the eye that meets the sphere crosses the disc where the eye's tangent cone
  // touches it: a square on that disc, square to the eye's line to the centre, holds the
  // sphere's outline exactly in any projection (uEye is the projection's centre in view space;
  // w = 0, an eye at infinity, is the orthographic case).
  vec3 toC = c * uEye.w - uEye.xyz;
  float L = max(length(toC), 1e-6);
  vec3 a = toC / L;
  float k = clamp(r * uEye.w / L, 0.0, 0.999);
  float rho = r * sqrt(1.0 - k * k) * 1.02;
  vec3 e1 = normalize(cross(a, abs(a.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), e2 = cross(e1, a);
  vec3 q = c - a * (r * k) + (e1 * position.x + e2 * position.y) * rho;
  vD = -q.z;
  gl_Position = projectionMatrix * vec4(q, 1.0);
}`;
const GAS_PUFF_FRAG = /* glsl */`
precision highp float;
layout(location = 0) out vec4 gNormal;
layout(location = 1) out vec4 gData;
uniform float uId; uniform mat4 uProj, uProjInv; uniform vec2 uRes; uniform vec3 uUpV;
in vec3 vC; in float vR; in float vTone; in float vCy; in float vD; flat in float vSub;
void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 a = uProjInv * vec4(ndc, -1.0, 1.0); a.xyz /= a.w;
  vec4 b = uProjInv * vec4(ndc, 1.0, 1.0); b.xyz /= b.w;
  vec3 rd = normalize(b.xyz - a.xyz), oc = a.xyz - vC;
  float B = dot(oc, rd), q2 = max(dot(oc, oc) - B * B, 0.0), h = vR * vR - q2;
  if (h < 0.0) discard;
  vec3 p = a.xyz + rd * (-B - sqrt(h));
  if (vCy + dot(p - vC, uUpV) < 0.0) discard;
  float pxPerM = 0.5 * uRes.y * uProj[1][1] / max((uProj * vec4(vC, 1.0)).w, 1e-4);
  gNormal = vec4((p - vC) / vR, (vR - sqrt(q2)) * pxPerM);
  // w: 4 + tone (0..1) + 2 x the puff's radius in whole device px (so a small puff's line thins)
  gData = vec4(vD, uId, vSub, 4.0 + clamp(vTone, 0.0, 1.0) + 2.0 * min(floor(vR * pxPerM + 0.5), 4000.0));
}`;
// A jet's plume: an instanced mesh (one instance per firing jet). Its tone runs along its
// length (position.y is 0 at the nozzle, 1 at the tip) so the hot core near the nozzle can be
// lighter than its end. normal.w = -1 tells the composite to find its outline from neighbours.
const GAS_PLUME_VERT = /* glsl */`
uniform float uSubBase; uniform float uToneAlong;
in float aTone;
out vec3 vN; out float vD; out float vTone; out float vY; flat out float vSub;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  mat3 im = mat3(instanceMatrix);
  vec3 on = im * (normal / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
  vN = normalize(normalMatrix * on);
  vD = -mv.z; vY = wp.y; vTone = aTone + uToneAlong * position.y; vSub = uSubBase + float(gl_InstanceID);
  gl_Position = projectionMatrix * mv;
}`;
const GAS_PLUME_FRAG = /* glsl */`
precision highp float;
layout(location = 0) out vec4 gNormal;
layout(location = 1) out vec4 gData;
uniform float uId;
in vec3 vN; in float vD; in float vTone; in float vY; flat in float vSub;
void main(){
  if (vY < 0.0) discard;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  gNormal = vec4(n, -1.0);
  gData = vec4(vD, uId, vSub, 4.0 + clamp(vTone, -0.5, 1.0));
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
uniform vec2 uFocus; uniform float uPools; uniform float uGridReach;
uniform vec3 uSunV, uGasPaper, uGasPale, uGasTint; uniform float uGasLine, uGasLineVar; uniform vec4 uGasShade;
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

// ---- the gas (id 250): cel-shaded, three flat tones and a bold ink outline, no hatching ----
const vec2 O8[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
                           vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
// The light on the gas: the sun on its normal, wrapped (0 its far side .. 1 facing the sun),
// lifted as the puff ages and thins (tone 0 dense .. 1 thin: uGasShade.z per unit of tone about
// uGasShade.w), and paper white for a plume's hot core (tone below 0).
float gasLight(vec3 n, float tone){
  float v = dot(n, uSunV) * 0.5 + 0.5;
  v += (tone - uGasShade.w) * uGasShade.z;
  return mix(v, 1.3, clamp(-tone * 2.5, 0.0, 1.0));
}
// Three flat tones: the mid ink tint in the shade, the pale blue-grey between, the paper in the
// light (band edges uGasShade.x and .y). g is how fast the light changes across a pixel, so a
// band's edge is one pixel soft.
vec3 gasFill(float v, float g){
  float w = g * 0.6 + 0.004;
  float a = smoothstep(uGasShade.x - w, uGasShade.x + w, v), b = smoothstep(uGasShade.y - w, uGasShade.y + w, v);
  return mix(mix(uGasTint, uGasPale, a), uGasPaper, b);
}
vec4 gasPixel(vec2 px, vec4 d0, vec4 nw){
  bool plume = nw.w < 0.0;
  float dep0 = d0.x, id0 = d0.y, sub0 = d0.z, tone = d0.w - 4.0, rpx = 1e4;
  if (!plume) { rpx = floor(tone * 0.5); tone -= 2.0 * rpx; }   // a puff: tone and its radius in px
  vec3 n = normalize(nw.xyz);
  float v = gasLight(n, tone);
  float T = min(uGasLine * uDpr, 0.6 + 0.3 * rpx);              // a small puff keeps some fill
  // A puff knows how far inside its own outline this pixel is. The line is heavier on the side
  // away from the sun and lighter toward it, as an inker weights a line (uGasLineVar 0: even).
  float Tp = T * mix(1.0 + uGasLineVar, 1.0 - 0.6 * uGasLineVar, smoothstep(-0.2, 0.7, dot(n, uSunV)));
  float ink = plume ? 0.0 : 1.0 - smoothstep(Tp - 0.6, Tp + 0.6, nw.w);
  float g = 0.0, cntP = 0.0;
  for (int k = 0; k < 8; k++){
    vec2 o = O8[k] * px;
    vec4 da = texture(tData, vUv + o);
    vec4 na = texture(tNormal, vUv + o);
    bool same = abs(da.y - id0) < 0.5 && abs(da.z - sub0) < 0.5;
    if (same) g = max(g, abs(gasLight(normalize(na.xyz), tone) - v));
    // a puff in front of this pixel, its outline right there: the outline's outer pixel falls
    // partly on this side (deeper inside it, this is where two puffs cut into each other: no line)
    else if (abs(da.y - 250.0) < 0.5 && na.w >= 0.0 && na.w < 1.6 && da.x < dep0) ink = max(ink, clamp(na.w - 0.5, 0.0, 1.0));
    if (plume){
      // a plume's outline: neighbours out to the line's width that are not this plume and lie
      // behind it (or are nothing at all)
      for (int j = 1; j <= 2; j++){
        vec4 db = texture(tData, vUv + O8[k] * px * T * 0.5 * float(j));
        bool other = db.y < 0.5 || ((abs(db.y - id0) > 0.5 || abs(db.z - sub0) > 0.5) && db.x > dep0 - 0.02);
        cntP += other ? 1.0 : 0.0;
      }
    }
  }
  if (plume) ink = max(ink, clamp(cntP / 2.5, 0.0, 1.0));
  vec3 col = mix(gasFill(v, g), uInk, ink);
  return vec4(col, 1.0);
}

void main(){
  vec2 px = 1.0 / uRes;
  vec4 d0 = texture(tData, vUv);
  vec3 n0 = texture(tNormal, vUv).xyz;
  float id0 = d0.y, sub0 = d0.z, dep0 = d0.x;
  bool hit = id0 > 0.5;
  float lit = texture(tBeauty, vUv).r;
  vec2 p = gl_FragCoord.xy;
  if (uSil > 0.5) { fragColor = hit ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0); return; } // silhouette capture mode
  if (abs(id0 - 250.0) < 0.5) { fragColor = gasPixel(px, d0, texture(tNormal, vUv)); return; }

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
    // around the car in a run (uFocus), the origin otherwise; reaching further the higher a run's
    // camera is (uGridReach), so the ground still shows under a car up on the overhang
    float fade = exp(-length(P.xz - uFocus) * 0.035 / uGridReach);
    a = max(a, l * 0.40 * fade * uGridAlpha * valid);
    // headlamp beam pools and tail glow on the ground when the lights are on
    if (uPools > 0.5 && uLights > 0.001 && valid > 0.5){
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

// The centre of a projection (the eye) in view space, homogeneous: the point every ray of the
// projection comes from. (0, 0, 0, 1) for a perspective camera, (0, 0, 1, 0) for an orthographic
// one (an eye at infinity behind it), and between for the sheet's blend of the two. It is the
// null vector of the matrix's x, y and w rows.
export function projectionCentre(P, out = new THREE.Vector4()) {
  const e = P.elements, rows = [0, 1, 3].map((i) => [e[i], e[4 + i], e[8 + i], e[12 + i]]);
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const minor = (skip) => rows.map((r) => r.filter((_, j) => j !== skip));
  out.set(det3(minor(0)), -det3(minor(1)), det3(minor(2)), -det3(minor(3)));
  if (out.w < 0 || (out.w === 0 && out.z < 0)) out.negate();
  const l = Math.hypot(out.x, out.y, out.z, out.w);
  return l > 0 ? out.multiplyScalar(1 / l) : out.set(0, 0, 0, 1);
}

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
        // a run: the grid fades around the car instead of the origin; the lamp pools can go off
        uFocus: { value: new THREE.Vector2(0, 0) }, uPools: { value: 1 }, uGridReach: { value: 1 },
        // the gas: the sun's direction in view space (set every frame), its three tones and its line
        uSunV: { value: new THREE.Vector3(0, 1, 0) }, uGasLine: { value: 2.2 }, uGasLineVar: { value: 0.6 }, uGasShade: { value: new THREE.Vector4(0.24, 0.56, 0.45, 0.45) },
        uGasPaper: { value: c('--paper', '#f4f6fa') }, uGasPale: { value: srgb('#cdd5e3') },
        uGasTint: { value: c('--ink', '#1c2b4f').lerp(srgb('#f4f6fa'), 0.52) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.vehicleMeshes = [];
    this._vp = new THREE.Matrix4();
    // Props and gas (a run's ramp and thruster gas). Nothing three.js is made for them until the
    // first one arrives, so the sheet without a run builds and draws exactly as before.
    this.extras = null; this.props = new Map(); this.propMeshes = []; this.gasMeshes = []; this.focus = null;
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

  // ---- props and gas: what a run adds to the drawing ------------------------------------------
  // They live in one group that is shown only while render() draws, so anything else that draws
  // bp.scene (the WebMCP part-id pass) sees the car alone.
  _extras() {
    this.props ??= new Map(); this.propMeshes ??= []; this.gasMeshes ??= [];
    if (!this.extras) { this.extras = new THREE.Group(); this.extras.name = 'run props and gas'; this.extras.visible = false; this.scene.add(this.extras); }
    return this.extras;
  }
  // Any Object3D (the ramp, its frame, the start line) drawn like the car: the RX2's white Lambert
  // in the light pass, receiving the car's shadow (casting one only with castShadow: the sun's
  // shadow covers a few metres round the car, so a big prop's own shadow would end at its edge),
  // and in the G-buffer a clone of the car's material with this prop's id (200..239) and each
  // mesh's userData.subId, so the composite inks its edges and hatches its shade. Only meshes
  // are drawn; a line or sprite inside it is hidden while it is on the sheet.
  addProp(object3d, { id, castShadow = false } = {}) {
    if (!object3d?.isObject3D) throw new TypeError('addProp needs an Object3D');
    if (!Number.isInteger(id) || id < PROP_ID_MIN || id > PROP_ID_MAX) throw new RangeError(`a prop's id is an integer in ${PROP_ID_MIN}..${PROP_ID_MAX}, not ${id}`);
    const extras = this._extras();
    if (this.props.has(object3d)) this.removeProp(object3d);
    const white = (this._propWhite ??= new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    const made = [];
    object3d.traverse((o) => {
      if (o.isMesh) {
        const proto = o.isInstancedMesh ? (this._gMatInst ??= Object.assign(this.gMatProto.clone(), { vertexShader: G_VERT_INST })) : this.gMatProto;
        const gm = proto.clone(); gm.uniforms.uId.value = id; gm.uniforms.uSub.value = o.userData.subId || 0;
        made.push({ o, material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, gMat: o.userData.gMat, beautyMat: o.userData.beautyMat });
        o.material = white; o.castShadow = !!castShadow; o.receiveShadow = true;
        o.userData.gMat = gm; o.userData.beautyMat = white;
        this.propMeshes.push(o);
      } else if ((o.isLine || o.isPoints || o.isSprite) && o.visible) { made.push({ o, hidden: true }); o.visible = false; }
    });
    this.props.set(object3d, { parent: object3d.parent, made });
    extras.add(object3d);
    return object3d;
  }
  // Takes the prop off the sheet and gives it back as it came: its own materials, shadow flags,
  // visibility and parent. Disposes only the G-buffer clones addProp made.
  removeProp(object3d) {
    const rec = this.props?.get(object3d);
    if (!rec) return false;
    const gone = new Set();
    for (const e of rec.made) {
      if (e.hidden) { e.o.visible = true; continue; }
      gone.add(e.o);
      e.o.userData.gMat.dispose();
      e.o.material = e.material; e.o.castShadow = e.castShadow; e.o.receiveShadow = e.receiveShadow;
      if (e.gMat === undefined) delete e.o.userData.gMat; else e.o.userData.gMat = e.gMat;
      if (e.beautyMat === undefined) delete e.o.userData.beautyMat; else e.o.userData.beautyMat = e.beautyMat;
    }
    this.propMeshes = this.propMeshes.filter((m) => !gone.has(m));
    this.extras.remove(object3d);
    if (rec.parent) rec.parent.add(object3d);
    this.props.delete(object3d);
    return true;
  }
  // The gas (ink-gas.js): an InstancedMesh drawn in the G-buffer pass only, with the gas id. kind
  // 'puffs' is a sphere per instance on a camera-facing square (instanceMatrix = centre and
  // radius); 'plume' is a mesh per instance. subBase keeps two meshes' instances apart. Its light
  // comes from its own normal and the sun in the composite, so it has no part in the light pass.
  addGas(mesh, { kind = 'puffs', subBase = 0, toneAlong = 0 } = {}) {
    if (!mesh?.isInstancedMesh) throw new TypeError('addGas needs an InstancedMesh');
    const extras = this._extras();
    const shared = (this._gasU ??= { uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(2, 2) }, uUpV: { value: new THREE.Vector3(0, 1, 0) }, uNear: { value: 0.5 }, uEye: { value: new THREE.Vector4(0, 0, 0, 1) } });
    const gm = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      vertexShader: kind === 'plume' ? GAS_PLUME_VERT : GAS_PUFF_VERT, fragmentShader: kind === 'plume' ? GAS_PLUME_FRAG : GAS_PUFF_FRAG,
      uniforms: { uId: { value: GAS_ID }, uSubBase: { value: subBase }, uToneAlong: { value: toneAlong }, ...shared },
    });
    mesh.userData.gasMaterial = mesh.material; mesh.material = gm; mesh.userData.gMat = gm;
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
    this.gasMeshes.push(mesh); extras.add(mesh);
    return mesh;
  }
  removeGas(mesh) {
    const i = this.gasMeshes?.indexOf(mesh) ?? -1;
    if (i < 0) return false;
    this.gasMeshes.splice(i, 1); this.extras.remove(mesh);
    mesh.userData.gMat.dispose(); delete mesh.userData.gMat;
    mesh.material = mesh.userData.gasMaterial; delete mesh.userData.gasMaterial; mesh.visible = true;
    return true;
  }
  // Where the car is in a run. The ground grid stays put in the world (no streaming offset) and
  // fades around this point, the sun's shadow (kept ±5.2 m, so the car's shadow stays sharp)
  // and the light pass's ground follow it. setFocus(null) gives back the sheet's own: grid
  // streaming with st.gridOffset and fading round the origin, sun and ground where they were.
  setFocus(x, y, z) {
    const u = this.compMat.uniforms.uFocus.value;
    if (x == null || !Number.isFinite(+x)) {
      this.focus = null; u.set(0, 0);
      this.sun.position.set(3.0, 9.0, 4.2); this.sun.target.position.set(0, 0, 0); this.ground.position.set(0, 0, 0);
      return;
    }
    this.focus = { x: +x, y: +y || 0, z: +z || 0 }; u.set(this.focus.x, this.focus.z);
  }
  // The headlamp and tail-lamp pools on the ground assume the car at the origin heading +x: off
  // for a run, on again after it.
  setPools(on) { this.compMat.uniforms.uPools.value = on ? 1 : 0; }
  // Sun, shadow and ground on the focus. The shadow camera moves in whole shadow-map texels
  // across the light, so the car's shadow edge does not shimmer as it drives.
  _placeSun() {
    const f = this.focus, sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const p = (this._fp ??= new THREE.Vector3()).set(f.x, f.y, f.z);
    if (!this._sunR) {
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(3.0, 9.0, 4.2), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      this._sunR = new THREE.Vector3().setFromMatrixColumn(m, 0); this._sunU = new THREE.Vector3().setFromMatrixColumn(m, 1);
    }
    for (const a of [this._sunR, this._sunU]) { const d = p.dot(a); p.addScaledVector(a, Math.round(d / texel) * texel - d); }
    this.sun.target.position.copy(p); this.sun.position.set(p.x + 3.0, p.y + 9.0, p.z + 4.2);
    this.ground.position.set(f.x, 0, f.z);
  }
  setSize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, FRAMED ? 1.35 : 2);
    this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(w, h, false);
    const W = Math.floor(w * this.dpr), H = Math.floor(h * this.dpr);
    this.beauty.setSize(W, H); this.gbuf.setSize(W, H);
    this.compMat.uniforms.uRes.value.set(W, H); this.compMat.uniforms.uDpr.value = this.dpr;
  }
  render(camera, st) {
    const r = this.renderer, ex = this.extras;
    if (this.focus) this._placeSun();
    if (ex) { ex.visible = true; for (const m of this.gasMeshes) m.visible = false; }
    // beauty
    r.setRenderTarget(this.beauty); r.setClearColor(0xffffff, 1); r.clear(true, true, true);
    this.ground.visible = true; r.render(this.scene, camera);
    // g-buffer
    const dis = st.shellDissolve ?? 1;
    for (const m of this.vehicleMeshes) { m.material = m.userData.gMat; if (m.userData.shell) m.userData.gMat.uniforms.uDissolve.value = dis; }
    if (ex) {
      for (const m of this.propMeshes) m.material = m.userData.gMat;
      if (this.gasMeshes.length) {
        const g = this._gasU;
        g.uProj.value.copy(camera.projectionMatrix); g.uProjInv.value.copy(camera.projectionMatrix).invert();
        g.uRes.value.set(this.gbuf.width, this.gbuf.height); g.uNear.value = camera.near ?? 0.1;
        g.uUpV.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
        projectionCentre(camera.projectionMatrix, g.uEye.value);
        (this.gasEye ??= new THREE.Vector3()).setFromMatrixPosition(camera.matrixWorld);   // ink-gas.js draws the puffs nearest first
        for (const m of this.gasMeshes) m.visible = true;
      }
    }
    this.ground.visible = false;
    r.setRenderTarget(this.gbuf); r.setClearColor(0x000000, 0); r.clear(true, true, true);
    const sm = r.shadowMap.enabled; r.shadowMap.enabled = false;
    r.render(this.scene, camera);
    r.shadowMap.enabled = sm;
    for (const m of this.vehicleMeshes) m.material = m.userData.beautyMat;
    if (ex) { for (const m of this.propMeshes) m.material = m.userData.beautyMat; ex.visible = false; }
    // composite (straight colour + alpha, no blending; the CSS paper shows through where alpha < 1)
    const u = this.compMat.uniforms;
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvVP.value.copy(this._vp).invert();
    // in a run the grid is fixed to the world (the car moves, not the ground)
    u.uGridOffset.value = this.focus ? 0 : st.gridOffset || 0;
    u.uGridAlpha.value = st.gridAlpha ?? 1; u.uShadowAlpha.value = st.shadowAlpha ?? 1;
    // and its fade reaches further the higher the camera (1 on the sheet; 2.6 under the overhang)
    u.uGridReach.value = this.focus ? 1 + Math.max(0, camera.matrixWorld.elements[13]) / 12 : 1;
    u.uHoverId.value = st.hoverId ?? -1; u.uLampGlow.value = st.lampGlow || 0; u.uLights.value = st.lightsT || 0; u.uSil.value = st.sil ? 1 : 0;
    if (ex) u.uSunV.value.copy(this.sun.position).sub(this.sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    r.setRenderTarget(null); r.setClearColor(0x000000, 0); r.clear(true, true, true);
    r.render(this.quadScene, this.quadCam);
  }
}
