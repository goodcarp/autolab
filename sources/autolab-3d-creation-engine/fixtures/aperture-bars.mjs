// Test-only wrapper. The authored model is imported, never copied or edited.
import { BoxGeometry } from "three";
import { pathToFileURL } from "node:url";
const source = process.env.APERTURE_BASE_MODEL ?? "/Users/spaceman/Desktop/r2-tour/src/vehicle.js";
const model = await import(pathToFileURL(source).href);
export const SPEC = model.SPEC;
export function buildVehicle() {
  const vehicle = model.buildVehicle();
  // Use the registry's own constructor and add() so the normal update loop and
  // part tagging also cover the injected geometry. Both parts stay on the body.
  const Part = vehicle.order[0].constructor;
  function add(name, size, position) {
    const part = new Part(name, name, "Test-only aperture obstruction", "shell");
    vehicle.body.add(part.group); vehicle.order.push(part); vehicle.parts[name] = part;
    part.add(new BoxGeometry(...size), { pos: position });
  }
  // Spans the front-left doorway at the belt. End vertices are outside its x range.
  add("fixtureFrontDoorBar", [1.30, 0.040, 0.040], [0.23, 1.19, -0.90]);
  // The historical uncut deck band: across the tail, just inside the closed gate.
  add("fixtureLiftgateBand", [0.052, 0.040, 1.90], [SPEC.TAIL + 0.030, 1.19, 0]);
  // A pillar strip overhanging the rear-left door opening by 80 mm, at the skin.
  add("fixturePillarOverhang", [0.080, 0.60, 0.020], [-0.99, 1.00, -0.90]);
  // A lamp through the front-left door skin, centred in the opening, 10 mm proud.
  add("fixtureFlankLight", [0.060, 0.060, 0.030], [0.18, 1.00, -0.905]);
  return vehicle;
}
