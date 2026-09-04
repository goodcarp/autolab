// uconf/0.1 reference engine
// resolve(catalog, selections, buyer) -> { valid, violations, price, specs, delivery, incentives, tco }
// Pure, deterministic, no I/O. This is the function every WebMCP tool wraps.

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function evalExpr(expr, ctx) {
  if (expr === true || expr === undefined) return true;
  if (expr === false) return false;
  if ("all" in expr) return expr.all.every((e) => evalExpr(e, ctx));
  if ("any" in expr) return expr.any.some((e) => evalExpr(e, ctx));
  if ("not" in expr) return !evalExpr(expr.not, ctx);
  if ("selected" in expr) return ctx.selected.has(expr.selected);
  if ("var" in expr) {
    const v = get(ctx, expr.var);
    switch (expr.op) {
      case "eq": return v === expr.value;
      case "ne": return v !== expr.value;
      case "lt": return v < expr.value;
      case "lte": return v <= expr.value;
      case "gt": return v > expr.value;
      case "gte": return v >= expr.value;
      case "in": return Array.isArray(expr.value) && expr.value.includes(v);
      case "truthy": return !!v;
      default: throw new Error(`unknown op ${expr.op}`);
    }
  }
  throw new Error(`unevaluable expr: ${JSON.stringify(expr)}`);
}

function explainExpr(expr, ctx) {
  // Human-readable reason for a failed predicate (first failing leaf).
  if (expr === true || expr === undefined) return null;
  if (expr === false) return "categorically unavailable";
  if ("all" in expr) { for (const e of expr.all) { if (!evalExpr(e, ctx)) return explainExpr(e, ctx); } return null; }
  if ("any" in expr) return "none of the qualifying conditions hold: " + expr.any.map((e) => explainExpr(e, { ...ctx, __force: true }) ?? "condition").join(" / ");
  if ("not" in expr) return `requires NOT(${explainExpr(expr.not, { ...ctx, __force: true }) ?? "condition"})`;
  if ("selected" in expr) return `requires option '${expr.selected}'`;
  if ("var" in expr) return `requires ${expr.var} ${expr.op} ${JSON.stringify(expr.value)} (actual: ${JSON.stringify(get(ctx, expr.var))})`;
  return "condition not met";
}

