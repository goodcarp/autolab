import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { apertures, deriveAperture, clipTriangle, readCut } from "../src/apertures.mjs";
import { buildVehicle } from "../fixtures/box-door.mjs";
const rectangle = [ [[-0.5,0,1],[0.5,0,1],[0.5,2,1]], [[-0.5,0,1],[0.5,2,1],[-0.5,2,1]] ];
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);
const report = v => apertures({vehicle:v,path:"synthetic box"});

test("closed footprint has measured width, height, expansion and fixed inward depth", () => {
  const a = deriveAperture(rectangle);
  assert.equal(a.prisms.length,2);
  [-0.502,-0.002,0.898].forEach((v,i) => near(a.bounds.min[i],v));
  [0.502,2.002,1.002].forEach((v,i) => near(a.bounds.max[i],v));
});
test("box with a real doorway passes all four poses and excludes its registered handle", () => {
  const v = buildVehicle(); v.openT = 0.37;
  const r = report(v);
  assert.equal(r.status,"PASS"); assert.deepEqual(r.openFractions,[0,0.25,0.5,1]);
  assert.deepEqual(r.apertures[0].assemblyParts,["doorFR","handle"]);
  assert.equal(r.apertures[0].skinMeshes,1);
  assert.equal(v.openT,0.37); near(v.parts.doorFR.group.rotation.y,0.37);
});
test("bar with every vertex outside the footprint fails at every pose, with measured depth", () => {
  const v = buildVehicle(); v.addBar();
  // The synthetic bar sits 55 mm behind the skin: inside a 100 mm band, outside the 50 mm default.
  const r = apertures({vehicle:v,path:"synthetic box"},{depth:0.1}); assert.equal(r.status,"FAIL");
  for (const pose of r.apertures[0].poses) {
    const bar = pose.offenders.find(p => p.part === "bar"); assert.ok(bar); near(bar.intrusionDepth_mm,55);
    assert.ok(Math.abs(bar.at_m.x) <= 0.502001); assert.ok(bar.at_m.y >= 0.97 && bar.at_m.y <= 1.03);
  }
});
test("geometry beyond the inward depth and geometry outside the opening pass", () => {
  const v = buildVehicle(); v.addBar("deep",0.70); const p = v.addBar("above"); p.group.position.y = 2;
  assert.equal(report(v).status,"PASS");
});
test("the union preserves a concave outline instead of filling its convex hull", () => {
  const a = deriveAperture([[[0,0,1],[2,0,1],[0,1,1]],[[0,1,1],[0.4,1,1],[0,2,1]]]);
  const hole = [[0.9,1.3,0.95],[1.1,1.3,0.95],[1,1.5,0.95]];
  assert.ok(a.prisms.every(p => !clipTriangle(hole,p).length));
});
test("raked edges and curved skin use their triangles, not the panel box", () => {
  const a = deriveAperture([[[0,0,1],[1,0,1],[0,2,0.8]]]);
  const insideBoxOnly = [[0.8,1.8,0.85],[0.9,1.8,0.85],[0.8,1.9,0.85]];
  assert.equal(clipTriangle(insideBoxOnly,a.prisms[0]).length,0);
  const through = [[-1,0.5,0.9],[2,0.5,0.9],[0,0.6,0.9]];
  assert.ok(clipTriangle(through,a.prisms[0]).length);
});
test("left door, hood and liftgate project along the appropriate signed axis", () => {
  for (const [axis,sign] of [[2,-1],[1,1],[0,-1]]) {
    const map = p => { const q = [p[0],p[1],p[2]*sign]; [q[axis],q[2]] = [q[2],q[axis]]; return q; };
    const a = deriveAperture(rectangle.map(t => t.map(map)),{axis,sign});
    near(sign > 0 ? a.bounds.min[axis] : a.bounds.max[axis],sign*0.898);
  }
});
test("shader reader uses rounded emitted values, piecewise ramps, ternaries and quadratic edges", () => {
  const cut = readCut("bool inAperture(vec3 p){ float a = abs(p.z); float edge = p.y > 1.0 ? 0.5 + p.y * p.y : min(0.9, 0.5 + clamp(p.y, 0.0, 1.0)); if(a > 0.55 && p.x < edge) return true; return false; }");
  assert.equal(cut({min:[0,0,0.9],max:[0.1,0.1,1]}),1);
  assert.equal(cut({min:[3,0,0.9],max:[4,0.1,1]}),0);
  assert.equal(cut({min:[0,0,0.5],max:[1,2,1]}),-1);
  assert.throws(() => readCut("bool inAperture(vec3 p){ while(true) return true; return false; }"),/unsupported/);
});
function shader(mesh,region) {
  mesh.material = new MeshBasicMaterial();
  mesh.material.onBeforeCompile = sh => {
    sh.vertexShader += "\nvObjPos = position;";
    sh.fragmentShader = `bool inAperture(vec3 p){ ${region} return false; }\nif (inAperture(vObjPos)) discard;`;
  };
}
test("a shader-cut bar passes; removing the material cut fails despite the same geometry", () => {
  const v = buildVehicle(), bar = v.addBar();
  shader(bar.meshes[0],"if(p.x > -0.6 && p.x < 0.6) return true;");
  assert.equal(report(v).status,"PASS");
  bar.meshes[0].material = new MeshBasicMaterial();
  assert.equal(report(v).status,"FAIL");
});
test("a narrow survivor inside a large shader-cut triangle cannot silently pass", () => {
  const v = buildVehicle(), bar = v.addBar();
  // In local box coordinates, a 0.02 mm stripe between all ordinary samples.
  shader(bar.meshes[0],"if(p.x < 0.12345 || p.x > 0.12347) return true;");
  const r = report(v); assert.equal(r.status,"FAIL");
  assert.ok(r.apertures[0].poses.every(p => p.offenders.some(o => o.part === "bar")));
});
test("independent moving parts are tested against the door opening", () => {
  const v = buildVehicle(), bar = v.addBar("otherPanel"); const update = v.update;
  v.update = function() { update.call(this); bar.group.position.y = this.openT * 0.1; };
  const r = report(v); assert.equal(r.status,"FAIL");
  assert.ok(r.apertures.find(a => a.aperture === "doorFR").poses.every(p => p.offenders.some(o => o.part === "otherPanel")));
});
test("missing animation and unsupported shader cuts refuse certification", () => {
  assert.throws(() => apertures({vehicle:{}}),/update/);
  const v = buildVehicle(); v.parts.body.meshes[0].userData.cut = true;
  assert.throws(() => report(v),/no supported/);
});
test("undefined reversed GLSL clamp bounds stay uncertain", () => {
  const cut = readCut("bool inAperture(vec3 p){ float y = clamp(p.x, 0.0, -0.06); if(p.y > y) return true; return false; }");
  assert.equal(cut({min:[0,1,0],max:[0,1,0]}),-1);
  assert.equal(cut.limitations.size,1);
});
