import {
  Color,
  DoubleSide,
  type Group,
  LatheGeometry,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
} from "three";
import { buildDetailGroup } from "./detail";
import { cutGLSL } from "./geom.js";
import { CUT, SPEC, type R2Vehicle } from "./vehicle.js";

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
  /** Second body colour for the roof on two-tone paints; null keeps it single. */
  roofColor?: string | null;
  rimFinish: RimFinish;
  caliperColor: string;
  cabinColor: string;
  lampsOn: boolean;
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
  // Sub 1 is the backlight: the greenhouse's own section lofted on aft of where
  // the greenhouse itself stops. On paint it is a body-coloured panel filling
  // the bottom of the rear window, with a hard seam where the two meet.
  "tailgate#1": "glass",
  "tailgate#3": "trim",
  "tailgate#4": "chrome",
  "tailgate#5": "chrome",
  "tailgate#6": "trim",
  "tailgate#7": "reflector",
  // Each door carries its own glazing and trim, so a door is not one material.
  // Sub 1 is the window panel: leaving it on paint puts a body-coloured
  // rectangle over every window, sitting proud of the greenhouse behind it.
  doorFL: "paint",
  "doorFL#1": "glass",
  "doorFL#3": "cabin",
  "doorFL#4": "cabinDark",
  "doorFL#5": "paint",
  "doorFL#6": "gloss",
  doorFR: "paint",
  "doorFR#1": "glass",
  "doorFR#3": "cabin",
  "doorFR#4": "cabinDark",
  "doorFR#5": "paint",
  "doorFR#6": "gloss",
  doorRL: "paint",
  "doorRL#1": "glass",
  "doorRL#3": "cabin",
  "doorRL#4": "cabinDark",
  "doorRL#5": "paint",
  doorRR: "paint",
  "doorRR#1": "glass",
  "doorRR#3": "cabin",
  "doorRR#4": "cabinDark",
  "doorRR#5": "paint",
  chargePort: "paint",

  // glasshouse
  greenhouse: "glass",
  roofGlass: "roof",
  "roofGlass#1": "trim",
  "roofGlass#2": "tailEmitter",
  "roofGlass#3": "paint",
  pillars: "gloss",
  "pillars#5": "glass",

  // lower body
  cladding: "cladding",
  fasciaFront: "trim",
  "fasciaFront#1": "gloss",
  "fasciaFront#2": "skid",
  "fasciaFront#3": "sensor",
  "fasciaFront#4": "sensor",
  fasciaRear: "trim",
  "fasciaRear#1": "skid",
  "fasciaRear#3": "reflector",

  // lamps — the lens is a separate part from what lights it
  headlamps: "lampLens",
  "headlamps#1": "lampEmitter",
  lightBar: "lampEmitter",
  "lightBar#1": "lampEmitter",
  tailPills: "tailEmitter",
  "tailPills#1": "gloss",
  "tailPills#2": "paint",
  "tailPills#3": "trim",

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

