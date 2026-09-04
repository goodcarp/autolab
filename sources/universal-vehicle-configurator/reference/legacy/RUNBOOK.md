# RUNBOOK — every action, in order
### Deadline: Wed Sep 3, 1:00pm PT. Internal target: submitted by 11:00am PT.
### Checkpoints are just "stop and confirm this works before continuing."

## Monday afternoon — setup and proof

- [ ] Register at webmcp.devpost.com ("Join Hackathon" → Devpost account)
- [ ] Update the ChatGPT desktop app to latest (its in-app browser has WebMCP support)
- [ ] Install the Devpost Hackathons plugin in Codex
- [ ] In Chrome: enable `chrome://flags/#enable-webmcp-testing`, restart
- [ ] Create public GitHub repo (e.g. `universal-configurator`)
- [ ] Scaffold: Vite + React + TypeScript
- [ ] Install: `three @react-three/fiber @react-three/drei zustand zod @mcp-b/global @mcp-b/react-webmcp` (+ `ajv` as dev dep)
- [ ] Copy in the four existing files: `catalog.schema.json`, `r2.catalog.json`, `engine.mjs`, `NOTES.md`
- [ ] Add `npm run validate` (ajv: catalog vs schema); run it, confirm green
- [ ] Register one WebMCP tool — `get_state`, readOnly — via `useWebMCP`; include the shim `const mc = navigator.modelContext ?? document.modelContext`
- [ ] Connect repo to Netlify; deploy; confirm the live URL loads
- [ ] Open the LIVE URL in the ChatGPT desktop in-app browser → ask it to read the current build → confirm the tool gets called and answers
- [ ] Repeat once in flagged Chrome
- [ ] **CHECKPOINT 1 (~4pm): an agent calls your tool on the deployed site.** If it fails: try the `@mcp-b/global` polyfill path; if still failing after 90 min, stop building and reassess — nothing else matters until this works
- [ ] Download Kenney Car Kit (CC0); screenshot the license page → commit to `licenses/`
- [ ] Load one Kenney glTF in the app; confirm it renders
- [ ] Fill out Netlify's challenge credits / prize-pool form

## Monday evening — make it real

- [ ] Build the zustand store: `{catalog, selections, buyer, history}`
- [ ] Serialize selections into the URL (shareable builds, no backend)
- [ ] Implement the tools, each wrapping `resolve()`: `set_option`, `batch_configure`, `check_compatibility`, `get_price_breakdown`, `find_savings`, `compute_tco`, `compute_financing` (apr/term/down → payment + interest schedule, feeds the loan-interest deduction), `compare_builds`, `value_audit`, `export_build` (scene tools stubbed for now)
- [ ] Every mutating tool returns a diff + violations; every read-only tool has `readOnly: true`
- [ ] Action log panel: one row per tool call `{tool, args, diff, time}` + one-click revert
- [ ] Buyer-context drawer: state, utility, financing y/n, miles/yr, % home charging
- [ ] Deploy
- [ ] **CHECKPOINT 2 (~9pm): in the ChatGPT browser, prompt "cheapest R2 that can tow, find my savings — Colorado, financing" → agent configures it and the receipt shows $750 IMVC + the loan-interest flag + explained ineligibles**
- [ ] Send Claude Code its contract: the 3D scene module (wireframe R2, camera presets, part highlight, demo scripts — built against a stub store, delivered as a PR)
- [ ] Send the Cybertruck catalog contract to whichever meter is fullest (inputs: schema + R2 catalog as exemplar + "every price sourced or flagged estimated")
- [ ] Send the R2 knowledge-pack contract: `knowledge.json` — entries `{id, topic, tags, summary, source, date, confidence, supersedes}` covering review consensus (paraphrased + scores, no quotes), safety/awards, software-update history (supersedes chains), charging/ownership notes, depreciation, praise/complaint themes; every entry sourced and dated or it doesn't merge. Cybertruck/Ioniq packs ride along with their catalog contracts.
- [ ] Claude Design session #1 (claude.ai/design): three blueprint direction boards → pick one → have it emit the design-token CSS-variable sheet → commit tokens to the repo
- [ ] Optional 20 min: watch the office-hours recording in the challenge Discord

