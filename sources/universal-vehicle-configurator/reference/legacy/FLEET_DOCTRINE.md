# FLEET DOCTRINE — Universal Configurator sprint
### Coordinating Codex, Claude Code, Antigravity, Grok, and human labor across 2.5 days
### Companion to BUILD_PLAN.md · written Mon Aug 31

---

## 1. Why a doctrine at all

Your own research already settled the core question: an undifferentiated swarm loses to a monolith; *configuration* is what wins. So this document is not "use more agents." It is one specific configuration — topology, routing rules, sync cadence, and meters — chosen for a 2.5-day solo sprint with a hard deadline. Supply chain, not parliament: components deliver **to** a prime, they do not deliberate with each other.

The sprint is also the experiment. Every routing decision gets logged (§9), and the post-mortem writes itself into a Constellation Card with a shipped product as its benchmark.

## 2. Topology: Codex is prime

**Prime contractor: Codex** (CLI/IDE seat). Owns the repo, owns merges, holds the only continuous mental model of the codebase, and runs the Devpost Hackathons plugin — the challenge's participation workflow (rules, submission machinery) lives inside Codex, so the last mile was Codex-bound regardless; making it prime removes a harness switch at the most dangerous hour.

**Single-writer rule (non-negotiable):** exactly one seat edits the tree at a time. Everything else delivers as PRs, patches, or files into `contracts/inbox/`. No second harness ever works directly on `main`. This is the single-actuator rule applied to a codebase, and it is the difference between a fleet and a pile-up.

**Scope note, recorded honestly:** the plugin binds *participation* to Codex, not the build itself. If the plugin turns out to be submission-only in practice, the prime choice reopens — your call at G1, not later. After G1 the context investment makes a prime swap a loss.

**Backup prime: Claude Code.** If Codex quota, outage, or quality fails on the critical path, execute the recorded molt procedure: commit everything, write `HANDOFF.md` (state, next three tasks, open bugs), cold-start Claude Code against it. This is the emergency failover you've already rehearsed once — an emergency procedure, not a routine.

## 3. The contractable-work gate

The only routing question that matters: **can this task be specified in one message?**

Contractable = all four hold:
1. Inputs are file paths or URLs, not conversation history.
2. Definition of done is runnable (a test, a validation command, a checklist a stranger could verify).
3. Forbidden zones are listed (files not to touch, decisions not to make).
4. The deliverable has a format and a destination.

If yes → it leaves the prime and runs in parallel. If no → it stays with Codex, because a harness switch costs a context rebuild (~20–30 min equivalent loss) and un-contractable work pays that tax twice — once going out, once coming back wrong.

**Contract template** (paste-ready):

```
CONTRACT <id> — <title>
OBJECTIVE: <one sentence>
INPUTS: <paths/URLs>
DEFINITION OF DONE: <runnable check — e.g. "npm run validate passes; all prices carry confidence flags; sources cited per line">
FORBIDDEN: <e.g. "do not modify engine.mjs or the schema; do not invent unverified prices — flag as estimated">
DELIVERABLE: <format> → contracts/inbox/<id>/
DEADLINE: <gate it must precede>
```

## 4. Route table (Codex-prime layout)

| Lane | Seat | Work | Sync point |
| --- | --- | --- | --- |
| Critical path — sequential, conversational | **Codex** (prime) | Scaffold, WebMCP tool layer, integration, debugging, deploy, Devpost plugin submission | Continuous |
| Heavy subsystem contracts | **Claude Code** | The 3D scene module (R3F wireframe, cameras, choreography) as a self-contained package against a stub store; engine-integration review; it wrote the engine and schema, so it carries the most context on them | PR before G2 |
| Async data contracts | **Codex cloud tasks** *or* Claude Code, whichever meter is fuller | Cybertruck + Ioniq catalog drafts (schema + R2 exemplar + source-and-flag requirements as inputs); README + judge instructions; test scaffolds | Inbox before G3 |
| Long-context verification | **Antigravity / Gemini** | Tool schemas checked against the WebMCP-org examples repo patterns; office-hours recording digested to a half-page; catalog fact-audit against source pages | Before G2 (schemas), before G3 (facts) |
| Live-discourse recon | **Grok** | X chatter: ChatGPT-browser WebMCP gotchas, flag behavior surprises, what judges/DevRel keep repeating | Half-page before video record (Wed AM) |
| Design lane | **Claude Design** (claude.ai/design) | Direction boards (live HTML, pick one); design-token CSS-var sheet (first merged artifact — all seats read it); UI shell as handoff bundle (ticker, receipt, cross-compare, action log, drawer); OG image, Devpost header, video title cards. Look-spec for the shader beauty pass; never the 3D implementation itself | Boards + tokens after G1; shell bundle before G2; collateral before Wed record |
| Decorrelation | **Claude (fresh chat) or Gemini — NOT GPT** | Cold review of catalogs' pricing facts, tool-schema ambiguity, Devpost description. With a GPT-family prime, a GPT decorrelator is the prime grading its own homework — the pass moved seats the moment the prime did | Tue evening, 30 min, timeboxed |
| Copy + command | **Lex** | value_notes ×3, tool descriptions final pass, video VO, Devpost description, go/no-go at gates | Gates |

