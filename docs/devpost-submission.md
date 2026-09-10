# AutoLab by AutoMoto — Devpost submission draft

Status: Devpost-ready draft. The live site, public repository, and public
YouTube demo are linked below. Everything is written against the Devpost
form's required sections.

---

## Project name

AutoLab by AutoMoto

## Tagline (one line)

Agent-native, web 4.0 tools for car lovers: an AI-operable configurator, an
agentic owner's guide with a live digital twin, and the 3D creation engine
behind them.

## Live URL

https://autolab.run/

## Video

https://youtu.be/ZoMXWz_WNKY (1:26, public, with audio)

## Repository (public, Apache-2.0)

https://github.com/goodcarp/autolab — one repository holding the site and, under
`sources/`, the configurator, the owner's guide and the 3D creation engine.

---

## Description

### Why WebMCP is the right fit

A car is the most misunderstood machine most people use every day, and buying
one is a forty-thousand-dollar form. Today an assistant can only *talk* about
either. WebMCP lets the page itself hand the agent structured tools, so the
agent can see the same vehicle the person sees, know what it costs and why, and
change it on the same screen at the same moment. Configuring, understanding and
servicing a vehicle are exactly the tasks where a person wants a guide who can
act, not a chatbot who can describe.

### What it does

AutoLab is one vehicle experience that follows the product from purchase into
ownership, with one synchronized build state across three surfaces:

1. **Web 4.0-enabled Vehicle Configurator.** A live 3D digital showroom where a
   person and an agent share one revisioned build. The agent can read the build,
   list valid options, simulate a change without committing it, apply an
   interruptible multi-stage transaction, undo, price the vehicle, estimate a
   financed payment and multi-year ownership cost, run the incentive engine
   against the buyer's real situation, compare up to three builds, and direct the
   showroom camera, the Blueprint view and component focus.
2. **Agentic Owner's Guide.** A general-arrangement drawing of the vehicle that
   opens into a 3D digital twin. The agent can frame, highlight and measure any
   of 42 named components, move among six authored technical views, open every
   door and panel, dissolve the body to the skateboard chassis, drive it, light
   it, and explode the assembly while it explains what the owner is looking at.
   The same twin is embedded in the configurator as **Garage**, carrying the
   configured paint, wheels, interior, range and price with it.
3. **AutoLab 3D Creation Engine.** The agent-native framework that built the
   vehicle: a set of Node.js instruments that measure a code-native three.js
   model directly against published dimensions, name the part that owns each
   miss, and propose curve fixes without ever putting a camera in the loop.

### What humans and agents gain together

- **The person always wins.** Every build-changing tool takes an
  `expectedRevision` and rejects on conflict, so the agent cannot overwrite a
  change the person just made. A running agent transaction is interrupted by
  clicking any control, and a receipt shows which stages landed.
- **Every claim is citable.** Incentive outcomes carry source records with
  titles, URLs and retrieval dates. Digital-twin measurements state their basis.
  The agent can say where a number came from, and when it is refusing to guess.
- **Showroom choreography.** "Take me into the Garage, reveal the structural
  battery, and explain what I am looking at" is one sentence for the person and
  four tool calls for the agent, ending with the person and the agent looking at
  the same highlighted part.
- **Hand control never goes away.** Without a WebMCP-capable browser every
  surface is fully usable by hand, and the header chip says honestly whether the
  agent has tools or the page is in manual mode.

### How WebMCP is implemented

Every page publishes its tools on `document.modelContext` with `registerTool`,
falling back to `navigator.modelContext`, and watches for a late-injected API
for about twelve seconds after load. The same functions are mirrored on a
`window.*` object so any browser, devtools session or Playwright script can
drive the page exactly as an agent would.

- Configurator: 18 curated tools describing customer outcomes (configure,
  simulate, apply, interrupt, undo, price, incentives, ownership math, compare,
  present, twin state, parts, reveal, views, motion, measure, switch surface).
  The embedded Garage publishes 19 drawing tools of its own (the same sheet as the Owner's Guide, plus a bridge), including
  the `set_vehicle_context` bridge, connected over a validated same-origin
  `postMessage` channel with request ids, bounded timeouts and revision checks.
- Owner's Guide: 18 tools over three surfaces (`navigator.modelContext`,
  `window.r2`, `postMessage`) that all drive the same handlers and return
  structured JSON in metres.
