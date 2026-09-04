import type { JsonValue, ResolveResult } from "./catalog.types";
import { getPath } from "./expression";

export const DEFAULT_COMPARISON_KEYS = [
  "price.vehicleTotal",
  "specs.range_mi",
  "specs.hp",
  "specs.zero_to_sixty_s",
  "incentives.fixedSavings",
  "delivery.window",
] as const;

export interface CrossComparison {
  labels: string[];
  table: Record<string, Array<JsonValue | "—">>;
}

export function crossCompare(
  results: ResolveResult[],
  labels: string[],
  keys: readonly string[] = DEFAULT_COMPARISON_KEYS,
): CrossComparison {
  if (results.length !== labels.length) {
    throw new RangeError("Comparison labels must match the result count.");
  }

  const table: CrossComparison["table"] = {};
  for (const key of keys) {
    table[key] = results.map((result) => {
      const value = getPath(result, key);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        (typeof value === "object" && value !== null)
      ) {
        return value as JsonValue;
      }
      return "—";
    });
  }

  return { labels: [...labels], table };
}
