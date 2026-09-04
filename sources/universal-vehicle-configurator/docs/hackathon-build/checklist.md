# AutoLab hackathon build checklist

Updated: 2026-09-03

## Combined experience

- [x] Unify the sales configurator and R2 owner drawing under **AutoLab by
  AutoMoto**, with one Configure/Garage lifecycle switch.
- [x] Make the code-native R2 the default body in every configurator view.
- [x] Carry build, paint, wheels, interior, range, price, and revision into the
  Garage digital twin.
- [x] Load Garage after showroom first paint, then keep it warm for instant
  agent choreography.
- [x] Bundle Garage's Three.js runtime locally; no rendering dependency on a
  CDN or remote font.
- [x] Keep direct human controls available on both surfaces.

## Agent surface

- [x] Expose 17 curated AutoLab WebMCP tools for configuration, buyer context,
  ownership math, comparisons, presentations, parts, motion, measurement, and
  switching between the two surfaces.
- [x] Expose the 14 lower-level drawing tools when Garage is opened directly.
- [x] Let an agent switch lifecycle surfaces in **both** directions, dissolve
  the body, frame and highlight a component, open the vehicle, or explode the
  assembly. Inspecting a part or driving the twin moves to Garage on its own;
  `set_autolab_workspace` is how an agent returns, and
  `get_vehicle_configuration` reports which surface is showing.
- [x] Preserve revision-safe configuration transactions, interruption, undo,
  and shareable URL state.
- [x] Keep claim provenance and incentive sources in tool responses.

## Verification

- [x] TypeScript passes.
- [x] ESLint passes; the embedded Garage runtime is treated as a self-contained
  browser artifact and excluded from the host TypeScript lint target.
- [x] Full suite passes: 120 tests.
- [x] Focused agent-surface suite passes across the host tools, the direct
  Garage tools, and the bridge between them
  (`vitest run tests/unit/webmcp tests/unit/garage tests/unit/owner-guide`).
- [x] Production build completes.
- [x] Browser-confirm 17 host tools and 14 direct Garage tools.
- [x] Browser-confirm the configured Performance R2 context reaches Garage and
  the agent can reveal/frame the structural battery.
- [x] Confirm touch orbit, reduced motion, and WebGL fallback — committed as
  `pnpm eyes:degrade`, 26/26, so it is re-runnable rather than a one-off. Verified
  against the production build served locally, not yet against a deployed
  host. Touch drag changes the view on phone and tablet, on both the live 3D
  and the no-WebGL paths; control taps still register. `prefers-reduced-motion`
  is honoured and reported. Without WebGL the page stops claiming live 3D,
  names the authored still it is showing instead, keeps the human controls
  usable, withholds the open-body control, and raises no page errors. No
  horizontal overflow on either surface at 390, 834, 1440 or 1920 px.
- [ ] Record the final demo and capture submission screenshots.

## Final hardening

- [x] Make the Garage-authored procedural R2 the canonical geometry source and
  automatically mirror/verify the Configure copy during development, testing,
  and production builds.
- [x] Audit all host and direct-Garage WebMCP tools, strengthen any weak
  schemas, error handling, or state synchronization, and cover improvements
  with automated tests.
- [x] Verify and refine Configure and Garage at phone, tablet, narrow
  split-pane/tray, laptop, and full-screen viewports without hiding core human
  controls or agent-visible state.

## Rights and representation

- [x] Default hero and Garage vehicle are the same independent procedural R2
  reconstruction fitted to published dimensions—not manufacturer CAD or a
  scan.
- [x] AutoLab is labeled independent, unofficial, and unaffiliated — on the
  Configure surface, and on the Garage sheet itself, which is a supported entry
  point on its own and reads as an engineering release without it.
- [x] The optional licensed EX30 reference remains documented and attributed,
  but is not the default demo identity. The social preview card is the R2, and
  `docs/asset-license.md` is marked superseded on the point where it still
  called the GLB the shipped hero.
- [x] Bundled Three.js runtime retains its upstream MIT license header, and
  `public/garage/vendor/LICENSE` carries the full text for the directory.