export function resolve(catalog, selections = {}, buyer = {}) {
  const optById = new Map(catalog.options.map((o) => [o.id, o]));
  const groups = catalog.groups;
  const violations = [];

  // 1. Normalize selections; fill defaults for required single-select groups.
  const chosen = new Set();
  for (const g of groups) {
    const raw = selections[g.id];
    let ids = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    if (ids.length === 0 && g.default) ids = [g.default];
    if (g.select === "one" && ids.length > 1)
      violations.push({ rule: "group.cardinality", message: `Group '${g.id}' takes one selection; got ${ids.length}.`, severity: "error" });
    if (g.required && ids.length === 0)
      violations.push({ rule: "group.required", message: `Group '${g.id}' requires a selection.`, severity: "error" });
    for (const id of ids) {
      const opt = optById.get(id);
      if (!opt) { violations.push({ rule: "option.unknown", message: `No such option '${id}'.`, severity: "error" }); continue; }
      if (opt.group !== g.id) { violations.push({ rule: "option.wrong_group", message: `Option '${id}' does not belong to group '${g.id}'.`, severity: "error" }); continue; }
      chosen.add(id);
    }
  }
  const selectedOpts = catalog.options.filter((o) => chosen.has(o.id)); // catalog order = deterministic

  // 2. Price.
  const lines = [];
  let base = 0, deltas = 0;
  for (const o of selectedOpts) {
    if (o.price.mode === "base") base += o.price.amount;
    else deltas += o.price.amount;
    if (o.price.amount !== 0 || o.price.mode === "base")
      lines.push({ id: o.id, label: o.label, amount: o.price.amount, confidence: o.price.confidence ?? "verified" });
  }
  const msrp_as_configured = base + deltas;
  const fees = (catalog.fees ?? []).map((f) => ({ ...f }));
  const feeTotal = fees.reduce((s, f) => s + f.amount, 0);
  const price = { base_msrp: base, options_total: deltas, msrp_as_configured, fees, total: msrp_as_configured + feeTotal, lines };

  // 3. Specs: base-mode options first, then the rest in catalog order, then conditional overrides.
  const specs = {};
  const specConfidence = {};
  const apply = (eff) => {
    for (const e of eff) {
      const cur = specs[e.spec];
      specs[e.spec] = e.op === "set" ? e.value : e.op === "add" ? (cur ?? 0) + e.value : (cur ?? 0) * e.value;
      specConfidence[e.spec] = e.confidence ?? "verified";
    }
  };
  for (const o of selectedOpts) if (o.price.mode === "base" && o.effects) apply(o.effects);
  for (const o of selectedOpts) if (o.price.mode !== "base" && o.effects) apply(o.effects);
  const ctx = { selected: chosen, price, specs, buyer, product: catalog.product };
  for (const o of selectedOpts) for (const ov of o.overrides ?? []) if (evalExpr(ov.when, ctx)) apply(ov.effects);
  if (specs.range_mi != null) specs.range_mi = Math.round(specs.range_mi);

  // 4. Availability + rules.
  for (const o of selectedOpts) {
    if (o.availability && !evalExpr(o.availability, ctx))
      violations.push({ rule: "option.unavailable", option: o.id, message: `'${o.label}' is not available with this build: ${explainExpr(o.availability, ctx)}.`, severity: "error" });
  }
  for (const r of catalog.rules ?? []) {
    if (evalExpr(r.when, ctx) && !evalExpr(r.require, ctx))
      violations.push({ rule: r.id, message: r.message, severity: r.severity ?? "error" });
  }

  // 5. Delivery: the latest window among selected options wins.
  const order = catalog.product.delivery_order ?? [];
  let delivery = null;
  for (const o of selectedOpts) {
    const w = o.delivery?.window;
    if (!w) continue;
    if (!delivery || order.indexOf(w) > order.indexOf(delivery.window)) delivery = { window: w, gated_by: o.id };
  }

  // 6. Incentives: eligible with amounts, ineligible with reasons. Expired programs explain themselves.
  const eligible = [], ineligible = [];
  for (const inc of catalog.incentives ?? []) {
    if (inc.status === "expired") {
      ineligible.push({ id: inc.id, label: inc.label, reason: `expired ${inc.effective?.to ?? ""}`.trim(), notes: inc.notes });
      continue;
    }
    if (inc.status === "scheduled") {
      ineligible.push({ id: inc.id, label: inc.label, reason: `not yet in effect (from ${inc.effective?.from ?? "TBD"})` });
      continue;
    }
    if (evalExpr(inc.eligibility, ctx)) {
      eligible.push({ id: inc.id, label: inc.label, type: inc.type, amount: inc.amount?.fixed ?? null, estimate_note: inc.amount?.estimate_note ?? null, claim: inc.claim, confidence: inc.confidence, source: inc.source });
    } else {
      ineligible.push({ id: inc.id, label: inc.label, reason: explainExpr(inc.eligibility, ctx) ?? "conditions not met" });
    }
  }
  const savings_fixed = eligible.reduce((s, i) => s + (i.amount ?? 0), 0);

  // 7. TCO.
  const m = catalog.tco_model ?? {};
  const d = { ...(m.defaults ?? {}), ...(buyer.tco ?? {}) };
  let tco = null;
  if (m.mi_per_kwh_est && d.miles_per_year && d.years) {
    const kwhPerYear = d.miles_per_year / m.mi_per_kwh_est;
    const blendedRate = (d.pct_home_charging ?? 1) * (d.kwh_rate_home ?? 0) + (1 - (d.pct_home_charging ?? 1)) * (d.kwh_rate_public ?? 0);
    const energyPerYear = kwhPerYear * blendedRate;
    tco = {
      assumptions: { ...d, mi_per_kwh: m.mi_per_kwh_est, mi_per_kwh_confidence: m.mi_per_kwh_confidence ?? "estimated" },
      energy_per_year: Math.round(energyPerYear),
      maintenance_per_year: m.maintenance_per_year_est ?? 0,
      fixed_incentives_applied: savings_fixed,
      total: Math.round(price.total - savings_fixed + d.years * (energyPerYear + (m.maintenance_per_year_est ?? 0))),
      note: "Purchase + energy + maintenance − fixed-amount incentives, over the stated horizon. Deductions and estimate-only programs are surfaced separately, not netted in.",
    };
  }

  return {
    valid: !violations.some((v) => v.severity !== "warning"),
    violations, price, specs, spec_confidence: specConfidence, delivery,
    incentives: { eligible, ineligible, savings_fixed },
    tco,
    selections: [...chosen],
  };
}

