import {
  CameraControls,
  ContactShadows,
  Environment,
  Grid,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import {
  Component,
  Suspense,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACESFilmicToneMapping,
  BackSide,
  SRGBColorSpace,
} from "three";
import { getCameraPose, type CameraRigId } from "./camera-presets";
import { createCycloramaTexture, createFloorFalloffTexture } from "./studio-backdrop";
import { CabinInterior } from "./CabinInterior";
import { resolveVehicleModelSource } from "./vehicle-model-source";
import type {
  LiveVehicleRenderMode,
  LiveVehicleViewportProps,
} from "./live-vehicle.types";
import "./live-vehicle.css";

class LicensedModelBoundary extends Component<
  Readonly<{
    children: ReactNode;
    fallback: ReactNode;
    onFailure: (reason: string) => void;
  }>,
  Readonly<{ failed: boolean }>
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onFailure(error instanceof Error ? error.message : "Licensed model failed to load");
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Idle turntable: rate in radians per second, the wait before it starts, and how long it runs. */
const TURNTABLE = { rate: 0.05, delay: 2.4, duration: 48 };

function CameraDirector({
  viewPreset,
  focus,
  keyboardOrbit,
  resetRevision,
  onInteraction,
  reducedMotion,
  cameraRig,
  turntable,
}: Pick<
  LiveVehicleViewportProps,
  "viewPreset" | "focus" | "keyboardOrbit" | "resetRevision" | "onInteraction"
  | "reducedMotion"
> & Readonly<{ cameraRig: CameraRigId; turntable: boolean }>) {
  const controls = useRef<CameraControls>(null);
  const invalidate = useThree((state) => state.invalidate);
  const pose = useMemo(
    () => getCameraPose(viewPreset, focus, keyboardOrbit, cameraRig),
    [cameraRig, focus, keyboardOrbit, viewPreset],
  );

  // A slow turn while nobody is touching it, the way a launch film opens.
  // It runs on the opening three-quarter only, never under reduced motion,
  // stops for good at the first touch, and gives up after a while on its own
  // so an unattended tab is not drawing forever — the viewport renders on
  // demand, and a turntable is the one thing here that asks for frames.
  const idle = useRef({ live: true, elapsed: 0 });
  useEffect(() => {
    if (!turntable) idle.current.live = false;
  }, [turntable]);
  useEffect(() => {
    if (turntable && !reducedMotion) invalidate();
  }, [invalidate, reducedMotion, turntable]);
  useFrame((_, delta) => {
    const state = idle.current;
    if (!state.live || !turntable || reducedMotion) return;
    if (typeof document !== "undefined" && document.hidden) return;
    state.elapsed += delta;
    if (state.elapsed > TURNTABLE.delay + TURNTABLE.duration) {
      state.live = false;
      return;
    }
    if (state.elapsed > TURNTABLE.delay) {
      controls.current?.rotate(TURNTABLE.rate * Math.min(delta, 0.05), 0, false);
    }
    invalidate();
  });
  const stopTurntable = () => {
    idle.current.live = false;
    onInteraction();
  };

  useEffect(() => {
    const controller = controls.current;
    if (!controller) return;
    controller.minDistance = pose.minDistance;
    controller.maxDistance = pose.maxDistance;
    void controller.setLookAt(
      ...pose.position,
      ...pose.target,
      !reducedMotion,
    );
    invalidate();
  }, [invalidate, pose, reducedMotion, resetRevision]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.42}
      draggingSmoothTime={0.12}
      dollySpeed={0.55}
      truckSpeed={0.7}
      minPolarAngle={Math.PI * 0.17}
      maxPolarAngle={Math.PI * 0.52}
      azimuthRotateSpeed={0.72}
      polarRotateSpeed={0.62}
      dollyToCursor
      onStart={stopTurntable}
    />
  );
}

/**
 * Whether this device gets the full post chain.
 *
 * Bloom, the reflective floor and the vignette are two extra passes over the
 * frame; on a phone that is the difference between a smooth orbit and a
 * stutter, so a coarse pointer or a narrow viewport gets the plain render.
 */
