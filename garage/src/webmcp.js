// WebMCP: expose the drawing to an agent as callable tools.
//
// Three surfaces, all driving the same handlers, because the ecosystem has not settled:
//   1. document.modelContext (then navigator.modelContext) — registerTool per tool,
//      with provideContext as a legacy fallback and a 12-second late-injection watch.
//   2. window.r2               - a plain promise-returning API. Works in any browser, in devtools,
//      in Playwright/Puppeteer, and is what the capture harness in tools/ drives.
//   3. postMessage             - same API across an iframe boundary, so the sheet can be embedded
//      and still be operable: {source:'r2-blueprint', id, tool, args} in, {id, ok, result} back.
//
// Every tool is synchronous against the scene graph and returns structured JSON, not prose: an agent
// asking "how wide is the battery pack" gets numbers in metres, not a sentence it has to parse.
import * as THREE from 'three';

const box = new THREE.Box3();
const v3 = new THREE.Vector3();

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const xyz = (v) => ({ x: round(v.x), y: round(v.y), z: round(v.z) });

// Pure declaration projection shared by the browser registration, mirror and tests.
export function toolDeclarations(tools) {
  const readOnly = new Set(['get_state', 'list_parts', 'get_part', 'get_specification', 'measure', 'list_visible_parts', 'clearance']);
  const relative = new Set(['start_tour', 'set_motion', 'orbit_camera', 'frame_part']);
  return tools.map(({ name, description, inputSchema }) => ({
    name, title: name.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' '),
    description, inputSchema: { ...inputSchema, additionalProperties: false },
    annotations: {
      readOnlyHint: readOnly.has(name), destructiveHint: false,
      idempotentHint: !relative.has(name), openWorldHint: false,
    },
  }));
}

