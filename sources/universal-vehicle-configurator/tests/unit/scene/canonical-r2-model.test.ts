import { describe, expect, it } from "vitest";
import { checkCanonicalR2Model } from "../../../scripts/sync-r2-model.mjs";

describe("canonical Garage R2 model", () => {
  it("keeps Configure's generated geometry mirror byte-current", async () => {
    await expect(checkCanonicalR2Model()).resolves.toEqual({
      checked: ["geom.js", "vehicle.js"],
      canonicalDirectory: "public/garage/src",
      mirrorDirectory: "src/scene/r2",
    });
  });
});
