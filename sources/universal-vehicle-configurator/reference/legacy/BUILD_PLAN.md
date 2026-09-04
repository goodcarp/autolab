# UNIVERSAL CONFIGURATOR — Build Plan
### WebMCP Challenge · plan written Mon Aug 31, ~12pm PT · submission target Wed Sep 3, 11:00am PT

---

## 0. Ground truth (verified today)

- **Deadline conflict, resolved conservatively.** OpenAI's challenge page says submissions close **Sep 3, 1:00pm PT**; Netlify's partner post says 5:00pm PT. Plan to the earlier one. Internal target: **submitted by 11:00am PT Wednesday.**
- **Video rules (official Devpost):** under **3 minutes**, judges not required to watch past 3:00, must show the project actually functioning. Script to 2:30.
- **Eligibility:** new projects, or existing ones *meaningfully extended with WebMCP* during the submission window. Ours is new — clean.
- **Judging rubric:** usefulness · originality · execution · thoughtful use of WebMCP · quality of the human-agent experience. Every phase below maps to at least one of these; anything that maps to none gets cut.
- **Test runtimes:** ChatGPT **desktop app in-app browser** supports WebMCP out of the box (primary demo runtime). Chrome via `chrome://flags/#enable-webmcp-testing` (native API reported in Chrome 146 Canary behind the webmcp flag) or the origin trial. Judges get instructions for both.
- **Deployment decision: Netlify.** They're co-sponsoring with **3M credits and a separate $5,000 prize pool** for builders deploying on Netlify — a second prize surface for the same work. (Vercel's judge won't hold it against us; the app is static either way.)
- **Office hours were this morning (11am PT).** Check the challenge Discord for the recording tonight — 20 minutes, low priority, but it's free intel on what judges keep repeating.

## 1. The submission in one paragraph (north star)

Every brand has a configurator; the buyer has none. The Universal Configurator is the buyer's room: real vehicles (Rivian R2, Tesla Cybertruck, Hyundai Ioniq 5 N) rendered as wireframes, driven by one open catalog format, where your agent does the math no seller's site will do — batch-configures through dependency graphs, audits option value, finds every remaining dollar of savings in the post-federal-credit landscape, and cross-shops brands in one delta table. Deterministic tools for what agents are bad at; a visible, revertible action log for what humans are owed; a `value_note` editorial layer no seller would ever publish. Blueprint, not brochure.

## 2. Stack (researched, decided)

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Vite + React + TypeScript** | Fast HMR under deadline; React needed for the WebMCP hook ecosystem |
| 3D | **three + @react-three/fiber + @react-three/drei** | drei ships `<Edges>`, `<Html>` (annotations), `CameraControls` — the whole stage-direction toolkit for free |
| WebMCP | **Native `navigator.modelContext.registerTool()` + `@mcp-b/global` polyfill; `@mcp-b/react-webmcp` (`useWebMCP` hook, zod schemas)** | The polyfill is by Alex Nahas — MCP-B's creator and a **judge**; using his stack correctly is both pragmatic and legible. Note: `provideContext()`/`clearContext()` were **removed in the March 2026 spec revision** — per-tool `registerTool`/`unregisterTool` scoped to component lifetimes is the blessed pattern, and judges reportedly notice ghost-tool leaks. Feature-detect and shim: `const mc = navigator.modelContext ?? document.modelContext` (entry point has wobbled between drafts). |
| State | **zustand** | Tool handlers and React UI share one store without ceremony |
| Validation | **zod** (tool inputs) + **ajv in CI** (catalogs against schema) | Already proven on the R2 catalog |
| Engine | **`engine.mjs` as-is** | Pure ESM, zero deps, already tested — drops straight in |
| Meshes | **Kenney Car Kit (CC0)** primary; **Quaternius vehicles (CC0)** backup; Poly Pizza / Sketchfab CC0-filter fallback | CC0 kills the license risk dead; low-poly *flatters* the wireframe aesthetic — the constraint is the style |
| Deploy | **Netlify** (static) | Bonus prize pool; zero-config for Vite |
| Video | **OBS** (free) or Screen Studio (macOS, auto-zoom); edit in Descript/CapCut | Auto-zoom sells tool-call moments |

