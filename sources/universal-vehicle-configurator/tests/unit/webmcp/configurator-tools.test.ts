import { afterEach, describe, expect, it, vi } from "vitest";
import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import type { OwnerGuideBridge } from "../../../src/owner-guide/owner-guide-bridge";
import { createConfiguratorStore } from "../../../src/state/configurator.store";
import { createMutationService } from "../../../src/state/mutation.service";
import {
  CONFIGURATOR_TOOL_NAMES,
  createConfiguratorPresentationController,
  createConfiguratorToolDefinitions,
  registerConfiguratorSiteTools,
  resetConfiguratorSiteToolsForTests,
  unregisterConfiguratorSiteTools,
  type ConfiguratorToolsDependencies,
} from "../../../src/webmcp/configurator-tools";

const catalog = catalogData as unknown as Catalog;

function setup(defaultStageDelayMs = 0): ConfiguratorToolsDependencies {
  const store = createConfiguratorStore(catalog);
  return {
    store,
    mutations: createMutationService(store, catalog, { defaultStageDelayMs }),
    presentation: createConfiguratorPresentationController(),
  };
}

function toolsByName(dependencies = setup()) {
  return new Map(
    createConfiguratorToolDefinitions(dependencies).map((tool) => [tool.name, tool]),
  );
}

