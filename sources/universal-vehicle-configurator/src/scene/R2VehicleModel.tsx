import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import { dressForShowroom, fitWheelDiameter, rimFinishFor } from "./r2/showroom";
import { buildVehicle, SPEC } from "./r2/vehicle.js";
import type { VehicleModelProps } from "./vehicle-model-source";

/* eslint-disable react-hooks/immutability --
 * A three.js scene graph is mutable by design and is not React state: opening a
 * door moves objects React does not own, and the renderer reads them directly.
 * The rule reads that mutation as a render-consistency hazard, which it is for
 * plain data and is not for a retained-mode scene. Treating it as one would
 * mean rebuilding the whole body on every configuration change.
 */

/**
 * The R2 itself.
 *
 * This is the engineering body from the general-arrangement drawing, carried
 * over as-is and dressed for a showroom. Bringing it across rather than
 * modelling a second car means the configurator shows the vehicle the catalog
 * is actually selling, at its published dimensions, with the things a licensed
 * exterior scan cannot give: doors, a frunk and a liftgate that open, a tyre
 * lathed around its own bead, a vented disc and trailing caliper behind the
 * spokes, and panel gaps that are edges in the surface rather than lines
 * painted onto it.
 *
 * The drawing stays the source of truth. Everything specific to the showroom —
 * paint, glass, lamp lenses, rim finishes — lives in the material layer next to
 * it, so the two can be updated independently.
 */

/** How far the doors, frunk and liftgate travel per second when they open. */
const OPEN_RATE = 1.9;

export function R2VehicleModel({
  paint,
  wheel,
  interior,
  accessories,
  focus,
  mode,
  bodyOpen = 0,
  onReady,
}: VehicleModelProps) {
  const invalidate = useThree((state) => state.invalidate);
  const blueprint = mode === "blueprint";

  // Building the body walks a few hundred lofted sections, so it happens once
  // for the life of the viewport and every configuration change after that is a
  // uniform write.
  const vehicle = useMemo(() => buildVehicle(), []);

  const showroom = useMemo(
    () => dressForShowroom(vehicle, {
      paintColor: paint.color,
      rimFinish: rimFinishFor(wheel.id, wheel.style),
      caliperColor: "#2b3033",
      cabinColor: interior?.color ?? "#22262a",
      lampsOn: true,
    }),
    // Colour changes are applied below without rebuilding; only the choices
    // that change a material's structure belong in here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicle, wheel.id, wheel.style],
  );

  useEffect(() => () => showroom.dispose(), [showroom]);

  // The drawing owns several hundred geometries and its own shell materials, and
  // R3F does not dispose what it did not create, so a <primitive> tree leaks its
  // whole body on unmount unless someone frees it.
  useEffect(() => () => {
    vehicle.root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
    });
  }, [vehicle]);

  // Parented here rather than inside dressForShowroom: attaching during render
  // leaves a group hanging off the drawing for every render React discards.
  useEffect(() => {
    vehicle.body.add(showroom.detail);
    invalidate();
    return () => {
      showroom.detail.removeFromParent();
    };
  }, [invalidate, showroom, vehicle]);

  useEffect(() => {
    showroom.paint.color.set(paint.color);
    invalidate();
  }, [invalidate, paint.color, showroom]);

  useEffect(() => {
    showroom.cabin.color.set(interior?.color ?? "#22262a");
    invalidate();
  }, [interior?.color, invalidate, showroom]);

  useEffect(() => {
    // Through the handle, so the cut clones on the body shell, greenhouse and
    // pillars switch too. Iterating the base materials alone leaves the four
    // largest surfaces on the car shaded solid inside a wireframe.
    showroom.forEachMaterial((material) => {
      (material as { wireframe?: boolean }).wireframe = blueprint;
    });
    invalidate();
  }, [blueprint, invalidate, showroom]);

  useEffect(() => {
    const restore = fitWheelDiameter(vehicle, wheel.diameterInches);
    invalidate();
    return () => {
      restore();
      invalidate();
    };
  }, [invalidate, vehicle, wheel.diameterInches]);

  useEffect(() => {
    vehicle.parts.hitch?.group.scale.setScalar(accessories.towHitch ? 1 : 0);
    invalidate();
  }, [accessories.towHitch, invalidate, vehicle]);

  // The body animates toward the requested opening rather than snapping, and
  // the loop only runs while it is still moving — the viewport draws on demand.
  const openRef = useRef(0);
  useFrame((_, delta) => {
    const target = blueprint ? 0 : bodyOpen;
    const current = openRef.current;
    if (Math.abs(target - current) < 0.001) {
      if (current !== target) {
        openRef.current = target;
        vehicle.openT = target;
        vehicle.update(0, { time: 0, speed: 0, steer: 0, run: false, drive: false });
        invalidate();
      }
      return;
    }
    const step = Math.min(Math.abs(target - current), OPEN_RATE * Math.min(delta, 0.05));
    openRef.current = current + Math.sign(target - current) * step;
    vehicle.openT = openRef.current;
    vehicle.update(0, { time: 0, speed: 0, steer: 0, run: false, drive: false });
    invalidate();
  });

  // A named handle on the assembled body. It costs one property and makes the
  // model inspectable from the console — which is how its surfacing gets tuned,
  // and how anyone reviewing this can check that the parts really are separate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __r2?: unknown }).__r2 = { vehicle, showroom };
  }, [showroom, vehicle]);

  useEffect(() => {
    onReady();
    invalidate();
  }, [invalidate, onReady]);

  useEffect(() => {
    invalidate();
  }, [focus, invalidate]);

  return <primitive object={vehicle.root} />;
}

export { SPEC as R2_SPEC };
export default R2VehicleModel;