function useFullQuality(): boolean {
  const [full, setFull] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return !window.matchMedia("(pointer: coarse), (max-width: 760px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: coarse), (max-width: 760px)");
    const update = () => setFull(!query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return full;
}

/**
 * The finishing passes.
 *
 * Restrained on purpose: bloom only over what is already near white — the
 * lamps and the light bar — and a vignette that draws the eye in from the
 * page's off-white. The composer takes tone mapping off the renderer, so the
 * ACES curve is re-applied here as the last pass; without it the paint
 * clips to flat white wherever a strip reflects.
 */
function Post({ blueprint }: Readonly<{ blueprint: boolean }>) {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom
        luminanceThreshold={blueprint ? 0.55 : 0.9}
        luminanceSmoothing={0.14}
        intensity={blueprint ? 0.9 : 0.5}
        radius={0.62}
        mipmapBlur
      />
      <Vignette offset={0.26} darkness={blueprint ? 0.55 : 0.34} eskil={false} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

function ContextLossMonitor({
  onFailure,
}: Pick<LiveVehicleViewportProps, "onFailure">) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const contextLost = (event: Event) => {
      event.preventDefault();
      onFailure("WebGL context lost");
    };
    canvas.addEventListener("webglcontextlost", contextLost);
    return () => canvas.removeEventListener("webglcontextlost", contextLost);
  }, [gl, onFailure]);

  return null;
}

