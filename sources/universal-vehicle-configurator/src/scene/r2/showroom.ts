import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  LatheGeometry,
  type Material,
  Mesh,
  MeshDepthMaterial,
  RGBADepthPacking,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
} from "three";
import { surfaceFinish } from "./surface-finish";
import { buildDetailGroup, type WheelArch } from "./detail";
import { cutGLSL } from "./geom.js";
import { CUT, SPEC, type R2Vehicle } from "./vehicle.js";
import { createPresentationScan, type PresentationScan } from "./presentation-scan";

/**
 * The wheel opening for a model that does not publish one on SPEC (the
 * September copy of the drawing). It equals the current model's own numbers.
 */
const ARCH_FALLBACK: WheelArch = { rx: 0.48, ry: 0.50, n: 2.5 };

/**
 * Showroom dressing for the engineering body.
 *
 * The body arrives from the drawing in flat white with its door, window and
 * frunk apertures cut in the fragment shader rather than booleaned out of the
 * mesh. That cut is the reason the panel gaps are real geometry edges instead
 * of painted-on lines, and it is carried by the material — so re-materialising
 * for a showroom means rebuilding the cut on top of automotive shaders, not
 * replacing the materials outright. Swapping them wholesale (which is what a
 * naive PBR pass does) silently fills every aperture back in.
 *
 * Assignment is by part name and sub-id, which is how the drawing already
 * identifies its own components. That is what makes the lamp lens separable
 * from its emitter, and the rim, tyre, disc and caliper distinct parts rather
 * than one wheel-shaped lump.
 */

export type RimFinish = "tungsten" | "blackSand" | "bicolor" | "graphite";

export interface ShowroomOptions {
  paintColor: string;
  /** Catalog paint id, so the coat can be the finish being sold, not just its hex. */
  paintId?: string;
  /** Second body colour for the roof on two-tone paints; null keeps it single. */
  roofColor?: string | null;
  rimFinish: RimFinish;
  caliperColor: string;
  cabinColor: string;
  lampsOn: boolean;
}

/**
 * A paint finish, not just a colour.
 *
 * The catalog carries one hex per paint, which is the swatch. A swatch is a
 * flat sRGB value and a car is not: a silver is a metallic basecoat that takes
 * most of its colour from what it reflects, a pearl white is a dielectric with
 * a thin-film flop, and a deep green is a dark metallic whose flake only shows
 * in the highlight roll-off. So each paint names its own basecoat, metallic
 * content, roughness and flake, and the swatch hex is what an unknown paint
 * falls back to.
 */
export interface PaintSpec {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  /** Roughness jitter from a per-fragment hash: metallic flake, in the shader. */
  flake: number;
  /** Thin-film pearl on top of the coat; 0 for a plain metallic. */
  iridescence: number;
  /** Tint of the dielectric specular, so a warm silver reflects warm. */
  specularColor: string;
}

const PAINT_DEFAULT: Omit<PaintSpec, "color"> = {
  metalness: 0.45,
  roughness: 0.27,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 1.7,
  flake: 0.05,
  iridescence: 0,
  specularColor: "#ffffff",
};

/** Keyed by catalog id: see `src/data/catalogs/r2.catalog.json`. */
const PAINT_SPECS: Record<string, Partial<PaintSpec> & { color: string }> = {
  // Cool silver: high metallic, most of its colour is the studio. The base and
  // the highlight are both kept neutral to slightly blue; a warm highlight
  // turns this paint champagne in a white studio.
  "paint.esker_silver": {
    color: "#b0b4b8",
    metalness: 0.8,
    roughness: 0.3,
    clearcoatRoughness: 0.04,
    flake: 0.06,
    envMapIntensity: 1.5,
    specularColor: "#ffffff",
  },
  // Pearl white: a dielectric coat with a faint thin-film flop, and the env
  // held down so a white flank never blows out under the strips.
  "paint.glacier_white": {
    color: "#e9ebe8",
    metalness: 0.06,
    roughness: 0.3,
    clearcoatRoughness: 0.035,
    flake: 0.03,
    iridescence: 0.32,
    envMapIntensity: 1.15,
    specularColor: "#f6f8ff",
  },
  "paint.catalina_blue": {
    color: "#1c3f64",
    metalness: 0.62,
    roughness: 0.3,
    flake: 0.07,
    specularColor: "#dfe9ff",
  },
  "paint.forest_green": {
    color: "#1f3629",
    metalness: 0.58,
    roughness: 0.31,
    flake: 0.07,
  },
  // Deep, saturated green: darker basecoat than the swatch, because the flake
  // lifts it back toward the swatch value in the light.
  "paint.launch_green": {
    color: "#2c4d2a",
    metalness: 0.66,
    roughness: 0.28,
    flake: 0.08,
    specularColor: "#e2ffe6",
  },
  // Deep blue-teal with a violet flop at grazing angles.
  "paint.borealis": {
    color: "#1e3a52",
    metalness: 0.64,
    roughness: 0.29,
    flake: 0.07,
    iridescence: 0.18,
    specularColor: "#d8e6ff",
  },
};

