import { ArrowLeft, Gauge, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RANGE_REALITY_FIXTURE } from "./range-fixtures";
import "./range-reality.css";

export type RangeRealityPhase =
  | "showroom"
  | "aligning"
  | "scanning"
  | "ruler"
  | "callouts"
  | "complete";

const ACTIVE_PHASES = new Set<RangeRealityPhase>([
  "aligning",
  "scanning",
  "ruler",
  "callouts",
]);

const asset = (filename: string) => `${import.meta.env.BASE_URL}images/${filename}`;

export function RangeRealityPrototype() {
  const [phase, setPhase] = useState<RangeRealityPhase>("showroom");
  const [interrupted, setInterrupted] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }
    timers.current = [];
  }, []);

  const schedule = useCallback((nextPhase: RangeRealityPhase, delay: number) => {
    timers.current.push(window.setTimeout(() => setPhase(nextPhase), delay));
  }, []);

  const play = useCallback(() => {
    clearTimers();
    setInterrupted(false);
    setPhase("aligning");
    schedule("scanning", 700);
    schedule("ruler", 2_350);
    schedule("callouts", 3_550);
    schedule("complete", 5_450);
  }, [clearTimers, schedule]);

  const returnToShowroom = useCallback(() => {
    clearTimers();
    setInterrupted(false);
    setPhase("showroom");
  }, [clearTimers]);

  const snapComplete = useCallback(() => {
    if (!ACTIVE_PHASES.has(phase)) return;
    clearTimers();
    setInterrupted(true);
    setPhase("complete");
  }, [clearTimers, phase]);

  useEffect(() => clearTimers, [clearTimers]);

  const storyVisible = phase !== "showroom";
  const isPlaying = ACTIVE_PHASES.has(phase);

  return (
    <section className="range-demo" aria-label="Range Reality visual prototype">
      <div
        className="range-stage"
        data-phase={phase}
        data-interrupted={interrupted || undefined}
        onPointerDownCapture={snapComplete}
        onWheel={snapComplete}
      >
        <div className="range-stage__grid" aria-hidden="true" />
        <div className="range-stage__halo" aria-hidden="true" />
        <div className="range-stage__datum datum-a" aria-hidden="true" />
        <div className="range-stage__datum datum-b" aria-hidden="true" />

        <div className="range-stage__meta" aria-hidden="true">
          <span>UVC / R2-C</span>
          <span>PROFILE 032°</span>
          <span>REV 001</span>
        </div>

        <div className="range-stage__vehicle" aria-label="Unofficial green electric SUV concept, side profile">
          <img
            className="vehicle-layer vehicle-layer--showroom"
            src={asset("vehicle-side.webp")}
            alt="Unofficial green electric SUV concept in side profile"
          />
          <img
            className="vehicle-layer vehicle-layer--blueprint"
            src={asset("vehicle-side-blueprint.webp")}
            alt=""
            aria-hidden="true"
          />
          <span className="vehicle-ground" aria-hidden="true" />
        </div>

        <div className="scan-portal" aria-hidden="true">
          <span className="scan-portal__core" />
          <span className="scan-portal__echo scan-portal__echo--one" />
          <span className="scan-portal__echo scan-portal__echo--two" />
        </div>

        <div className="wheel-focus" aria-hidden={!storyVisible}>
          <span className="wheel-focus__target" />
          <span className="wheel-focus__leader" />
          <div className="wheel-focus__inset">
            <img src={asset("representative-wheel-inset.webp")} alt="" />
            <span>Representative wheel study</span>
          </div>
        </div>

        <div className="range-ruler" aria-hidden={!storyVisible}>
          <div className="range-ruler__header">
            <span>Rated range / configuration effect</span>
            <strong><span>+</span>{RANGE_REALITY_FIXTURE.restoredMiles} MI</strong>
          </div>
          <div className="range-ruler__track">
            <span className="range-ruler__base" />
            <span className="range-ruler__restored" />
            <span className="range-ruler__cursor" />
          </div>
          <div className="range-ruler__labels">
            <span>0</span>
            <span className="range-ruler__307">307</span>
            <span className="range-ruler__330">330 MI</span>
          </div>
        </div>

        <div className="range-callouts" aria-live="polite" aria-label="Range Reality explanation">
          <article className="range-callout range-callout--calculation">
            <span className="trust-kind"><Gauge aria-hidden="true" /> Configurator calculation</span>
            <strong>307 → 330 miles</strong>
            <p>Changing the wheel package restores the modeled 23-mile segment.</p>
          </article>
          <article className="range-callout range-callout--fact">
            <span className="trust-kind"><Pause aria-hidden="true" /> Sourced fact</span>
            <strong>Wheel-dependent estimate</strong>
            <p>Rated range varies with the tested configuration. Verify final certification.</p>
          </article>
          <article className="range-callout range-callout--interpretation">
            <span className="trust-kind"><Sparkles aria-hidden="true" /> Agent interpretation</span>
            <strong>Road-trip fit restored</strong>
            <p>The range-first wheel better matches this buyer’s stated priorities.</p>
          </article>
        </div>

        <div className="range-stage__status" aria-live="polite">
          <span className="status-pulse" aria-hidden="true" />
          {phase === "showroom" && "Showroom ready"}
          {phase === "aligning" && "Aligning profile"}
          {phase === "scanning" && "Resolving configuration"}
          {phase === "ruler" && "Restoring range segment"}
          {phase === "callouts" && "Presenting consequences"}
          {phase === "complete" && (interrupted ? "Interrupted · complete blueprint shown" : "Blueprint complete")}
        </div>
      </div>

      <div className="range-controls">
        <div>
          <span className="range-controls__kicker">Blueprint story / 01</span>
          <strong>{storyVisible ? "Range Reality" : "Performance · All-terrain"}</strong>
        </div>
        <div className="range-controls__actions">
          {storyVisible && (
            <button type="button" className="range-button range-button--quiet" onClick={returnToShowroom}>
              <ArrowLeft aria-hidden="true" /> Showroom
            </button>
          )}
          <button
            type="button"
            className="range-button range-button--primary"
            onClick={isPlaying ? snapComplete : play}
          >
            {isPlaying ? <Pause aria-hidden="true" /> : phase === "complete" ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
            {isPlaying ? "Show complete view" : phase === "complete" ? "Replay scan" : "Explain this build"}
          </button>
        </div>
      </div>
    </section>
  );
}
