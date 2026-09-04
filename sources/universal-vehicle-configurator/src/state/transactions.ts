import type {
  BuyerContext,
  CanonicalSelections,
  DomainViolation,
  SelectionPatch,
} from "../domain/catalog.types";

export type MutationSource = "human" | "agent" | "undo" | "restore";

export interface DomainState {
  format: "uvc-state/1";
  revision: number;
  catalogId: string;
  selections: CanonicalSelections;
  buyerContext: BuyerContext;
}

export interface ConfigurationStage {
  label: string;
  patch: SelectionPatch;
}

export interface BuildSummary {
  revision: number;
  selections: CanonicalSelections;
  vehicleTotal: number;
  rangeMiles: number | null;
  deliveryWindow: string | null;
}

export interface CompletedStage {
  index: number;
  label: string;
  patch: SelectionPatch;
  revision: number;
}

export interface SkippedStage {
  index: number;
  label: string;
}

export type TransactionStatus = "completed" | "interrupted";

export interface TransactionReceipt {
  id: string;
  source: "agent";
  status: TransactionStatus;
  expectedRevision: number;
  beforeSummary: BuildSummary;
  afterSummary: BuildSummary;
  completedStages: CompletedStage[];
  skippedStages: SkippedStage[];
  interruptionReason: string | null;
  undoEligible: boolean;
}

export interface ActiveAgentTransaction {
  id: string;
  expectedRevision: number;
  stageCount: number;
  completedCount: number;
  interrupted: boolean;
  interruptionReason: string | null;
}

export interface UndoSnapshot {
  transactionId: string;
  afterRevision: number;
  before: DomainState;
}

export type MutationErrorCode =
  | "INVALID_INPUT"
  | "REVISION_CONFLICT"
  | "INVALID_CONFIGURATION"
  | "TRANSACTION_ACTIVE"
  | "NOTHING_TO_UNDO";

export interface MutationError {
  code: MutationErrorCode;
  message: string;
  currentRevision: number;
  violations?: DomainViolation[];
}

export interface MutationRejected {
  ok: false;
  error: MutationError;
}

export function cloneSelections(selections: CanonicalSelections): CanonicalSelections {
  return Object.fromEntries(
    Object.entries(selections).map(([groupId, optionIds]) => [groupId, [...optionIds]]),
  );
}

export function cloneDomainState(domain: DomainState): DomainState {
  return {
    ...domain,
    selections: cloneSelections(domain.selections),
    buyerContext: {
      ...domain.buyerContext,
      useCases: [...domain.buyerContext.useCases],
      priorities: [...domain.buyerContext.priorities],
      crossShopIds: [...domain.buyerContext.crossShopIds],
    },
  };
}

export function selectionsEqual(
  left: CanonicalSelections,
  right: CanonicalSelections,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const leftValues = left[key] ?? [];
    const rightValues = right[key] ?? [];
    if (
      leftValues.length !== rightValues.length ||
      leftValues.some((value, index) => value !== rightValues[index])
    ) {
      return false;
    }
  }
  return true;
}

export function buyerContextEqual(left: BuyerContext, right: BuyerContext): boolean {
  return (
    left.evExperience === right.evExperience &&
    left.state === right.state &&
    left.utility === right.utility &&
    left.chargingSituation === right.chargingSituation &&
    left.financing === right.financing &&
    left.useCases.length === right.useCases.length &&
    left.useCases.every((value, index) => value === right.useCases[index]) &&
    left.priorities.length === right.priorities.length &&
    left.priorities.every((value, index) => value === right.priorities[index]) &&
    left.crossShopIds.length === right.crossShopIds.length &&
    left.crossShopIds.every((value, index) => value === right.crossShopIds[index])
  );
}