export function paintSpecFor(paintId: string | undefined, hex: string): PaintSpec {
  const named = paintId ? PAINT_SPECS[paintId] : undefined;
  if (named) return { ...PAINT_DEFAULT, ...named };
  return { ...PAINT_DEFAULT, color: hex };
}

/** The same write for the base coat and its cut twin: uniforms, no recompile. */
function applyPaintSpec(material: MeshPhysicalMaterial, spec: PaintSpec, flakeUniform?: { value: number }) {
  material.color.set(spec.color);
  material.metalness = spec.metalness;
  material.roughness = spec.roughness;
  material.clearcoat = spec.clearcoat;
  material.clearcoatRoughness = spec.clearcoatRoughness;
  material.envMapIntensity = spec.envMapIntensity;
  material.specularColor.set(spec.specularColor);
  material.iridescence = spec.iridescence;
  material.iridescenceIOR = 1.3;
  material.iridescenceThicknessRange = [140, 400];
  if (flakeUniform) flakeUniform.value = spec.flake;
}

/** Blueprint-only structure. Real, but not what a showroom is showing. */
const CUTAWAY_ONLY = new Set([
  "battery",
  "batterySeams",
  "subframeF",
  "subframeR",
  "driveUnitF",
  "driveUnitR",
  "suspension",
  "springs",
  "steering",
  "halfshafts",
  "antiRoll",
]);

type Role =
  | "paint"
  | "roof"
  | "gloss"
  | "trim"
  | "cladding"
  | "skid"
  | "chrome"
  | "glass"
  | "lampLens"
  | "lampEmitter"
  | "tailEmitter"
  | "reflector"
  | "amber"
  | "plate"
  | "tyre"
  | "rim"
  | "rimPocket"
  | "lug"
  | "disc"
  | "discVent"
  | "caliper"
  | "carrier"
  | "cabin"
  | "cabinDark"
  | "screen"
  | "sensor";

/**
 * Which shader each mesh gets.
 *
 * Keys are `part` or `part#sub`, matching the ids the drawing already assigns,
 * so this table reads against the build code rather than guessing from shape.
 */
const ROLE_BY_MESH: Record<string, Role> = {
  // painted skin
  body: "paint",
  hood: "paint",
  "hood#2": "chrome",
  tailgate: "paint",
  // Sub 1 is the upper liftgate, the greenhouse's own section lofted on aft of
  // where the greenhouse stops. It is body colour: the D-pillar faces and the
  // band above the lamp bar round the rear window. The window is its own panel
  // inset in it: sub 11 the glass, sub 12 the black frame round it.
  "tailgate#1": "paint",
  "tailgate#4": "chrome",
  "tailgate#5": "chrome",
  "tailgate#6": "trim",
  "tailgate#7": "reflector",
  // the lamp bar's run across the tail: sub 8 the lit lens, sub 9 its surround
  "tailgate#8": "tailEmitter",
  "tailgate#9": "gloss",
  "tailgate#11": "glass",
  "tailgate#12": "gloss",
  // Each door carries its own glazing and trim, so a door is not one material.
  // Sub 1 is the window panel: leaving it on paint puts a body-coloured
  // rectangle over every window, sitting proud of the greenhouse behind it.
  // Sub 6 is the black mirror arm, sub 8 the body-colour mirror housing. On the
  // rear doors sub 8 is the body-colour frame aft of the glass (the door's share
  // of the C pillar) and sub 7 the black strip that frames the glass.
  doorFL: "paint",
  "doorFL#1": "glass",
  "doorFL#3": "cabin",
  "doorFL#4": "cabinDark",
  "doorFL#5": "paint",
  "doorFL#6": "gloss",
  "doorFL#8": "paint",
  doorFR: "paint",
  "doorFR#1": "glass",
  "doorFR#3": "cabin",
  "doorFR#4": "cabinDark",
  "doorFR#5": "paint",
  "doorFR#6": "gloss",
  "doorFR#8": "paint",
  doorRL: "paint",
  "doorRL#1": "glass",
  "doorRL#3": "cabin",
  "doorRL#4": "cabinDark",
  "doorRL#5": "paint",
  "doorRL#7": "gloss",
  "doorRL#8": "paint",
  doorRR: "paint",
  "doorRR#1": "glass",
  "doorRR#3": "cabin",
  "doorRR#4": "cabinDark",
  "doorRR#5": "paint",
  "doorRR#7": "gloss",
  "doorRR#8": "paint",
  chargePort: "paint",

  // glasshouse
  greenhouse: "glass",
  roofGlass: "roof",
  "roofGlass#1": "trim",
  "roofGlass#2": "tailEmitter",
  // The spoiler lip is black with the roof on every paint, and follows a
  // two-tone roof colour.
  "roofGlass#3": "roof",
  pillars: "gloss",
  "pillars#5": "glass",
  // the body-colour panel over the surround: C pillar, under the quarter light, D pillar
  "pillars#6": "paint",

  // lower body
  cladding: "cladding",
  // sub 2 is the pair of amber side markers on each front flare
  "cladding#2": "amber",
  fasciaFront: "trim",
  "fasciaFront#1": "gloss",
  "fasciaFront#2": "skid",
  // sub 3 is the pair of tusk pods (silver), sub 5 the strip lamp each one carries
  "fasciaFront#3": "skid",
  "fasciaFront#4": "sensor",
  "fasciaFront#5": "chrome", // the tow-hook bars on the tusk pods are unlit satin metal on the reference
  // The rear bumper: sub 0 the black band, 2 its top ledge and bottom lip,
  // 1 the skid (the underside under it), 3 the flank reflectors, 4 the plate.
  fasciaRear: "trim",
  "fasciaRear#1": "skid",
  "fasciaRear#2": "trim",
  "fasciaRear#3": "reflector",
  "fasciaRear#4": "plate",

  // lamps — the lens is a separate part from what lights it
  headlamps: "lampLens",
  "headlamps#1": "lampEmitter",
  lightBar: "lampEmitter",
  // the bar's housing is dark gloss; only the strip in front of it glows
  "lightBar#1": "gloss",
  // the lamp bar's rounded ends on the quarters: sub 0 the lit lens, sub 1 its surround
  tailPills: "tailEmitter",
  "tailPills#1": "gloss",

  // cabin
  dash: "cabin",
  // The two screens are not upholstery. Left on the cabin material they take
  // the buyer's chosen trim colour, so picking a light interior tints the
  // instrument cluster.
  "dash#1": "screen",
  "dash#2": "screen",
  seats: "cabin",
  steeringWheel: "cabinDark",
  cargo: "cabinDark",
  frunk: "cabinDark",
  floor: "cabinDark",
  cargoFloor: "cabinDark",
  frunkFloor: "cabinDark",
  inlet: "trim",
  "inlet#5": "lampEmitter",

  // brakes
  brakes: "disc",
  "brakes#1": "caliper",
  "brakes#2": "discVent",
  "brakes#3": "disc",
  "brakes#4": "carrier",
};

