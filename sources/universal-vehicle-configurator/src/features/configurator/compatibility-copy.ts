import type { Catalog, DomainViolation } from "../../domain/catalog.types";

export function trimBuildLabel(label: string): string {
  return label.replace(/^R2\s+/, "").replace(/\s+\(Launch Package\)$/, "");
}

function optionIdsIn(text: string): string[] {
  return Array.from(text.matchAll(/requires option '([^']+)'/gu), (match) => match[1]);
}

/**
 * Turns a resolver violation into buyer-facing copy.
 *
 * A negated requirement renders as "requires NOT(requires option 'x')".
 * Scraping the whole string would report the conflicting option as a required
 * pairing, which is the exact inverse of the truth.
 */
export function readableCompatibilityReason(
  violation: DomainViolation,
  catalog: Catalog,
): string {
  const label = (id: string) => {
    const option = catalog.options.find((candidate) => candidate.id === id);
    return trimBuildLabel(option?.label ?? id);
  };
  const joinLabels = (ids: string[], conjunction: string) => {
    const labels = ids.map(label);
    const last = labels.at(-1);
    return labels.length === 1
      ? String(last)
      : `${labels.slice(0, -1).join(", ")}, ${conjunction} ${last}`;
  };

  const negatedSegments = Array.from(
    violation.message.matchAll(/NOT\(([^()]*)\)/gu),
    (match) => match[1],
  );
  const conflictIds = negatedSegments.flatMap(optionIdsIn);
  const positiveText = violation.message.replace(/NOT\([^()]*\)/gu, "");
  const requiredIds = optionIdsIn(positiveText);

  if (conflictIds.length > 0) {
    return `This option cannot be combined with ${joinLabels(conflictIds, "or")}.`;
  }
  if (requiredIds.length === 0) return violation.message;
  return `This option is not available with this build. It pairs with ${joinLabels(requiredIds, "or")}.`;
}
