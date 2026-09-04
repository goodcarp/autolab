import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { CameraRigId } from "./camera-presets";
import { SCENE_MANIFEST, type NormalizedAnchor } from "./scene-manifest";
import type {
  LiveVehicleAccessories,
  LiveVehicleFocus,
  LiveVehicleInterior,
  LiveVehiclePaint,
  LiveVehicleRenderMode,
  LiveVehicleWheel,
} from "./live-vehicle.types";

/**
 * The seam between the viewport and whatever is actually drawing the vehicle.
 *
 * The licensed GLB is exterior-only geometry of a different car, which caps
 * what the configurator can honestly show: no doors, no frunk, no liftgate, and
 * a shape that is not the vehicle the catalog describes. The code-native R2
 * removes all three limits and costs nothing to ship, so the viewport takes the
 * model as a plug rather than hard-wiring one.
 *
 * To add a source: implement a component with these props, register it below,
 * and pass its id as `modelSource`. Everything else — camera, lighting,
 * blueprint mode, focus hotspots, the cabin — is source-agnostic.
 */

export interface VehicleModelProps {
  paint: LiveVehiclePaint;
  wheel: LiveVehicleWheel;
  accessories: LiveVehicleAccessories;
  interior?: LiveVehicleInterior;
  focus: LiveVehicleFocus;
  mode: LiveVehicleRenderMode;
  /**
   * 0 shut, 1 fully open. Only bodies that declare `hasOpenableBody` respond;
   * the rest ignore it, so the viewport can pass it unconditionally.
   */
  bodyOpen?: number;
  /** Call once the model is on screen; the viewport gates its crossfade on it. */
  onReady: () => void;
}

export type VehicleModelComponent =
  | ComponentType<VehicleModelProps>
  | LazyExoticComponent<ComponentType<VehicleModelProps>>;

export type VehicleModelSourceId = "licensed-glb" | "r2-engineering";

export interface VehicleModelSource {
  id: VehicleModelSourceId;
  label: string;
  /** What the canvas calls the vehicle while this body is the one on screen. */
  sceneTitle: string;
  /**
   * How to describe what a hotspot is pointing at. Feature positions are only
   * as truthful as the body carrying them, so the copy has to name that body
   * rather than assume the licensed reference.
   */
  hotspotBasis: string;
  /**
   * Who made the geometry on screen, and where it came from. Shown whenever the
   * live body is drawing: crediting one author while a different model renders
   * is both wrong and, for a licensed asset, an attribution failure.
   */
  credit: Readonly<{ text: string; href?: string }>;
  /** Shown in the canvas HUD, so it must stay truthful about what is drawn. */
  attribution: string;
  /** Whether this source can open doors, frunk and liftgate. */
  hasOpenableBody: boolean;
  /**
   * Whether the body carries its own cabin. Sources that do are kept on screen
   * for the interior view instead of being swapped for the stand-in cabin.
   */
  hasCabin?: boolean;
  /** Which camera rig frames this body. Rigs are per-vehicle, not per-scale. */
  cameraRig?: CameraRigId;
  /**
   * Where the hotspot markers sit, as a fraction of the stage.
   *
   * They are flat overlays, not projected from the scene, so they are only ever
   * right for one framing — the default angle view — and they are pinned to a
   * particular silhouette. Swap the body and they point at nothing, which is
   * why each body brings its own.
   */
  anchors?: Readonly<Record<"frontWheel" | "bodyPaint" | "chargePort" | "rearHitch", NormalizedAnchor>>;
  Component: VehicleModelComponent;
}

/**
 * Both are lazy so neither ships in the entry chunk; the viewport is already
 * behind its own dynamic import.
 */
export const VEHICLE_MODEL_SOURCES: Record<VehicleModelSourceId, VehicleModelSource> = {
  "licensed-glb": {
    id: "licensed-glb",
    label: "Licensed EX30 reference",
    sceneTitle: "Licensed compact-SUV reference",
    hotspotBasis: "the licensed reference vehicle",
    credit: {
      text: "Model: Mehdi Lagzouli / LagzDesign + OpenX · CC BY 4.0",
      href: "https://github.com/vevalabs/openx-assets/tree/main/src/vehicles/main/m1_volvo_ex30_2024",
    },
    attribution: "Licensed EX30 reference · not an R2",
    hasOpenableBody: false,
    Component: lazy(async () => ({
      default: (await import("./LicensedVehicleModel")).LicensedVehicleModel,
    })),
  },
  "r2-engineering": {
    id: "r2-engineering",
    label: "R2 engineering body",
    sceneTitle: "Rivian R2 · code-native body",
    hotspotBasis: "the code-native R2 body",
    credit: {
      // "General-arrangement drawing" reads as a manufacturer engineering
      // release. It is not one: the body is fitted in code to Rivian's
      // published dimensions with photo-derived surfacing, which is a weaker
      // and more honest claim.
      text: "Model: generated in code from published R2 dimensions · A. Carpenter",
    },
    attribution: "Code-native R2 · fitted to published dimensions, not a scan",
    hasOpenableBody: true,
    hasCabin: true,
    cameraRig: "r2",
    // Measured off the R2's own angle view: it is a longer, taller car and it
    // sits differently in frame than the reference body.
    anchors: {
      frontWheel: { x: 0.607, y: 0.665 },
      bodyPaint: { x: 0.425, y: 0.470 },
      chargePort: { x: 0.152, y: 0.495 },
      rearHitch: { x: 0.140, y: 0.610 },
    },
    Component: lazy(async () => ({
      default: (await import("./R2VehicleModel")).R2VehicleModel,
    })),
  },
};

export const DEFAULT_VEHICLE_MODEL_SOURCE: VehicleModelSourceId = "r2-engineering";

/**
 * The `?model=` override, read once at module load.
 *
 * The app rewrites the address bar to its canonical configuration URL during
 * its first effects, which drops anything it does not own. Reading the override
 * later therefore races that rewrite; reading it here, before React mounts,
 * does not.
 */
export const REQUESTED_VEHICLE_MODEL_SOURCE: VehicleModelSourceId | null = (() => {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("model");
  return requested && requested in VEHICLE_MODEL_SOURCES
    ? (requested as VehicleModelSourceId)
    : null;
})();

/**
 * The body this page will actually draw, resolvable before React mounts so copy
 * written outside the canvas can name it correctly.
 */
export function activeVehicleModelSource(): VehicleModelSource {
  return resolveVehicleModelSource(
    REQUESTED_VEHICLE_MODEL_SOURCE ?? DEFAULT_VEHICLE_MODEL_SOURCE,
  );
}

/** The hotspot anchors for a body, falling back to the manifest's own. */
export function anchorsFor(source: VehicleModelSource) {
  return source.anchors ?? SCENE_MANIFEST.anchors;
}

export function resolveVehicleModelSource(
  id: VehicleModelSourceId = DEFAULT_VEHICLE_MODEL_SOURCE,
): VehicleModelSource {
  return VEHICLE_MODEL_SOURCES[id] ?? VEHICLE_MODEL_SOURCES[DEFAULT_VEHICLE_MODEL_SOURCE];
}
