import type {
  BuyerContext,
  BuyerContextInput,
  CanonicalSelections,
  Catalog,
  CatalogGroup,
  SelectionPatch,
} from "../domain/catalog.types";
import { crossCompare, DEFAULT_COMPARISON_KEYS } from "../domain/compare";
import {
  estimateOwnership,
  OwnershipAssumptionError,
  validateOwnershipAssumptions,
} from "../domain/ownership";
import { resolveAtomicPatch } from "../domain/resolve";
import {
  ownerGuideBridge,
  type OwnerGuideBridge,
  type VehicleTwinContext,
  type AutoLabWorkspace,
} from "../owner-guide/owner-guide-bridge";
import {
  configuratorMutations,
  configuratorStore,
  encodeShareState,
  type ConfiguratorStore,
  type ConfiguratorStoreState,
  type ConfigurationStage,
  type MutationService,
} from "../state";

export const CONFIGURATOR_TOOL_NAMES = [
  "get_vehicle_configuration",
  "list_vehicle_configuration_options",
  "simulate_vehicle_configuration_change",
  "apply_vehicle_configuration_transaction",
  "interrupt_vehicle_configuration_transaction",
  "undo_vehicle_configuration_transaction",
  "present_vehicle_configuration",
  "set_vehicle_buyer_context",
  "estimate_vehicle_ownership_cost",
  "compare_vehicle_configurations",
  "get_vehicle_twin_state",
  "list_vehicle_parts",
  "inspect_vehicle_part",
  "set_vehicle_twin_view",
  "set_vehicle_twin_motion",
  "measure_vehicle_parts",
  "set_autolab_workspace",
] as const;

export type ConfiguratorToolName = (typeof CONFIGURATOR_TOOL_NAMES)[number];

export type ConfiguratorPresentationMode = "showroom" | "blueprint";
export type ConfiguratorViewPreset = "angle" | "profile" | "wheel" | "interior";
export type ConfiguratorFocus =
  | "none"
  | "paint"
  | "charge-port"
  | "wheels"
  | "utility";

export interface ConfiguratorPresentationState {
  revision: number;
  mode: ConfiguratorPresentationMode;
  viewPreset: ConfiguratorViewPreset;
  focus: ConfiguratorFocus;
  /** Doors, frunk and liftgate open. Ignored by bodies that cannot open. */
  bodyOpen: boolean;
}

export interface ConfiguratorPresentationPatch {
  mode?: ConfiguratorPresentationMode;
  viewPreset?: ConfiguratorViewPreset;
  focus?: ConfiguratorFocus;
  bodyOpen?: boolean;
}

/**
 * What is actually being drawn.
 *
 * An agent advising on paint, wheels or a charge-port location is reasoning
 * about a picture it cannot see. Whether that picture is the vehicle being
 * configured or a licensed stand-in of a different car changes what it can
 * honestly say, so the fact is published rather than left implicit.
 *
 * It lives here, not in the scene layer, because the webmcp surface must not
 * depend on the renderer. The app describes the body once on mount.
 */
export interface RenderedBodyDescriptor {
  id: string;
  label: string;
  /** Whether the geometry on screen is the vehicle the catalog describes. */
  representsConfiguredVehicle: boolean;
  /** One line an agent can quote about where the geometry came from. */
  basis: string;
  /** Whether this body's doors, frunk and liftgate can open at all. */
  canOpen: boolean;
}

const UNKNOWN_BODY: RenderedBodyDescriptor = {
  id: "unknown",
  label: "Vehicle body",
  representsConfiguredVehicle: false,
  basis: "The page has not yet reported which body is drawing.",
  canOpen: true,
};

export interface ConfiguratorPresentationController {
  getState(): ConfiguratorPresentationState;
  getBody(): RenderedBodyDescriptor;
  /** Called by the page once it knows which body it mounted. */
  describeBody(body: RenderedBodyDescriptor): void;
  present(
    patch: ConfiguratorPresentationPatch,
    options?: { signal?: AbortSignal },
  ): ConfiguratorPresentationState;
  setFromUser(patch: ConfiguratorPresentationPatch): ConfiguratorPresentationState;
  subscribe(listener: (state: ConfiguratorPresentationState) => void): () => void;
}

export interface ConfiguratorToolsDependencies {
  store: ConfiguratorStore;
  mutations: MutationService;
  presentation: ConfiguratorPresentationController;
  /** Injectable so the host/iframe contract can be covered without a browser frame. */
  ownerGuide?: OwnerGuideBridge;
}

export type ConfiguratorSiteToolsStatus =
  | { state: "unsupported"; toolNames: readonly [] }
  | { state: "registering"; toolNames: readonly [] }
  | { state: "ready"; toolNames: readonly ConfiguratorToolName[] }
  | {
      state: "degraded";
      toolNames: readonly ConfiguratorToolName[];
      message: string;
    };

type ToolDefinition = ModelContextTool<Record<string, unknown>>;

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  untrustedContentHint: false,
} as const;

const SAFE_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  untrustedContentHint: false,
} as const;

const PRESENTATION_MODES = ["showroom", "blueprint"] as const;
const VIEW_PRESETS = ["angle", "profile", "wheel", "interior"] as const;
const FOCUS_TARGETS = [
  "none",
  "paint",
  "charge-port",
  "wheels",
  "utility",
] as const;
const EV_EXPERIENCES = ["new", "familiar", "owner", "unknown"] as const;
const CHARGING_SITUATIONS = [
  "home_l2_possible",
  "home_l1",
  "routine_public",
  "poor_fit",
  "unknown",
] as const;
const USE_CASES = ["road_trip", "towing", "commute", "snow"] as const;
const AUTOLAB_WORKSPACES = ["configure", "garage"] as const;
const PRIORITIES = ["range", "delivery", "price", "performance", "comfort"] as const;
const CROSS_SHOPS = ["model_y", "ioniq_5"] as const;
const UTILITIES = ["xcel", "unknown"] as const;

const defaultDependencies: ConfiguratorToolsDependencies = {
  store: configuratorStore,
  mutations: configuratorMutations,
  presentation: createConfiguratorPresentationController(),
};

export const configuratorPresentation = defaultDependencies.presentation;

let registration: Promise<ConfiguratorSiteToolsStatus> | undefined;
let registrationController: AbortController | undefined;

/**
 * Hosts differ on where they expose the API, and some inject it after first
 * paint. Look on both surfaces every time rather than caching a miss.
 */
function findModelContext(): ModelContextApi | undefined {
  if (typeof document !== "undefined" && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return navigator.modelContext;
  }
  return undefined;
}

const LATE_INJECTION_POLL_MS = 400;
const LATE_INJECTION_WINDOW_MS = 12_000;
const MODEL_CONTEXT_EVENTS = ["modelcontext", "modelcontextchange"] as const;

type SiteToolsListener = (status: ConfiguratorSiteToolsStatus) => void;

const statusListeners = new Set<SiteToolsListener>();
let currentStatus: ConfiguratorSiteToolsStatus = {
  state: "registering",
  toolNames: [],
};

