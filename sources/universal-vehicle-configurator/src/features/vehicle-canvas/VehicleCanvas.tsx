import {
  Armchair,
  Camera,
  Car,
  CircleDot,
  Crosshair,
  ImageOff,
  LoaderCircle,
  Move,
  Palette,
  RotateCcw,
} from "lucide-react";
import {
  Component,
  lazy,
  Suspense,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NormalizedAnchor } from "../../scene/scene-manifest";
import type { RenderedBodyDescriptor as RenderedBody } from "../../webmcp/configurator-tools";
import {
  DEFAULT_VEHICLE_MODEL_SOURCE,
  resolveVehicleModelSource,
  anchorsFor,
  REQUESTED_VEHICLE_MODEL_SOURCE,
  type VehicleModelSourceId,
} from "../../scene/vehicle-model-source";
import { detectWebGLSupport, type WebGLSupport } from "../../scene/webgl-support";
import "./vehicle-canvas.css";

const createLiveVehicleViewport = () => lazy(() => import("../../scene/LiveVehicleViewport"));

export type VehicleCanvasMode = "showroom" | "blueprint";
export type VehicleViewPreset = "angle" | "profile" | "wheel" | "interior";
export type VehicleVisualAccuracy = "exact" | "representative";
export type VehicleAssetStatus = "loading" | "ready" | "fallback";
export type VehicleHotspotId = "paint" | "charge-port" | "wheels" | "utility";

export type VehiclePaintSelection = Readonly<{
  id: string;
  label: string;
  color: string;
  accuracy?: VehicleVisualAccuracy;
}>;

export type VehicleWheelSelection = Readonly<{
  id: string;
  label: string;
  diameterInches: number;
  style?: "aero" | "terrain" | "sport";
  accuracy?: VehicleVisualAccuracy;
}>;

export type VehicleInteriorSelection = Readonly<{
  id: string;
  label: string;
  color: string;
  accentColor?: string;
  material?: "textile" | "vegan-leather" | "leather";
  tone?: "light" | "dark";
  accuracy?: VehicleVisualAccuracy;
}>;

export type VehicleAccessorySelection = Readonly<{
  towHitch: boolean;
}>;

export type VehicleHotspot = Readonly<{
  id: VehicleHotspotId;
  label: string;
  detail: string;
  anchor: NormalizedAnchor;
  accuracy?: VehicleVisualAccuracy;
}>;

export type VehicleViewportState = Readonly<{
  panX: number;
  panY: number;
  viewPreset: VehicleViewPreset;
  mode: VehicleCanvasMode;
}>;

export type VehicleCanvasProps = Readonly<{
  paint?: VehiclePaintSelection;
  wheel?: VehicleWheelSelection;
  interior?: VehicleInteriorSelection;
  /** Which registered body draws the vehicle. Defaults to the Garage-authored procedural R2. */
  modelSource?: VehicleModelSourceId;
  /** Doors, frunk and liftgate open. Only offered by bodies that can open. */
  bodyOpen?: boolean;
  onBodyOpenChange?: (bodyOpen: boolean) => void;
  /**
   * Reports what is genuinely on screen, so the agent surface can publish it.
   * Fires whenever that changes — a body is only the body once a renderer is
   * actually drawing it.
   */
  onRenderedBodyChange?: (body: RenderedBody) => void;
  accessories?: VehicleAccessorySelection;
  mode?: VehicleCanvasMode;
  defaultMode?: VehicleCanvasMode;
  viewPreset?: VehicleViewPreset;
  defaultViewPreset?: VehicleViewPreset;
  activeHotspotId?: VehicleHotspotId | null;
  hotspots?: readonly VehicleHotspot[];
  className?: string;
  /** A compact summary in the reserved viewer header. */
  headerAside?: ReactNode;
  onModeChange?: (mode: VehicleCanvasMode) => void;
  onViewPresetChange?: (preset: VehicleViewPreset) => void;
  onHotspotChange?: (hotspotId: VehicleHotspotId | null) => void;
  onAssetStatusChange?: (status: VehicleAssetStatus) => void;
  onViewportChange?: (state: VehicleViewportState) => void;
}>;

