import type {
  BuyerContext,
  CanonicalSelections,
  Catalog,
  CatalogGroup,
  OptionId,
} from "../domain/catalog.types";
import {
  createDefaultBuyerContext,
  normalizeBuyerContext,
  resolve,
} from "../domain/resolve";
import type { ConfiguratorStore } from "./configurator.store";
import { createConfiguratorStore } from "./configurator.store";
import type { DomainState } from "./transactions";
import { cloneSelections } from "./transactions";

export const SHARE_FORMAT_VERSION = "1";

export const SAFE_CONTEXT_QUERY_KEYS = {
  evExperience: "evExperience",
  state: "state",
  chargingSituation: "chargingSituation",
  useCases: "useCases",
  priorities: "priorities",
  crossShopIds: "crossShopIds",
} as const;

export const SHARE_PRIVACY_ALLOWLIST = [
  "evExperience",
  "state",
  "chargingSituation",
  "useCases",
  "priorities",
  "crossShopIds",
] as const satisfies ReadonlyArray<keyof BuyerContext>;

export interface ShareEncodeOptions {
  includeSafeContext?: boolean;
}

export interface DiscardedUrlField {
  field: string;
  value: string;
  reason: string;
}

export interface RepairedUrlField {
  field: string;
  from: string[];
  to: string[];
}

export interface FilledUrlField {
  field: string;
  value: string[];
}

export interface ShareRecoveryReport {
  status: "valid" | "repaired" | "defaults";
  changed: RepairedUrlField[];
  filled: FilledUrlField[];
  discarded: DiscardedUrlField[];
}

export interface DecodedShareState {
  catalogId: string;
  selections: CanonicalSelections;
  buyerContext: BuyerContext;
  includedSafeContextFields: Array<(typeof SHARE_PRIVACY_ALLOWLIST)[number]>;
  report: ShareRecoveryReport;
}

export interface BrowserHistoryTarget {
  location: { href: string; search: string };
  history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
}

