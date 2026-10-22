import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
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
import { rescueSelection } from "./selection-rescue";

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
  // These are two prices for the same hitch, each tied to a different trim.
  // Choosing the other package replaces it; adding both can never be valid.
  if (group.id === "towing") return current.includes(option.id) ? [] : [option.id];
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

/** Groups drawn as a row of round swatches, the way a real configurator shows them. */
const SWATCH_GROUPS = new Set(["paint", "wheels", "interior"]);

/**
 * A section intro only where it tells the buyer something the choices do not.
 * With a mouse the swatches show a colour's price and delivery only on hover,
 * so Paint says up front that both can move.
 */
function groupIntro(groupId: string): string | null {
  if (groupId === "paint") return "Your color can change both price and delivery.";
  return null;
}

const AVAILABLE_NOW = "Available now";

/** "Late 2026" reads as "Coming late 2026", as on the maker's own configurator. */
function availabilityLabel(window: string): string {
  if (window === AVAILABLE_NOW) return AVAILABLE_NOW;
  return `Coming ${window.charAt(0).toLowerCase()}${window.slice(1)}`;
}

/**
 * What choosing this option would change. A trim card states its own delivery
 * window, so its impact repeats the build's window only when another choice
 * makes the build later than the trim itself.
 */
function impacts(projection: OptionProjection, ownWindow?: string): { text: string; spoken: string }[] {
  if (!projection.candidate.valid) return [{ text: "Needs a paired change", spoken: "needs a paired change" }];

  const list: { text: string; spoken: string }[] = [];
  if (projection.rangeDelta !== null && projection.rangeDelta !== 0) {
    const text = `${projection.rangeDelta > 0 ? "+" : "−"}${Math.abs(projection.rangeDelta)} mi`;
    list.push({ text, spoken: `range ${text}` });
  }
  const window = projection.candidate.delivery?.window;
  if (projection.deliveryChanged && window && window !== ownWindow) {
    list.push({ text: window, spoken: `delivery ${window}` });
  }
  return list;
}

/**
 * What a swatch's card shows besides its name and price, as one sentence for
 * its input's description: orderability and what choosing it would change.
 */