/**
 * Wheels share one part per corner, so the rim/tyre split is by sub-id: 0 the
 * tyre, 1 the barrel, 2 the hub disc, 3 the centre badge, 4 the spoke stems,
 * 6 the lug nuts, 7 the rim lip, 8 the spoke arms. The barrel is the dark inner
 * well: lit as bright as the face it showed as a second ring inside the lip.
 */
const WHEEL_ROLE: Record<number, Role> = {
  0: "tyre",
  1: "rimPocket",
  2: "rim",
  3: "chrome",
  4: "rim",
  6: "lug",
  7: "rim",
  8: "rim",
};

/**
 * One entry per wheel the catalog actually sells.
 *
 * None of the four is polished chrome, so there is no "bright" here: Liquid
 * Tungsten is a dark satin, Black Sand is near-black, and the two machined
 * finishes are brighter on the face than in the pockets without ever becoming
 * a mirror. Mapping them through a generic aero/sport/terrain style put the two
 * darkest wheels on the brightest material.
 */
interface RimFinishSpec {
  color: string;
  metalness: number;
  roughness: number;
  /** Lacquer over the face; the defaults are a light satin coat. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  /** Colour of the inner barrel and the pockets: the second tone of a bicolor. */
  pocket: string;
  /**
   * Spoke section width in metres. With yArms it is the drawing's own stem
   * (50 mm) and the drawn face is kept as it is; without, every stem is
   * replaced by a straight spoke of this width that reaches the lip.
   */
  spokeWidth: number;
  /** Twin every spoke with a second one a tenth-turn on: a ten-spoke face. */
  twin: boolean;
  /** Keep the drawing's forked arms: the five-Y face of Liquid Tungsten. */
  yArms: boolean;
}

const RIM_FINISH: Record<RimFinish, RimFinishSpec> = {
  tungsten: {
    color: "#8a9096", metalness: 0.72, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.7,
    pocket: "#141617", spokeWidth: 0.050, twin: false, yArms: true,
  },
  blackSand: { color: "#2a2e30", metalness: 0.86, roughness: 0.46, pocket: "#1a1c1e", spokeWidth: 0.105, twin: false, yArms: false },
  bicolor: { color: "#9aa3a8", metalness: 0.96, roughness: 0.21, pocket: "#141618", spokeWidth: 0.042, twin: true, yArms: false },
  graphite: { color: "#5d6569", metalness: 0.94, roughness: 0.28, pocket: "#202325", spokeWidth: 0.058, twin: true, yArms: false },
};

/** The catalog's wheel ids, so the render matches the option by name. */
const RIM_FINISH_BY_OPTION: Record<string, RimFinish> = {
  "wheels.lt21_as": "tungsten",
  "wheels.bs20_at": "blackSand",
  "wheels.bc20_as": "bicolor",
  "wheels.mg19_as": "graphite",
};

export function rimFinishFor(optionId: string | undefined, style: string): RimFinish {
  const byOption = optionId ? RIM_FINISH_BY_OPTION[optionId] : undefined;
  if (byOption) return byOption;
  // A wheel this build does not know falls back on its style, which is coarse
  // but never lands on a finish the catalog does not sell.
  return style === "terrain" ? "blackSand" : style === "sport" ? "bicolor" : "tungsten";
}

