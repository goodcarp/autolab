import { RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  CatmullRomCurve3,
  InstancedMesh,
  type Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import type {
  LiveVehicleAccessories,
  LiveVehicleFocus,
  LiveVehiclePaint,
  LiveVehicleWheel,
} from "./live-vehicle.types";
import { createLoftGeometry, type LoftStation } from "./vehicle-geometry";
import { getWheelVisualProfile } from "./vehicle-visuals";

const BODY_STATIONS = [
  { x: -2.24, bottom: 0.40, shoulder: 1.04, top: 1.13, halfWidth: 0.67 },
  { x: -2.06, bottom: 0.31, shoulder: 1.22, top: 1.34, halfWidth: 0.83 },
  { x: -1.55, bottom: 0.27, shoulder: 1.29, top: 1.39, halfWidth: 0.89 },
  { x: -0.55, bottom: 0.26, shoulder: 1.31, top: 1.41, halfWidth: 0.92 },
  { x: 0.45, bottom: 0.27, shoulder: 1.30, top: 1.40, halfWidth: 0.91 },
  { x: 1.12, bottom: 0.28, shoulder: 1.24, top: 1.34, halfWidth: 0.87 },
  { x: 1.76, bottom: 0.33, shoulder: 1.08, top: 1.19, halfWidth: 0.77 },
  { x: 2.20, bottom: 0.44, shoulder: 0.94, top: 1.04, halfWidth: 0.60 },
] as const satisfies readonly LoftStation[];

const CLADDING_STATIONS = BODY_STATIONS.map((station) => ({
  ...station,
  shoulder: Math.min(station.shoulder, 0.69),
  top: Math.min(station.top, 0.76),
  halfWidth: station.halfWidth + 0.012,
}));

const GLASSHOUSE_STATIONS = [
  { x: -1.72, bottom: 1.29, shoulder: 1.52, top: 1.61, halfWidth: 0.58 },
  { x: -1.45, bottom: 1.31, shoulder: 1.72, top: 1.82, halfWidth: 0.69 },
  { x: -0.72, bottom: 1.34, shoulder: 1.78, top: 1.87, halfWidth: 0.73 },
  { x: 0.10, bottom: 1.34, shoulder: 1.77, top: 1.85, halfWidth: 0.70 },
  { x: 0.55, bottom: 1.31, shoulder: 1.62, top: 1.73, halfWidth: 0.62 },
  { x: 0.82, bottom: 1.29, shoulder: 1.41, top: 1.50, halfWidth: 0.49 },
] as const satisfies readonly LoftStation[];

const ROOF_STATIONS = [
  { x: -1.48, bottom: 1.78, shoulder: 1.83, top: 1.86, halfWidth: 0.62 },
  { x: -0.82, bottom: 1.84, shoulder: 1.88, top: 1.91, halfWidth: 0.66 },
  { x: 0.00, bottom: 1.82, shoulder: 1.86, top: 1.89, halfWidth: 0.64 },
  { x: 0.48, bottom: 1.69, shoulder: 1.73, top: 1.77, halfWidth: 0.56 },
] as const satisfies readonly LoftStation[];

function LoftSurface({
  name,
  stations,
  material,
  castShadow = true,
}: Readonly<{
  name: string;
  stations: readonly LoftStation[];
  material: Material;
  castShadow?: boolean;
}>) {
  const geometry = useMemo(() => createLoftGeometry(stations), [stations]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name={name} geometry={geometry} material={material} castShadow={castShadow} />;
}

function Spokes({
  count,
  length,
  width,
  color,
  outward,
}: Readonly<{
  count: number;
  length: number;
  width: number;
  color: string;
  outward: 1 | -1;
}>) {
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instance = mesh.current;
    if (!instance) return;
    const dummy = new Object3D();
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      dummy.position.set(
        Math.cos(angle) * length * 0.46,
        Math.sin(angle) * length * 0.46,
        outward * 0.102,
      );
      dummy.rotation.set(0, 0, angle - Math.PI / 2);
      dummy.scale.set(width, length, 0.018);
      dummy.updateMatrix();
      instance.setMatrixAt(index, dummy.matrix);
    }
    instance.instanceMatrix.needsUpdate = true;
  }, [count, length, outward, width]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.82} roughness={0.2} />
    </instancedMesh>
  );
}

