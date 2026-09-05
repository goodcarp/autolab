import { Box3, type Material, Mesh, type Object3D } from "three";

export const SCAN_DURATION_MS = 1100;

type WireMaterial = Material & { wireframe: boolean };

export interface PresentationScan {
  readonly progress: number;
  readonly active: boolean;
  attach(): void;
  setBlueprint(blueprint: boolean, reducedMotion: boolean, now: number): void;
  /** Returns true only while another animation frame is needed. */
  advance(now: number): boolean;
  dispose(): void;
}

/**
 * Two complementary material passes, sharing the original geometry. Wrapping
 * (rather than replacing) the shell hook keeps apertures, flake and cavities on
 * both halves. The extra wire meshes draw only during a transition; settled
 * states use exactly the original materials and their original wireframe flag.
 */
export function createPresentationScan(roots: Object3D[], materials: Material[]): PresentationScan {
  const enabled = { value: 0 };
  const front = { value: 0 };
  const bounds = new Box3().setFromObject(roots[0]);
  const minX = bounds.min.x - 0.05;
  const maxX = bounds.max.x + 0.05;
  const originals = [...new Set(materials)] as WireMaterial[];
  const wireMaterials = new Map<Material, WireMaterial>();
  const restoreHooks: (() => void)[] = [];
  const attachHooks: (() => void)[] = [];
  const pairs: { source: Mesh; wire: Mesh }[] = [];
  let progress = 0;
  let target = 0;
  let from = 0;
  let started = 0;
  let active = false;

  for (const solid of originals) {
    const compile = solid.onBeforeCompile;
    const cacheKey = solid.customProgramCacheKey;
    // Evaluate before replacing onBeforeCompile: the default key reads it.
    const originalKey = cacheKey.call(solid);
    const wire = solid.clone() as WireMaterial;
    wire.wireframe = true;
    wireMaterials.set(solid, wire);
    for (const [material, wirePass] of [[solid, false], [wire, true]] as const) {
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        shader.uniforms.uScanEnabled = enabled;
        shader.uniforms.uScanFront = front;
        shader.vertexShader = `varying float vScanX;\n${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvScanX = (modelMatrix * vec4(transformed, 1.0)).x;",
        );
        shader.fragmentShader = `varying float vScanX;\nuniform float uScanEnabled;\nuniform float uScanFront;\n${shader.fragmentShader}`.replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>\nif (uScanEnabled > 0.5 && vScanX ${wirePass ? ">" : "<="} uScanFront) discard;`,
        ).replace(
          "#include <tonemapping_fragment>",
          "if (uScanEnabled > 0.5 && abs(vScanX - uScanFront) < 0.022) gl_FragColor.rgb += vec3(0.57, 1.0, 0.04);\n#include <tonemapping_fragment>",
        );
      };
      material.customProgramCacheKey = () => `${originalKey}-scan-${wirePass ? "wire" : "solid"}`;
      material.needsUpdate = true;
      const scanCompile = material.onBeforeCompile;
      const scanKey = material.customProgramCacheKey;
      attachHooks.push(() => {
        material.onBeforeCompile = scanCompile;
        material.customProgramCacheKey = scanKey;
        material.needsUpdate = true;
      });
    }
    restoreHooks.push(() => {
      solid.onBeforeCompile = compile;
      solid.customProgramCacheKey = cacheKey;
      solid.needsUpdate = true;
    });
  }

  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      if (!sources.every((material) => wireMaterials.has(material))) return;
      const mapped = sources.map((material) => wireMaterials.get(material)!);
      const wire = new Mesh(object.geometry, Array.isArray(object.material) ? mapped : mapped[0]);
      wire.name = "PresentationScanWire";
      wire.visible = false;
      wire.raycast = () => {};
      pairs.push({ source: object, wire });
    });
  }

  function apply() {
    enabled.value = active ? 1 : 0;
    front.value = minX + (maxX - minX) * progress;
    for (const solid of originals) solid.wireframe = !active && target === 1;
    for (const { source, wire } of pairs) {
      // Wheel refits replace the source geometry after dressing.
      wire.geometry = source.geometry;
      wire.visible = active;
    }
  }

  function advance(now: number) {
    if (!active) return false;
    const distance = Math.max(0, now - started) / SCAN_DURATION_MS;
    progress = from + Math.sign(target - from) * Math.min(Math.abs(target - from), distance);
    active = progress !== target;
    apply();
    return active;
  }

  return {
    get progress() { return progress; },
    get active() { return active; },
    attach() {
      // React StrictMode replays setup after cleanup in development. Disposed
      // materials can upload again, but their scan hooks must be restored too.
      for (const attach of attachHooks) attach();
      for (const { source, wire } of pairs) source.add(wire);
      apply();
    },
    setBlueprint(blueprint, reducedMotion, now) {
      advance(now);
      const next = blueprint ? 1 : 0;
      if (next === target && !reducedMotion) return;
      target = next;
      from = progress;
      started = now;
      active = !reducedMotion && progress !== target;
      if (!active) progress = target;
      for (const [solid, wire] of wireMaterials) {
        // Keep a repaint or cabin choice made since the previous scan.
        wire.copy(solid);
        wire.wireframe = true;
      }
      apply();
    },
    advance,
    dispose() {
      for (const { wire } of pairs) wire.removeFromParent();
      for (const wire of wireMaterials.values()) wire.dispose();
      for (const restore of restoreHooks) restore();
      // Geometry belongs to the source, never to its extra scan pass.
    },
  };
}
