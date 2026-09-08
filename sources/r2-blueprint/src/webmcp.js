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
  const { st, rig, vehicle, overlay, ui, setView, motion, config } = ctx;
  let syncedContextRevision = null;
  let syncedContextFingerprint = null;

  // Stated on every tool that returns a coordinate. Without it bounds_m and
  // delta_m are numbers an agent cannot interpret.
  const AXES = 'x forward (+x is the nose), y up (0 is the ground), z lateral (+z is the passenger side); metres';
  const partIds = () => vehicle.order.map((p) => p.name);
  const findPart = (name) => {
    if (!name) return null;
    if (vehicle.parts[name]) return vehicle.parts[name];
    const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return vehicle.order.find((p) => p.name.toLowerCase() === k
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
        vehicle.root?.updateMatrixWorld(true);
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
      if (!rig.ray || !vehicle.pickables) throw new Error('list_visible_parts needs the drawing\'s renderer or ray picking; neither is available here.');
      vehicle.root?.updateMatrixWorld(true);
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

  const TOOLS = [
    {
      name: 'start_tour',
      title: 'Start the guided tour',
      description: 'Start the 30-second tour: overview, illuminated headlamps, side dimensions, structural battery, front drive unit, open panels, exploded assembly, drive with lights, then reset. from is a 1-based step. Any other call except get_state/start_tour/stop_tour interrupts the tour; stop_tour stops it explicitly. Any call that moves the scene (views, motions, camera, framing, highlighting, annotations, reset), and any click or key on the drawing, stops it where it is; reads and the host\'s context sync do not.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { from: { type: 'integer', minimum: 1, maximum: Math.max(1, config.tour?.length ?? 1) } } },
      annotations: SAFE_ACTION,
      run: ({ from = 1 }) => {
        if (!ctx.startTour || !config.tour?.length) throw new Error('The tour is not available on this sheet.');
        if (!Number.isInteger(from) || from < 1 || from > config.tour.length) throw new Error(`from must be an integer from 1 to ${config.tour.length}`);
        return ctx.startTour(from - 1);
      },
    },
    {
      name: 'stop_tour',
      title: 'Stop the guided tour',
      description: 'Stop the tour at its current step without restoring the scene. The tour shows views, lights, dimensions, battery, drive unit, open panels, explode and drive. Any other call except get_state/start_tour/stop_tour also interrupts it. Reads never stop the tour; only this, a scene-moving call, or a person\'s click or key does.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: SAFE_SET,
      run: () => (ctx.stopTour ? ctx.stopTour('tool') : { running: false }),
    },
    {
      name: 'get_state',
      title: 'Get digital twin state',
      description: 'Current view preset, camera pose, which motions are running, and what is selected. Call this first to orient.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => ({
        camera: cameraState(),
        view: st.view,
        tour: ctx.tourState ? ctx.tourState() : undefined,
        vehicle_context: { ...st.vehicleContext },
        vehicle_context_synced: syncedContextRevision !== null,
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
        if (syncedContextRevision !== null && context.revision < syncedContextRevision) {
          throw new Error(`stale vehicle context revision ${context.revision}; Garage is already at revision ${syncedContextRevision}`);
        }
        if (
          syncedContextRevision === context.revision
          && syncedContextFingerprint !== null
          && syncedContextFingerprint !== fingerprint
        ) {
          throw new Error(`vehicle context revision ${context.revision} conflicts with the context already synchronized at that revision`);
        }
        const changed = syncedContextFingerprint !== fingerprint;
        st.vehicleContext = { ...context };
        syncedContextRevision = context.revision;
        syncedContextFingerprint = fingerprint;
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
        if (!config.views.some((v) => v.id === view)) throw new Error(`unknown view "${view}"`);
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
      description: 'Turn one of the sheet\'s motions on or off. run = idle telemetry and wheel spin; drive = rolling road with steering; lights = headlamp and tail-lamp beams; panels = dissolve the body shell to reveal the chassis; explode = separate every component along its assembly axis; open = swing the hood, liftgate, all four doors and the charge-port door. run and drive are coupled: turning drive on turns run on, and turning run off turns drive off. The reply reports every motion, not just the one asked about, so the coupling is visible.',
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
        return { motion: m, on: now[m], motions: now };
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
      description: 'Every named component in the vehicle. category is one of shell (body panels and glass), chassis (battery, subframes, drive units), running (the four wheels) or interior; the brakes are a chassis part, carried on the wheel hubs. Pass detail:true for bounding boxes in metres.',
      inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['shell', 'chassis', 'running', 'interior'] }, detail: { type: 'boolean' } }, additionalProperties: false },
      annotations: READ_ONLY,
      run: ({ category, detail }) => {
        const parts = vehicle.order.filter((p) => !category || p.category === category).map((p) => describe(p, detail));
        return { count: parts.length, total_count: vehicle.order.length, parts };
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
        if (!p) throw new Error(`no part "${part}". Call list_parts for the ${vehicle.order.length} available ids.`);
        return describe(p, true);
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
        if (!p) throw new Error(`no part "${part}". Call list_parts for the ${vehicle.order.length} available ids.`);
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
        if (part && !p) throw new Error(`no part "${part}". Call list_parts for the ${vehicle.order.length} available ids.`);
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
      description: 'The published dimensions the RX2 model is built to (an independent reconstruction fitted to the Rivian R2\'s published figures). All values are lengths in metres — there are no masses or times here. Also returns the model\'s own derived coordinates (NOSE, TAIL, XF, XR: the x positions of the bumpers and axles), which is what part bounds and measurements are expressed against. The body is an independent reconstruction fitted to published dimensions and photographs, not manufacturer CAD.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => ({
        units: 'metres',
        axes: AXES,
        dimensions_m: { ...vehicle.SPEC },
        basis: 'Independent reconstruction fitted to Rivian\'s published R2 dimensions and photographs. Not manufacturer CAD, not a scan.',
      }),
    },
    {
      name: 'measure',
      title: 'Measure between digital twin parts',
      description: 'Distance in metres between the bounding-box CENTRES of two components, plus the per-axis separation. This is not a clearance: two parts that interpenetrate and two parts 200 mm apart can return the same distance. For clearance, read both parts\' bounds_m from get_part and compare the facing faces. Axes: x forward (+x is the nose), y up (0 is the ground), z lateral (+z is the passenger side).',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', minLength: 1, maxLength: 80 }, to: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false },
      annotations: READ_ONLY,
      run: ({ from, to }) => {
        const a = findPart(from), b = findPart(to);
        if (!a || !b) throw new Error(`no part "${!a ? from : to}". Call list_parts for the ${vehicle.order.length} available ids.`);
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
        if (!a || !b) throw new Error(`no part "${!a ? from : to}". Call list_parts for the ${vehicle.order.length} available ids.`);
        if (a === b) throw new Error('clearance needs two different components');
        vehicle.root?.updateMatrixWorld(true);
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
        if (st.panels && Math.abs(z) < 0.85 && y > 0.25 && y < 1.55) out.hint = 'That point is inside the body. Call set_motion {motion:"panels", on:true} to dissolve the shell, or expect to see the skin.';
        return out;
      },
    },
    {
      name: 'reset',
      title: 'Reset digital twin presentation',
      description: 'Return the sheet to how it opens: ISO view, shell on, nothing exploded or open, nothing selected. The ISO view drifts slowly by design, so the camera pose it returns to is not fixed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: SAFE_SET,
      run: () => {
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
  ];

  // ---- dispatch -------------------------------------------------------------------------------
  // A private identity marks calls made by the tour's sequencer. Every surface uses this dispatcher,
  // and any other call while the tour runs interrupts it, which is the tour's contract.
  const tourSource = Symbol('tour');
  const call = async (name, args = {}, source) => {
    // Reads and the host's context sync do not touch the scene, so they are not interruptions.
    if (ctx.stopTour && source !== tourSource && !['get_state', 'start_tour', 'stop_tour', 'set_vehicle_context', 'get_specification', 'list_parts', 'get_part', 'measure', 'clearance', 'list_visible_parts'].includes(name)) ctx.stopTour('tool');
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool "${name}". Available: ${TOOLS.map((x) => x.name).join(', ')}`);
    const input = args === undefined || args === null ? {} : args;
    validateValue(input, t.inputSchema, name);
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
