import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import catalogData from "../data/catalogs/r2.catalog.json";
import type {
  BuyerContextInput,
  Catalog,
  ResolveResult,
  SelectionInput,
} from "../domain/catalog.types";
import {
  createDefaultBuyerContext,
  normalizeBuyerContext,
  resolve,
} from "../domain/resolve";
import type {
  OwnershipAssumptions,
  OwnershipResult,
} from "../domain/ownership";
import type {
  ActiveAgentTransaction,
  DomainState,
  TransactionReceipt,
  UndoSnapshot,
} from "./transactions";

export interface OwnershipEstimateSnapshot {
  id: string;
  revision: number;
  assumptions: OwnershipAssumptions;
  result: OwnershipResult;
}

export interface RestorationNotice {
  status: "valid" | "repaired" | "defaults";
  changedFields: string[];
  filledFields: string[];
  discardedFields: string[];
}

export interface ConfiguratorSessionState {
  activeAgentTransaction: ActiveAgentTransaction | null;
  lastTransaction: TransactionReceipt | null;
  undo: UndoSnapshot | null;
  transactionSequence: number;
  ownershipEstimateSequence: number;
  ownershipAssumptions: OwnershipAssumptions;
  ownershipEstimate: OwnershipEstimateSnapshot | null;
  restorationNotice: RestorationNotice | null;
}

export interface ConfiguratorStoreState {
  catalog: Catalog;
  domain: DomainState;
  resolved: ResolveResult;
  session: ConfiguratorSessionState;
}

export type ConfiguratorStore = StoreApi<ConfiguratorStoreState>;

export interface InitialConfiguratorState {
  selections?: SelectionInput;
  buyerContext?: BuyerContextInput;
  revision?: number;
  restorationNotice?: RestorationNotice | null;
}

export function createDefaultOwnershipAssumptions(catalog: Catalog): OwnershipAssumptions {
  return {
    aprPct: 6.5,
    termMonths: 60,
    downPayment: 5_000,
    salesTaxRate: 0.08,
    annualMiles: catalog.tco_model?.defaults?.miles_per_year ?? 12_000,
    homeKwhRate: catalog.tco_model?.defaults?.kwh_rate_home ?? 0.15,
    publicKwhRate: catalog.tco_model?.defaults?.kwh_rate_public ?? 0.42,
    homeChargingShare: catalog.tco_model?.defaults?.pct_home_charging ?? 0.85,
    horizonYears: catalog.tco_model?.defaults?.years ?? 5,
  };
}

export function createConfiguratorStore(
  catalog: Catalog,
  initial: InitialConfiguratorState = {},
): ConfiguratorStore {
  const buyerContext = normalizeBuyerContext(
    initial.buyerContext ?? createDefaultBuyerContext(),
  );
  const resolved = resolve(catalog, initial.selections ?? {}, buyerContext);
  if (!resolved.valid) {
    throw new Error(
      `Cannot initialize configurator with an invalid build: ${resolved.violations
        .map((violation) => violation.message)
        .join("; ")}`,
    );
  }

  const revision = initial.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RangeError("Initial revision must be a positive safe integer.");
  }

  return createStore<ConfiguratorStoreState>()(() => ({
    catalog,
    domain: {
      format: "uvc-state/1",
      revision,
      catalogId: catalog.product.id,
      selections: resolved.selections,
      buyerContext,
    },
    resolved,
    session: {
      activeAgentTransaction: null,
      lastTransaction: null,
      undo: null,
      transactionSequence: 0,
      ownershipEstimateSequence: 0,
      ownershipAssumptions: createDefaultOwnershipAssumptions(catalog),
      ownershipEstimate: null,
      restorationNotice: initial.restorationNotice ?? null,
    },
  }));
}

export const r2Catalog = catalogData as unknown as Catalog;
export const configuratorStore = createConfiguratorStore(r2Catalog);

export function useConfiguratorStore<T>(
  selector: (state: ConfiguratorStoreState) => T,
): T {
  return useStore(configuratorStore, selector);
}
