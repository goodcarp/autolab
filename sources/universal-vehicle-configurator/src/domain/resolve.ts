import type {
  BuyerContext,
  BuyerContextInput,
  CanonicalSelections,
  Catalog,
  CatalogEffect,
  CatalogIncentive,
  CatalogOption,
  Confidence,
  DomainViolation,
  IncentiveOutcome,
  JsonValue,
  NormalizedSelections,
  PatchResolution,
  ResolvedIncentives,
  ResolvedPrice,
  ResolveResult,
  SelectionInput,
  SelectionPatch,
} from "./catalog.types";
import {
  evaluateExpression,
  evaluateExpressionTruth,
  explainExpression,
  missingBuyerContextPaths,
  type ExpressionContext,
} from "./expression";

const EV_EXPERIENCE = ["new", "familiar", "owner", "unknown"] as const;
const CHARGING_SITUATIONS = [
  "home_l2_possible",
  "home_l1",
  "routine_public",
  "poor_fit",
  "unknown",
] as const;
const USE_CASES = ["road_trip", "towing", "commute", "snow"] as const;
const PRIORITIES = ["range", "delivery", "price", "performance", "comfort"] as const;
const COMPETITORS = ["model_y", "ioniq_5"] as const;
const UTILITIES = ["xcel"] as const;
const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

const BUYER_CONTEXT_KEYS = new Set([
  "evExperience",
  "state",
  "utility",
  "chargingSituation",
  "useCases",
  "priorities",
  "financing",
  "crossShopIds",
]);