## Tuesday morning — the visual

- [ ] Review + merge the scene-module PR
- [ ] Wire the scene tools: `focus_part`, `orbit_to`, `annotate`, `demo_feature` (the `range_reality` and `tow_demo` scripts already live in the catalog)
- [ ] Wire paint color (`render.hex`) and wheel swap (`render.mesh_swap`) from the catalog
- [ ] Integrate the Claude Design UI-shell handoff bundle: price ticker, receipt, cross-compare table, action-log skin
- [ ] Antigravity/Gemini contract: check every tool schema against the WebMCP-org examples patterns; apply its fixes
- [ ] Deploy
- [ ] **CHECKPOINT 3 (~1pm): the 90-second core demo runs end-to-end on the live URL — configure by conversation, camera swings to hitch, wheel swap shows 330→307, receipt prints**
- [ ] Kick off the beauty-branch contract in parallel (shader/post blueprint pass: barycentric solid-wireframe ShaderMaterial, Bloom, depth/normal edge outline, draw-in reveal — Edges stays as fallback)
- [ ] Send the Ioniq 5 N catalog contract

## Tuesday afternoon and evening — money and rivals

- [ ] Fact-audit both incoming catalogs against their sources (Gemini pass); fix; merge
- [ ] Merge knowledge packs; implement `list_knowledge_topics()` + `query_knowledge(topic/tags)` (the agent is the retriever — the page is just a sourced, dated index)
- [ ] localStorage "garage": save/load named builds alongside URL sharing
- [ ] Add one knowledge beat to the demo video script ("what changed in recent software updates?" → dated, sourced answer via supersedes chain) — keep total ≤2:45 by trimming elsewhere
- [ ] Catalog switcher UI + `load_catalog` tool + second/third mesh wired
- [ ] Build the cross-compare view: three-column delta table (price, range, 0–60, savings, TCO, delivery)
- [ ] Style the savings receipt (monospace, tear line) and the "buyer's margin" value-audit panel
- [ ] Your copy pass: value_notes for all three catalogs, tool descriptions, UI microcopy
- [ ] Decorrelation pass — fresh **Claude or Gemini seat, not GPT** — 30 min on catalog facts, schema ambiguity, draft Devpost text; apply what it catches
- [ ] 6pm: beauty branch merge-or-kill — merge only if the core demo still passes on top of it
- [ ] Write the README: what it is, how to run it, and **verbatim judge instructions for both runtimes** (ChatGPT desktop path AND the Chrome flag string)
- [ ] Deploy
- [ ] **CHECKPOINT 4 (~9pm): three catalogs load, cross-compare works across them, and a cold-start run in a fresh ChatGPT session — following only the README — completes the demo path**

## Wednesday morning — ship (hard stop 1:00pm PT)

- [ ] 8am: kill anything still outstanding — no contract survives the morning
- [ ] Grok recon: current X chatter on ChatGPT-browser WebMCP quirks; apply only what's cheap
- [ ] Polish: favicon, OG image (wireframe on dark), meta tags, footer disclaimer ("Independent buyer-side tool. Not affiliated with any manufacturer. Data as of Sep 2026; estimates flagged.")
- [ ] Final deploy; one full cold run-through yourself
- [ ] Record the demo video against the script — two takes max — VO, cut to ≤2:45
- [ ] Upload unlisted to YouTube; test the link in an incognito window
- [ ] Devpost submission (via the Codex plugin or the site): title, tagline, description written to the five judging criteria (usefulness, originality, execution, thoughtful WebMCP use, human-agent experience), public repo link, live URL, video link, built-with tags
- [ ] **Submit by 11:00am PT. Confirm the confirmation email exists.**
- [ ] Netlify bonus-pool entry if it's a separate step
- [ ] Optional: launch post
- [ ] Lunch

## Thursday — one hour, no more

- [ ] Fold the routing log into the Constellation Card (topology, lanes, rework rate per lane, meter burn, keep/modify/retire verdicts)
