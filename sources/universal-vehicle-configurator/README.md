# AutoLab by AutoMoto

An unofficial WebMCP Challenge concept: one agent-operable vehicle experience
that follows the product from configuration through ownership. A person and an
agent share the same revisioned build, the same code-native R2 model, and two
purpose-built lifecycle surfaces.

**Configure** is a live 3D sales and buyer-intelligence experience. **Garage**
is an interactive technical digital twin for owner guidance, component
inspection, measurements, openings, exploded views, and service context. The
same configuration state is synchronized between them.

AutoLab exposes 17 page-defined WebMCP tools. Agents can inspect, simulate,
apply, interrupt, undo, price, compare, present, list parts, frame components,
operate the digital twin, and measure the vehicle while the person remains in
control.

Every configuration and incentive claim an agent can make is citable: incentive
outcomes carry resolved source records with titles, URLs and retrieval dates,
and `get_vehicle_configuration` returns a shareable permalink for the build it
just described, plus a `renderedBody` record saying which vehicle is actually on
screen and where its geometry came from.

The digital-twin tools are the exception, and deliberately. Part positions,
bounds and measurements are read off an independent reconstruction fitted to
published dimensions and photographs — not manufacturer CAD, not a scan — so
they carry that basis in `get_specification` rather than a source record. Treat
them as accurate about *this model*, not as engineering data about the vehicle.

## For judges: running the agent experience

The page publishes its tools on `document.modelContext`, falling back to
`navigator.modelContext`. If the API appears within about twelve
seconds of page load, the page picks it up on its own and the header chip
switches from **Manual mode** to **17 agent tools** without a reload. After that
window the page stops watching, so an API injected later needs a reload.

**Option A, ChatGPT desktop.** Update to the latest version, then open this
URL in the app's built-in browser. Ask it to read the current build.

**Option B, Chrome.** Enable the flag, restart Chrome, then load this URL:

```text
chrome://flags/#enable-webmcp-testing
```

Either way, click the header chip to see every registered tool and several
copyable starter prompts. Good ones to try:

- `Configure the cheapest R2 that can tow, then tell me what changed.`
- `I'm in Colorado, I'll finance, and I can install a home charger. What do I actually qualify for?`
- `Switch to the all-terrain wheels and show me the wheel close-up.`
- `Take me into the Garage, reveal the structural battery, and explain what I am looking at.`
- `Open every panel on my configured R2, then show me where the charge port is.`

While a multi-stage agent transaction is running, **click any control in the
right-hand rail**. The agent is interrupted after its last committed stage, and
the receipt panel shows exactly which stages landed and which were killed.

Without a WebMCP-capable browser the configurator remains fully usable by hand.

## Local development

```sh
pnpm install
pnpm dev
```

### One model source

Garage owns the procedural R2 geometry. Edit only
`public/garage/src/vehicle.js` and `public/garage/src/geom.js`; Configure's
copies under `src/scene/r2/` are generated mirrors. `pnpm dev`, `pnpm test`,
and `pnpm build` synchronize them automatically, including live updates while
the development server is open. Use `pnpm model:check` to verify parity or
`pnpm model:sync` to synchronize explicitly.

## Verification

```sh
pnpm model:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

## The 17 tools

- read the current build, price, incentives, and revision;
- list valid options;
- simulate a change without mutating state;
- apply an interruptible multi-stage transaction;
- interrupt an active transaction;
- undo the latest eligible agent transaction;
- direct showroom, camera, Blueprint, and focus presentation;
- capture buyer context without guessing;
- estimate financed payment, energy, and multi-year ownership cost;
- compare the current build against up to three alternatives.
- read the synchronized digital-twin state;
- list 42 named shell, chassis, running-gear, and interior components;
- reveal, frame, and highlight a component;
- move among six authored technical views;
- operate lights, driving motion, shell dissolve, openings, and exploded assembly;
- measure between named vehicle components in metres;
- switch between the Configure surface and the Garage digital twin.

Every tool that changes the **build** — apply a transaction, undo one, set
buyer context — takes an `expectedRevision` and rejects on conflict, so an
agent cannot silently overwrite a change the person just made. The
presentation, digital-twin and workspace tools do not take one: they move the
camera, the twin or the visible surface, never the configuration. Interrupting
a running transaction does not take one either, since it is aimed at whatever
is in flight by definition.

## Incentives

The incentive engine sorts every program into four buckets: matched, could
apply, expired, and does not apply. It never reports eligibility, only which
encoded predicates matched, and it names the buyer facts it refuses to guess.
Set your state, utility, home charging, and payment method in the rail and the
Review sheet recalculates with dated sources for each program.

## Rendering

Both surfaces use the same procedural R2 geometry generated in code from
published dimensions and independently fitted reference material. Configure
dresses that body for a showroom; Garage renders the same authored geometry
through a normal/depth/part-id post-processing pipeline with technical ink,
hatching, dimensions, and part-aware interaction.

This is an independent, unofficial concept and is not associated with,
endorsed by, or sponsored by Rivian or any manufacturer. The geometry is an
independent reconstruction, not manufacturer CAD or an official engineering
release. Vehicle names and specifications are used nominatively to identify
the products being discussed.