describe("real configurator Site Tools", () => {
  afterEach(() => {
    delete document.modelContext;
    delete document.documentElement.dataset.siteTools;
    resetConfiguratorSiteToolsForTests();
  });

  it("registers the full Tier-1 surface once with one shared lifecycle signal", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    document.modelContext = { registerTool };
    const dependencies = setup();

    const first = registerConfiguratorSiteTools(dependencies);
    const second = registerConfiguratorSiteTools(dependencies);
    expect(first).toBe(second);
    await expect(first).resolves.toEqual({
      state: "ready",
      toolNames: CONFIGURATOR_TOOL_NAMES,
    });

    expect(registerTool).toHaveBeenCalledTimes(CONFIGURATOR_TOOL_NAMES.length);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(
      CONFIGURATOR_TOOL_NAMES,
    );
    const signals = registerTool.mock.calls.map(([, options]) => options.signal);
    expect(new Set(signals).size).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0].aborted).toBe(false);
    expect(document.documentElement.dataset.siteTools).toBe("ready");

    unregisterConfiguratorSiteTools();
    expect(signals[0].aborted).toBe(true);
  });

  it("keeps the manual configurator available when Site Tools are unsupported", async () => {
    await expect(registerConfiguratorSiteTools(setup())).resolves.toEqual({
      state: "unsupported",
      toolNames: [],
    });
    expect(document.documentElement.dataset.siteTools).toBe("unsupported");
  });

  it("aborts the shared registration if any tool is rejected", async () => {
    const registerTool = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException("Site Tools disabled", "NotAllowedError"));
    document.modelContext = { registerTool };

    await expect(registerConfiguratorSiteTools(setup())).resolves.toEqual({
      state: "degraded",
      toolNames: CONFIGURATOR_TOOL_NAMES.slice(0, 2),
      message: "Site Tools disabled",
    });
    const signal = registerTool.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(document.documentElement.dataset.siteTools).toBe("degraded");
  });

  it("exposes closed schemas and truthful read tools against the live store", async () => {
    const definitions = createConfiguratorToolDefinitions(setup());
    expect(definitions.map((tool) => tool.name)).toEqual(CONFIGURATOR_TOOL_NAMES);
    expect(
      definitions.every(
        (tool) => tool.inputSchema.additionalProperties === false,
      ),
    ).toBe(true);
    expect(definitions.every((tool) => tool.title && tool.title.length > 3)).toBe(true);
    expect(definitions.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
    expect(definitions.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);

    const tools = new Map(definitions.map((tool) => [tool.name, tool]));
    const current = await tools.get("get_vehicle_configuration")?.execute({});
    expect(current).toEqual(
      expect.objectContaining({
        ok: true,
        revision: 1,
        catalog: expect.objectContaining({ id: "rivian-r2-2026", model: "R2" }),
        configuration: expect.objectContaining({
          valid: true,
          selections: expect.objectContaining({
            build: ["build.performance"],
            wheels: ["wheels.lt21_as"],
          }),
          specs: expect.objectContaining({ range_mi: 330 }),
        }),
        transaction: { active: null, last: null, canUndo: false },
        presentation: {
          revision: 1,
          mode: "showroom",
          viewPreset: "angle",
          focus: "none",
          bodyOpen: false,
        },
      }),
    );

    const options = await tools
      .get("list_vehicle_configuration_options")
      ?.execute({ groupId: "wheels" });
    expect(options).toEqual(
      expect.objectContaining({
        ok: true,
        revision: 1,
        groups: [
          expect.objectContaining({
            id: "wheels",
            selectedOptionIds: ["wheels.lt21_as"],
            options: expect.arrayContaining([
              expect.objectContaining({
                id: "wheels.bs20_at",
                validWithCurrentBuild: true,
                delta: expect.objectContaining({ rangeMiles: -23 }),
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it("simulates without mutation, then applies and undoes one revisioned transaction", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);
    const simulation = await tools
      .get("simulate_vehicle_configuration_change")
      ?.execute({
        expectedRevision: 1,
        patch: { set: { wheels: ["wheels.bs20_at"] } },
      });
    expect(simulation).toEqual(
      expect.objectContaining({
        ok: true,
        currentRevision: 1,
        delta: expect.objectContaining({ rangeMiles: -23 }),
        candidate: expect.objectContaining({
          valid: true,
          specs: expect.objectContaining({ range_mi: 307 }),
        }),
      }),
    );
    expect(dependencies.store.getState().domain.revision).toBe(1);

    const applied = await tools
      .get("apply_vehicle_configuration_transaction")
      ?.execute({
        expectedRevision: 1,
        stages: [
          {
            label: "Choose Glacier White",
            patch: { set: { paint: ["paint.glacier_white"] } },
          },
          {
            label: "Fit all-terrain wheels",
            patch: { set: { wheels: ["wheels.bs20_at"] } },
          },
        ],
      });
    expect(applied).toEqual(
      expect.objectContaining({
        ok: true,
        receipt: expect.objectContaining({
          status: "completed",
          undoEligible: true,
          completedStages: [
            expect.objectContaining({ label: "Choose Glacier White", revision: 2 }),
            expect.objectContaining({ label: "Fit all-terrain wheels", revision: 3 }),
          ],
        }),
      }),
    );
    expect(dependencies.store.getState().resolved.specs.range_mi).toBe(307);

    const stale = await tools
      .get("simulate_vehicle_configuration_change")
      ?.execute({
        expectedRevision: 1,
        patch: { set: { paint: ["paint.esker_silver"] } },
      });
    expect(stale).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "REVISION_CONFLICT", currentRevision: 3 }),
      }),
    );

    const undone = await tools
      .get("undo_vehicle_configuration_transaction")
      ?.execute({ expectedRevision: 3 });
    expect(undone).toEqual(
      expect.objectContaining({
        ok: true,
        revision: 4,
        transactionId: "tx-1-1",
      }),
    );
    expect(dependencies.store.getState().domain.selections.paint).toEqual([
      "paint.esker_silver",
    ]);
    expect(dependencies.store.getState().resolved.specs.range_mi).toBe(330);
  });

  it("sets explicit buyer context without inferring private facts", async () => {
    const dependencies = setup();
    const tool = toolsByName(dependencies).get("set_vehicle_buyer_context");

    const changed = await tool?.execute({
      expectedRevision: 1,
      patch: {
        evExperience: "new",
        state: "CO",
        utility: "xcel",
        chargingSituation: "home_l2_possible",
        useCases: ["road_trip", "snow"],
        priorities: ["range", "price"],
        financing: true,
        crossShopIds: ["model_y", "ioniq_5"],
      },
    });

    expect(changed).toEqual(
      expect.objectContaining({
        ok: true,
        revision: 2,
        buyerContext: {
          evExperience: "new",
          state: "CO",
          utility: "xcel",
          chargingSituation: "home_l2_possible",
          useCases: ["road_trip", "snow"],
          priorities: ["range", "price"],
          financing: true,
          crossShopIds: ["model_y", "ioniq_5"],
        },
        incentives: expect.objectContaining({ potentiallyApplicable: expect.any(Array) }),
      }),
    );
    expect(dependencies.store.getState().domain.buyerContext.state).toBe("CO");

    expect(() => tool?.execute({
      expectedRevision: 2,
      patch: { state: "Colorado" },
    })).toThrow("uppercase US postal code or unknown");
  });

  it("interrupts an in-flight staged transaction after the latest committed stage", async () => {
    const dependencies = setup(10_000);
    const tools = toolsByName(dependencies);
    const pending = tools.get("apply_vehicle_configuration_transaction")?.execute({
      expectedRevision: 1,
      stages: [
        {
          label: "Choose Glacier White",
          patch: { set: { paint: ["paint.glacier_white"] } },
        },
        {
          label: "Fit all-terrain wheels",
          patch: { set: { wheels: ["wheels.bs20_at"] } },
        },
        {
          label: "Switch the interior",
          patch: { set: { interior: ["interior.coastal_cloud"] } },
        },
      ],
    });

    expect(dependencies.store.getState().domain.revision).toBe(2);
    const interruption = await tools
      .get("interrupt_vehicle_configuration_transaction")
      ?.execute({ reason: "agent reconsidered recommendation" });
    expect(interruption).toEqual(
      expect.objectContaining({
        ok: true,
        interrupted: true,
        transactionId: "tx-1-1",
        revision: 2,
      }),
    );

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        receipt: expect.objectContaining({
          status: "interrupted",
          interruptionReason: "agent reconsidered recommendation",
          completedStages: [expect.objectContaining({ label: "Choose Glacier White" })],
          skippedStages: [
            expect.objectContaining({ label: "Fit all-terrain wheels" }),
            expect.objectContaining({ label: "Switch the interior" }),
          ],
        }),
      }),
    );
  });

  it("uses AbortSignal for execution cancellation before any state change", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);
    const controller = new AbortController();
    const reason = new Error("Agent stopped");
    controller.abort(reason);

    await expect(
      tools.get("apply_vehicle_configuration_transaction")?.execute(
        {
          expectedRevision: 1,
          stages: [
            {
              label: "Choose Glacier White",
              patch: { set: { paint: ["paint.glacier_white"] } },
            },
          ],
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(dependencies.store.getState().domain.revision).toBe(1);
  });

  it("bridges agent and manual presentation through one subscribable state", async () => {
    const dependencies = setup();
    const listener = vi.fn();
    const unsubscribe = dependencies.presentation.subscribe(listener);
    const tool = toolsByName(dependencies).get("present_vehicle_configuration");

    // Asking for the angle view in blueprint mode gets the profile instead, and
    // the tool says so rather than returning a state that quietly disagrees.
    expect(
      tool?.execute({ mode: "blueprint", viewPreset: "angle", focus: "wheels" }),
    ).toEqual({
      ok: true,
      changed: true,
      presentation: {
        revision: 2,
        mode: "blueprint",
        viewPreset: "profile",
        focus: "wheels",
        bodyOpen: false,
      },
      unapplied: [
        {
          field: "viewPreset",
          requested: "angle",
          reason: "Blueprint mode only draws the profile and wheel views.",
        },
      ],
    });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "blueprint", viewPreset: "profile" }),
    );

    dependencies.presentation.setFromUser({
      mode: "showroom",
      viewPreset: "angle",
      focus: "none",
    });
    expect(dependencies.presentation.getState()).toEqual({
      revision: 3,
      mode: "showroom",
      viewPreset: "angle",
      focus: "none",
      bodyOpen: false,
    });
    unsubscribe();
  });

  it("preserves one stable snapshot and the blueprint/profile invariant", () => {
    const controller = createConfiguratorPresentationController({
      mode: "blueprint",
      viewPreset: "angle",
    });
    const initial = controller.getState();
    expect(initial).toEqual({
      revision: 1,
      mode: "blueprint",
      viewPreset: "profile",
      focus: "none",
      bodyOpen: false,
    });

    expect(controller.present({ mode: "blueprint" })).toBe(initial);
    expect(controller.getState()).toBe(initial);
  });

  it("opens the body on request and shuts it again for blueprint", () => {
    const controller = createConfiguratorPresentationController();

    expect(controller.present({ bodyOpen: true })).toEqual({
      revision: 2,
      mode: "showroom",
      viewPreset: "angle",
      focus: "none",
      bodyOpen: true,
    });

    // A wireframe of an open door is noise, not information.
    expect(controller.present({ mode: "blueprint" })).toEqual({
      revision: 3,
      mode: "blueprint",
      viewPreset: "profile",
      focus: "none",
      bodyOpen: false,
    });

    // Asking for an open body while in blueprint does not silently leave
    // blueprint; the request is simply not honoured until showroom returns.
    expect(controller.present({ bodyOpen: true })).toEqual({
      revision: 3,
      mode: "blueprint",
      viewPreset: "profile",
      focus: "none",
      bodyOpen: false,
    });
  });

  it("refuses to open a body that cannot open, and says so", () => {
    const dependencies = setup();
    dependencies.presentation.describeBody({
      id: "licensed-glb",
      label: "Licensed compact-SUV reference",
      representsConfiguredVehicle: false,
      basis: "Licensed exterior scan of a different vehicle.",
      canOpen: false,
    });
    const tools = toolsByName(dependencies);

    expect(tools.get("present_vehicle_configuration")?.execute({ bodyOpen: true })).toEqual({
      ok: true,
      changed: false,
      presentation: expect.objectContaining({ bodyOpen: false }),
      unapplied: [
        {
          field: "bodyOpen",
          requested: true,
          reason:
            "The body on screen (Licensed compact-SUV reference) has no openable doors, frunk or liftgate.",
        },
      ],
    });
  });

  it("shuts an already-open body when a body that cannot open takes over", () => {
    const controller = createConfiguratorPresentationController();
    controller.describeBody({
      id: "r2-engineering",
      label: "Rivian R2",
      representsConfiguredVehicle: true,
      basis: "Generated in code.",
      canOpen: true,
    });
    expect(controller.present({ bodyOpen: true }).bodyOpen).toBe(true);

    controller.describeBody({
      id: "licensed-glb",
      label: "Licensed compact-SUV reference",
      representsConfiguredVehicle: false,
      basis: "Licensed exterior scan.",
      canOpen: false,
    });
    expect(controller.getState().bodyOpen).toBe(false);
  });

  it("tells an agent which body is on screen", async () => {
    const dependencies = setup();
    dependencies.presentation.describeBody({
      id: "licensed-glb",
      label: "Licensed compact-SUV reference",
      representsConfiguredVehicle: false,
      basis: "Licensed exterior scan of a different vehicle.",
      canOpen: false,
    });

    const snapshot = await toolsByName(dependencies)
      .get("get_vehicle_configuration")
      ?.execute({});

    // An agent describing what the person is looking at needs to know the
    // picture is not the car being configured.
    expect(snapshot).toEqual(
      expect.objectContaining({
        renderedBody: expect.objectContaining({
          id: "licensed-glb",
          representsConfiguredVehicle: false,
          canOpen: false,
        }),
      }),
    );
  });

  it("can leave the Garage surface it was sent to, and reports which one is showing", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);

    // Inspecting a part moves the page to Garage, which hides the whole
    // configurator. Without a way back an agent is stranded there while the
    // presentation tools keep reporting success against a canvas nobody sees.
    const before = await tools.get("get_vehicle_configuration")?.execute({});
    expect(before).toEqual(expect.objectContaining({ workspace: "configure" }));

    expect(tools.get("set_autolab_workspace")?.execute({ workspace: "garage" }))
      .toEqual({ ok: true, changed: true, workspace: "garage" });
    expect(await tools.get("get_vehicle_configuration")?.execute({}))
      .toEqual(expect.objectContaining({ workspace: "garage" }));

    expect(tools.get("set_autolab_workspace")?.execute({ workspace: "configure" }))
      .toEqual({ ok: true, changed: true, workspace: "configure" });
    expect(tools.get("set_autolab_workspace")?.execute({ workspace: "configure" }))
      .toEqual({ ok: true, changed: false, workspace: "configure" });
  });

  it("rejects an unknown workspace", () => {
    expect(() =>
      toolsByName().get("set_autolab_workspace")?.execute({ workspace: "showroom" }),
    ).toThrow("requires workspace to be one of configure, garage");
  });

  it("rejects a non-boolean bodyOpen", () => {
    expect(() =>
      toolsByName().get("present_vehicle_configuration")?.execute({ bodyOpen: "yes" }),
    ).toThrow("non-boolean bodyOpen");
  });

  it("rejects malformed direct invocations even if a host skips schema validation", async () => {
    const tools = toolsByName();
    expect(() =>
      tools.get("simulate_vehicle_configuration_change")?.execute({
        expectedRevision: 1,
        patch: { set: { wheels: ["paint.glacier_white"] } },
      }),
    ).toThrow("cannot assign option paint.glacier_white to group wheels");
    expect(() =>
      tools.get("present_vehicle_configuration")?.execute({}),
    ).toThrow("requires a presentation change");
    expect(() =>
      tools.get("get_vehicle_configuration")?.execute({ extra: true }),
    ).toThrow("unsupported field: extra");
    await expect(
      tools.get("inspect_vehicle_part")?.execute({ part: "battery", margin: Infinity }),
    ).rejects.toThrow("finite number");
    await expect(
      tools.get("measure_vehicle_parts")?.execute({ from: " ", to: "battery" }),
    ).rejects.toThrow("non-blank string");
  });

  it("functionally covers all six host-to-Garage tools through the injectable bridge", async () => {
    const dependencies = setup();
    const call = vi.fn(async (
      tool: string,
      args: Record<string, unknown>,
      _options?: { signal?: AbortSignal },
    ) => {
      void _options;
      if (tool === "get_state") return { view: "iso" };
      if (tool === "list_parts") return { count: 1, parts: [{ id: "battery" }] };
      if (tool === "get_part") return { id: "battery", label: "Structural battery", category: "chassis" };
      if (tool === "frame_part") return { part: args.part, camera: { preset: null } };
      if (tool === "set_view") return { view: args.view };
      if (tool === "set_motion") return { motion: args.motion, on: args.on };
      if (tool === "measure") return { from: args.from, to: args.to, distance_m: 2 };
      if (tool === "highlight_part" || tool === "set_annotations") return { ok: true };
      throw new Error(`unexpected test tool ${tool}`);
    });
    const syncContext = vi.fn().mockResolvedValue({ synced: true });
    // A real workspace, so the tools report the surface the page is actually on
    // rather than the one they asked for several awaits earlier.
    let workspace: "configure" | "garage" = "configure";
    const setWorkspace = vi.fn((next: "configure" | "garage") => { workspace = next; });
    const getWorkspace = vi.fn(() => workspace);
    dependencies.ownerGuide = {
      call,
      syncContext,
      setWorkspace,
      getWorkspace,
    } as unknown as OwnerGuideBridge;
    const tools = toolsByName(dependencies);
    const controller = new AbortController();
    const execution = { signal: controller.signal };

    await expect(tools.get("get_vehicle_twin_state")!.execute({}, execution)).resolves.toMatchObject({ ok: true, twin: { view: "iso" } });
    await expect(tools.get("list_vehicle_parts")!.execute({ category: "chassis" }, execution)).resolves.toMatchObject({ ok: true, count: 1 });
    await expect(tools.get("inspect_vehicle_part")!.execute({ part: "battery" }, execution)).resolves.toMatchObject({ ok: true, workspace: "garage", part: { id: "battery" } });
    await expect(tools.get("set_vehicle_twin_view")!.execute({ view: "side" }, execution)).resolves.toMatchObject({ ok: true, workspace: "garage" });
    await expect(tools.get("set_vehicle_twin_motion")!.execute({ motion: "open", on: true }, execution)).resolves.toMatchObject({ ok: true, motion: "open", on: true });
    await expect(tools.get("measure_vehicle_parts")!.execute({ from: "battery", to: "body" }, execution)).resolves.toMatchObject({ ok: true, distance_m: 2 });

    expect(syncContext).toHaveBeenCalledTimes(6);
    expect(setWorkspace).toHaveBeenCalledWith("garage");
    expect(call.mock.calls.every(([, , options]) => options?.signal === controller.signal)).toBe(true);
  });
});

