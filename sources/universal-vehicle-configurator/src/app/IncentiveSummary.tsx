import { AlertCircle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type {
  Catalog,
  IncentiveOutcome,
  ResolvedIncentives,
} from "../domain/catalog.types";
import { formatCurrency } from "./presentation";

/**
 * Human wording for the buyer facts the engine refuses to guess. Keys are the
 * dotted paths resolve.ts reports in IncentiveOutcome.missingContext.
 */
const CONTEXT_LABELS: Record<string, string> = {
  "buyer.state": "your state",
  "buyer.utility": "your electric utility",
  "buyer.chargingSituation": "your home charging setup",
  "buyer.financing": "whether you are financing",
  "buyer.evExperience": "your EV experience",
};

function contextLabel(key: string) {
  return CONTEXT_LABELS[key] ?? key.replace(/^buyer\./u, "");
}

function joinList(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function amountLabel(outcome: IncentiveOutcome) {
  if (typeof outcome.amount === "number") return formatCurrency(outcome.amount);
  return "Varies";
}

interface BucketProps {
  title: string;
  hint: string;
  tone: "matched" | "potential" | "expired" | "ineligible";
  outcomes: IncentiveOutcome[];
  catalog: Catalog;
}

function toneIcon(tone: BucketProps["tone"]) {
  if (tone === "matched") return <CheckCircle2 aria-hidden="true" />;
  if (tone === "potential") return <CircleHelp aria-hidden="true" />;
  if (tone === "expired") return <AlertCircle aria-hidden="true" />;
  return <XCircle aria-hidden="true" />;
}

function IncentiveBucket({ title, hint, tone, outcomes, catalog }: BucketProps) {
  if (outcomes.length === 0) return null;

  return (
    <section className="incentives__bucket" data-tone={tone}>
      <header>
        {toneIcon(tone)}
        <div>
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
      </header>
      <ul>
        {outcomes.map((outcome) => {
          const sources = outcome.sourceIds
            .map((id) => catalog.sources.find((source) => source.id === id))
            .filter((source) => source !== undefined);

          return (
            <li key={outcome.id}>
              <div className="incentives__row">
                <span className="incentives__label">{outcome.label}</span>
                <span className="incentives__amount" data-confidence={outcome.confidence}>
                  {amountLabel(outcome)}
                </span>
              </div>

              {tone === "potential" && outcome.missingContext.length > 0 ? (
                <p className="incentives__why">
                  Needs {joinList(outcome.missingContext.map(contextLabel))}. Set it
                  above and this recalculates.
                </p>
              ) : tone === "matched" ? null : (
                <p className="incentives__why">{outcome.reason}</p>
              )}

              {outcome.estimateNote && (
                <p className="incentives__note">{outcome.estimateNote}</p>
              )}
              {outcome.notes && <p className="incentives__note">{outcome.notes}</p>}

              <p className="incentives__meta">
                <span data-confidence={outcome.confidence}>{outcome.confidence}</span>
                {outcome.claim && <span>claimed via {outcome.claim.replace(/_/gu, " ")}</span>}
                {sources.map((source) => (
                  <a key={source.id} href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title}
                  </a>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface IncentiveSummaryProps {
  catalog: Catalog;
  incentives: ResolvedIncentives;
}

export function IncentiveSummary({ catalog, incentives }: IncentiveSummaryProps) {
  const { encodedPredicatesMatched, potentiallyApplicable, expired, ineligible } =
    incentives;

  const total =
    encodedPredicatesMatched.length + potentiallyApplicable.length +
    expired.length + ineligible.length;

  if (total === 0) return null;

  return (
    <div className="incentives">
      <header className="incentives__head">
        <h3>Incentives and credits</h3>
        <p>
          This is a buyer-side estimate. Programs are matched against the build and
          the facts you have given, never assumed.
        </p>
      </header>

      <IncentiveBucket
        title="Applies to this build"
        hint="Every predicate in the program matched"
        tone="matched"
        outcomes={encodedPredicatesMatched}
        catalog={catalog}
      />
      <IncentiveBucket
        title="Could apply"
        hint="Blocked only by a fact we will not guess"
        tone="potential"
        outcomes={potentiallyApplicable}
        catalog={catalog}
      />
      <IncentiveBucket
        title="No longer available"
        hint="Kept so the absence is explained, not hidden"
        tone="expired"
        outcomes={expired}
        catalog={catalog}
      />
      <IncentiveBucket
        title="Does not apply"
        hint="Checked and ruled out for this build"
        tone="ineligible"
        outcomes={ineligible}
        catalog={catalog}
      />

      {incentives.fixedSavings > 0 && (
        <p className="incentives__total">
          Matched fixed savings
          <strong>{formatCurrency(incentives.fixedSavings)}</strong>
        </p>
      )}
    </div>
  );
}
