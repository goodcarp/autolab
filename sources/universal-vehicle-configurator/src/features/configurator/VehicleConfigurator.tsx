import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Route,
  Sparkles,
  X,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { findCompatibleAlternatives } from "../../domain/alternatives";
import type {
  BuyerContextInput,
  Catalog,
  CatalogGroup,
  CatalogOption,
  CompatibleAlternative,
  DomainViolation,
  ResolveResult,
  SelectionInput,
  SelectionPatch,
} from "../../domain/catalog.types";
import { resolve, resolveAtomicPatch } from "../../domain/resolve";
import {
  readableCompatibilityReason,
  trimBuildLabel,
} from "./compatibility-copy";
import "./configurator.css";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const EXPERIENCE_OPTIONS = [
  { id: "new", label: "EV curious", note: "First EV" },
  { id: "familiar", label: "EV familiar", note: "Driven or researched" },
  { id: "owner", label: "EV owner", note: "Already plugged in" },
] as const;

const CROSS_SHOP_OPTIONS = [
  { id: "model_y", label: "Tesla Model Y" },
  { id: "ioniq_5", label: "Hyundai IONIQ 5" },
] as const;

/**
 * The four facts below are the ones catalog incentive predicates actually
 * read. Without them the engine can only ever report "missing context".
 */
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

const UTILITY_OPTIONS = [
  { id: "unknown", label: "Not sure yet" },
  { id: "xcel", label: "Xcel Energy" },
] as const;

const CHARGING_OPTIONS = [
  { id: "unknown", label: "Not sure yet" },
  { id: "home_l2_possible", label: "Can install home Level 2" },
  { id: "home_l1", label: "Standard outlet only" },
  { id: "routine_public", label: "Mostly public charging" },
  { id: "poor_fit", label: "No reliable charging" },
] as const;

const FINANCING_OPTIONS = [
  { id: "unknown", label: "Not sure yet" },
  { id: "yes", label: "Financing or loan" },
  { id: "no", label: "Paying cash" },
] as const;

export interface SelectionChangeMeta {
  source: "option" | "compatible-alternative";
  candidate: ResolveResult;
  changedGroups: string[];
  primaryGroup: string;
  /** Labels of groups changed alongside the one the person clicked. */
  companionChanges?: string[];
}

export interface InvalidSelectionMeta {
  option: CatalogOption;
  candidate: ResolveResult;
  alternatives: CompatibleAlternative[];
}

export interface VehicleConfiguratorProps {
  catalog: Catalog;
  selections: SelectionInput;
  buyerContext?: BuyerContextInput;
  onSelectionPatch: (patch: SelectionPatch, meta: SelectionChangeMeta) => void;
  onBuyerContextChange: (patch: BuyerContextInput) => void;
  onInvalidSelection?: (meta: InvalidSelectionMeta) => void;
  onReviewBuild?: (result: ResolveResult) => void;
  className?: string;
}

type BlockedAttempt = InvalidSelectionMeta & {
  resolutionKey: string;
};

interface OptionProjection {
  patch: SelectionPatch;
  candidate: ResolveResult;
  priceDelta: number;
  rangeDelta: number | null;
  deliveryChanged: boolean;
}

