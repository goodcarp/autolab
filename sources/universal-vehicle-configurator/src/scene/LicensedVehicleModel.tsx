import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import type { Group } from "three";
import type {
  LiveVehicleAccessories,
  LiveVehicleFocus,
  LiveVehiclePaint,
  LiveVehicleRenderMode,
  LiveVehicleWheel,
} from "./live-vehicle.types";
import {
  applyLicensedVehicleConfiguration,
  cloneLicensedVehicleScene,
  createLicensedVehicleBlueprintEdges,
  disposeLicensedVehicleBlueprintEdges,
  disposeLicensedVehicleMaterials,
} from "./licensed-vehicle-mapping";

const MODEL_URL = `${import.meta.env.BASE_URL}models/openx-volvo-ex30-2024.glb`;

function ConfiguredTowHitch({ focused }: Readonly<{ focused: boolean }>) {
  return (
    <group name="ConfiguredTowHitch" position={[-2.2, 0.26, 0]}>
      <mesh>
        <boxGeometry args={[0.3, 0.09, 0.13]} />
        <meshStandardMaterial
          color={focused ? "#c7ff39" : "#242a26"}
          emissive={focused ? "#789d18" : "#000000"}
          emissiveIntensity={focused ? 1.25 : 0}
          metalness={0.76}
          roughness={0.32}
        />
      </mesh>
      <mesh position-x={-0.18}>
        <boxGeometry args={[0.12, 0.15, 0.18]} />
        <meshStandardMaterial color="#151916" metalness={0.72} roughness={0.36} />
      </mesh>
      <mesh position={[-0.27, -0.06, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.085, 0.023, 10, 28]} />
        <meshStandardMaterial color="#353c37" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

function WheelFocusRing() {
  return (
    <mesh name="WheelFocus" position={[1.381, 0.361, 0.94]}>
      <torusGeometry args={[0.4, 0.014, 10, 64]} />
      <meshBasicMaterial color="#c7ff39" toneMapped={false} />
    </mesh>
  );
}

export type LicensedVehicleModelProps = Readonly<{
  paint: LiveVehiclePaint;
  wheel: LiveVehicleWheel;
  accessories: LiveVehicleAccessories;
  focus: LiveVehicleFocus;
  mode: LiveVehicleRenderMode;
  onReady: () => void;
}>;

export function LicensedVehicleModel({
  paint,
  wheel,
  accessories,
  focus,
  mode,
  onReady,
}: LicensedVehicleModelProps) {
  const invalidate = useThree((state) => state.invalidate);
  const { scene: sourceScene } = useGLTF(MODEL_URL, false, true);
  const scene = useMemo(
    () => cloneLicensedVehicleScene(sourceScene as Group),
    [sourceScene],
  );
  const blueprintEdges = useMemo(
    () => createLicensedVehicleBlueprintEdges(scene),
    [scene],
  );

  useLayoutEffect(() => {
    applyLicensedVehicleConfiguration(scene, paint, wheel, focus, mode);
    invalidate();
  }, [focus, invalidate, mode, paint, scene, wheel]);

  useEffect(() => {
    onReady();
  }, [onReady, scene]);

  useEffect(() => () => disposeLicensedVehicleMaterials(scene), [scene]);
  useEffect(
    () => () => disposeLicensedVehicleBlueprintEdges(blueprintEdges),
    [blueprintEdges],
  );

  return (
    <group name="LicensedVehicleRoot">
      <primitive object={scene} />
      <primitive object={blueprintEdges} visible={mode === "blueprint"} />
      {focus === "wheels" && <WheelFocusRing />}
      {accessories.towHitch && <ConfiguredTowHitch focused={focus === "utility"} />}
    </group>
  );
}