export interface PopstateTarget extends BrowserHistoryTarget {
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

export interface SharedStateRestorer {
  restoreSharedState(input: {
    expectedRevision: number;
    selections: CanonicalSelections;
    buyerContext: BuyerContext;
  }): { ok: boolean };
}

function canonicalOptionIds(
  catalog: Catalog,
  optionIds: readonly string[],
): OptionId[] {
  const order = new Map(catalog.options.map((option, index) => [option.id, index]));
  return [...new Set(optionIds)].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function readSingle(
  params: URLSearchParams,
  key: string,
  discarded: DiscardedUrlField[],
): string | null {
  const values = params.getAll(key);
  if (values.length > 1) {
    for (const duplicate of values.slice(1)) {
      discarded.push({
        field: key,
        value: duplicate,
        reason: "duplicate parameter; the first value was used",
      });
    }
  }
  return values[0] ?? null;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function selectionVariants(catalog: Catalog, group: CatalogGroup): OptionId[][] {
  const choices = catalog.options
    .filter((option) => option.group === group.id)
    .map((option) => option.id);
  if (group.select === "one") {
    return [
      ...(group.required ? [] : [[]]),
      ...choices.map((optionId) => [optionId]),
    ];
  }

  if (choices.length > 10) {
    return [[], ...choices.map((optionId) => [optionId])];
  }
  const variants: OptionId[][] = [];
  const count = 2 ** choices.length;
  for (let mask = 0; mask < count; mask += 1) {
    variants.push(choices.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return variants;
}

function cartesianSelections(catalog: Catalog): CanonicalSelections[] {
  let candidates: CanonicalSelections[] = [{}];
  for (const group of catalog.groups) {
    const variants = selectionVariants(catalog, group);
    candidates = candidates.flatMap((candidate) =>
      variants.map((optionIds) => ({ ...candidate, [group.id]: optionIds })),
    );
    if (candidates.length > 50_000) {
      throw new RangeError("Catalog has too many configurations for deterministic URL repair.");
    }
  }
  return candidates;
}

function groupWeight(groupId: string): number {
  if (groupId === "build") return 100;
  if (groupId === "paint") return 40;
  if (groupId === "wheels") return 30;
  if (groupId === "interior") return 20;
  return 10;
}

function preservationScore(
  catalog: Catalog,
  requested: CanonicalSelections,
  candidate: CanonicalSelections,
  suppliedGroups: ReadonlySet<string>,
): number {
  let score = 0;
  for (const group of catalog.groups) {
    const before = requested[group.id] ?? [];
    const after = candidate[group.id] ?? [];
    const weight = groupWeight(group.id);
    if (!suppliedGroups.has(group.id)) {
      if (group.select === "many") score -= after.length * weight;
      continue;
    }
    if (group.select === "many") {
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      score += before.filter((id) => afterSet.has(id)).length * weight;
      score -= after.filter((id) => !beforeSet.has(id)).length * weight;
    } else if (
      before.length === after.length &&
      before.every((id, index) => id === after[index])
    ) {
      score += weight;
    }
  }
  return score;
}

function catalogOrderKey(catalog: Catalog, selections: CanonicalSelections): number[] {
  const optionOrder = new Map(catalog.options.map((option, index) => [option.id, index]));
  return catalog.groups.flatMap((group) =>
    (selections[group.id] ?? []).map(
      (optionId) => optionOrder.get(optionId) ?? Number.MAX_SAFE_INTEGER,
    ),
  );
}

function compareOrderKey(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (left[index] ?? Number.MAX_SAFE_INTEGER) -
      (right[index] ?? Number.MAX_SAFE_INTEGER);
    if (difference !== 0) return difference;
  }
  return 0;
}

function nearestValidSelections(
  catalog: Catalog,
  requested: CanonicalSelections,
  suppliedGroups: ReadonlySet<string>,
  buyerContext: BuyerContext,
): CanonicalSelections {
  const attempted = resolve(catalog, requested, buyerContext);
  const valid = cartesianSelections(catalog)
    .map((selections) => ({ selections, resolved: resolve(catalog, selections, buyerContext) }))
    .filter((candidate) => candidate.resolved.valid)
    .map((candidate) => ({
      ...candidate,
      score: preservationScore(catalog, requested, candidate.resolved.selections, suppliedGroups),
      priceDelta: Math.abs(
        candidate.resolved.price.vehicleTotal - attempted.price.vehicleTotal,
      ),
      orderKey: catalogOrderKey(catalog, candidate.resolved.selections),
    }));
  valid.sort(
    (left, right) =>
      right.score - left.score ||
      left.priceDelta - right.priceDelta ||
      compareOrderKey(left.orderKey, right.orderKey),
  );
  const winner = valid[0];
  if (!winner) throw new Error("Catalog has no valid configuration to restore.");
  return cloneSelections(winner.resolved.selections);
}

function defaultDecodedState(
  catalog: Catalog,
  discarded: DiscardedUrlField[] = [],
): DecodedShareState {
  const buyerContext = createDefaultBuyerContext();
  const defaults = resolve(catalog, {}, buyerContext);
  if (!defaults.valid) throw new Error("Catalog defaults are invalid.");
  return {
    catalogId: catalog.product.id,
    selections: cloneSelections(defaults.selections),
    buyerContext,
    includedSafeContextFields: [],
    report: {
      status: "defaults",
      changed: [],
      filled: [],
      discarded,
    },
  };
}

function parseSafeBuyerContext(
  params: URLSearchParams,
  discarded: DiscardedUrlField[],
): BuyerContext {
  let context = createDefaultBuyerContext();
  const scalarFields = [
    "evExperience",
    "state",
    "chargingSituation",
  ] as const;
  for (const field of scalarFields) {
    const raw = readSingle(params, SAFE_CONTEXT_QUERY_KEYS[field], discarded);
    if (raw === null) continue;
    try {
      context = normalizeBuyerContext({ ...context, [field]: raw });
    } catch {
      discarded.push({ field, value: raw, reason: "unsupported safe-context value" });
    }
  }
  const arrayFields = ["useCases", "priorities", "crossShopIds"] as const;
  for (const field of arrayFields) {
    const raw = readSingle(params, SAFE_CONTEXT_QUERY_KEYS[field], discarded);
    if (raw === null) continue;
    try {
      context = normalizeBuyerContext({ ...context, [field]: splitList(raw) });
    } catch {
      discarded.push({ field, value: raw, reason: "unsupported safe-context value" });
    }
  }
  return context;
}

export function encodeShareState(
  catalog: Catalog,
  domain: Pick<DomainState, "catalogId" | "selections" | "buyerContext">,
  options: ShareEncodeOptions = {},
): string {
  if (domain.catalogId !== catalog.product.id) {
    throw new Error("Domain state does not belong to this catalog.");
  }
  const resolved = resolve(catalog, domain.selections, domain.buyerContext);
  if (!resolved.valid) throw new Error("Cannot share an invalid configuration.");

  const params = new URLSearchParams();
  params.set("v", SHARE_FORMAT_VERSION);
  params.set("catalog", catalog.product.id);
  for (const group of catalog.groups) {
    params.set(group.id, (resolved.selections[group.id] ?? []).join(","));
  }
  if (options.includeSafeContext) {
    params.set("evExperience", domain.buyerContext.evExperience);
    params.set("state", domain.buyerContext.state);
    params.set("chargingSituation", domain.buyerContext.chargingSituation);
    params.set("useCases", domain.buyerContext.useCases.join(","));
    params.set("priorities", domain.buyerContext.priorities.join(","));
    params.set("crossShopIds", domain.buyerContext.crossShopIds.join(","));
  }
  return `?${params.toString()}`;
}

export function decodeShareState(
  catalog: Catalog,
  search: string | URLSearchParams,
): DecodedShareState {
  const normalizedSearch =
    typeof search === "string" ? search.replace(/^\?/, "") : search.toString();
  if (!normalizedSearch) return defaultDecodedState(catalog);

  const params = new URLSearchParams(normalizedSearch);
  const discarded: DiscardedUrlField[] = [];
  const knownKeys = new Set([
    "v",
    "catalog",
    ...catalog.groups.map((group) => group.id),
    ...Object.values(SAFE_CONTEXT_QUERY_KEYS),
  ]);
  for (const [key, value] of params) {
    if (!knownKeys.has(key)) {
      discarded.push({ field: key, value, reason: "not in the share privacy allowlist" });
    }
  }

  const version = readSingle(params, "v", discarded);
  const catalogId = readSingle(params, "catalog", discarded);
  if (version !== SHARE_FORMAT_VERSION || catalogId !== catalog.product.id) {
    if (version !== SHARE_FORMAT_VERSION) {
      discarded.push({
        field: "v",
        value: version ?? "",
        reason: "missing or unsupported share format",
      });
    }
    if (catalogId !== catalog.product.id) {
      discarded.push({
        field: "catalog",
        value: catalogId ?? "",
        reason: "missing or unsupported catalog",
      });
    }
    return defaultDecodedState(catalog, discarded);
  }

  const optionsById = new Map(catalog.options.map((option) => [option.id, option]));
  const suppliedGroups = new Set<string>();
  const requested: CanonicalSelections = {};
  for (const group of catalog.groups) {
    const raw = readSingle(params, group.id, discarded);
    if (raw === null) {
      requested[group.id] = [];
      continue;
    }
    suppliedGroups.add(group.id);
    const accepted: string[] = [];
    for (const optionId of splitList(raw)) {
      const option = optionsById.get(optionId);
      if (!option || option.group !== group.id) {
        discarded.push({
          field: group.id,
          value: optionId,
          reason: "unknown option or option belongs to another group",
        });
      } else {
        accepted.push(optionId);
      }
    }
    requested[group.id] = canonicalOptionIds(catalog, accepted);
  }

  const buyerContext = parseSafeBuyerContext(params, discarded);
  const includedSafeContextFields = SHARE_PRIVACY_ALLOWLIST.filter((field) =>
    params.has(SAFE_CONTEXT_QUERY_KEYS[field]),
  );
  const attempted = resolve(catalog, requested, buyerContext);
  const allGroupsUsable = catalog.groups.every((group) => {
    if (!suppliedGroups.has(group.id)) return false;
    if (!group.required) return true;
    return (requested[group.id] ?? []).length > 0;
  });
  const selections =
    attempted.valid && allGroupsUsable
      ? cloneSelections(attempted.selections)
      : nearestValidSelections(catalog, requested, suppliedGroups, buyerContext);

  const changed: RepairedUrlField[] = [];
  const filled: FilledUrlField[] = [];
  for (const group of catalog.groups) {
    const before = requested[group.id] ?? [];
    const after = selections[group.id] ?? [];
    if (!suppliedGroups.has(group.id)) {
      filled.push({ field: group.id, value: [...after] });
    } else if (
      before.length !== after.length ||
      before.some((optionId, index) => optionId !== after[index])
    ) {
      changed.push({ field: group.id, from: [...before], to: [...after] });
    }
  }

  return {
    catalogId: catalog.product.id,
    selections,
    buyerContext,
    includedSafeContextFields,
    report: {
      status:
        changed.length > 0 || filled.length > 0 || discarded.length > 0
          ? "repaired"
          : "valid",
      changed,
      filled,
      discarded,
    },
  };
}

export function createConfiguratorStoreFromSearch(
  catalog: Catalog,
  search: string | URLSearchParams,
): { store: ConfiguratorStore; decoded: DecodedShareState } {
  const decoded = decodeShareState(catalog, search);
  const store = createConfiguratorStore(catalog, {
    selections: decoded.selections,
    buyerContext: decoded.buyerContext,
    restorationNotice: {
      status: decoded.report.status,
      changedFields: decoded.report.changed.map((field) => field.field),
      filledFields: decoded.report.filled.map((field) => field.field),
      discardedFields: decoded.report.discarded.map((field) => field.field),
    },
  });
  return { store, decoded };
}

export function applyShareStateToHistory(
  catalog: Catalog,
  domain: Pick<DomainState, "catalogId" | "selections" | "buyerContext">,
  options: ShareEncodeOptions & {
    mode?: "push" | "replace";
    target?: BrowserHistoryTarget;
  } = {},
): string {
  const target = options.target ?? window;
  const url = new URL(target.location.href);
  url.search = encodeShareState(catalog, domain, options);
  if ((options.mode ?? "replace") === "push") {
    target.history.pushState(null, "", url);
  } else {
    target.history.replaceState(null, "", url);
  }
  return url.toString();
}

export function decodeCurrentLocation(
  catalog: Catalog,
  target: Pick<BrowserHistoryTarget, "location"> = window,
): DecodedShareState {
  return decodeShareState(catalog, target.location.search);
}

export function restoreShareStateFromSearch(
  catalog: Catalog,
  store: ConfiguratorStore,
  restorer: SharedStateRestorer,
  search: string | URLSearchParams,
): { decoded: DecodedShareState; restored: ReturnType<SharedStateRestorer["restoreSharedState"]> } {
  const decoded = decodeShareState(catalog, search);
  const current = store.getState().domain;
  const safeContext = Object.fromEntries(
    decoded.includedSafeContextFields.map((field) => [field, decoded.buyerContext[field]]),
  );
  const buyerContext = normalizeBuyerContext({
    ...current.buyerContext,
    ...safeContext,
  });
  const restored = restorer.restoreSharedState({
    expectedRevision: current.revision,
    selections: decoded.selections,
    buyerContext,
  });
  return { decoded, restored };
}

export function bindShareStatePopstate(
  catalog: Catalog,
  store: ConfiguratorStore,
  restorer: SharedStateRestorer,
  target: PopstateTarget = window,
): () => void {
  const handlePopstate = () => {
    restoreShareStateFromSearch(
      catalog,
      store,
      restorer,
      target.location.search,
    );
  };
  target.addEventListener("popstate", handlePopstate);
  return () => target.removeEventListener("popstate", handlePopstate);
}