// Retry missing/failed registrations without duplicating tools that already succeeded.
export function watchWebMCP(api, call, onChange = () => {}) {
  const completed = new WeakMap();
  let busy = false, ended = false;
  const finish = () => { ended = true; clearInterval(watch); clearTimeout(deadline); };
  const attempt = async () => {
    if (busy || ended) return;
    const mc = document.modelContext ?? navigator.modelContext;
    const surface = document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
    const method = typeof mc?.registerTool === 'function' ? 'registerTool'
      : typeof mc?.provideContext === 'function' ? 'provideContext' : null;
    if (!method) return;
    busy = true;
    const declarations = api.tools.map(t => ({ ...t, async execute(args) {
      try { return { content: [{ type: 'text', text: JSON.stringify(await call(t.name, args), null, 1) }] }; }
      catch (err) { return { content: [{ type: 'text', text: `error: ${err.message || err}` }], isError: true }; }
    } }));
    try {
      if (method === 'registerTool') {
        let done = completed.get(mc);
        if (!done) { done = new Set(); completed.set(mc, done); }
        // Invoke every registration immediately; await asynchronous hosts before reporting success.
        const results = await Promise.allSettled(declarations.map(async t => {
          if (!done.has(t.name)) { await mc.registerTool(t); done.add(t.name); }
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      } else await mc.provideContext({ tools: declarations });
      api.registered = true; api.api = `${surface}.${method}`;
      finish(); onChange(api);
    } catch (err) { console.warn('[r2] WebMCP registration failed:', err); }
    finally { busy = false; }
  };
  const watch = setInterval(attempt, 250);
  const deadline = setTimeout(finish, 12000);
  void attempt();
  return finish;
}

export function installWebMCP(ctx) {
  const { st, rig, vehicle, overlay, ui, setView, motion, config } = ctx;

  const partIds = () => vehicle.order.map((p) => p.name);
  const findPart = (name) => {
    if (!name) return null;
    if (vehicle.parts[name]) return vehicle.parts[name];
    const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return vehicle.order.find((p) => p.name.toLowerCase() === k
      || p.label.toLowerCase().replace(/[^a-z0-9]/g, '') === k) || null;
  };
  const partBox = (p) => {
    p.group.updateWorldMatrix(true, true);
    box.setFromObject(p.group);
    if (box.isEmpty()) return null;
    return { min: xyz(box.min), max: xyz(box.max), centre: xyz(box.getCenter(v3)), size: xyz(box.getSize(v3)) };
  };
  const describe = (p, full) => {
    const d = { id: p.name, label: p.label, category: p.category };
    if (full) {
      d.description = p.desc;
      d.bounds_m = partBox(p);
      d.explode_offset_m = xyz(p.explode);
      d.visible = p.group.visible;
    }
    return d;
  };

  // ---- spatial instruments ----------------------------------------------------------------------
  // What the camera can actually see. The sheet renders a part-id G-buffer every frame
  // (blueprint.js: gData = depth, part id, sub id), so read that back and sample it on a
  // grid: exact per pixel, and it honours the dissolved shell and the shader-cut openings.
  // Without a renderer (tests, WebGL failure) fall back to a coarse ray grid.
  let raycaster, idPass;
  const partById = () => new Map(vehicle.order.map((p) => [p.id, p]));
  const visibleParts = (cols) => {
    const hits = new Map(), byId = partById(); let empty = 0, rows;
    const tally = (part, nx, ny, depth) => {
      const e = hits.get(part) || { part, n: 0, sx: 0, sy: 0, nearest: Infinity };
      e.n++; e.sx += nx; e.sy += ny; e.nearest = Math.min(e.nearest, depth); hits.set(part, e);
    };
    let basis;
    const bp = ctx.bp;
    if (bp?.renderer && bp.scene && bp.vehicleMeshes && bp.gMatProto) {
      // An id pass at exactly the grid's resolution: one pixel per sample, into a single
      // float attachment this three.js can read back (the sheet's own G-buffer is a
      // half-float MRT that readRenderTargetPixels cannot address in r170).
      const W = bp.gbuf.width, H = bp.gbuf.height;
      rows = Math.max(2, Math.round(cols * H / W));
      if (!idPass || idPass.target.width !== cols || idPass.target.height !== rows) {
        idPass?.target.dispose();
        idPass = { target: new THREE.WebGLRenderTarget(cols, rows, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false }), materials: idPass?.materials ?? new Map() };
      }
      const frag = bp.gMatProto.fragmentShader
        .replace('layout(location = 0) out vec4 gNormal;', '').replace('layout(location = 1) out vec4 gData;', 'out vec4 gData;')
        .replace('gNormal = vec4(n, 1.0);', '');
      const r = bp.renderer, dis = st.shellDissolve ?? 1;
      for (const m of bp.vehicleMeshes) {
        let mat = idPass.materials.get(m);
        if (!mat) { mat = bp.gMatProto.clone(); mat.fragmentShader = frag; mat.uniforms = m.userData.gMat.uniforms; idPass.materials.set(m, mat); }
        if (m.userData.shell) m.userData.gMat.uniforms.uDissolve.value = dis;
        m.material = mat;
      }
      const groundWas = bp.ground.visible, shadowWas = r.shadowMap.enabled;
      const buf = new Float32Array(cols * rows * 4);
      try {
        bp.ground.visible = false; r.shadowMap.enabled = false;
        vehicle.root.updateMatrixWorld(true);
        rig.apply(W / H);                     // the camera as posed right now, not as of the last drawn frame
        r.setRenderTarget(idPass.target); r.setClearColor(0x000000, 0); r.clear(true, true, true);
        r.render(bp.scene, rig.camera);
        r.readRenderTargetPixels(idPass.target, 0, 0, cols, rows, buf);
      } finally {
        // whatever happened, the sheet gets its materials, ground and shadows back
        r.setRenderTarget(null);
        for (const m of bp.vehicleMeshes) m.material = m.userData.beautyMat;
        bp.ground.visible = groundWas; r.shadowMap.enabled = shadowWas;
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = ((rows - 1 - j) * cols + i) * 4;   // rows are bottom-up in the readback
        if (buf[k + 3] < 0.5) { empty++; continue; }
        const part = byId.get(Math.round(buf[k + 1]));
        if (!part) { empty++; continue; }
        tally(part, ((i + 0.5) / cols) * 2 - 1, 1 - ((j + 0.5) / rows) * 2, buf[k]);
      }
      basis = 'part-id pass rendered at the grid resolution, one pixel per sample';
    } else {
      raycaster ??= new THREE.Raycaster();
      cols = Math.min(cols, 24); rows = Math.max(2, Math.round(cols / rig.aspect));
      vehicle.root.updateMatrixWorld(true);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const nx = ((i + 0.5) / cols) * 2 - 1, ny = 1 - ((j + 0.5) / rows) * 2;
        const ray = rig.ray(nx, ny); raycaster.set(ray.origin, ray.direction);
        const found = raycaster.intersectObjects(vehicle.pickables, false).find((h) => h.object.visible && h.object.parent.visible);
        if (!found || !found.object.userData.part) { empty++; continue; }
        tally(found.object.userData.part, nx, ny, found.distance);
      }
      basis = 'ray grid against the meshes (no renderer available)';
    }
    const total = cols * rows;
    const parts = [...hits.values()].sort((a, b) => b.n - a.n).map((e) => ({
      id: e.part.name, label: e.part.label, category: e.part.category,
      coverage_pct: round(100 * e.n / total, 1),
      // where on the sheet its visible area sits, 0..1 from the left and from the top
      screen_centre: { x: round((e.sx / e.n + 1) / 2, 3), y: round((1 - e.sy / e.n) / 2, 3) },
      nearest_m: round(e.nearest, 3),
    }));
    return { samples: total, grid: { columns: cols, rows }, vehicle_pct: round(100 * (total - empty) / total, 1), basis, parts };
  };
  // Nearest surface-to-surface gap between two parts, in world space at this instant.
  // Vertices of one part against the triangles around the nearest vertices of the other, both
  // ways; exact on the triangles it tests, and it tests the ones that matter.
  const surfaceOf = (p) => {
    const verts = [], tris = [], adj = [];
    const w = new THREE.Vector3();
    for (const m of p.meshes) {
      if (!m.visible || !m.parent.visible) continue;
      m.updateWorldMatrix(true, false);
      const pos = m.geometry.getAttribute('position'), idx = m.geometry.getIndex(); if (!pos) continue;
      const base = verts.length;
      for (let i = 0; i < pos.count; i++) { verts.push(w.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone()); adj.push([]); }
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const t = [0, 1, 2].map((k) => base + (idx ? idx.getX(i + k) : i + k));
        const ti = tris.push(t) - 1; for (const v of t) adj[v].push(ti);
      }
    }
    return { verts, tris, adj };
  };
  const gridIndex = (verts, cell) => {
    const cells = new Map(); const key = (v) => `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
    verts.forEach((v, i) => { const k = key(v); (cells.get(k) || cells.set(k, []).get(k)).push(i); });
    return (v, reach) => {
      const out = []; const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
      for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
        const c = cells.get(`${cx + dx},${cy + dy},${cz + dz}`); if (c) out.push(...c);
      }
      return out;
    };
  };
  let tri, cp;
  const bounds = (verts) => { const bb = new THREE.Box3(); for (const v of verts) bb.expandByPoint(v); return bb; };
  const nearestSurface = (a, b, cell) => {
    tri ??= new THREE.Triangle(); cp ??= new THREE.Vector3();
    const near = gridIndex(b.verts, cell);
    let best = { d: Infinity };
    // Only vertices of A near B's envelope can be nearest to B; widen until some exist.
    const bb = bounds(b.verts); let margin = 0.15, pool = [];
    while (pool.length < 40 && margin < 50) { const region = bb.clone().expandByScalar(margin); pool = a.verts.filter((v) => region.containsPoint(v)); margin *= 2; }
    const step = Math.max(1, Math.floor(pool.length / 2500));
    for (let i = 0; i < pool.length; i += step) {
      const v = pool[i];
      let cands = [], reach = 1;
      while (!cands.length && reach <= 6) { cands = near(v, reach); reach++; }
      if (!cands.length) continue;
      let bi = -1, bd = Infinity;
      for (const j of cands) { const d = v.distanceToSquared(b.verts[j]); if (d < bd) { bd = d; bi = j; } }
      const seen = new Set();
      for (const ti of b.adj[bi]) { if (seen.has(ti)) continue; seen.add(ti);
        const [p0, p1, p2] = b.tris[ti]; tri.set(b.verts[p0], b.verts[p1], b.verts[p2]); tri.closestPointToPoint(v, cp);
        const d = v.distanceTo(cp); if (d < best.d) best = { d, from: v.clone(), to: cp.clone() };
      }
      if (bd < best.d * best.d) best = { d: Math.sqrt(bd), from: v.clone(), to: b.verts[bi].clone() };
    }
    return best;
  };
  // Break any running tween before moving the camera by hand, then hold the new pose.
  const takeCamera = (keepTarget) => {
    if (!keepTarget) { rig.cur.tx = 0; rig.cur.tz = 0; }
    rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null);
    ui.showPanels(true); st.hidePanels = false; st.view = null;
  };
  const cameraState = () => ({
    azimuth_deg: round(rig.cur.az % 360, 2), elevation_deg: round(rig.cur.el, 2),
    distance_m: round(rig.cur.dist, 3), orthographic: round(rig.cur.ortho, 3),
    target_m: { x: round(rig.cur.tx || 0), y: round(rig.cur.ty), z: round(rig.cur.tz || 0) },
    preset: rig.view, settled: rig.settled,
  });

  const TOOLS = [
    {
      name: 'start_tour',
      description: 'Start the 54-second tour: overview, illuminated headlamps, side dimensions, structural battery, front drive unit, open panels, exploded assembly, drive with lights, then reset. from is a 1-based step. Any other call except get_state/start_tour/stop_tour interrupts the tour; stop_tour stops it explicitly.',
      inputSchema: { type: 'object', properties: { from: { type: 'integer', minimum: 1, maximum: config.tour.length } } },
      run: ({ from = 1 }) => {
        if (!Number.isInteger(from) || from < 1 || from > config.tour.length) throw new Error(`from must be an integer from 1 to ${config.tour.length}`);
        return ctx.startTour(from - 1);
      },
    },
    {
      name: 'stop_tour',
      description: 'Stop the tour at its current step without restoring the scene. The tour shows views, lights, dimensions, battery, drive unit, open panels, explode and drive. Any other call except get_state/start_tour/stop_tour also interrupts it.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ctx.stopTour('tool'),
    },
    {
      name: 'get_state',
      description: 'Current view preset, camera pose, which motions are running, and what is selected. Call this first to orient.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({
        tour: ctx.tourState(),
        camera: cameraState(),
        view: st.view,
        // `panels` reads the same way as the button and as set_motion: on = shell dissolved
        motions: { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn },
        explode_progress: round(st.explode, 3), open_progress: round(st.open, 3),
        selected: st.hoverPart ? st.hoverPart.name : null,
        annotations_visible: !document.body.classList.contains('cards-off'),
        views: config.views.map((v) => v.id),
        motion_ids: config.motions.map((m) => m.id),
      }),
    },
    {
      name: 'set_view',
      description: 'Move the camera to one of the drawing\'s standard views. side, front and top are true orthographic elevations; iso, q34f and q34r are perspective.',
      inputSchema: { type: 'object', required: ['view'], properties: { view: { type: 'string', enum: ['iso', 'q34f', 'q34r', 'side', 'front', 'top'] } } },
      run: ({ view }) => {
        if (!config.views.some((v) => v.id === view)) throw new Error(`unknown view "${view}"`);
        setView(view); return { view, camera: cameraState() };
      },
    },
    {
      name: 'set_motion',
      description: 'Turn one of the sheet\'s motions on or off. run = idle telemetry and wheel spin; drive = rolling road with steering; lights = headlamp and tail-lamp beams; panels = dissolve the body shell to reveal the chassis; explode = separate every component along its assembly axis; open = swing the hood, liftgate, all four doors and the charge-port door.',
      inputSchema: {
        type: 'object', required: ['motion'],
        properties: { motion: { type: 'string', enum: ['run', 'drive', 'lights', 'panels', 'explode', 'open'] }, on: { type: 'boolean', description: 'Omit to toggle.' } },
      },
      run: ({ motion: m, on }) => {
        const cur = { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn }[m];
        if (cur === undefined) throw new Error(`unknown motion "${m}"`);
        if (on === undefined || on !== cur) motion(m);
        return { motion: m, on: { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn }[m] };
      },
    },
    {
      name: 'set_camera',
      description: 'Set the given pose fields (azimuth; elevation clamped 2–86; distance clamped 1.2–22 m; orthographic), cancelling any preset and re-centring the target on the vehicle. To keep orbiting a framed component use orbit_camera instead.',
      inputSchema: {
        type: 'object',
        properties: {
          azimuth_deg: { type: 'number' },
          elevation_deg: { type: 'number', minimum: 2, maximum: 86 },
          distance_m: { type: 'number', minimum: 1.2, maximum: 22 },
          orthographic: { type: 'boolean', description: 'True for a flat technical projection with no convergence.' },
        },
      },
      run: (a) => {
        takeCamera();
        if (a.azimuth_deg !== undefined) rig.cur.az = a.azimuth_deg;
        if (a.elevation_deg !== undefined) rig.cur.el = Math.max(2, Math.min(86, a.elevation_deg));
        if (a.distance_m !== undefined) { rig.cur.dist = Math.max(1.2, Math.min(22, a.distance_m)); rig.userZoom = true; }
        if (a.orthographic !== undefined) { rig._orthoFade = false; rig.cur.ortho = a.orthographic ? 1 : 0; }
        return cameraState();
      },
    },
    {
      name: 'orbit_camera',
      description: 'Nudge the camera relative to where it is now. Use this to walk around the vehicle a few degrees at a time rather than guessing an absolute pose.',
      inputSchema: { type: 'object', properties: { d_azimuth_deg: { type: 'number' }, d_elevation_deg: { type: 'number' }, zoom: { type: 'number', description: 'Multiplier on distance; 0.8 moves closer, 1.25 pulls back.' } } },
      run: (a) => {
        takeCamera(true);   // keep orbiting whatever frame_part centred on
        if (a.d_azimuth_deg) rig.cur.az += a.d_azimuth_deg;
        if (a.d_elevation_deg) rig.cur.el = Math.max(2, Math.min(86, rig.cur.el + a.d_elevation_deg));
        if (a.zoom) rig.zoom(a.zoom);
        return cameraState();
      },
    },
    {
      name: 'list_parts',
      description: 'Every named component in the vehicle. category is one of shell (body panels and glass), chassis (battery, subframes, drive units), running (wheels and brakes) or interior. Pass detail:true for bounding boxes in metres.',
      inputSchema: { type: 'object', properties: { category: { type: 'string' }, detail: { type: 'boolean' } } },
      run: ({ category, detail }) => ({
        count: vehicle.order.length,
        parts: vehicle.order.filter((p) => !category || p.category === category).map((p) => describe(p, detail)),
      }),
    },
    {
      name: 'get_part',
      description: 'Full record for one component: its engineering description, its bounding box in metres in the vehicle frame, and where EXPLODE sends it. Accepts either the id from list_parts or the label shown on the sheet.',
      inputSchema: { type: 'object', required: ['part'], properties: { part: { type: 'string' } } },
      run: ({ part }) => {
        const p = findPart(part);
        if (!p) throw new Error(`no part "${part}". Call list_parts for the ${vehicle.order.length} available ids.`);
        return describe(p, true);
      },
    },
    {
      name: 'frame_part',
      description: 'Frame one component from list_parts so it fills the sheet, keeping the current viewing angle unless azimuth/elevation are given. Internal parts are hidden by the shell: call set_motion {motion:\'panels\', on:true} first.',
      inputSchema: {
        type: 'object', required: ['part'],
        properties: { part: { type: 'string' }, azimuth_deg: { type: 'number' }, elevation_deg: { type: 'number' }, margin: { type: 'number', description: 'Fraction of slack around the part, default 0.6.' } },
      },
      run: ({ part, azimuth_deg, elevation_deg, margin = 0.6 }) => {
        const p = findPart(part);
        if (!p) throw new Error(`no part "${part}"`);
        const b = partBox(p);
        if (!b) throw new Error(`"${p.name}" has no visible geometry right now — it may be hidden by PANELS.`);
        takeCamera(true);
        if (azimuth_deg !== undefined) rig.cur.az = azimuth_deg;
        if (elevation_deg !== undefined) rig.cur.el = Math.max(2, Math.min(86, elevation_deg));
        rig.cur.tx = b.centre.x; rig.cur.ty = b.centre.y; rig.cur.tz = b.centre.z;
        const r = Math.max(b.size.x, b.size.y, b.size.z) * (1 + margin);
        // closer than the orbit-wheel clamp on purpose: a drive unit is 0.6 m across and at 3.5 m it
        // is a speck. The near plane is 0.5 m, so 1.2 m is the floor.
        rig.cur.dist = Math.max(1.2, Math.min(22, r / (2 * Math.tan(rig.fov * Math.PI / 360))));
        rig.userZoom = true;
        const out = { part: p.name, bounds_m: b, camera: cameraState() };
        // framing something under the skin puts the camera inside the body, which renders as noise
        if (p.category !== 'shell' && st.panels) out.hint = 'This part is under the body shell. Call set_motion {motion:"panels", on:true} to dissolve the shell before looking at it.';
        return out;
      },
    },
    {
      name: 'highlight_part',
      description: 'Select a component: it is picked out of the drawing and a numbered leader runs to it, the same as hovering its row in the key. Call with no argument to clear.',
      inputSchema: { type: 'object', properties: { part: { type: 'string', description: 'Omit to clear the selection.' } } },
      run: ({ part }) => {
        const p = part ? findPart(part) : null;
        if (part && !p) throw new Error(`no part "${part}"`);
        ctx.select(p);
        return { selected: p ? p.name : null, label: p ? p.label : null };
      },
    },
    {
      name: 'set_annotations',
      description: 'Show or hide the callout cards, dimension lines and title block, leaving the vehicle alone. Hide them for a clean look at the geometry.',
      inputSchema: { type: 'object', required: ['visible'], properties: { visible: { type: 'boolean' } } },
      run: ({ visible }) => { ui.setCards(visible, ctx.tourState().running); return { annotations_visible: visible }; },
    },
    {
      name: 'get_specification',
      description: 'The published figures the RX2 model is built to, in metres, kilograms and seconds (an independent reconstruction fitted to the Rivian R2\'s published dimensions). Every profile curve in the geometry is fitted to these plus Rivian\'s official orthographic drawings.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({ ...vehicle.SPEC }),
    },
    {
      name: 'measure',
      description: 'Return the separation in metres between the current world-space bounding-box centres of two components, so animation, open panels and explode change it; it is not a surface clearance. For a wheelbase check use settled, unexploded, same-side wheels.',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
      run: ({ from, to }) => {
        const a = findPart(from), b = findPart(to);
        if (!a || !b) throw new Error(`no part "${!a ? from : to}"`);
        const ba = partBox(a), bb = partBox(b);
        if (!ba || !bb) throw new Error('one of those parts has no visible geometry right now');
        const d = { x: round(bb.centre.x - ba.centre.x), y: round(bb.centre.y - ba.centre.y), z: round(bb.centre.z - ba.centre.z) };
        return { from: a.name, to: b.name, delta_m: d, distance_m: round(Math.hypot(d.x, d.y, d.z)) };
      },
    },
    {
      name: 'list_visible_parts',
      description: 'What the camera can see right now: a grid of rays through the sheet, first surface hit per ray, tallied by component. Returns each visible component with the percentage of the sheet it covers, where its visible area sits on the sheet (0..1 from the left and from the top) and its nearest distance; plus how much of the sheet the vehicle fills. Use it to know what a person is looking at before explaining it, or to confirm a frame_part landed. Reads the sheet\'s own part-id buffer, so it honours the dissolved shell and open panels.',
      inputSchema: { type: 'object', properties: { columns: { type: 'integer', minimum: 8, maximum: 96, description: 'Ray grid width; rows follow the sheet aspect. Default 40.' } } },
      run: ({ columns = 40 } = {}) => {
        if (!Number.isInteger(columns) || columns < 8 || columns > 96) throw new Error('columns must be an integer from 8 to 96');
        return { view: st.view, camera: cameraState(), ...visibleParts(columns) };
      },
    },
    {
      name: 'clearance',
      description: 'Nearest surface-to-surface gap in metres between two components as they are posed right now (open panels and explode change it), with the two closest points in the vehicle frame. Unlike measure, which uses bounding-box centres, this is the real gap: use it for packaging questions such as how close the battery pack sits to the floor or a tyre to its arch. Zero means the surfaces touch or intersect.',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
      run: ({ from, to }) => {
        const a = findPart(from), b = findPart(to);
        if (!a || !b) throw new Error(`no part "${!a ? from : to}". Call list_parts for the ${vehicle.order.length} available ids.`);
        if (a === b) throw new Error('clearance needs two different components');
        vehicle.root.updateMatrixWorld(true);
        const sa = surfaceOf(a), sb = surfaceOf(b);
        if (!sa.verts.length || !sb.verts.length) throw new Error('one of those parts has no visible geometry right now');
        const cell = 0.05;
        const ab = nearestSurface(sa, sb, cell), ba = nearestSurface(sb, sa, cell);
        const best = ab.d <= ba.d ? ab : { d: ba.d, from: ba.to, to: ba.from };
        if (!Number.isFinite(best.d)) throw new Error('the parts are too far apart to index; use measure for their centre separation');
        return { from: a.name, to: b.name, clearance_m: round(best.d), at_from_m: xyz(best.from), at_to_m: xyz(best.to),
          basis: 'nearest of: each sampled vertex of one part against the triangles around the closest vertex of the other, both directions, in world space at this instant' };
      },
    },
    {
      name: 'reset',
      description: 'Return the sheet to how it opens: ISO view, shell on, nothing exploded or open, nothing selected.',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        ctx.select(null);
        for (const [m, want] of [['drive', false], ['lights', false], ['explode', false], ['open', false], ['run', true]]) {
          const cur = { run: st.run, drive: st.drive, lights: st.lights, explode: st.explodeOn, open: st.openOn }[m];
          if (cur !== want) motion(m);
        }
        if (!st.panels) motion('panels');
        ui.setCards(true, ctx.tourState().running); setView('iso');
        return { ok: true };
      },
    },
  ];

  // ---- dispatch -------------------------------------------------------------------------------
  // A private identity marks only calls made by the sequencer. All surfaces still
  // use this dispatcher; an external call during an awaited action must interrupt.
  const tourSource = Symbol('tour');
  const call = async (name, args = {}, source) => {
    if (source !== tourSource && !['get_state', 'start_tour', 'stop_tour'].includes(name)) ctx.stopTour('tool');
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool "${name}". Available: ${TOOLS.map((x) => x.name).join(', ')}`);
    return t.run(args || {});
  };

  // 1. window.r2 — always present, so automation never depends on an origin trial being enabled
  const api = { tools: toolDeclarations(TOOLS), call, registered: false, api: null };
  for (const t of TOOLS) api[t.name] = (args) => call(t.name, args);
  window.r2 = api;

  // 2. postMessage bridge, for the sheet embedded in an iframe
  // Only the page that embedded us may drive us, and the answer goes back to whoever asked rather
  // than to '*'. Previously any frame or opener could steer the camera and read the scene, and every
  // reply was broadcast to every origin.
  const mayDrive = (e) => e.source && (e.source === window.parent || e.source === window.opener || e.origin === location.origin);
  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.source !== 'r2-blueprint' || !m.tool || !mayDrive(e)) return;
    const reply = (body) => { try { e.source.postMessage({ source: 'r2-blueprint-result', id: m.id, ...body }, e.origin === 'null' ? '*' : e.origin); } catch (err) {} };
    try { reply({ ok: true, result: await call(m.tool, m.args) }); }
    catch (err) { reply({ ok: false, error: String(err.message || err) }); }
  });

  // 3. Browser registration and header status share the live mirror.
  ui.setAgentTools?.(api);
  watchWebMCP(api, call, status => ui.setAgentTools?.(status));
  return { ...api, callTour: (name, args) => call(name, args, tourSource) };
}
