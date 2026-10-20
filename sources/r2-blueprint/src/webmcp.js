// WebMCP: expose the drawing to an agent as callable tools.
//
// One module serves the standalone Owner's Guide and the copy the configurator embeds as its Garage.
// Three surfaces, all driving the same handlers:
//   1. document.modelContext (then navigator.modelContext) — registerTool per tool with titles,
//      annotations and closed schemas, provideContext as a fallback, a 12-second watch for a
//      late-injected API, and no registration at all when the sheet is framed (the host page owns
//      the agent surface and drives this drawing over the bridge).
//   2. window.r2 — a plain promise-returning API for any browser, devtools, Playwright, and the
//      capture harness in tools/. Also carries registration, registered, api, dispose and callTour.
//   3. postMessage — the same API across an iframe boundary, same-origin parent only:
//      {source:'r2-blueprint', id, tool, args} in, {source:'r2-blueprint-result', id, ok, result} back.
//
// Every call is validated against its schema, then runs synchronously against the scene graph and
// returns structured JSON in metres, not prose.
import * as THREE from 'three';

const box = new THREE.Box3();
const v3 = new THREE.Vector3();

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const xyz = (v) => ({ x: round(v.x), y: round(v.y), z: round(v.z) });
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const READ_ONLY = Object.freeze({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true,
  openWorldHint: false, untrustedContentHint: false,
});
const SAFE_SET = Object.freeze({
  readOnlyHint: false, destructiveHint: false, idempotentHint: true,
  openWorldHint: false, untrustedContentHint: false,
});
const SAFE_ACTION = Object.freeze({
  readOnlyHint: false, destructiveHint: false, idempotentHint: false,
  openWorldHint: false, untrustedContentHint: false,
});