function joinClassNames(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function selectedIds(result: ResolveResult, groupId: string): string[] {
  return result.selections[groupId] ?? [];
}

function selectionForOption(
  group: CatalogGroup,
  option: CatalogOption,
  result: ResolveResult,
): string[] {
  const current = selectedIds(result, group.id);
  if (group.select === "one") return [option.id];
  return current.includes(option.id)
    ? current.filter((id) => id !== option.id)
    : [...current, option.id];
}

function selectionDiff(
  catalog: Catalog,
  current: ResolveResult["selections"],
  next: ResolveResult["selections"],
): SelectionPatch {
  const set: SelectionPatch["set"] = {};
  for (const group of catalog.groups) {
    const before = current[group.id] ?? [];
    const after = next[group.id] ?? [];
    if (before.length !== after.length || before.some((id, index) => id !== after[index])) {
      set[group.id] = [...after];
    }
  }
  return { set };
}

function optionPrice(option: CatalogOption): string {
  if (option.price.mode === "base") return `From ${usd.format(option.price.amount)}`;
  if (option.price.amount === 0) return "Included";
  return `+${usd.format(option.price.amount)}`;
}

function orderabilityLabel(option: CatalogOption): string {
  if (option.orderability === "orderable_now") return "Available";
  if (option.orderability === "notify") return "Notify";
  return "Explore only";
}

function valueAsNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function groupIntro(groupId: string): string {
  if (groupId === "build") return "Choose the balance of range, traction, pace, and timing.";
  if (groupId === "paint") return "Your color can change both price and delivery.";
  if (groupId === "wheels") return "Wheel choice changes the silhouette—and the real range.";
  if (groupId === "interior") return "Set the atmosphere you will live with every day.";
  if (groupId === "towing") return "Add capability without hiding the total cost.";
  return "Make this part of the build yours.";
}

function impactLabel(projection: OptionProjection): string[] {
  if (!projection.candidate.valid) return ["Needs a paired change"];

  const labels: string[] = [];
  if (projection.priceDelta !== 0) {
    labels.push(`${projection.priceDelta > 0 ? "+" : "−"}${usd.format(Math.abs(projection.priceDelta))}`);
  }
  if (projection.rangeDelta !== null && projection.rangeDelta !== 0) {
    labels.push(`${projection.rangeDelta > 0 ? "+" : "−"}${Math.abs(projection.rangeDelta)} mi`);
  }
  if (projection.deliveryChanged && projection.candidate.delivery) {
    labels.push(projection.candidate.delivery.window);
  }
  return labels.length > 0 ? labels : ["Compatible"];
}

function describeAlternative(
  alternative: CompatibleAlternative,
  attempted: ResolveResult,
  catalog: Catalog,
): string {
  const changes = alternative.changedGroups.flatMap((groupId) => {
    const before = attempted.selections[groupId] ?? [];
    const after = alternative.selections[groupId] ?? [];
    if (before.join("|") === after.join("|")) return [];
    return after.map((id) => catalog.options.find((option) => option.id === id)?.label ?? id);
  });
  return changes.length > 0 ? changes.map(trimBuildLabel).join(" + ") : "Compatible configuration";
}

function PaintSwatch({ option }: { option: CatalogOption }) {
  return (
    <span
      className="config-option__paint"
      style={{ "--swatch": option.render?.hex ?? "#d8d8d2" } as React.CSSProperties}
      aria-hidden="true"
    >
      <span />
    </span>
  );
}

function WheelGlyph({ selected }: { selected: boolean }) {
  return (
    <span className="config-option__wheel" data-selected={selected || undefined} aria-hidden="true">
      <span className="config-option__wheel-hub" />
    </span>
  );
}

function InteriorSwatch({ option }: { option: CatalogOption }) {
  const isLight = option.id.includes("coastal");
  return (
    <span className="config-option__interior" data-light={isLight || undefined} aria-hidden="true">
      <span />
    </span>
  );
}

function OptionVisual({ groupId, option, selected }: { groupId: string; option: CatalogOption; selected: boolean }) {
  if (groupId === "paint") return <PaintSwatch option={option} />;
  if (groupId === "wheels") return <WheelGlyph selected={selected} />;
  if (groupId === "interior") return <InteriorSwatch option={option} />;
  if (groupId === "towing") {
    return (
      <span className="config-option__capability" aria-hidden="true">
        <Route />
      </span>
    );
  }
  return null;
}

interface ConfigurationGroupProps {
  group: CatalogGroup;
  options: CatalogOption[];
  result: ResolveResult;
  projections: Map<string, OptionProjection>;
  onChoose: (group: CatalogGroup, option: CatalogOption) => void;
  fieldsetId: string;
}

function ConfigurationGroup({
  group,
  options,
  result,
  projections,
  onChoose,
  fieldsetId,
}: ConfigurationGroupProps) {
  const activeIds = selectedIds(result, group.id);
  return (
    <fieldset className={joinClassNames("config-group", `config-group--${group.id}`)} aria-describedby={`${fieldsetId}-intro`}>
      <legend>
        <span className="config-group__number" aria-hidden="true" />
        <span>{group.label}</span>
      </legend>
      <p id={`${fieldsetId}-intro`} className="config-group__intro">
        {groupIntro(group.id)}
      </p>
      <div className="config-group__options">
        {options.map((option) => {
          const selected = activeIds.includes(option.id);
          const projection = projections.get(option.id);
          const impacts = projection && !selected ? impactLabel(projection) : [];
          const hasEstimate = option.price.confidence === "estimated";
          return (
            <label
              className="config-option"
              data-selected={selected || undefined}
              data-kind={group.id}
              data-invalid={projection && !projection.candidate.valid && !selected ? true : undefined}
              key={option.id}
            >
              <input
                type={group.select === "one" ? "radio" : "checkbox"}
                name={`config-${fieldsetId}`}
                value={option.id}
                checked={selected}
                onChange={() => onChoose(group, option)}
                aria-label={`${option.label}, ${optionPrice(option)}`}
              />
              <OptionVisual groupId={group.id} option={option} selected={selected} />
              <span className="config-option__body">
                <span className="config-option__heading">
                  <strong>{group.id === "build" ? trimBuildLabel(option.label) : option.label}</strong>
                  <span className="config-option__price">
                    {hasEstimate && <abbr title="Estimated">Est.</abbr>} {optionPrice(option)}
                  </span>
                </span>
                {option.copy?.short && <span className="config-option__description">{option.copy.short}</span>}
                <span className="config-option__meta">
                  <span data-orderability={option.orderability}>{orderabilityLabel(option)}</span>
                  {impacts.map((impact) => (
                    <span key={impact} className="config-option__impact">
                      {impact}
                    </span>
                  ))}
                </span>
              </span>
              <span className="config-option__check" aria-hidden="true">
                {selected ? <Check /> : <ChevronRight />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface CompatibilityGuideProps {
  blocked: BlockedAttempt;
  catalog: Catalog;
  onApply: (alternative: CompatibleAlternative) => void;
  onDismiss: () => void;
}

function CompatibilityGuide({ blocked, catalog, onApply, onDismiss }: CompatibilityGuideProps) {
  const errors = blocked.candidate.violations.filter((violation) => violation.severity === "error");
  return (
    <aside className="compatibility-guide" role="alert" aria-label="Compatibility guidance">
      <button className="compatibility-guide__close" type="button" onClick={onDismiss} aria-label="Dismiss compatibility guidance">
        <X aria-hidden="true" />
      </button>
      <span className="compatibility-guide__kicker">
        <AlertTriangle aria-hidden="true" /> One more choice
      </span>
      <h3>{trimBuildLabel(blocked.option.label)} needs a companion change.</h3>
      <ul className="compatibility-guide__reasons">
        {errors.map((violation: DomainViolation) => (
          <li key={`${violation.rule}-${violation.option ?? violation.group ?? "build"}`}>
            {readableCompatibilityReason(violation, catalog)}
          </li>
        ))}
      </ul>
      {blocked.alternatives.length > 0 && (
        <div className="compatibility-guide__alternatives">
          <span>Compatible paths</span>
          {blocked.alternatives.slice(0, 3).map((alternative) => {
            const label = describeAlternative(alternative, blocked.candidate, catalog);
            return (
              <button
                type="button"
                key={JSON.stringify(alternative.selections)}
                onClick={() => onApply(alternative)}
              >
                <span>
                  <strong>{label}</strong>
                  <small>
                    {alternative.priceDelta === 0
                      ? "No price change"
                      : `${alternative.priceDelta > 0 ? "+" : "−"}${usd.format(Math.abs(alternative.priceDelta))}`}
                    {alternative.rangeDelta !== null && alternative.rangeDelta !== 0
                      ? ` · ${alternative.rangeDelta > 0 ? "+" : "−"}${Math.abs(alternative.rangeDelta)} mi`
                      : ""}
                  </small>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

interface BuyerContextPanelProps {
  result: ResolveResult;
  onChange: (patch: BuyerContextInput) => void;
  instanceId: string;
}

function BuyerContextPanel({ result, onChange, instanceId }: BuyerContextPanelProps) {
  const crossShops = result.buyerContext.crossShopIds;
  return (
    <fieldset className="buyer-context" aria-describedby={`${instanceId}-buyer-intro`}>
      <legend>
        <Sparkles aria-hidden="true" /> Tune the guidance
      </legend>
      <p id={`${instanceId}-buyer-intro`}>
        Incentives are jurisdiction- and situation-specific. Tell us only what you
        actually know and the engine will explain the rest rather than guess.
      </p>
      <div className="buyer-context__grid">
        <label className="buyer-context__field">
          <span className="buyer-context__label">Your state</span>
          <select
            value={result.buyerContext.state}
            onChange={(event) =>
              onChange({
                state: event.target.value as BuyerContextInput["state"],
              })
            }
          >
            <option value="unknown">Not set</option>
            {US_STATES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="buyer-context__field">
          <span className="buyer-context__label">Electric utility</span>
          <select
            value={result.buyerContext.utility}
            onChange={(event) =>
              onChange({
                utility: event.target.value as BuyerContextInput["utility"],
              })
            }
          >
            {UTILITY_OPTIONS.map((utility) => (
              <option key={utility.id} value={utility.id}>
                {utility.label}
              </option>
            ))}
          </select>
        </label>

        <label className="buyer-context__field">
          <span className="buyer-context__label">Home charging</span>
          <select
            value={result.buyerContext.chargingSituation}
            onChange={(event) =>
              onChange({
                chargingSituation: event.target
                  .value as BuyerContextInput["chargingSituation"],
              })
            }
          >
            {CHARGING_OPTIONS.map((charging) => (
              <option key={charging.id} value={charging.id}>
                {charging.label}
              </option>
            ))}
          </select>
        </label>

        <label className="buyer-context__field">
          <span className="buyer-context__label">Paying how</span>
          <select
            value={
              result.buyerContext.financing === "unknown"
                ? "unknown"
                : result.buyerContext.financing
                  ? "yes"
                  : "no"
            }
            onChange={(event) =>
              onChange({
                financing:
                  event.target.value === "unknown"
                    ? "unknown"
                    : event.target.value === "yes",
              })
            }
          >
            {FINANCING_OPTIONS.map((financing) => (
              <option key={financing.id} value={financing.id}>
                {financing.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="buyer-context__block">
        <span className="buyer-context__label">Your EV experience</span>
        <div className="buyer-context__segments">
          {EXPERIENCE_OPTIONS.map((experience) => (
            <label key={experience.id} data-selected={result.buyerContext.evExperience === experience.id || undefined}>
              <input
                type="radio"
                name={`${instanceId}-ev-experience`}
                value={experience.id}
                checked={result.buyerContext.evExperience === experience.id}
                onChange={() => onChange({ evExperience: experience.id })}
              />
              <span>
                <strong>{experience.label}</strong>
                <small>{experience.note}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="buyer-context__block">
        <span className="buyer-context__label">Also considering</span>
        <div className="buyer-context__checks">
          {CROSS_SHOP_OPTIONS.map((vehicle) => {
            const checked = crossShops.includes(vehicle.id);
            return (
              <label key={vehicle.id} data-selected={checked || undefined}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? crossShops.filter((id) => id !== vehicle.id)
                      : [...crossShops, vehicle.id];
                    onChange({ crossShopIds: next });
                  }}
                />
                <span>{vehicle.label}</span>
                <span className="buyer-context__checkmark" aria-hidden="true">
                  <Check />
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

export function VehicleConfigurator({
  catalog,
  selections,
  buyerContext = {},
  onSelectionPatch,
  onBuyerContextChange,
  onInvalidSelection,
  onReviewBuild,
  className,
}: VehicleConfiguratorProps) {
  const instanceId = useId().replace(/:/g, "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState<BlockedAttempt | null>(null);
  const result = useMemo(
    () => resolve(catalog, selections, buyerContext),
    [buyerContext, catalog, selections],
  );
  const resolutionKey = JSON.stringify([result.selections, result.buyerContext]);
  const activeBlocked = blocked?.resolutionKey === resolutionKey ? blocked : null;

  const projections = useMemo(() => {
    const next = new Map<string, OptionProjection>();
    for (const group of catalog.groups) {
      for (const option of catalog.options.filter((candidate) => candidate.group === group.id)) {
        const patch: SelectionPatch = { set: { [group.id]: selectionForOption(group, option, result) } };
        const resolution = resolveAtomicPatch(catalog, result.selections, patch, result.buyerContext);
        const currentRange = valueAsNumber(result.specs.range_mi);
        const nextRange = valueAsNumber(resolution.candidate.specs.range_mi);
        next.set(option.id, {
          patch,
          candidate: resolution.candidate,
          priceDelta: resolution.candidate.price.vehicleTotal - result.price.vehicleTotal,
          rangeDelta: currentRange !== null && nextRange !== null ? nextRange - currentRange : null,
          deliveryChanged: resolution.candidate.delivery?.window !== result.delivery?.window,
        });
      }
    }
    return next;
  }, [catalog, result]);

  const chooseOption = (group: CatalogGroup, option: CatalogOption) => {
    const projection = projections.get(option.id);
    if (!projection) return;
    if (group.select === "one" && selectedIds(result, group.id).includes(option.id)) return;

    if (!projection.candidate.valid) {
      // Keep the choice the person actually made and resolve the build around
      // it. Alternatives that change the clicked group back would undo the
      // pick, so they are never a rescue.
      const rescues = findCompatibleAlternatives(
        catalog,
        projection.candidate.selections,
        result.buyerContext,
        5,
      ).filter((alternative) => !alternative.changedGroups.includes(group.id));

      const rescue = rescues[0];
      if (rescue) {
        applyAlternative(rescue, group.id);
        return;
      }

      // Genuinely unreachable: explain in place, without moving the scroll.
      const attempted: BlockedAttempt = {
        option,
        candidate: projection.candidate,
        alternatives: [],
        resolutionKey,
      };
      setBlocked(attempted);
      onInvalidSelection?.(attempted);
      return;
    }

    setBlocked(null);
    onSelectionPatch(projection.patch, {
      source: "option",
      candidate: projection.candidate,
      changedGroups: [group.id],
      primaryGroup: group.id,
    });
  };

  const applyAlternative = (
    alternative: CompatibleAlternative,
    intendedGroup?: string,
  ) => {
    const patch = selectionDiff(catalog, result.selections, alternative.selections);
    const candidate = resolve(catalog, alternative.selections, result.buyerContext);
    setBlocked(null);
    const changedGroups = Object.keys(patch.set);
    if (changedGroups.length === 0) return;
    const primaryGroup = intendedGroup ?? activeBlocked?.option.group ?? changedGroups[0];
    const companionChanges = changedGroups
      .filter((groupId) => groupId !== primaryGroup)
      .flatMap((groupId) =>
        (patch.set[groupId] ?? []).map((optionId) =>
          trimBuildLabel(
            catalog.options.find((candidateOption) => candidateOption.id === optionId)?.label ??
              optionId,
          ),
        ),
      );
    onSelectionPatch(patch, {
      source: "compatible-alternative",
      candidate,
      changedGroups,
      primaryGroup,
      companionChanges,
    });
  };

  const range = valueAsNumber(result.specs.range_mi);
  const zeroToSixty = valueAsNumber(result.specs.zero_to_sixty_s);
  const horsepower = valueAsNumber(result.specs.hp);
  const selectedBuild = catalog.options.find((option) => option.id === result.selections.build?.[0]);
  const warnings = result.violations.filter((violation) => violation.severity === "warning");

  return (
    <section className={joinClassNames("uvc-configurator", className)} aria-label="Configure Rivian R2">
      <header className="configurator-head">
        <div className="configurator-head__model">
          <span>Configure</span>
          <h2>{catalog.product.model}</h2>
          <p>{selectedBuild ? trimBuildLabel(selectedBuild.label) : catalog.product.body}</p>
        </div>
        <div className="configurator-head__specs" aria-label="Current build specifications">
          <div>
            <strong>{range === null ? "—" : `${range}`}</strong>
            <span>mi range</span>
          </div>
          <div>
            <strong>{zeroToSixty === null ? "—" : number.format(zeroToSixty)}</strong>
            <span>sec 0–60</span>
          </div>
          <div>
            <strong>{horsepower === null ? "—" : horsepower}</strong>
            <span>horsepower</span>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="configurator-scroll">
        {activeBlocked && (
          <CompatibilityGuide
            blocked={activeBlocked}
            catalog={catalog}
            onApply={applyAlternative}
            onDismiss={() => setBlocked(null)}
          />
        )}

        {catalog.groups.map((group, groupIndex) => {
          const options = catalog.options.filter((option) => option.group === group.id);
          return (
            <div className="config-group-wrap" key={group.id} style={{ "--group-number": `"${String(groupIndex + 1).padStart(2, "0")}"` } as React.CSSProperties}>
              <ConfigurationGroup
                group={group}
                options={options}
                result={result}
                projections={projections}
                onChoose={chooseOption}
                fieldsetId={`${instanceId}-${group.id}`}
              />
            </div>
          );
        })}

        {warnings.length > 0 && (
          <div className="configurator-warnings" role="status">
            <Clock3 aria-hidden="true" />
            <div>
              <strong>Timing changed</strong>
              {warnings.map((warning) => <p key={warning.rule}>{warning.message}</p>)}
            </div>
          </div>
        )}

        <BuyerContextPanel
          result={result}
          onChange={(patch) => {
            setBlocked(null);
            onBuyerContextChange(patch);
          }}
          instanceId={instanceId}
        />
      </div>

      <footer className="configurator-total" aria-label="Current build summary">
        <div className="configurator-total__consequences">
          <span>
            <CircleGauge aria-hidden="true" />
            {range === null ? "Range pending" : `${range} mi estimated range`}
          </span>
          <span>
            <Clock3 aria-hidden="true" />
            {result.delivery?.window ?? "Timing to be confirmed"}
          </span>
        </div>
        <div className="configurator-total__price">
          <span>
            <small>Vehicle total</small>
            <strong>{usd.format(result.price.vehicleTotal)}</strong>
          </span>
          <button
            type="button"
            aria-label={`Review ${usd.format(result.price.vehicleTotal)} R2 build`}
            onClick={() => onReviewBuild?.(result)}
          >
            Review build <ArrowRight aria-hidden="true" />
          </button>
        </div>
        <p>
          Includes {usd.format(result.price.destination)}{" "}
          {result.price.confidence.destination === "verified" ? "" : "estimated "}
          destination. Taxes and eligibility vary.
        </p>
      </footer>
    </section>
  );
}
