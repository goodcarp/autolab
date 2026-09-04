import { readFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolvePath(projectRoot, "src/data/catalogs/uconf-0.2.schema.json");
const catalogPath = resolvePath(projectRoot, "src/data/catalogs/r2.catalog.json");

const [schema, catalog] = await Promise.all(
  [schemaPath, catalogPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const issues = [];

if (!validate(catalog)) {
  for (const error of validate.errors ?? []) {
    issues.push(`${error.instancePath || "/"} [schema.${error.keyword}] ${error.message ?? "invalid"}`);
  }
}

const duplicateCheck = (records, kind) => {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) issues.push(`/${kind} [duplicate] '${record.id}'`);
    seen.add(record.id);
  }
};

const collections = [
  ["sources", catalog.sources ?? []],
  ["groups", catalog.groups ?? []],
  ["options", catalog.options ?? []],
  ["rules", catalog.rules ?? []],
  ["fees", catalog.fees ?? []],
  ["incentives", catalog.incentives ?? []],
  ["ownership_setup", catalog.ownership_setup ?? []],
  ["cameras", catalog.scene?.cameras ?? []],
  ["demos", catalog.scene?.demos ?? []],
];
for (const [kind, records] of collections) duplicateCheck(records, kind);

const globalIds = new Map();
for (const [kind, records] of collections) {
  for (const record of records) {
    const existing = globalIds.get(record.id);
    if (existing) issues.push(`/${kind} [global duplicate] '${record.id}' also appears in ${existing}`);
    else globalIds.set(record.id, kind);
  }
}

const sourceIds = new Set((catalog.sources ?? []).map((source) => source.id));
const groupIds = new Set((catalog.groups ?? []).map((group) => group.id));
const optionIds = new Set((catalog.options ?? []).map((option) => option.id));
const cameras = new Set((catalog.scene?.cameras ?? []).map((camera) => camera.id));
const parts = new Set(Object.keys(catalog.scene?.parts ?? {}));
const meshSwaps = new Set(Object.keys(catalog.scene?.mesh_swaps ?? {}));
const allowedPaths = new Set([
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

const checkSourceRefs = (ids, path) => {
  for (const id of ids ?? []) if (!sourceIds.has(id)) issues.push(`${path} [unknown source] '${id}'`);
};

const walkExpression = (expression, path, visit) => {
  if (expression === undefined || typeof expression === "boolean") return;
  visit(expression, path);
  for (const [key, child] of [
    ["all", expression.all],
    ["any", expression.any],
  ]) {
    for (const [index, part] of (child ?? []).entries()) walkExpression(part, `${path}/${key}/${index}`, visit);
  }
  if (expression.not !== undefined) walkExpression(expression.not, `${path}/not`, visit);
};

const checkExpression = (expression, path) => {
  walkExpression(expression, path, (part, partPath) => {
    if (part.selected && !optionIds.has(part.selected)) {
      issues.push(`${partPath} [unknown option] '${part.selected}'`);
    }
    if (part.var && !allowedPaths.has(part.var) && !/^specs\.[A-Za-z0-9_.-]+$/.test(part.var)) {
      issues.push(`${partPath} [invalid context path] '${part.var}'`);
    }
  });
};

for (const [index, source] of (catalog.sources ?? []).entries()) {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    issues.push(`/sources/${index}/url [invalid direct URL] '${source.url}'`);
  }
  for (const key of ["publishedAt", "retrievedAt", "asOf"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source[key] ?? "") || Number.isNaN(Date.parse(`${source[key]}T00:00:00Z`))) {
      issues.push(`/sources/${index}/${key} [invalid date] '${source[key]}'`);
    }
  }
}
checkSourceRefs(catalog.product?.sources, "/product/sources");

const baseGroups = (catalog.groups ?? []).filter((group) => group.role === "base");
if (baseGroups.length !== 1) issues.push(`/groups [base count] expected 1, found ${baseGroups.length}`);

for (const [index, group] of (catalog.groups ?? []).entries()) {
  if (!group.default) continue;
  const option = (catalog.options ?? []).find((candidate) => candidate.id === group.default);
  if (!option) issues.push(`/groups/${index}/default [unknown option] '${group.default}'`);
  else if (option.group !== group.id) issues.push(`/groups/${index}/default [wrong group] '${group.default}'`);
  else if (option.orderability === "concept_only") issues.push(`/groups/${index}/default [concept-only default]`);
}

for (const [index, option] of (catalog.options ?? []).entries()) {
  const path = `/options/${index}`;
  const group = (catalog.groups ?? []).find((candidate) => candidate.id === option.group);
  if (!group) issues.push(`${path}/group [unknown group] '${option.group}'`);
  else if ((group.role === "base") !== (option.price?.mode === "base")) issues.push(`${path}/price/mode [base role mismatch]`);
  if (!Number.isFinite(option.price?.amount) || option.price.amount < 0) issues.push(`${path}/price/amount [invalid price]`);
  checkSourceRefs(option.provenance?.sourceIds, `${path}/provenance/sourceIds`);
  checkExpression(option.availability, `${path}/availability`);
  for (const [overrideIndex, override] of (option.overrides ?? []).entries()) {
    checkExpression(override.when, `${path}/overrides/${overrideIndex}/when`);
  }
  if (option.render?.mesh_target && !parts.has(option.render.mesh_target)) {
    issues.push(`${path}/render/mesh_target [unknown part] '${option.render.mesh_target}'`);
  }
  if (option.render?.mesh_swap && !meshSwaps.has(option.render.mesh_swap)) {
    issues.push(`${path}/render/mesh_swap [unknown mesh swap] '${option.render.mesh_swap}'`);
  }
  if (option.delivery && !(catalog.product?.delivery_order ?? []).includes(option.delivery.window)) {
    issues.push(`${path}/delivery/window [unknown window] '${option.delivery.window}'`);
  }
}

for (const [index, rule] of (catalog.rules ?? []).entries()) {
  checkExpression(rule.when, `/rules/${index}/when`);
  checkExpression(rule.require, `/rules/${index}/require`);
}
for (const [index, fee] of (catalog.fees ?? []).entries()) {
  if (!Number.isFinite(fee.amount) || fee.amount < 0) issues.push(`/fees/${index}/amount [invalid price]`);
  checkSourceRefs(fee.provenance?.sourceIds, `/fees/${index}/provenance/sourceIds`);
}
for (const [index, incentive] of (catalog.incentives ?? []).entries()) {
  checkExpression(incentive.eligibility, `/incentives/${index}/eligibility`);
  checkSourceRefs(incentive.sourceIds, `/incentives/${index}/sourceIds`);
}
for (const [index, setup] of (catalog.ownership_setup ?? []).entries()) {
  if (!Number.isFinite(setup.amount) || setup.amount < 0) issues.push(`/ownership_setup/${index}/amount [invalid price]`);
  checkExpression(setup.when, `/ownership_setup/${index}/when`);
  checkSourceRefs(setup.sourceIds, `/ownership_setup/${index}/sourceIds`);
}
for (const [demoIndex, demo] of (catalog.scene?.demos ?? []).entries()) {
  for (const [stepIndex, step] of (demo.steps ?? []).entries()) {
    const path = `/scene/demos/${demoIndex}/steps/${stepIndex}`;
    if (step.camera && !cameras.has(step.camera)) issues.push(`${path}/camera [unknown camera] '${step.camera}'`);
    if (step.orbit_to && !cameras.has(step.orbit_to)) issues.push(`${path}/orbit_to [unknown camera] '${step.orbit_to}'`);
    if (step.highlight && !parts.has(step.highlight)) issues.push(`${path}/highlight [unknown part] '${step.highlight}'`);
    if (step.set_option && !optionIds.has(step.set_option)) issues.push(`${path}/set_option [unknown option] '${step.set_option}'`);
  }
}

const get = (object, path) => path.split(".").reduce((current, key) => current?.[key], object);
const evaluate = (expression, context) => {
  if (expression === undefined || expression === true) return true;
  if (expression === false) return false;
  if (expression.all) return expression.all.every((part) => evaluate(part, context));
  if (expression.any) return expression.any.some((part) => evaluate(part, context));
  if (expression.not) return !evaluate(expression.not, context);
  if (expression.selected) return context.selected.has(expression.selected);
  const actual = get(context, expression.var);
  if (expression.op === "eq") return actual === expression.value;
  if (expression.op === "ne") return actual !== expression.value;
  if (expression.op === "lt") return actual < expression.value;
  if (expression.op === "lte") return actual <= expression.value;
  if (expression.op === "gt") return actual > expression.value;
  if (expression.op === "gte") return actual >= expression.value;
  if (expression.op === "in") return Array.isArray(expression.value) && expression.value.includes(actual);
  if (expression.op === "truthy") return actual !== "unknown" && Boolean(actual);
  return false;
};

if (!groupIds.has("charging") && !optionIds.has("charging.home_l2")) {
  const selected = new Set((catalog.groups ?? []).map((group) => group.default).filter(Boolean));
  const chosen = (catalog.options ?? []).filter((option) => selected.has(option.id));
  const price = {
    baseMSRP: chosen.filter((option) => option.price.mode === "base").reduce((sum, option) => sum + option.price.amount, 0),
    vehicleOptions: chosen.filter((option) => option.price.mode === "delta").reduce((sum, option) => sum + option.price.amount, 0),
  };
  price.vehicleMSRP = price.baseMSRP + price.vehicleOptions;
  price.destination = (catalog.fees ?? []).filter((fee) => fee.id === "destination").reduce((sum, fee) => sum + fee.amount, 0);
  price.vehicleTotal = price.vehicleMSRP + (catalog.fees ?? []).reduce((sum, fee) => sum + fee.amount, 0);
  const specs = {};
  const apply = (effects) => {
    for (const effect of effects ?? []) {
      if (effect.op === "set") specs[effect.spec] = effect.value;
      else if (effect.op === "add") specs[effect.spec] = (specs[effect.spec] ?? 0) + effect.value;
      else specs[effect.spec] = (specs[effect.spec] ?? 0) * effect.value;
    }
  };
  for (const option of chosen.filter((item) => item.price.mode === "base")) apply(option.effects);
  for (const option of chosen.filter((item) => item.price.mode !== "base")) apply(option.effects);
  const context = {
    selected,
    price,
    specs,
    buyer: {
      evExperience: "unknown",
      state: "unknown",
      utility: "unknown",
      chargingSituation: "unknown",
      useCases: [],
      priorities: [],
      financing: "unknown",
      crossShopIds: [],
    },
    product: catalog.product,
  };
  for (const option of chosen) {
    for (const override of option.overrides ?? []) if (evaluate(override.when, context)) apply(override.effects);
  }
  for (const option of chosen) {
    if (option.availability && !evaluate(option.availability, context)) {
      issues.push(`/groups [incompatible defaults] '${option.id}' unavailable`);
    }
  }
  for (const rule of catalog.rules ?? []) {
    if ((rule.severity ?? "error") === "error" && evaluate(rule.when, context) && !evaluate(rule.require, context)) {
      issues.push(`/groups [incompatible defaults] rule '${rule.id}'`);
    }
  }
} else {
  issues.push(`/options [ownership boundary] home charging setup is still a vehicle option`);
}

if (issues.length > 0) {
  console.error(`Catalog validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${catalog.product.id} (${catalog.format}): ${catalog.groups.length} groups, ${catalog.options.length} options, ${catalog.sources.length} dated sources.`,
  );
}