- Landing page and engine page: 6 small tools so the umbrella site itself is
  agent-operable (list experiences, open one, read the overview, read the
  measured fit report, read the aperture gate report, list instruments).
- Contract: closed top-level schemas, human-readable titles, explicit
  read-only, non-destructive and idempotency hints, and errors that carry the
  recovery, such as `no part "flux capacitor". Call list_parts for the 42
  available ids.`

### Built with

TypeScript, React 19, three.js (r170 / r185), React Three Fiber, Vite, Vitest,
Playwright, Zod, Zustand, GLSL post-processing (normal / depth / part-id
G-buffer with a composite ink shader), SVG overlays, Node.js CLI instruments,
Python measurement harnesses, GitHub Pages.

### Prior work vs. work during the submission period

The R2 drawing began as a standalone three.js blueprint before the challenge.
During the submission period it gained its WebMCP tool surface, the
`window.r2` and `postMessage` mirrors, and was integrated into the configurator
as the Garage digital twin. The configurator, the incentive engine, the
revision-safe transaction model, the 3D Creation Engine, and this site were
built during the submission period. The `sources/` copies are snapshots of the three working repositories at the commits recorded in `sources/SOURCES.txt`.

### Honest boundaries

The demo vehicle is presented as the fictional **Hudian RX2** by Hudian Motors.
Its geometry is an independent reconstruction fitted to the published
dimensions and photographs of the Rivian R2 (named nominatively), not
manufacturer CAD or a scan. The engine's own
`fit` reports it: wheelbase and tracks exact, overall length 54 mm long, owned
by the headlamps and tailgate. AutoLab and AutoMoto are independent and
unofficial and not associated with, endorsed by, or sponsored by Rivian or any
manufacturer; vehicle names are used nominatively.

---

## How we used AI / Codex (form field)

Claude Code (Anthropic) and Codex (OpenAI) were used as build partners across
all four repositories: writing the WebMCP tool surfaces and their tests,
building the procedural three.js vehicle from published dimensions and
photographs, and, most of all, running the measure-don't-look loop the 3D
Creation Engine encodes. The engine exists because two agents sharing one
working tree once overwrote each other's curve table; its write path now refuses
a dirty repository. Every claim in the tool responses was checked against the
code, and the measured numbers on the site come from running the engine, not
from prose.

---

## Video shot list (under 3:00, with voice-over)

Use the "Dope Questions" script for the voice; picture follows the tools.

| t | Picture | Voice / on-screen |
| --- | --- | --- |
| 0:00 | Landing page, chip flips Manual mode → 3 agent tools | "What if agents could truly help you understand the product you're buying?" |
| 0:15 | Configurator. Prompt: *Configure the cheapest RX2 that can tow, then tell me what changed.* Build changes live, price updates, receipt panel | "Your AI agent can walk you through the build, calculate pricing, explore options…" |
| 0:45 | Prompt: *I'm in Colorado, I'll finance, and I can install a home charger. What do I actually qualify for?* Incentive buckets with dated sources | "…and every claim it makes is citable." |
| 1:05 | Click a rail control mid-transaction; interruption receipt | "The person always wins." |
| 1:20 | Prompt: *Take me into the Garage, reveal the structural battery, and explain what I am looking at.* Surface switch, body dissolves, battery framed and highlighted | "Or help you understand the product you already own?" |
| 1:45 | Owner's Guide standalone. Prompt: *Open every panel, then show me where the charge port is.* Then *measure front wheel to rear wheel* → 2.936 m | "Take the digital twin out of the car. Like a video game of your car." |
| 2:15 | Engine page and terminal: `npm run selftest` (57/57, gate passed), `npm run fit` (54 mm, headlamps) | "The engine that built it measures the model, not a picture of it." |
| 2:40 | Landing page, three cards, repos | "Your car got smarter. Your AI got smarter. How about we all get a little smarter. AutoMoto." |