/**
 * Shade every surface as what it is: an outside and an inside.
 *
 * Two things have to happen in the fragment shader, and they have to happen in
 * the same patch because a material only gets one `onBeforeCompile`.
 *
 * The aperture cut is the panel gaps. The drawing does not boolean holes for
 * the doors, windows and frunk; it discards those fragments, which is why the
 * shut lines are true edges in the surface rather than lines painted on it.
 * Re-materialising for a showroom therefore has to rebuild that cut on the new
 * shaders, or every opening silently fills back in.
 *
 * Cavity shading is the other half, and it rides on the same patch. Every
 * surface here is an open shell lit double-sided, so the inside of the body is
 * lit exactly as brightly as the outside — and you see it, through the wheel
 * arches, as bare white plastic where there should be a dark cavity. Darkening
 * back faces costs one line and no geometry, and it is closer to the truth than
 * any liner you could model: the inside of a body really is a hole light does
 * not reach.
 *
 * It applies to the painted shell alone. Winding is not consistent across the
 * drawing — several bolt-on panels are built inside-out, and the two pillar
 * surrounds are generated by walking the section in opposite directions, so one
 * of them is mirrored too. That is invisible under double-sided lighting but
 * makes `gl_FrontFacing` report backwards, so a blanket rule paints the hood
 * and doors black and darkens one side's pillar and not the other. The body
 * loft is correctly wound, and it is the only surface you ever genuinely look
 * into — through the wheel arches.
 */
function patchShell<T extends Material>(
  material: T, aperture: boolean, cavity = false, flake?: { value: number }, arch: WheelArch = ARCH_FALLBACK,
): T {
  const finish = surfaceFinish(String(material.userData.finishRole ?? ""));
  material.onBeforeCompile = (shader) => {
    if (finish) {
      shader.vertexShader = `varying vec3 vFinishPosition;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\nvFinishPosition = position;",
      );
      shader.fragmentShader = finish.library + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${flake ? finish.body.replace("0.09*visibility", "uFlake*visibility") : finish.body}\nnormal = r2Bump(-vViewPosition, normal, finishHeight, faceDirection);`,
      );
    }
    if (aperture || flake) {
      shader.vertexShader = `varying vec3 vObjPos;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\tvObjPos = position;",
      );
      shader.fragmentShader = `varying vec3 vObjPos;\n${shader.fragmentShader}`;
    }
    if (flake) {
      shader.uniforms.uFlake = flake;
      shader.fragmentShader = `uniform float uFlake;\n${shader.fragmentShader}`;
    }
    if (aperture) {
      shader.fragmentShader =
        `${cutGLSL(CUT)}\n${shader.fragmentShader}`.replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\n\tif (inAperture(vObjPos)) discard;",
        );
    }
    if (cavity) {
      // Before tone mapping, so the factor is a real drop in radiance rather
      // than a multiply against an already display-encoded value.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        `
        if (!gl_FrontFacing) gl_FragColor.rgb *= 0.16;
        // The procedural shell folds into each wheelhouse. Treat that hidden
        // return as a dark liner, including front-facing triangles at the fold:
        // everything inside the model's own arch superellipse, 5 mm oversize,
        // from the centreline out to past the skin, so the outboard ledge of
        // the well under the lip is dark too, not only the inner wall.
        float wellX = min(abs(vObjPos.x - ${SPEC.XF}), abs(vObjPos.x - ${SPEC.XR}));
        float wellY = max(vObjPos.y - ${SPEC.tireR}, 0.0);
        if (abs(vObjPos.z) < 0.97 && pow(wellX / ${(arch.rx + 0.005).toFixed(4)}, ${arch.n.toFixed(4)}) + pow(wellY / ${(arch.ry + 0.005).toFixed(4)}, ${arch.n.toFixed(4)}) < 1.0)
          gl_FragColor.rgb *= 0.035;
        #include <tonemapping_fragment>`,
      );
    }
  };
  // Each combination must have its own compiled program, or whichever compiles
  // first decides whether the apertures and the cavity exist for all of them.
  material.customProgramCacheKey = () =>
    `r2-shell-v2-${material.userData.finishRole ?? "plain"}${aperture ? "-cut" : ""}${cavity ? "-cavity" : ""}${flake ? "-flake" : ""}`;
  return material;
}

/**
 * Every surface in the drawing is an open shell.
 *
 * The tyre is a lathe with no inner wall, the body is a loft with no back face,
 * and the drawing lights all of it double-sided. Rendering any of it front-face
 * only means looking straight through the surface into the inside of the part —
 * on a tyre that shows as a torn ring of the wheel's own interior.
 */
function doubleSided<T extends Material>(materials: Record<string, T>): Record<string, T> {
  for (const [role, material] of Object.entries(materials)) {
    material.userData.finishRole = role;
    material.side = DoubleSide;
    // The paint already carries its flake patch; re-patching would drop it.
    if (role !== "paint") patchShell(material, false);
  }
  return materials;
}

