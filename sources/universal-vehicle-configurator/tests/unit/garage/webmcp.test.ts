import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
// @ts-expect-error The Garage is a self-contained browser artifact excluded from host TS compilation.
import { installWebMCP } from "../../../public/garage/src/webmcp.js";

type GarageApi = {
  tools: Array<{
    name: string;
    title: string;
    inputSchema: Record<string, unknown>;
    annotations: ModelContextAnnotations;
  }>;
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  registration: Promise<boolean>;
  dispose(): void;
  [name: string]: unknown;
};

function part(name: string, label: string, category: string, x: number) {
  const group = new THREE.Group();
  group.position.x = x;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  group.add(mesh);
  return {
    name,
    label,
    category,
    desc: `${label} description`,
    group,
    meshes: [mesh],
    explode: new THREE.Vector3(x, 0, 0),
  };
}

/**
 * A part whose meshes live somewhere other than its own group.
 *
 * The real brakes are built this way — twenty meshes parented into the four
 * wheel hubs so they steer and turn with the wheel — which leaves the part's
 * own group empty. Anything that measures the group instead of the meshes
 * reports nothing for it.
 */
function detachedPart(name: string, label: string, category: string, x: number) {
  const host = new THREE.Group();
  host.position.x = x;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
  host.add(mesh);
  host.updateWorldMatrix(true, true);
  return {
    name,
    label,
    category,
    desc: `${label} description`,
    group: new THREE.Group(),
    meshes: [mesh],
    explode: new THREE.Vector3(0, 0, 0),
  };
}

function setupGarage() {
  const battery = part("battery", "Structural battery", "chassis", 0);
  const body = part("body", "Body shell", "shell", 2);
  const brakes = detachedPart("brakes", "Brakes", "chassis", 1.4);
  const order = [battery, body, brakes];
  const st = {
    view: "iso",
    run: true,
    drive: false,
    lights: false,
    panels: true,
    explode: 0,
    open: 0,
    explodeOn: false,
    openOn: false,
    hidePanels: false,
    hoverPart: null as typeof battery | typeof body | null,
    vehicleContext: {
      build: "Rivian R2",
      paint: "Not supplied",
      wheels: "Not supplied",
      interior: "Not supplied",
      rangeMiles: null as number | null,
      vehicleTotal: 0,
      revision: 1,
    },
  };
  const rig = {
    cur: { az: 20, el: 18, dist: 8, ortho: 0, tx: 0, ty: 0.8, tz: 0 },
    view: "iso" as string | null,
    settled: true,
    fov: 36,
    userZoom: false,
    _orthoFade: true,
    grab: vi.fn(() => { rig.view = null; }),
    zoom: vi.fn((factor: number) => { rig.cur.dist *= factor; }),
  };
  const ui = {
    setView: vi.fn(),
    showViewTitle: vi.fn(),
    showPanels: vi.fn(),
    setCards: vi.fn((visible: boolean) => document.body.classList.toggle("cards-off", !visible)),
  };
  const overlay = { setView: vi.fn() };
  const setView = vi.fn((view: string) => { st.view = view; rig.view = view; });
  const motion = vi.fn((name: string) => {
    if (name === "run") st.run = !st.run;
    if (name === "drive") st.drive = !st.drive;
    if (name === "lights") st.lights = !st.lights;
    if (name === "panels") st.panels = !st.panels;
    if (name === "explode") st.explodeOn = !st.explodeOn;
    if (name === "open") st.openOn = !st.openOn;
  });
  const select = vi.fn((selected: typeof battery | typeof body | null) => {
    st.hoverPart = selected;
  });
  const config = {
    views: ["iso", "q34f", "q34r", "side", "front", "top"].map((id) => ({ id })),
    motions: ["run", "drive", "lights", "panels", "explode", "open"].map((id) => ({ id })),
  };
  const vehicle = {
    order,
    parts: { battery, body, brakes },
    SPEC: { length: 4.715, width: 1.9 },
  };
  return { st, rig, ui, overlay, setView, motion, select, config, vehicle, brakes };
}

let activeApi: GarageApi | undefined;

afterEach(() => {
  activeApi?.dispose();
  activeApi = undefined;
  delete document.modelContext;
  document.body.className = "";
  vi.restoreAllMocks();
});

