import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { BuyerContext, Catalog } from "../../../src/domain/catalog.types";
import { resolve } from "../../../src/domain/resolve";
import { createConfiguratorStore } from "../../../src/state/configurator.store";
import { createMutationService } from "../../../src/state/mutation.service";
import {
  applyShareStateToHistory,
  createConfiguratorStoreFromSearch,
  decodeShareState,
  encodeShareState,
  restoreShareStateFromSearch,
} from "../../../src/state/url-codec";

const catalog = catalogData as unknown as Catalog;

describe("canonical share URLs", () => {
  it("round-trips every configuration group in catalog order", () => {
    const buyerContext: BuyerContext = {
      evExperience: "new",
      state: "CO",
      utility: "xcel",
      chargingSituation: "home_l2_possible",
      useCases: ["road_trip", "towing"],
      priorities: ["range", "delivery"],
      financing: true,
      crossShopIds: ["model_y", "ioniq_5"],
    };
    const resolved = resolve(
      catalog,
      {
        paint: "paint.launch_green",
        wheels: "wheels.bs20_at",
        interior: "interior.coastal_cloud",
        towing: "towing.launch_included",
      },
      buyerContext,
    );
    const domain = {
      catalogId: catalog.product.id,
      selections: resolved.selections,
      buyerContext: resolved.buyerContext,
    };
    const search = encodeShareState(catalog, domain, { includeSafeContext: true });
    const params = new URLSearchParams(search);

    expect([...params.keys()]).toEqual([
      "v",
      "catalog",
      ...catalog.groups.map((group) => group.id),
      "evExperience",
      "state",
      "chargingSituation",
      "useCases",
      "priorities",
      "crossShopIds",
    ]);
    expect(params.has("utility")).toBe(false);
    expect(params.has("financing")).toBe(false);
    expect(params.has("aprPct")).toBe(false);

    const decoded = decodeShareState(catalog, search);
    expect(decoded.report.status).toBe("valid");
    expect(decoded.selections).toEqual(resolved.selections);
    expect(decoded.buyerContext).toEqual({
      ...resolved.buyerContext,
      utility: "unknown",
      financing: "unknown",
    });
  });

  it("excludes every buyer-context field unless safe context is explicitly requested", () => {
    const store = createConfiguratorStore(catalog, {
      buyerContext: {
        state: "CO",
        utility: "xcel",
        financing: true,
        evExperience: "new",
      },
    });
    const search = encodeShareState(catalog, store.getState().domain);
    const params = new URLSearchParams(search);

    for (const field of [
      "evExperience",
      "state",
      "chargingSituation",
      "useCases",
      "priorities",
      "crossShopIds",
      "utility",
      "financing",
    ]) {
      expect(params.has(field)).toBe(false);
    }
    expect([...catalog.groups].every((group) => params.has(group.id))).toBe(true);
  });

  it("repairs damaged links deterministically using weighted nearest-valid choices", () => {
    const first = decodeShareState(
      catalog,
      "?v=1&catalog=rivian-r2-2026&build=build.standard_rwd_lr&paint=paint.borealis&wheels=wheels.lt21_as&interior=interior.black_crater&towing=&utility=xcel&aprPct=4.9",
    );
    const reordered = decodeShareState(
      catalog,
      "?aprPct=4.9&towing=&interior=interior.black_crater&wheels=wheels.lt21_as&paint=paint.borealis&build=build.standard_rwd_lr&catalog=rivian-r2-2026&v=1&utility=xcel",
    );

    expect(first.report.status).toBe("repaired");
    expect(first.selections).toEqual(reordered.selections);
    expect(resolve(catalog, first.selections, first.buyerContext).valid).toBe(true);
    expect(first.selections.build).toEqual(["build.standard_rwd_lr"]);
    expect(first.report.changed.map((field) => field.field)).toEqual(
      expect.arrayContaining(["paint", "wheels"]),
    );
    expect(first.report.discarded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "utility", reason: expect.stringContaining("privacy") }),
        expect.objectContaining({ field: "aprPct", reason: expect.stringContaining("privacy") }),
      ]),
    );
  });

  it("fills missing required groups and reports unknown selections instead of failing", () => {
    const decoded = decodeShareState(
      catalog,
      "?v=1&catalog=rivian-r2-2026&paint=paint.not_real",
    );

    expect(decoded.report.status).toBe("repaired");
    expect(decoded.report.filled.map((field) => field.field)).toEqual(
      expect.arrayContaining(["build", "wheels", "interior", "towing"]),
    );
    expect(decoded.report.discarded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "paint", value: "paint.not_real" }),
      ]),
    );
    expect(resolve(catalog, decoded.selections).valid).toBe(true);
    expect(decoded.selections.towing).toEqual([]);
  });

  it("falls back to defaults for unsupported versions", () => {
    const decoded = decodeShareState(
      catalog,
      "?v=99&catalog=rivian-r2-2026&build=build.standard_rwd",
    );
    expect(decoded.report.status).toBe("defaults");
    expect(decoded.selections).toEqual(resolve(catalog).selections);
  });
});

describe("browser boot and history integration", () => {
  it("boots a store from a canonical URL at revision one", () => {
    const search =
      "?v=1&catalog=rivian-r2-2026&build=build.performance&paint=paint.launch_green&wheels=wheels.bs20_at&interior=interior.coastal_cloud&towing=towing.launch_included";
    const { store, decoded } = createConfiguratorStoreFromSearch(catalog, search);
    expect(decoded.report.status).toBe("valid");
    expect(store.getState().domain.revision).toBe(1);
    expect(store.getState().domain.selections.paint).toEqual(["paint.launch_green"]);
    expect(store.getState().resolved.specs.range_mi).toBe(307);
  });

  it("applies canonical state to history without leaking excluded context", () => {
    const store = createConfiguratorStore(catalog, {
      buyerContext: { utility: "xcel", financing: true },
    });
    const calls: string[] = [];
    const target = {
      location: { href: "https://example.test/configurator?old=1", search: "?old=1" },
      history: {
        pushState: (_data: unknown, _unused: string, url?: string | URL | null) => {
          calls.push(`push:${String(url)}`);
        },
        replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
          calls.push(`replace:${String(url)}`);
        },
      },
    };
    const url = applyShareStateToHistory(catalog, store.getState().domain, { target });
    expect(calls).toEqual([`replace:${url}`]);
    expect(url).toContain("build=build.performance");
    expect(url).not.toContain("utility");
    expect(url).not.toContain("financing");
  });

  it("restores popstate-like configuration while preserving private session context", () => {
    const store = createConfiguratorStore(catalog, {
      buyerContext: { utility: "xcel", financing: true, state: "CO" },
    });
    const service = createMutationService(store, catalog);
    const search =
      "?v=1&catalog=rivian-r2-2026&build=build.performance&paint=paint.launch_green&wheels=wheels.bs20_at&interior=interior.black_crater&towing=";
    const result = restoreShareStateFromSearch(catalog, store, service, search);

    expect(result.restored.ok).toBe(true);
    expect(store.getState().domain.revision).toBe(2);
    expect(store.getState().domain.selections.paint).toEqual(["paint.launch_green"]);
    expect(store.getState().domain.buyerContext.utility).toBe("xcel");
    expect(store.getState().domain.buyerContext.financing).toBe(true);
    expect(store.getState().domain.buyerContext.state).toBe("CO");
  });
});