/** Wheels share one part per corner, so the rim/tyre split is by sub-id. */
const WHEEL_ROLE: Record<number, Role> = {
  0: "tyre",
  1: "rim",
  2: "rim",
  3: "rim",
  4: "rim",
  5: "rimPocket",
  6: "lug",
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
const RIM_FINISH: Record<RimFinish, { color: string; metalness: number; roughness: number }> = {
  tungsten: { color: "#6e767b", metalness: 0.92, roughness: 0.33 },
  blackSand: { color: "#2a2e30", metalness: 0.86, roughness: 0.46 },
  bicolor: { color: "#8e979c", metalness: 0.96, roughness: 0.23 },
  graphite: { color: "#575f63", metalness: 0.94, roughness: 0.30 },
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
function patchShell<T extends Material>(material: T, aperture: boolean, cavity = false): T {
  material.onBeforeCompile = (shader) => {
    if (aperture) {
      shader.vertexShader = `varying vec3 vObjPos;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\tvObjPos = position;",
      );
      shader.fragmentShader =
        `varying vec3 vObjPos;\n${cutGLSL(CUT)}\n${shader.fragmentShader}`.replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\n\tif (inAperture(vObjPos)) discard;",
        );
    }
    if (cavity) {
      // Before tone mapping, so the factor is a real drop in radiance rather
      // than a multiply against an already display-encoded value.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        "\tif (!gl_FrontFacing) gl_FragColor.rgb *= 0.16;\n#include <tonemapping_fragment>",
      );
    }
  };
  // Each combination must have its own compiled program, or whichever compiles
  // first decides whether the apertures and the cavity exist for all of them.
  material.customProgramCacheKey = () =>
    `r2-shell${aperture ? "-cut" : ""}${cavity ? "-cavity" : ""}`;
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
  for (const material of Object.values(materials)) {
    material.side = DoubleSide;
    patchShell(material, false);
  }
  return materials;
}

function buildMaterials(options: ShowroomOptions): Record<Role, Material> {
  const rim = RIM_FINISH[options.rimFinish] ?? RIM_FINISH.tungsten;
  const lamp = options.lampsOn ? 1 : 0;

  // Automotive paint is a metallic basecoat under a smooth dielectric layer.
  // The clearcoat is what separates it from coloured plastic: a second, much
  // tighter specular lobe that survives at grazing angles.
  const paint = new MeshPhysicalMaterial({
    color: new Color(options.paintColor),
    metalness: 0.42,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.85,
    side: DoubleSide,
  });

  const roofPaint = new MeshPhysicalMaterial({
    color: new Color(options.roofColor ?? "#0e1215"),
    metalness: 0.08,
    roughness: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.4,
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
      color: new Color("#171a1b"),
      metalness: 0.15,
      roughness: 0.62,
      envMapIntensity: 0.85,
      side: DoubleSide,
    }),
    // Structural-grain composite: rougher and flatter than the bumper skin, so
    // the two-tone break reads even in a single-colour environment.
    cladding: new MeshStandardMaterial({
      color: new Color("#101314"),
      metalness: 0.05,
      roughness: 0.88,
      envMapIntensity: 0.55,
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
      color: new Color("#141c21"),
      metalness: 0.02,
      roughness: 0.045,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.52,
      envMapIntensity: 2.1,
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
      emissive: new Color("#bcdcff"),
      // Held below full blow-out. These are daytime running lamps in a lit
      // studio, not headlights on main beam at night, and untoned emissive at
      // 3+ turns the whole lamp into a white slab with no visible internals.
      emissiveIntensity: 0.3 + lamp * 1.45,
      metalness: 0.1,
      roughness: 0.2,
      toneMapped: false,
    }),
    tailEmitter: new MeshStandardMaterial({
      color: new Color("#7a0f0c"),
      emissive: new Color("#ff2a18"),
      emissiveIntensity: 0.45 + lamp * 1.35,
      metalness: 0.1,
      roughness: 0.25,
      toneMapped: false,
      side: DoubleSide,
    }),
    reflector: new MeshStandardMaterial({
      color: new Color("#8e1410"),
      emissive: new Color("#5c0a06"),
      emissiveIntensity: 0.4,
      roughness: 0.3,
    }),
    // Rubber: no reflection to speak of, and darker on the sidewall than the
    // tread. One roughness value across both is what makes tyres read as vinyl.
    tyre: new MeshStandardMaterial({
      color: new Color("#0c0e0f"),
      metalness: 0,
      roughness: 0.95,
      envMapIntensity: 0.3,
    }),
    rim: new MeshStandardMaterial({
      color: new Color(rim.color),
      metalness: rim.metalness,
      roughness: rim.roughness,
      envMapIntensity: 1.5,
      side: DoubleSide,
    }),
    rimPocket: new MeshStandardMaterial({
      color: new Color("#26292b"),
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
      metalness: 0.35,
      roughness: 0.3,
      clearcoat: 0.7,
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
  materials: Record<Role, Material>;
  paint: MeshPhysicalMaterial;
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
  const base = buildMaterials(options);
  // Every material needs a cut twin, because the same paint appears on both cut
  // shells and uncut panels.
  const cutTwins = new Map<Material, Material>();
  const cutVariant = (material: Material, cavity: boolean) => {
    const existing = cutTwins.get(material);
    if (existing) return existing;
    const twin = patchShell(material.clone(), true, cavity);
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
      vehicle.hidden.add(part.name);
      part.group.visible = false;
      continue;
    }
    for (const object of part.meshes) {
      const mesh = object as Mesh;
      const sub = (mesh.userData.subId as number) ?? 0;
      const role: Role = part.category === "running"
        ? WHEEL_ROLE[sub] ?? "rim"
        : ROLE_BY_MESH[`${part.name}#${sub}`] ?? ROLE_BY_MESH[part.name] ?? "trim";
      const material = base[role];
      mesh.material = mesh.userData.cut ? cutVariant(material, role === "paint") : material;
      mesh.castShadow = part.category !== "interior";
      mesh.receiveShadow = false;
    }
  }

  // Lamp internals are a showroom concern, so they are built here rather than
  // pushed back into the engineering source. Attaching is the caller's job.
  const detail = buildDetailGroup({
    reflector: base.chrome,
    emitter: base.lampEmitter,
    bezel: base.gloss,
  });

  return {
    materials: base,
    paint: base.paint as MeshPhysicalMaterial,
    caliper: base.caliper as MeshPhysicalMaterial,
    cabin: base.cabin as MeshStandardMaterial,
    detail,
    forEachMaterial(fn) {
      for (const material of Object.values(base)) fn(material);
      for (const material of cutTwins.values()) fn(material);
    },
    dispose() {
      detail.removeFromParent();
      (detail.userData.dispose as (() => void) | undefined)?.();
      for (const material of Object.values(base)) material.dispose();
      for (const material of cutTwins.values()) material.dispose();
    },
  };
}

/**
 * Refit the wheels to a different rim diameter.
 *
 * A bigger wheel on a road car keeps the same rolling radius and trades
 * sidewall for rim, so the tyre profile is rebuilt around the new bead rather
 * than the whole assembly being scaled — scaling would move the contact patch
 * off the ground and change the ride height with the wheel option.
 */
export function fitWheelDiameter(vehicle: R2Vehicle, diameterInches: number): () => void {
  const rimRadius = (diameterInches * 0.0254) / 2;
  const k = rimRadius / SPEC.rimR;
  const bead = rimRadius + 0.014;
  const r = SPEC.tireR;
  const hw = SPEC.tireW / 2;
  const profile = [
    [bead, hw - 0.025],
    [bead + 0.062, hw],
    [bead + 0.107, hw],
    [r - 0.008, hw - 0.012],
    [r, hw - 0.03],
    [r, -(hw - 0.03)],
    [r - 0.008, -(hw - 0.012)],
    [bead + 0.107, -hw],
    [bead + 0.062, -hw],
    [bead, -(hw - 0.025)],
  ].map(([a, b]) => new Vector2(a, b));
  const tyre = new LatheGeometry(profile, 60);

  const previous: { mesh: Mesh; scale: [number, number, number]; position: [number, number, number] }[] = [];
  const tyreMeshes: { mesh: Mesh; geometry: Mesh["geometry"] }[] = [];
  for (const wheel of vehicle.wheels) {
    for (const object of wheel.part.meshes) {
      const mesh = object as Mesh;
      const sub = (mesh.userData.subId as number) ?? 0;
      if (sub === 0) {
        tyreMeshes.push({ mesh, geometry: mesh.geometry });
        mesh.geometry = tyre;
        continue;
      }
      previous.push({
        mesh,
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
      });
      if (sub === 1) {
        // The barrel is a cylinder lying on its side: radius is in local X/Z,
        // width in local Y, so the width must not follow the diameter.
        mesh.scale.set(k, 1, k);
      } else if (sub === 4 || sub === 5) {
        // Spokes and pockets sit in the wheel face plane on a polar layout.
        mesh.scale.set(k, k, 1);
        mesh.position.set(mesh.position.x * k, mesh.position.y * k, mesh.position.z);
      }
    }
  }

  return () => {
    // Put the drawing's own tyre back before dropping the refitted one, or the
    // wheels end up pointing at disposed geometry.
    for (const entry of tyreMeshes) entry.mesh.geometry = entry.geometry;
    tyre.dispose();
    for (const entry of previous) {
      entry.mesh.scale.set(...entry.scale);
      entry.mesh.position.set(...entry.position);
    }
  };
}