function validateValue(value, schema, path) {
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { validateValue(value, candidate, path); return; } catch { /* try the next shape */ }
    }
    const expected = schema.anyOf.map((candidate) => candidate.type).join(' or ');
    throw new TypeError(`${path} must be ${expected}.`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new TypeError(`${path} must be one of: ${schema.enum.join(', ')}.`);
  }
  if (schema.type === 'object') {
    if (!isRecord(value)) throw new TypeError(`${path} must be a JSON object.`);
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      // `required in value` is satisfied by a key explicitly set to undefined,
      // which then skips validation below and lands in the tool as a hole.
      if (value[required] === undefined) throw new TypeError(`${path} requires ${required}.`);
    }
    if (schema.additionalProperties === false) {
      // `key in properties` walks the prototype chain, so `toString`,
      // `constructor` and `valueOf` all read as declared properties and slip
      // past a closed schema.
      const unexpected = Object.keys(value)
        .filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unexpected.length) {
        throw new TypeError(`${path} received unsupported field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}.`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (value[key] !== undefined) validateValue(value[key], child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new TypeError(`${path} must be a string.`);
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
      throw new RangeError(`${path} must not be blank.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new RangeError(`${path} must be at most ${schema.maxLength} characters.`);
    }
    return;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite ${schema.type}.`);
    }
    if (schema.type === 'integer' && !Number.isSafeInteger(value)) {
      throw new TypeError(`${path} must be a safe integer.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new RangeError(`${path} must be at least ${schema.minimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new RangeError(`${path} must be at most ${schema.maximum}.`);
    }
    return;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw new TypeError(`${path} must be a boolean.`);
  }
  if (schema.type === 'null' && value !== null) {
    throw new TypeError(`${path} must be null.`);
  }
}

export function installWebMCP(ctx) {
  const { st, rig, overlay, ui, setView, motion } = ctx;
  // The car and its sheet text are read at call time, not captured: the Garage can switch
  // vehicles (set_vehicle), and every tool below works on whichever one is on the sheet now.
  const car = () => ctx.vehicle, sheet = () => ctx.config;
  const runMode = () => { if (!ctx.run) throw new Error('This sheet has no run mode.'); return ctx.run; };
  const fleet = () => ctx.vehicles ?? [];
  const current = () => { const id = ctx.vehicleId ?? null; return { id, label: fleet().find((v) => v.id === id)?.label ?? null }; };
  // What the configurator last synchronized, per vehicle: each car keeps its own context when
  // the Garage switches (main.js setVehicle), so its revision and fingerprint are kept with it.
  const synced = new Map();

  // Stated on every tool that returns a coordinate. Without it bounds_m and
  // delta_m are numbers an agent cannot interpret.
  const AXES = 'x forward (+x is the nose), y up (0 is the ground), z lateral (+z is the passenger side); metres';
  const partIds = () => car().order.map((p) => p.name);
  const findPart = (name) => {
    if (!name) return null;
    if (car().parts[name]) return car().parts[name];
    const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return car().order.find((p) => p.name.toLowerCase() === k
      || p.label.toLowerCase().replace(/[^a-z0-9]/g, '') === k) || null;
  };
  // Bounds come from the part's own meshes, not from its group.
  //
  // A part's group is where the drawing hangs its transform, but not every part
  // keeps its meshes there: the brakes are one part whose twenty meshes are all
  // parented into the four wheel hubs so they turn and steer with the wheel.
  // Measuring the group alone returns an empty box for it, and every tool built
  // on this — get_part, frame_part, measure — then reports nothing or blames a
  // hidden part. Unioning the meshes is correct for every part and required for
  // that one.
  const partBox = (p) => {
    box.makeEmpty();
    for (const mesh of p.meshes ?? []) {
      mesh.updateWorldMatrix(true, false);
      box.expandByObject(mesh);
    }
    if (box.isEmpty()) {
      p.group.updateWorldMatrix(true, true);
      box.setFromObject(p.group);
    }
    if (box.isEmpty()) return null;
    return { min: xyz(box.min), max: xyz(box.max), centre: xyz(box.getCenter(v3)), size: xyz(box.getSize(v3)) };
  };
  const describe = (p, full) => {
    const d = { id: p.name, label: p.label, category: p.category };
    if (full) {
      d.description = p.desc;
      d.bounds_m = partBox(p);
      d.axes = AXES;
      d.explode_offset_m = xyz(p.explode);
      d.visible = p.group.visible;
      // Bounds are read off the live scene, so they move when the assembly does.
      d.assembly = st.explodeOn ? 'exploded' : 'assembled';
    }
    return d;
  };
  // ---- spatial instruments ----------------------------------------------------------------------
  // What the camera can actually see. The sheet renders a part-id G-buffer every frame
  // (blueprint.js: gData = depth, part id, sub id), so read that back and sample it on a
  // grid: exact per pixel, and it honours the dissolved shell and the shader-cut openings.
  // Without a renderer (tests, WebGL failure) fall back to a coarse ray grid.
  let raycaster, idPass;
  const partById = () => new Map(car().order.map((p) => [p.id, p]));
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
        idPass = { target: new THREE.WebGLRenderTarget(cols, rows, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false }), materials: idPass?.materials ?? new Map(), meshes: idPass?.meshes };
      }
      // A switched vehicle brings other meshes and new G-buffer uniforms (blueprint.js
      // removeVehicle / addVehicle replace the list), so the id materials are made again.
      if (idPass.meshes !== bp.vehicleMeshes) {
        for (const mat of idPass.materials.values()) mat.dispose();
        idPass.materials.clear(); idPass.meshes = bp.vehicleMeshes;
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
        car().root?.updateMatrixWorld(true);
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
      if (!rig.ray || !car().pickables) throw new Error('list_visible_parts needs the drawing\'s renderer or ray picking; neither is available here.');
      car().root?.updateMatrixWorld(true);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const nx = ((i + 0.5) / cols) * 2 - 1, ny = 1 - ((j + 0.5) / rows) * 2;
        const ray = rig.ray(nx, ny); raycaster.set(ray.origin, ray.direction);
        const found = raycaster.intersectObjects(car().pickables, false).find((h) => h.object.visible && h.object.parent.visible);
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
    // A heading, so never negative: JavaScript's % keeps the sign of the
    // dividend, and an agent doing its own arithmetic on -38 instead of 322
    // gets a different answer.
    azimuth_deg: round(((rig.cur.az % 360) + 360) % 360, 2),
    elevation_deg: round(rig.cur.el, 2),
    distance_m: round(rig.cur.dist, 3),
    // Reported as the fraction it is. It crosses the middle during the ortho
    // fade, so a boolean here would be a lie for about half a second — but
    // set_camera takes a boolean, so publish both and say which is which.
    orthographic: round(rig.cur.ortho, 3) >= 0.5,
    orthographic_fraction: round(rig.cur.ortho, 3),
    target_m: { x: round(rig.cur.tx || 0), y: round(rig.cur.ty), z: round(rig.cur.tz || 0) },
    preset: rig.view,
    // True once the camera has stopped moving. A hand-placed pose is settled
    // the moment it is set — there is no tween to wait for — and reporting it
    // as unsettled forever left an agent with no safe moment to capture.
    settled: rig.settled || rig.view === null,
  });

  const getState = () => ({
    vehicle: current(),
    camera: cameraState(),
    view: st.view,
    tour: ctx.tourState ? ctx.tourState() : undefined,
    vehicle_context: { ...st.vehicleContext },
    vehicle_context_synced: synced.has(current().id),
    // `panels` reads the same way as the button and as set_motion: on = shell dissolved
    motions: { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn },
    explode_progress: round(st.explode, 3), open_progress: round(st.open, 3),
    selected: st.hoverPart ? st.hoverPart.name : null,
    run_active: !!ctx.run?.active(),   // a run (start_run) has the car and the camera; get_run_state reads it
    annotations_visible: !document.body.classList.contains('cards-off'),
    views: sheet().views.map((v) => v.id),
    motion_ids: sheet().motions.map((m) => m.id),
  });

  const TOOLS = [
    {
      name: 'start_tour',
      title: 'Start the guided tour',
      description: 'Start the current vehicle\'s 30-second tour, nine stops: an overview, its lamps lit, the side dimensions, details under or behind the skin, its opening panels, the exploded assembly, a drive with lights, then reset. get_vehicles gives each vehicle\'s stops. from is a 1-based step. Any other call except get_state/start_tour/stop_tour interrupts the tour; stop_tour stops it explicitly. Any call that moves the scene (views, motions, camera, framing, highlighting, annotations, reset), and any click or key on the drawing, stops it where it is; reads and the host\'s context sync do not.',
      // Fixed once registered, so the longest tour of any vehicle; run() checks the current one.
      inputSchema: { type: 'object', additionalProperties: false, properties: { from: { type: 'integer', minimum: 1, maximum: Math.max(1, sheet().tour?.length ?? 1, ...fleet().map((v) => v.config?.tour?.length ?? 0)) } } },
      annotations: SAFE_ACTION,
      run: ({ from = 1 }) => {
        if (!ctx.startTour || !sheet().tour?.length) throw new Error('The tour is not available on this sheet.');
        if (!Number.isInteger(from) || from < 1 || from > sheet().tour.length) throw new Error(`from must be an integer from 1 to ${sheet().tour.length}`);
        return ctx.startTour(from - 1);
      },
    },
    {
      name: 'stop_tour',
      title: 'Stop the guided tour',
      description: 'Stop the tour at its current step without restoring the scene. The tour shows views, lights, dimensions, details under the skin, open panels, explode and drive. Any other call except get_state/start_tour/stop_tour also interrupts it. Reads never stop the tour; only this, a scene-moving call, or a person\'s click or key does.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: SAFE_SET,
      run: () => (ctx.stopTour ? ctx.stopTour('tool') : { running: false }),
    },
    {
      name: 'get_state',
      title: 'Get digital twin state',
      description: 'Which vehicle is on the sheet, the current view preset, camera pose, which motions are running, and what is selected. Call this first to orient.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => getState(),
    },
    {
      name: 'get_vehicles',
      title: 'List the Garage vehicles',
      description: 'The vehicles this Garage can show and which one is on the sheet now, each with its views, motions, tour length and whether it has a run mode (the tray\'s PLAY). Every other tool works on the current vehicle; set_vehicle switches.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => {
        const now = current().id;
        const list = fleet().length ? fleet() : [{ id: now, label: null, config: sheet() }];
        return {
          current: now,
          vehicles: list.map((v) => ({
            id: v.id, label: v.label, current: v.id === now,
            ...(v.id === now ? { part_count: car().order.length } : {}),
            views: v.config.views.map((x) => x.id), motions: v.config.motions.map((m) => m.id),
            tour_steps: v.config.tour?.length ?? 0, run_mode: !!v.play,
          })),
        };
      },
    },
    {
      name: 'set_vehicle',
      title: 'Switch the Garage vehicle',
      description: 'Put another vehicle on the sheet: rx2 is the Hudian RX2, roadster the Tesla Roadster. Its sheet text, key, callouts, camera presets and tour come with it, and the scene goes back to how it opens (ISO view, run only, shell on, nothing selected). Stops a running tour. The first switch to a vehicle loads its model, so that reply can take a moment. Returns the new state, as get_state does.',
      inputSchema: { type: 'object', required: ['vehicle'], properties: { vehicle: { type: 'string', enum: fleet().length ? fleet().map((v) => v.id) : ['rx2', 'roadster'] } }, additionalProperties: false },
      annotations: SAFE_SET,
      run: async ({ vehicle }) => {
        if (!ctx.setVehicle) throw new Error('This sheet shows one vehicle and cannot switch.');
        const changed = await ctx.setVehicle(vehicle);
        return { vehicle: current().id, changed: !!changed, state: getState() };
      },
    },
    {
      name: 'set_vehicle_context',
      title: 'Synchronize configured vehicle context',
      description: 'Synchronize the vehicle identity and selected build supplied by the AutoLab configurator. This does not change engineering geometry; it lets the owner guide and agent verify that both lifecycle surfaces refer to the same revision.',
      inputSchema: {
        type: 'object',
        required: ['build', 'paint', 'wheels', 'interior', 'rangeMiles', 'vehicleTotal', 'revision'],
        additionalProperties: false,
        properties: {
          build: { type: 'string', minLength: 1, maxLength: 120 },
          paint: { type: 'string', minLength: 1, maxLength: 120 },
          wheels: { type: 'string', minLength: 1, maxLength: 120 },
          interior: { type: 'string', minLength: 1, maxLength: 120 },
          rangeMiles: { anyOf: [{ type: 'number', minimum: 0, maximum: 2000 }, { type: 'null' }] },
          vehicleTotal: { type: 'number', minimum: 0, maximum: 10000000 },
          revision: { type: 'integer', minimum: 1 },
        },
      },
      annotations: SAFE_SET,
      run: (context) => {
        // Ordered, so a logically identical context re-sent with its keys in a
        // different order is recognised as the same one. JSON.stringify over
        // the caller's object depends on their insertion order, which is not a
        // fact about the configuration.
        const fingerprint = JSON.stringify([
          context.build, context.paint, context.wheels, context.interior,
          context.rangeMiles, context.vehicleTotal, context.revision,
        ]);
        const last = synced.get(current().id);
        if (last && context.revision < last.revision) {
          throw new Error(`stale vehicle context revision ${context.revision}; Garage is already at revision ${last.revision}`);
        }
        if (last && last.revision === context.revision && last.fingerprint !== fingerprint) {
          throw new Error(`vehicle context revision ${context.revision} conflicts with the context already synchronized at that revision`);
        }
        const changed = last?.fingerprint !== fingerprint;
        st.vehicleContext = { ...context };
        synced.set(current().id, { revision: context.revision, fingerprint });
        return { synced: true, changed, vehicle_context: { ...st.vehicleContext } };
      },
    },
    {
      name: 'set_view',
      title: 'Set digital twin view',
      description: 'Move the camera to one of the drawing\'s standard views. side, front and top are true orthographic elevations; iso, q34f and q34r are perspective.',
      inputSchema: { type: 'object', required: ['view'], properties: { view: { type: 'string', enum: ['iso', 'q34f', 'q34r', 'side', 'front', 'top'] } }, additionalProperties: false },
      annotations: SAFE_SET,
      run: ({ view }) => {
        if (!sheet().views.some((v) => v.id === view)) throw new Error(`unknown view "${view}"`);
        setView(view);
        // The view transition tweens over about a second, so the camera has not
        // moved yet. Returning cameraState() here reports the pose being left,
        // which is the opposite of what was asked for.
        return {
          view,
          camera: cameraState(),
          camera_is: 'the pose being left; the view transition is still running',
          settles_in_ms: 1150,
        };
      },
    },
    {
      name: 'set_motion',
      title: 'Set digital twin motion',
      description: 'Turn one of the sheet\'s motions on or off. run = idle telemetry and wheel spin; drive = rolling road with steering; lights = headlamp and tail-lamp beams; panels = dissolve the body shell to reveal the chassis; explode = separate every component along its assembly axis; open = swing every opening panel of the current vehicle (the RX2\'s hood, liftgate, four doors and charge-port door; the Roadster\'s two gull-wing doors; the reply\'s opens names them). run and drive are coupled: turning drive on turns run on, and turning run off turns drive off. The reply reports every motion, not just the one asked about, so the coupling is visible.',
      inputSchema: {
        type: 'object', required: ['motion'],
        properties: { motion: { type: 'string', enum: ['run', 'drive', 'lights', 'panels', 'explode', 'open'] }, on: { type: 'boolean', description: 'Omit to toggle.' } },
        additionalProperties: false,
      },
      annotations: SAFE_ACTION,
      run: ({ motion: m, on }) => {
        const cur = { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn }[m];
        if (cur === undefined) throw new Error(`unknown motion "${m}"`);
        if (on === undefined || on !== cur) motion(m);
        const now = { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn };
        return { motion: m, on: now[m], motions: now, ...(m === 'open' && sheet().opens ? { opens: sheet().opens } : {}) };
      },
    },
    {
      name: 'set_camera',
      title: 'Set digital twin camera',
      description: 'Place the camera by absolute pose. azimuth 0 looks at the driver side in profile and increases clockwise seen from above; elevation 0 is eye level, 90 is directly overhead. Omitted angles and distance keep their current value, but any call here leaves the named view preset (the reply\'s preset becomes null), recentres the orbit target on the vehicle, and stops the ISO drift — so a pose set here is reproducible, which the drifting default view is not. To go back to an authored framing, call set_view.',
      inputSchema: {
        type: 'object',
        properties: {
          azimuth_deg: { type: 'number' },
          elevation_deg: { type: 'number', minimum: 2, maximum: 86 },
          distance_m: { type: 'number', minimum: 1.2, maximum: 22 },
          orthographic: { type: 'boolean', description: 'True for a flat technical projection with no convergence.' },
        },
        additionalProperties: false,
      },
      annotations: SAFE_SET,
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
      title: 'Orbit digital twin camera',
      description: 'Nudge the camera relative to where it is now. Use this to walk around the vehicle a few degrees at a time rather than guessing an absolute pose. Keeps whatever frame_part centred on, but leaves the named view preset and stops the ISO drift, so the resulting pose is reproducible. Distance is clamped to 1.2-22 m, so a zoom past either end returns the clamped distance rather than the one requested — read distance_m back from the reply.',
      inputSchema: { type: 'object', properties: { d_azimuth_deg: { type: 'number' }, d_elevation_deg: { type: 'number', minimum: -84, maximum: 84 }, zoom: { type: 'number', minimum: 0.1, maximum: 4, description: 'Positive multiplier on distance; 0.8 moves closer, 1.25 pulls back.' } }, additionalProperties: false },
      annotations: SAFE_ACTION,
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
      title: 'List digital twin parts',
      description: 'Every named component in the current vehicle (the reply\'s vehicle says which). category is one of shell (body panels and glass), chassis (the structure under the skin: the RX2\'s battery, subframes and drive units, the Roadster\'s floor, fans and thrusters), running (the wheels) or interior. The brakes ride on the wheel hubs: a chassis part on the RX2, a running part on the Roadster. Pass detail:true for bounding boxes in metres.',
      inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['shell', 'chassis', 'running', 'interior'] }, detail: { type: 'boolean' } }, additionalProperties: false },
      annotations: READ_ONLY,
      run: ({ category, detail }) => {
        const parts = car().order.filter((p) => !category || p.category === category).map((p) => describe(p, detail));
        return { vehicle: current().id, count: parts.length, total_count: car().order.length, parts };
      },
    },
    {
      name: 'get_part',
      title: 'Get digital twin part',
      description: 'Full record for one component: its engineering description, its bounding box in metres in the vehicle frame, and where EXPLODE sends it. Accepts either the id from list_parts or the label shown on the sheet.',
      inputSchema: { type: 'object', required: ['part'], properties: { part: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false },
      annotations: READ_ONLY,
      run: ({ part }) => {
        const p = findPart(part);
        if (!p) throw new Error(`no part "${part}". Call list_parts for the ${car().order.length} available ids.`);
        return { vehicle: current().id, ...describe(p, true) };
      },
    },
    {
      name: 'frame_part',
      title: 'Frame digital twin part',
      description: 'Point the camera at one component and zoom so it fills the sheet. The best way to inspect a specific piece of the vehicle.',
      inputSchema: {
        type: 'object', required: ['part'],
        properties: { part: { type: 'string', minLength: 1, maxLength: 80 }, azimuth_deg: { type: 'number' }, elevation_deg: { type: 'number', minimum: 2, maximum: 86 }, margin: { type: 'number', minimum: 0.1, maximum: 3, description: 'Fraction of slack around the part, default 0.6.' } },
        additionalProperties: false,
      },
      annotations: SAFE_SET,
      run: ({ part, azimuth_deg, elevation_deg, margin = 0.6 }) => {
        const p = findPart(part);
        if (!p) throw new Error(`no part "${part}". Call list_parts for the ${car().order.length} available ids.`);
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
      title: 'Highlight digital twin part',
      description: 'Select a component: it is picked out of the drawing and a numbered leader runs to it, the same as hovering its row in the key. Call with no argument to clear.',
      inputSchema: { type: 'object', properties: { part: { type: 'string', minLength: 1, maxLength: 80, description: 'Omit to clear the selection.' } }, additionalProperties: false },
      annotations: SAFE_SET,
      run: ({ part }) => {
        const p = part ? findPart(part) : null;
        if (part && !p) throw new Error(`no part "${part}". Call list_parts for the ${car().order.length} available ids.`);
        ctx.select(p);
        return { selected: p ? p.name : null, label: p ? p.label : null };
      },
    },
    {
      name: 'set_annotations',
      title: 'Set technical annotations',
      description: 'Show or hide the callout cards, dimension lines and title block, leaving the vehicle alone. Hide them for a clean look at the geometry.',
      inputSchema: { type: 'object', required: ['visible'], properties: { visible: { type: 'boolean' } }, additionalProperties: false },
      annotations: SAFE_SET,
      run: ({ visible }) => { ui.setCards(visible, !!ctx.tourState?.().running); return { annotations_visible: visible }; },
    },
    {
      name: 'get_specification',
      title: 'Get vehicle specification',
      description: 'The published dimensions the current vehicle\'s model is built to (an independent reconstruction fitted to its maker\'s published figures; basis says which). Every value in dimensions_m is a length in metres; a mass, where the model carries one, comes separately as mass_kg. Also returns the model\'s own derived coordinates (NOSE, TAIL, XF, XR: the x positions of the bumpers and axles), which is what part bounds and measurements are expressed against. The body is an independent reconstruction fitted to published dimensions and photographs, not manufacturer CAD.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => {
        const S = car().SPEC;
        return {
          vehicle: current().id,
          units: 'metres',
          axes: AXES,
          // Lengths only: the Roadster's SPEC also carries its id, label and mass.
          dimensions_m: Object.fromEntries(Object.entries(S).filter(([k, v]) => typeof v === 'number' && k !== 'mass')),
          ...(typeof S.mass === 'number' ? { mass_kg: S.mass } : {}),
          basis: sheet().specBasis ?? 'Independent reconstruction fitted to published dimensions and photographs. Not manufacturer CAD, not a scan.',
        };
      },
    },
    {
      name: 'measure',
      title: 'Measure between digital twin parts',
      description: 'Distance in metres between the bounding-box CENTRES of two components, plus the per-axis separation. This is not a clearance: two parts that interpenetrate and two parts 200 mm apart can return the same distance. For clearance, read both parts\' bounds_m from get_part and compare the facing faces. Axes: x forward (+x is the nose), y up (0 is the ground), z lateral (+z is the passenger side).',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', minLength: 1, maxLength: 80 }, to: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false },
      annotations: READ_ONLY,
      run: ({ from, to }) => {
        const a = findPart(from), b = findPart(to);
        if (!a || !b) throw new Error(`no part "${!a ? from : to}". Call list_parts for the ${car().order.length} available ids.`);
        const ba = partBox(a), bb = partBox(b);
        if (!ba || !bb) throw new Error('one of those parts has no visible geometry right now');
        const d = { x: round(bb.centre.x - ba.centre.x), y: round(bb.centre.y - ba.centre.y), z: round(bb.centre.z - ba.centre.z) };
        // Explode and the panel dissolve move parts bodily. A measurement taken
        // mid-explode is a real number about a pose nobody asked about, so say
        // which pose it describes rather than let it read as the assembled car.
        return {
          from: a.name,
          to: b.name,
          axes: AXES,
          delta_m: d,
          distance_m: round(Math.hypot(d.x, d.y, d.z)),
          measured_between: 'bounding-box centres, not nearest faces',
          assembly: st.explodeOn ? 'exploded — parts are displaced along their assembly axes' : 'assembled',
        };
      },
    },
    {
      name: 'list_visible_parts',
      title: 'List the components in view',
      description: 'What the camera can see right now: a grid of rays through the sheet, first surface hit per ray, tallied by component. Returns each visible component with the percentage of the sheet it covers, where its visible area sits on the sheet (0..1 from the left and from the top) and its nearest distance; plus how much of the sheet the vehicle fills. Use it to know what a person is looking at before explaining it, or to confirm a frame_part landed. Reads the sheet\'s own part-id buffer, so it honours the dissolved shell and open panels.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { columns: { type: 'integer', minimum: 8, maximum: 96, description: 'Ray grid width; rows follow the sheet aspect. Default 40.' } } },
      annotations: READ_ONLY,
      run: ({ columns = 40 } = {}) => {
        if (!Number.isInteger(columns) || columns < 8 || columns > 96) throw new Error('columns must be an integer from 8 to 96');
        return { view: st.view, camera: cameraState(), ...visibleParts(columns) };
      },
    },
    {
      name: 'clearance',
      title: 'Clearance between two parts',
      description: 'Nearest surface-to-surface gap in metres between two components as they are posed right now (open panels and explode change it), with the two closest points in the vehicle frame. Unlike measure, which uses bounding-box centres, this is the real gap: use it for packaging questions such as how close the battery pack sits to the floor or a tyre to its arch. Zero means the surfaces touch or intersect.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
      annotations: READ_ONLY,
      run: ({ from, to }) => {
        const a = findPart(from), b = findPart(to);
        if (!a || !b) throw new Error(`no part "${!a ? from : to}". Call list_parts for the ${car().order.length} available ids.`);
        if (a === b) throw new Error('clearance needs two different components');
        car().root?.updateMatrixWorld(true);
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
      name: 'frame_point',
      title: 'Frame a point in the vehicle frame',
      description: 'Point the camera at a coordinate in the vehicle frame (metres: x forward from the wheelbase midpoint, y up from the ground, z to the right) and look at it from a chosen bearing and distance. For inspecting a place rather than a part: an engine finding at x/y/z, a gap between two components, a spot on the skin. Omitted azimuth and elevation keep the current bearing; distance defaults to 1.6 m. Things under the shell need set_motion {motion:"panels", on:true} first.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['x', 'y', 'z'],
        properties: {
          x: { type: 'number', minimum: -4, maximum: 4 }, y: { type: 'number', minimum: -0.5, maximum: 3 }, z: { type: 'number', minimum: -2, maximum: 2 },
          azimuth_deg: { type: 'number' }, elevation_deg: { type: 'number', minimum: 2, maximum: 86 },
          distance_m: { type: 'number', minimum: 1.2, maximum: 22, description: 'Camera distance from the point; 1.2 m is the floor (the near plane is 0.5 m).' },
        },
      },
      annotations: SAFE_SET,
      run: ({ x, y, z, azimuth_deg, elevation_deg, distance_m = 1.6 }) => {
        for (const [k, v, lo, hi] of [['x', x, -4, 4], ['y', y, -0.5, 3], ['z', z, -2, 2]]) {
          if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be a number between ${lo} and ${hi} metres`);
        }
        takeCamera(true);
        if (azimuth_deg !== undefined) rig.cur.az = azimuth_deg;
        if (elevation_deg !== undefined) rig.cur.el = Math.max(2, Math.min(86, elevation_deg));
        rig.cur.tx = x; rig.cur.ty = y; rig.cur.tz = z;
        rig.cur.dist = Math.max(1.2, Math.min(22, distance_m)); rig.userZoom = true;
        const out = { point_m: { x: round(x), y: round(y), z: round(z) }, camera: cameraState() };
        const cabin = sheet().cabin ?? { z: 0.85, y0: 0.25, y1: 1.55 };
        if (st.panels && Math.abs(z) < cabin.z && y > cabin.y0 && y < cabin.y1) out.hint = 'That point is inside the body. Call set_motion {motion:"panels", on:true} to dissolve the shell, or expect to see the skin.';
        return out;
      },
    },
    {
      name: 'reset',
      title: 'Reset digital twin presentation',
      description: 'Return the sheet to how it opens: no run, ISO view, shell on, nothing exploded or open, nothing selected. The ISO view drifts slowly by design, so the camera pose it returns to is not fixed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: SAFE_SET,
      run: () => {
        ctx.run?.stop();   // the sheet opens with no run on
        ctx.select(null);
        for (const [m, want] of [['drive', false], ['lights', false], ['explode', false], ['open', false], ['run', true]]) {
          const cur = { run: st.run, drive: st.drive, lights: st.lights, explode: st.explodeOn, open: st.openOn }[m];
          if (cur !== want) motion(m);
        }
        if (!st.panels) motion('panels');
        ui.setCards(true, !!ctx.tourState?.().running); setView('iso');
        // Every other mutating tool here returns the state it produced. An
        // acknowledgement forces a second call to find out what happened.
        return {
          ok: true,
          view: 'iso',
          motions: { run: st.run, drive: st.drive, lights: st.lights, panels: !st.panels, explode: st.explodeOn, open: st.openOn },
          annotations_visible: true,
          camera: cameraState(),
          camera_is: 'the pose being left; the view transition is still running',
          settles_in_ms: 1150,
        };
      },
    },
    // ---- run mode: the Roadster driven by the drive physics at the wall-ride ramp ----
    {
      name: 'start_run',
      title: 'Start a run at the wall-ride ramp',
      description: 'Start the run mode, as the tray\'s PLAY does: the Tesla Roadster at the start line at the foot of the wall-ride ramp, 8 m before the curl, which turns vertical 9 m up and runs on upside down to an overhang 21.6 m up (the hop autopilot starts 30 m back), in drive mode with a chase camera. A real-time simulation decides whether the car makes the wall ride or falls off it, and whether a hop lands. Switches the Garage to the Roadster first if another vehicle is on the sheet. Without autopilot the car waits for set_drive_inputs or a person\'s keys; autopilot "wallride" drives the reveal\'s wall ride (fans on, about 20 ft/s up the wall, a hang upside down on the overhang, then off the tip on the jets) and "hop" the thruster hop (8.5 m up on the corner jets and down again); any input takes over from the autopilot (set_drive_inputs with only fans or wing leaves it driving). A run already on starts again from its start line. The tools that move the drawing\'s own views, camera or motions (set_view, set_motion, set_camera, orbit_camera, frame_part, highlight_part, frame_point) end the run first, as stop_run does. Returns get_run_state.',
      inputSchema: { type: 'object', properties: { autopilot: { type: 'string', enum: ['wallride', 'hop'] } }, additionalProperties: false },
      annotations: SAFE_ACTION,
      run: async ({ autopilot } = {}) => {
        const r = runMode();
        const here = fleet().length ? !!fleet().find((v) => v.id === current().id)?.play : true;
        if (!here) {
          const target = fleet().find((v) => v.play);
          if (!target || !ctx.setVehicle) throw new Error('No vehicle in this Garage has a run mode.');
          await ctx.setVehicle(target.id);
        }
        if (r.active()) r.stop();
        if (!(await r.start({ autopilot: autopilot ?? null }))) throw new Error('The run did not start (the vehicle changed while it loaded).');
        return { vehicle: current(), ...r.status() };
      },
    },
    {
      name: 'stop_run',
      title: 'Stop the run',
      description: 'End the run, as STOP or Esc does: the ramp goes, the car is parked back at the garage origin and the sheet returns to its ISO view. Returns how the run ended (last), or nothing when no run was on.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: SAFE_SET,
      run: () => {
        const r = runMode(), stopped = r.stop();
        return { stopped, ...r.status() };
      },
    },
    {
      name: 'set_drive_inputs',
      title: 'Hold the drive inputs',
      description: 'Set what the driver holds in a run; each value stays until changed, and omitted ones keep theirs. throttle -1..1 (negative reverses), brake 0..1, steer -1..1 (+ is right), boost (the four rear cold-gas nozzles), hop (the corner jets: lift off, hover, and once let go a landing burn), yawL / yawR (the nose side jets: nose left / right), fans (the downforce fans, about 4,800 kgf once spooled; they hold the car on the wall) and wing (road, lowDrag, highDownforce). The thrust gas is one 250 kg tank whose pressure falls as it empties. Takes over from an autopilot, except a call that sets only fans and/or wing: the autopilot keeps driving with the car set up that way (start_run with autopilot "wallride", then fans: false, is the same wall ride without its fans). Needs a run (start_run). Returns the inputs the next physics step will use and get_run_state.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          throttle: { type: 'number', minimum: -1, maximum: 1 }, brake: { type: 'number', minimum: 0, maximum: 1 }, steer: { type: 'number', minimum: -1, maximum: 1 },
          fans: { type: 'boolean' }, boost: { type: 'boolean' }, hop: { type: 'boolean' }, yawL: { type: 'boolean' }, yawR: { type: 'boolean' },
          wing: { type: 'string', enum: ['road', 'lowDrag', 'highDownforce'] },
        },
      },
      annotations: SAFE_SET,
      run: (inputs) => {
        const r = runMode(), next = r.setInputs(inputs);
        return { ...r.status(), inputs: next };   // what the next physics step uses
      },
    },
    {
      name: 'get_run_state',
      title: 'Read the run',
      description: 'The run as its telemetry shows it: active, outcome (running, summit, fell, crashed or stopped) and its message in words ("Held the overhang", "Fell off at 108 deg", "Crashed", "Out of gas"), speed km/h, pitch deg (past 90 up the wall, about 170 upside down on the overhang), altitude ft, downforce kg, g, tank psi and gas kg, fans %, wing, the car\'s position in metres (x along the run-in, the ramp\'s foot at x = 0; y up), the inputs in use, whether an autopilot drives, and the camera. With no run on: active false and how the last run ended.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => {
        const here = fleet().length ? !!fleet().find((v) => v.id === current().id)?.play : true;
        return { vehicle: current(), run_mode_available: here && !!ctx.run, ...(ctx.run ? ctx.run.status() : { active: false, last: null }) };
      },
    },
  ];

  // ---- dispatch -------------------------------------------------------------------------------
  // A private identity marks calls made by the tour's sequencer. Every surface uses this dispatcher,
  // and any other call while the tour runs interrupts it, which is the tour's contract.
  const tourSource = Symbol('tour');
  const SHEET_TOOLS = ['set_view', 'set_motion', 'set_camera', 'orbit_camera', 'frame_part', 'highlight_part', 'frame_point'];
  const CAR_FRAME_READS = ['list_parts', 'get_part', 'measure', 'clearance'];
  const inCarFrame = (fn) => {
    const root = car().root, p = root.position.clone(), q = root.quaternion.clone();
    root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
    try { return fn(); } finally { root.position.copy(p); root.quaternion.copy(q); root.updateMatrixWorld(true); }
  };
  const call = async (name, args = {}, source) => {
    // Reads and the host's context sync do not touch the scene, so they are not interruptions.
    if (ctx.stopTour && source !== tourSource && !['get_state', 'get_vehicles', 'start_tour', 'stop_tour', 'set_vehicle_context', 'get_specification', 'list_parts', 'get_part', 'measure', 'clearance', 'list_visible_parts', 'get_run_state'].includes(name)) ctx.stopTour('tool');
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool "${name}". Available: ${TOOLS.map((x) => x.name).join(', ')}`);
    const input = args === undefined || args === null ? {} : args;
    validateValue(input, t.inputSchema, name);
    // A run holds the camera and poses the car; these work on the sheet's own views and motions,
    // so they end the run first (as the tour, reset and a vehicle switch do) rather than act unseen.
    if (SHEET_TOOLS.includes(name) && ctx.run?.active()) {
      // a call that will fail anyway leaves the run alone
      if ((name === 'frame_part' || name === 'highlight_part') && input.part != null && !findPart(input.part)) {
        throw new Error(`no part "${input.part}". Call list_parts for the ${car().order.length} available ids.`);
      }
      ctx.run.stop();
    }
    // In a run the car is posed on the ramp; these read it in its own frame, as if it stood at
    // the garage origin, so their numbers mean what the sheet's do.
    if (CAR_FRAME_READS.includes(name) && ctx.run?.running?.()) {
      return { ...inCarFrame(() => t.run(input)), run_active: true, frame_note: 'measured in the car frame; the run poses the car on the ramp (get_run_state has where it is)' };
    }
    return t.run(input);
  };

  // The Home demo uses the tour's dispatcher privately. It has no public tool API,
  // message bridge, registration watcher or hidden agent-tools UI.
  if (ctx.internalOnly) return {
    call,
    callTour: (name, args) => call(name, args, tourSource),
    dispose() {},
  };

  // 1. window.r2 — present on full Garage surfaces regardless of browser support
  const api = {
    tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => (
      { name, title, description, inputSchema, annotations }
    )),
    call,
    registered: false,
    api: null,
  };
  for (const t of TOOLS) api[t.name] = (args = {}) => call(t.name, args);
  window.r2 = api;

  // 2. postMessage bridge, for the sheet embedded in an iframe
  const onBridgeMessage = async (e) => {
    const m = e.data;
    // Same origin, and from the page that embedded or opened this sheet (or the sheet itself). The
    // reply goes back to whoever asked, never to '*'.
    const parent = window.parent, fromHost = e.source && (e.source === window || (parent && parent !== window && e.source === parent) || (window.opener && e.source === window.opener) || (!parent || parent === window));
    if (
      e.origin !== location.origin
      || !fromHost
      || !isRecord(m)
      || m.source !== 'r2-blueprint'
      || !((typeof m.id === 'string' && m.id.length >= 1 && m.id.length <= 128) || (typeof m.id === 'number' && Number.isFinite(m.id)))
      || typeof m.tool !== 'string'
    ) return;
    try { e.source?.postMessage({ source: 'r2-blueprint-result', id: m.id, ok: true, result: await call(m.tool, m.args) }, e.origin); }
    catch (err) { e.source?.postMessage({ source: 'r2-blueprint-result', id: m.id, ok: false, error: String(err.message || err) }, e.origin); }
  };
  window.addEventListener('message', onBridgeMessage);

  // 3. Browser registration. Only when this sheet is the page: framed, the host owns the agent
  // surface and reaches every tool over the bridge above; a second copy of the tools from inside
  // the iframe would let an agent reach set_vehicle_context directly and wedge the host's sync.
  // A missing window.top (a stub) is not a frame; a cross-origin one that throws is.
  const framed = (() => { try { return !!window.top && window.top !== window; } catch { return true; } })();
  const registrationController = new AbortController();
  let stopWatch = () => {};
  api.framed = framed;
  api.dispose = () => {
    registrationController.abort(); stopWatch();
    window.removeEventListener('message', onBridgeMessage);
    if (window.r2 === api) delete window.r2;
  };
  ui.setAgentTools?.(api);
  api.registration = framed ? Promise.resolve(false) : new Promise((resolve) => {
    stopWatch = watchWebMCP(api, call, registrationController.signal, (ok) => { ui.setAgentTools?.(api); resolve(ok); });
  });
  // The sequencer's private dispatcher rides on the returned handle only, never on window.r2: an
  // agent must not be able to make calls that the tour would not treat as an interruption.
  return Object.create(api, { callTour: { value: (name, args) => call(name, args, tourSource) } });
}