describe("Garage direct WebMCP surface", () => {
  it("does not publish its own tools when AutoLab has embedded it", async () => {
    // Framed, the host page owns the agent surface and drives this drawing over
    // the bridge. A second unguarded copy of these tools inside the iframe
    // would let an agent reach set_vehicle_context directly and wedge the sync
    // the host is maintaining.
    const registerTool = vi.fn().mockResolvedValue(undefined);
    document.modelContext = { registerTool };
    const framed = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    try {
      activeApi = installWebMCP(setupGarage()) as GarageApi;
      await expect(activeApi.registration).resolves.toBe(false);
      expect(registerTool).not.toHaveBeenCalled();
      // The bridge is still installed, so the host loses nothing.
      await expect(activeApi.call("get_state")).resolves.toMatchObject({ view: "iso" });
    } finally {
      framed.mockRestore();
    }
  });

  it("measures a part whose meshes hang off another group", async () => {
    // The real brakes are parented into the wheel hubs, so their own group is
    // empty. Measuring the group reports nothing and every tool built on it —
    // get_part, frame_part, measure — then fails or blames a hidden part.
    document.modelContext = { registerTool: vi.fn().mockResolvedValue(undefined) };
    activeApi = installWebMCP(setupGarage()) as GarageApi;
    await activeApi!.registration;
    await expect(activeApi!.call("get_part", { part: "brakes" })).resolves.toMatchObject({
      id: "brakes",
      bounds_m: { size: { x: expect.any(Number) } },
    });
    const measured = await activeApi!.call("measure", { from: "brakes", to: "battery" }) as {
      distance_m: number;
    };
    expect(measured.distance_m).toBeGreaterThan(0);
  });

  it("publishes and functionally exercises all 14 closed, non-destructive tools", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    document.modelContext = { registerTool };
    activeApi = installWebMCP(setupGarage()) as GarageApi;

    await expect(activeApi.registration).resolves.toBe(true);
    expect(activeApi.tools).toHaveLength(14);
    expect(new Set(activeApi.tools.map((tool) => tool.name)).size).toBe(14);
    expect(registerTool).toHaveBeenCalledTimes(14);
    for (const tool of activeApi.tools) {
      expect(tool.title.length).toBeGreaterThan(3);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
    }

    await expect(activeApi.call("get_state")).resolves.toMatchObject({
      vehicle_context_synced: false,
      view: "iso",
    });
    const context = {
      build: "Performance",
      paint: "Esker Silver",
      wheels: "21 in All-Season",
      interior: "Black Crater",
      rangeMiles: 330,
      vehicleTotal: 59485,
      revision: 3,
    };
    await expect(activeApi.call("set_vehicle_context", context)).resolves.toMatchObject({
      synced: true,
      changed: true,
    });
    await expect(activeApi.call("set_vehicle_context", context)).resolves.toMatchObject({
      synced: true,
      changed: false,
    });
    await expect(activeApi.call("set_view", { view: "side" })).resolves.toMatchObject({ view: "side" });
    // The reply carries every motion, not just the one asked about, because run
    // and drive are coupled and a single-motion answer hides that.
    await expect(activeApi.call("set_motion", { motion: "lights", on: true })).resolves.toMatchObject({
      motion: "lights",
      on: true,
      motions: { lights: true },
    });
    await expect(activeApi.call("set_camera", { elevation_deg: 30, distance_m: 6, orthographic: true })).resolves.toMatchObject({ elevation_deg: 30, distance_m: 6, orthographic: true, orthographic_fraction: 1 });
    await expect(activeApi.call("orbit_camera", { d_azimuth_deg: 10, zoom: 0.8 })).resolves.toMatchObject({ azimuth_deg: 30 });
    await expect(activeApi.call("list_parts", { category: "chassis", detail: true })).resolves.toMatchObject({ count: 2, total_count: 3, parts: [{ id: "battery" }, { id: "brakes" }] });
    await expect(activeApi.call("get_part", { part: "Structural battery" })).resolves.toMatchObject({ id: "battery", bounds_m: expect.any(Object) });
    await expect(activeApi.call("frame_part", { part: "battery", margin: 0.5 })).resolves.toMatchObject({ part: "battery", camera: expect.any(Object) });
    await expect(activeApi.call("highlight_part", { part: "body" })).resolves.toEqual({ selected: "body", label: "Body shell" });
    await expect(activeApi.call("set_annotations", { visible: false })).resolves.toEqual({ annotations_visible: false });
    // The reply says what the numbers are and are not: lengths in metres, with
    // the coordinate convention and the basis of the geometry stated, so an
    // agent cannot read them as manufacturer CAD or as masses.
    await expect(activeApi.call("get_specification")).resolves.toMatchObject({
      units: "metres",
      dimensions_m: { length: 4.715, width: 1.9 },
      axes: expect.stringContaining("x forward"),
      basis: expect.stringContaining("Not manufacturer CAD"),
    });
    await expect(activeApi.call("measure", { from: "battery", to: "body" })).resolves.toMatchObject({ from: "battery", to: "body", distance_m: 2 });
    // reset reports the state it produced, like every other mutating tool here.
    await expect(activeApi.call("reset")).resolves.toMatchObject({
      ok: true,
      view: "iso",
      annotations_visible: true,
      motions: { explode: false, open: false },
    });
  });

  it("enforces schemas for direct calls and rejects stale or conflicting context", async () => {
    activeApi = installWebMCP(setupGarage()) as GarageApi;
    const context = {
      build: "Performance", paint: "Silver", wheels: "21 in", interior: "Black",
      rangeMiles: 330, vehicleTotal: 59485, revision: 5,
    };
    await activeApi.call("set_vehicle_context", context);

    await expect(activeApi.call("list_parts", { category: "powertrain" })).rejects.toThrow(/must be one of/u);
    await expect(activeApi.call("set_view", { view: "side", surprise: true })).rejects.toThrow(/unsupported field/u);
    await expect(activeApi.call("set_camera", { distance_m: Number.NaN })).rejects.toThrow(/finite number/u);
    await expect(activeApi.call("orbit_camera", { zoom: -1 })).rejects.toThrow(/at least 0.1/u);
    await expect(activeApi.call("get_part", { part: " " })).rejects.toThrow(/must not be blank/u);
    await expect(activeApi.call("set_annotations", { visible: "yes" })).rejects.toThrow(/must be a boolean/u);
    await expect(activeApi.call("set_vehicle_context", { ...context, revision: 4 })).rejects.toThrow(/stale vehicle context revision 4/u);
    await expect(activeApi.call("set_vehicle_context", { ...context, paint: "Blue" })).rejects.toThrow(/conflicts/u);
  });

  it("accepts bridge requests only from the same-origin parent with a bounded id", async () => {
    activeApi = installWebMCP(setupGarage()) as GarageApi;
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: null,
      data: { source: "r2-blueprint", id: "ignored", tool: "get_state", args: {} },
    }));
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window,
      data: { source: "r2-blueprint", id: "request-1", tool: "get_state", args: {} },
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ source: "r2-blueprint-result", id: "request-1", ok: true }),
      window.location.origin,
    );
  });
});