export function getConfiguratorSiteToolsStatus(): ConfiguratorSiteToolsStatus {
  return currentStatus;
}

/**
 * Subscribe to registration status. Fires immediately with the current status
 * so a late host connection can flip the UI out of "Manual mode" live.
 */
export function observeConfiguratorSiteTools(
  listener: SiteToolsListener,
): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

function publishStatus(status: ConfiguratorSiteToolsStatus) {
  currentStatus = status;
  setDocumentStatus(status);
  for (const listener of [...statusListeners]) listener(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, toolName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${toolName} expects a JSON object.`);
  }
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  toolName: string,
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new TypeError(
      `${toolName} received unsupported field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    );
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Tool execution was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function parseExpectedRevision(value: unknown, toolName: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${toolName} requires expectedRevision as a positive safe integer.`);
  }
  return value as number;
}

function parseFiniteNumber(
  value: unknown,
  field: string,
  toolName: string,
  range: { minimum?: number; maximum?: number } = {},
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${toolName} requires ${field} as a finite number.`);
  }
  if (range.minimum !== undefined && value < range.minimum) {
    throw new RangeError(`${toolName} requires ${field} to be at least ${range.minimum}.`);
  }
  if (range.maximum !== undefined && value > range.maximum) {
    throw new RangeError(`${toolName} requires ${field} to be at most ${range.maximum}.`);
  }
  return value;
}

function parseBoundedString(
  value: unknown,
  field: string,
  toolName: string,
  maximum = 80,
): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximum) {
    throw new TypeError(
      `${toolName} requires ${field} as a non-blank string of at most ${maximum} characters.`,
    );
  }
  return value;
}

function groupMap(catalog: Catalog): Map<string, CatalogGroup> {
  return new Map(catalog.groups.map((group) => [group.id, group]));
}

function parsePatch(
  value: unknown,
  catalog: Catalog,
  toolName: string,
): SelectionPatch {
  const patch = assertRecord(value, toolName);
  assertOnlyKeys(patch, ["set"], toolName);
  const set = assertRecord(patch.set, toolName);
  if (Object.keys(set).length < 1) {
    throw new TypeError(`${toolName} requires at least one group in patch.set.`);
  }

  const groups = groupMap(catalog);
  const parsedSet: Record<string, string[]> = {};
  for (const [groupId, optionIds] of Object.entries(set)) {
    const group = groups.get(groupId);
    if (!group) {
      throw new TypeError(`${toolName} does not recognize configuration group ${groupId}.`);
    }
    if (!Array.isArray(optionIds) || optionIds.some((id) => typeof id !== "string")) {
      throw new TypeError(`${toolName} requires ${groupId} to be an array of option IDs.`);
    }
    if (group.required && optionIds.length < 1) {
      throw new TypeError(`${toolName} cannot clear required group ${groupId}.`);
    }
    if (group.select === "one" && optionIds.length > 1) {
      throw new TypeError(`${toolName} accepts at most one option for ${groupId}.`);
    }
    if (new Set(optionIds).size !== optionIds.length) {
      throw new TypeError(`${toolName} received duplicate options for ${groupId}.`);
    }

    const validOptions = new Set(
      catalog.options
        .filter((option) => option.group === groupId)
        .map((option) => option.id),
    );
    const invalidOption = optionIds.find((id) => !validOptions.has(id));
    if (invalidOption) {
      throw new TypeError(
        `${toolName} cannot assign option ${invalidOption} to group ${groupId}.`,
      );
    }
    parsedSet[groupId] = [...optionIds];
  }

  return { set: parsedSet };
}

function cloneSelections(selections: CanonicalSelections): CanonicalSelections {
  return Object.fromEntries(
    Object.entries(selections).map(([groupId, optionIds]) => [groupId, [...optionIds]]),
  );
}

function cloneBuyerContext(context: BuyerContext): BuyerContext {
  return {
    ...context,
    useCases: [...context.useCases],
    priorities: [...context.priorities],
    crossShopIds: [...context.crossShopIds],
  };
}

function parseBuyerContextPatch(value: unknown, toolName: string): BuyerContextInput {
  const patch = assertRecord(value, toolName);
  const allowed = [
    "evExperience",
    "state",
    "utility",
    "chargingSituation",
    "useCases",
    "priorities",
    "financing",
    "crossShopIds",
  ] as const;
  assertOnlyKeys(patch, allowed, toolName);
  if (Object.keys(patch).length < 1) {
    throw new TypeError(`${toolName} requires at least one buyer-context field.`);
  }

  const parsed: BuyerContextInput = {};
  if (patch.evExperience !== undefined) {
    if (!EV_EXPERIENCES.includes(patch.evExperience as BuyerContext["evExperience"])) {
      throw new TypeError(`${toolName} received an unsupported evExperience.`);
    }
    parsed.evExperience = patch.evExperience as BuyerContext["evExperience"];
  }
  if (patch.state !== undefined) {
    if (typeof patch.state !== "string" || !/^(unknown|[A-Z]{2})$/u.test(patch.state)) {
      throw new TypeError(`${toolName} requires state as an uppercase US postal code or unknown.`);
    }
    parsed.state = patch.state;
  }
  if (patch.utility !== undefined) {
    if (!UTILITIES.includes(patch.utility as BuyerContext["utility"])) {
      throw new TypeError(`${toolName} received an unsupported utility.`);
    }
    parsed.utility = patch.utility as BuyerContext["utility"];
  }
  if (patch.chargingSituation !== undefined) {
    if (!CHARGING_SITUATIONS.includes(
      patch.chargingSituation as BuyerContext["chargingSituation"],
    )) {
      throw new TypeError(`${toolName} received an unsupported chargingSituation.`);
    }
    parsed.chargingSituation = patch.chargingSituation as BuyerContext["chargingSituation"];
  }
  if (patch.useCases !== undefined) {
    if (
      !Array.isArray(patch.useCases) ||
      patch.useCases.some((item) => !USE_CASES.includes(item as BuyerContext["useCases"][number])) ||
      new Set(patch.useCases).size !== patch.useCases.length
    ) {
      throw new TypeError(`${toolName} received unsupported or duplicate useCases.`);
    }
    parsed.useCases = [...patch.useCases] as BuyerContext["useCases"];
  }
  if (patch.priorities !== undefined) {
    if (
      !Array.isArray(patch.priorities) ||
      patch.priorities.some((item) => !PRIORITIES.includes(item as BuyerContext["priorities"][number])) ||
      new Set(patch.priorities).size !== patch.priorities.length
    ) {
      throw new TypeError(`${toolName} received unsupported or duplicate priorities.`);
    }
    parsed.priorities = [...patch.priorities] as BuyerContext["priorities"];
  }
  if (patch.financing !== undefined) {
    if (typeof patch.financing !== "boolean" && patch.financing !== "unknown") {
      throw new TypeError(`${toolName} requires financing as a boolean or unknown.`);
    }
    parsed.financing = patch.financing;
  }
  if (patch.crossShopIds !== undefined) {
    if (
      !Array.isArray(patch.crossShopIds) ||
      patch.crossShopIds.some((item) => !CROSS_SHOPS.includes(item as BuyerContext["crossShopIds"][number])) ||
      new Set(patch.crossShopIds).size !== patch.crossShopIds.length
    ) {
      throw new TypeError(`${toolName} received unsupported or duplicate crossShopIds.`);
    }
    parsed.crossShopIds = [...patch.crossShopIds] as BuyerContext["crossShopIds"];
  }
  return parsed;
}