describe("ownership cost tool", () => {
  afterEach(() => {
    delete document.modelContext;
    delete document.documentElement.dataset.siteTools;
    resetConfiguratorSiteToolsForTests();
  });

  it("estimates from catalog defaults when the agent supplies no assumptions", async () => {
    const dependencies = setup();
    const tool = toolsByName(dependencies).get("estimate_vehicle_ownership_cost");
    expect(tool).toBeDefined();

    const revision = dependencies.store.getState().domain.revision;
    const result = (await tool!.execute({ expectedRevision: revision }, {})) as {
      ok: boolean;
      snapshot: { result: { monthlyPayment: number; ownershipTotal: number; note: string } };
      overriddenAssumptions: string[];
      defaultsUsed: string[];
    };

    expect(result.ok).toBe(true);
    expect(result.snapshot.result.monthlyPayment).toBeGreaterThan(0);
    expect(result.snapshot.result.ownershipTotal).toBeGreaterThan(0);
    expect(result.overriddenAssumptions).toEqual([]);
    expect(result.defaultsUsed).toContain("aprPct");
    // Conditional credits must never be netted into the payment.
    expect(result.snapshot.result.note).toMatch(/not netted/iu);
  });

  it("merges only the assumptions the agent actually supplied", async () => {
    const dependencies = setup();
    const tool = toolsByName(dependencies).get("estimate_vehicle_ownership_cost");
    const revision = dependencies.store.getState().domain.revision;

    const result = (await tool!.execute(
      { expectedRevision: revision, assumptions: { aprPct: 0, termMonths: 60 } },
      {},
    )) as {
      ok: boolean;
      snapshot: { result: { assumptions: { aprPct: number; termMonths: number } } };
      overriddenAssumptions: string[];
    };

    expect(result.ok).toBe(true);
    expect(result.overriddenAssumptions).toEqual(["termMonths", "aprPct"].sort());
    expect(result.snapshot.result.assumptions.aprPct).toBe(0);
    expect(result.snapshot.result.assumptions.termMonths).toBe(60);
  });

  it("rejects unknown assumption fields instead of silently ignoring them", async () => {
    const dependencies = setup();
    const tool = toolsByName(dependencies).get("estimate_vehicle_ownership_cost");
    const revision = dependencies.store.getState().domain.revision;

    expect(() =>
      tool!.execute(
        { expectedRevision: revision, assumptions: { madeUpField: 3 } },
        {},
      ),
    ).toThrow(/madeUpField/u);
  });
});

