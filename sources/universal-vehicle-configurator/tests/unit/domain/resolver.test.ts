import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import { findCompatibleAlternatives } from "../../../src/domain/alternatives";
import type { Catalog, SelectionInput } from "../../../src/domain/catalog.types";
import { normalizeSelections, resolve, resolveAtomicPatch } from "../../../src/domain/resolve";

const catalog = catalogData as unknown as Catalog;

describe("deterministic catalog resolution", () => {
  it("keeps home-charging setup outside every vehicle-price field", () => {
    const withoutHomeL2 = resolve(catalog);
    const withHomeL2 = resolve(catalog, {}, { chargingSituation: "home_l2_possible" });

    expect(catalog.groups.some((group) => group.id === "charging")).toBe(false);
    expect(catalog.options.some((option) => option.id === "charging.home_l2")).toBe(false);
    expect(withHomeL2.price.vehicleMSRP).toBe(withoutHomeL2.price.vehicleMSRP);
    expect(withHomeL2.price.vehicleTotal).toBe(withoutHomeL2.price.vehicleTotal);
    expect(withHomeL2.price.ownershipSetup).toBe(1_500);
    expect(withHomeL2.price.illustrativeOwnershipTotal).toBe(withHomeL2.price.vehicleTotal + 1_500);
  });

  it("resolves the 330 ↔ 307 wheel behavior in both directions", () => {
    const allTerrain = resolve(catalog, { wheels: "wheels.bs20_at" });
    expect(allTerrain.specs.range_mi).toBe(307);

    const restore = resolveAtomicPatch(
      catalog,
      allTerrain.selections,
      { set: { wheels: ["wheels.lt21_as"] } },
    );
    expect(restore.valid).toBe(true);
    expect(restore.candidate.specs.range_mi).toBe(330);

    const detach = resolveAtomicPatch(
      catalog,
      restore.candidate.selections,
      { set: { wheels: ["wheels.bs20_at"] } },
    );
    expect(detach.valid).toBe(true);
    expect(detach.candidate.specs.range_mi).toBe(307);
  });

  it("rejects incompatible paint and wheel choices without substituting defaults", () => {
    const paint = resolve(catalog, {
      build: "build.premium",
      paint: "paint.borealis",
      wheels: "wheels.lt21_as",
    });
    const wheels = resolve(catalog, {
      build: "build.standard_rwd",
      wheels: "wheels.lt21_as",
    });

    expect(paint.valid).toBe(false);
    expect(paint.selections.paint).toEqual(["paint.borealis"]);
    expect(wheels.valid).toBe(false);
    expect(wheels.selections.wheels).toEqual(["wheels.lt21_as"]);
  });

  it("accepts a coupled trim-plus-wheel patch atomically", () => {
    const current = resolve(catalog).selections;
    const trimOnly = resolveAtomicPatch(
      catalog,
      current,
      { set: { build: ["build.standard_rwd_lr"] } },
    );
    const coupled = resolveAtomicPatch(
      catalog,
      current,
      {
        set: {
          build: ["build.standard_rwd_lr"],
          wheels: ["wheels.mg19_as"],
        },
      },
    );

    expect(trimOnly.valid).toBe(false);
    expect(coupled.valid).toBe(true);
    expect(coupled.candidate.selections.build).toEqual(["build.standard_rwd_lr"]);
    expect(coupled.candidate.selections.wheels).toEqual(["wheels.mg19_as"]);
    expect(current).toEqual(resolve(catalog).selections);
  });

  it("preserves field-level confidence through prices, specs, delivery, and setup", () => {
    const result = resolve(
      catalog,
      { wheels: "wheels.bs20_at", paint: "paint.glacier_white" },
      { chargingSituation: "home_l2_possible" },
    );

    expect(result.specConfidence.range_mi).toBe("verified");
    expect(result.price.lines.find((line) => line.id === "wheels.bs20_at")?.confidence).toBe("estimated");
    // Destination is sourced from Rivian's own build summary, so it is the one
    // fee that carries verified confidence; the option price beside it is not.
    expect(result.price.confidence.destination).toBe("verified");
    expect(result.price.confidence.ownershipSetup).toBe("estimated");
    expect(result.delivery?.confidence).toBe("verified");
  });

  it("explains program uncertainty when buyer context is missing", () => {
    const result = resolve(catalog);
    expect(result.incentives.potentiallyApplicable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "co_imvc",
          missingContext: expect.arrayContaining(["buyer.state"]),
        }),
      ]),
    );
    expect(result.incentives.encodedPredicatesMatched.map((program) => program.id)).not.toContain("co_imvc");
    expect(result.incentives.encodedPredicatesMatched.map((program) => program.id)).not.toContain(
      "federal_auto_loan_interest_deduction",
    );
    expect(result.incentives.potentiallyApplicable.map((program) => program.id)).toContain(
      "federal_auto_loan_interest_deduction",
    );
    expect(result.incentives.ineligible.map((program) => program.id)).toContain("co_imvc_under35k_bonus");
  });

  it("returns deterministic compatible paths for an invalid build", () => {
    const invalid = {
      build: "build.standard_rwd_lr",
      paint: "paint.borealis",
      wheels: "wheels.mg19_as",
    } satisfies SelectionInput;
    const alternatives = findCompatibleAlternatives(catalog, invalid);

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((alternative) => resolve(catalog, alternative.selections).valid)).toBe(true);
  });

  it("deduplicates and catalog-orders selection arrays", () => {
    const normalized = normalizeSelections(catalog, {
      towing: ["towing.standalone", "towing.launch_included", "towing.standalone"],
    });
    expect(normalized.selections.towing).toEqual(["towing.launch_included", "towing.standalone"]);
  });

  it("rejects clearing a required group instead of silently restoring its default", () => {
    const result = resolveAtomicPatch(
      catalog,
      resolve(catalog).selections,
      { set: { build: [] } },
    );

    expect(result.valid).toBe(false);
    expect(result.candidate.selections.build).toEqual([]);
    expect(result.candidate.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "group.required", group: "build" })]),
    );
  });
});

describe("modelled-vehicle provenance", () => {
  it("caps vehicle confidence but leaves incentive programs verified", () => {
    const actual = resolve(catalog, {}, { state: "CO", financing: true });
    // Baseline: the catalog describes a real vehicle today.
    expect(catalog.product.representation ?? "actual").toBe("actual");
    expect(actual.price.confidence.baseMSRP).toBe("verified");

    const modelled = {
      ...catalog,
      product: { ...catalog.product, representation: "modelled" as const },
    };
    const result = resolve(modelled, {}, { state: "CO", financing: true });

    // Nothing about the car may claim verification once it is a stand-in.
    expect(result.price.confidence.baseMSRP).toBe("estimated");
    expect(result.price.confidence.vehicleTotal).toBe("estimated");
    expect(result.price.lines.every((line) => line.confidence === "estimated")).toBe(true);
    expect(Object.values(result.specConfidence).every((c) => c === "estimated")).toBe(true);
    expect(result.delivery?.confidence).toBe("estimated");

    // Incentives are real programs; they keep their own sourcing either way.
    const co = result.incentives.encodedPredicatesMatched.find((i) =>
      /Colorado Innovative/i.test(i.label),
    );
    expect(co?.confidence).toBe("verified");
    expect(co?.amount).toBe(750);
  });
});
