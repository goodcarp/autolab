import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import { createConfiguratorStore } from "../../../src/state/configurator.store";
import {
  selectBuildSummary,
  selectCanUndo,
  selectedOptionForGroup,
} from "../../../src/state/selectors";

const catalog = catalogData as unknown as Catalog;

describe("configurator store and selectors", () => {
  it("starts at revision one with a canonical valid build", () => {
    const store = createConfiguratorStore(catalog);
    const state = store.getState();

    expect(state.domain).toEqual(
      expect.objectContaining({
        format: "uvc-state/1",
        revision: 1,
        catalogId: "rivian-r2-2026",
      }),
    );
    expect(state.resolved.valid).toBe(true);
    expect(Object.values(state.domain.selections).every(Array.isArray)).toBe(true);
    expect(selectBuildSummary(state)).toEqual(
      expect.objectContaining({ revision: 1, rangeMiles: 330 }),
    );
    expect(selectCanUndo(state)).toBe(false);
    expect(selectedOptionForGroup(state, "build").map((option) => option.id)).toEqual([
      "build.performance",
    ]);
  });
});
