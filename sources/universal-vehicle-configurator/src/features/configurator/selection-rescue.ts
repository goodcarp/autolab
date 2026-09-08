import type { Catalog, CompatibleAlternative, Expression, ResolveResult } from "../../domain/catalog.types";
import { resolve } from "../../domain/resolve";

function dependencies(expression: Expression | undefined): string[] {
  if (!expression || typeof expression === "boolean") return [];
  if ("selected" in expression) return [expression.selected];
  if ("not" in expression) return dependencies(expression.not);
  if ("all" in expression) return expression.all.flatMap(dependencies);
  if ("any" in expression) return expression.any.flatMap(dependencies);
  return [];
}

/** Repair the conflicting families while retaining the person's exact pick. */
export function rescueSelection(catalog: Catalog, attempted: ResolveResult, intendedGroup: string): CompatibleAlternative | undefined {
  const affected = new Set<string>();
  for (const violation of attempted.violations.filter((item) => item.severity === "error")) {
    if (violation.group && violation.group !== intendedGroup) affected.add(violation.group);
    const option = catalog.options.find((item) => item.id === violation.option);
    for (const dependency of dependencies(option?.availability)) {
      const group = catalog.options.find((item) => item.id === dependency)?.group;
      if (group && group !== intendedGroup) affected.add(group);
    }
  }
  const groups = catalog.groups.filter((group) => affected.has(group.id));
  const alternatives: CompatibleAlternative[] = [];
  const selections = { ...attempted.selections };
  const visit = (index: number) => {
    const group = groups[index];
    if (group) {
      const options = catalog.options.filter((option) => option.group === group.id);
      const choices = [attempted.selections[group.id] ?? [], ...options.map((option) => [option.id])];
      if (group.select === "many") choices.push([]);
      for (const choice of new Map(choices.map((ids) => [ids.join("|"), ids])).values()) {
        selections[group.id] = choice;
        visit(index + 1);
      }
      return;
    }
    const candidate = resolve(catalog, selections, attempted.buyerContext);
    if (!candidate.valid) return;
    const changedGroups = groups.filter((item) =>
      attempted.selections[item.id]?.join("|") !== candidate.selections[item.id]?.join("|"),
    ).map((item) => item.id);
    const beforeRange = attempted.specs.range_mi;
    const afterRange = candidate.specs.range_mi;
    alternatives.push({
      selections: candidate.selections,
      patch: { set: Object.fromEntries(changedGroups.map((id) => [id, candidate.selections[id]])) },
      changedGroups,
      priceDelta: candidate.price.vehicleTotal - attempted.price.vehicleTotal,
      rangeDelta: typeof beforeRange === "number" && typeof afterRange === "number" ? afterRange - beforeRange : null,
      delivery: candidate.delivery,
    });
  };
  visit(0);
  const removedCapabilities = (alternative: CompatibleAlternative) => catalog.groups.filter((group) =>
    group.select === "many" && attempted.selections[group.id]?.length && !alternative.selections[group.id]?.length,
  ).length;
  return alternatives.sort((left, right) =>
    removedCapabilities(left) - removedCapabilities(right) ||
    left.changedGroups.length - right.changedGroups.length ||
    Math.abs(left.priceDelta) - Math.abs(right.priceDelta),
  )[0];
}
