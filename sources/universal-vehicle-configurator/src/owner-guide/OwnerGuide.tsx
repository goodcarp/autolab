import { Aperture, BatteryCharging, Boxes, DoorOpen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ownerGuideBridge, type VehicleTwinContext } from "./owner-guide-bridge";

type OwnerGuideProps = {
  active: boolean;
  context: VehicleTwinContext;
};

type GuideAction = "battery" | "open" | "explode" | null;

export function OwnerGuide({ active, context }: OwnerGuideProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [shouldLoad, setShouldLoad] = useState(active);
  const [frameReady, setFrameReady] = useState(false);
  const [activeAction, setActiveAction] = useState<GuideAction>(null);
  const [message, setMessage] = useState("Preparing digital twin…");

  const sync = useCallback(async () => {
    try {
      await ownerGuideBridge.syncContext(context);
    } catch {
      // The iframe may still be in its first module load. Its onLoad handler
      // performs the same sync once the drawing has installed its bridge.
    }
  }, [context]);

  useEffect(() => {
    ownerGuideBridge.bindFrame(frameRef.current);
    return () => ownerGuideBridge.bindFrame(null);
  }, [shouldLoad]);

  useEffect(() => ownerGuideBridge.observeFrameRequest(setShouldLoad), []);

  useEffect(() => {
    if (active) ownerGuideBridge.requestFrame();
  }, [active]);

  useEffect(() => {
    // Let the showroom win first paint, then quietly prepare the engineering
    // twin while the person explores the configuration rail.
    const preload = window.setTimeout(() => ownerGuideBridge.requestFrame(), 7_000);
    return () => window.clearTimeout(preload);
  }, []);

  useEffect(() => {
    if (frameReady) void sync();
  }, [frameReady, sync]);

  const run = async (action: Exclude<GuideAction, null>) => {
    setActiveAction(action);
    try {
      if (action === "battery") {
        await ownerGuideBridge.call("set_motion", { motion: "panels", on: true });
        await ownerGuideBridge.call("frame_part", {
          part: "battery",
          azimuth_deg: 12,
          elevation_deg: 24,
          margin: 0.9,
        });
        await ownerGuideBridge.call("highlight_part", { part: "battery" });
        setMessage("Structural battery framed · body shell dissolved");
      } else if (action === "open") {
        await ownerGuideBridge.call("set_view", { view: "q34r" });
        await ownerGuideBridge.call("set_motion", { motion: "open", on: true });
        setMessage("Doors, frunk, liftgate and charge port opened");
      } else {
        await ownerGuideBridge.call("set_view", { view: "iso" });
        await ownerGuideBridge.call("set_motion", { motion: "explode", on: true });
        setMessage("Assembly exploded along its authored part axes");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The digital twin did not respond.");
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section
      className="owner-guide"
      data-active={active || undefined}
      aria-label="AutoLab Garage digital twin"
      aria-hidden={!active}
    >
      {shouldLoad ? (
        <iframe
          ref={frameRef}
          className="owner-guide__frame"
          src={`${import.meta.env.BASE_URL}garage/`}
          title="RX2 interactive digital twin and owner guide"
          tabIndex={active ? 0 : -1}
          onLoad={() => {
            // The load event only says the document arrived. It does not say
            // the drawing installed its bridge — a Garage that aborts for lack
            // of WebGL2 still fires it. Claiming "ready" there enables three
            // controls that then hang until the call times out, and tells an
            // agent the twin is available when it is not. Ask it something
            // first; the answer is the readiness signal.
            ownerGuideBridge.markFrameReady();
            setMessage("Digital twin loaded · connecting");
            void (async () => {
              try {
                await ownerGuideBridge.call("get_state");
                setFrameReady(true);
                setMessage("Digital twin ready");
                void sync();
              } catch (error) {
                setFrameReady(false);
                setMessage(
                  error instanceof Error && error.message
                    ? `Digital twin did not answer: ${error.message}`
                    : "Digital twin loaded but is not responding.",
                );
              }
            })();
          }}
        />
      ) : (
        <div className="owner-guide__frame owner-guide__frame--loading" aria-hidden="true" />
      )}

      <aside className="owner-guide__identity" aria-label="Vehicle synced from configurator">
        <span className="owner-guide__eyebrow"><Sparkles aria-hidden="true" /> Live vehicle context</span>
        <strong>{context.build}</strong>
        <p>{context.paint} · {context.wheels}</p>
        <div>
          <span>{context.rangeMiles ?? "—"} mi</span>
          <span>Rev {context.revision}</span>
        </div>
      </aside>

      <div className="owner-guide__actions" aria-label="Digital twin shortcuts">
        <span className="owner-guide__action-label"><Aperture aria-hidden="true" /> Ask it to show you</span>
        <button type="button" disabled={!frameReady || activeAction !== null} onClick={() => void run("battery")}>
          <BatteryCharging aria-hidden="true" /> Battery
        </button>
        <button type="button" disabled={!frameReady || activeAction !== null} onClick={() => void run("open")}>
          <DoorOpen aria-hidden="true" /> Openings
        </button>
        <button type="button" disabled={!frameReady || activeAction !== null} onClick={() => void run("explode")}>
          <Boxes aria-hidden="true" /> Explode
        </button>
        <output aria-live="polite">
          {!frameReady ? "Drawing the vehicle…" : activeAction ? "Moving through the vehicle…" : message}
        </output>
      </div>
    </section>
  );
}
