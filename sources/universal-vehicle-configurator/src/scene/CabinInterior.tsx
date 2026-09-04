import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color } from "three";
import type { LiveVehicleInterior } from "./live-vehicle.types";

/**
 * Procedural cabin for the Interior view.
 *
 * The licensed GLB ships exterior geometry only: it carries empty
 * `Grp_Interior` / `Grp_Interior_Dynamic` groups and a `Grp_Eyepoint_0` marker
 * at [0, 1.378, -0.371] but no cabin meshes. This builds one to the shell's own
 * measurements so the Interior view shows a real, orbitable room instead of a
 * material swatch floating over the bodywork.
 *
 * Model axes, read off the GLB: +X is forward, +Y up, Z is width (±0.94), and
 * the driver sits at -Z. The body spans x −2.12…2.10 with the roof at y 1.34,
 * so the cabin volume below is inset from that shell.
 */

const CABIN = {
  frontX: 1.18,
  rearX: -1.6,
  halfWidth: 0.82,
  floorY: 0.42,
  roofY: 1.42,
} as const;

const SEAT_Z = 0.37;

function roughnessFor(material: LiveVehicleInterior["material"]): number {
  if (material === "leather") return 0.46;
  if (material === "vegan-leather") return 0.58;
  return 0.9;
}