Tool ergonomics doctrine (this is the "thoughtful use of WebMCP" score): every tool returns `{ content: [{type:"text", text: <one-line human summary>}], structuredContent: <full resolve() payload or diff> }`; read-only tools carry the `readOnly: true` hint (no confirmation friction); mutating tools return a **diff + violations**, and error messages teach the agent what to do instead ("Borealis requires build.performance — call set_option first or choose paint from: …"). Descriptions written like API docs, not marketing. This is copywriting; it's also your moat.

## 3. Roles (the staffing model)

| Role | Who | Duties |
| --- | --- | --- |
| **Producer / final cut** | Lex | Go/no-go at every gate; owns the cut list; the only one allowed to add scope (and shouldn't) |
| **Architect** | This chat (Claude) | Spec, schemas, plan revisions, unblocking, catalog research |
| **Builder** | **Claude Code** | All implementation. Model policy: **Sonnet 5 as the default workhorse** (you hit weekly limits mid-campaign in August — don't burn the premium budget on boilerplate), escalate to **Opus 5 / Fable 5** only for the tool-layer architecture, the camera-choreography math, and gnarly debugging. Keep **Codex CLI warm as the backup harness** in case limits bite again. |
| **Decorrelator** | One **GPT/Codex pass**, 30 min, Tue evening | Your autogenius habit, timeboxed: cold review of (a) the two new catalogs' pricing facts, (b) tool schemas for ambiguity, (c) the Devpost description. Cheap insurance against single-model blind spots. |
| **Copy chief** | Lex | `value_note` layer for all three catalogs, video VO script, Devpost description, tool descriptions final pass. **This is the differentiation budget — protect these hours.** |
| **QA / judge simulator** | Lex + fresh ChatGPT session | Cold-start the deployed URL in the ChatGPT desktop browser following only the README. If the agent can't complete the demo path from a cold start, judges can't either. |

Human-only tasks (calendar them): Devpost registration, Netlify auth, mesh license screenshot-and-archive, video voiceover, the submit button.

## 4. Phases, steps, and gates

### Phase 0 — Rig Proof (Mon afternoon, ~3h) — *kills the existential risk first*
1. Repo scaffold: Vite + React + TS; `catalogs/`, `engine/`, `tools/`, `scene/`, `ui/`.
2. Copy in `engine.mjs`, `catalog.schema.json`, `r2.catalog.json`; wire ajv validation as an npm script + CI step.
3. Register ONE tool (`get_state`, readOnly) via `useWebMCP`; deploy to Netlify immediately.
4. Verify tool discovery + invocation in **ChatGPT desktop in-app browser** on the *deployed* URL, then in Chrome behind the flag.
5. Download Kenney Car Kit; confirm a glTF loads in R3F with `<Edges>`.

**GATE G0 (Mon ~4pm PT):** an agent on the deployed URL calls `get_state` and reads back the default R2 build. *No-go plan: fall back to `@mcp-b/global` + extension path; if neither works in 90 minutes, the project pivots to Chrome-flag-only demo and we say so in the README. Do not build past a failed G0.*

### Phase 1 — Engine in the Room (Mon evening, ~4h)
1. zustand store: `{catalog, selections, buyer, history[]}`; URL serialization of selections (shareable builds, no backend).
2. Tool layer, all wrappers over `resolve()`: `load_catalog`, `get_state`, `set_option`, `batch_configure`, `check_compatibility`, `get_price_breakdown`, `find_savings`, `compute_tco`, `compare_builds`, `value_audit`, `export_build` (+ scene tools stubbed).
3. **Action log with one-click revert** — every mutating tool call appends `{tool, args, diff, ts}`; revert = replay. This is the human-oversight surface; it's cheap and it's a rubric line ("human-agent experience").
4. Buyer-context intake drawer (state, utility, financing, miles/yr, home charging %) — the fuel for `find_savings`/`compute_tco`.

**GATE G1 (Mon ~9pm PT):** in the ChatGPT browser: "cheapest R2 that can tow, and find my savings — I'm in Colorado, financing" → agent batch-configures, receipt shows $750 IMVC + loan-interest flag + explained ineligibles. *This is the product working. Everything after is presentation.*

### Phase 2 — The Visual (Tue morning, ~5h)
1. Wireframe treatment: `<Edges threshold={15}>` over muted base material; paint options tint edge color via `render.hex`; wheel `mesh_swap`.
2. Camera presets from `scene.cameras`, lerped moves (drei `CameraControls.setLookAt`); `focus_part` highlight (emissive pulse); `annotate` via drei `<Html>` callouts.
3. `demo_feature` executor walking `scene.demos[].steps` — the agent literally drives the tour (`range_reality` and `tow_demo` already scripted in the catalog).
4. UI shell: price ticker (animates on diff), spec readout with confidence badges, violations pane, action log, catalog switcher. Blueprint art direction: dark field, single accent, mono numerals — tokens from the Claude Design system sheet.
5. **Beauty branch (parallel contract, merges only after G2 passes on the Edges baseline):** shader/post blueprint pass — barycentric solid-wireframe ShaderMaterial (fwidth AA, depth fade, fresnel rim) + @react-three/postprocessing (selective Bloom, depth/normal edge outline, vignette, light grain) + draw-in reveal on catalog swap. EdgesGeometry stays as the always-working fallback; the branch is progressive enhancement with a hard Tue-6pm merge-or-kill.

**GATE G2 (Tue 1pm PT):** the 90-second core demo runs end-to-end on deploy: voice-of-agent configures, camera swings to hitch, wheel swap shows 330→307, receipt prints. *Behind? Cut `annotate` and one demo script; the wheel moment is protected.*

### Phase 3 — Money & Rivals (Tue afternoon/evening, ~6h)
1. **Cybertruck + Ioniq 5 N catalogs.** Timebox research 45 min each against current configurator pricing (both have moved repeatedly — every figure gets `data_as_of` + confidence flags; Hyundai will stress `fees` with dealer-market reality, Tesla will stress software-bundle options like FSD-as-option — both are *features* of the universality test, name them in NOTES).
2. `cross_compare` view: the three-column delta table (price as configured, range, 0–60, savings, TCO, delivery) rendered big — this is the poster frame.
3. `find_savings` receipt styled as an actual receipt (monospace, tear line). `value_audit` panel titled **"The buyer's margin."**
4. Lex copy pass: value_notes ×3 catalogs, tool descriptions, microcopy.
5. Decorrelator pass (30 min). Fix what it catches.

**GATE G3 (Tue 9pm PT):** three catalogs load, cross_compare works across all three, judge-simulation cold run passes from the README alone. *Behind? Ship two catalogs (R2 + Cybertruck) — "universal" survives at n=2; Ioniq becomes a README roadmap line. Never cut: find_savings, action log, cross_compare, the video.*

### Phase 4 — Ship (Wed morning, ~4h; hard stop 11am PT)
1. Polish: favicon, OG image (wireframe R2 on dark), footer disclaimer ("Independent buyer-side tool; not affiliated with any manufacturer; data as of Sep 2026 with confidence flags"), README with **judge testing instructions for both runtimes** (ChatGPT desktop path AND the Chrome flag string, verbatim).
2. Record video against the script below (2 takes max), VO, cut to ≤2:45, upload unlisted YouTube.
3. Devpost form: description mapped explicitly to the five rubric lines; repo public; live URL; video; "built with" tags (WebMCP, @mcp-b, React Three Fiber, Netlify).
4. **Submit by 11:00am PT.** Then, and only then: Netlify bonus-pool entry, a launch post, and lunch.

**GATE G4 = the confirmation email.**

## 5. Demo video script (≤2:45)

- **0:00–0:20 — The thesis.** Black screen, one line typed: *"Every brand has a configurator. The buyer has none."* Cut to the wireframe R2 rotating. VO: seller configurators are persuasion environments; this is the buyer's room.
- **0:20–1:10 — The agent works.** ChatGPT browser, real prompt: *"Cheapest build that can tow, and find me every dollar — Colorado, financing, 12k miles."* Tool calls streaming; price ticker falling; camera swings to the hitch; action log filling. Receipt prints: $750 IMVC, loan-interest deduction flagged, federal credit *explained dead with a date.*
- **1:10–1:40 — The knife.** "Show me what the all-terrain wheels actually cost." Wheel swap, 330→307 on screen. VO: *"The wheel costs 23 miles. No seller's configurator will tell you that. The buyer's margin will."*
- **1:40–2:20 — Universal.** `load_catalog` — the R2 dissolves into the Cybertruck, then the Ioniq 5 N. Cross-compare table assembles. VO: one open catalog format; any merchant who publishes one is instantly agent-configurable; here's the schema, MIT-licensed.
- **2:20–2:45 — Close.** Action log + revert shown in two seconds ("every agent move on the record"). Tagline card: *"Configurators work for sellers. This one works for you."* URL + repo.

## 6. Risk register

| Risk | Odds | Mitigation |
| --- | --- | --- |
| WebMCP runtime flakiness (discovery/invocation fails in ChatGPT browser) | Med | G0 exists to catch it Monday; polyfill fallback; Chrome-flag path documented for judges either way |
| Claude Code weekly limits (hit them Aug 5) | Med | Sonnet-by-default policy; Codex CLI warm as backup harness |
| Tesla/Hyundai pricing churn makes a catalog stale by judging | Med | `data_as_of` + confidence flags everywhere; disclaimer; decorrelator pass on the numbers |
| 3D scope creep (the fun trap) | High | Beauty branch gated behind a passing G2 with Edges fallback, merge-or-kill Tue 6pm; still pre-cut: interior tour, door animations |
| Mesh license surprise | Low | Kenney/Quaternius CC0 primary; archive the license page screenshot Monday |
| Deadline ambiguity (1pm vs 5pm) | — | Treat 1pm as real; internal 11am target absorbs any upload disaster |
| Demo video overrun / judges stop watching | Med | Script hard-capped 2:45; thesis and working demo land inside the first 70 seconds |

## 7. Reference shelf

- WebMCP spec/explainer: `github.com/webmachinelearning/webmcp` (W3C Web Machine Learning CG)
- MCP-B / WebMCP-org examples (vanilla + React patterns, the shopping-cart example is closest prior art): `github.com/WebMCP-org/examples`
- `@mcp-b/global`, `@mcp-b/react-webmcp` on npm (polyfill + hook)
- Chrome testing flag: `chrome://flags/#enable-webmcp-testing` (+ origin trial for judges on stable)
- OpenAI showcase (study the collaborative-writing app's tool granularity; avoid its lanes): `developers.openai.com/showcase?view=webmcp-apps`
- Challenge Discord (office-hours recording from this morning)
- Kenney Car Kit (`kenney.nl`, CC0) · Quaternius vehicles (CC0) · Poly Pizza CC0 search
- Devpost rules page for the fine print you'll re-read once at submission: `webmcp.devpost.com/rules`

## 8. Standing check-in cadence

Gate reviews at **G0 4pm Mon · G1 9pm Mon · G2 1pm Tue · G3 9pm Tue · G4 11am Wed** — five minutes each, three questions: does the gate demo run on the *deployed* URL, what's cut if we're behind, does anything on the board fail to map to a rubric line. Between gates: commit every working increment, deploy on every commit, and no new scope without striking something of equal size.
