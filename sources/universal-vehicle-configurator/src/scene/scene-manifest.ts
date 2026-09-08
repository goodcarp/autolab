export type NormalizedAnchor = Readonly<{
  x: number;
  y: number;
}>;

export type WheelPresentation =
  | "mesh_swap"
  | "material_only"
  | "representative_inset";

export type SceneAssetMode = "live_3d" | "authored_2_5d";

/**
 * Facts about the licensed reference asset.
 *
 * This described the whole experience when the licensed Volvo EX30 was the only
 * body. It is not any more: the live vehicle is a code-native R2, registered in
 * vehicle-model-source.ts, which carries its own title, attribution, credit and
 * hotspot anchors. What remains here is the optional licensed reference asset,
 * selectable with ?model=licensed-glb, and its archived still metadata. The
 * configurator uses neutral loading and unavailable states, never these stills
 * as a substitute for the requested body.
 */
export const SCENE_MANIFEST = {
  id: "openx-volvo-ex30-2024-reference",
  displayName: "Licensed compact-SUV reference model",
  unofficialConcept: false,
  mode: "live_3d" as SceneAssetMode,
  aspectRatio: 16 / 9,
  model: {
    src: "/models/openx-volvo-ex30-2024.glb",
    status: "licensed_fallback_and_authored_still_source",
    assetName: "2024 Volvo EX30 low-poly",
    representsConfiguredVehicle: false,
    license: "MPL-2.0 AND CC-BY-4.0",
    attribution: "Mehdi Lagzouli / LagzDesign; OpenX adaptation © 2025 Dogan Ulus",
    sourceUrl:
      "https://github.com/vevalabs/openx-assets/tree/main/src/vehicles/main/m1_volvo_ex30_2024",
  },
  fallback: {
    showroomSrc: "/images/showroom-fallback.webp",
    sideSrc: "/images/vehicle-side.webp",
    blueprintSrc: "/images/vehicle-side-blueprint.webp",
    wheelInsetSrc: "/images/representative-wheel-inset.webp",
  },
  anchors: {
    frontWheel: { x: 0.19, y: 0.66 },
    rearWheel: { x: 0.79, y: 0.66 },
    bodyPaint: { x: 0.55, y: 0.48 },
    chargePort: { x: 0.27, y: 0.44 },
    rearHitch: { x: 0.96, y: 0.67 },
    rangeRulerOrigin: { x: 0.19, y: 0.82 },
  } satisfies Record<string, NormalizedAnchor>,
  bodyPaint: {
    presentation: "mapped_live_material_with_neutral_same_model_fallback",
    sourceColor: "#143d2f",
    label: "Representative paint visualization",
  },
  wheelPresentation: "material_only" as WheelPresentation,
  labels: {
    visualAccuracy: "Licensed reference geometry — not R2 geometry",
    // Historical reference still metadata; not a loading or failure placeholder.
    fallbackNotice: "Authored still of the licensed reference vehicle",
    wheelAccuracy: "Representative wheel treatment",
    affiliation: "Licensed EX30 reference · not an R2",
  },
} as const;

export type SceneManifest = typeof SCENE_MANIFEST;