export function CabinInterior({
  interior,
  visible,
}: Readonly<{ interior: LiveVehicleInterior; visible: boolean }>) {
  const invalidate = useThree((state) => state.invalidate);

  const palette = useMemo(() => {
    const base = new Color(interior.color);
    const accent = new Color(interior.accentColor ?? "#a59c87");
    // Headliners run light in both catalog interiors, so lift rather than tint.
    const headliner = base.clone().lerp(new Color("#f2efe6"), 0.82);
    const panel = base.clone().lerp(new Color("#000000"), 0.18);
    const carpet = base.clone().lerp(new Color("#000000"), 0.42);
    return {
      base: `#${base.getHexString()}`,
      accent: `#${accent.getHexString()}`,
      headliner: `#${headliner.getHexString()}`,
      panel: `#${panel.getHexString()}`,
      carpet: `#${carpet.getHexString()}`,
    };
  }, [interior.accentColor, interior.color]);

  const roughness = roughnessFor(interior.material);

  // frameloop is "demand", so a colour or visibility change has to ask for a
  // frame or the cabin repaints only on the next camera move.
  useEffect(() => {
    invalidate();
  }, [invalidate, palette, roughness, visible]);

  if (!visible) return null;

  const seat = (z: number) => (
    <group key={z} position={[0, 0, z]}>
      <mesh position={[0.02, 0.53, 0]} castShadow>
        <boxGeometry args={[0.52, 0.1, 0.48]} />
        <meshStandardMaterial color={palette.base} roughness={roughness} metalness={0.02} />
      </mesh>
      <mesh position={[-0.26, 0.85, 0]} rotation-z={0.12} castShadow>
        <boxGeometry args={[0.14, 0.62, 0.48]} />
        <meshStandardMaterial color={palette.base} roughness={roughness} metalness={0.02} />
      </mesh>
      <mesh position={[-0.32, 1.2, 0]} castShadow>
        <boxGeometry args={[0.12, 0.17, 0.26]} />
        <meshStandardMaterial color={palette.base} roughness={roughness} metalness={0.02} />
      </mesh>
      {/* Piping picks up the accent so the two palettes read differently. */}
      <mesh position={[-0.19, 0.85, 0]} rotation-z={0.12}>
        <boxGeometry args={[0.015, 0.6, 0.5]} />
        <meshStandardMaterial color={palette.accent} roughness={0.55} metalness={0.06} />
      </mesh>
    </group>
  );

  return (
    <group name="cabin-interior">
      {/* Openings at the windscreen and side glass let the studio environment
          light the room, so no fake interior lamp is needed to see it. */}
      <ambientLight intensity={0.72} color="#eef2ec" />
      {/* Daylight through the windscreen, then a softer fill from the rear
          glass, so the room has a direction instead of a flat wash. */}
      <pointLight position={[1.35, 1.3, -0.1]} intensity={4.6} distance={5.2} decay={2} color="#fff4e2" />
      <pointLight position={[-1.15, 1.28, 0.2]} intensity={2.0} distance={4.0} decay={2} color="#dfeaf0" />
      <pointLight position={[0.2, 1.36, -0.55]} intensity={0.9} distance={2.6} decay={2} color="#ffffff" />

      {/* Floor and headliner */}
      <mesh position={[-0.21, CABIN.floorY, 0]} receiveShadow>
        <boxGeometry args={[2.78, 0.04, 1.64]} />
        <meshStandardMaterial color={palette.carpet} roughness={0.96} metalness={0.01} />
      </mesh>
      <mesh position={[-0.21, CABIN.roofY, 0]}>
        <boxGeometry args={[2.78, 0.04, 1.64]} />
        <meshStandardMaterial
          color={palette.headliner}
          roughness={0.94}
          metalness={0}
          emissive={palette.headliner}
          emissiveIntensity={0.16}
        />
      </mesh>

      {/* Door cards, with an accent armrest strip */}
      {[-CABIN.halfWidth, CABIN.halfWidth].map((z) => (
        <group key={z}>
          <mesh position={[-0.25, 0.78, z]} receiveShadow>
            <boxGeometry args={[2.5, 0.68, 0.05]} />
            <meshStandardMaterial color={palette.panel} roughness={roughness} metalness={0.03} />
          </mesh>
          <mesh position={[0.1, 1.0, z * 0.95]}>
            <boxGeometry args={[1.05, 0.05, 0.1]} />
            <meshStandardMaterial color={palette.accent} roughness={0.5} metalness={0.08} />
          </mesh>
        </group>
      ))}

      {/* Rear bulkhead */}
      <mesh position={[CABIN.rearX, 0.92, 0]}>
        <boxGeometry args={[0.05, 1.0, 1.64]} />
        <meshStandardMaterial color={palette.panel} roughness={roughness} metalness={0.02} />
      </mesh>

      {/* Dash: upper shelf and lower fascia */}
      <mesh position={[0.96, 0.92, 0]} castShadow>
        <boxGeometry args={[0.42, 0.14, 1.64]} />
        <meshStandardMaterial color={palette.panel} roughness={roughness} metalness={0.04} />
      </mesh>
      <mesh position={[0.92, 0.72, 0]}>
        <boxGeometry args={[0.3, 0.26, 1.64]} />
        <meshStandardMaterial color={palette.panel} roughness={roughness} metalness={0.04} />
      </mesh>

      {/* Landscape centre display plus a driver cluster behind the wheel,
          matching the R2's layout rather than the EX30's portrait tablet. */}
      <mesh position={[0.82, 1.0, 0.04]} rotation-y={-0.06}>
        <boxGeometry args={[0.03, 0.2, 0.42]} />
        <meshStandardMaterial
          color="#0a0c0d"
          roughness={0.22}
          metalness={0.3}
          emissive="#1b2c33"
          emissiveIntensity={0.62}
        />
      </mesh>
      <mesh position={[0.87, 1.02, -SEAT_Z]}>
        <boxGeometry args={[0.02, 0.11, 0.3]} />
        <meshStandardMaterial
          color="#0a0c0d"
          roughness={0.22}
          metalness={0.3}
          emissive="#1b2c33"
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Steering wheel and column, driver side */}
      <group position={[0.72, 0.94, -SEAT_Z]} rotation={[0, Math.PI / 2, 0.32]}>
        <mesh castShadow>
          <torusGeometry args={[0.175, 0.022, 12, 40]} />
          <meshStandardMaterial color="#1a1d1e" roughness={0.52} metalness={0.14} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.3, 0.035, 0.02]} />
          <meshStandardMaterial color="#1a1d1e" roughness={0.52} metalness={0.14} />
        </mesh>
      </group>
      <mesh position={[0.83, 0.91, -SEAT_Z]} rotation-z={Math.PI / 2 - 0.32}>
        <cylinderGeometry args={[0.028, 0.032, 0.2, 12]} />
        <meshStandardMaterial color="#15181a" roughness={0.6} metalness={0.1} />
      </mesh>

      {/* Centre console */}
      <mesh position={[0.38, 0.55, 0]} castShadow>
        <boxGeometry args={[0.85, 0.26, 0.3]} />
        <meshStandardMaterial color={palette.panel} roughness={roughness} metalness={0.05} />
      </mesh>

      {/* Front seats and rear bench */}
      {[-SEAT_Z, SEAT_Z].map((z) => seat(z))}
      <mesh position={[-0.95, 0.53, 0]} castShadow>
        <boxGeometry args={[0.52, 0.1, 1.34]} />
        <meshStandardMaterial color={palette.base} roughness={roughness} metalness={0.02} />
      </mesh>
      <mesh position={[-1.25, 0.82, 0]} rotation-z={0.1} castShadow>
        <boxGeometry args={[0.14, 0.58, 1.34]} />
        <meshStandardMaterial color={palette.base} roughness={roughness} metalness={0.02} />
      </mesh>
    </group>
  );
}

export default CabinInterior;