function buildMaterials(
  options: ShowroomOptions,
  flake: { value: number },
): Record<Role, Material> {
  const rim = RIM_FINISH[options.rimFinish] ?? RIM_FINISH.tungsten;
  const lamp = options.lampsOn ? 1 : 0;

  // Automotive paint is a metallic basecoat under a smooth dielectric layer.
  // The clearcoat is what separates it from coloured plastic: a second, much
  // tighter specular lobe that survives at grazing angles. The numbers come
  // from the paint being sold, not from one generic coat.
  const paint = new MeshPhysicalMaterial({ side: DoubleSide });
  applyPaintSpec(paint, paintSpecFor(options.paintId, options.paintColor), flake);
  paint.userData.finishRole = "paint";
  patchShell(paint, false, false, flake);

  const roofPaint = new MeshPhysicalMaterial({
    color: new Color(options.roofColor ?? "#0e1215"),
    metalness: 0.08,
    roughness: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.25,
    side: DoubleSide,
  });

  return doubleSided({
    paint,
    roof: roofPaint,
    // Gloss black for the pillars and recesses: same coat, no flake. Held well
    // off a mirror finish deliberately — a true gloss pillar reflects the
    // studio ceiling almost perfectly, and a white A-pillar loses the blacked-
    // out greenhouse that gives this car its floating roof.
    gloss: new MeshPhysicalMaterial({
      color: new Color("#080a0b"),
      metalness: 0.1,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.85,
      side: DoubleSide,
    }),
    trim: new MeshStandardMaterial({
      color: new Color("#242627"),
      metalness: 0.15,
      roughness: 0.62,
      envMapIntensity: 0.85,
      side: DoubleSide,
    }),
    // Structural-grain composite: rougher and flatter than the bumper skin, so
    // the two-tone break reads even in a single-colour environment.
    cladding: new MeshStandardMaterial({
      color: new Color("#1e2021"),
      metalness: 0.05,
      roughness: 0.88,
      envMapIntensity: 0.75,
      side: DoubleSide,
    }),
    skid: new MeshStandardMaterial({
      color: new Color("#6b7175"),
      metalness: 0.55,
      roughness: 0.5,
      envMapIntensity: 1,
      side: DoubleSide,
    }),
    chrome: new MeshStandardMaterial({
      color: new Color("#cfd6d8"),
      metalness: 1,
      roughness: 0.14,
      envMapIntensity: 1.6,
    }),
    // Privacy glass: dark, near-mirror, and thin. Transmission is deliberately
    // low — a fully transmissive windscreen costs a render pass and reads worse
    // than a tinted reflector at showroom distance.
    glass: new MeshPhysicalMaterial({
      color: new Color("#0b0d0e"),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      metalness: 0.02,
      roughness: 0.045,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.52,
      envMapIntensity: 1.5,
      side: DoubleSide,
    }),
    // Lamp lens: clear, thick, and refracting, with the emitter behind it.
    lampLens: new MeshPhysicalMaterial({
      color: new Color("#e8f2f6"),
      metalness: 0,
      roughness: 0.02,
      transmission: 0.92,
      thickness: 0.05,
      ior: 1.49,
      envMapIntensity: 2.2,
    }),
    lampEmitter: new MeshStandardMaterial({
      color: new Color("#dceaf5"),
      emissive: new Color("#f4f6f8"),
      // Held well below blow-out. These are daytime running lamps in a lit
      // studio, not headlights on main beam at night. Measured in the studio:
      // at 1.25 the light bar's core still clips to one flat white; at 0.5 it
      // keeps a bright top edge falling to light grey, as the reference does.
      emissiveIntensity: 0.15 + lamp * 0.35,
      metalness: 0.1,
      roughness: 0.2,
      toneMapped: false,
    }),
    // The tail lamps are a dark crimson lens with only a faint glow of their
    // own, not a lit bar. Daytime running lamps light the front only, so this
    // does not follow the lamp switch. A strong red glow turns orange once the
    // studio's tone curve compresses it. The high-mounted stop lamp on the
    // roof uses the same lens.
    tailEmitter: new MeshPhysicalMaterial({
      color: new Color("#5c0a10"),
      emissive: new Color("#ff1e14"),
      emissiveIntensity: 0.1,
      metalness: 0,
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.2,
      side: DoubleSide,
    }),
    reflector: new MeshStandardMaterial({
      color: new Color("#8e1410"),
      emissive: new Color("#5c0a06"),
      emissiveIntensity: 0.4,
      roughness: 0.3,
    }),
    // The amber side reflector and repeater on each front flare: a lens with a
    // faint glow of its own, one of the car's few colour accents from the side.
    amber: new MeshStandardMaterial({
      color: new Color("#c96a12"),
      emissive: new Color("#7a3a05"),
      emissiveIntensity: 0.4,
      roughness: 0.3,
      side: DoubleSide,
    }),
    // The licence plate: a plain light blank in the bumper.
    plate: new MeshStandardMaterial({
      color: new Color("#d9dcd8"),
      roughness: 0.5,
      metalness: 0.2,
      side: DoubleSide,
    }),
    // Rubber: no reflection to speak of, and darker on the sidewall than the
    // tread. One roughness value across both is what makes tyres read as vinyl.
    // Fresh rubber has a low, broad sheen on the sidewall — not the dead matte
    // that makes a tyre read as a black hole in the arch.
    tyre: new MeshPhysicalMaterial({
      color: new Color("#262727"),
      metalness: 0,
      roughness: 0.74,
      clearcoat: 0.25,
      clearcoatRoughness: 0.55,
      envMapIntensity: 0.9,
    }),
    rim: new MeshPhysicalMaterial({
      color: new Color(rim.color),
      metalness: rim.metalness,
      roughness: rim.roughness,
      clearcoat: rim.clearcoat ?? 0.35,
      clearcoatRoughness: rim.clearcoatRoughness ?? 0.18,
      envMapIntensity: rim.envMapIntensity ?? 1.5,
      side: DoubleSide,
    }),
    rimPocket: new MeshStandardMaterial({
      color: new Color(rim.pocket),
      metalness: 0.6,
      roughness: 0.55,
      envMapIntensity: 0.8,
    }),
    lug: new MeshStandardMaterial({
      color: new Color("#8d9498"),
      metalness: 1,
      roughness: 0.3,
    }),
    // Cast iron with a machined face: bright, streaky, and never a mirror.
    disc: new MeshStandardMaterial({
      color: new Color("#9aa1a4"),
      metalness: 0.95,
      roughness: 0.42,
      envMapIntensity: 1.1,
    }),
    discVent: new MeshStandardMaterial({
      color: new Color("#3d4245"),
      metalness: 0.8,
      roughness: 0.62,
    }),
    caliper: new MeshPhysicalMaterial({
      color: new Color(options.caliperColor),
      metalness: 0.2,
      roughness: 0.35,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.2,
    }),
    carrier: new MeshStandardMaterial({
      color: new Color("#4a4f52"),
      metalness: 0.85,
      roughness: 0.55,
    }),
    // Barely any environment. The cabin is a closed box: it cannot see the
    // studio, and letting it try lifts a near-black trim to pale khaki, which
    // is the one thing an interior view must not do to the colour someone
    // just chose.
    cabin: new MeshStandardMaterial({
      color: new Color(options.cabinColor),
      metalness: 0.02,
      roughness: 0.82,
      envMapIntensity: 0.14,
      side: DoubleSide,
    }),
    cabinDark: new MeshStandardMaterial({
      color: new Color("#14171a"),
      metalness: 0.05,
      roughness: 0.88,
      envMapIntensity: 0.1,
      side: DoubleSide,
    }),
    // Displays read as near-black glass with their own faint glow, not as trim.
    screen: new MeshStandardMaterial({
      color: new Color("#0a0d10"),
      emissive: new Color("#22303a"),
      emissiveIntensity: 0.55,
      metalness: 0.1,
      roughness: 0.09,
      envMapIntensity: 1.2,
    }),
    sensor: new MeshStandardMaterial({
      color: new Color("#05070a"),
      metalness: 0.2,
      roughness: 0.15,
    }),
  }) as Record<Role, Material>;
}

