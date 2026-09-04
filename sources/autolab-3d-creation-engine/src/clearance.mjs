// Clearance, and interpenetration.
//
// The digital twin's `measure` tool subtracts bounding-box centres, so two
// parts that interpenetrate and two parts 200 mm apart can return the same
// number. That is fine for "where is it" and useless for "does it fit". This
// answers the second question: the nearest distance between two parts' actual
// surfaces, and whether their volumes overlap at all.

import { Box3, Vector3 } from "three";
import { boundsOf, mm, round } from "./load.mjs";

/** Sample points across a triangle: its vertices, edge midpoints and centroid. */
function samplePoints(triangles, stride = 1) {
  const points = [];
  for (let i = 0; i < triangles.length; i += stride) {
    const t = triangles[i];
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    points.push(
      [ax, ay, az], [bx, by, bz], [cx, cy, cz],
      [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
      [(bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2],
      [(cx + ax) / 2, (cy + ay) / 2, (cz + az) / 2],
      [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
    );
  }
  return points;
}

/**
 * Nearest surface-to-surface distance between two parts.
 *
 * Sampled, and honest about it: the result is an upper bound on the true
 * minimum, tightening as the sample density rises. It is reported with the
 * sample count so a number can be trusted proportionally, and the axis gaps —
 * which ARE exact — are reported alongside, because a part cleanly separated
 * along one axis needs no sampling at all.
 */
export function clearance(model, fromName, toName, { stride = 1 } = {}) {
  const from = model.partTriangles(fromName);
  const to = model.partTriangles(toName);
  if (!from?.length || !to?.length) {
    throw new Error(`no geometry for "${!from?.length ? fromName : toName}"`);
  }

  const boxA = boundsOf(from);
  const boxB = boundsOf(to);

  // Exact, and free: the separation along each axis. If any is positive the
  // parts cannot touch, and the true clearance is at least that.
  const axisGap = {
    x: round(Math.max(boxB.min.x - boxA.max.x, boxA.min.x - boxB.max.x)),
    y: round(Math.max(boxB.min.y - boxA.max.y, boxA.min.y - boxB.max.y)),
    z: round(Math.max(boxB.min.z - boxA.max.z, boxA.min.z - boxB.max.z)),
  };
  const boxesOverlap = axisGap.x < 0 && axisGap.y < 0 && axisGap.z < 0;

  const pointsA = samplePoints(from, stride);
  const pointsB = samplePoints(to, stride);
  let best = Infinity;
  let bestPair = null;
  for (const [ax, ay, az] of pointsA) {
    for (const [bx, by, bz] of pointsB) {
      const d = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      if (d < best) {
        best = d;
        bestPair = [[ax, ay, az], [bx, by, bz]];
      }
    }
  }
  const nearest = Math.sqrt(best);

  return {
    from: fromName,
    to: toName,
    nearestSurfaces_mm: mm(nearest),
    nearestSurfaces_isUpperBound: true,
    samples: { from: pointsA.length, to: pointsB.length },
    boundingBoxGap_mm: { x: mm(axisGap.x), y: mm(axisGap.y), z: mm(axisGap.z) },
    boundingBoxesOverlap: boxesOverlap,
    // Centre to centre, for comparison, and labelled so it cannot be mistaken
    // for a clearance.
    centreToCentre_mm: mm(boxA.getCenter(new Vector3()).distanceTo(boxB.getCenter(new Vector3()))),
    at: bestPair
      ? { from: bestPair[0].map((v) => round(v)), to: bestPair[1].map((v) => round(v)) }
      : null,
  };
}

/**
 * Which parts' bounding boxes overlap.
 *
 * A cheap first pass over the whole assembly. Overlap is not a fault — a door
 * skin overlaps the body it sits in — but an unexpected pair here is worth a
 * look, and it is the only way to find one without rotating the model by hand.
 */
export function overlapMatrix(model, { ignoreCategories = ["interior"] } = {}) {
  const skip = new Set(ignoreCategories);
  const boxes = [];
  for (const [name, entry] of model.parts) {
    if (skip.has(entry.category) || !entry.triangleCount) continue;
    boxes.push({ name, category: entry.category, box: boundsOf(model.partTriangles(name)) });
  }
  const pairs = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (!boxes[i].box.intersectsBox(boxes[j].box)) continue;
      const overlap = new Box3().copy(boxes[i].box).intersect(boxes[j].box);
      const size = overlap.getSize(new Vector3());
      pairs.push({
        a: boxes[i].name,
        b: boxes[j].name,
        overlap_mm: { x: mm(size.x), y: mm(size.y), z: mm(size.z) },
        volume_l: round(size.x * size.y * size.z * 1000, 2),
      });
    }
  }
  pairs.sort((p, q) => q.volume_l - p.volume_l);
  return { parts: boxes.length, overlappingPairs: pairs.length, pairs };
}
