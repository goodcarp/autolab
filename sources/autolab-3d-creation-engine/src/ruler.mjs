// The ruler.
//
// Every measurement here names the parts it measured from. That is not
// decoration: a naive bounding box over this model reports a width of 2.151 m
// against a 1.905 m specification, because it is silently measuring the
// mirrors. A number without its landmarks is not a measurement, it is a
// coincidence — see "Measure, Don't Look", finding 03.

import { Box3, Vector3 } from "three";
import { boundsOf, mm, round } from "./load.mjs";

/** Parts that stick out past the body and must be excluded from an envelope. */
const PROTRUDING = new Set(["doorFL", "doorFR"]); // mirrors are sub-meshes of the front doors

const AXLE_PARTS = {
  frontLeft: "wheelFL",
  frontRight: "wheelFR",
  rearLeft: "wheelRL",
  rearRight: "wheelRR",
};

function centreOf(model, partName) {
  const triangles = model.partTriangles(partName);
  if (!triangles || !triangles.length) return null;
  return boundsOf(triangles).getCenter(new Vector3());
}

/**
 * The envelope of a named set of parts.
 *
 * Passing the set explicitly is the point. "How long is it" has several honest
 * answers depending on whether mirrors, a tow hitch or a roof antenna count.
 */
export function envelope(model, { exclude = [], only = null } = {}) {
  const skip = new Set(exclude);
  const keep = only ? new Set(only) : null;
  const box = new Box3();
  const p = new Vector3();
  const used = [];
  for (const [name, entry] of model.parts) {
    if (skip.has(name)) continue;
    if (keep && !keep.has(name)) continue;
    if (!entry.triangleCount) continue;
    used.push(name);
    for (let i = entry.triangleStart; i < entry.triangleStart + entry.triangleCount; i += 1) {
      const t = model.triangles[i];
      for (let k = 0; k < 9; k += 3) box.expandByPoint(p.set(t[k], t[k + 1], t[k + 2]));
    }
  }
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  return {
    parts: used,
    length_m: round(size.x),
    width_m: round(size.z),
    height_m: round(size.y),
    min: { x: round(box.min.x), y: round(box.min.y), z: round(box.min.z) },
    max: { x: round(box.max.x), y: round(box.max.y), z: round(box.max.z) },
  };
}

/**
 * The measurements a specification actually names, taken from landmarks that
 * cannot move: axle centres, wheel centres, the ground plane.
 */
export function keyDimensions(model) {
  const axles = {};
  for (const [key, part] of Object.entries(AXLE_PARTS)) {
    const centre = centreOf(model, part);
    if (centre) axles[key] = centre;
  }

  const haveAxles = ["frontLeft", "frontRight", "rearLeft", "rearRight"].every((k) => axles[k]);
  const frontAxleX = haveAxles ? (axles.frontLeft.x + axles.frontRight.x) / 2 : null;
  const rearAxleX = haveAxles ? (axles.rearLeft.x + axles.rearRight.x) / 2 : null;

  const full = envelope(model);
  const bodyOnly = envelope(model, { exclude: [...PROTRUDING] });

  // The mirrors are sub-meshes of the front doors, so excluding whole doors
  // also removes the door skins. Take the body width from the parts that
  // define it instead, and say so.
  const skinWidth = envelope(model, { only: ["body", "cladding", "fasciaFront", "fasciaRear"] });

  return {
    landmarks: {
      frontAxle_x_m: frontAxleX === null ? null : round(frontAxleX),
      rearAxle_x_m: rearAxleX === null ? null : round(rearAxleX),
      groundPlane_y_m: full ? round(full.min.y) : null,
    },
    wheelbase_m: haveAxles ? round(frontAxleX - rearAxleX) : null,
    frontTrack_m: haveAxles ? round(Math.abs(axles.frontLeft.z - axles.frontRight.z)) : null,
    rearTrack_m: haveAxles ? round(Math.abs(axles.rearLeft.z - axles.rearRight.z)) : null,
    length_m: full ? full.length_m : null,
    widthOverMirrors_m: full ? full.width_m : null,
    widthOverBody_m: skinWidth ? skinWidth.width_m : null,
    height_m: bodyOnly ? bodyOnly.height_m : null,
    frontOverhang_m: full && frontAxleX !== null ? round(full.max.x - frontAxleX) : null,
    rearOverhang_m: full && rearAxleX !== null ? round(rearAxleX - full.min.x) : null,
    measuredFrom: {
      wheelbase: "centres of wheelFL/FR and wheelRL/RR bounding boxes",
      tracks: "left-to-right wheel centre separation, per axle",
      length: "extreme x over every part",
      widthOverBody: "body, cladding, fasciaFront, fasciaRear only",
      widthOverMirrors: "extreme z over every part",
      height: "extreme y excluding the front doors, which carry the mirrors",
    },
  };
}

/** Every part, with its envelope. The component tag table. */
export function partTable(model) {
  const rows = [];
  for (const [name, entry] of model.parts) {
    const triangles = model.partTriangles(name);
    const box = triangles && triangles.length ? boundsOf(triangles) : null;
    const size = box ? box.getSize(new Vector3()) : null;
    const centre = box ? box.getCenter(new Vector3()) : null;
    rows.push({
      id: name,
      label: entry.label,
      category: entry.category,
      meshes: entry.meshCount,
      triangles: entry.triangleCount,
      size_mm: size ? { x: mm(size.x), y: mm(size.y), z: mm(size.z) } : null,
      centre_m: centre ? { x: round(centre.x), y: round(centre.y), z: round(centre.z) } : null,
    });
  }
  return rows;
}

/**
 * Is the model symmetric about the centreline?
 *
 * A real check, not a vibe: mirror every triangle centroid in z and require a
 * match within tolerance. Asymmetry that is not deliberate — a wheel arch
 * lofted one way on one side — shows up here and nowhere else until it is
 * photographed from the wrong angle.
 */
/**
 * Which part owns each extreme of the envelope.
 *
 * A fit report that says "+54 mm too long" is a complaint. The same report
 * naming the part that defines the extreme is a work item. This is the step
 * that used to be done by rotating the model and squinting at the nose.
 */
export function extremes(model) {
  const axes = { x: 0, y: 1, z: 2 };
  const out = {};
  for (const [axis, offset] of Object.entries(axes)) {
    let lo = { value: Infinity, part: null };
    let hi = { value: -Infinity, part: null };
    for (const [name, entry] of model.parts) {
      for (let i = entry.triangleStart; i < entry.triangleStart + entry.triangleCount; i += 1) {
        const t = model.triangles[i];
        for (let k = 0; k < 9; k += 3) {
          const v = t[k + offset];
          if (v < lo.value) lo = { value: v, part: name };
          if (v > hi.value) hi = { value: v, part: name };
        }
      }
    }
    out[axis] = {
      min: { value_m: round(lo.value), part: lo.part, label: model.parts.get(lo.part)?.label ?? null },
      max: { value_m: round(hi.value), part: hi.part, label: model.parts.get(hi.part)?.label ?? null },
    };
  }
  return out;
}

// Symmetry lives in section.mjs, deliberately.
//
// The first version of it here mirrored triangle centroids across the
// centreline and reported 52% symmetric for a car that is symmetric by
// construction. It was measuring the tessellation, not the shape: the two
// pillar surrounds are generated by walking the section in opposite
// directions, so the surfaces match and the triangles do not. Comparing
// sections gives 98.6% within 2 mm on the same model.
//
// Finding 12: a number can be real, correctly read, and about the wrong thing.
// The wrong instrument is not kept alongside the right one.
export { sectionSymmetry as symmetry } from "./section.mjs";
