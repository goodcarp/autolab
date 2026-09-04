import type { CatalogOption, GroupId } from "../domain/catalog.types";
import type { ConfiguratorStoreState } from "./configurator.store";
import type { BuildSummary } from "./transactions";
import { cloneSelections } from "./transactions";

export const selectRevision = (state: ConfiguratorStoreState): number =>
  state.domain.revision;

export const selectDomain = (state: ConfiguratorStoreState) => state.domain;
export const selectResolved = (state: ConfiguratorStoreState) => state.resolved;
export const selectBuyerContext = (state: ConfiguratorStoreState) =>
  state.domain.buyerContext;
export const selectSelections = (state: ConfiguratorStoreState) =>
  state.domain.selections;
export const selectActiveAgentTransaction = (state: ConfiguratorStoreState) =>
  state.session.activeAgentTransaction;
export const selectLastTransaction = (state: ConfiguratorStoreState) =>
  state.session.lastTransaction;
export const selectCanUndo = (state: ConfiguratorStoreState): boolean =>
  state.session.undo !== null &&
  state.session.undo.afterRevision === state.domain.revision;
export const selectOwnershipAssumptions = (state: ConfiguratorStoreState) =>
  state.session.ownershipAssumptions;
export const selectOwnershipEstimate = (state: ConfiguratorStoreState) =>
  state.session.ownershipEstimate;

export function selectBuildSummary(state: ConfiguratorStoreState): BuildSummary {
  const range = state.resolved.specs.range_mi;
  return {
    revision: state.domain.revision,
    selections: cloneSelections(state.domain.selections),
    vehicleTotal: state.resolved.price.vehicleTotal,
    rangeMiles: typeof range === "number" ? range : null,
    deliveryWindow: state.resolved.delivery?.window ?? null,
  };
}

export function selectedOptionForGroup(
  state: ConfiguratorStoreState,
  groupId: GroupId,
): CatalogOption[] {
  const selected = new Set(state.domain.selections[groupId] ?? []);
  return state.catalog.options.filter(
    (option) => option.group === groupId && selected.has(option.id),
  );
}