export function crossCompare(results, labels) {
  const keys = ["price.total", "specs.range_mi", "specs.hp", "specs.zero_to_sixty_s", "incentives.savings_fixed", "tco.total", "delivery.window"];
  const table = {};
  for (const k of keys) table[k] = results.map((r) => get(r, k) ?? "—");
  return { labels, table };
}

// ---------------- test harness ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const catalog = JSON.parse(fs.readFileSync(new URL("./r2.catalog.json", import.meta.url)));
  const buyerCO = { state: "CO", utility: "xcel", financing: true };
  const money = (n) => "$" + n.toLocaleString("en-US");
  const show = (name, r) => {
    console.log(`\n=== ${name} ===`);
    console.log(`valid: ${r.valid}${r.violations.length ? "  violations: " + r.violations.map(v => `[${v.severity}] ${v.message}`).join(" | ") : ""}`);
    console.log(`price: ${money(r.price.total)} (msrp as configured ${money(r.price.msrp_as_configured)})`);
    console.log(`specs: ${Object.entries(r.specs).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    if (r.delivery) console.log(`delivery: ${r.delivery.window} (gated by ${r.delivery.gated_by})`);
    console.log(`savings (fixed): ${money(r.incentives.savings_fixed)}`);
    for (const e of r.incentives.eligible) console.log(`  + ${e.label}: ${e.amount != null ? money(e.amount) : "(estimate) " + e.estimate_note}`);
    for (const i of r.incentives.ineligible) console.log(`  - ${i.label}: ${i.reason}`);
    if (r.tco) console.log(`5-yr TCO: ${money(r.tco.total)} (energy ${money(r.tco.energy_per_year)}/yr)`);
  };

  // 1. Default Performance build, Colorado buyer with home charger.
  const perf = resolve(catalog, { towing: ["towing.launch_included"], charging: ["charging.home_l2"] }, buyerCO);
  show("Performance (Launch Pkg) + home charger — CO buyer", perf);

  // 2. The 23-mile wheel: same build, all-terrain wheels.
  const perfAT = resolve(catalog, { wheels: "wheels.bs20_at", towing: ["towing.launch_included"] }, buyerCO);
  show("Performance + 20\" all-terrain (the range trade)", perfAT);

  // 3. Violation: Borealis paint on a Standard build.
  const bad = resolve(catalog, { build: "build.standard_rwd_lr", paint: "paint.borealis", wheels: "wheels.mg19_as" }, buyerCO);
  show("Standard RWD LR + Borealis (should violate)", bad);

  // 4. The value pick: Standard RWD Long Range, cross-compared with Performance.
  const champ = resolve(catalog, { build: "build.standard_rwd_lr", wheels: "wheels.mg19_as", charging: ["charging.home_l2"] }, buyerCO);
  show("Standard RWD Long Range (the quiet champ)", champ);

  const cmp = crossCompare([perf, champ], ["Performance", "Std RWD LR"]);
  console.log("\n=== cross_compare ===");
  for (const [k, vals] of Object.entries(cmp.table)) console.log(`${k.padEnd(28)} ${vals.map(String).map(s => s.padStart(12)).join("  ")}`);

  // 5. Assertions.
  const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL: " + msg); process.exitCode = 1; } };
  assert(perf.price.total === 57990 + 1500 + 1800, "perf total = base + charger + destination");
  assert(perf.specs.range_mi === 330 && perfAT.specs.range_mi === 307, "wheel override applies published 307 on Performance");
  assert(!bad.valid && bad.violations.some(v => v.rule === "option.unavailable"), "Borealis unavailable off-Performance");
  assert(perf.incentives.eligible.some(e => e.id === "co_imvc"), "CO IMVC eligible");
  assert(perf.incentives.ineligible.some(i => i.id === "federal_30d_new_ev" && i.reason.includes("expired")), "federal credit explains its own absence");
  assert(champ.specs.range_mi === 345, "range champ is the mid Standard");
  console.log(process.exitCode ? "\nTESTS FAILED" : "\nAll assertions passed.");
}
