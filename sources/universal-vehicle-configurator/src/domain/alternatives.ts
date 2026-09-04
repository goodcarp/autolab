import type {
  BuyerContextInput,
  Catalog,
  CompatibleAlternative,
  OptionId,
  SelectionInput,
  SelectionPatch,
} from "./catalog.types";
import { resolve, resolveAtomicPatch } from "./resolve";

function replacementCandidates(
  catalog: Catalog,
  groupId: string,
  selected: OptionId[],
): OptionId[][] {
  const group = catalog.groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  const choices = catalog.options.filter((option) => option.group === groupId).map((option) => option.id);

  if (group.select === "one") return choices.map((optionId) => [optionId]);

  const candidates: OptionId[][] = [[]];
  for (const optionId of choices) candidates.push([optionId]);
  for (const optionId of selected) candidates.push(selected.filter((selectedId) => selectedId !== optionId));
  return candidates;
}

export function findCompatibleAlternatives(
  catalog: Catalog,
  selections: SelectionInput,
  buyer: BuyerContextInput = {},
  limit = 5,
): CompatibleAlternative[] {
  const base = resolve(catalog, selections, buyer);
  const alternatives: CompatibleAlternative[] = [];
  const seen = new Set<string>();

  for (const group of catalog.groups) {
    for (const replacement of replacementCandidates(catalog, group.id, base.selections[group.id] ?? [])) {
      if (
        replacement.length === (base.selections[group.id] ?? []).length &&
        replacement.every((optionId, index) => optionId === base.selections[group.id]?.[index])
      ) {
        continue;
      }

      const patch: SelectionPatch = { set: { [group.id]: replacement } };
      const resolution = resolveAtomicPatch(catalog, base.selections, patch, buyer);
      if (!resolution.valid) continue;

      const key = JSON.stringify(resolution.candidate.selections);
      if (seen.has(key)) continue;
      seen.add(key);

      const baseRange = base.specs.range_mi;
      const candidateRange = resolution.candidate.specs.range_mi;
      alternatives.push({
        patch: resolution.patch,
        selections: resolution.candidate.selections,
        changedGroups: [group.id],
        priceDelta: resolution.candidate.price.vehicleTotal - base.price.vehicleTotal,
        rangeDelta:
          typeof baseRange === "number" && typeof candidateRange === "number"
            ? candidateRange - baseRange
            : null,
        delivery: resolution.candidate.delivery,
      });
    }
  }

  return alternatives
    .sort((left, right) => {
      const priceDifference = Math.abs(left.priceDelta) - Math.abs(right.priceDelta);
      if (priceDifference !== 0) return priceDifference;
      return catalog.groups.findIndex((group) => group.id === left.changedGroups[0]) -
        catalog.groups.findIndex((group) => group.id === right.changedGroups[0]);
    })
    .slice(0, Math.max(0, limit));
}
