import { findCompatibleAlternatives } from "../domain/alternatives";
import type {
  BuyerContext,
  BuyerContextInput,
  CanonicalSelections,
  Catalog,
  DomainViolation,
  ResolveResult,
  SelectionPatch,
} from "../domain/catalog.types";
import {
  estimateOwnership,
  type OwnershipAssumptions,
  type OwnershipResult,
} from "../domain/ownership";
import {
  BuyerContextValidationError,
  normalizeBuyerContext,
  resolve,
  resolveAtomicPatch,
} from "../domain/resolve";
import type {
  ConfiguratorStore,
  OwnershipEstimateSnapshot,
} from "./configurator.store";
import type {
  BuildSummary,
  CompletedStage,
  ConfigurationStage,
  MutationError,
  MutationRejected,
  MutationSource,
  SkippedStage,
  TransactionReceipt,
  UndoSnapshot,
} from "./transactions";
import {
  buyerContextEqual,
  cloneDomainState,
  cloneSelections,
  selectionsEqual,
} from "./transactions";

export interface ConfigurationDelta {
  price: number;
  rangeMiles: number | null;
  deliveryChanged: boolean;
  changedGroups: string[];
}

export interface SimulationCompleted {
  ok: true;
  currentRevision: number;
  patch: SelectionPatch;
  candidate: ResolveResult;
  delta: ConfigurationDelta;
  alternatives: ReturnType<typeof findCompatibleAlternatives>;
}

export type SimulationResult = SimulationCompleted | MutationRejected;

export interface DomainMutationCompleted {
  ok: true;
  changed: boolean;
  source: MutationSource;
  previousRevision: number;
  revision: number;
  resolved: ResolveResult;
}

export type DomainMutationResult = DomainMutationCompleted | MutationRejected;

export interface BuyerContextMutationCompleted extends DomainMutationCompleted {
  changedFields: Array<keyof BuyerContext>;
}

export type BuyerContextMutationResult =
  | BuyerContextMutationCompleted
  | MutationRejected;

export interface AgentTransactionCompleted {
  ok: true;
  receipt: TransactionReceipt;
}

export type AgentTransactionResult = AgentTransactionCompleted | MutationRejected;

export interface UndoCompleted extends DomainMutationCompleted {
  transactionId: string;
  revertedFromRevision: number;
}

export type UndoResult = UndoCompleted | MutationRejected;

export interface OwnershipEstimateCompleted {
  ok: true;
  snapshot: OwnershipEstimateSnapshot;
  domainRevision: number;
}

export interface OwnershipEstimateRejected {
  ok: false;
  error: MutationError;
}

export type OwnershipEstimateResult =
  | OwnershipEstimateCompleted
  | OwnershipEstimateRejected;

export interface ApplyAgentTransactionInput {
  expectedRevision: number;
  stages: ConfigurationStage[];
  signal?: AbortSignal;
  stageDelayMs?: number;
}

export interface MutationServiceOptions {
  defaultStageDelayMs?: number;
}

export interface MutationService {
  simulateConfiguration(input: {
    expectedRevision: number;
    patch: SelectionPatch;
  }): SimulationResult;
  applyHumanPatch(input: {
    patch: SelectionPatch;
    expectedRevision?: number;
  }): DomainMutationResult;
  setBuyerContext(input: {
    expectedRevision: number;
    patch: BuyerContextInput;
    source?: "human" | "agent";
  }): BuyerContextMutationResult;
  restoreSharedState(input: {
    expectedRevision: number;
    selections: CanonicalSelections;
    buyerContext: BuyerContextInput;
  }): DomainMutationResult;
  applyAgentTransaction(
    input: ApplyAgentTransactionInput,
  ): Promise<AgentTransactionResult>;
  interruptAgentTransaction(reason?: string): boolean;
  undoLastAgentTransaction(input: { expectedRevision: number }): UndoResult;
  estimateOwnership(input: {
    expectedRevision: number;
    assumptions: OwnershipAssumptions;
  }): OwnershipEstimateResult;
}

function rejected(
  code: MutationError["code"],
  message: string,
  currentRevision: number,
  violations?: DomainViolation[],
): MutationRejected {
  return {
    ok: false,
    error: {
      code,
      message,
      currentRevision,
      ...(violations ? { violations } : {}),
    },
  };
}

function rangeMiles(result: ResolveResult): number | null {
  return typeof result.specs.range_mi === "number" ? result.specs.range_mi : null;
}

function summary(result: ResolveResult, revision: number): BuildSummary {
  return {
    revision,
    selections: cloneSelections(result.selections),
    vehicleTotal: result.price.vehicleTotal,
    rangeMiles: rangeMiles(result),
    deliveryWindow: result.delivery?.window ?? null,
  };
}