function WheelAssembly({
  position,
  outward,
  wheel,
  focused,
}: Readonly<{
  position: readonly [number, number, number];
  outward: 1 | -1;
  wheel: LiveVehicleWheel;
  focused: boolean;
}>) {
  const profile = getWheelVisualProfile(wheel);
  const faceZ = outward * 0.072;
  const tireTube = profile.radius * (wheel.style === "terrain" ? 0.205 : 0.175);
  const tireMajor = profile.radius - tireTube;

  return (
    <group position={position}>
      <mesh scale-z={wheel.style === "terrain" ? 1.58 : 1.45} castShadow>
        <torusGeometry args={[tireMajor, tireTube, 14, 56]} />
        <meshStandardMaterial color="#121613" roughness={profile.tireRoughness} metalness={0.01} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position-z={faceZ}>
        <cylinderGeometry args={[profile.rimRadius * 0.67, profile.rimRadius * 0.67, 0.035, 40]} />
        <meshStandardMaterial color="#59605c" metalness={0.72} roughness={0.32} />
      </mesh>
      <mesh position-z={faceZ + outward * 0.012}>
        <torusGeometry args={[profile.rimRadius * 0.82, profile.rimRadius * 0.14, 10, 48]} />
        <meshStandardMaterial color={profile.rimColor} metalness={0.88} roughness={0.2} />
      </mesh>
      <Spokes
        count={profile.spokeCount}
        length={profile.spokeLength}
        width={profile.spokeWidth}
        color={profile.rimColor}
        outward={outward}
      />
      <mesh rotation-x={Math.PI / 2} position-z={faceZ + outward * 0.042}>
        <cylinderGeometry args={[profile.rimRadius * 0.13, profile.rimRadius * 0.13, 0.05, 28]} />
        <meshStandardMaterial color="#202521" metalness={0.82} roughness={0.22} />
      </mesh>
      {focused && (
        <mesh position-z={faceZ + outward * 0.065}>
          <torusGeometry args={[profile.radius * 1.09, 0.014, 10, 64]} />
          <meshBasicMaterial color="#c7ff39" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function FenderArches({ material }: Readonly<{ material: Material }>) {
  return (
    <>
      {([-1, 1] as const).flatMap((side) => (
        [-1.47, 1.47].map((x) => (
          <mesh
            key={`${side}:${x}`}
            position={[x, 0.42, side * 0.922]}
            material={material}
            castShadow
          >
            <torusGeometry args={[0.46, 0.035, 10, 44, Math.PI]} />
          </mesh>
        ))
      ))}
    </>
  );
}

function BodyCharacterLine({ side }: Readonly<{ side: 1 | -1 }>) {
  const curve = useMemo(() => new CatmullRomCurve3([
    new Vector3(-2.02, 1.03, side * 0.79),
    new Vector3(-1.45, 1.17, side * 0.90),
    new Vector3(-0.35, 1.20, side * 0.925),
    new Vector3(0.72, 1.18, side * 0.90),
    new Vector3(1.62, 1.03, side * 0.78),
  ]), [side]);

  return (
    <mesh>
      <tubeGeometry args={[curve, 36, 0.007, 5, false]} />
      <meshStandardMaterial
        color="#e5ece6"
        metalness={0.48}
        roughness={0.25}
        transparent
        opacity={0.2}
      />
    </mesh>
  );
}

function Beltline({ side }: Readonly<{ side: 1 | -1 }>) {
  const curve = useMemo(() => new CatmullRomCurve3([
    new Vector3(-1.68, 1.31, side * 0.716),
    new Vector3(-0.75, 1.34, side * 0.748),
    new Vector3(0.12, 1.34, side * 0.724),
    new Vector3(0.75, 1.29, side * 0.545),
  ]), [side]);

  return (
    <mesh>
      <tubeGeometry args={[curve, 28, 0.012, 6, false]} />
      <meshStandardMaterial color="#87918b" metalness={0.82} roughness={0.25} />
    </mesh>
  );
}

function GlassDetails() {
  return (
    <>
      {([-1, 1] as const).map((side) => (
        <group key={side}>
          <Beltline side={side} />
          <mesh position={[-0.33, 1.59, side * 0.735]} rotation-z={-0.015}>
            <boxGeometry args={[0.045, 0.51, 0.025]} />
            <meshStandardMaterial color="#070c0b" roughness={0.32} />
          </mesh>
          <mesh position={[-1.15, 1.57, side * 0.704]} rotation-z={0.13}>
            <boxGeometry args={[0.055, 0.47, 0.025]} />
            <meshStandardMaterial color="#070c0b" roughness={0.32} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function BodyDetails({
  focus,
  paintMaterial,
}: Readonly<{ focus: LiveVehicleFocus; paintMaterial: Material }>) {
  return (
    <>
      <RoundedBox args={[0.018, 0.035, 1.05]} radius={0.012} smoothness={3} position={[2.208, 1.005, 0]}>
        <meshStandardMaterial color="#effaf3" emissive="#d9fff1" emissiveIntensity={1.35} />
      </RoundedBox>
      {([-1, 1] as const).map((side) => (
        <RoundedBox
          key={`front-lamp-${side}`}
          args={[0.02, 0.22, 0.042]}
          radius={0.018}
          smoothness={4}
          position={[2.211, 0.86, side * 0.48]}
        >
          <meshStandardMaterial color="#f0fff8" emissive="#c9ffe8" emissiveIntensity={1.45} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.018, 0.04, 1.18]} radius={0.014} smoothness={3} position={[-2.208, 1.09, 0]}>
        <meshStandardMaterial color="#d33b31" emissive="#ff382b" emissiveIntensity={1.4} />
      </RoundedBox>
      <RoundedBox args={[0.028, 0.14, 1.25]} radius={0.025} smoothness={3} position={[2.207, 0.67, 0]}>
        <meshStandardMaterial color="#202622" metalness={0.02} roughness={0.68} />
      </RoundedBox>
      <RoundedBox args={[0.028, 0.14, 1.30]} radius={0.025} smoothness={3} position={[-2.207, 0.65, 0]}>
        <meshStandardMaterial color="#222824" metalness={0.02} roughness={0.68} />
      </RoundedBox>

      {([-1, 1] as const).map((side) => (
        <group key={`side-detail-${side}`} position-z={side * 0.925}>
          <mesh position={[-0.18, 1.02, 0]}>
            <boxGeometry args={[0.014, 0.48, 0.018]} />
            <meshStandardMaterial color="#26302b" roughness={0.48} />
          </mesh>
          <mesh position={[-1.10, 1.00, 0]} rotation-z={0.025}>
            <boxGeometry args={[0.014, 0.46, 0.018]} />
            <meshStandardMaterial color="#26302b" roughness={0.48} />
          </mesh>
          <RoundedBox args={[0.28, 0.045, 0.025]} radius={0.02} smoothness={2} position={[-0.62, 1.19, 0]}>
            <meshStandardMaterial color="#18201b" metalness={0.5} roughness={0.28} />
          </RoundedBox>
        </group>
      ))}

      <group position={[1.03, 1.12, 0.862]}>
        <RoundedBox args={[0.215, 0.205, 0.008]} radius={0.04} smoothness={3}>
          <meshStandardMaterial
            color={focus === "charge-port" ? "#c7ff39" : "#17201c"}
            emissive={focus === "charge-port" ? "#87ad25" : "#000000"}
            emissiveIntensity={focus === "charge-port" ? 1.1 : 0}
            roughness={0.5}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.19, 0.18, 0.008]}
          radius={0.035}
          smoothness={3}
          position-z={0.009}
          material={paintMaterial}
        />
      </group>
    </>
  );
}

function TowHitch({ focused }: Readonly<{ focused: boolean }>) {
  return (
    <group position={[-2.31, 0.43, 0]}>
      <mesh>
        <boxGeometry args={[0.34, 0.10, 0.14]} />
        <meshStandardMaterial
          color={focused ? "#c7ff39" : "#242a26"}
          emissive={focused ? "#789d18" : "#000000"}
          emissiveIntensity={focused ? 1.5 : 0}
          metalness={0.78}
          roughness={0.3}
        />
      </mesh>
      <mesh position-x={-0.20}>
        <boxGeometry args={[0.13, 0.17, 0.20]} />
        <meshStandardMaterial color="#151916" metalness={0.74} roughness={0.34} />
      </mesh>
      <mesh position={[-0.29, -0.07, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.095, 0.025, 10, 28]} />
        <meshStandardMaterial color="#353c37" metalness={0.82} roughness={0.28} />
      </mesh>
    </group>
  );
}

export type VehicleModelProps = Readonly<{
  paint: LiveVehiclePaint;
  wheel: LiveVehicleWheel;
  accessories: LiveVehicleAccessories;
  focus: LiveVehicleFocus;
}>;

/**
 * Semantic vehicle rendering boundary. The procedural concept implements the
 * same named systems expected from a qualified GLB: body paint, glasshouse,
 * four wheel groups, charge port and hitch. A production asset can replace the
 * internals without changing the scene or application contracts.
 */
export function VehicleModel({ paint, wheel, accessories, focus }: VehicleModelProps) {
  const paintMaterial = useMemo(() => new MeshPhysicalMaterial({
    color: paint.color,
    emissive: focus === "paint" ? paint.color : "#000000",
    emissiveIntensity: focus === "paint" ? 0.07 : 0,
    metalness: 0.08,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.45,
    sheen: 0.12,
    sheenColor: "#dfe8e0",
    sheenRoughness: 0.62,
  }), [focus, paint.color]);
  const glassMaterial = useMemo(() => new MeshPhysicalMaterial({
    color: "#263d43",
    metalness: 0.14,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transmission: 0.04,
    thickness: 0.08,
    envMapIntensity: 2.2,
  }), []);
  const claddingMaterial = useMemo(() => new MeshStandardMaterial({
    color: "#202622",
    metalness: 0.03,
    roughness: 0.68,
  }), []);

  useEffect(() => () => paintMaterial.dispose(), [paintMaterial]);
  useEffect(() => () => glassMaterial.dispose(), [glassMaterial]);
  useEffect(() => () => claddingMaterial.dispose(), [claddingMaterial]);

  const wheelPositions = useMemo(() => [
    { position: [1.47, 0.42, 0.82] as const, outward: 1 as const, front: true },
    { position: [1.47, 0.42, -0.82] as const, outward: -1 as const, front: true },
    { position: [-1.47, 0.42, 0.82] as const, outward: 1 as const, front: false },
    { position: [-1.47, 0.42, -0.82] as const, outward: -1 as const, front: false },
  ], []);

  return (
    <group name="VehicleRoot">
      <LoftSurface name="BodyPaint" stations={BODY_STATIONS} material={paintMaterial} />
      <LoftSurface name="LowerCladding" stations={CLADDING_STATIONS} material={claddingMaterial} />
      <LoftSurface name="Glasshouse" stations={GLASSHOUSE_STATIONS} material={glassMaterial} />
      <LoftSurface name="BodyPaint_Roof" stations={ROOF_STATIONS} material={paintMaterial} />
      <FenderArches material={claddingMaterial} />
      <BodyCharacterLine side={1} />
      <BodyCharacterLine side={-1} />
      <GlassDetails />
      <BodyDetails focus={focus} paintMaterial={paintMaterial} />

      {wheelPositions.map(({ position, outward, front }) => (
        <WheelAssembly
          key={position.join(":")}
          position={position}
          outward={outward}
          wheel={wheel}
          focused={focus === "wheels" && front && outward === 1}
        />
      ))}

      {accessories.towHitch && <TowHitch focused={focus === "utility"} />}
    </group>
  );
}
