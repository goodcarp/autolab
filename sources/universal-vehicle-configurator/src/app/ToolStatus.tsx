import { Check, ChevronDown, CircleDashed, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConfiguratorSiteToolsStatus } from "../webmcp/configurator-tools";

const TOOL_SUMMARIES: Record<string, string> = {
  get_vehicle_configuration: "Read the build, price, range, incentives, and revision",
  list_vehicle_configuration_options: "List real options and whether each stays valid",
  simulate_vehicle_configuration_change: "Preview a change without applying it",
  apply_vehicle_configuration_transaction: "Apply up to four interruptible stages",
  interrupt_vehicle_configuration_transaction: "Stop a run after its last committed stage",
  undo_vehicle_configuration_transaction: "Undo the last agent transaction",
  present_vehicle_configuration: "Drive the showroom, blueprint, camera, and focus",
  set_vehicle_buyer_context: "Record buyer facts so incentives stop guessing",
  estimate_vehicle_ownership_cost: "Payment, energy, and multi-year ownership math",
  compare_vehicle_configurations: "Compare up to three alternatives side by side",
  get_vehicle_twin_state: "Read the synchronized Garage camera and vehicle state",
  list_vehicle_parts: "List 42 addressable vehicle components and measured bounds",
  inspect_vehicle_part: "Reveal, frame, and highlight one component in the digital twin",
  set_vehicle_twin_view: "Move the Garage to an authored or orthographic view",
  set_vehicle_twin_motion: "Run lights, openings, shell dissolve, drive, or exploded view",
  measure_vehicle_parts: "Measure between named vehicle components in metres",
};

const STARTER_PROMPTS = [
  "Configure the cheapest R2 that can tow, then tell me what changed.",
  "I'm in Colorado, I'll finance, and I can install a home charger. What do I actually qualify for?",
  "Switch to the all-terrain wheels and show me the wheel close-up.",
  "How does Premium compare to what I have, and what would each cost me monthly?",
  "Take me into the Garage, reveal the structural battery, and explain what I am looking at.",
  "Open every panel on my configured R2, then show me where the charge port is.",
];

function statusLabel(status: ConfiguratorSiteToolsStatus) {
  if (status.state === "ready") return `${status.toolNames.length} agent tools`;
  if (status.state === "unsupported") return "Manual mode";
  if (status.state === "degraded") return "Agent unavailable";
  return "Connecting agent";
}

export function ToolStatus({ status }: { status: ConfiguratorSiteToolsStatus }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ready = status.state === "ready";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copyPrompt = async (prompt: string, index: number) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="tool-status" ref={wrapRef} aria-live="polite">
      <button
        className="header-action"
        type="button"
        data-state={status.state}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {ready ? <Check aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
        <span>{statusLabel(status)}</span>
        <ChevronDown aria-hidden="true" data-chevron="" />
      </button>

      {open && (
        <div className="tool-status__panel" role="dialog" aria-label="Agent tools on this page">
          {ready ? (
            <>
              <p className="tool-status__lede">
                This page defines its own agent tools. An agent in a WebMCP-capable
                browser can call them directly. You stay in control: touching any
                control interrupts an agent mid-run.
              </p>
              <ul className="tool-status__tools">
                {status.toolNames.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                    <small>{TOOL_SUMMARIES[name] ?? "Page-defined tool"}</small>
                  </li>
                ))}
              </ul>
              <p className="tool-status__lede">Try asking your agent:</p>
              <ul className="tool-status__prompts">
                {STARTER_PROMPTS.map((prompt, index) => (
                  <li key={prompt}>
                    <button type="button" onClick={() => void copyPrompt(prompt, index)}>
                      <span>{prompt}</span>
                      <Copy aria-hidden="true" />
                    </button>
                    {copied === index && <small>Copied</small>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="tool-status__lede">
                This is a WebMCP entry: AutoLab publishes configurator and digital-twin
                tools an agent can call. Your browser has not exposed the API, so both
                lifecycle surfaces are running in manual mode.
              </p>
              <ul className="tool-status__how">
                <li>
                  <strong>ChatGPT desktop</strong>
                  <small>Open this URL in the app's built-in browser.</small>
                </li>
                <li>
                  <strong>Chrome</strong>
                  <small>
                    Enable <code>chrome://flags/#enable-webmcp-testing</code>, restart,
                    then reload this page.
                  </small>
                </li>
              </ul>
              <p className="tool-status__lede">
                AutoLab keeps watching, so it will switch over on its own if the API
                appears. In a compatible browser it exposes both configurator and
                digital-twin tools.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
