import { Check, Minus, Sparkles, Undo2, X } from "lucide-react";
import type { TransactionReceipt } from "../state/transactions";
import { formatCurrency } from "./presentation";

function deltaLabel(before: number, after: number) {
  const delta = after - before;
  if (delta === 0) return null;
  return `${delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}`;
}

function rangeDeltaLabel(before: number | null, after: number | null) {
  if (before === null || after === null || before === after) return null;
  const delta = after - before;
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} mi`;
}

export interface AgentActivityProps {
  receipt: TransactionReceipt;
  canUndo: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * Renders the agent's transaction receipt so the person can see exactly which
 * stages landed and which were killed. Without this the receipt is legible
 * only to the agent that caused it.
 */
export function AgentActivity({
  receipt,
  canUndo,
  onUndo,
  onDismiss,
}: AgentActivityProps) {
  const interrupted = receipt.status === "interrupted";
  const price = deltaLabel(
    receipt.beforeSummary.vehicleTotal,
    receipt.afterSummary.vehicleTotal,
  );
  const range = rangeDeltaLabel(
    receipt.beforeSummary.rangeMiles,
    receipt.afterSummary.rangeMiles,
  );

  return (
    <aside className="agent-activity" data-status={receipt.status}>
      <header>
        <Sparkles aria-hidden="true" />
        <div>
          <strong>
            {interrupted ? "You interrupted the agent" : "Agent updated the build"}
          </strong>
          <small>
            {receipt.completedStages.length} of{" "}
            {receipt.completedStages.length + receipt.skippedStages.length} steps
            applied · rev {receipt.beforeSummary.revision} →{" "}
            {receipt.afterSummary.revision}
          </small>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss agent activity">
          <X aria-hidden="true" />
        </button>
      </header>

      <ol className="agent-activity__stages">
        {receipt.completedStages.map((stage) => (
          <li key={`done-${stage.index}`} data-state="done">
            <Check aria-hidden="true" />
            <span>{stage.label}</span>
            <small>rev {stage.revision}</small>
          </li>
        ))}
        {receipt.skippedStages.map((stage) => (
          <li key={`skipped-${stage.index}`} data-state="skipped">
            <Minus aria-hidden="true" />
            <span>{stage.label}</span>
            <small>not applied</small>
          </li>
        ))}
      </ol>

      {interrupted && receipt.interruptionReason && (
        <p className="agent-activity__reason">
          Stopped: {receipt.interruptionReason.replace(/_/gu, " ")}
        </p>
      )}

      {(price || range) && (
        <p className="agent-activity__delta">
          {price && <span>{price}</span>}
          {range && <span>{range}</span>}
        </p>
      )}

      {canUndo && (
        <button className="agent-activity__undo" type="button" onClick={onUndo}>
          <Undo2 aria-hidden="true" /> Undo these changes
        </button>
      )}
    </aside>
  );
}
