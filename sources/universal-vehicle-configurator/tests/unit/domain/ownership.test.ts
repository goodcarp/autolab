import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import { estimateOwnership } from "../../../src/domain/ownership";
import { resolve } from "../../../src/domain/resolve";

const catalog = catalogData as unknown as Catalog;

describe("ownership estimates", () => {
  it("keeps tax-return savings separate from the financing and ownership totals", () => {
    const resolved = resolve(
      catalog,
      {},
      { state: "CO", utility: "xcel", chargingSituation: "home_l2_possible", financing: true },
    );
    const estimate = estimateOwnership(catalog, resolved, {
      aprPct: 6.5,
      termMonths: 60,
      downPayment: 5_000,
      salesTaxRate: 0.08,
      annualMiles: 12_000,
      homeKwhRate: 0.15,
      publicKwhRate: 0.42,
      homeChargingShare: 0.85,
      horizonYears: 5,
    });

    expect(estimate.taxableVehicleAmount).toBe(resolved.price.vehicleTotal);
    expect(estimate.ownershipSetup).toBe(1_500);
    expect(estimate.separatelyDisplayedSavings).toBe(1_250);
    expect(estimate.ownershipTotal).toBeGreaterThan(resolved.price.vehicleTotal);
  });
});
