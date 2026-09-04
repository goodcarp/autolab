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
      name: 'get_state',
      description: 'Current view preset, camera pose, which motions are running, and what is selected. Call this first to orient.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({
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
      description: 'Place the camera by absolute pose. azimuth 0 looks at the driver side in profile and increases clockwise seen from above; elevation 0 is eye level, 90 is directly overhead. Any field may be omitted to leave it unchanged.',
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
      description: 'Point the camera at one component and zoom so it fills the sheet. The best way to inspect a specific piece of the vehicle.',
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
      run: ({ visible }) => { ui.setCards(visible); return { annotations_visible: visible }; },
    },
    {
      name: 'get_specification',
      description: 'The published figures the RX2 model is built to, in metres, kilograms and seconds (an independent reconstruction fitted to the Rivian R2\'s published dimensions). Every profile curve in the geometry is fitted to these plus Rivian\'s official orthographic drawings.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({ ...vehicle.SPEC }),
    },
    {
      name: 'measure',
      description: 'Distance in metres between the centres of two components, plus the per-axis separation. Use it to check clearances and packaging.',
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
        ui.setCards(true); setView('iso');
        return { ok: true };
      },
    },
  ];

  // ---- dispatch -------------------------------------------------------------------------------
  const call = async (name, args = {}) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool "${name}". Available: ${TOOLS.map((x) => x.name).join(', ')}`);
    return t.run(args || {});
  };

  // 1. window.r2 — always present, so automation never depends on an origin trial being enabled
  const api = { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), call };
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

  // 3. navigator.modelContext — the actual WebMCP surface where the browser supports it
  const mc = navigator.modelContext;
  if (mc) {
    const decl = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      async execute(args) {
        try { return { content: [{ type: 'text', text: JSON.stringify(await call(t.name, args), null, 1) }] }; }
        catch (err) { return { content: [{ type: 'text', text: `error: ${err.message || err}` }], isError: true }; }
      },
    }));
    try {
      if (typeof mc.provideContext === 'function') mc.provideContext({ tools: decl });
      else if (typeof mc.registerTool === 'function') decl.forEach((t) => mc.registerTool(t));
      api.registered = true;
    } catch (err) { console.warn('[r2] WebMCP registration failed:', err); }
  }
  return api;
}