function changedGroups(
  before: CanonicalSelections,
  after: CanonicalSelections,
): string[] {
  const groups = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...groups].filter((groupId) => {
    const left = before[groupId] ?? [];
    const right = after[groupId] ?? [];
    return (
      left.length !== right.length ||
      left.some((value, index) => value !== right[index])
    );
  });
}

function delta(before: ResolveResult, after: ResolveResult): ConfigurationDelta {
  const beforeRange = rangeMiles(before);
  const afterRange = rangeMiles(after);
  return {
    price: after.price.vehicleTotal - before.price.vehicleTotal,
    rangeMiles:
      beforeRange === null || afterRange === null ? null : afterRange - beforeRange,
    deliveryChanged: before.delivery?.window !== after.delivery?.window,
    changedGroups: changedGroups(before.selections, after.selections),
  };
}

function contextChangedFields(
  before: BuyerContext,
  after: BuyerContext,
): Array<keyof BuyerContext> {
  const keys: Array<keyof BuyerContext> = [
    "evExperience",
    "state",
    "utility",
    "chargingSituation",
    "useCases",
    "priorities",
    "financing",
    "crossShopIds",
  ];
  return keys.filter((key) => {
    const left = before[key];
    const right = after[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return (
        left.length !== right.length ||
        left.some((value, index) => value !== right[index])
      );
    }
    return left !== right;
  });
}

function validateStages(stages: ConfigurationStage[], currentRevision: number): MutationRejected | null {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 4) {
    return rejected(
      "INVALID_INPUT",
      "An agent transaction requires between one and four stages.",
      currentRevision,
    );
  }
  for (const [index, stage] of stages.entries()) {
    if (!stage || typeof stage !== "object") {
      return rejected("INVALID_INPUT", `Stage ${index + 1} must be an object.`, currentRevision);
    }
    if (
      typeof stage.label !== "string" ||
      stage.label.length < 1 ||
      stage.label.length > 60 ||
      [...stage.label].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      return rejected(
        "INVALID_INPUT",
        `Stage ${index + 1} label must be 1–60 plain-text characters.`,
        currentRevision,
      );
    }
    if (!stage.patch || typeof stage.patch !== "object" || !stage.patch.set) {
      return rejected(
        "INVALID_INPUT",
        `Stage ${index + 1} requires a selection patch.`,
        currentRevision,
      );
    }
  }
  return null;
}

function cloneAssumptions(assumptions: OwnershipAssumptions): OwnershipAssumptions {
  return { ...assumptions };
}

function cloneOwnershipResult(result: OwnershipResult): OwnershipResult {
  return { ...result, assumptions: cloneAssumptions(result.assumptions) };
}