/**
 * Resolve the catalog's source ids into full records so an agent can cite a
 * claim rather than quote an opaque id like "colorado_imvc_2026".
 */
function resolveSources(catalog: Catalog, ids: readonly string[]) {
  return ids
    .map((id) => catalog.sources.find((source) => source.id === id))
    .filter((source): source is Catalog["sources"][number] => source !== undefined)
    .map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      asOf: source.asOf,
    }));
}

/** Attach resolved sources to every incentive outcome, in every bucket. */
function citeIncentives(
  catalog: Catalog,
  incentives: ConfiguratorStoreState["resolved"]["incentives"],
) {
  const cite = <T extends { sourceIds: readonly string[] }>(outcome: T) => ({
    ...outcome,
    sources: resolveSources(catalog, outcome.sourceIds),
  });
  return {
    ...incentives,
    encodedPredicatesMatched: incentives.encodedPredicatesMatched.map(cite),
    potentiallyApplicable: incentives.potentiallyApplicable.map(cite),
    expired: incentives.expired.map(cite),
    ineligible: incentives.ineligible.map(cite),
  };
}

/**
 * The address bar already carries a deterministic permalink of the build, so an
 * agent that just configured a vehicle can hand the link straight back.
 */
function shareUrlFor(state: ConfiguratorStoreState): string | null {
  if (typeof window === "undefined") return null;
  try {
    const query = encodeShareState(state.catalog, state.domain);
    return new URL(query, window.location.href).toString();
  } catch {
    return null;
  }
}

function compactConfiguration(state: ConfiguratorStoreState) {
  const selected = new Set(state.resolved.selectedOptionIds);
  return {
    revision: state.domain.revision,
    catalog: {
      id: state.catalog.product.id,
      make: state.catalog.product.make,
      model: state.catalog.product.model,
      year: state.catalog.product.year,
      market: state.catalog.product.market,
      currency: state.catalog.product.currency ?? "USD",
      dataAsOf: state.catalog.product.data_as_of,
      assembly: state.catalog.product.assembly ?? null,
      disclaimer: state.catalog.product.disclaimer ?? null,
      representation: state.catalog.product.representation ?? "actual",
      // Tells an agent how to phrase a citation. Under "modelled" the sources
      // back the figures rather than describe this vehicle, so a claim must be
      // hedged accordingly. Incentive sources are unaffected.
      provenanceNote:
        state.catalog.product.representation === "modelled"
          ? "Vehicle figures are modelled on the cited sources, not taken from this vehicle. Cite them as the basis. Incentive programs are real and cited directly."
          : "Vehicle figures are taken from the cited sources for this vehicle.",
      sources: resolveSources(state.catalog, state.catalog.product.sources ?? []),
    },
    configuration: {
      valid: state.resolved.valid,
      selections: cloneSelections(state.domain.selections),
      selectedOptions: state.catalog.options
        .filter((option) => selected.has(option.id))
        .map((option) => ({
          id: option.id,
          groupId: option.group,
          label: option.label,
          orderability: option.orderability,
        })),
      price: state.resolved.price,
      specs: { ...state.resolved.specs },
      delivery: state.resolved.delivery,
      incentives: citeIncentives(state.catalog, state.resolved.incentives),
      violations: [...state.resolved.violations],
    },
    buyerContext: cloneBuyerContext(state.domain.buyerContext),
    shareUrl: shareUrlFor(state),
  };
}

function vehicleTwinContext(state: ConfiguratorStoreState): VehicleTwinContext {
  const selectedLabel = (groupId: string, fallback: string) => {
    const ids = new Set(state.domain.selections[groupId] ?? []);
    return state.catalog.options.find(
      (option) => option.group === groupId && ids.has(option.id),
    )?.label ?? fallback;
  };

  return {
    build: selectedLabel("build", `${state.catalog.product.make} ${state.catalog.product.model}`),
    paint: selectedLabel("paint", "Not supplied"),
    wheels: selectedLabel("wheels", "Not supplied"),
    interior: selectedLabel("interior", "Not supplied"),
    rangeMiles:
      typeof state.resolved.specs.range_mi === "number"
        ? state.resolved.specs.range_mi
        : null,
    vehicleTotal: state.resolved.price.vehicleTotal,
    revision: state.domain.revision,
  };
}

function transactionState(state: ConfiguratorStoreState) {
  const canUndo =
    state.session.undo !== null &&
    state.session.undo.afterRevision === state.domain.revision;
  return {
    active: state.session.activeAgentTransaction,
    last: state.session.lastTransaction,
    canUndo,
  };
}

function patchSchema(catalog: Catalog): Record<string, unknown> {
  const properties = Object.fromEntries(
    catalog.groups.map((group) => {
      const optionIds = catalog.options
        .filter((option) => option.group === group.id)
        .map((option) => option.id);
      return [
        group.id,
        {
          type: "array",
          items: { type: "string", enum: optionIds },
          minItems: group.required ? 1 : 0,
          maxItems: group.select === "one" ? 1 : optionIds.length,
          uniqueItems: true,
        },
      ];
    }),
  );

  return {
    type: "object",
    properties: {
      set: {
        type: "object",
        properties,
        minProperties: 1,
        additionalProperties: false,
      },
    },
    required: ["set"],
    additionalProperties: false,
  };
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Configurator Site Tools registration failed.";
}

function setDocumentStatus(status: ConfiguratorSiteToolsStatus) {
  document.documentElement.dataset.siteTools = status.state;
}

