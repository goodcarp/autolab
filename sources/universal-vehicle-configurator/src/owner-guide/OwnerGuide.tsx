import { BatteryCharging, Boxes, DoorOpen, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyGuideAction, isGuideActionActive, type GuideAction, type GuideState } from "./guide-actions";
import { ownerGuideBridge, type VehicleTwinContext } from "./owner-guide-bridge";
import "./owner-guide.css";

type OwnerGuideProps = { active: boolean; context: VehicleTwinContext };

export function OwnerGuide({ active, context }: OwnerGuideProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const connectionRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const [shouldLoad, setShouldLoad] = useState(active);
  const [frameVersion, setFrameVersion] = useState(0);
  const [connection, setConnection] = useState<"loading" | "ready" | "error">("loading");
  const [activeAction, setActiveAction] = useState<GuideAction | null>(null);
  const [state, setState] = useState<GuideState | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("Drawing the vehicle…");

  const sync = useCallback(async () => {
    try { await ownerGuideBridge.syncContext(context, { trackActivity: false }); }
    catch { /* The explicit readiness/retry flow owns connection errors. */ }
  }, [context]);

  useEffect(() => {
    ownerGuideBridge.bindFrame(frameRef.current);
    return () => {
      ownerGuideBridge.bindFrame(null);
      connectionRequest.current?.abort();
      connectionRequest.current = null;
      actionRequest.current?.abort();
      actionRequest.current = null;
    };
  }, [shouldLoad, frameVersion]);
  useEffect(() => ownerGuideBridge.observeFrameRequest(setShouldLoad), []);
  useEffect(() => { if (active) ownerGuideBridge.requestFrame(); }, [active]);
  useEffect(() => { if (connection === "ready") void sync(); }, [connection, sync]);

  // Bound the whole attempt, including navigation that never fires onLoad.
  useEffect(() => {
    if (!shouldLoad || connection !== "loading") return;
    const timeout = window.setTimeout(() => {
      connectionRequest.current?.abort(new Error("The drawing could not connect."));
      setConnection("error");
      setConnectionMessage("The drawing could not load. Please try again.");
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [connection, frameVersion, shouldLoad]);

  // Tours, gestures and agents share this state. Keep one quiet read in flight.
  useEffect(() => {
    if (!active || connection !== "ready" || activeAction) return;
    const controller = new AbortController();
    let timer: number;
    const read = async () => {
      try {
        const next = await ownerGuideBridge.call<GuideState>("get_state", {}, {
          signal: controller.signal, trackActivity: false,
        });
        if (!controller.signal.aborted) setState(next);
      } catch { /* Explicit actions report errors; background reads stay quiet. */ }
      finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void read(), 1_000);
      }
    };
    void read();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [active, connection, activeAction]);

  const connect = async () => {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnection("loading");
    setConnectionMessage("Drawing the vehicle…");
    ownerGuideBridge.markFrameReady();
    try {
      const next = await ownerGuideBridge.call<GuideState>("get_state", {}, {
        signal: controller.signal, trackActivity: false,
      });
      if (connectionRequest.current !== controller || controller.signal.aborted) return;
      setState(next);
      setConnection("ready");
    } catch {
      if (connectionRequest.current !== controller) return;
      setConnection("error");
      setConnectionMessage("The drawing could not load. Please try again.");
    }
  };

  const retry = () => {
    connectionRequest.current?.abort();
    connectionRequest.current = null;
    actionRequest.current?.abort();
    actionRequest.current = null;
    setConnection("loading");
    setState(null);
    setActiveAction(null);
    setConnectionMessage("Drawing the vehicle…");
    setFrameVersion((version) => version + 1);
  };

  const run = async (action: GuideAction) => {
    actionRequest.current?.abort();
    const controller = new AbortController();
    actionRequest.current = controller;
    setActiveAction(action);
    try {
      const next = await applyGuideAction(ownerGuideBridge, action, state, controller.signal);
      if (controller.signal.aborted) return;
      setState(next);
    } catch {
      if (!controller.signal.aborted) {
        setConnectionMessage("That view could not finish. Please retry the drawing.");
        setConnection("error");
      }
    } finally { if (actionRequest.current === controller) setActiveAction(null); }
  };

  // This is a description of the shared twin now, not a receipt for the last
  // local click. Tour completion and external tools can change it at any time.
  const presentationMessage = state?.tour?.running
    ? `Tour · ${state.tour.title ?? "Exploring the vehicle"}`
    : isGuideActionActive("battery", state) ? "Structural battery · body shell revealed"
    : state?.motions.explode ? "Exploded assembly · tap again to reassemble"
    : state?.motions.open ? "Openings shown · tap again to close"
    : state?.motions.panels ? "Body shell revealed · Reset view to restore"
    : state?.selected ? "Part highlighted · Reset view to restore"
    : "Drag to rotate · Pinch to zoom";

  return (
    <section className="owner-guide" data-active={active || undefined}
      aria-label="AutoLab Garage digital twin" aria-hidden={!active}>
      <aside className="owner-guide__identity" aria-label="Vehicle synced from configurator">
        <strong>{context.build}</strong>
        <p>{context.paint} · {context.wheels}</p>
      </aside>
      <div className="owner-guide__drawing" aria-busy={connection === "loading"}>
        {shouldLoad && <iframe key={frameVersion} ref={frameRef} className="owner-guide__frame"
          src={`${import.meta.env.BASE_URL}garage/`} title="RX2 interactive digital twin and owner guide"
          tabIndex={active ? 0 : -1} onLoad={() => void connect()} />}
        {connection !== "ready" && <div className="owner-guide__connection" role="status">
          <p>{connectionMessage}</p>
          {connection === "error" && <div>
            <button type="button" onClick={retry}>Retry drawing</button>
            <button type="button" onClick={() => ownerGuideBridge.setWorkspace("configure")}>Return to Shop</button>
          </div>}
        </div>}
      </div>
      <div className="owner-guide__actions" aria-label="Digital twin shortcuts">
        <button type="button" aria-pressed={isGuideActionActive("battery", state)}
          disabled={connection !== "ready" || activeAction !== null} onClick={() => void run("battery")}>
          <BatteryCharging aria-hidden="true" /> Battery
        </button>
        <button type="button" aria-pressed={isGuideActionActive("open", state)}
          disabled={connection !== "ready" || activeAction !== null} onClick={() => void run("open")}>
          <DoorOpen aria-hidden="true" /> Openings
        </button>
        <button type="button" aria-pressed={isGuideActionActive("explode", state)}
          disabled={connection !== "ready" || activeAction !== null} onClick={() => void run("explode")}>
          <Boxes aria-hidden="true" /> Explode
        </button>
        <button type="button" aria-pressed={isGuideActionActive("tour", state)}
          disabled={connection !== "ready" || activeAction !== null} onClick={() => void run("tour")}>
          {state?.tour?.running ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          {state?.tour?.running ? "Stop tour" : "Tour"}
        </button>
        <button type="button" className="owner-guide__reset" disabled={connection !== "ready"}
          onClick={() => void run("reset")}><RotateCcw aria-hidden="true" /> Reset view</button>
        <output aria-live={connection === "ready" ? "polite" : "off"}>{connection !== "ready" ? connectionMessage
          : activeAction ? "Moving through the vehicle…" : presentationMessage}</output>
      </div>
    </section>
  );
}
