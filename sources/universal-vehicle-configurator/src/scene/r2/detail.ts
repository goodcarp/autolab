import {
  BufferGeometry, Float32BufferAttribute, Group,
  type Material, Mesh, Path, Shape, ShapeGeometry, type Vector3,
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

/** A rounded rectangle centred on the origin: `width` x `height` with corner radius `radius`. */
function pill(width: number, height: number, radius: number): Shape {
  const a = width / 2 - radius, b = height / 2 - radius, shape = new Shape();
  shape.moveTo(-a, -height / 2);
  shape.lineTo(a, -height / 2);
  shape.absarc(a, -b, radius, -Math.PI / 2, 0, false);
  shape.lineTo(width / 2, b);
  shape.absarc(a, b, radius, 0, Math.PI / 2, false);
  shape.lineTo(-a, height / 2);
  shape.absarc(-a, b, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-width / 2, -b);
  shape.absarc(-a, -b, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

// The headlamp as the front drawing has it, on the face plane: a 150 x 288 mm
// stadium ring round an 89 x 200 mm dark lens holding three 65 x 30 mm modules.
const LAMP = { width: 0.150, height: 0.288, lensWidth: 0.089, lensHeight: 0.200 } as const;
const MODULE_DY = [0.054, -0.004, -0.061] as const;

/**
 * The wheel opening as the model draws it: a superellipse round the hub,
 * `rx` fore and aft, `ry` up from hub height, exponent `n` (SPEC.archRX,
 * archRY, archN on the model).
 */
export interface WheelArch { rx: number; ry: number; n: number }

/** Height of the arch over the hub at `u`, from -1 (one end) to 1 (the other). */
function archHeight(arch: WheelArch, u: number): number {
  return arch.ry * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), arch.n)), 1 / arch.n);
}

/**
 * Showroom-only optical assemblies and dark wheel housings; no blueprint edits.
 *
 * `lamp` is the position of the model's right headlamp ring (headlamps mesh 0),
 * so the dressing follows the drawing instead of carrying its own copy of the
 * lamp's place. Every piece is a flat shape facing forward, layered a fraction
 * of a millimetre apart just ahead of the face.
 */
export function buildDetailGroup(materials: DetailMaterials, lamp: Vector3, arch: WheelArch): Group {
  const group = new Group();
  group.name = "showroom-detail";
  const nose = lamp.x - 0.010, y0 = lamp.y;

  const facing = (geometry: ShapeGeometry, material: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  for (const sign of [1, -1] as const) {
    const z = sign * Math.abs(lamp.z);
    // back plate: the ring's whole outline, dark, so nothing of the body shows through
    facing(new ShapeGeometry(stadium(new Shape(), LAMP.width, LAMP.height), 32), materials.bezel, nose + 0.0075, y0, z);
    // the dark lens inside the ring
    facing(new ShapeGeometry(stadium(new Shape(), LAMP.lensWidth, LAMP.lensHeight), 32), materials.bezel, nose + 0.0090, y0, z);
    // three matrix modules
    for (const dy of MODULE_DY) facing(new ShapeGeometry(pill(0.065, 0.030, 0.012), 12), materials.emitter, nose + 0.0105, y0 + dy, z);
    // the running-light ring: the stadium with the lens cut out of it
    const ring = stadium(new Shape(), LAMP.width, LAMP.height);
    ring.holes.push(stadium(new Path(), LAMP.lensWidth, LAMP.lensHeight));
    facing(new ShapeGeometry(ring, 32), materials.emitter, nose + 0.0120, y0, z);
  }

  // Liners follow the model's own wheel openings. Light can no longer shine
  // through the empty wheelhouse onto the back of the painted shell. The front
  // one stops at 0.872: the front fender has tumblehome, its skin at the crown
  // is at 0.880-0.885, so a liner as wide as the rear one would poke out
  // through the arch flare. The rear skin is at about 0.92.
  for (const axle of [SPEC.XF, SPEC.XR]) for (const sign of [1, -1]) {
    const positions: number[] = [], indices: number[] = [];
    const count = 56, widths = [0.60, axle > 0 ? 0.872 : 0.914];
    for (let i = 0; i <= count; i++) {
      const u = -1 + 2 * i / count;
      const y = SPEC.tireR + archHeight(arch, u);
      for (const width of widths) positions.push(axle + arch.rx * u, y + 0.004, sign * width);
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
    wall.moveTo(-arch.rx, 0.30 - SPEC.tireR);
    for (let i = 0; i <= count; i++) {
      const u = -1 + 2 * i / count;
      wall.lineTo(arch.rx * u, archHeight(arch, u));
    }
    wall.lineTo(arch.rx, 0.30 - SPEC.tireR);
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