export function createConfiguratorPresentationController(
  initial: Partial<ConfiguratorPresentationState> = {},
): ConfiguratorPresentationController {
  const initialMode = initial.mode ?? "showroom";
  const initialViewPreset = initial.viewPreset ?? "angle";
  let state: ConfiguratorPresentationState = {
    revision: initial.revision ?? 1,
    mode: initialMode,
    viewPreset:
      initialMode === "blueprint" && ["angle", "interior"].includes(initialViewPreset)
        ? "profile"
        : initialViewPreset,
    focus: initial.focus ?? "none",
    bodyOpen: initial.bodyOpen ?? false,
  };
  const listeners = new Set<(state: ConfiguratorPresentationState) => void>();
  let body: RenderedBodyDescriptor = UNKNOWN_BODY;

  const update = (patch: ConfiguratorPresentationPatch) => {
    const mode = patch.mode ?? state.mode;
    let viewPreset = patch.viewPreset ?? state.viewPreset;
    if (mode === "blueprint" && (viewPreset === "angle" || viewPreset === "interior")) {
      viewPreset = "profile";
    }
    if (mode === "showroom" && patch.viewPreset === "angle") viewPreset = "angle";
    const focus = patch.focus ?? state.focus;
    // Blueprint mode draws the body as a wireframe, where an open door reads as
    // noise rather than as information, so the panels shut when it engages. A
    // body with no openable panels can never be open either.
    const bodyOpen = mode === "blueprint" || !body.canOpen
      ? false
      : patch.bodyOpen ?? state.bodyOpen;
    if (
      mode === state.mode
      && viewPreset === state.viewPreset
      && focus === state.focus
      && bodyOpen === state.bodyOpen
    ) {
      return state;
    }
    state = { revision: state.revision + 1, mode, viewPreset, focus, bodyOpen };
    listeners.forEach((listener) => listener(state));
    return state;
  };

  return {
    getState: () => state,
    getBody: () => body,
    describeBody: (next) => {
      body = next;
      // Adopting a body that cannot open has to shut the panels, or the state
      // keeps claiming an opening no one can see.
      if (!next.canOpen && state.bodyOpen) update({ bodyOpen: false });
    },
    present: (patch, options) => {
      throwIfAborted(options?.signal);
      return update(patch);
    },
    setFromUser: update,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createConfiguratorToolDefinitions(
  dependencies: ConfiguratorToolsDependencies,
): readonly ToolDefinition[] {
  const { store, mutations, presentation } = dependencies;
  const bridge = dependencies.ownerGuide ?? ownerGuideBridge;
  const catalog = store.getState().catalog;
  const selectionPatchSchema = patchSchema(catalog);
  const expectedRevisionSchema = { type: "integer", minimum: 1 } as const;

  /**
   * Frame loading can take seconds. Never let a tool act on a configuration
   * snapshot that changed while it was waiting; repair the twin context to the
   * newest revision and ask the caller to retry instead.
   */
  const synchronizeTwin = async (toolName: ConfiguratorToolName, signal?: AbortSignal) => {
    const state = store.getState();
    const context = vehicleTwinContext(state);
    await bridge.syncContext(context, { signal });
    throwIfAborted(signal);
    const latest = store.getState();
    if (latest.domain.revision !== state.domain.revision) {
      await bridge.syncContext(vehicleTwinContext(latest), { signal });
      throw new Error(
        `${toolName} stopped because the configuration moved from revision ${state.domain.revision} to ${latest.domain.revision} while Garage was loading. Retry against the current build.`,
      );
    }
    return { state, context };
  };

  const assertTwinRevision = (expectedRevision: number, toolName: ConfiguratorToolName) => {
    const currentRevision = store.getState().domain.revision;
    if (currentRevision !== expectedRevision) {
      throw new Error(
        `${toolName} stopped because the configuration moved to revision ${currentRevision}. Retry against the current build.`,
      );
    }
  };

  const getConfiguration: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[0],
    title: "Get current vehicle configuration",
    description:
      "Read the current vehicle build, buyer context, price, range, delivery status, revision, transaction status, presentation state, and which vehicle body is on screen. Check renderedBody before describing what the person is looking at: representsConfiguredVehicle is false when the viewport is showing a licensed stand-in of a different car rather than the vehicle being configured. Call this before making a change so expectedRevision is current.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[0]);
      assertOnlyKeys(record, [], CONFIGURATOR_TOOL_NAMES[0]);
      const state = store.getState();
      return {
        ok: true,
        ...compactConfiguration(state),
        transaction: transactionState(state),
        presentation: presentation.getState(),
        renderedBody: presentation.getBody(),
        // Which of the two AutoLab surfaces is on screen. The presentation
        // tools only move the Configure canvas, so an agent has to know.
        workspace: bridge.getWorkspace(),
      };
    },
  };

  const listOptions: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[1],
    title: "List vehicle configuration options",
    description:
      "List real options for one configuration group or all groups, including the current selection and whether each candidate resolves into a valid build.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: {
          type: "string",
          enum: catalog.groups.map((group) => group.id),
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[1]);
      assertOnlyKeys(record, ["groupId"], CONFIGURATOR_TOOL_NAMES[1]);
      if (record.groupId !== undefined && typeof record.groupId !== "string") {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[1]} requires groupId as a string.`);
      }
      const groupId = record.groupId as string | undefined;
      if (groupId && !catalog.groups.some((group) => group.id === groupId)) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[1]} does not recognize group ${groupId}.`);
      }

      const state = store.getState();
      const groups = catalog.groups.filter((group) => !groupId || group.id === groupId);
      return {
        ok: true,
        revision: state.domain.revision,
        groups: groups.map((group) => ({
          id: group.id,
          label: group.label,
          select: group.select,
          required: group.required ?? false,
          selectedOptionIds: [...(state.domain.selections[group.id] ?? [])],
          options: catalog.options
            .filter((option) => option.group === group.id)
            .map((option) => {
              const simulation = mutations.simulateConfiguration({
                expectedRevision: state.domain.revision,
                patch: { set: { [group.id]: [option.id] } },
              });
              return {
                id: option.id,
                label: option.label,
                selected: state.domain.selections[group.id]?.includes(option.id) ?? false,
                orderability: option.orderability,
                visualStatus: option.visualStatus,
                price: option.price,
                copy: option.copy,
                validWithCurrentBuild:
                  simulation.ok && simulation.candidate.valid,
                ...(simulation.ok
                  ? {
                      delta: simulation.delta,
                      violations: simulation.candidate.violations,
                    }
                  : { error: simulation.error }),
              };
            }),
        })),
      };
    },
  };

  const simulateChange: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[2],
    title: "Simulate vehicle configuration change",
    description:
      "Preview an atomic option change without altering the build. Returns exact price, range, delivery, validity, and compatible-alternative consequences at expectedRevision.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: expectedRevisionSchema,
        patch: selectionPatchSchema,
      },
      required: ["expectedRevision", "patch"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[2]);
      assertOnlyKeys(record, ["expectedRevision", "patch"], CONFIGURATOR_TOOL_NAMES[2]);
      const expectedRevision = parseExpectedRevision(
        record.expectedRevision,
        CONFIGURATOR_TOOL_NAMES[2],
      );
      const patch = parsePatch(record.patch, catalog, CONFIGURATOR_TOOL_NAMES[2]);
      return mutations.simulateConfiguration({ expectedRevision, patch });
    },
  };

  const applyTransaction: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[3],
    title: "Apply vehicle configuration transaction",
    description:
      "Apply one to four validated configuration stages through the live mutation service. Each visible stage is revision-safe, interruptible, and captured in one undoable receipt.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: expectedRevisionSchema,
        stages: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1, maxLength: 60 },
              patch: selectionPatchSchema,
            },
            required: ["label", "patch"],
            additionalProperties: false,
          },
        },
      },
      required: ["expectedRevision", "stages"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: false },
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[3]);
      assertOnlyKeys(record, ["expectedRevision", "stages"], CONFIGURATOR_TOOL_NAMES[3]);
      const expectedRevision = parseExpectedRevision(
        record.expectedRevision,
        CONFIGURATOR_TOOL_NAMES[3],
      );
      if (!Array.isArray(record.stages) || record.stages.length < 1 || record.stages.length > 4) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[3]} requires one to four stages.`);
      }
      const stages: ConfigurationStage[] = record.stages.map((value, index) => {
        const stage = assertRecord(value, CONFIGURATOR_TOOL_NAMES[3]);
        assertOnlyKeys(stage, ["label", "patch"], CONFIGURATOR_TOOL_NAMES[3]);
        if (
          typeof stage.label !== "string" ||
          stage.label.trim().length < 1 ||
          stage.label.length > 60
        ) {
          throw new TypeError(
            `${CONFIGURATOR_TOOL_NAMES[3]} stage ${index + 1} requires a 1–60 character label.`,
          );
        }
        return {
          label: stage.label,
          patch: parsePatch(stage.patch, catalog, CONFIGURATOR_TOOL_NAMES[3]),
        };
      });
      return mutations.applyAgentTransaction({
        expectedRevision,
        stages,
        signal: options?.signal,
      });
    },
  };

  const interruptTransaction: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[4],
    title: "Interrupt vehicle configuration transaction",
    description:
      "Stop any currently active agent configuration transaction after its latest committed stage. Completed stages remain visible and may be undone from the returned current revision.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", minLength: 1, maxLength: 80 },
      },
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[4]);
      assertOnlyKeys(record, ["reason"], CONFIGURATOR_TOOL_NAMES[4]);
      if (
        record.reason !== undefined &&
        (typeof record.reason !== "string" ||
          record.reason.trim().length < 1 ||
          record.reason.length > 80)
      ) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[4]} reason must be 1–80 characters.`);
      }
      const before = store.getState().session.activeAgentTransaction;
      const interrupted = mutations.interruptAgentTransaction(
        (record.reason as string | undefined) ?? "agent_requested_stop",
      );
      const state = store.getState();
      return {
        ok: true,
        interrupted,
        transactionId: before?.id ?? null,
        revision: state.domain.revision,
        activeTransaction: state.session.activeAgentTransaction,
      };
    },
  };

  const undoTransaction: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[5],
    title: "Undo last vehicle configuration transaction",
    description:
      "Undo the latest eligible agent configuration transaction atomically. Requires the current expectedRevision and never undoes a human change.",
    inputSchema: {
      type: "object",
      properties: { expectedRevision: expectedRevisionSchema },
      required: ["expectedRevision"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: false },
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[5]);
      assertOnlyKeys(record, ["expectedRevision"], CONFIGURATOR_TOOL_NAMES[5]);
      return mutations.undoLastAgentTransaction({
        expectedRevision: parseExpectedRevision(
          record.expectedRevision,
          CONFIGURATOR_TOOL_NAMES[5],
        ),
      });
    },
  };

  const presentConfiguration: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[6],
    title: "Present vehicle configuration",
    description:
      "Move the CONFIGURE canvas to showroom or blueprint mode, choose an angle/profile/wheel/interior view, optionally focus a truthful vehicle hotspot, and open or close the body. This changes presentation only, never the selected build — and it only affects the Configure surface, so if the page is showing the Garage nothing visible happens. Use set_autolab_workspace first, or set_vehicle_twin_view to move the twin's camera instead.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: PRESENTATION_MODES },
        viewPreset: { type: "string", enum: VIEW_PRESETS },
        focus: { type: "string", enum: FOCUS_TARGETS },
        bodyOpen: {
          type: "boolean",
          description:
            "Swing the doors, frunk and liftgate open. Refused, and reported back under `unapplied`, in blueprint mode or on a body with no openable panels — see renderedBody.canOpen from get_vehicle_configuration.",
        },
      },
      minProperties: 1,
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[6]);
      assertOnlyKeys(
        record,
        ["mode", "viewPreset", "focus", "bodyOpen"],
        CONFIGURATOR_TOOL_NAMES[6],
      );
      if (Object.keys(record).length < 1) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[6]} requires a presentation change.`);
      }
      if (
        record.mode !== undefined &&
        !PRESENTATION_MODES.includes(record.mode as ConfiguratorPresentationMode)
      ) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[6]} received an unsupported mode.`);
      }
      if (
        record.viewPreset !== undefined &&
        !VIEW_PRESETS.includes(record.viewPreset as ConfiguratorViewPreset)
      ) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[6]} received an unsupported viewPreset.`);
      }
      if (
        record.focus !== undefined &&
        !FOCUS_TARGETS.includes(record.focus as ConfiguratorFocus)
      ) {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[6]} received an unsupported focus.`);
      }
      if (record.bodyOpen !== undefined && typeof record.bodyOpen !== "boolean") {
        throw new TypeError(`${CONFIGURATOR_TOOL_NAMES[6]} received a non-boolean bodyOpen.`);
      }
      const previous = presentation.getState();
      const next = presentation.present(
        {
          mode: record.mode as ConfiguratorPresentationMode | undefined,
          viewPreset: record.viewPreset as ConfiguratorViewPreset | undefined,
          focus: record.focus as ConfiguratorFocus | undefined,
          bodyOpen: record.bodyOpen as boolean | undefined,
        },
        { signal: options?.signal },
      );
      // Some requests are clamped rather than applied. Returning ok:true with a
      // state that quietly disagrees with what was asked leaves an agent
      // believing it opened a body that never moved, so say so.
      const unapplied: { field: string; requested: unknown; reason: string }[] = [];
      const body = presentation.getBody();
      if (record.bodyOpen !== undefined && next.bodyOpen !== record.bodyOpen) {
        unapplied.push({
          field: "bodyOpen",
          requested: record.bodyOpen,
          reason: !body.canOpen
            ? `The body on screen (${body.label}) has no openable doors, frunk or liftgate.`
            : "Blueprint mode always shuts the body. Switch to showroom mode first.",
        });
      }
      if (record.viewPreset !== undefined && next.viewPreset !== record.viewPreset) {
        unapplied.push({
          field: "viewPreset",
          requested: record.viewPreset,
          reason: "Blueprint mode only draws the profile and wheel views.",
        });
      }
      return {
        ok: true,
        changed: next !== previous,
        presentation: next,
        ...(unapplied.length > 0 ? { unapplied } : {}),
      };
    },
  };

  const setBuyerContext: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[7],
    title: "Set vehicle buyer context",
    description:
      "Set only buyer facts the person has actually provided—EV experience, state, utility, charging access, use cases, priorities, financing, and cross-shopped vehicles—so configuration guidance and incentive results can adapt without guessing.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: expectedRevisionSchema,
        patch: {
          type: "object",
          properties: {
            evExperience: { type: "string", enum: EV_EXPERIENCES },
            state: { type: "string", pattern: "^(unknown|[A-Z]{2})$" },
            utility: { type: "string", enum: UTILITIES },
            chargingSituation: { type: "string", enum: CHARGING_SITUATIONS },
            useCases: {
              type: "array",
              items: { type: "string", enum: USE_CASES },
              uniqueItems: true,
            },
            priorities: {
              type: "array",
              items: { type: "string", enum: PRIORITIES },
              uniqueItems: true,
            },
            financing: {
              anyOf: [
                { type: "boolean" },
                { type: "string", enum: ["unknown"] },
              ],
            },
            crossShopIds: {
              type: "array",
              items: { type: "string", enum: CROSS_SHOPS },
              uniqueItems: true,
            },
          },
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ["expectedRevision", "patch"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[7]);
      assertOnlyKeys(record, ["expectedRevision", "patch"], CONFIGURATOR_TOOL_NAMES[7]);
      const result = mutations.setBuyerContext({
        expectedRevision: parseExpectedRevision(
          record.expectedRevision,
          CONFIGURATOR_TOOL_NAMES[7],
        ),
        patch: parseBuyerContextPatch(record.patch, CONFIGURATOR_TOOL_NAMES[7]),
        source: "agent",
      });
      if (!result.ok) return result;
      const next = store.getState();
      return {
        ...result,
        buyerContext: cloneBuyerContext(next.domain.buyerContext),
        incentives: citeIncentives(next.catalog, next.resolved.incentives),
      };
    },
  };

  const estimateOwnershipCost: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[8],
    title: "Estimate vehicle ownership cost",
    description:
      "Estimate monthly payment, sales tax, loan principal, energy, maintenance, and a multi-year ownership total for the current build. Read-only, so several financing scenarios can be priced without changing the build. Every assumption is optional and falls back to a catalog-derived default; the response names which defaults were used. Conditional credits and deductions are never netted into the payment.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: expectedRevisionSchema,
        assumptions: {
          type: "object",
          properties: {
            aprPct: {
              type: "number",
              minimum: 0,
              maximum: 30,
              description: "Annual percentage rate, expressed in percent (6.5 = 6.5%).",
            },
            termMonths: {
              type: "integer",
              minimum: 12,
              maximum: 96,
              description: "Loan term in months.",
            },
            downPayment: {
              type: "number",
              minimum: 0,
              description: "Cash down in USD. Cannot exceed the vehicle total.",
            },
            salesTaxRate: {
              type: "number",
              minimum: 0,
              maximum: 0.2,
              description: "Fraction, not percent. 0.08 means 8%.",
            },
            annualMiles: {
              type: "number",
              minimum: 0,
              maximum: 50_000,
              description: "Miles driven per year.",
            },
            homeKwhRate: {
              type: "number",
              minimum: 0,
              maximum: 2,
              description: "Home electricity price in USD per kWh.",
            },
            publicKwhRate: {
              type: "number",
              minimum: 0,
              maximum: 2,
              description: "Public charging price in USD per kWh.",
            },
            homeChargingShare: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Fraction of charging done at home. 0.8 means 80%.",
            },
            horizonYears: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Ownership horizon used for the running total.",
            },
          },
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ["expectedRevision"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[8];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["expectedRevision", "assumptions"], toolName);

      const stored = store.getState().session.ownershipAssumptions;
      const overrides =
        record.assumptions === undefined
          ? {}
          : assertRecord(record.assumptions, toolName);
      const allowed = Object.keys(stored);
      assertOnlyKeys(overrides, allowed, toolName);

      const merged = { ...stored };
      const overridden: string[] = [];
      for (const key of allowed) {
        const value = overrides[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new TypeError(`${toolName} expects ${key} to be a finite number.`);
        }
        merged[key as keyof typeof merged] = value;
        overridden.push(key);
      }

      // Priced without touching the store, so an agent can quote three
      // scenarios without mutating the build the person is looking at.
      const expectedRevision = parseExpectedRevision(record.expectedRevision, toolName);
      const current = store.getState();
      if (current.domain.revision !== expectedRevision) {
        return {
          ok: false as const,
          error: {
            code: "REVISION_CONFLICT" as const,
            message: `Build moved to revision ${current.domain.revision}. Re-read the configuration and retry.`,
            currentRevision: current.domain.revision,
          },
        };
      }

      const issues = validateOwnershipAssumptions(
        merged,
        current.resolved.price.vehicleTotal,
      );
      if (issues.length > 0) {
        return {
          ok: false as const,
          error: {
            code: "INVALID_INPUT" as const,
            message: issues.join("; "),
            currentRevision: current.domain.revision,
          },
        };
      }

      try {
        const estimate = estimateOwnership(current.catalog, current.resolved, merged);
        return {
          ok: true as const,
          domainRevision: current.domain.revision,
          snapshot: {
            id: `estimate-${current.domain.revision}`,
            revision: current.domain.revision,
            assumptions: merged,
            result: estimate,
          },
          overriddenAssumptions: overridden,
          defaultsUsed: allowed.filter((key) => !overridden.includes(key)),
        };
      } catch (error) {
        return {
          ok: false as const,
          error: {
            code: "INVALID_INPUT" as const,
            message:
              error instanceof OwnershipAssumptionError
                ? error.issues.join("; ")
                : errorMessage(error),
            currentRevision: current.domain.revision,
          },
        };
      }
    },
  };

  const compareConfigurations: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[9],
    title: "Compare vehicle configurations",
    description:
      "Compare the current build against up to three alternatives side by side on price, range, power, 0-60, matched savings, and delivery. Each alternative is a patch applied to the current build. Read-only: nothing is applied. Invalid alternatives are still returned, marked invalid with their violations, so a trade-off can be explained rather than hidden.",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1, maxLength: 60 },
              patch: patchSchema(store.getState().catalog),
            },
            required: ["label", "patch"],
            additionalProperties: false,
          },
        },
        includeCurrent: {
          type: "boolean",
          description: "Include the current build as the first column. Defaults to true.",
        },
      },
      required: ["candidates"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[9];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["candidates", "includeCurrent"], toolName);

      if (!Array.isArray(record.candidates) || record.candidates.length < 1) {
        throw new TypeError(`${toolName} requires between one and three candidates.`);
      }
      if (record.candidates.length > 3) {
        throw new TypeError(`${toolName} accepts at most three candidates.`);
      }
      const includeCurrent = record.includeCurrent ?? true;
      if (typeof includeCurrent !== "boolean") {
        throw new TypeError(`${toolName} expects includeCurrent to be a boolean.`);
      }

      const state = store.getState();
      const base = state.resolved;
      const buyer = state.domain.buyerContext;

      const columns: Array<{ label: string; result: typeof base; valid: boolean; violations: unknown[] }> = [];
      if (includeCurrent) {
        columns.push({ label: "Current build", result: base, valid: base.valid, violations: [...base.violations] });
      }

      for (const raw of record.candidates) {
        const candidate = assertRecord(raw, toolName);
        assertOnlyKeys(candidate, ["label", "patch"], toolName);
        const label = parseBoundedString(candidate.label, "label", toolName, 60);
        const patch = parsePatch(candidate.patch, state.catalog, toolName);
        const resolution = resolveAtomicPatch(state.catalog, base.selections, patch, buyer);
        columns.push({
          label,
          result: resolution.candidate,
          valid: resolution.candidate.valid,
          violations: [...resolution.candidate.violations],
        });
      }

      const comparison = crossCompare(
        columns.map((column) => column.result),
        columns.map((column) => column.label),
        DEFAULT_COMPARISON_KEYS,
      );

      return {
        ok: true,
        revision: state.domain.revision,
        keys: [...DEFAULT_COMPARISON_KEYS],
        labels: comparison.labels,
        table: comparison.table,
        columns: columns.map((column) => ({
          label: column.label,
          valid: column.valid,
          violations: column.violations,
          selections: cloneSelections(column.result.selections),
        })),
      };
    },
  };

  const getVehicleTwinState: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[10],
    title: "Get digital twin state",
    description:
      "Read the AutoLab Garage camera, active motions, selected component, available views, and the configuration revision synchronized from the configurator. Read-only and does not move the vehicle.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[10]);
      assertOnlyKeys(record, [], CONFIGURATOR_TOOL_NAMES[10]);
      const { state, context } = await synchronizeTwin(
        CONFIGURATOR_TOOL_NAMES[10],
        options?.signal,
      );
      const twin = await bridge.call<Record<string, unknown>>(
        "get_state",
        {},
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, CONFIGURATOR_TOOL_NAMES[10]);
      return { ok: true, revision: state.domain.revision, context, twin };
    },
  };

  const listVehicleParts: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[11],
    title: "List digital twin components",
    description:
      "List the RX2 digital twin's named components. Filter by shell, chassis, running gear, or interior; request detail for measured world-space bounds in metres.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["shell", "chassis", "running", "interior"] },
        detail: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[11];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["category", "detail"], toolName);
      if (
        record.category !== undefined
        && !["shell", "chassis", "running", "interior"].includes(String(record.category))
      ) throw new TypeError(`${toolName} received an unsupported category.`);
      if (record.detail !== undefined && typeof record.detail !== "boolean") {
        throw new TypeError(`${toolName} expects detail to be a boolean.`);
      }
      const { state } = await synchronizeTwin(toolName, options?.signal);
      const result = await bridge.call<Record<string, unknown>>(
        "list_parts",
        {
          ...(record.category === undefined ? {} : { category: record.category }),
          detail: record.detail ?? false,
        },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      return { ok: true, revision: state.domain.revision, ...result };
    },
  };

  const inspectVehiclePart: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[12],
    title: "Inspect a vehicle component",
    description:
      "Open AutoLab Garage, find one named component, reveal it through the body when necessary, frame it with the camera, and highlight it with an authored technical leader. Part ids come from list_vehicle_parts — call it first rather than guessing. This switches the page to Garage; set_autolab_workspace switches it back.",
    inputSchema: {
      type: "object",
      properties: {
        part: { type: "string", minLength: 1, maxLength: 80 },
        revealUnderBody: { type: "boolean", description: "Dissolve the shell for chassis and interior components. Defaults to true." },
        azimuthDeg: { type: "number" },
        elevationDeg: { type: "number", minimum: 2, maximum: 86 },
        margin: { type: "number", minimum: 0.1, maximum: 3 },
      },
      required: ["part"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[12];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["part", "revealUnderBody", "azimuthDeg", "elevationDeg", "margin"], toolName);
      const partName = parseBoundedString(record.part, "part", toolName);
      if (record.revealUnderBody !== undefined && typeof record.revealUnderBody !== "boolean") {
        throw new TypeError(`${toolName} expects revealUnderBody to be a boolean.`);
      }
      const azimuthDeg = parseFiniteNumber(record.azimuthDeg, "azimuthDeg", toolName);
      const elevationDeg = parseFiniteNumber(
        record.elevationDeg,
        "elevationDeg",
        toolName,
        { minimum: 2, maximum: 86 },
      );
      const margin = parseFiniteNumber(
        record.margin,
        "margin",
        toolName,
        { minimum: 0.1, maximum: 3 },
      );

      bridge.setWorkspace("garage");
      const { state } = await synchronizeTwin(toolName, options?.signal);
      const part = await bridge.call<{ id: string; label: string; category: string }>(
        "get_part",
        { part: partName },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      if (part.category !== "shell" && record.revealUnderBody !== false) {
        await bridge.call(
          "set_motion",
          { motion: "panels", on: true },
          { signal: options?.signal },
        );
        assertTwinRevision(state.domain.revision, toolName);
      }
      const frame = await bridge.call<Record<string, unknown>>(
        "frame_part",
        {
          part: partName,
          ...(azimuthDeg === undefined ? {} : { azimuth_deg: azimuthDeg }),
          ...(elevationDeg === undefined ? {} : { elevation_deg: elevationDeg }),
          ...(margin === undefined ? {} : { margin }),
        },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      await bridge.call(
        "highlight_part",
        { part: partName },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      return {
        ok: true,
        revision: state.domain.revision,
        workspace: bridge.getWorkspace(),
        part,
        frame,
      };
    },
  };

  const setVehicleTwinView: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[13],
    title: "Set digital twin view",
    description:
      "Open AutoLab Garage and move the synchronized vehicle to an authored ISO, three-quarter, side, front, or top view. Side, front, and top are true orthographic elevations.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["iso", "q34f", "q34r", "side", "front", "top"] },
        annotationsVisible: { type: "boolean" },
      },
      required: ["view"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[13];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["view", "annotationsVisible"], toolName);
      if (!["iso", "q34f", "q34r", "side", "front", "top"].includes(String(record.view))) {
        throw new TypeError(`${toolName} requires a supported view.`);
      }
      if (record.annotationsVisible !== undefined && typeof record.annotationsVisible !== "boolean") {
        throw new TypeError(`${toolName} expects annotationsVisible to be a boolean.`);
      }
      bridge.setWorkspace("garage");
      const { state } = await synchronizeTwin(toolName, options?.signal);
      const view = await bridge.call<Record<string, unknown>>(
        "set_view",
        { view: record.view },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      if (record.annotationsVisible !== undefined) {
        await bridge.call(
          "set_annotations",
          { visible: record.annotationsVisible },
          { signal: options?.signal },
        );
        assertTwinRevision(state.domain.revision, toolName);
      }
      return { ok: true, revision: state.domain.revision, workspace: bridge.getWorkspace(), view };
    },
  };

  const setVehicleTwinMotion: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[14],
    title: "Set digital twin motion",
    description:
      "Open AutoLab Garage and turn one vehicle demonstration on or off. The values do not all read the way they look: run = idle telemetry and wheel spin; drive = rolling road with steering; lights = headlamp and tail-lamp beams; panels = DISSOLVE the body shell to reveal the chassis (it does not show panels); explode = separate every component along its assembly axis; open = swing the hood, liftgate, four doors and charge-port door. run and drive are coupled — turning drive on turns run on, turning run off turns drive off — so the reply reports all six. Omit `on` to toggle. This switches the page to Garage; set_autolab_workspace switches it back.",
    inputSchema: {
      type: "object",
      properties: {
        motion: { type: "string", enum: ["run", "drive", "lights", "panels", "explode", "open"] },
        on: { type: "boolean" },
      },
      required: ["motion"],
      additionalProperties: false,
    },
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: false },
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[14];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["motion", "on"], toolName);
      if (!["run", "drive", "lights", "panels", "explode", "open"].includes(String(record.motion))) {
        throw new TypeError(`${toolName} requires a supported motion.`);
      }
      if (record.on !== undefined && typeof record.on !== "boolean") {
        throw new TypeError(`${toolName} expects on to be a boolean.`);
      }
      bridge.setWorkspace("garage");
      const { state } = await synchronizeTwin(toolName, options?.signal);
      const result = await bridge.call<Record<string, unknown>>(
        "set_motion",
        {
          motion: record.motion,
          ...(record.on === undefined ? {} : { on: record.on }),
        },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      return { ok: true, revision: state.domain.revision, workspace: bridge.getWorkspace(), ...result };
    },
  };

  /**
   * The way back.
   *
   * Three of the twin tools push the page into Garage, which hides the whole
   * configurator. Without this an agent can enter that surface and never
   * leave, while presentation tools keep reporting success against a canvas
   * nobody can see.
   */
  const setAutolabWorkspace: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[16],
    title: "Switch AutoLab surface",
    description:
      "Show either the Configure surface (build, pricing, paint, wheels, interior) or the Garage digital twin (components, motion, measurement). Inspecting a part, setting a twin view or running a twin motion switches to Garage on its own; this is how you come back. Presentation tools such as present_vehicle_configuration only affect the Configure canvas, so switch back before using them. Read the current surface from get_vehicle_configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", enum: AUTOLAB_WORKSPACES },
      },
      required: ["workspace"],
      additionalProperties: false,
    },
    // Switching surfaces destroys nothing, and asking for the surface you are
    // already on is a no-op.
    annotations: { ...SAFE_MUTATION_ANNOTATIONS, idempotentHint: true },
    execute: (input, options) => {
      throwIfAborted(options?.signal);
      const record = assertRecord(input, CONFIGURATOR_TOOL_NAMES[16]);
      assertOnlyKeys(record, ["workspace"], CONFIGURATOR_TOOL_NAMES[16]);
      const next = record.workspace;
      if (typeof next !== "string" || !AUTOLAB_WORKSPACES.includes(next as AutoLabWorkspace)) {
        throw new TypeError(
          `${CONFIGURATOR_TOOL_NAMES[16]} requires workspace to be one of ${AUTOLAB_WORKSPACES.join(", ")}.`,
        );
      }
      const previous = bridge.getWorkspace();
      bridge.setWorkspace(next as AutoLabWorkspace);
      return { ok: true, changed: previous !== next, workspace: next };
    },
  };

  const measureVehicleParts: ToolDefinition = {
    name: CONFIGURATOR_TOOL_NAMES[15],
    title: "Measure between vehicle components",
    description:
      "Measure the centre-to-centre distance and per-axis separation between two named digital-twin components in metres. Read-only and does not move the vehicle.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", minLength: 1, maxLength: 80 },
        to: { type: "string", minLength: 1, maxLength: 80 },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (input, options) => {
      throwIfAborted(options?.signal);
      const toolName = CONFIGURATOR_TOOL_NAMES[15];
      const record = assertRecord(input, toolName);
      assertOnlyKeys(record, ["from", "to"], toolName);
      const from = parseBoundedString(record.from, "from", toolName);
      const to = parseBoundedString(record.to, "to", toolName);
      const { state } = await synchronizeTwin(toolName, options?.signal);
      const result = await bridge.call<Record<string, unknown>>(
        "measure",
        { from, to },
        { signal: options?.signal },
      );
      assertTwinRevision(state.domain.revision, toolName);
      return { ok: true, revision: state.domain.revision, ...result };
    },
  };


  return [
    getConfiguration,
    listOptions,
    simulateChange,
    applyTransaction,
    interruptTransaction,
    undoTransaction,
    presentConfiguration,
    setBuyerContext,
    estimateOwnershipCost,
    compareConfigurations,
    getVehicleTwinState,
    listVehicleParts,
    inspectVehiclePart,
    setVehicleTwinView,
    setVehicleTwinMotion,
    measureVehicleParts,
    setAutolabWorkspace,
  ];
}