export function createMutationService(
  store: ConfiguratorStore,
  catalog: Catalog = store.getState().catalog,
  options: MutationServiceOptions = {},
): MutationService {
  const defaultStageDelayMs = options.defaultStageDelayMs ?? 450;
  let cancelStagePause: (() => void) | null = null;

  function checkRevision(expectedRevision: number): MutationRejected | null {
    const currentRevision = store.getState().domain.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      return rejected(
        "INVALID_INPUT",
        "expectedRevision must be a positive safe integer.",
        currentRevision,
      );
    }
    if (expectedRevision !== currentRevision) {
      return rejected(
        "REVISION_CONFLICT",
        // Say what to do, not only what happened. This is the conflict path for
        // every build-mutating tool, and it is reached precisely when an agent
        // has stale state — the moment it most needs the recovery step.
        `Expected revision ${expectedRevision}, but the current revision is ${currentRevision}. `
          + "Someone changed the build after you last read it. Call get_vehicle_configuration to "
          + "read the current revision and selections, decide whether your change still applies, "
          + "then retry with the revision it returns.",
        currentRevision,
      );
    }
    return null;
  }

  function interruptAgentTransaction(reason = "human_interaction"): boolean {
    const active = store.getState().session.activeAgentTransaction;
    if (!active || active.interrupted) return false;
    store.setState((state) => ({
      session: {
        ...state.session,
        activeAgentTransaction: state.session.activeAgentTransaction
          ? {
              ...state.session.activeAgentTransaction,
              interrupted: true,
              interruptionReason: reason,
            }
          : null,
      },
    }));
    cancelStagePause?.();
    return true;
  }

  function commitDomain(
    nextResolved: ResolveResult,
    nextBuyerContext: BuyerContext,
    source: MutationSource,
    expectedRevision: number,
    preserveUndo = false,
  ): DomainMutationResult {
    const conflict = checkRevision(expectedRevision);
    if (conflict) return conflict;
    if (!nextResolved.valid) {
      return rejected(
        "INVALID_CONFIGURATION",
        "The requested configuration is not valid.",
        expectedRevision,
        nextResolved.violations,
      );
    }

    const state = store.getState();
    const didChange =
      !selectionsEqual(state.domain.selections, nextResolved.selections) ||
      !buyerContextEqual(state.domain.buyerContext, nextBuyerContext);
    if (!didChange) {
      return {
        ok: true,
        changed: false,
        source,
        previousRevision: expectedRevision,
        revision: expectedRevision,
        resolved: state.resolved,
      };
    }

    const revision = expectedRevision + 1;
    store.setState((current) => ({
      domain: {
        ...current.domain,
        revision,
        selections: cloneSelections(nextResolved.selections),
        buyerContext: nextBuyerContext,
      },
      resolved: nextResolved,
      session: {
        ...current.session,
        undo: preserveUndo ? current.session.undo : null,
        ownershipEstimate: null,
      },
    }));
    return {
      ok: true,
      changed: true,
      source,
      previousRevision: expectedRevision,
      revision,
      resolved: nextResolved,
    };
  }

  function simulateConfiguration(input: {
    expectedRevision: number;
    patch: SelectionPatch;
  }): SimulationResult {
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    const state = store.getState();
    try {
      const resolution = resolveAtomicPatch(
        catalog,
        state.domain.selections,
        input.patch,
        state.domain.buyerContext,
      );
      const alternatives = resolution.valid
        ? []
        : findCompatibleAlternatives(
            catalog,
            resolution.candidate.selections,
            state.domain.buyerContext,
          );
      return {
        ok: true,
        currentRevision: state.domain.revision,
        patch: resolution.patch,
        candidate: resolution.candidate,
        delta: delta(resolution.base, resolution.candidate),
        alternatives,
      };
    } catch (error) {
      return rejected(
        "INVALID_INPUT",
        error instanceof Error ? error.message : "The selection patch is malformed.",
        state.domain.revision,
      );
    }
  }

  function applyHumanPatch(input: {
    patch: SelectionPatch;
    expectedRevision?: number;
  }): DomainMutationResult {
    interruptAgentTransaction("human_configuration_change");
    const expectedRevision = input.expectedRevision ?? store.getState().domain.revision;
    const simulation = simulateConfiguration({
      expectedRevision,
      patch: input.patch,
    });
    if (!simulation.ok) return simulation;
    if (!simulation.candidate.valid) {
      return rejected(
        "INVALID_CONFIGURATION",
        "The requested configuration is not valid.",
        expectedRevision,
        simulation.candidate.violations,
      );
    }
    return commitDomain(
      simulation.candidate,
      simulation.candidate.buyerContext,
      "human",
      expectedRevision,
    );
  }

  function setBuyerContext(input: {
    expectedRevision: number;
    patch: BuyerContextInput;
    source?: "human" | "agent";
  }): BuyerContextMutationResult {
    const source = input.source ?? "agent";
    if (source === "human") interruptAgentTransaction("human_context_change");
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    if (store.getState().session.activeAgentTransaction && source === "agent") {
      return rejected(
        "TRANSACTION_ACTIVE",
        "Buyer context cannot change during an active configuration transaction.",
        input.expectedRevision,
      );
    }
    const state = store.getState();
    try {
      const buyerContext = normalizeBuyerContext({
        ...state.domain.buyerContext,
        ...input.patch,
      });
      const nextResolved = resolve(catalog, state.domain.selections, buyerContext);
      const changedFields = contextChangedFields(
        state.domain.buyerContext,
        buyerContext,
      );
      const committed = commitDomain(
        nextResolved,
        buyerContext,
        source,
        input.expectedRevision,
      );
      return committed.ok ? { ...committed, changedFields } : committed;
    } catch (error) {
      const message =
        error instanceof BuyerContextValidationError
          ? error.message
          : "The buyer-context patch is malformed.";
      return rejected("INVALID_INPUT", message, state.domain.revision);
    }
  }

  function restoreSharedState(input: {
    expectedRevision: number;
    selections: CanonicalSelections;
    buyerContext: BuyerContextInput;
  }): DomainMutationResult {
    interruptAgentTransaction("browser_history_navigation");
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    const state = store.getState();
    try {
      const buyerContext = normalizeBuyerContext(input.buyerContext);
      const restored = resolve(catalog, input.selections, buyerContext);
      return commitDomain(
        restored,
        buyerContext,
        "restore",
        input.expectedRevision,
      );
    } catch (error) {
      return rejected(
        "INVALID_INPUT",
        error instanceof Error ? error.message : "Shared state is malformed.",
        state.domain.revision,
      );
    }
  }

  function pauseBetweenStages(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return Promise.resolve();
    return new Promise((resolvePause) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", finish);
        if (cancelStagePause === finish) cancelStagePause = null;
        resolvePause();
      };
      const timeout = setTimeout(finish, ms);
      cancelStagePause = finish;
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  async function applyAgentTransaction(
    input: ApplyAgentTransactionInput,
  ): Promise<AgentTransactionResult> {
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    const stageIssue = validateStages(input.stages, input.expectedRevision);
    if (stageIssue) return stageIssue;
    if (store.getState().session.activeAgentTransaction) {
      return rejected(
        "TRANSACTION_ACTIVE",
        "Another agent transaction is already active.",
        input.expectedRevision,
      );
    }
    const stageDelayMs = input.stageDelayMs ?? defaultStageDelayMs;
    if (!Number.isFinite(stageDelayMs) || stageDelayMs < 0 || stageDelayMs > 10_000) {
      return rejected(
        "INVALID_INPUT",
        "stageDelayMs must be between 0 and 10,000.",
        input.expectedRevision,
      );
    }

    const start = store.getState();
    let previewSelections = cloneSelections(start.domain.selections);
    const canonicalStages: ConfigurationStage[] = [];
    for (const [index, stage] of input.stages.entries()) {
      try {
        const resolution = resolveAtomicPatch(
          catalog,
          previewSelections,
          stage.patch,
          start.domain.buyerContext,
        );
        if (!resolution.valid) {
          return rejected(
            "INVALID_CONFIGURATION",
            `Stage ${index + 1} (${stage.label}) is not valid.`,
            input.expectedRevision,
            resolution.candidate.violations,
          );
        }
        if (selectionsEqual(previewSelections, resolution.candidate.selections)) {
          return rejected(
            "INVALID_INPUT",
            `Stage ${index + 1} (${stage.label}) does not change the build.`,
            input.expectedRevision,
          );
        }
        canonicalStages.push({ label: stage.label, patch: resolution.patch });
        previewSelections = cloneSelections(resolution.candidate.selections);
      } catch (error) {
        return rejected(
          "INVALID_INPUT",
          `Stage ${index + 1} is malformed: ${
            error instanceof Error ? error.message : "invalid patch"
          }`,
          input.expectedRevision,
        );
      }
    }

    const transactionSequence = start.session.transactionSequence + 1;
    const id = `tx-${input.expectedRevision}-${transactionSequence}`;
    const beforeDomain = cloneDomainState(start.domain);
    const beforeSummary = summary(start.resolved, start.domain.revision);
    store.setState((state) => ({
      session: {
        ...state.session,
        transactionSequence,
        activeAgentTransaction: {
          id,
          expectedRevision: input.expectedRevision,
          stageCount: canonicalStages.length,
          completedCount: 0,
          interrupted: input.signal?.aborted ?? false,
          interruptionReason: input.signal?.aborted ? "execution_aborted" : null,
        },
        undo: null,
      },
    }));

    const completedStages: CompletedStage[] = [];
    let interruptionReason: string | null = null;
    for (const [index, stage] of canonicalStages.entries()) {
      const active = store.getState().session.activeAgentTransaction;
      if (
        input.signal?.aborted ||
        !active ||
        active.id !== id ||
        active.interrupted
      ) {
        interruptionReason =
          active?.interruptionReason ??
          (input.signal?.aborted ? "execution_aborted" : "transaction_replaced");
        break;
      }

      const state = store.getState();
      let resolution;
      try {
        resolution = resolveAtomicPatch(
          catalog,
          state.domain.selections,
          stage.patch,
          state.domain.buyerContext,
        );
      } catch (error) {
        interruptionReason =
          error instanceof Error ? `stage_error: ${error.message}` : "stage_error";
        break;
      }
      if (!resolution.valid) {
        interruptionReason = "configuration_changed";
        break;
      }
      const committed = commitDomain(
        resolution.candidate,
        state.domain.buyerContext,
        "agent",
        state.domain.revision,
      );
      if (!committed.ok || !committed.changed) {
        interruptionReason = committed.ok
          ? "stage_no_longer_changes_build"
          : committed.error.code.toLowerCase();
        break;
      }
      completedStages.push({
        index,
        label: stage.label,
        patch: stage.patch,
        revision: committed.revision,
      });
      store.setState((current) => ({
        session: {
          ...current.session,
          activeAgentTransaction:
            current.session.activeAgentTransaction?.id === id
              ? {
                  ...current.session.activeAgentTransaction,
                  completedCount: completedStages.length,
                }
              : current.session.activeAgentTransaction,
        },
      }));

      if (index < canonicalStages.length - 1) {
        await pauseBetweenStages(stageDelayMs, input.signal);
      }
    }

    cancelStagePause = null;
    const finalState = store.getState();
    const completedIndices = new Set(completedStages.map((stage) => stage.index));
    const skippedStages: SkippedStage[] = canonicalStages
      .map((stage, index) => ({ index, label: stage.label }))
      .filter((stage) => !completedIndices.has(stage.index));
    const status = skippedStages.length === 0 ? "completed" : "interrupted";
    if (status === "interrupted" && !interruptionReason) {
      interruptionReason =
        finalState.session.activeAgentTransaction?.interruptionReason ?? "interrupted";
    }
    const latestAgentRevision = completedStages.at(-1)?.revision ?? input.expectedRevision;
    const undoEligible =
      completedStages.length > 0 && finalState.domain.revision === latestAgentRevision;
    const undo: UndoSnapshot | null = undoEligible
      ? {
          transactionId: id,
          afterRevision: finalState.domain.revision,
          before: beforeDomain,
        }
      : null;
    const receipt: TransactionReceipt = {
      id,
      source: "agent",
      status,
      expectedRevision: input.expectedRevision,
      beforeSummary,
      afterSummary: summary(finalState.resolved, finalState.domain.revision),
      completedStages,
      skippedStages,
      interruptionReason,
      undoEligible,
    };

    store.setState((state) => ({
      session: {
        ...state.session,
        activeAgentTransaction:
          state.session.activeAgentTransaction?.id === id
            ? null
            : state.session.activeAgentTransaction,
        lastTransaction: receipt,
        undo,
      },
    }));
    return { ok: true, receipt };
  }

  function undoLastAgentTransaction(input: {
    expectedRevision: number;
  }): UndoResult {
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    if (store.getState().session.activeAgentTransaction) {
      return rejected(
        "TRANSACTION_ACTIVE",
        "Undo is unavailable while an agent transaction is active.",
        input.expectedRevision,
      );
    }
    const state = store.getState();
    const undo = state.session.undo;
    if (!undo || undo.afterRevision !== state.domain.revision) {
      return rejected(
        "NOTHING_TO_UNDO",
        "There is no eligible agent transaction to undo.",
        state.domain.revision,
      );
    }
    const restored = resolve(
      catalog,
      undo.before.selections,
      undo.before.buyerContext,
    );
    const committed = commitDomain(
      restored,
      restored.buyerContext,
      "undo",
      input.expectedRevision,
    );
    if (!committed.ok) return committed;
    store.setState((current) => ({
      session: {
        ...current.session,
        undo: null,
        lastTransaction: current.session.lastTransaction
          ? { ...current.session.lastTransaction, undoEligible: false }
          : null,
      },
    }));
    return {
      ...committed,
      transactionId: undo.transactionId,
      revertedFromRevision: undo.afterRevision,
    };
  }

  function createOwnershipEstimate(input: {
    expectedRevision: number;
    assumptions: OwnershipAssumptions;
  }): OwnershipEstimateResult {
    const conflict = checkRevision(input.expectedRevision);
    if (conflict) return conflict;
    const state = store.getState();
    try {
      const result = estimateOwnership(catalog, state.resolved, input.assumptions);
      const sequence = state.session.ownershipEstimateSequence + 1;
      const snapshot: OwnershipEstimateSnapshot = {
        id: `estimate-${state.domain.revision}-${sequence}`,
        revision: state.domain.revision,
        assumptions: cloneAssumptions(input.assumptions),
        result: cloneOwnershipResult(result),
      };
      store.setState((current) => ({
        session: {
          ...current.session,
          ownershipEstimateSequence: sequence,
          ownershipAssumptions: cloneAssumptions(input.assumptions),
          ownershipEstimate: snapshot,
        },
      }));
      return { ok: true, snapshot, domainRevision: state.domain.revision };
    } catch (error) {
      return rejected(
        "INVALID_INPUT",
        error instanceof Error ? error.message : "Ownership assumptions are invalid.",
        state.domain.revision,
      );
    }
  }

  return {
    simulateConfiguration,
    applyHumanPatch,
    setBuyerContext,
    restoreSharedState,
    applyAgentTransaction,
    interruptAgentTransaction,
    undoLastAgentTransaction,
    estimateOwnership: createOwnershipEstimate,
  };
}
