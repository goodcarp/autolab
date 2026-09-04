// WebMCP: expose the drawing to an agent as callable tools.
//
// Three surfaces, all driving the same handlers, because the ecosystem has not settled:
//   1. navigator.modelContext  - the W3C Web Model Context proposal (Chrome origin trial). Both the
//      provideContext({tools}) and registerTool(tool) shapes are tried; whichever exists is used.
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
      name: 'get_state',
      title: 'Get digital twin state',
      description: 'Current view preset, camera pose, which motions are running, and what is selected. Call this first to orient.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      run: () => ({
        camera: cameraState(),
        view: st.view,
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
      run: ({ visible }) => { ui.setCards(visible); return { annotations_visible: visible }; },
    },
    {
      name: 'get_specification',
      title: 'Get vehicle specification',
      description: 'The published Rivian R2 dimensions the model is built to. All values are lengths in metres — there are no masses or times here. Also returns the model\'s own derived coordinates (NOSE, TAIL, XF, XR: the x positions of the bumpers and axles), which is what part bounds and measurements are expressed against. The body is an independent reconstruction fitted to published dimensions and photographs, not manufacturer CAD.',
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
        ui.setCards(true); setView('iso');
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
  const call = async (name, args = {}) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool "${name}". Available: ${TOOLS.map((x) => x.name).join(', ')}`);
    const input = args === undefined ? {} : args;
    validateValue(input, t.inputSchema, name);
    return t.run(input);
  };

  // 1. window.r2 — always present, so automation never depends on an origin trial being enabled
  const api = {
    tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => (
      { name, title, description, inputSchema, annotations }
    )),
    call,
    registered: false,
  };
  for (const t of TOOLS) api[t.name] = (args = {}) => call(t.name, args);
  window.r2 = api;

  // 2. postMessage bridge, for the sheet embedded in an iframe
  const onBridgeMessage = async (e) => {
    const m = e.data;
    const expectedSource = window.parent === window ? window : window.parent;
    if (
      e.origin !== location.origin
      || e.source !== expectedSource
      || !isRecord(m)
      || m.source !== 'r2-blueprint'
      || typeof m.id !== 'string'
      || m.id.length < 1
      || m.id.length > 128
      || typeof m.tool !== 'string'
    ) return;
    try { e.source?.postMessage({ source: 'r2-blueprint-result', id: m.id, ok: true, result: await call(m.tool, m.args) }, e.origin); }
    catch (err) { e.source?.postMessage({ source: 'r2-blueprint-result', id: m.id, ok: false, error: String(err.message || err) }, e.origin); }
  };
  window.addEventListener('message', onBridgeMessage);

  // 3. modelContext — current hosts expose this on document; retain the
  // navigator fallback for proposal-era browsers.
  // Register only when the Garage is the page, not when AutoLab has embedded
  // it. Framed, the host page owns the agent surface and drives this drawing
  // over the bridge; publishing a second, unguarded copy of these tools from
  // inside the iframe would let an agent reach set_vehicle_context directly and
  // wedge the sync the host is maintaining. The postMessage bridge below is
  // installed either way, which is how the host still reaches every tool.
  const framed = (() => {
    try {
      return window.top !== window;
    } catch {
      // Cross-origin parent: we are certainly framed.
      return true;
    }
  })();
  const mc = framed ? null : (document.modelContext || navigator.modelContext);
  const registrationController = new AbortController();
  api.dispose = () => {
    registrationController.abort();
    window.removeEventListener('message', onBridgeMessage);
    if (window.r2 === api) delete window.r2;
  };
  if (mc) {
    const decl = TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      async execute(args = {}, options = {}) {
        if (options.signal?.aborted) throw options.signal.reason || new DOMException('Tool execution was aborted.', 'AbortError');
        const result = await call(t.name, args);
        if (options.signal?.aborted) throw options.signal.reason || new DOMException('Tool execution was aborted.', 'AbortError');
        return result;
      },
    }));
    api.registration = (async () => {
      if (typeof mc.provideContext === 'function') {
        await mc.provideContext({ tools: decl });
      } else if (typeof mc.registerTool === 'function') {
        await Promise.all(decl.map((t) => mc.registerTool(t, { signal: registrationController.signal })));
      } else {
        return false;
      }
      api.registered = true;
      return true;
    })().catch((err) => {
      registrationController.abort();
      api.registrationError = String(err.message || err);
      console.warn('[r2] WebMCP registration failed:', err);
      return false;
    });
  } else {
    api.registration = Promise.resolve(false);
  }
  return api;
}
