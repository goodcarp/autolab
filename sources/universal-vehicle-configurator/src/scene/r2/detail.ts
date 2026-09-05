import {
  BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  type Material, Mesh, Path, Shape, ShapeGeometry, SphereGeometry,
} from "three";
import { SPEC } from "./vehicle.js";

export interface DetailMaterials {
  reflector: Material;
  emitter: Material;
  bezel: Material;
  lens: Material;
  rubber: Material;
}

function stadium<T extends Shape | Path>(path: T, width: number, height: number): T {
  const radius = width / 2, vertical = height / 2 - radius;
  path.moveTo(-radius, -vertical);
  path.absarc(0, -vertical, radius, Math.PI, Math.PI * 2, false);
  path.lineTo(radius, vertical);
  path.absarc(0, vertical, radius, 0, Math.PI, false);
  path.closePath();
  return path;
}

/** Showroom-only optical assemblies and dark wheel housings; no blueprint edits. */
export function buildDetailGroup(materials: DetailMaterials, nose: number): Group {
  const group = new Group();
  group.name = "showroom-detail";

  for (const sign of [1, -1] as const) {
    const z = sign * 0.595;
    const back = new Mesh(new ShapeGeometry(stadium(new Shape(), 0.188, 0.328), 32), materials.bezel);
    back.rotation.y = Math.PI / 2;
    back.position.set(nose + 0.012, 0.875, z);
    group.add(back);

    // Thin perimeter light guide, with real open space around the projectors.
    // Unlike a rounded box, its radius is independent of the lamp's depth.
    const shape = stadium(new Shape(), 0.185, 0.325);
    shape.holes.push(stadium(new Path(), 0.162, 0.302));
    const drl = new Mesh(new ShapeGeometry(shape, 32), materials.emitter);
    drl.rotation.y = Math.PI / 2;
    drl.position.set(nose + 0.033, 0.875, z);
    group.add(drl);

    for (const dy of [-0.082, 0, 0.082]) {
      const housing = new Mesh(new CylinderGeometry(0.037, 0.030, 0.010, 32), materials.reflector);
      housing.rotation.z = Math.PI / 2;
      housing.position.set(nose + 0.019, 0.875 + dy, z);
      group.add(housing);
      const pupil = new Mesh(new CylinderGeometry(0.027, 0.027, 0.004, 32), materials.bezel);
      pupil.rotation.z = Math.PI / 2;
      pupil.position.set(nose + 0.025, 0.875 + dy, z);
      group.add(pupil);
      const lens = new Mesh(new SphereGeometry(0.027, 24, 12), materials.lens);
      lens.scale.x = 0.22;
      lens.position.set(nose + 0.027, 0.875 + dy, z);
      group.add(lens);
    }
  }

  // Squircle liners follow the authored wheel openings. Light can no longer
  // shine through the empty wheelhouse onto the back of the painted shell.
  for (const axle of [SPEC.XF, SPEC.XR]) for (const sign of [1, -1]) {
    const positions: number[] = [], indices: number[] = [];
    const count = 56, radius = 0.505;
    for (let i = 0; i <= count; i++) {
      const u = -1 + 2 * i / count;
      const y = SPEC.tireR + radius * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.7)), 1 / 2.7);
      for (const width of [0.60, 0.914]) positions.push(axle + radius * u, y + 0.004, sign * width);
      if (i < count) { const k = i * 2; indices.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const liner = new Mesh(geometry, materials.rubber);
    liner.castShadow = true; liner.receiveShadow = true;
    group.add(liner);

    // Cover the inner vertical wall as well as the arch ceiling. The authored
    // body folds inward here and otherwise exposes a painted wall behind the tire.
    const wall = new Shape();
    wall.moveTo(-radius, 0.30 - SPEC.tireR);
    for (let i = 0; i <= count; i++) {
      const u = -1 + 2 * i / count;
      wall.lineTo(radius * u, radius * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.7)), 1 / 2.7));
    }
    wall.lineTo(radius, 0.30 - SPEC.tireR);
    wall.closePath();
    const inner = new Mesh(new ShapeGeometry(wall), materials.rubber);
    inner.position.set(axle, SPEC.tireR, sign * 0.675);
    inner.castShadow = true; inner.receiveShadow = true;
    group.add(inner);
  }

  group.userData.dispose = () => {
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  };
  return group;
}
