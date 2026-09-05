import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../",import.meta.url));
test("CLI returns zero for the synthetic open box", () => {
  const run = spawnSync(process.execPath,["src/cli.mjs","apertures"],{
    cwd:root,env:{...process.env,MODEL_PATH:`${root}fixtures/box-door.mjs`},encoding:"utf8",
  });
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).status,"PASS");
});
// Explicit opt-in because the production model belongs to another checkout.
// The normal unit suite remains portable; the mandatory verification runs this too.
test("same-model negative fixture names both historical obstruction classes at all four poses", {
  skip: !process.env.APERTURE_BASE_MODEL,
}, () => {
  const run = spawnSync(process.execPath,["src/cli.mjs","apertures"],{
    cwd:root,env:{...process.env,MODEL_PATH:`${root}fixtures/aperture-bars.mjs`},encoding:"utf8",maxBuffer:10*1024*1024,
  });
  assert.equal(run.status,1,run.stderr);
  const r = JSON.parse(run.stdout); assert.equal(r.status,"FAIL");
  for (const [aperture,part] of [["doorFL","fixtureFrontDoorBar"],["tailgate","fixtureLiftgateBand"]]) {
    const a = r.apertures.find(a => a.aperture === aperture);
    assert.equal(a.poses.length,4);
    for (const p of a.poses) assert.ok(p.offenders.some(o => o.part === part && o.evidence === "surface intersection"),`${aperture} ${p.openT}: ${part}`);
  }
});
