import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import schema from "../data/catalogs/uconf-0.2.schema.json";
import type {
  BuyerContext,
  BuyerContextInput,
  Catalog,
  CatalogEffect,
  Expression,
  Provenance,
} from "./catalog.types";
import { collectSelectedOptionReferences, collectVariableReferences } from "./expression";
import { BuyerContextValidationError, normalizeBuyerContext, resolve } from "./resolve";

export interface CatalogValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface CatalogValidationOptions {
  knownEvidenceIds?: ReadonlySet<string>;
}

export interface CatalogValidationResult {
  valid: boolean;
  issues: CatalogValidationIssue[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const ALLOWED_EXPRESSION_PATHS = new Set([
  "buyer.evExperience",
  "buyer.state",
  "buyer.utility",
  "buyer.chargingSituation",
  "buyer.useCases",
  "buyer.priorities",
  "buyer.financing",
  "buyer.crossShopIds",
  "price.baseMSRP",
  "price.vehicleOptions",
  "price.vehicleMSRP",
  "price.destination",
  "price.vehicleTotal",
  "product.id",
  "product.market",
  "product.year",
  "product.assembly.country",
]);

function schemaIssue(error: ErrorObject): CatalogValidationIssue {
  return {
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? "schema validation failed",
  };
}

function addIssue(
  issues: CatalogValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function checkUnique(
  issues: CatalogValidationIssue[],
  records: Array<{ id: string }>,
  kind: string,
  path: string,
): void {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (seen.has(record.id)) {
      addIssue(issues, "reference.duplicate_id", `${path}/${index}/id`, `Duplicate ${kind} ID '${record.id}'.`);
    }
    seen.add(record.id);
  }
}

function checkGlobalIds(
  issues: CatalogValidationIssue[],
  collections: Array<[string, Array<{ id: string }>]>,
): void {
  const owners = new Map<string, string>();
  for (const [kind, records] of collections) {
    for (const record of records) {
      const prior = owners.get(record.id);
      if (prior) {
        addIssue(
          issues,
          "reference.global_duplicate_id",
          `/${kind}`,
          `ID '${record.id}' is shared by ${prior} and ${kind}.`,
        );
      } else {
        owners.set(record.id, kind);
      }
    }
  }
}

function validDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function checkSourceIds(
  issues: CatalogValidationIssue[],
  sourceIds: string[],
  knownSources: ReadonlySet<string>,
  path: string,
): void {
  const seen = new Set<string>();
  for (const [index, sourceId] of sourceIds.entries()) {
    if (!knownSources.has(sourceId)) {
      addIssue(issues, "reference.unknown_source", `${path}/${index}`, `Unknown source '${sourceId}'.`);
    }
    if (seen.has(sourceId)) {
      addIssue(issues, "reference.duplicate_source", `${path}/${index}`, `Duplicate source '${sourceId}'.`);
    }
    seen.add(sourceId);
  }
}

function checkProvenance(
  issues: CatalogValidationIssue[],
  provenance: Provenance,
  knownSources: ReadonlySet<string>,
  path: string,
): void {
  checkSourceIds(issues, provenance.sourceIds, knownSources, `${path}/sourceIds`);
}

function checkEffects(
  issues: CatalogValidationIssue[],
  effects: CatalogEffect[] | undefined,
  path: string,
): void {
  for (const [index, effect] of (effects ?? []).entries()) {
    if ((effect.op === "add" || effect.op === "mul") && typeof effect.value !== "number") {
      addIssue(
        issues,
        "numeric.effect_value",
        `${path}/${index}/value`,
        `${effect.op} effects require a numeric value.`,
      );
    }
    if (typeof effect.value === "number" && !Number.isFinite(effect.value)) {
      addIssue(issues, "numeric.nonfinite", `${path}/${index}/value`, "Effect values must be finite.");
    }
  }
}

function checkExpression(
  issues: CatalogValidationIssue[],
  expression: Expression | undefined,
  knownOptions: ReadonlySet<string>,
  path: string,
): void {
  for (const optionId of collectSelectedOptionReferences(expression)) {
    if (!knownOptions.has(optionId)) {
      addIssue(issues, "reference.unknown_option", path, `Expression references unknown option '${optionId}'.`);
    }
  }

  for (const variablePath of collectVariableReferences(expression)) {
    if (!ALLOWED_EXPRESSION_PATHS.has(variablePath) && !/^specs\.[A-Za-z0-9_.-]+$/.test(variablePath)) {
      addIssue(
        issues,
        "buyer_context.invalid_path",
        path,
        `Expression path '${variablePath}' is not part of the deterministic context contract.`,
      );
    }
  }
}

function checkEvidenceIds(
  issues: CatalogValidationIssue[],
  evidenceIds: string[] | undefined,
  knownEvidenceIds: ReadonlySet<string> | undefined,
  path: string,
): void {
  if (!evidenceIds || !knownEvidenceIds) return;
  for (const [index, evidenceId] of evidenceIds.entries()) {
    if (!knownEvidenceIds.has(evidenceId)) {
      addIssue(
        issues,
        "reference.unknown_evidence",
        `${path}/${index}`,
        `Unknown evidence '${evidenceId}'.`,
      );
    }
  }
}

function customCatalogIssues(catalog: Catalog, options: CatalogValidationOptions): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const cameras = catalog.scene?.cameras ?? [];
  const demos = catalog.scene?.demos ?? [];
  const setupItems = catalog.ownership_setup ?? [];
  const collections: Array<[string, Array<{ id: string }>]> = [
    ["sources", catalog.sources],
    ["groups", catalog.groups],
    ["options", catalog.options],
    ["rules", catalog.rules ?? []],
    ["fees", catalog.fees ?? []],
    ["incentives", catalog.incentives ?? []],
    ["cameras", cameras],
    ["demos", demos],
    ["ownership_setup", setupItems],
  ];

  for (const [kind, records] of collections) checkUnique(issues, records, kind, `/${kind}`);
  checkGlobalIds(issues, collections);

  const knownSources = new Set(catalog.sources.map((source) => source.id));
  const knownGroups = new Set(catalog.groups.map((group) => group.id));
  const knownOptions = new Set(catalog.options.map((option) => option.id));
  const knownCameras = new Set(cameras.map((camera) => camera.id));
  const knownParts = new Set(Object.keys(catalog.scene?.parts ?? {}));
  const knownMeshSwaps = new Set(Object.keys(catalog.scene?.mesh_swaps ?? {}));

  for (const [index, source] of catalog.sources.entries()) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") throw new Error("source URL must use HTTPS");
    } catch {
      addIssue(issues, "source.invalid_url", `/sources/${index}/url`, `Invalid direct HTTPS URL '${source.url}'.`);
    }
    for (const field of ["publishedAt", "retrievedAt", "asOf"] as const) {
      if (!validDate(source[field])) {
        addIssue(issues, "source.invalid_date", `/sources/${index}/${field}`, `Invalid date '${source[field]}'.`);
      }
    }
    if (validDate(source.publishedAt) && validDate(source.retrievedAt) && source.publishedAt > source.retrievedAt) {
      addIssue(
        issues,
        "source.date_order",
        `/sources/${index}`,
        "publishedAt cannot be after retrievedAt.",
      );
    }
  }
  checkSourceIds(issues, catalog.product.sources, knownSources, "/product/sources");

  const baseGroups = catalog.groups.filter((group) => group.role === "base");
  if (baseGroups.length !== 1) {
    addIssue(issues, "group.base_count", "/groups", `Expected exactly one base group; found ${baseGroups.length}.`);
  }

  for (const [index, group] of catalog.groups.entries()) {
    if (!group.default) continue;
    const option = catalog.options.find((candidate) => candidate.id === group.default);
    if (!option) {
      addIssue(
        issues,
        "reference.unknown_default",
        `/groups/${index}/default`,
        `Default option '${group.default}' does not exist.`,
      );
    } else if (option.group !== group.id) {
      addIssue(
        issues,
        "reference.default_wrong_group",
        `/groups/${index}/default`,
        `Default option '${group.default}' belongs to '${option.group}', not '${group.id}'.`,
      );
    } else if (option.orderability === "concept_only") {
      addIssue(
        issues,
        "orderability.concept_default",
        `/groups/${index}/default`,
        `Default option '${group.default}' cannot be concept-only.`,
      );
    }
  }

  for (const [index, option] of catalog.options.entries()) {
    const path = `/options/${index}`;
    const group = catalog.groups.find((candidate) => candidate.id === option.group);
    if (!group) {
      addIssue(issues, "reference.unknown_group", `${path}/group`, `Unknown group '${option.group}'.`);
    } else if ((group.role === "base") !== (option.price.mode === "base")) {
      addIssue(
        issues,
        "price.base_role",
        `${path}/price/mode`,
        `Option '${option.id}' price mode must match group '${group.id}' base role.`,
      );
    }
    if (!Number.isFinite(option.price.amount) || option.price.amount < 0) {
      addIssue(issues, "numeric.invalid_price", `${path}/price/amount`, "Option price must be finite and nonnegative.");
    }
    checkProvenance(issues, option.provenance, knownSources, `${path}/provenance`);
    checkExpression(issues, option.availability, knownOptions, `${path}/availability`);
    checkEffects(issues, option.effects, `${path}/effects`);
    for (const [overrideIndex, override] of (option.overrides ?? []).entries()) {
      checkExpression(issues, override.when, knownOptions, `${path}/overrides/${overrideIndex}/when`);
      checkEffects(issues, override.effects, `${path}/overrides/${overrideIndex}/effects`);
    }
    if (option.render?.mesh_target && !knownParts.has(option.render.mesh_target)) {
      addIssue(
        issues,
        "reference.unknown_mesh_target",
        `${path}/render/mesh_target`,
        `Unknown scene part '${option.render.mesh_target}'.`,
      );
    }
    if (option.render?.mesh_swap && !knownMeshSwaps.has(option.render.mesh_swap)) {
      addIssue(
        issues,
        "reference.unknown_mesh_swap",
        `${path}/render/mesh_swap`,
        `Unknown mesh swap '${option.render.mesh_swap}'.`,
      );
    }
    if (option.delivery && !(catalog.product.delivery_order ?? []).includes(option.delivery.window)) {
      addIssue(
        issues,
        "reference.unknown_delivery_window",
        `${path}/delivery/window`,
        `Delivery window '${option.delivery.window}' is not in product.delivery_order.`,
      );
    }
    checkEvidenceIds(issues, option.evidenceIds, options.knownEvidenceIds, `${path}/evidenceIds`);
  }

  for (const [index, rule] of (catalog.rules ?? []).entries()) {
    checkExpression(issues, rule.when, knownOptions, `/rules/${index}/when`);
    checkExpression(issues, rule.require, knownOptions, `/rules/${index}/require`);
  }

  for (const [index, fee] of (catalog.fees ?? []).entries()) {
    if (!Number.isFinite(fee.amount) || fee.amount < 0) {
      addIssue(issues, "numeric.invalid_price", `/fees/${index}/amount`, "Fee must be finite and nonnegative.");
    }
    checkProvenance(issues, fee.provenance, knownSources, `/fees/${index}/provenance`);
  }

  for (const [index, incentive] of (catalog.incentives ?? []).entries()) {
    checkExpression(issues, incentive.eligibility, knownOptions, `/incentives/${index}/eligibility`);
    checkSourceIds(issues, incentive.sourceIds, knownSources, `/incentives/${index}/sourceIds`);
    checkEvidenceIds(issues, incentive.evidenceIds, options.knownEvidenceIds, `/incentives/${index}/evidenceIds`);
    if (incentive.amount?.fixed !== undefined && (!Number.isFinite(incentive.amount.fixed) || incentive.amount.fixed < 0)) {
      addIssue(
        issues,
        "numeric.invalid_price",
        `/incentives/${index}/amount/fixed`,
        "Fixed incentive amount must be finite and nonnegative.",
      );
    }
  }

  for (const [index, setup] of setupItems.entries()) {
    if (!Number.isFinite(setup.amount) || setup.amount < 0) {
      addIssue(
        issues,
        "numeric.invalid_price",
        `/ownership_setup/${index}/amount`,
        "Ownership setup amount must be finite and nonnegative.",
      );
    }
    checkExpression(issues, setup.when, knownOptions, `/ownership_setup/${index}/when`);
    checkSourceIds(issues, setup.sourceIds, knownSources, `/ownership_setup/${index}/sourceIds`);
  }

  if (catalog.tco_model?.mi_per_kwh_est !== undefined && !catalog.tco_model.mi_per_kwh_confidence) {
    addIssue(
      issues,
      "confidence.missing",
      "/tco_model/mi_per_kwh_confidence",
      "Catalog efficiency requires field-level confidence.",
    );
  }

  for (const [demoIndex, demo] of demos.entries()) {
    for (const [stepIndex, step] of demo.steps.entries()) {
      const path = `/scene/demos/${demoIndex}/steps/${stepIndex}`;
      if (step.camera && !knownCameras.has(step.camera)) {
        addIssue(issues, "reference.unknown_camera", `${path}/camera`, `Unknown camera '${step.camera}'.`);
      }
      if (step.orbit_to && !knownCameras.has(step.orbit_to)) {
        addIssue(issues, "reference.unknown_camera", `${path}/orbit_to`, `Unknown camera '${step.orbit_to}'.`);
      }
      if (step.highlight && !knownParts.has(step.highlight)) {
        addIssue(issues, "reference.unknown_scene_part", `${path}/highlight`, `Unknown part '${step.highlight}'.`);
      }
      if (step.set_option && !knownOptions.has(step.set_option)) {
        addIssue(issues, "reference.unknown_option", `${path}/set_option`, `Unknown option '${step.set_option}'.`);
      }
    }
  }

  if (knownGroups.has("charging") || knownOptions.has("charging.home_l2")) {
    addIssue(
      issues,
      "ownership.vehicle_price_boundary",
      "/options",
      "Home charging setup must not be modeled as a vehicle option.",
    );
  }

  if (!issues.some((issue) => issue.code.startsWith("reference.") || issue.code.startsWith("numeric."))) {
    const defaults = resolve(catalog);
    if (!defaults.valid) {
      addIssue(
        issues,
        "defaults.incompatible",
        "/groups",
        `Catalog defaults are incompatible: ${defaults.violations.map((violation) => violation.message).join(" | ")}`,
      );
    }
  }

  return issues;
}

export function validateCatalog(value: unknown, options: CatalogValidationOptions = {}): CatalogValidationResult {
  if (!validateSchema(value)) {
    return { valid: false, issues: (validateSchema.errors ?? []).map(schemaIssue) };
  }

  const issues = customCatalogIssues(value as unknown as Catalog, options);
  return { valid: issues.length === 0, issues };
}

export function assertValidCatalog(value: unknown, options: CatalogValidationOptions = {}): asserts value is Catalog {
  const result = validateCatalog(value, options);
  if (!result.valid) {
    throw new Error(
      `Invalid catalog:\n${result.issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join("\n")}`,
    );
  }
}

export function validateBuyerContext(input: BuyerContextInput):
  | { valid: true; value: BuyerContext; issues: [] }
  | { valid: false; issues: string[] } {
  try {
    return { valid: true, value: normalizeBuyerContext(input), issues: [] };
  } catch (error) {
    if (error instanceof BuyerContextValidationError) return { valid: false, issues: error.issues };
    throw error;
  }
}