async function registerTools(
  dependencies: ConfiguratorToolsDependencies,
  modelContext: ModelContextApi,
): Promise<ConfiguratorSiteToolsStatus> {
  publishStatus({ state: "registering", toolNames: [] });
  const controller = new AbortController();
  registrationController = controller;
  const registeredToolNames: ConfiguratorToolName[] = [];

  try {
    for (const tool of createConfiguratorToolDefinitions(dependencies)) {
      await modelContext.registerTool(tool, { signal: controller.signal });
      registeredToolNames.push(tool.name as ConfiguratorToolName);
    }
    const status = {
      state: "ready",
      toolNames: [...registeredToolNames],
    } as const;
    publishStatus(status);
    return status;
  } catch (error) {
    controller.abort();
    if (registrationController === controller) registrationController = undefined;
    const status = {
      state: "degraded",
      toolNames: [...registeredToolNames],
      message: errorMessage(error),
    } as const;
    publishStatus(status);
    return status;
  }
}

/**
 * Wait for a host that injects the API after first paint. Resolves as soon as
 * the API appears, or gives up after LATE_INJECTION_WINDOW_MS.
 */
function waitForModelContext(): Promise<ModelContextApi | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (api: ModelContextApi | undefined) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      for (const event of MODEL_CONTEXT_EVENTS) {
        document.removeEventListener(event, onEvent);
        window.removeEventListener(event, onEvent);
      }
      resolve(api);
    };
    const onEvent = () => {
      const api = findModelContext();
      if (api) finish(api);
    };
    const poll = window.setInterval(onEvent, LATE_INJECTION_POLL_MS);
    const deadline = window.setTimeout(
      () => finish(undefined),
      LATE_INJECTION_WINDOW_MS,
    );
    for (const event of MODEL_CONTEXT_EVENTS) {
      document.addEventListener(event, onEvent);
      window.addEventListener(event, onEvent);
    }
  });
}