export class BuyerContextValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid buyer context: ${issues.join("; ")}`);
    this.name = "BuyerContextValidationError";
    this.issues = issues;
  }
}

export function createDefaultBuyerContext(): BuyerContext {
  return {
    evExperience: "unknown",
    state: "unknown",
    utility: "unknown",
    chargingSituation: "unknown",
    useCases: [],
    priorities: [],
    financing: "unknown",
    crossShopIds: [],
  };
}

function canonicalEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  issues: string[],
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return [];
  }

  const allowedSet = new Set<string>(allowed);
  const values = value.filter((entry): entry is T => {
    const valid = typeof entry === "string" && allowedSet.has(entry);
    if (!valid) issues.push(`${field} contains unsupported value ${JSON.stringify(entry)}`);
    return valid;
  });

  const chosen = new Set(values);
  return allowed.filter((entry) => chosen.has(entry));
}

export function normalizeBuyerContext(input: BuyerContextInput = {}): BuyerContext {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new BuyerContextValidationError(["buyer context must be an object"]);
  }

  const issues: string[] = [];
  for (const key of Object.keys(input)) {
    if (!BUYER_CONTEXT_KEYS.has(key)) issues.push(`unknown field '${key}'`);
  }

  const defaults = createDefaultBuyerContext();
  const evExperience = input.evExperience ?? defaults.evExperience;
  if (!(EV_EXPERIENCE as readonly unknown[]).includes(evExperience)) {
    issues.push(`evExperience must be one of ${EV_EXPERIENCE.join(", ")}`);
  }

  const state = input.state ?? defaults.state;
  if (state !== "unknown" && (typeof state !== "string" || !US_STATE_CODES.has(state))) {
    issues.push("state must be a two-letter US state code or 'unknown'");
  }

  const utility = input.utility ?? defaults.utility;
  if (utility !== "unknown" && !(UTILITIES as readonly unknown[]).includes(utility)) {
    issues.push(`utility must be one of ${UTILITIES.join(", ")} or unknown`);
  }

  const chargingSituation = input.chargingSituation ?? defaults.chargingSituation;
  if (!(CHARGING_SITUATIONS as readonly unknown[]).includes(chargingSituation)) {
    issues.push(`chargingSituation must be one of ${CHARGING_SITUATIONS.join(", ")}`);
  }

  const financing = input.financing ?? defaults.financing;
  if (financing !== "unknown" && typeof financing !== "boolean") {
    issues.push("financing must be boolean or 'unknown'");
  }

  const useCases = canonicalEnumArray(input.useCases, USE_CASES, "useCases", issues);
  const priorities = canonicalEnumArray(input.priorities, PRIORITIES, "priorities", issues);
  const crossShopIds = canonicalEnumArray(input.crossShopIds, COMPETITORS, "crossShopIds", issues);

  if (issues.length > 0) throw new BuyerContextValidationError(issues);

  return {
    evExperience: evExperience as BuyerContext["evExperience"],
    state: state as BuyerContext["state"],
    utility: utility as BuyerContext["utility"],
    chargingSituation: chargingSituation as BuyerContext["chargingSituation"],
    useCases,
    priorities,
    financing,
    crossShopIds,
  };
}

export function normalizeSelections(catalog: Catalog, input: SelectionInput = {}): NormalizedSelections {
  const groupsById = new Map(catalog.groups.map((group) => [group.id, group]));
  const optionsById = new Map(catalog.options.map((option) => [option.id, option]));
  const optionOrder = new Map(catalog.options.map((option, index) => [option.id, index]));
  const violations: DomainViolation[] = [];
  const selections: CanonicalSelections = {};

  for (const groupId of Object.keys(input)) {
    if (!groupsById.has(groupId)) {
      violations.push({
        rule: "group.unknown",
        group: groupId,
        message: `No such group '${groupId}'.`,
        severity: "error",
      });
    }
  }

  for (const group of catalog.groups) {
    const raw = input[group.id];
    let ids: unknown[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (raw === undefined && group.default !== undefined) ids = [group.default];

    const unique = new Set<string>();
    for (const id of ids) {
      if (typeof id !== "string") {
        violations.push({
          rule: "option.invalid_id",
          group: group.id,
          message: `Group '${group.id}' received a non-string option ID.`,
          severity: "error",
        });
        continue;
      }

      const option = optionsById.get(id);
      if (!option) {
        violations.push({
          rule: "option.unknown",
          group: group.id,
          option: id,
          message: `No such option '${id}'.`,
          severity: "error",
        });
        continue;
      }
      if (option.group !== group.id) {
        violations.push({
          rule: "option.wrong_group",
          group: group.id,
          option: id,
          message: `Option '${id}' does not belong to group '${group.id}'.`,
          severity: "error",
        });
        continue;
      }
      unique.add(id);
    }

    const canonical = [...unique].sort(
      (left, right) => (optionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (optionOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    );

    if (group.select === "one" && canonical.length > 1) {
      violations.push({
        rule: "group.cardinality",
        group: group.id,
        message: `Group '${group.id}' takes one selection; got ${canonical.length}.`,
        severity: "error",
      });
    }
    if (group.required && canonical.length === 0) {
      violations.push({
        rule: "group.required",
        group: group.id,
        message: `Group '${group.id}' requires a selection.`,
        severity: "error",
      });
    }
    selections[group.id] = canonical;
  }

  const selected = new Set(Object.values(selections).flat());
  const selectedOptionIds = catalog.options.filter((option) => selected.has(option.id)).map((option) => option.id);
  return { selections, selectedOptionIds, violations };
}

function combineConfidence(confidences: Confidence[]): Confidence {
  return confidences.some((confidence) => confidence === "estimated") ? "estimated" : "verified";
}

/**
 * Ceiling for any figure describing the vehicle itself.
 *
 * When product.representation is "modelled" the catalog's sources are the basis
 * for a stand-in vehicle, not a citation of it, so nothing about the car can be
 * "verified". Incentives deliberately do not pass through here — a tax credit
 * is real whatever car qualifies for it.
 */
function vehicleConfidence(catalog: Catalog, confidence: Confidence): Confidence {
  return catalog.product.representation === "modelled" ? "estimated" : confidence;
}

function applyEffects(
  catalog: Catalog,
  effects: CatalogEffect[],
  specs: Record<string, JsonValue>,
  specConfidence: Record<string, Confidence>,
): void {
  for (const effect of effects) {
    const current = specs[effect.spec];
    if (effect.op === "set") {
      specs[effect.spec] = effect.value;
    } else if (typeof current === "number" && typeof effect.value === "number") {
      specs[effect.spec] = effect.op === "add" ? current + effect.value : current * effect.value;
    } else if (effect.op === "add" && current === undefined && typeof effect.value === "number") {
      specs[effect.spec] = effect.value;
    } else {
      throw new TypeError(`Effect '${effect.op}' for '${effect.spec}' requires numeric values.`);
    }
    specConfidence[effect.spec] = vehicleConfidence(catalog, effect.confidence);
  }
}

function incentiveOutcome(
  incentive: CatalogIncentive,
  reason: string,
  missingContext: string[] = [],
): IncentiveOutcome {
  return {
    id: incentive.id,
    label: incentive.label,
    type: incentive.type,
    amount: incentive.amount?.fixed ?? null,
    estimateNote: incentive.amount?.estimate_note ?? null,
    claim: incentive.claim ?? null,
    confidence: incentive.confidence,
    sourceIds: [...incentive.sourceIds],
    reason,
    missingContext,
    ...(incentive.notes ? { notes: incentive.notes } : {}),
  };
}

function resolveIncentives(catalog: Catalog, context: ExpressionContext): ResolvedIncentives {
  const encodedPredicatesMatched: IncentiveOutcome[] = [];
  const potentiallyApplicable: IncentiveOutcome[] = [];
  const expired: IncentiveOutcome[] = [];
  const ineligible: IncentiveOutcome[] = [];

  for (const incentive of catalog.incentives ?? []) {
    if (incentive.status === "expired") {
      expired.push(
        incentiveOutcome(incentive, `expired ${incentive.effective?.to ?? "before this catalog snapshot"}`),
      );
      continue;
    }
    if (incentive.status === "scheduled") {
      ineligible.push(
        incentiveOutcome(incentive, `not yet in effect (from ${incentive.effective?.from ?? "TBD"})`),
      );
      continue;
    }

    const truth = evaluateExpressionTruth(incentive.eligibility, context);
    if (truth === true) {
      const caveat =
        incentive.status === "funds_limited"
          ? "encoded predicates matched; funding availability still requires verification"
          : "encoded predicates matched; verify eligibility with the issuing authority";
      encodedPredicatesMatched.push(incentiveOutcome(incentive, caveat));
      continue;
    }

    const missing = missingBuyerContextPaths(incentive.eligibility, context);
    if (truth === "unknown") {
      potentiallyApplicable.push(
        incentiveOutcome(incentive, `missing context: ${missing.join(", ")}`, missing),
      );
    } else {
      ineligible.push(
        incentiveOutcome(incentive, explainExpression(incentive.eligibility, context) ?? "conditions not met"),
      );
    }
  }

  const fixedSavings = encodedPredicatesMatched.reduce((sum, incentive) => sum + (incentive.amount ?? 0), 0);
  return { encodedPredicatesMatched, potentiallyApplicable, expired, ineligible, fixedSavings };
}

function createExpressionContext(
  catalog: Catalog,
  selected: ReadonlySet<string>,
  price: Record<string, unknown>,
  specs: Record<string, JsonValue>,
  buyer: BuyerContext,
): ExpressionContext {
  return {
    selected,
    price,
    specs,
    buyer,
    product: catalog.product as unknown as Record<string, unknown>,
  };
}

export function resolve(
  catalog: Catalog,
  selections: SelectionInput = {},
  buyerInput: BuyerContextInput = {},
): ResolveResult {
  const buyerContext = normalizeBuyerContext(buyerInput);
  const normalized = normalizeSelections(catalog, selections);
  const violations = [...normalized.violations];
  const chosen = new Set(normalized.selectedOptionIds);
  const selectedOptions = catalog.options.filter((option) => chosen.has(option.id));

  let baseMSRP = 0;
  let vehicleOptions = 0;
  const priceLines: ResolvedPrice["lines"] = [];
  const baseConfidences: Confidence[] = [];
  const optionConfidences: Confidence[] = [];

  for (const option of selectedOptions) {
    if (option.price.mode === "base") {
      baseMSRP += option.price.amount;
      baseConfidences.push(vehicleConfidence(catalog, option.price.confidence));
    } else {
      vehicleOptions += option.price.amount;
      if (option.price.amount !== 0) {
        optionConfidences.push(vehicleConfidence(catalog, option.price.confidence));
      }
    }

    if (option.price.mode === "base" || option.price.amount !== 0) {
      priceLines.push({
        id: option.id,
        label: option.label,
        amount: option.price.amount,
        confidence: vehicleConfidence(catalog, option.price.confidence),
        category: option.price.mode === "base" ? "base" : "vehicle_option",
      });
    }
  }

  const vehicleMSRP = baseMSRP + vehicleOptions;
  const fees = catalog.fees ?? [];
  const destinationFees = fees.filter((fee) => fee.id === "destination");
  const destination = destinationFees.reduce((sum, fee) => sum + fee.amount, 0);
  const feeTotal = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const vehicleTotal = vehicleMSRP + feeTotal;

  for (const fee of fees) {
    priceLines.push({
      id: fee.id,
      label: fee.label,
      amount: fee.amount,
      confidence: vehicleConfidence(catalog, fee.confidence),
      category: "fee",
    });
  }

  const priceForExpressions: Record<string, unknown> = {
    baseMSRP,
    vehicleOptions,
    vehicleMSRP,
    destination,
    vehicleTotal,
  };
  const specs: Record<string, JsonValue> = {};
  const specConfidence: Record<string, Confidence> = {};

  for (const option of selectedOptions) {
    if (option.price.mode === "base" && option.effects) applyEffects(catalog, option.effects, specs, specConfidence);
  }
  for (const option of selectedOptions) {
    if (option.price.mode !== "base" && option.effects) applyEffects(catalog, option.effects, specs, specConfidence);
  }

  let context = createExpressionContext(catalog, chosen, priceForExpressions, specs, buyerContext);
  for (const option of selectedOptions) {
    for (const override of option.overrides ?? []) {
      if (evaluateExpression(override.when, context)) {
        applyEffects(catalog, override.effects, specs, specConfidence);
        context = createExpressionContext(catalog, chosen, priceForExpressions, specs, buyerContext);
      }
    }
  }
  if (typeof specs.range_mi === "number") specs.range_mi = Math.round(specs.range_mi);

  context = createExpressionContext(catalog, chosen, priceForExpressions, specs, buyerContext);
  for (const option of selectedOptions) {
    if (option.availability && !evaluateExpression(option.availability, context)) {
      violations.push({
        rule: "option.unavailable",
        group: option.group,
        option: option.id,
        message: `'${option.label}' is not available with this build: ${explainExpression(
          option.availability,
          context,
        )}.`,
        severity: "error",
      });
    }
  }
  for (const rule of catalog.rules ?? []) {
    if (evaluateExpression(rule.when, context) && !evaluateExpression(rule.require, context)) {
      violations.push({
        rule: rule.id,
        message: rule.message,
        severity: rule.severity ?? "error",
      });
    }
  }

  const deliveryOrder = catalog.product.delivery_order ?? [];
  let delivery: ResolveResult["delivery"] = null;
  for (const option of selectedOptions) {
    if (!option.delivery) continue;
    const currentIndex = delivery ? deliveryOrder.indexOf(delivery.window) : -1;
    const candidateIndex = deliveryOrder.indexOf(option.delivery.window);
    if (!delivery || candidateIndex > currentIndex) {
      delivery = {
        window: option.delivery.window,
        gatedBy: option.id,
        confidence: vehicleConfidence(catalog, option.delivery.confidence),
      };
    }
  }

  const incentives = resolveIncentives(catalog, context);
  const setupLines = (catalog.ownership_setup ?? []).filter((item) => evaluateExpression(item.when, context));
  const ownershipSetup = setupLines.reduce((sum, item) => sum + item.amount, 0);
  for (const setup of setupLines) {
    priceLines.push({
      id: setup.id,
      label: setup.label,
      amount: setup.amount,
      confidence: vehicleConfidence(catalog, setup.confidence),
      category: "ownership_setup",
    });
  }

  const baseConfidence = combineConfidence(baseConfidences);
  const vehicleOptionsConfidence = combineConfidence(optionConfidences);
  const feesConfidence = combineConfidence(fees.map((fee) => fee.confidence));
  const destinationConfidence = combineConfidence(destinationFees.map((fee) => fee.confidence));
  const vehicleMSRPConfidence = combineConfidence([baseConfidence, vehicleOptionsConfidence]);
  const vehicleTotalConfidence = combineConfidence([vehicleMSRPConfidence, feesConfidence]);
  const ownershipSetupConfidence = combineConfidence(setupLines.map((item) => item.confidence));
  const fixedSavingsConfidence = combineConfidence(
    incentives.encodedPredicatesMatched
      .filter((incentive) => incentive.amount !== null)
      .map((incentive) => incentive.confidence),
  );

  const price: ResolvedPrice = {
    baseMSRP,
    vehicleOptions,
    vehicleMSRP,
    destination,
    vehicleTotal,
    ownershipSetup,
    fixedSavings: incentives.fixedSavings,
    illustrativeOwnershipTotal: vehicleTotal + ownershipSetup,
    lines: priceLines,
    confidence: {
      baseMSRP: baseConfidence,
      vehicleOptions: vehicleOptionsConfidence,
      vehicleMSRP: vehicleMSRPConfidence,
      destination: destinationConfidence,
      vehicleTotal: vehicleTotalConfidence,
      ownershipSetup: ownershipSetupConfidence,
      fixedSavings: fixedSavingsConfidence,
      illustrativeOwnershipTotal: combineConfidence([vehicleTotalConfidence, ownershipSetupConfidence]),
    },
  };

  return {
    valid: !violations.some((violation) => violation.severity === "error"),
    violations,
    selections: normalized.selections,
    selectedOptionIds: normalized.selectedOptionIds,
    buyerContext,
    price,
    specs,
    specConfidence,
    delivery,
    incentives,
  };
}

function canonicalizePatch(catalog: Catalog, patch: SelectionPatch): SelectionPatch {
  const groupOrder = new Map(catalog.groups.map((group, index) => [group.id, index]));
  const optionOrder = new Map(catalog.options.map((option, index) => [option.id, index]));
  const entries = Object.entries(patch.set);
  if (entries.length > 6) throw new RangeError("A selection patch may name at most six groups.");

  const set: Record<string, string[]> = {};
  for (const [groupId, ids] of entries.sort(
    ([left], [right]) => (groupOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  )) {
    if (!Array.isArray(ids)) throw new TypeError(`Patch group '${groupId}' must use an array replacement.`);
    set[groupId] = [...new Set(ids)].sort(
      (left, right) => (optionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (optionOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return { set };
}

export function resolveAtomicPatch(
  catalog: Catalog,
  current: SelectionInput,
  patchInput: SelectionPatch,
  buyerInput: BuyerContextInput = {},
): PatchResolution {
  const base = resolve(catalog, current, buyerInput);
  const patch = canonicalizePatch(catalog, patchInput);
  const next: SelectionInput = Object.fromEntries(
    Object.entries(base.selections).map(([groupId, ids]) => [groupId, [...ids]]),
  );
  for (const [groupId, ids] of Object.entries(patch.set)) next[groupId] = [...ids];
  const candidate = resolve(catalog, next, buyerInput);
  return { valid: candidate.valid, base, candidate, patch };
}

export function selectedOptions(catalog: Catalog, result: ResolveResult): CatalogOption[] {
  const selected = new Set(result.selectedOptionIds);
  return catalog.options.filter((option) => selected.has(option.id));
}
