import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import { createConfiguratorStore } from "../../../src/state/configurator.store";
import { createMutationService } from "../../../src/state/mutation.service";

const catalog = catalogData as unknown as Catalog;

function setup(defaultStageDelayMs = 0) {
  const store = createConfiguratorStore(catalog);
  const service = createMutationService(store, catalog, { defaultStageDelayMs });
  return { store, service };
}

describe("revisioned configuration mutations", () => {
  it("simulates without mutation and sends human and agent changes through identical truth", async () => {
    const human = setup();
    const agent = setup();
    const patch = { set: { wheels: ["wheels.bs20_at"] } };

    const simulation = human.service.simulateConfiguration({
      expectedRevision: 1,
      patch,
    });
    expect(simulation.ok).toBe(true);
    if (!simulation.ok) return;
    expect(simulation.candidate.specs.range_mi).toBe(307);
    expect(simulation.delta.rangeMiles).toBe(-23);
    expect(human.store.getState().domain.revision).toBe(1);
    expect(human.store.getState().resolved.specs.range_mi).toBe(330);

    const manualResult = human.service.applyHumanPatch({ patch });
    const agentResult = await agent.service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [{ label: "Fit all-terrain wheels", patch }],
      stageDelayMs: 0,
    });
    expect(manualResult.ok).toBe(true);
    expect(agentResult.ok).toBe(true);
    expect(agent.store.getState().domain.selections).toEqual(
      human.store.getState().domain.selections,
    );
    expect(agent.store.getState().resolved).toEqual(human.store.getState().resolved);
    expect(agent.store.getState().domain.revision).toBe(2);
  });

  it("rejects stale revisions before mutating", () => {
    const { store, service } = setup();
    const first = service.applyHumanPatch({
      expectedRevision: 1,
      patch: { set: { paint: ["paint.glacier_white"] } },
    });
    const stale = service.applyHumanPatch({
      expectedRevision: 1,
      patch: { set: { interior: ["interior.coastal_cloud"] } },
    });

    expect(first.ok).toBe(true);
    expect(stale).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "REVISION_CONFLICT",
          currentRevision: 2,
        }),
      }),
    );
    expect(store.getState().domain.selections.interior).toEqual([
      "interior.black_crater",
    ]);
  });

  it("pre-validates a whole agent transaction before committing any stage", async () => {
    const { store, service } = setup();
    const result = await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [
        {
          label: "Choose Launch Green",
          patch: { set: { paint: ["paint.launch_green"] } },
        },
        {
          label: "Switch to an incompatible trim",
          patch: { set: { build: ["build.standard_rwd"] } },
        },
      ],
      stageDelayMs: 0,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
      }),
    );
    expect(store.getState().domain.revision).toBe(1);
    expect(store.getState().domain.selections.paint).toEqual(["paint.esker_silver"]);
  });

  it("enforces the one-to-four-stage contract and plain-text labels", async () => {
    const { store, service } = setup();
    const patch = { set: { paint: ["paint.glacier_white"] } };
    const none = await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [],
    });
    const tooMany = await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: Array.from({ length: 5 }, (_, index) => ({
        label: `Stage ${index + 1}`,
        patch,
      })),
    });
    const controlCharacter = await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [{ label: "Bad\nlabel", patch }],
    });

    for (const result of [none, tooMany, controlCharacter]) {
      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "INVALID_INPUT" }),
        }),
      );
    }
    expect(store.getState().domain.revision).toBe(1);
  });

  it("commits completed stages, then lets intentional human input cancel all unstarted stages", async () => {
    const { store, service } = setup(10_000);
    const pending = service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [
        {
          label: "Choose Launch Green",
          patch: { set: { paint: ["paint.launch_green"] } },
        },
        {
          label: "Fit all-terrain wheels",
          patch: { set: { wheels: ["wheels.bs20_at"] } },
        },
        {
          label: "Add included towing",
          patch: { set: { towing: ["towing.launch_included"] } },
        },
      ],
    });

    expect(store.getState().domain.revision).toBe(2);
    const human = service.applyHumanPatch({
      patch: { set: { interior: ["interior.coastal_cloud"] } },
    });
    expect(human.ok).toBe(true);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.status).toBe("interrupted");
    expect(result.receipt.completedStages.map((stage) => stage.label)).toEqual([
      "Choose Launch Green",
    ]);
    expect(result.receipt.skippedStages.map((stage) => stage.label)).toEqual([
      "Fit all-terrain wheels",
      "Add included towing",
    ]);
    expect(result.receipt.undoEligible).toBe(false);
    expect(store.getState().domain.selections.paint).toEqual(["paint.launch_green"]);
    expect(store.getState().domain.selections.wheels).toEqual(["wheels.lt21_as"]);
    expect(store.getState().domain.selections.interior).toEqual([
      "interior.coastal_cloud",
    ]);
    expect(store.getState().domain.revision).toBe(3);
  });

  it("undoes one complete agent transaction in one new revision", async () => {
    const { store, service } = setup();
    const applied = await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [
        {
          label: "Choose Launch Green",
          patch: { set: { paint: ["paint.launch_green"] } },
        },
        {
          label: "Fit all-terrain wheels",
          patch: { set: { wheels: ["wheels.bs20_at"] } },
        },
      ],
      stageDelayMs: 0,
    });
    expect(applied.ok).toBe(true);
    expect(store.getState().domain.revision).toBe(3);
    expect(store.getState().session.undo?.afterRevision).toBe(3);

    const undone = service.undoLastAgentTransaction({ expectedRevision: 3 });
    expect(undone.ok).toBe(true);
    expect(store.getState().domain.revision).toBe(4);
    expect(store.getState().domain.selections.paint).toEqual(["paint.esker_silver"]);
    expect(store.getState().domain.selections.wheels).toEqual(["wheels.lt21_as"]);
    expect(store.getState().resolved.specs.range_mi).toBe(330);
    expect(service.undoLastAgentTransaction({ expectedRevision: 4 })).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "NOTHING_TO_UNDO" }),
      }),
    );
  });

  it("invalidates agent Undo after any later domain mutation", async () => {
    const { store, service } = setup();
    await service.applyAgentTransaction({
      expectedRevision: 1,
      stages: [
        {
          label: "Choose Launch Green",
          patch: { set: { paint: ["paint.launch_green"] } },
        },
      ],
      stageDelayMs: 0,
    });
    service.applyHumanPatch({
      patch: { set: { interior: ["interior.coastal_cloud"] } },
    });

    expect(store.getState().session.undo).toBeNull();
    expect(service.undoLastAgentTransaction({ expectedRevision: 3 })).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "NOTHING_TO_UNDO" }),
      }),
    );
  });

  it("uses replacement semantics for buyer context and protects it with revisions", () => {
    const { store, service } = setup();
    const first = service.setBuyerContext({
      expectedRevision: 1,
      patch: {
        state: "CO",
        priorities: ["price", "range", "price"],
        crossShopIds: ["ioniq_5", "model_y"],
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changedFields).toEqual(["state", "priorities", "crossShopIds"]);
    expect(store.getState().domain.buyerContext.priorities).toEqual(["range", "price"]);
    expect(store.getState().domain.buyerContext.crossShopIds).toEqual([
      "model_y",
      "ioniq_5",
    ]);

    const cleared = service.setBuyerContext({
      expectedRevision: 2,
      patch: { priorities: [] },
    });
    expect(cleared.ok).toBe(true);
    expect(store.getState().domain.buyerContext.priorities).toEqual([]);
    expect(store.getState().domain.revision).toBe(3);
  });
});

describe("session-only ownership estimates", () => {
  it("stores assumptions and outputs without changing DomainState", () => {
    const { store, service } = setup();
    const beforeDomain = store.getState().domain;
    const result = service.estimateOwnership({
      expectedRevision: 1,
      assumptions: {
        aprPct: 6.5,
        termMonths: 60,
        downPayment: 5_000,
        salesTaxRate: 0.08,
        annualMiles: 12_000,
        homeKwhRate: 0.15,
        publicKwhRate: 0.42,
        homeChargingShare: 0.85,
        horizonYears: 5,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.id).toBe("estimate-1-1");
    expect(result.snapshot.result.monthlyPayment).toBeGreaterThan(0);
    expect(store.getState().domain).toEqual(beforeDomain);
    expect(store.getState().domain.revision).toBe(1);
    expect(store.getState().session.ownershipEstimate?.id).toBe("estimate-1-1");
  });
});