describe("agent affordances", () => {
  afterEach(() => {
    delete document.modelContext;
    delete document.documentElement.dataset.siteTools;
    resetConfiguratorSiteToolsForTests();
  });

  it("resolves incentive source ids into citable records", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);
    const revision = dependencies.store.getState().domain.revision;

    await tools.get("set_vehicle_buyer_context")!.execute(
      { expectedRevision: revision, patch: { state: "CO" } },
      {},
    );

    const state = (await tools.get("get_vehicle_configuration")!.execute({}, {})) as {
      catalog: { assembly: unknown; disclaimer: string | null; sources: Array<{ id: string; url: string }> };
      configuration: {
        incentives: {
          encodedPredicatesMatched: Array<{ label: string; sources: Array<{ id: string; title: string; url: string }> }>;
        };
      };
      shareUrl: string | null;
    };

    const co = state.configuration.incentives.encodedPredicatesMatched.find((i) =>
      /Colorado Innovative/i.test(i.label),
    );
    expect(co).toBeDefined();
    // An agent must be able to cite the claim, not just echo an opaque id.
    expect(co!.sources.length).toBeGreaterThan(0);
    expect(co!.sources[0].url).toMatch(/^https?:\/\//u);
    expect(co!.sources[0].title.length).toBeGreaterThan(0);

    // Product provenance the loan-interest deduction reasoning depends on.
    expect(state.catalog.assembly).not.toBeNull();
    expect(state.catalog.sources.length).toBeGreaterThan(0);
    expect(state.shareUrl).toMatch(/build=/u);
  });

  it("compares alternatives without applying them", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);
    const before = dependencies.store.getState().domain.revision;

    const result = (await tools.get("compare_vehicle_configurations")!.execute(
      {
        candidates: [
          { label: "Premium", patch: { set: { build: ["build.premium"] } } },
          { label: "19-inch wheels", patch: { set: { wheels: ["wheels.mg19_as"] } } },
        ],
      },
      {},
    )) as {
      ok: boolean;
      labels: string[];
      table: Record<string, unknown[]>;
      columns: Array<{ label: string; valid: boolean; violations: unknown[] }>;
    };

    expect(result.ok).toBe(true);
    expect(result.labels).toEqual(["Current build", "Premium", "19-inch wheels"]);
    expect(result.table["price.vehicleTotal"]).toHaveLength(3);
    expect(result.table["specs.range_mi"]).toHaveLength(3);

    // The incompatible candidate is reported, not silently dropped.
    const wheels = result.columns.find((c) => c.label === "19-inch wheels");
    expect(wheels!.valid).toBe(false);
    expect(wheels!.violations.length).toBeGreaterThan(0);

    // Nothing was applied.
    expect(dependencies.store.getState().domain.revision).toBe(before);
  });

  it("prices ownership without mutating the build", async () => {
    const dependencies = setup();
    const tools = toolsByName(dependencies);
    const before = dependencies.store.getState();

    const tool = tools.get("estimate_vehicle_ownership_cost")!;
    expect(tool.annotations?.readOnlyHint).toBe(true);

    const a = (await tool.execute(
      { expectedRevision: before.domain.revision, assumptions: { aprPct: 3 } },
      {},
    )) as { ok: boolean; snapshot: { result: { monthlyPayment: number } } };
    const b = (await tool.execute(
      { expectedRevision: before.domain.revision, assumptions: { aprPct: 9 } },
      {},
    )) as { ok: boolean; snapshot: { result: { monthlyPayment: number } } };

    expect(a.ok && b.ok).toBe(true);
    expect(b.snapshot.result.monthlyPayment).toBeGreaterThan(a.snapshot.result.monthlyPayment);

    const after = dependencies.store.getState();
    expect(after.domain.revision).toBe(before.domain.revision);
    expect(after.session.ownershipEstimate).toBe(before.session.ownershipEstimate);
  });
});
