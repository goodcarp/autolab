import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type { Catalog } from "../../../src/domain/catalog.types";
import { validateBuyerContext, validateCatalog } from "../../../src/domain/catalog.validation";

const catalog = catalogData as unknown as Catalog;
const cloneCatalog = (): Catalog => structuredClone(catalog);

describe("uconf/0.2 catalog validation", () => {
  it("accepts the migrated R2 catalog", () => {
    expect(validateCatalog(catalog)).toEqual({ valid: true, issues: [] });
  });

  it("rejects duplicate and dangling IDs", () => {
    const candidate = cloneCatalog();
    candidate.options[1]!.id = candidate.options[0]!.id;
    candidate.groups[0]!.default = "build.missing";

    const result = validateCatalog(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["reference.duplicate_id", "reference.unknown_default"]),
    );
  });

  it("rejects malformed direct source URLs", () => {
    const candidate = cloneCatalog();
    candidate.sources[0]!.url = "not-a-direct-url";

    const result = validateCatalog(candidate);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "schema.pattern" })]),
    );
  });

  it("rejects invalid mesh, camera, option, and evidence references", () => {
    const candidate = cloneCatalog();
    candidate.options[0]!.render = { mesh_target: "missing_part" };
    candidate.options[0]!.availability = { selected: "missing.option" };
    candidate.options[0]!.evidenceIds = ["missing.evidence"];
    candidate.scene!.demos![0]!.steps[0]!.camera = "missing_camera";

    const result = validateCatalog(candidate, { knownEvidenceIds: new Set(["known.evidence"]) });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "reference.unknown_mesh_target",
        "reference.unknown_camera",
        "reference.unknown_option",
        "reference.unknown_evidence",
      ]),
    );
  });

  it("rejects defaults that form an incompatible build", () => {
    const candidate = cloneCatalog();
    candidate.groups.find((group) => group.id === "build")!.default = "build.standard_rwd";

    const result = validateCatalog(candidate);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "defaults.incompatible" })]),
    );
  });

  it("requires explicit confidence and orderability", () => {
    const candidate = cloneCatalog() as unknown as Record<string, unknown>;
    const options = candidate.options as Array<Record<string, unknown>>;
    delete (options[0]!.price as Record<string, unknown>).confidence;
    delete options[0]!.orderability;

    const result = validateCatalog(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "schema.required")).toBe(true);
  });

  it("validates and canonicalizes bounded buyer context", () => {
    expect(
      validateBuyerContext({
        state: "CO",
        chargingSituation: "home_l2_possible",
        priorities: ["price", "range", "price"],
      }),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        value: expect.objectContaining({ priorities: ["range", "price"] }),
      }),
    );

    expect(validateBuyerContext({ state: "ZZ" })).toEqual(
      expect.objectContaining({ valid: false, issues: expect.arrayContaining([expect.stringContaining("state")]) }),
    );
  });
});