export interface ShowroomHandle {
  /** Commit to the scene only after React accepts this material handle. */
  applyMaterials(): void;
  scan: PresentationScan;
  materials: Record<Role, Material>;
  paint: MeshPhysicalMaterial;
  /** Repaint in place: every coat parameter, base and cut twin, no recompile. */
  setPaint(spec: PaintSpec): void;
  caliper: MeshPhysicalMaterial;
  cabin: MeshStandardMaterial;
  /**
   * The showroom detail, unattached. The caller parents it, so a render that
   * React discards never leaves a group hanging off the drawing.
   */
  detail: Group;
  /**
   * Run `fn` over every material this handle owns, cut clones included.
   *
   * The clones are separate instances: a write to a base material does not
   * reach them. Colour is the one exception, because a twin shares the Color
   * object it was cloned from. Anything else — wireframe, most obviously — has
   * to go through here, or half the car ignores it.
   */
  forEachMaterial(fn: (material: Material) => void): void;
  dispose(): void;
}

/**
 * Dress a freshly built vehicle for the showroom.
 *
 * Returns the live paint and caliper materials so colour changes are a uniform
 * write rather than a rebuild — swapping a body colour must not cost a
 * recompile, or every click in the paint picker stutters.
 */
export function dressForShowroom(vehicle: R2Vehicle, options: ShowroomOptions): ShowroomHandle {
  const flake = { value: 0 };
  // The wheel opening, from the model itself, for the liners and the well darkening.
  const arch: WheelArch = {
    rx: vehicle.SPEC.archRX ?? ARCH_FALLBACK.rx,
    ry: vehicle.SPEC.archRY ?? ARCH_FALLBACK.ry,
    n: vehicle.SPEC.archN ?? ARCH_FALLBACK.n,
  };
  const base = buildMaterials(options, flake);
  const assignments: (() => void)[] = [];
  // Every material needs a cut twin, because the same paint appears on both cut
  // shells and uncut panels. A twin with the cavity darkening and one without are
  // different materials, so they are cached apart: the body loft is the only
  // surface wound so that gl_FrontFacing can be trusted (see patchShell), and
  // handing its cavity twin to another cut panel, such as the painted C pillar,
  // would darken that panel on one side of the car.
  const cavityTwins = new Map<Material, Material>();
  const plainTwins = new Map<Material, Material>();
  const twinCaches = [cavityTwins, plainTwins];
  const allTwins = () => twinCaches.flatMap(cache => [...cache.values()]);
  const cutDepth = patchShell(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide }), true);
  const cutVariant = (material: Material, cavity: boolean) => {
    const cutTwins = cavity ? cavityTwins : plainTwins;
    const existing = cutTwins.get(material);
    if (existing) return existing;
    // Every paint twin keeps the metallic flake, cavity or not.
    const twin = patchShell(material.clone(), true, cavity, material === base.paint ? flake : undefined, arch);
    // The twin has to keep sharing its colour with the original, not a copy of
    // it: the body shell is the cut variant of the paint, so a cloned colour
    // means changing the paint repaints the doors and leaves the shell behind.
    const source = material as unknown as { color?: Color; emissive?: Color };
    const target = twin as unknown as { color?: Color; emissive?: Color };
    if (source.color) target.color = source.color;
    if (source.emissive) target.emissive = source.emissive;
    cutTwins.set(material, twin);
    return twin;
  };

  for (const part of vehicle.order) {
    if (CUTAWAY_ONLY.has(part.name)) {
      // Go through the builder's own hide set as well, so its per-frame update
      // keeps them hidden instead of switching them back on.
      assignments.push(() => {
        vehicle.hidden.add(part.name);
        part.group.visible = false;
      });
      continue;
    }
    for (const object of part.meshes) {
      const mesh = object as Mesh;
      const sub = (mesh.userData.subId as number) ?? 0;
      const role: Role = part.category === "running"
        ? WHEEL_ROLE[sub] ?? "rim"
        : ROLE_BY_MESH[`${part.name}#${sub}`] ?? ROLE_BY_MESH[part.name] ?? "trim";
      const material = base[role];
      const assigned = mesh.userData.cut ? cutVariant(material, role === "paint" && part.name === "body") : material;
      assignments.push(() => {
        mesh.material = assigned;
        // Only the big shapes throw the contact shadow; small trim doubles the shadow pass for nothing visible.
        mesh.castShadow = ["paint", "cladding", "tyre", "tire", "rim", "wheel"].includes(role);
        mesh.receiveShadow = role !== "glass" && role !== "lampLens";
        if (mesh.userData.cut) mesh.customDepthMaterial = cutDepth;
        // The studio assembly supplies an actual DRL ring and optical modules.
        if (part.name === "headlamps") mesh.visible = false;
      });
    }
  }

  // Lamp internals are a showroom concern, so they are built here rather than
  // pushed back into the engineering source. Attaching is the caller's job.
  const detail = buildDetailGroup({
    reflector: base.chrome,
    emitter: base.lampEmitter,
    bezel: base.gloss,
    lens: base.lampLens,
    rubber: base.cladding,
  }, (vehicle.parts.headlamps.meshes[0] as Mesh).position, arch);

  let restoreWheels = () => {};
  let scan: PresentationScan | undefined;

  return {
    applyMaterials() {
      scan?.dispose();
      scan = undefined;
      restoreWheels();
      for (const apply of assignments) apply();
      restoreWheels = styleWheels(vehicle, RIM_FINISH[options.rimFinish] ?? RIM_FINISH.tungsten, base.rim);
    },
    get scan() {
      return scan ??= createPresentationScan([vehicle.root, detail], [...Object.values(base), ...allTwins()]);
    },
    materials: base,
    paint: base.paint as MeshPhysicalMaterial,
    setPaint(spec) {
      applyPaintSpec(base.paint as MeshPhysicalMaterial, spec, flake);
      for (const cache of twinCaches) {
        const twin = cache.get(base.paint) as MeshPhysicalMaterial | undefined;
        if (twin) applyPaintSpec(twin, spec);
      }
    },
    caliper: base.caliper as MeshPhysicalMaterial,
    cabin: base.cabin as MeshStandardMaterial,
    detail,
    forEachMaterial(fn) {
      for (const material of Object.values(base)) fn(material);
      for (const material of allTwins()) fn(material);
    },
    dispose() {
      scan?.dispose();
      restoreWheels();
      detail.removeFromParent();
      (detail.userData.dispose as (() => void) | undefined)?.();
      for (const material of Object.values(base)) material.dispose();
      for (const material of allTwins()) material.dispose();
      cutDepth.dispose();
    },
  };
}

