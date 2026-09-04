import { CylinderGeometry, Group, type Material, Mesh } from "three";
import { SPEC } from "./vehicle.js";

/**
 * Detail the drawing does not need but a showroom does.
 *
 * A general-arrangement drawing is cut away by definition: it never shows the
 * inside of a wheel arch, because in a drawing you are meant to see through it.
 * Rendered as a solid car the same omission is the first thing that gives the
 * model away — you look into the arch and see the lit underside of the body
 * skin, which reads as a hole punched in the bodywork.
 *
 * Similarly, a lamp in a drawing is an outline. A lamp in a showroom is a lens
 * with something behind it, and the depth between those two surfaces is most of
 * what makes it read as a lamp rather than a sticker.
 */

export interface DetailMaterials {
  reflector: Material;
  emitter: Material;
  bezel: Material;
}

/**
 * Arch liners and lamp internals, as one group parented to the body.
 *
 * Returned rather than merged into the drawing so the drawing stays the file
 * that can be diffed against the engineering source.
 */
export function buildDetailGroup(materials: DetailMaterials): Group {
  const group = new Group();
  group.name = "showroom-detail";

  // Headlamp internals: a reflector plate set back behind the lens, with three
  // matrix projectors on it. The gap between plate and lens is what gives the
  // lamp its depth when the camera comes in close.
  //
  // Everything here has to stay inside the lens the drawing already places — a
  // 330 mm tall by 190 mm wide stadium at the nose. Note the axes: a cylinder
  // laid on its side by a quarter turn about Z has its length along world X
  // (the lamp's depth), its local X across world height, and its local Z across
  // world width. Scaling the wrong one of those makes the reflector wider than
  // the lens instead of taller, and it reads as a white bar stuck to the bumper.
  const nose = SPEC.NOSE;
  const LAMP_HALF_HEIGHT = 0.150;
  const LAMP_HALF_WIDTH = 0.080;
  for (const sign of [1, -1] as const) {
    const z = sign * 0.595;

    const bowl = new Mesh(
      new CylinderGeometry(LAMP_HALF_WIDTH * 0.86, LAMP_HALF_WIDTH * 0.92, 0.012, 28),
      materials.reflector,
    );
    bowl.rotation.z = Math.PI / 2;
    bowl.position.set(nose - 0.012, 0.875, z);
    bowl.scale.set((LAMP_HALF_HEIGHT * 0.88) / (LAMP_HALF_WIDTH * 0.92), 1, 1);
    group.add(bowl);

    for (const dy of [-0.088, 0, 0.088]) {
      const housing = new Mesh(new CylinderGeometry(0.034, 0.028, 0.026, 24), materials.reflector);
      housing.rotation.z = Math.PI / 2;
      housing.position.set(nose - 0.002, 0.875 + dy, z);
      group.add(housing);

      const element = new Mesh(new CylinderGeometry(0.024, 0.024, 0.008, 24), materials.emitter);
      element.rotation.z = Math.PI / 2;
      element.position.set(nose + 0.012, 0.875 + dy, z);
      group.add(element);
    }

    // The bezel rings the lens from inside, so it reads as a lamp surround
    // rather than a second housing bolted over the top of it.
    const bezel = new Mesh(
      new CylinderGeometry(LAMP_HALF_WIDTH * 0.94, LAMP_HALF_WIDTH * 0.94, 0.005, 32),
      materials.bezel,
    );
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(nose + 0.004, 0.875, z);
    bezel.scale.set((LAMP_HALF_HEIGHT * 0.95) / (LAMP_HALF_WIDTH * 0.94), 1, 1);
    group.add(bezel);
  }

  group.userData.dispose = () => {
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  };

  return group;
}
