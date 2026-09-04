# uconf/0.1 — design notes

The catalog is the product. Everything else — the 3D scene, the WebMCP tools, the agent — is a lens over one JSON document. A merchant (or a fan, or a rival) who publishes a conforming catalog is instantly agent-configurable. That's the "universal" claim, made falsifiable.

## The one invariant

`resolve(catalog, selections, buyer_context)` is a pure function. No network, no state, no model calls. Price, specs, violations, incentive eligibility, and TCO all come out of it deterministically. The agent supplies context and judgment; the page supplies math and rules; the human supplies taste and veto. Every WebMCP tool is a thin wrapper over `resolve` plus scene directions.

## Tool → schema mapping

| WebMCP tool | Reads/writes |
| --- | --- |
| `load_catalog(url)` | whole document |
| `get_state` / `set_option` / `batch_configure` | `groups`, `options`, selections; returns `resolve()` diff |
| `check_compatibility` | `options[].availability`, `rules` |
| `get_price_breakdown` | `price.lines`, `fees`, confidence flags |
| `find_savings(buyer_context)` | `incentives` (predicates over price/specs/buyer/product) |
| `compute_tco(inputs)` | `tco_model` + resolved price + eligible fixed incentives |
| `compare_builds` / `cross_compare` | multiple `resolve()` results (works across catalogs — that's the headline) |
| `value_audit` | `options[].copy.value_note` + price/spec deltas |
| `focus_part` / `orbit_to` / `annotate` | `scene.parts`, `scene.cameras` |
| `demo_feature(id)` | `scene.demos[].steps` |
| `export_build` | selections + `export.vendor_url_template` + `options[].vendor_code` |

## Decisions worth remembering

**Trims are just options with `price.mode: "base"`.** One pricing path for everything; a build's total is Σ(base) + Σ(delta) + fees. The Cybertruck and Ioniq 5N catalogs need zero special cases.

**Combination data lives in `overrides`.** Vendors publish spec numbers per *combination* (the 20" AT wheel = 307 mi *on the Performance*), not per option. `overrides: [{when, effects}]` encodes exactly what was published and falls back to flagged estimates elsewhere. This is the schema feature that keeps us honest.

**Confidence flags are load-bearing, not decoration.** Every price, effect, and incentive carries `verified` or `estimated`. The agent can (and should) say "the paint premium is an estimate inside Rivian's published $1k–$2k range." A buyer's tool that bluffs precision is just a second salesman.

**Expired incentives stay in the catalog.** `status: "expired"` + dates means the agent answers "why is there no federal credit?" with a date and a citation instead of a shrug. Explained absence is a feature sellers won't build.

**`value_note` is the format's soul.** The buyer's-margin annotation — "this wheel costs 23 miles," "the range champ is the second-cheapest trim" — is the editorial layer no seller will ever publish. It's also where the copywriter owns the product.

**`export.vendor_url_template` closes the loop.** Rivian's configurator encodes builds in the URL (`?CONFIG=GEN-1_..._BLD-PRF2_EXP-ESV_...`). Harvested vendor codes mean the buyer's room can hand you back to the *seller's* checkout with your build pre-loaded. Advocate, not walled garden.

## Provenance snapshot (data_as_of 2026-08-31)

**Verified:** all five trim prices and ranges; Performance power/torque/0–60; Launch Package contents; 8-color palette with Esker Silver as sole no-cost option; non-silver paints in the $1,000–$2,000 band; Borealis/Launch Green Performance exclusivity; Forest Green (late 2026) and Borealis (2027) delivery gates; four wheel designs, 32" shared OD; 330→307 mi on Performance with 20" AT; two interiors; tow hardware $2,500 + software $950 standalone; federal 30D dead 2025-09-30 (OBBBA); federal 30C charger credit dead 2026-06-30; CO IMVC $750 for 2026 (POS assignment gone since Jan 1); CO <$35k bonus $2,500; auto-loan interest deduction through 2028 for US-assembled (R2: Normal, IL ✓).

**Estimated (flagged in-catalog):** exact per-color paint prices; wheel/interior option prices; wheel availability by trim; destination fee ($1,800, mirrors R1); mi/kWh (2.9 — R2 efficiency unpublished); Standard-trim AT range penalty (scaled); Xcel rebate terms; standalone tow availability by trim. Two of the eight paint names still unidentified.

**Calibration hook:** InsideEVs' $62,745 fully-loaded Performance figure is stored in `product.calibration` — as estimated prices firm up, the engine should reproduce it.

## Punch list (day two)

1. Source CC0/CC-BY midsize-SUV glTF; fill `scene.model` + real node names. (The mesh is the only unsourced asset in the whole build.)
2. Write `cybertruck.catalog.json` and `ioniq5n.catalog.json` — the schema-bending test. Expect Hyundai to stress `fees`/dealer-market realities and Tesla to stress software-bundle options.
3. Three.js wireframe viewer + WebMCP registration (`navigator.modelContext`), tools as wrappers over `resolve`.
4. Buyer-context intake: state, utility, financing, miles/yr — the inputs `find_savings` and `compute_tco` feed on.
5. Map remaining BAT/MOT vendor codes if possible; else ship `export` as `experimental`.

## Test results (engine.mjs, all passing)

- Performance + charger, CO buyer: $61,290 total; savings finds $1,250 fixed + flags the loan-interest deduction; explains three ineligibles with reasons.
- Wheel swap reproduces the published 330→307.
- Borealis on a Standard build correctly violates with a human-readable reason.
- Standard RWD LR shows 345 mi at $51,790 — the cross-compare table makes the "quiet champ" argument in numbers.
