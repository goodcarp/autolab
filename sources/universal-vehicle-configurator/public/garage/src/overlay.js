// SVG overlay: numbered leader callouts, dimension lines, datum lines, detail circle, section arrows,
// exploded-view guide lines and the FLASH ray burst. Everything is re-projected every frame.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const fmt = (mm) => { const s = String(Math.round(mm)); return s.length > 3 ? s.slice(0, -3) + ' ' + s.slice(-3) : s; };

export class Overlay {
  constructor(svg, rig, vehicle) {
    this.svg = svg; this.rig = rig; this.v = vehicle; this.w = 1; this.h = 1;
    this.view = 'iso'; this.dimAlpha = 0; this.dimTarget = 0; this.flashes = [];
    this.css = getComputedStyle(document.documentElement);
    this.ink = this.css.getPropertyValue('--ink').trim() || '#1c2b4f';
    this.dim = this.css.getPropertyValue('--dim').trim() || '#2f7d76';
    this.accent = this.css.getPropertyValue('--accent').trim() || '#c94b31';
    this.paper = this.css.getPropertyValue('--paper').trim() || '#f4f6fa';
    this.soft = this.css.getPropertyValue('--ink-soft').trim() || '#7c8aa6';
    this.buildDims();
    this.buildCallouts();
    this.hoverId = -1;
  }
  setSize(w, h) { this.w = w; this.h = h; this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`); }
  setView(view) { this.view = view; this.dimTarget = 0; }
  settled(view) { this.dimTarget = 1; }
  flash(part, locals) { if (!part || !part.group.visible) return; this.flashes.push({ t: 0, part, locals, seed: Math.floor(Math.random() * 1000) }); }

  buildDims() {
    const S = this.v.SPEC, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const L = fmt(S.length * 1000), H = fmt(S.height * 1000), W = fmt(S.width * 1000), WB = fmt(S.wheelbase * 1000), GC = fmt(S.groundClearance * 1000), TR = fmt(S.track * 1000), WM = fmt(S.widthMirrors * 1000);
    this.dims = {
      side: [
        { a: V3(S.TAIL, 0, 1), b: V3(S.NOSE, 0, 1), dir: V3(0, -1, 0), off: 0.60, label: L },
        { a: V3(S.XR, 0, 1), b: V3(S.XF, 0, 1), dir: V3(0, -1, 0), off: 0.34, label: WB },
        { a: V3(S.TAIL, 0, 1), b: V3(S.TAIL, S.height, 1), dir: V3(-1, 0, 0), off: 0.85, label: H },
        { a: V3(S.NOSE, 0, 1), b: V3(S.NOSE, S.groundClearance, 1), dir: V3(1, 0, 0), off: 0.65, label: GC },
      ],
      front: [
        { a: V3(S.NOSE, 0, -S.track / 2), b: V3(S.NOSE, 0, S.track / 2), dir: V3(0, -1, 0), off: 0.20, label: TR },
        { a: V3(S.NOSE, 0, -S.width / 2), b: V3(S.NOSE, 0, S.width / 2), dir: V3(0, -1, 0), off: 0.40, label: W },
        { a: V3(S.NOSE, 0, -S.widthMirrors / 2), b: V3(S.NOSE, 0, S.widthMirrors / 2), dir: V3(0, 1, 0), off: 1.98, label: WM },
        { a: V3(S.NOSE, 0, S.widthMirrors / 2), b: V3(S.NOSE, S.height, S.widthMirrors / 2), dir: V3(0, 0, 1), off: 0.55, label: H },
      ],
      top: [
        { a: V3(S.TAIL, 1.75, -S.width / 2), b: V3(S.NOSE, 1.75, -S.width / 2), dir: V3(0, 0, -1), off: 0.82, label: L },
        { a: V3(S.XR, 1.75, -S.width / 2), b: V3(S.XF, 1.75, -S.width / 2), dir: V3(0, 0, -1), off: 0.42, label: WB },
        { a: V3(S.TAIL, 1.75, -S.width / 2), b: V3(S.TAIL, 1.75, S.width / 2), dir: V3(-1, 0, 0), off: 0.55, label: W },
        { a: V3(S.TAIL, 1.75, -S.widthMirrors / 2), b: V3(S.TAIL, 1.75, S.widthMirrors / 2), dir: V3(-1, 0, 0), off: 1.15, label: WM },
      ],
      iso: [
        { a: V3(S.TAIL, 0, S.width / 2), b: V3(S.NOSE, 0, S.width / 2), dir: V3(0, 0, 1), off: 0.9, label: L },
        { a: V3(S.NOSE, 0, S.width / 2), b: V3(S.NOSE, S.height, S.width / 2), dir: V3(1, 0, 0), off: 0.7, label: H },
      ],
    };
    this.dims.q34f = this.dims.iso;
    this.dims.q34r = [
      { a: V3(S.TAIL, 0, S.width / 2), b: V3(S.NOSE, 0, S.width / 2), dir: V3(0, 0, 1), off: 0.9, label: L },
      { a: V3(S.TAIL, 0, -S.width / 2), b: V3(S.TAIL, 0, S.width / 2), dir: V3(-1, 0, 0), off: 0.8, label: W },
    ];
  }
  buildCallouts() {
    // preferred label positions relative to the anchor (CSS px); circles are pushed outside the vehicle's silhouette
    const off = { 1: [-150, -80], 2: [-170, -140], 3: [130, 120], 4: [150, 110], 5: [150, 70], 6: [-170, 70], 7: [-150, -110], 8: [-160, 120], 9: [150, -120], 10: [130, -140] };
    const offSide = { 1: [150, -150], 2: [170, -200], 3: [-150, 150], 4: [-120, 190], 5: [-190, 70], 6: [-170, 120], 7: [170, -190], 8: [190, 110], 9: [-160, -170], 10: [140, -150] };
    this.callouts = CONFIG.keyItems.map(k => ({ n: k.n, part: this.v.parts[k.part], off: off[k.n] || [120, -100], offSide: offSide[k.n] || off[k.n] }));
  }

  // world position of a part's anchor (accounts for explode / open / lift transforms)
  anchorWorld(p, out) {
    if (!p || !p.anchor) return null;
    if (p.anchorLocal) return p.group.localToWorld(out.copy(p.anchor));
    return p.group.localToWorld(out.copy(p.anchor).sub(p.rest)); // authored in parent space at rest
  }

  update(st, dt) {
    const w = this.w, h = this.h, rig = this.rig;
    this.dimAlpha += (this.dimTarget - this.dimAlpha) * Math.min(1, dt * 5);
    const dimFade = Math.max(0, 1 - st.explode * 4);
    const parts = [];
    const camDir = rig.viewDir();
    const camPos = rig.camera.position;
    const tmp = new THREE.Vector3(), tmpN = new THREE.Vector3(), pr = {};
    const ortho = rig.cur.ortho > 0.5;
    const S = this.v.SPEC;

    // live panel rectangles (stage space), refreshed a few times a second
    this._rectT = (this._rectT || 0) + dt;
    if (!this._rects || this._rectT > 0.25) {
      this._rectT = 0; const stage = this.svg.getBoundingClientRect(); this._rects = [];
      for (const id of ['key', 'instr', 'controls', 'titleblock']) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); if (r.width < 2 || getComputedStyle(el).opacity === '0') continue; this._rects.push([r.left - stage.left - 16, r.top - stage.top - 16, r.right - stage.left + 16, r.bottom - stage.top + 16]); }
    }
    // screen-space bounding box of the vehicle (spec box), used to keep callout badges on clear paper
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const x of [S.TAIL, S.NOSE]) for (const y of [0, S.height]) for (const z of [-S.widthMirrors / 2, S.widthMirrors / 2]) {
      const q = rig.project(tmp.set(x, y + (st.explode > 0.02 ? 1.0 * st.explode : 0), z), w, h, {}); if (q.behind) continue;
      bx0 = Math.min(bx0, q.x); by0 = Math.min(by0, q.y); bx1 = Math.max(bx1, q.x); by1 = Math.max(by1, q.y);
    }

    // ---- datum lines ----
    const dash = `stroke="${this.ink}" stroke-width="1" stroke-dasharray="16 5 3 5" opacity="0.55" fill="none"`;
    const seg = (a, b, attrs) => { const s = rig.projectSegment(a, b, w, h); if (s) parts.push(`<line x1="${s[0].toFixed(1)}" y1="${s[1].toFixed(1)}" x2="${s[2].toFixed(1)}" y2="${s[3].toFixed(1)}" ${attrs}/>`); };
    const axisX = [new THREE.Vector3(-60, 0.001, 0), new THREE.Vector3(60, 0.001, 0)];
    if (this.view === 'front') seg(new THREE.Vector3(3, -1, 0), new THREE.Vector3(3, 4, 0), dash);
    else if (this.view === 'top') { seg(axisX[0], axisX[1], dash); seg(new THREE.Vector3(S.XF, 1.8, -60), new THREE.Vector3(S.XF, 1.8, 60), dash); } else seg(axisX[0], axisX[1], dash);

    // ---- ground shadow band for ortho elevations (the ground plane is edge-on there) ----
    if ((this.view === 'side' || this.view === 'front') && rig.cur.ortho > 0.9) {
      const a = this.view === 'side' ? rig.project(new THREE.Vector3(S.TAIL + 0.35, 0, 0), w, h, {}) : rig.project(new THREE.Vector3(0, 0, -S.width / 2 + 0.1), w, h, {});
      const b = this.view === 'side' ? rig.project(new THREE.Vector3(S.NOSE - 0.35, 0, 0), w, h, {}) : rig.project(new THREE.Vector3(0, 0, S.width / 2 - 0.1), w, h, {});
      const bandH = this.view === 'front' ? 32 : 12;
      parts.push(`<rect x="${Math.min(a.x, b.x).toFixed(1)}" y="${(a.y + 2).toFixed(1)}" width="${Math.abs(b.x - a.x).toFixed(1)}" height="${bandH}" fill="url(#hatchPat)" opacity="${(0.75 * this.dimAlpha).toFixed(2)}"/>`);
      parts.push(`<line x1="${Math.min(a.x, b.x)}" y1="${a.y + 1.5}" x2="${Math.max(a.x, b.x)}" y2="${a.y + 1.5}" stroke="${this.ink}" stroke-width="1.2"/>`);
    }

    // ---- dimensions ----
    const dims = this.dims[this.view] || [];
    if (this.dimAlpha > 0.01 && dimFade > 0 && st.panels) {
      const g = [];
      for (const d of dims) {
        const A = rig.project(d.a, w, h, {}), B = rig.project(d.b, w, h, {});
        const A2 = rig.project(tmp.copy(d.a).addScaledVector(d.dir, d.off), w, h, {}), B2 = rig.project(tmpN.copy(d.b).addScaledVector(d.dir, d.off), w, h, {});
        const A3 = rig.project(tmp.copy(d.a).addScaledVector(d.dir, d.off + 0.22), w, h, {}), B3 = rig.project(tmpN.copy(d.b).addScaledVector(d.dir, d.off + 0.22), w, h, {});
        if (A.behind || B.behind || A2.behind || B2.behind) continue;
        const dx = B2.x - A2.x, dy = B2.y - A2.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        if (len < 30) continue;
        const ah = (x, y, sx, sy) => `<path d="M ${x} ${y} L ${x - sx * 9 + sy * 3} ${y - sy * 9 - sx * 3} L ${x - sx * 9 - sy * 3} ${y - sy * 9 + sx * 3} Z" fill="${this.dim}"/>`;
        g.push(`<line x1="${A.x}" y1="${A.y}" x2="${A3.x}" y2="${A3.y}" stroke="${this.dim}" stroke-width="1" opacity="0.9"/>`);
        g.push(`<line x1="${B.x}" y1="${B.y}" x2="${B3.x}" y2="${B3.y}" stroke="${this.dim}" stroke-width="1" opacity="0.9"/>`);
        g.push(`<line x1="${A2.x}" y1="${A2.y}" x2="${B2.x}" y2="${B2.y}" stroke="${this.dim}" stroke-width="1"/>`);
        g.push(ah(A2.x, A2.y, -ux, -uy)); g.push(ah(B2.x, B2.y, ux, uy));
        const Pd = rig.project(tmp.copy(d.a).addScaledVector(d.dir, d.off + 0.5), w, h, {});
        let nx = -uy, ny = ux; if ((Pd.x - A2.x) * nx + (Pd.y - A2.y) * ny < 0) { nx = -nx; ny = -ny; }
        const mx = (A2.x + B2.x) / 2 + nx * 18, my = (A2.y + B2.y) / 2 + ny * 18;
        const tw = d.label.length * 7.2 + 10;
        g.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${tw.toFixed(1)}" height="16" fill="${this.paper}" opacity="0.92"/>`);
        g.push(`<text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" fill="${this.dim}" font-size="11" text-anchor="middle" letter-spacing="1.5">${d.label}</text>`);
      }
      parts.push(`<g opacity="${(this.dimAlpha * dimFade).toFixed(2)}">${g.join('')}</g>`);
    }

    // ---- detail circle A (side view): dashed red ring on the front hub, label parked in the margin ----
    if (this.view === 'side' && this.dimAlpha > 0.01 && dimFade > 0) {
      const c = rig.project(new THREE.Vector3(S.XF, S.tireR, 1), w, h, {}), e = rig.project(new THREE.Vector3(S.XF + S.tireR * 1.3, S.tireR, 1), w, h, {});
      const r = Math.hypot(e.x - c.x, e.y - c.y);
      const lx = Math.min(w - 250, c.x + r + 110), ly = c.y - r * 1.9;
      const kx = c.x + r * 0.71, ky = c.y - r * 0.71;
      parts.push(`<g opacity="${this.dimAlpha.toFixed(2)}"><circle cx="${c.x}" cy="${c.y}" r="${r.toFixed(1)}" fill="none" stroke="${this.accent}" stroke-width="1.2" stroke-dasharray="9 7"/>` +
        `<path d="M ${kx.toFixed(1)} ${ky.toFixed(1)} L ${(lx - 60).toFixed(1)} ${ly.toFixed(1)} L ${(lx - 13).toFixed(1)} ${ly.toFixed(1)}" stroke="${this.accent}" stroke-width="1" fill="none"/>` +
        `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="13" fill="${this.paper}" stroke="${this.accent}" stroke-width="1.4"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" fill="${this.accent}" font-size="11" font-weight="600" text-anchor="middle">A</text>` +
        `<text x="${(lx + 22).toFixed(1)}" y="${(ly + 4).toFixed(1)}" fill="${this.accent}" font-size="11" letter-spacing="2.5">HUB &amp; BRAKE — 1:8</text></g>`);
    }

    // ---- exploded view guide lines ----
    if (st.explode > 0.03) {
      const g = [];
      for (const [name, loc] of Object.entries(this.v.guideAnchors)) {
        const p = this.v.parts[name]; if (!p) continue;
        const rest = tmp.set(loc[0] + p.rest.x, loc[1] + p.rest.y, loc[2] + p.rest.z); p.group.parent.localToWorld(rest);
        const now = tmpN.set(loc[0], loc[1], loc[2]); p.group.localToWorld(now);
        const s = rig.projectSegment(rest, now, w, h); if (!s) continue;
        g.push(`<line x1="${s[0].toFixed(1)}" y1="${s[1].toFixed(1)}" x2="${s[2].toFixed(1)}" y2="${s[3].toFixed(1)}" stroke="${this.ink}" stroke-width="1" stroke-dasharray="6 5" opacity="0.7"/>`);
        g.push(`<circle cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" r="2.2" fill="${this.ink}" opacity="0.7"/>`);
      }
      parts.push(`<g opacity="${Math.min(1, st.explode * 2).toFixed(2)}">${g.join('')}</g>`);
    }

    // ---- callouts (kept during EXPLODE, all drawn at full ink in the elevations) ----
    if (st.panels) {
      const g = [];
      for (const c of this.callouts) {
        if (this.view === 'top' && ortho) break; // the reference draws no callouts in the top view
        const p = c.part; if (!p || !p.anchor || !p.group.visible) continue;
        const A = this.anchorWorld(p, tmp); if (!A) continue;
        const N = tmpN.copy(p.anchorN || new THREE.Vector3(0, 1, 0)).normalize();
        N.transformDirection(p.group.matrixWorld);
        const toCam = ortho ? camDir.clone().negate() : camPos.clone().sub(A).normalize();
        const facing = N.dot(toCam);
        const vis = ortho ? 1 : Math.max(0, Math.min(1, (facing + 0.28) / 0.4));
        if (vis <= 0.02) continue;
        const a = rig.project(A, w, h, {}); if (a.behind) continue;
        const off = (ortho && this.view === 'side') ? c.offSide : c.off;
        let cx = a.x + off[0], cy = a.y + off[1];
        // slide the badge out of the vehicle's projected box along its preferred direction
        if (bx0 < bx1 && cx > bx0 - 22 && cx < bx1 + 22 && cy > by0 - 22 && cy < by1 + 22) {
          // move to the nearest clear edge of the vehicle's box, biased toward the preferred direction
          const cands = [[bx0 - 70, cy, off[0] < 0], [bx1 + 70, cy, off[0] > 0], [cx, by0 - 70, off[1] < 0], [cx, by1 + 70, off[1] > 0]];
          let best = null, bd = 1e9;
          for (const [x, y, pref] of cands) { const d = Math.hypot(x - cx, y - cy) * (pref ? 0.6 : 1); if (d < bd) { bd = d; best = [x, y]; } }
          cx = best[0]; cy = best[1];
        }
        cx = Math.max(60, Math.min(w - 60, cx)); cy = Math.max(70, Math.min(h - 120, cy));
        for (let pass = 0; pass < 2; pass++) for (const [rx0, ry0, rx1, ry1] of this._rects) { if (cx > rx0 && cx < rx1 && cy > ry0 && cy < ry1) { cy = (cy - ry0 < ry1 - cy) ? ry0 : ry1; } }
        cx = Math.max(60, Math.min(w - 60, cx)); cy = Math.max(70, Math.min(h - 120, cy));
        const dx = cx - a.x, dy = cy - a.y;
        let ex, ey;
        if (Math.abs(dx) >= Math.abs(dy)) { ex = a.x + Math.sign(dx) * Math.abs(dy); ey = cy; } else { ex = cx; ey = a.y + Math.sign(dy) * Math.abs(dx); }
        const hot = this.hoverId === p.id;
        const col = hot ? this.accent : this.ink;
        const lx = cx - ex, ly = cy - ey, ll = Math.hypot(lx, ly) || 1;
        const tx = cx - lx / ll * 13, ty = cy - ly / ll * 13;
        const fx = ex - a.x, fy = ey - a.y, fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
        g.push(`<g opacity="${vis.toFixed(2)}"><path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}" fill="none" stroke="${col}" stroke-width="1"/>` +
          `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${(a.x + ux * 10 + uy * 3.5).toFixed(1)} ${(a.y + uy * 10 - ux * 3.5).toFixed(1)} L ${(a.x + ux * 10 - uy * 3.5).toFixed(1)} ${(a.y + uy * 10 + ux * 3.5).toFixed(1)} Z" fill="${col}"/>` +
          `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="13" fill="${this.paper}" stroke="${col}" stroke-width="1.3"/>` +
          `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" fill="${col}" font-size="11" font-weight="600" text-anchor="middle">${c.n}</text></g>`);
      }
      parts.push(g.join(''));
    }

    // ---- flash bursts ----
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt;
      if (f.t > 0.75) { this.flashes.splice(i, 1); continue; }
      const k = f.t / 0.75, alpha = 1 - k * k, grow = 0.6 + 0.4 * Math.min(1, f.t / 0.15);
      const g = [];
      for (const [ai, loc] of f.locals.entries()) {
        const an = f.part.group.localToWorld(tmp.set(loc[0] - f.part.rest.x, loc[1] - f.part.rest.y, loc[2] - f.part.rest.z));
        // the lamps face +x; if that face is turned away from the camera the body is in front of them,
        // so the rays must not be drawn — they used to show straight through the car from behind
        const face = tmpN.set(1, 0, 0).transformDirection(f.part.group.matrixWorld);
        const toCam = ortho ? camDir.clone().negate() : camPos.clone().sub(an).normalize();
        if (face.dot(toCam) <= 0.12) continue;
        const a = rig.project(an, w, h, {}); const fwd = rig.project(tmpN.copy(an).add(new THREE.Vector3(0.6, 0, 0)), w, h, {});
        if (a.behind || fwd.behind) continue;
        let dx = fwd.x - a.x, dy = fwd.y - a.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        for (let r = 0; r < 5; r++) {
          const s = Math.sin((f.seed + r * 17 + ai * 31) * 12.9898) * 43758.5453; const jit = s - Math.floor(s);
          const ang = (r - 2) * 0.22 + (jit - 0.5) * 0.08; const len = (30 + jit * 40) * grow * (1 + 0.15 * Math.abs(r - 2));
          const ca = Math.cos(ang), sa = Math.sin(ang); const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
          const x0 = a.x + rx * 10, y0 = a.y + ry * 10, x1 = a.x + rx * len, y1 = a.y + ry * len;
          const mxx = (x0 + x1) / 2 - ry * (jit - 0.5) * 12, myy = (y0 + y1) / 2 + rx * (jit - 0.5) * 12;
          g.push(`<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${mxx.toFixed(1)} ${myy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${this.accent}" stroke-width="${(1.6 - 0.6 * k).toFixed(2)}"/>`);
        }
        g.push(`<path d="M ${(a.x + dx * 26 - dy * 22).toFixed(1)} ${(a.y + dy * 26 + dx * 22).toFixed(1)} Q ${(a.x + dx * 40).toFixed(1)} ${(a.y + dy * 40).toFixed(1)} ${(a.x + dx * 26 + dy * 22).toFixed(1)} ${(a.y + dy * 26 - dx * 22).toFixed(1)}" fill="none" stroke="${this.accent}" stroke-width="1" stroke-dasharray="3 3"/>`);
      }
      parts.push(`<g opacity="${alpha.toFixed(2)}">${g.join('')}</g>`);
    }

    const html = `<defs><pattern id="hatchPat" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${this.ink}" stroke-width="1"/></pattern></defs>` + parts.join('');
    if (html !== this._last) { this._last = html; this.svg.innerHTML = html; }
  }
}