// Register with the browser: document.modelContext first, then navigator.modelContext; registerTool
// per tool (titles and annotations travel), provideContext as the legacy fallback. Retries every
// 250 ms for twelve seconds so an API injected after load still gets the tools, never registering
// a tool twice on the same object. Calls done(true) on success, done(false) at the deadline or on
// abort. Returns a function that stops the watch.
export function watchWebMCP(api, call, signal, done = () => {}) {
  const completed = new WeakMap();
  let busy = false, ended = false;
  const finish = (ok) => { if (ended) return; ended = true; clearInterval(timer); clearTimeout(deadline); done(ok); };
  const declarations = () => api.tools.map((t) => ({ ...t, async execute(args = {}, options = {}) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Tool execution was aborted.', 'AbortError');
    try {
      const result = await call(t.name, args);
      if (options.signal?.aborted) throw options.signal.reason || new DOMException('Tool execution was aborted.', 'AbortError');
      return result;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return { content: [{ type: 'text', text: `error: ${err.message || err}` }], isError: true };
    }
  } }));
  const attempt = async () => {
    if (busy || ended || signal?.aborted) return;
    const mc = (typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext) || null;
    const surface = typeof document !== 'undefined' && document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
    const method = typeof mc?.registerTool === 'function' ? 'registerTool' : typeof mc?.provideContext === 'function' ? 'provideContext' : null;
    if (!method) return;
    busy = true;
    try {
      if (method === 'registerTool') {
        let done = completed.get(mc); if (!done) { done = new Set(); completed.set(mc, done); }
        const results = await Promise.allSettled(declarations().map(async (t) => { if (!done.has(t.name)) { await mc.registerTool(t, { signal }); done.add(t.name); } }));
        const failure = results.find((r) => r.status === 'rejected'); if (failure) throw failure.reason;
      } else await mc.provideContext({ tools: declarations() });
      api.registered = true; api.api = `${surface}.${method}`;
      finish(true);
    } catch (err) {
      api.registrationError = String(err?.message || err);
      console.warn('[r2] WebMCP registration failed:', err);
    } finally { busy = false; }
  };
  const timer = setInterval(attempt, 250);
  const deadline = setTimeout(() => finish(false), 12000);
  signal?.addEventListener?.('abort', () => finish(false), { once: true });
  void attempt();
  return () => finish(false);
}