/**
 * Give each wheel option its own face.
 *
 * The drawing casts one wheel: five Y spokes, each a 50 mm stem from the hub
 * (sub 4) that forks into two arms landing on the lip (sub 8). The catalog
 * sells four, and they do not share a face. Liquid Tungsten is the drawn face
 * and keeps it. The others hide the arms and swap each stem for a straight
 * spoke of their own section that reaches the lip from the hub, or twin each
 * one with a second spoke a tenth of a turn on for the split-spoke designs.
 * The stems stay the carriers, so the refit's diameter scaling, the spin and
 * the steer all still apply. Twins are children of the spoke they double, which
 * is what lets them ride the refit's scale and offset without knowing about it.
 *
 * Returns the undo, so a dispose leaves the drawing exactly as it found it.
 */
function styleWheels(vehicle: R2Vehicle, finish: RimFinishSpec, rim: Material): () => void {
  // The stem's origin is 155 mm out along it: this section runs from r 70 mm,
  // under the hub disc, to r 255 mm, under the lip.
  const section = finish.yArms ? null : new BoxGeometry(0.185, finish.spokeWidth, 0.03).translate(0.0075, 0, 0);
  const swapped: { mesh: Mesh; original: BufferGeometry }[] = [];
  const arms: { mesh: Mesh; visible: boolean }[] = [];
  const twins: Mesh[] = [];
  const step = Math.PI / 10;
  for (const wheel of vehicle.wheels) {
    for (const object of wheel.part.meshes) {
      const mesh = object as Mesh;
      const sub = (mesh.userData.subId as number) ?? 0;
      if (sub === 8) {
        arms.push({ mesh, visible: mesh.visible });
        mesh.visible = finish.yArms;
        continue;
      }
      if (sub !== 4) continue;
      if (section) {
        swapped.push({ mesh, original: mesh.geometry });
        mesh.geometry = section;
      }
      if (finish.twin) {
        // The spoke's origin sits 155 mm out along its own +x, so the wheel
        // centre is at (-0.155, 0) in its frame; the twin is that point's
        // rotation by one step, expressed where the spoke can see it.
        const twin = new Mesh(mesh.geometry, rim);
        twin.position.set(0.155 * Math.cos(step) - 0.155, 0.155 * Math.sin(step), 0);
        twin.rotation.z = step;
        twin.castShadow = true;
        twin.userData.showroomTwin = true;
        mesh.add(twin);
        twins.push(twin);
      }
    }
  }
  return () => {
    for (const twin of twins) twin.removeFromParent();
    for (const entry of arms) entry.mesh.visible = entry.visible;
    for (const entry of swapped) {
      if (entry.mesh.geometry === section) entry.mesh.geometry = entry.original;
    }
    section?.dispose();
  };
}