function Studio({
  mode,
  grounded = true,
  shadowKey,
  reflectiveFloor,
}: Readonly<{
  mode: LiveVehicleRenderMode;
  grounded?: boolean;
  shadowKey: string;
  reflectiveFloor: boolean;
}>) {
  // Nothing here casts shadows, so the exterior rig shines straight through the
  // cabin's headliner and flattens it. Inside, drop it to a rim contribution
  // and let CabinInterior's own lights model the room.
  const rig = grounded ? 1 : 0.16;
  const blueprint = mode === "blueprint";
  const cyclorama = useMemo(() => createCycloramaTexture(), []);
  useEffect(() => () => cyclorama.dispose(), [cyclorama]);
  const falloff = useMemo(() => createFloorFalloffTexture(), []);
  useEffect(() => () => falloff.dispose(), [falloff]);
  return (
    <>
      <ambientLight intensity={(blueprint ? 0.48 : 0.34) * rig} color={blueprint ? "#a7efff" : "#eef4ef"} />
      <directionalLight
        position={[4.5, 7.5, 5.5]}
        intensity={(blueprint ? 0.72 : 1.5) * rig}
        color={blueprint ? "#b8f4ff" : "#fff4dd"}
      />
      <directionalLight
        position={[-5.5, 3.2, -3.8]}
        intensity={(blueprint ? 1.05 : 0.82) * rig}
        color={blueprint ? "#43bed9" : "#b9dfd8"}
      />
      <spotLight
        position={[0, 7, -2.5]}
        intensity={(blueprint ? 8 : 18) * rig}
        angle={0.62}
        penumbra={0.9}
        distance={16}
        color={blueprint ? "#9eeeff" : "#eef9f3"}
      />
      {/*
        A car is almost entirely reflection, so what it stands in matters more
        than what shines on it. This is the rig a studio would actually build:
        long strip softboxes running the length of the car overhead, tall side
        boxes to shape the flanks, kickers at each end, and a dim enclosing
        shell so nothing ever reflects pure black. The long strips are what
        produce the streak that runs the whole shoulder line and reads as
        polished paint rather than coloured plastic.
      */}
      <Environment resolution={256} background={false}>
        <mesh scale={38}>
          <sphereGeometry args={[1, 32, 20]} />
          {blueprint ? (
            <meshBasicMaterial color="#0b2b38" side={BackSide} toneMapped={false} />
          ) : (
            <meshBasicMaterial map={cyclorama} side={BackSide} toneMapped={false} />
          )}
        </mesh>
        {/* Overhead strips: the long highlight down the roof and shoulder. */}
        {[-1.35, 0, 1.35].map((z) => (
          <Lightformer
            key={`strip-${z}`}
            form="rect"
            intensity={z === 0 ? 5.2 : 3.4}
            color="#fff6e6"
            position={[0, 6.4, z * 1.9]}
            rotation-x={Math.PI / 2}
            scale={[9.5, 0.55, 1]}
          />
        ))}
        {/* Side boxes: the vertical gradient that gives the flanks their form. */}
        <Lightformer
          form="rect"
          intensity={2.5}
          color="#f2f7ff"
          position={[0.4, 3.1, 6.6]}
          target={[0, 1, 0]}
          scale={[8, 3.4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.5}
          color="#cfe2e0"
          position={[-0.6, 2.9, -6.6]}
          target={[0, 1, 0]}
          scale={[8, 3.2, 1]}
        />
        {/* Kickers: separate the nose and tail from the ground plane. */}
        <Lightformer
          form="rect"
          intensity={2.9}
          color="#fff2dd"
          position={[7.6, 2.2, 1.6]}
          target={[0, 0.9, 0]}
          scale={[3.4, 2.4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.1}
          color="#e6f2ff"
          position={[-7.4, 2.0, -1.4]}
          target={[0, 0.9, 0]}
          scale={[3.2, 2.2, 1]}
        />
        {/* A bright horizon band the glass and the rims can pick up. */}
        <Lightformer
          form="ring"
          intensity={1.1}
          color="#ffffff"
          position={[0, 1.15, 0]}
          scale={13}
          rotation-x={Math.PI / 2}
        />
      </Environment>
      {blueprint && (
        <Grid
          args={[12, 12]}
          position={[0, 0.03, 0]}
          cellColor="#1c7088"
          cellSize={0.25}
          cellThickness={0.55}
          sectionColor="#67ddf5"
          sectionSize={1}
          sectionThickness={0.85}
          fadeDistance={9}
          fadeStrength={1.6}
          infiniteGrid={false}
        />
      )}
      {grounded && (
      <mesh rotation-x={-Math.PI / 2} position-y={0.015} receiveShadow>
        <circleGeometry args={[7.5, 64]} />
        {reflectiveFloor && !blueprint ? (
          /*
            A polished studio floor: a blurred, depth-faded reflection of the
            sills and the wheels, low enough that the car still sits on the
            page rather than floating over a mirror.
          */
          <MeshReflectorMaterial
            color="#e3e0d6"
            roughness={0.7}
            metalness={0.04}
            mirror={0.42}
            mixBlur={1}
            mixStrength={1.2}
            blur={[420, 140]}
            resolution={512}
            depthScale={0.9}
            minDepthThreshold={0.8}
            maxDepthThreshold={1.3}
            alphaMap={falloff}
            transparent
            opacity={0.62}
          />
        ) : (
          <meshStandardMaterial
            color={blueprint ? "#0c4053" : "#d8d5ca"}
            roughness={0.82}
            metalness={0.02}
            transparent
            opacity={blueprint ? 0.18 : 0.3}
          />
        )}
      </mesh>
      )}
      {/*
        Captured once per silhouette rather than every frame. Redrawing it
        continuously costs a second pass over the whole body for a shadow that
        only changes when the body does — but it does change when a door swings,
        so the key carries whatever alters the outline.
      */}
      {grounded && (
      <ContactShadows
        key={shadowKey}
        frames={1}
        position={[0, 0.025, 0]}
        scale={8.5}
        opacity={blueprint ? 0.2 : 0.47}
        blur={1.75}
        far={2.8}
        resolution={256}
        color="#1b2620"
      />
      )}
    </>
  );
}

function VehicleScene(props: LiveVehicleViewportProps) {
  // Whichever body is registered for this source draws the vehicle; camera,
  // lighting, blueprint mode, focus and the cabin are all source-agnostic.
  const { Component: VehicleBody, hasCabin, cameraRig } = resolveVehicleModelSource(props.modelSource);
  // Interior swaps the exterior shell for the cabin rather than drawing one
  // inside the other: from a camera in the driver's seat the body's front
  // faces are culled anyway, so keeping it would just leak the studio in.
  // A body that models its own cabin stays on screen for the interior view; the
  // stand-in cabin only exists for bodies that are exterior shells.
  const insideCabin = props.viewPreset === "interior" && props.mode === "showroom" && !hasCabin;
  // The cabin view gets the plain render: with the composer and the
  // reflector in the chain the cabin came out black under its fill lights,
  // and there is nothing for bloom or a floor reflection to do from inside.
  const fullQuality = useFullQuality() && props.viewPreset !== "interior";
  const turntable = props.viewPreset === "angle" && props.focus === null && props.mode === "showroom";

  return (
    <>
      <Studio
        mode={props.mode}
        grounded={!insideCabin}
        shadowKey={`${props.modelSource ?? "default"}:${props.bodyOpen ?? 0}`}
        reflectiveFloor={fullQuality}
      />
      {fullQuality && <Post blueprint={props.mode === "blueprint"} />}
      {/*
        A body that models its own cabin is a closed box once the camera is
        inside it: the studio rig lights the outside of the shell and nothing
        reaches the seats, so the interior view renders black. Real daylight
        would come through the glass, but this glass is privacy-tinted, so the
        cabin gets its own soft fill — a wash off the headliner and a cooler
        bounce off the windscreen — rather than a brighter exterior rig, which
        would blow out the paint everywhere else.
      */}
      {hasCabin && props.viewPreset === "interior" && props.mode === "showroom" && (
        <group name="CabinFill">
          {/*
            Enough to model the room, not enough to lift the trim off its own
            colour. These are close-range point lights inside a two-metre box,
            so a little goes a long way: at anything like exterior levels a
            near-black upholstery renders as pale khaki, and the colour someone
            just chose is the one thing this view exists to show.
          */}
          <ambientLight intensity={0.13} color="#f3f1ea" />
          <pointLight
            position={[0.15, 1.46, 0]}
            intensity={0.82}
            distance={4.2}
            decay={2}
            color="#fff3e0"
          />
          <pointLight
            position={[0.95, 1.18, 0]}
            intensity={0.52}
            distance={3.4}
            decay={2}
            color="#dce9ff"
          />
          <pointLight
            position={[-1.35, 1.32, 0]}
            intensity={0.42}
            distance={3.6}
            decay={2}
            color="#e6ecf2"
          />
        </group>
      )}
      <group visible={!insideCabin}>
        <LicensedModelBoundary fallback={null} onFailure={props.onFailure}>
          <Suspense fallback={null}>
            <VehicleBody
              paint={props.paint}
              wheel={props.wheel}
              accessories={props.accessories}
              interior={props.interior}
              focus={props.focus}
              mode={props.mode}
              bodyOpen={props.bodyOpen}
              onReady={props.onReady}
            />
          </Suspense>
        </LicensedModelBoundary>
      </group>
      <CabinInterior interior={props.interior} visible={insideCabin} />
      <CameraDirector
        cameraRig={cameraRig ?? "reference"}
        turntable={turntable}
        viewPreset={props.viewPreset}
        focus={props.focus}
        keyboardOrbit={props.keyboardOrbit}
        resetRevision={props.resetRevision}
        reducedMotion={props.reducedMotion}
        onInteraction={props.onInteraction}
      />
      <ContextLossMonitor onFailure={props.onFailure} />
    </>
  );
}

export function LiveVehicleViewport(props: LiveVehicleViewportProps) {
  return (
    <div
      className="live-vehicle-viewport"
      data-render-mode={props.mode}
      data-reduced-motion={props.reducedMotion || undefined}
      aria-hidden="true"
    >
      <Canvas
        className="live-vehicle-canvas"
        camera={{
          position: [4.65, 1.95, 5.85],
          fov: 32,
          near: 0.1,
          far: 60,
        }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{
          alpha: true,
          antialias: true,
          depth: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.24;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Suspense fallback={null}>
          <VehicleScene {...props} />
        </Suspense>
      </Canvas>
      <div className="live-vehicle-blueprint-overlay">
        <span className="live-vehicle-blueprint-overlay__reticle" />
        <span className="live-vehicle-blueprint-overlay__scan" />
      </div>
    </div>
  );
}

export default LiveVehicleViewport;
