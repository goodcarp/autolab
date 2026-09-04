// Load a model builder and flatten it into something measurable.
//
// The engine never owns a model. It points at wherever the model is authored —
// by default the r2-blueprint source, which stays canonical and is only ever
// read — and turns whatever comes back into a flat table of triangles with the
// part they belong to. Everything else here measures that table.

import { register } from "node:module";
import { homedir } from "node:os";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Box3, Matrix4, Vector3 } from "three";

// Registered once, before any model is imported.
register("./three-hook.mjs", import.meta.url);

export const DEFAULT_MODEL = resolve(homedir(), "Desktop", "r2-blueprint", "src", "vehicle.js");

/**
 * Every triangle in the model, in world space, tagged with its part.
 *
 * World space matters: a part's own group may carry a transform, and the brakes
 * live inside the wheel hubs rather than under their own group. Measuring local
 * coordinates would quietly answer a different question.
 */
export async function loadModel({ path = process.env.MODEL_PATH ?? DEFAULT_MODEL } = {}) {
  const module = await import(pathToFileURL(path).href);
  if (typeof module.buildVehicle !== "function") {
    throw new Error(`${path} does not export buildVehicle()`);
  }
  const vehicle = module.buildVehicle();
  vehicle.root.updateMatrixWorld(true);

  const parts = new Map();
  const triangles = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();

  for (const part of vehicle.order) {
    const entry = {
      name: part.name,
      label: part.label,
      category: part.category,
      description: part.desc,
      triangleStart: triangles.length,
      triangleCount: 0,
      meshCount: part.meshes.length,
    };
    for (const mesh of part.meshes) {
      mesh.updateWorldMatrix(true, false);
      const matrix = new Matrix4().copy(mesh.matrixWorld);
      const geometry = mesh.geometry;
      const position = geometry.getAttribute("position");
      if (!position) continue;
      const index = geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
        b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, i2).applyMatrix4(matrix);
        triangles.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
        entry.triangleCount += 1;
      }
    }
    parts.set(part.name, entry);
  }

  const bounds = new Box3();
  for (const t of triangles) {
    for (let k = 0; k < 9; k += 3) {
      bounds.expandByPoint(a.set(t[k], t[k + 1], t[k + 2]));
    }
  }

  return {
    path,
    spec: module.SPEC ? { ...module.SPEC } : null,
    vehicle,
    parts,
    triangles,
    bounds,
    partTriangles(name) {
      const entry = parts.get(name);
      if (!entry) return null;
      return triangles.slice(entry.triangleStart, entry.triangleStart + entry.triangleCount);
    },
  };
}

/** Bounding box over a triangle list. */
export function boundsOf(triangles) {
  const box = new Box3();
  const p = new Vector3();
  for (const t of triangles) {
    for (let k = 0; k < 9; k += 3) box.expandByPoint(p.set(t[k], t[k + 1], t[k + 2]));
  }
  return box;
}

export const round = (value, places = 4) => Number.parseFloat(value.toFixed(places));
export const mm = (metres) => round(metres * 1000, 1);