async function register(
  dependencies: ConfiguratorToolsDependencies,
): Promise<ConfiguratorSiteToolsStatus> {
  if (window.top !== window) {
    const status = { state: "unsupported", toolNames: [] } as const;
    publishStatus(status);
    return status;
  }

  const immediate = findModelContext();
  if (immediate) return registerTools(dependencies, immediate);

  // No API yet. Resolve as manual mode now so the UI paints, but keep watching
  // and upgrade in place through observeConfiguratorSiteTools if a host
  // injects the API after first paint.
  const status = { state: "unsupported", toolNames: [] } as const;
  publishStatus(status);
  void waitForModelContext().then((late) => {
    if (late) {
      registration = registerTools(dependencies, late);
      return;
    }
    // Give up watching, but clear the memo so a later caller can retry.
    registration = undefined;
  });
  return status;
}

export function registerConfiguratorSiteTools(
  dependencies: ConfiguratorToolsDependencies = defaultDependencies,
): Promise<ConfiguratorSiteToolsStatus> {
  registration ??= register(dependencies);
  return registration;
}

export function unregisterConfiguratorSiteTools() {
  registrationController?.abort();
  registrationController = undefined;
  registration = undefined;
  currentStatus = { state: "registering", toolNames: [] };
}

export function resetConfiguratorSiteToolsForTests() {
  unregisterConfiguratorSiteTools();
}

if (import.meta.hot) {
  import.meta.hot.dispose(unregisterConfiguratorSiteTools);
}