type LiveRendererStatus = "loading" | "ready" | "failed";
type LiveRendererAttempt = {
  source: VehicleModelSourceId;
  attempt: number;
  status: LiveRendererStatus;
  Viewport: ReturnType<typeof createLiveVehicleViewport>;
};

class LiveSceneBoundary extends Component<
  Readonly<{ children: ReactNode; onFailure: (reason: string) => void }>,
  Readonly<{ failed: boolean }>
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onFailure(error instanceof Error ? error.message : "3D renderer failed");
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const DEFAULT_PAINT: VehiclePaintSelection = {
  id: "forest",
  label: "Forest",
  color: "#1d4b3c",
  accuracy: "representative",
};

const DEFAULT_WHEEL: VehicleWheelSelection = {
  id: "range-21",
  label: "21-inch range wheel",
  diameterInches: 21,
  style: "aero",
  accuracy: "representative",
};

const DEFAULT_INTERIOR: VehicleInteriorSelection = {
  id: "black-crater",
  label: "Black Crater",
  color: "#292b28",
  accentColor: "#a59c87",
  material: "textile",
  tone: "dark",
  accuracy: "representative",
};

const DEFAULT_ACCESSORIES: VehicleAccessorySelection = {
  towHitch: false,
};

const PRESETS: readonly Readonly<{
  id: VehicleViewPreset;
  label: string;
}>[] = [
  { id: "angle", label: "Angle" },
  { id: "profile", label: "Profile" },
  { id: "wheel", label: "Wheel" },
  { id: "interior", label: "Interior" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const accuracyLabel = (accuracy: VehicleVisualAccuracy | undefined) =>
  accuracy === "exact" ? "Exact selection" : "Representative visualization";

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reducedMotion;
}

function InteriorView({ interior }: Readonly<{ interior: VehicleInteriorSelection }>) {
  return (
    <div
      className="vc-interior-view"
      data-interior-material={interior.material ?? "textile"}
      data-interior-tone={interior.tone ?? "dark"}
      aria-label={`${interior.label} representative interior material preview`}
    >
      <div className="vc-material-sample" aria-hidden="true">
        <span className="vc-material-sample__surface" />
        <span className="vc-material-sample__stitch" />
      </div>
    </div>
  );
}

function AssetFallback({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  return (
    <div className="vc-asset-fallback" role="status">
      <ImageOff aria-hidden="true" />
      <strong>Vehicle view unavailable</strong>
      <span>Configuration controls remain active.</span>
      {onRetry && <button type="button" onClick={onRetry}>Retry preview</button>}
    </div>
  );
}

export function VehicleCanvas({
  paint = DEFAULT_PAINT,
  wheel = DEFAULT_WHEEL,
  interior = DEFAULT_INTERIOR,
  modelSource,
  bodyOpen = false,
  onRenderedBodyChange,
  accessories = DEFAULT_ACCESSORIES,
  mode,
  defaultMode = "showroom",
  viewPreset,
  defaultViewPreset = "angle",
  activeHotspotId,
  hotspots,
  className = "",
  headerAside,
  onModeChange,
  onViewPresetChange,
  onHotspotChange,
  onAssetStatusChange,
  onViewportChange,
}: VehicleCanvasProps) {
  const [internalMode, setInternalMode] = useState(defaultMode);
  const [internalPreset, setInternalPreset] = useState(defaultViewPreset);
  const [internalHotspot, setInternalHotspot] = useState<VehicleHotspotId | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [liveCameraResetRevision, setLiveCameraResetRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [webglSupport] = useState<WebGLSupport>(() => detectWebGLSupport());
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef({ id: -1, clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const reducedMotion = usePrefersReducedMotion();

  const currentMode = mode ?? internalMode;
  const currentPreset = viewPreset ?? internalPreset;
  const currentHotspot = activeHotspotId === undefined ? internalHotspot : activeHotspotId;
  // A ?model= override makes the seam switchable without a rebuild, which is
  // how the code-native R2 gets compared against the licensed GLB.
  const activeModelSource: VehicleModelSourceId = useMemo(() => {
    if (modelSource) return modelSource;
    return REQUESTED_VEHICLE_MODEL_SOURCE ?? DEFAULT_VEHICLE_MODEL_SOURCE;
  }, [modelSource]);

  // A source change starts a fresh render attempt immediately. Late ready or
  // failure callbacks from the previous body must never describe its replacement.
  const initialStatus: LiveRendererStatus = webglSupport === "supported" ? "loading" : "failed";
  const [renderer, setRenderer] = useState<LiveRendererAttempt>(() => ({
    source: activeModelSource,
    attempt: 0,
    status: initialStatus,
    Viewport: createLiveVehicleViewport(),
  }));
  if (renderer.source !== activeModelSource) {
    setRenderer({
      source: activeModelSource,
      attempt: renderer.attempt + 1,
      status: initialStatus,
      Viewport: createLiveVehicleViewport(),
    });
  }
  const LiveVehicleViewport = renderer.Viewport;
  const liveStatus = renderer.source === activeModelSource ? renderer.status : initialStatus;
  const liveRendererActive = liveStatus === "ready";
  const liveLoading = liveStatus === "loading";
  const activeAsset: VehicleAssetStatus = liveRendererActive ? "ready" : liveLoading ? "loading" : "fallback";

  // Controls that need a vehicle are available only after its renderer is ready.
  const canOpenBody = resolveVehicleModelSource(activeModelSource).hasOpenableBody
    && currentMode === "showroom"
    && liveRendererActive;
  const bodyIsOpen = canOpenBody && bodyOpen;

  const activeBody = resolveVehicleModelSource(activeModelSource);
  const bodyAnchors = anchorsFor(activeBody);
  const modelAttribution = liveRendererActive ? activeBody.attribution : "";
  const modelTitle = liveRendererActive
    ? activeBody.sceneTitle
    : liveLoading ? `Preparing ${activeBody.sceneTitle}` : "Vehicle view unavailable";

  // Loading and failure never substitute a photograph of a different vehicle.
  const renderedBody = useMemo<RenderedBody>(() => (liveRendererActive
    ? {
      id: activeBody.id,
      label: activeBody.sceneTitle,
      representsConfiguredVehicle: activeBody.id !== "licensed-glb",
      basis: activeBody.credit.text.replace(/^Model:\s*/u, ""),
      canOpen: activeBody.hasOpenableBody,
    }
    : liveLoading ? {
      id: "loading",
      label: "Vehicle loading",
      representsConfiguredVehicle: false,
      basis: "The live vehicle is loading; no vehicle is displayed yet.",
      canOpen: false,
    }
    : {
      id: "unavailable",
      label: "Vehicle view unavailable",
      representsConfiguredVehicle: false,
      basis: "The live vehicle could not be displayed; no vehicle is on screen.",
      canOpen: false,
    }), [activeBody, liveRendererActive, liveLoading]);

  useEffect(() => {
    onRenderedBodyChange?.(renderedBody);
  }, [onRenderedBodyChange, renderedBody]);

  const resolvedHotspots = useMemo<readonly VehicleHotspot[]>(() => hotspots ?? [
    {
      id: "paint",
      label: "Exterior finish",
      detail: paint.label,
      anchor: bodyAnchors.bodyPaint,
      accuracy: paint.accuracy ?? "representative",
    },
    {
      id: "charge-port",
      label: "Charge port",
      detail: `Representative feature location on ${resolveVehicleModelSource(activeModelSource).hotspotBasis}`,
      anchor: bodyAnchors.chargePort,
      accuracy: "representative",
    },
    {
      id: "wheels",
      label: "Wheel package",
      detail: `${wheel.label} · ${wheel.diameterInches} in`,
      anchor: bodyAnchors.frontWheel,
      accuracy: wheel.accuracy ?? "representative",
    },
    {
      id: "utility",
      label: "Rear utility",
      detail: "Context hotspot · capability not asserted",
      anchor: bodyAnchors.rearHitch,
      accuracy: "representative",
    },
  ], [
    activeModelSource,
    bodyAnchors,
    hotspots,
    paint.accuracy,
    paint.label,
    wheel.accuracy,
    wheel.diameterInches,
    wheel.label,
  ]);

  const activeHotspot = resolvedHotspots.find(({ id }) => id === currentHotspot) ?? null;
  const canvasStyle = {
    "--paint-color": paint.color,
    "--interior-color": interior.color,
    "--interior-accent": interior.accentColor ?? "#a59c87",
    "--pan-x": `${pan.x}%`,
    "--pan-y": `${pan.y}%`,
    "--parallax-x": `${parallax.x}px`,
    "--parallax-y": `${parallax.y}px`,
  } as CSSProperties;

  useEffect(() => {
    onAssetStatusChange?.(activeAsset);
  }, [activeAsset, onAssetStatusChange]);

  useEffect(() => {
    onViewportChange?.({
      panX: pan.x,
      panY: pan.y,
      viewPreset: currentPreset,
      mode: currentMode,
    });
  }, [currentMode, currentPreset, onViewportChange, pan.x, pan.y]);

  const haptic = useCallback(() => {
    if (typeof navigator.vibrate === "function") navigator.vibrate(7);
  }, []);

  const handleLiveReady = useCallback(() => {
    setRenderer((current) => current.source === activeModelSource
      && current.attempt === renderer.attempt && current.status === "loading"
      ? { ...current, status: "ready" } : current);
  }, [activeModelSource, renderer.attempt]);

  const handleLiveFailure = useCallback(() => {
    setRenderer((current) => current.source === activeModelSource
      && current.attempt === renderer.attempt && current.status !== "failed"
      ? { ...current, status: "failed" } : current);
  }, [activeModelSource, renderer.attempt]);

  const retryLivePreview = useCallback(() => {
    setRenderer((current) => ({
      ...current,
      attempt: current.attempt + 1,
      status: "loading",
      Viewport: createLiveVehicleViewport(),
    }));
    stage.current?.focus();
  }, []);

  const handleLiveInteraction = useCallback(() => {
    haptic();
  }, [haptic]);

  const selectPreset = useCallback((nextPreset: VehicleViewPreset) => {
    if (viewPreset === undefined) setInternalPreset(nextPreset);
    if ((nextPreset === "angle" || nextPreset === "interior") && currentMode === "blueprint") {
      if (mode === undefined) setInternalMode("showroom");
      onModeChange?.("showroom");
    }
    setPan({ x: 0, y: 0 });
    onViewPresetChange?.(nextPreset);
    haptic();
  }, [currentMode, haptic, mode, onModeChange, onViewPresetChange, viewPreset]);

  const selectMode = useCallback((nextMode: VehicleCanvasMode) => {
    if (mode === undefined) setInternalMode(nextMode);
    if (nextMode === "blueprint" && (currentPreset === "angle" || currentPreset === "interior")) {
      if (viewPreset === undefined) setInternalPreset("profile");
      onViewPresetChange?.("profile");
    }
    onModeChange?.(nextMode);
    haptic();
  }, [currentPreset, haptic, mode, onModeChange, onViewPresetChange, viewPreset]);

  const selectHotspot = useCallback((hotspotId: VehicleHotspotId) => {
    const next = currentHotspot === hotspotId ? null : hotspotId;
    if (activeHotspotId === undefined) setInternalHotspot(next);
    onHotspotChange?.(next);
    haptic();
  }, [activeHotspotId, currentHotspot, haptic, onHotspotChange]);

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setParallax({ x: 0, y: 0 });
    setLiveCameraResetRevision((revision) => revision + 1);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (liveRendererActive) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointer.current = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  }, [liveRendererActive, pan.x, pan.y]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (liveRendererActive) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!dragging || pointer.current.id !== event.pointerId) {
      if (event.pointerType === "mouse" && !reducedMotion) {
        const normalizedX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
        const normalizedY = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1;
        setParallax({ x: normalizedX * 7, y: normalizedY * 4 });
      }
      return;
    }

    const nextX = pointer.current.panX
      + ((event.clientX - pointer.current.clientX) / Math.max(bounds.width, 1)) * 18;
    const nextY = pointer.current.panY
      + ((event.clientY - pointer.current.clientY) / Math.max(bounds.height, 1)) * 12;
    setPan({ x: clamp(nextX, -8, 8), y: clamp(nextY, -5, 5) });
  }, [dragging, liveRendererActive, reducedMotion]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (liveRendererActive) return;
    if (pointer.current.id !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointer.current.id = -1;
    setDragging(false);
    haptic();
  }, [haptic, liveRendererActive]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const increments: Partial<Record<string, { x: number; y: number }>> = {
      ArrowLeft: { x: -1.5, y: 0 },
      ArrowRight: { x: 1.5, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const increment = increments[event.key];
    if (increment) {
      event.preventDefault();
      setPan((current) => ({
        x: clamp(current.x + increment.x, -8, 8),
        y: clamp(current.y + increment.y, -5, 5),
      }));
      return;
    }
    if (event.key === "Home" || event.key === "0") {
      event.preventDefault();
      resetView();
    }
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      selectMode(currentMode === "blueprint" ? "showroom" : "blueprint");
    }
  }, [currentMode, resetView, selectMode]);

  return (
    <section
      className={`vehicle-canvas ${className}`.trim()}
      data-mode={currentMode}
      data-preset={currentPreset}
      data-paint={paint.id}
      data-wheel={wheel.id}
      data-interior={interior.id}
      data-tow-hitch={accessories.towHitch || undefined}
      data-asset-status={activeAsset}
      data-renderer={liveRendererActive ? "live_3d" : liveLoading ? "loading" : "unavailable"}
      data-live-status={liveStatus}
      data-reduced-motion={reducedMotion || undefined}
      style={canvasStyle}
      aria-label="Interactive vehicle configurator"
      aria-busy={liveLoading}
    >
      <div
        className="vc-stage"
        ref={stage}
        role="application"
        aria-roledescription="interactive vehicle viewport"
        aria-label={`${modelTitle}. ${paint.label}. ${wheel.label}. ${interior.label}.`}
        aria-describedby="vehicle-canvas-instructions"
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={() => !dragging && setParallax({ x: 0, y: 0 })}
        onDoubleClick={resetView}
        onKeyDown={onKeyDown}
      >
        <p id="vehicle-canvas-instructions" className="vc-sr-only">
          Drag to orbit the vehicle in live views. Use arrow keys to adjust the view, B to toggle blueprint,
          and Home or zero to reset the view.
        </p>

        <div className="vc-environment" aria-hidden="true">
          <span className="vc-environment__light" />
          <span className="vc-environment__grid" />
          <span className="vc-environment__orbit vc-environment__orbit--one" />
          <span className="vc-environment__orbit vc-environment__orbit--two" />
          <span className="vc-environment__ground" />
        </div>

        {webglSupport === "supported" && liveStatus !== "failed" && (
          <div className="vc-live-layer" aria-hidden="true">
            <LiveSceneBoundary key={`${activeModelSource}:${renderer.attempt}`} onFailure={handleLiveFailure}>
              <Suspense fallback={null}>
                <LiveVehicleViewport
                  paint={{ id: paint.id, color: paint.color }}
                  wheel={{
                    id: wheel.id,
                    diameterInches: wheel.diameterInches,
                    style: wheel.style ?? "aero",
                  }}
                  accessories={accessories}
                  modelSource={activeModelSource}
                  interior={{
                    color: interior.color,
                    accentColor: interior.accentColor,
                    material: interior.material,
                    tone: interior.tone,
                  }}
                  mode={currentMode}
                  bodyOpen={bodyIsOpen ? 1 : 0}
                  viewPreset={currentPreset}
                  focus={currentHotspot}
                  keyboardOrbit={{ yaw: pan.x * 0.035, pitch: pan.y * 0.025 }}
                  resetRevision={liveCameraResetRevision}
                  reducedMotion={reducedMotion}
                  onReady={handleLiveReady}
                  onFailure={handleLiveFailure}
                  onInteraction={handleLiveInteraction}
                />
              </Suspense>
            </LiveSceneBoundary>
          </div>
        )}

        <header className="vc-hud">
          <div className="vc-hud__identity">
            <span className="vc-hud__index">UVC / 01</span>
            <strong>{modelTitle}</strong>
            <span>{modelAttribution}</span>
          </div>
          {headerAside}
          {/* The Showroom/Blueprint switch and the Open body button left the
              visible chrome for the demo. Both paths stay live for agents:
              the `mode` / `bodyOpen` props, the WebMCP presentation tools and
              the "b" key still drive them. */}
        </header>

        <div className="vc-status" aria-live="polite">
          <span className="vc-status__dot" aria-hidden="true" />
          {liveLoading && <><LoaderCircle aria-hidden="true" /> Preparing real-time vehicle</>}
          {liveRendererActive && <>Live 3D · Agent vision active</>}
          {liveStatus === "failed" && <>Vehicle preview unavailable · controls still active</>}
        </div>
        {liveLoading && <div className="vc-loading" role="status">
          <LoaderCircle aria-hidden="true" /> Preparing real-time vehicle
        </div>}

        {liveStatus === "failed" && <AssetFallback onRetry={webglSupport === "supported" ? retryLivePreview : undefined} />}

        {liveRendererActive && <div className="vc-object" aria-live="polite">
          {currentPreset === "interior" && <InteriorView interior={interior} />}

          <div className="vc-hotspots" aria-label="Vehicle focus points">
            {resolvedHotspots.map((hotspot) => (
              <button
                key={hotspot.id}
                type="button"
                className="vc-hotspot"
                style={{
                  "--anchor-x": `${hotspot.anchor.x * 100}%`,
                  "--anchor-y": `${hotspot.anchor.y * 100}%`,
                } as CSSProperties}
                data-hotspot={hotspot.id}
                data-active={currentHotspot === hotspot.id || undefined}
                aria-label={`Focus ${hotspot.label}`}
                aria-pressed={currentHotspot === hotspot.id}
                onClick={() => selectHotspot(hotspot.id)}
              >
                <span aria-hidden="true"><Crosshair /></span>
              </button>
            ))}
          </div>
        </div>}

        {activeHotspot && currentPreset !== "interior" && (
          <aside className="vc-focus-card" data-hotspot={activeHotspot.id} aria-live="polite">
            <div className="vc-focus-card__kind">
              {activeHotspot.id === "paint" && <Palette aria-hidden="true" />}
              {activeHotspot.id === "wheels" && <CircleDot aria-hidden="true" />}
              {!(["paint", "wheels"] as string[]).includes(activeHotspot.id) && <Crosshair aria-hidden="true" />}
              {accuracyLabel(activeHotspot.accuracy)}
            </div>
            <strong>{activeHotspot.label}</strong>
            <p>{activeHotspot.detail}</p>
            <button type="button" onClick={() => selectHotspot(activeHotspot.id)}>Close</button>
          </aside>
        )}

        <div className="vc-view-picker" aria-label="Vehicle view presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={currentPreset === preset.id}
              onClick={() => selectPreset(preset.id)}
            >
              <span className="vc-view-picker__icon" aria-hidden="true">
                {preset.id === "angle" ? <Camera /> : preset.id === "profile" ? <Car /> :
                  preset.id === "wheel" ? <CircleDot /> : <Armchair />}
              </span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>

        <footer className="vc-footer">
          {liveRendererActive && <span className="vc-drag-hint"><Move aria-hidden="true" /> Drag to orbit</span>}
          <span className="vc-selection-readout">
            <span
              style={{ backgroundColor: currentPreset === "interior" ? interior.color : paint.color }}
              aria-hidden="true"
            />
            {currentPreset === "interior"
              ? `${interior.label} · ${interior.material ?? "textile"}`
              : `${paint.label} · ${wheel.diameterInches} in`}
          </span>
          <button type="button" className="vc-reset" onClick={resetView}>
            <RotateCcw aria-hidden="true" /> Reset view
          </button>
        </footer>
      </div>
    </section>
  );
}
