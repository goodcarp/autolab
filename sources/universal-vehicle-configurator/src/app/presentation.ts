import type { Catalog, CatalogOption, ResolveResult } from "../domain/catalog.types";
import type {
  VehicleInteriorSelection,
  VehiclePaintSelection,
  VehicleWheelSelection,
} from "../features/vehicle-canvas";

export function selectedOption(
  catalog: Catalog,
  result: ResolveResult,
  groupId: string,
): CatalogOption | null {
  const selectedIds = new Set(result.selections[groupId] ?? []);
  return catalog.options.find(
    (option) => option.group === groupId && selectedIds.has(option.id),
  ) ?? null;
}

export function vehiclePaint(option: CatalogOption | null): VehiclePaintSelection {
  return {
    id: option?.id ?? "paint.unknown",
    label: option?.label ?? "Representative green",
    color: option?.render?.hex ?? "#2f4436",
    accuracy: "representative",
  };
}

export function vehicleWheel(option: CatalogOption | null): VehicleWheelSelection {
  const diameterMatch = option?.label.match(/(19|20|21)/);
  const id = option?.id ?? "wheels.unknown";
  const style = id.includes("at")
    ? "terrain"
    : id.includes("bc") || id.includes("mg")
      ? "sport"
      : "aero";

  return {
    id,
    label: option?.label ?? "Representative wheel",
    diameterInches: Number(diameterMatch?.[1] ?? 21),
    style,
    accuracy: "representative",
  };
}

export function vehicleInterior(option: CatalogOption | null): VehicleInteriorSelection {
  const isCoastal = option?.id === "interior.coastal_cloud";
  return {
    id: option?.id ?? "interior.unknown",
    label: option?.label ?? "Representative cabin",
    color: isCoastal ? "#ded9cf" : "#292b28",
    accentColor: isCoastal ? "#9f8966" : "#a59c87",
    material: isCoastal ? "vegan-leather" : "textile",
    tone: isCoastal ? "light" : "dark",
    accuracy: "representative",
  };
}

export function shortBuildLabel(option: CatalogOption | null): string {
  return option?.label
    .replace(/^R2\s+/u, "")
    .replace(/\s+\(Launch Package\)$/u, "")
    ?? "R2";
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
