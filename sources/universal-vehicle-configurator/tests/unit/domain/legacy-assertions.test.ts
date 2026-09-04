import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import { resolve } from "../../../src/domain/resolve";

const catalog = catalogData as unknown as Catalog;
const buyerCO = {
  state: "CO" as const,
  utility: "xcel" as const,
  financing: true,
  chargingSituation: "home_l2_possible" as const,
};

describe("the six archived resolver assertions", () => {
  const performance = resolve(catalog, { towing: ["towing.launch_included"] }, buyerCO);
  const performanceAllTerrain = resolve(
    catalog,
    { wheels: "wheels.bs20_at", towing: ["towing.launch_included"] },
    buyerCO,
  );
  const incompatibleBorealis = resolve(
    catalog,
    {
      build: "build.standard_rwd_lr",
      paint: "paint.borealis",
      wheels: "wheels.mg19_as",
    },
    buyerCO,
  );
  const rangeChampion = resolve(
    catalog,
    { build: "build.standard_rwd_lr", wheels: "wheels.mg19_as" },
    buyerCO,
  );

  it("preserves the original $61,290 scenario while removing charger setup from vehicle price", () => {
    expect(performance.price.vehicleTotal).toBe(57_990 + 1_495);
    expect(performance.price.ownershipSetup).toBe(1_500);
    expect(performance.price.illustrativeOwnershipTotal).toBe(57_990 + 1_495 + 1_500);
  });

  it("preserves the published Performance wheel override", () => {
    expect(performance.specs.range_mi).toBe(330);
    expect(performanceAllTerrain.specs.range_mi).toBe(307);
  });

  it("preserves the Borealis compatibility failure away from Performance", () => {
    expect(incompatibleBorealis.valid).toBe(false);
    expect(incompatibleBorealis.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "option.unavailable", option: "paint.borealis" })]),
    );
  });

  it("preserves the Colorado IMVC encoded-predicate match", () => {
    expect(performance.incentives.encodedPredicatesMatched.map((program) => program.id)).toContain("co_imvc");
  });

  it("preserves an explanation for the expired federal credit", () => {
    expect(performance.incentives.expired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "federal_30d_new_ev", reason: expect.stringContaining("expired") }),
      ]),
    );
  });

  it("preserves the Standard RWD Long Range 345-mile result", () => {
    expect(rangeChampion.specs.range_mi).toBe(345);
  });
});