/**
 * Refit the wheels to a different rim diameter.
 *
 * A bigger wheel on a road car keeps the same rolling radius and trades
 * sidewall for rim, so the tyre profile is rebuilt around the new bead rather
 * than the whole assembly being scaled — scaling would move the contact patch
 * off the ground and change the ride height with the wheel option.
 *
 * The new tyre is the drawn one with its sidewall re-spanned: every profile
 * point under the shoulder keeps its share of the sidewall's height between the
 * new bead and the shoulder, and the shoulder and tread stay as drawn. Reading
 * the drawn profile, rather than a copy of it, keeps the refit true to
 * whichever model is vendored.
 */
export function fitWheelDiameter(vehicle: R2Vehicle, diameterInches: number): () => void {
  const rimRadius = (diameterInches * 0.0254) / 2;
  const k = rimRadius / SPEC.rimR;
  const drawn = vehicle.wheels
    .flatMap(wheel => wheel.part.meshes as Mesh[])
    .find(mesh => ((mesh.userData.subId as number) ?? 0) === 0);
  const points = (drawn?.geometry as LatheGeometry | undefined)?.parameters?.points;
  let tyre: LatheGeometry | undefined;
  if (points?.length) {
    const bead0 = Math.min(...points.map(point => point.x));
    const shoulder = SPEC.tireR - 0.025;
    // The bead sits 6 mm under the top of the 24 mm lip, as drawn.
    const bead1 = rimRadius + 0.018;
    const squeeze = (shoulder - bead1) / (shoulder - bead0);
    tyre = new LatheGeometry(points.map(point => new Vector2(
      point.x < shoulder ? shoulder - (shoulder - point.x) * squeeze : point.x,
      point.y,
    )), 96);
  }

  const previous: { mesh: Mesh; scale: [number, number, number]; position: [number, number, number] }[] = [];
  const tyreMeshes: { mesh: Mesh; geometry: Mesh["geometry"] }[] = [];
  for (const wheel of vehicle.wheels) {
    for (const object of wheel.part.meshes) {
      const mesh = object as Mesh;
      const sub = (mesh.userData.subId as number) ?? 0;
      if (sub === 0) {
        if (tyre) {
          tyreMeshes.push({ mesh, geometry: mesh.geometry });
          mesh.geometry = tyre;
        }
        continue;
      }
      previous.push({
        mesh,
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
      });
      if (sub === 1 || sub === 7) {
        // The barrel and the lip are turned on their side: radius is in local
        // X/Z, width in local Y, so the width must not follow the diameter.
        mesh.scale.set(k, 1, k);
      } else if (sub === 4 || sub === 8) {
        // Stems and arms sit in the wheel face plane on a polar layout.
        mesh.scale.set(k, k, 1);
        mesh.position.set(mesh.position.x * k, mesh.position.y * k, mesh.position.z);
      }
    }
  }

  return () => {
    // Put the drawing's own tyre back before dropping the refitted one, or the
    // wheels end up pointing at disposed geometry.
    for (const entry of tyreMeshes) entry.mesh.geometry = entry.geometry;
    tyre?.dispose();
    for (const entry of previous) {
      entry.mesh.scale.set(...entry.scale);
      entry.mesh.position.set(...entry.position);
    }
  };
}
