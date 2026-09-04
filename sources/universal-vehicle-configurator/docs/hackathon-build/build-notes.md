# AutoLab build notes

Updated: 2026-09-03

## Product decision

AutoLab is now one lifecycle experience rather than two adjacent prototypes.
**Configure** is the sales and buyer-intelligence surface. **Garage** is the
owner and service surface. Both use the code-native R2 engineering body carried
from the original drawing project, and both refer to one synchronized build
revision.

The top-level agent API is intentionally curated: 16 tools describe useful
customer outcomes instead of exposing every rendering primitive. The Garage
page still publishes 14 lower-level tools when opened directly, which makes the
framework legible to technical judges without making the shared experience
noisy.

## Implemented integration

- AutoLab identity, favicon, metadata, README, Configure/Garage navigation, and
  responsive shell.
- The full R2 digital-twin webapp embedded under `public/garage/`.
- A same-origin message bridge with origin/source/id validation and bounded
  response timeouts.
- State synchronization for build, paint, wheels, interior, range, total, and
  revision.
- Curated tools for twin state, component listing, part inspection, authored
  views, motion, and component measurement.
- Manual Garage shortcuts for the structural battery, vehicle openings, and
  exploded assembly.
- On-demand Garage loading: showroom 3D wins first paint, then the owner twin
  prewarms in the background.
- Local Three.js/add-on bundle, 1.35 DPR ceiling, 1024 px shadow map, 30 Hz
  technical render cadence, and hidden-tab suspension.

## Verified choreography

In the in-app browser, `get_vehicle_configuration` reported the code-native R2
Performance build at revision 1. `get_vehicle_twin_state` returned the same
build, Esker Silver, 21-inch wheels, Black Crater, 330-mile range, and $59,485
vehicle total. `inspect_vehicle_part` then switched the shared page to Garage,
dissolved the shell, framed the structural battery bounds, and highlighted the
part. The host exposed all 16 AutoLab tools; the direct Garage page exposed all
14 drawing tools.

## Honest boundary

The geometry is an independent procedural reconstruction fitted to Rivian's
published dimensions and independently authored visual references. It is not
Rivian CAD, a scan, or an official service model, and the site does not imply
manufacturer endorsement. The optional licensed EX30 reference remains in the
repository as an attributable alternate source but is not the default AutoLab
vehicle identity.

## Remaining submission work

Deployment, deployed-device fallback checks, the recorded demo, and Devpost
submission assets remain separate final-mile tasks.

## Final hardening — WebMCP contract

- Audited all 16 host tools and all 14 direct Garage tools. Every tool now has
  a closed top-level schema, a human-readable title, and explicit read-only,
  non-destructive, idempotency, closed-world, and trusted-content hints.
- Direct Garage calls now enforce their published schemas at runtime, report
  filtered counts truthfully, and reject stale or conflicting configuration
  revisions instead of rolling the twin backward.
- The Configure/Garage bridge now validates source, origin, request id, and
  response status; propagates cancellation through frame loading and calls;
  bounds timeouts; and refuses to continue a Garage sequence if the build
  revision changes while its frame is loading.
- Added direct-tool, host-to-Garage, and cross-frame regression coverage.
- A production-browser smoke exposed and fixed an iframe startup race: the
  bridge had mistaken the initial `about:blank` document for a loaded Garage,
  so its first messages could arrive before Garage installed its listener.
  The rebuilt preview now completes a first-call Garage sync, battery frame,
  and explode action at the same configuration revision.

## Canonical Garage model source

- Garage's `public/garage/src/vehicle.js` and `geom.js` are now the only
  human-edited procedural geometry sources. Configure's `src/scene/r2/` copies
  carry generated-file notices and are reproduced deterministically.
- Development, test, and production-build commands synchronize the mirror
  before work begins. The Vite development server also watches Garage and
  reloads Configure after a geometry save.
- A standalone parity command, CI gate, and Vitest check reject stale or
  hand-edited Configure mirrors.
- Verification covered a real live-edit round trip, an intentionally stale
  mirror that made the parity test fail, the restored passing parity test, 21
  focused scene tests, ESLint, and a production Vite bundle.

## Responsive hardening

- Measured Configure and Garage at 390×844, 700×880, 768×1024, 1280×800,
  and 1728×1000. The intermediate split-pane range is handled explicitly.
- Removed a legacy tool-chip style collision that made the header exceed its
  reserved height, constrained the showroom stage to its sticky viewport, and
  let the stacked configuration rail use the full available width.
- Docked Garage shortcuts away from the engineering title block and reserved a
  compact mobile lane so the lifecycle switch, human controls, model, and
  drawing metadata remain available together.
- On portrait touch devices, Garage's view, motion, card, and panel controls now
  use full 44 px targets while narrow mouse-driven panes retain the denser
  technical layout.