## 5. Meters and load balancing

- **Spend the scarcest meter on the least contractable work.** With Codex as prime, Codex quota is now the binding constraint — it buys only conversation-shaped, repo-context work. Claude Code's meter (the one that bit you in August) becomes a *contract budget*: discrete, spec'd packages that are easy to ration.
- **Downshift within a harness before switching harnesses.** Model tier changes are free; harness changes cost a context rebuild. Inside Codex, reserve the top tier for architecture and debugging, run the workhorse tier for boilerplate. Same policy inside Claude Code (Sonnet default, Opus/Fable escalation only where it earns it).
- **Commodity work goes to whichever meter is fullest** — catalogs and READMEs don't care who writes them if the contract is tight.
- **Check meters at every gate.** If the prime's meter will not clear the next gate, execute the molt *at the gate*, not mid-task.

## 6. Substrate: git is the bus

No new infrastructure this week; the estate serves the sprint, never the reverse. Bridges, vaults, and mailboxes stay parked unless already zero-friction daily drivers.

- **`WORKLOG.md`** at repo root is shared state. One line per task: `[id] [lane] [status: spec'd|out|inbox|merged|dead] [gate] [notes]`.
- **`contracts/`** holds outgoing specs (`contracts/out/`) and incoming deliverables (`contracts/inbox/`). Nothing merges from inbox without prime review — the adversarial-audit habit, here just called code review.
- **Sync at gates, not continuously.** Cross-talk between seats is forbidden; everything routes through the prime via the repo. Continuous coordination is how the meta-work eats the object-level work.

## 7. Sequencing against the gates

- **Now → G0 (Mon ~4pm):** Codex alone. No parallelism until the rig proves — parallel work stacked on a dead rig is negative work. (One exception: kicking off the mesh download and license screenshot, which is human work anyway.)
- **G0 → G1 (Mon eve):** the moment G0 passes, fire two contracts — Claude Code gets the scene-module contract; the fuller commodity meter gets the Cybertruck catalog contract. Codex stays on the tool layer.
- **G1 → G2 (Tue AM):** scene PR lands, prime integrates. Antigravity schema-verification lands before G2. Ioniq catalog contract goes out.
- **G2 → G3 (Tue PM):** catalog contracts merge after fact-audit; decorrelation pass (Claude/Gemini) runs 30 min; fixes applied; Lex copy pass.
- **G3 → G4 (Wed AM):** fleet quiesces. Grok recon lands before recording. From here it's Codex + Lex only: polish, video, Devpost plugin, submit by 11am PT. **No contract may be outstanding at Wed 8am** — anything still in flight is dead by rule.

## 8. Failure modes and counters

| Failure | Counter |
| --- | --- |
| Two seats edit the tree; midnight merge war | Single-writer rule; inbox-only delivery; prime merges |
| Context-rebuild tax paid on conversational work | Contractable-work gate (§3) — if it needs a conversation, it stays home |
| Ghost work: a contract nobody remembers is out | WORKLOG is the ledger; outstanding-contract check is a standing gate question; Wed 8am kill rule |
| Prime meter dies mid-critical-path | Meter check at every gate; molt-at-the-gate procedure; HANDOFF.md discipline |
| Decorrelation theater (prime's family reviewing prime's work) | Decorrelator seat is always cross-vendor from the prime — swap it whenever the prime swaps |
| Coordination eats the project | Gate-only sync; no inter-seat chatter; the doctrine fits on one page and is not itself a workstream |
| Fleet romanticism (using all five because you have five) | Every lane must map to a gate deliverable; a seat with no contract stays cold |

## 9. The routing log → Constellation Card

Every delegation gets one line in `WORKLOG.md` at dispatch and one at resolution: seat, contract id, spec size (lines), turnaround, **rework required (none / minor / major / redo)**. That last field is the honest metric — a lane whose deliverables need major rework was a fake parallel lane.

Post-sprint (Sep 4, one hour, not before): fold the log into a Constellation Card —

```
CARD: hackathon-sprint-v1
PROBLEM CLASS: solo product sprint, hard deadline ≤3 days, judged deliverable
TOPOLOGY: single prime (vendor A) + cross-vendor contract lanes + gate-sync
ROLES: prime / subsystem contractor / data contractor / verifier / recon / decorrelator / human command+copy
ROUTING RULES: contractable-work gate; scarcity spend; downshift-before-switch; decorrelator ≠ prime family
CADENCE: sync at gates only; kill outstanding contracts T-5h
OUTCOMES: shipped? gates hit/slipped; rework rate per lane; meter burn per seat
VERDICT: keep / modify / retire per lane
```

n=1 with real stakes beats n=0 with a manifesto. Ship first; the card is Thursday's reward.