function swatchDetails(option: CatalogOption, changes: { spoken: string }[]): string | null {
  const parts = [
    ...(option.orderability !== "orderable_now" ? [orderabilityLabel(option)] : []),
    ...changes.map((change) => change.spoken),
  ];
  if (parts.length === 0) return null;
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
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

/**
 * One glyph per rim, drawn to match what the showroom's `styleWheels` puts on
 * the car: the spoke count, the split-spoke doubling and the finish colours
 * are the same ones `WHEEL_FINISHES` uses, so the card and the 3D wheel agree.
 */
type WheelGlyphSpec = {
  spokes: number;
  spokeWidth: number;
  twin: boolean;
  face: string;
  pocket: string;
  lip: string;
  tyre: number;
  machined?: boolean;
};

const WHEEL_GLYPHS: Record<string, WheelGlyphSpec> = {
  // 21" Liquid Tungsten: five broad spokes, warm-grey satin.
  "wheels.lt21_as": { spokes: 5, spokeWidth: 5.2, twin: false, face: "#8d969b", pocket: "#26292b", lip: "#a9b1b5", tyre: 4.6 },
  // 20" Black Sand all-terrain: six chunky spokes on a heavier tyre.
  "wheels.bs20_at": { spokes: 6, spokeWidth: 6.4, twin: false, face: "#3a3f42", pocket: "#151719", lip: "#4d5356", tyre: 7.2 },
  // 20" Bicolor Carbon: five paired (ten) fine spokes, bright face over a dark pocket.
  "wheels.bc20_as": { spokes: 5, spokeWidth: 2.4, twin: true, face: "#c3cacf", pocket: "#141618", lip: "#d6dce0", tyre: 4.6 },
  // 19" Machined Graphite: ten-spoke, graphite with a machined bright edge.
  "wheels.mg19_as": { spokes: 5, spokeWidth: 3.2, twin: true, face: "#6a7276", pocket: "#202325", lip: "#b7bec2", tyre: 5.2, machined: true },
};

const DEFAULT_WHEEL_GLYPH: WheelGlyphSpec = WHEEL_GLYPHS["wheels.lt21_as"];

function WheelGlyph({ option, selected }: { option: CatalogOption; selected: boolean }) {
  const spec = WHEEL_GLYPHS[option.id] ?? DEFAULT_WHEEL_GLYPH;
  const size = 50;
  const c = size / 2;
  const tyreOuter = c - 1;
  const rimR = tyreOuter - spec.tyre;
  const hubR = 4.2;
  const spokeLen = rimR - 1.2;
  const angles: number[] = [];
  const step = 360 / spec.spokes;
  for (let i = 0; i < spec.spokes; i += 1) {
    const base = -90 + i * step;
    if (spec.twin) {
      angles.push(base - step * 0.18, base + step * 0.18);
    } else {
      angles.push(base);
    }
  }
  return (
    <span className="config-option__wheel" data-selected={selected || undefined} aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" focusable="false">
        <circle cx={c} cy={c} r={tyreOuter} fill="#1c1f1e" />
        <circle cx={c} cy={c} r={tyreOuter - 0.8} fill="none" stroke="#2c302e" strokeWidth={spec.tyre * 0.55} />
        <circle cx={c} cy={c} r={rimR} fill={spec.pocket} stroke={spec.lip} strokeWidth={1.6} />
        {angles.map((angle) => (
          <rect
            key={angle}
            x={c - spec.spokeWidth / 2}
            y={c - spokeLen}
            width={spec.spokeWidth}
            height={spokeLen}
            rx={spec.spokeWidth / 2}
            fill={spec.face}
            transform={`rotate(${angle + 90} ${c} ${c})`}
          />
        ))}
        {spec.machined && angles.map((angle) => (
          <rect
            key={`edge-${angle}`}
            x={c - spec.spokeWidth / 2}
            y={c - spokeLen}
            width={0.9}
            height={spokeLen}
            fill={spec.lip}
            opacity={0.85}
            transform={`rotate(${angle + 90} ${c} ${c})`}
          />
        ))}
        <circle cx={c} cy={c} r={hubR} fill={spec.face} stroke={spec.lip} strokeWidth={1} />
        <circle cx={c} cy={c} r={hubR * 0.42} fill={spec.pocket} />
      </svg>
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
  if (groupId === "wheels") return <WheelGlyph option={option} selected={selected} />;
  if (groupId === "interior") return <InteriorSwatch option={option} />;
  if (groupId === "towing") {
    return (
      <span className="config-option__capability" aria-hidden="true">
        {selected ? <Check /> : <Plus />}
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
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function ConfigurationGroup({
  group,
  options,
  result,
  projections,
  onChoose,
  fieldsetId,
  collapsible,
  expanded,
  onToggle,
}: ConfigurationGroupProps) {
  const activeIds = selectedIds(result, group.id);
  const isTowing = group.id === "towing";
  const isBuild = group.id === "build";
  const swatches = SWATCH_GROUPS.has(group.id);
  const orderedOptions = isTowing
    ? [...options].sort((a, b) => Number(!projections.get(a.id)?.candidate.valid) - Number(!projections.get(b.id)?.candidate.valid))
    : options;
  const selectedOptions = options.filter((option) => activeIds.includes(option.id));
  const current = selectedOptions[0];
  const selectedLabel = selectedOptions
    .map((option) => isTowing ? `Tow package · ${optionPrice(option)}` : trimBuildLabel(option.label)).join(", ") || "None";
  const intro = groupIntro(group.id);
  const introId = `${fieldsetId}-intro`;
  const range = valueAsNumber(result.specs.range_mi);
  return (
    <fieldset className={joinClassNames("config-group", `config-group--${group.id}`)}
      data-layout={swatches ? "swatches" : "cards"} aria-label={group.label}
      aria-describedby={expanded && intro ? introId : undefined}>
      <legend>
        {collapsible ? (
          <button className="config-group__toggle" type="button" aria-label={`${group.label} options`}
            aria-expanded={expanded} aria-controls={`${fieldsetId}-choices`} onClick={onToggle}>
            <span><strong>{group.label}</strong><small>{selectedLabel}</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
        ) : <span>{group.label}</span>}
      </legend>
      <div id={`${fieldsetId}-choices`} hidden={collapsible && !expanded}>
      {swatches && current && (
        // The reference heading row: the chosen name on the left, its price on the right.
        <p className="config-group__current">
          <span>
            {current.label}
            {current.orderability !== "orderable_now" && (
              <small className="config-group__current-orderability" data-orderability={current.orderability}>
                {orderabilityLabel(current)}
              </small>
            )}
          </span>
          <span className="config-group__current-price">
            {current.price.confidence === "estimated" && <abbr title="Estimated">Est.</abbr>}
            {optionPrice(current)}
          </span>
        </p>
      )}
      {intro && <p id={introId} className="config-group__intro">{intro}</p>}
      <div className="config-group__options">
        {orderedOptions.map((option) => {
          const selected = activeIds.includes(option.id);
          const projection = projections.get(option.id);
          const ownWindow = isBuild ? option.delivery?.window : undefined;
          const changes = projection && !selected && !isTowing ? impacts(projection, ownWindow) : [];
          const impactTexts = changes.map((change) => change.text);
          // A swatch's card is hover-only on a mouse, so its input also
          // carries the card's orderability and impacts as a description.
          const details = swatches ? swatchDetails(option, changes) : null;
          const detailsId = `${fieldsetId}-${option.id}-details`;
          const otherBuild = isTowing && !selected && !projection?.candidate.valid;
          const launchPackage = option.id === "towing.launch_included";
          const towingNote = launchPackage
            ? otherBuild ? "Requires Performance with Launch Package." : "Included with your Performance Launch Package."
            : otherBuild ? "Requires Standard or Premium. Availability unconfirmed." : "Availability unconfirmed.";
          const description = isTowing ? "Hitch + towing software" : option.copy?.short;
          // A trim card shows its description once chosen; the others keep it
          // for screen readers so the stack stays one compact card per trim.
          const descriptionId = `${fieldsetId}-${option.id}-description`;
          const descriptionVisible = !isBuild || selected;
          // One price per choice: a valid alternative previews the actual total
          // change; a selected or paired-change choice retains its catalog quote.
          const comparesCurrent = !isTowing && !selected && projection?.candidate.valid;
          const priceLabel = comparesCurrent
            ? projection.priceDelta === 0 ? "No price change"
              : `${projection.priceDelta > 0 ? "+" : "−"}${usd.format(Math.abs(projection.priceDelta))}`
            : optionPrice(option);
          const priceBasis = isTowing ? null : comparesCurrent
            ? projection.priceDelta === 0 ? null : "vs current"
            : option.price.mode === "delta" && option.price.amount !== 0 ? "option price" : null;
          const hasEstimate = option.price.confidence === "estimated"
            || Boolean(comparesCurrent && options.some((current) =>
              activeIds.includes(current.id) && current.price.confidence === "estimated"
              && !projection.candidate.selections[group.id]?.includes(current.id)));
          const accessiblePrice = `${hasEstimate ? "Estimated " : ""}${priceLabel}${priceBasis ? ` ${priceBasis}` : ""}`;
          const describedBy = isTowing
            ? `${fieldsetId}-${option.id}-eligibility`
            : isBuild && description && !descriptionVisible ? descriptionId
              : details ? detailsId : undefined;
          const meta = !isTowing && (option.orderability !== "orderable_now" || impactTexts.length > 0) && <span className="config-option__meta">
            {option.orderability !== "orderable_now" && <span data-orderability={option.orderability}>{orderabilityLabel(option)}</span>}
            {impactTexts.map((impact) => (
              <span key={impact} className="config-option__impact">
                {impact}
              </span>
            ))}
          </span>;
          return (
            <label
              className="config-option"
              data-selected={selected || undefined}
              data-kind={group.id}
              data-secondary={otherBuild || undefined}
              data-invalid={projection && !projection.candidate.valid && !selected ? true : undefined}
              key={option.id}
            >
              <input
                type={group.select === "one" ? "radio" : "checkbox"}
                name={`config-${fieldsetId}`}
                value={option.id}
                checked={selected}
                onChange={() => onChoose(group, option)}
                aria-label={`${option.label}, ${accessiblePrice}`}
                aria-describedby={describedBy}
              />
              <OptionVisual groupId={group.id} option={option} selected={selected} />
              {details && <span id={detailsId} className="config-sr-only" aria-hidden="true">{details}</span>}
              {/* On a swatch this body is a hover card with a mouse, and a
                  row of the list under the swatches on touch or while the
                  keyboard is in the row. */}
              <span className="config-option__body">
                {swatches && (
                  <span className="config-option__mini" aria-hidden="true">
                    <OptionVisual groupId={group.id} option={option} selected={false} />
                  </span>
                )}
                {otherBuild && <span className="config-option__other-builds">Other builds</span>}
                <span className="config-option__heading">
                  <strong>{isTowing ? "Tow package" : isBuild ? trimBuildLabel(option.label) : option.label}</strong>
                  <span className="config-option__price">
                    {hasEstimate && <abbr title="Estimated">Est.</abbr>}
                    <span className="config-option__amount">{priceLabel}</span>
                    {priceBasis && <small className="config-option__price-basis">{priceBasis}</small>}
                  </span>
                </span>
                {description && !swatches && (
                  <span className={descriptionVisible ? "config-option__description" : "config-option__description config-sr-only"}
                    id={descriptionVisible ? undefined : descriptionId}>{description}</span>
                )}
                {isTowing && <span className="config-option__eligibility" id={`${fieldsetId}-${option.id}-eligibility`}>{towingNote}</span>}
                {otherBuild && <span className="config-option__explore">View compatible build</span>}
                {!isBuild && meta}
              </span>
              {isBuild && (
                <span className="config-option__side">
                  {option.delivery && (
                    <span className="config-option__availability" data-now={option.delivery.window === AVAILABLE_NOW || undefined}>
                      {availabilityLabel(option.delivery.window)}
                    </span>
                  )}
                  {meta}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {swatches && current?.copy?.short && <p className="config-group__note">{current.copy.short}</p>}
      {group.id === "wheels" && (
        // Wheels change the real range, so the section states it, as the reference does.
        <p className="config-group__range">
          <span>Est. range</span>
          <strong>{range === null ? "Pending" : `${range} mi`}</strong>
        </p>
      )}
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
  const isTowing = blocked.option.group === "towing";
  return (
    <aside className="compatibility-guide" role="alert" aria-label="Compatibility guidance">
      <button className="compatibility-guide__close" type="button" onClick={onDismiss} aria-label="Dismiss compatibility guidance">
        <X aria-hidden="true" />
      </button>
      <span className="compatibility-guide__kicker">
        <AlertTriangle aria-hidden="true" /> One more choice
      </span>
      <h3>{isTowing ? "This tow package requires a different build." : `${trimBuildLabel(blocked.option.label)} needs a companion change.`}</h3>
      <ul className="compatibility-guide__reasons">
        {isTowing ? <li>{blocked.option.id === "towing.launch_included"
          ? "The included package is part of the Performance Launch Package."
          : "The standalone package requires a Standard or Premium build. Availability is unconfirmed."}</li> : errors.map((violation: DomainViolation) => (
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
                  <strong>{isTowing ? `Switch to ${label}` : label}</strong>
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

export function BuyerContextPanel({ result, onChange, instanceId }: BuyerContextPanelProps) {
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
  const collapsible = useSyncExternalStore(subscribeToStackedLayout, isStackedLayout, () => false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>("build");
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
      const rescue = rescueSelection(catalog, projection.candidate, group.id);
      if (rescue && group.id !== "towing") {
        applyAlternative(rescue, group.id);
        return;
      }
      const rescued = rescue ? resolve(catalog, rescue.selections, result.buyerContext) : null;
      const rescuedRange = valueAsNumber(rescued?.specs.range_mi);
      const currentRange = valueAsNumber(result.specs.range_mi);

      // A towing exploration must not silently replace the person's trim.
      // Keep the existing compatibility choice explicit, with its real delta.
      const attempted: BlockedAttempt = {
        option,
        candidate: projection.candidate,
        alternatives: rescue && rescued ? [{
          ...rescue,
          priceDelta: rescued.price.vehicleTotal - result.price.vehicleTotal,
          rangeDelta: rescuedRange !== null && currentRange !== null ? rescuedRange - currentRange : null,
        }] : [],
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
        (patch.set[groupId] ?? []).length === 0
          ? [`${catalog.groups.find((group) => group.id === groupId)?.label ?? groupId} to None`]
          : (patch.set[groupId] ?? []).map((optionId) =>
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

  const deliveryWindow = result.delivery?.window ?? null;

  return (
    <section className={joinClassNames("uvc-configurator", className)} aria-label="Configure Hudian RX2">
      <div className="configurator-scroll">
        {/* The head scrolls with the choices; only the review footer stays put. */}
        <header className="configurator-head">
          <div className="configurator-head__model">
            <h2>{catalog.product.model}</h2>
            <p>{selectedBuild ? trimBuildLabel(selectedBuild.label) : catalog.product.body}</p>
          </div>
          <div className="configurator-head__specs" aria-label="Current build specifications">
            <div>
              <strong>{range === null ? "—" : `${range} mi`}</strong>
              <span>Est. range</span>
            </div>
            <div>
              <strong>{zeroToSixty === null ? "—" : `${number.format(zeroToSixty)} sec`}</strong>
              <span>0–60 mph</span>
            </div>
            <div>
              <strong>{horsepower === null ? "—" : horsepower}</strong>
              <span>hp</span>
            </div>
          </div>
          <p className="configurator-head__price">
            <span>{usd.format(result.price.vehicleTotal)}</span>
            <small>Vehicle total · includes destination</small>
          </p>
        </header>

        {activeBlocked && activeBlocked.option.group !== "towing" && (
          <CompatibilityGuide
            blocked={activeBlocked}
            catalog={catalog}
            onApply={applyAlternative}
            onDismiss={() => setBlocked(null)}
          />
        )}

        {catalog.groups.map((group) => {
          const options = catalog.options.filter((option) => option.group === group.id);
          return (
            <div className="config-group-wrap" key={group.id}>
              <ConfigurationGroup
                group={group}
                options={options}
                result={result}
                projections={projections}
                onChoose={chooseOption}
                fieldsetId={`${instanceId}-${group.id}`}
                collapsible={collapsible}
                expanded={!collapsible || expandedGroup === group.id}
                onToggle={() => setExpandedGroup((current) => current === group.id ? null : group.id)}
              />
              {group.id === "towing" && activeBlocked?.option.group === "towing" && (
                <CompatibilityGuide blocked={activeBlocked} catalog={catalog}
                  onApply={applyAlternative} onDismiss={() => setBlocked(null)} />
              )}
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

        <details className="buyer-disclosure">
          <summary>Tune the guidance <ChevronDown aria-hidden="true" /></summary>
          <BuyerContextPanel
          result={result}
          onChange={(patch) => {
            setBlocked(null);
            onBuyerContextChange(patch);
          }}
          instanceId={instanceId}
        />
        </details>
      </div>

      <footer className="configurator-total" aria-label="Current build summary">
        <div className="configurator-total__price">
          <span className="configurator-total__figure">
            <small>Vehicle total</small>
            <span className="configurator-total__line">
              <strong>{usd.format(result.price.vehicleTotal)}</strong>
              <span className="configurator-total__delivery" data-now={deliveryWindow === AVAILABLE_NOW || undefined}>
                {deliveryWindow ?? "Timing to be confirmed"}
              </span>
            </span>
          </span>
          <button
            type="button"
            aria-label={`Review ${usd.format(result.price.vehicleTotal)} RX2 build`}
            disabled={!result.valid || !onReviewBuild}
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

function isStackedLayout() {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 980px)").matches;
}

function subscribeToStackedLayout(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia("(max-width: 980px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
