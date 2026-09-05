# Showroom scan — implementation and capture handoff

Branch: `showroom-scan`. No geometry source or generated geometry mirror was
changed. Exposure remains **1.12**; the interior preset still excludes the post
chain and reflective floor.

## Commit status: blocked by worktree metadata permissions

Staging the explicit changed-file list failed before a commit could be made:

```text
fatal: Unable to create the shared Git index lock (sandboxed worktree)
```

The worktree's Git index lives outside the writable sandbox roots. All edits
remain unstaged in `uvc-showroom-polish`; no commit or push was made, and the
main checkout's source files were not edited. After visual verification, use
this commit message on `showroom-scan`:

```text
Widen R2 framing, scan presentation changes, and tighten showroom lighting
```

## Changes

- **A — opening camera:** 4% further out from the previous 1.25× pose (1.30×
  the first cut), at the same bearing/elevation. Orbit distances follow that
  change. R2 angle/profile views compensate below the desktop stage's 1.205
  aspect ratio, preserving horizontal framing on the phone.
- **B — blueprint scan:** 1,100 ms from rear to front, and front to rear on
  return. Original solid materials and temporary wireframe passes use
  complementary world-X clips, preserving the existing aperture, flake and
  cavity shader hooks. A narrow lime highlight marks the front on the surface.
  Both B and `present_vehicle_configuration` drive the same mode prop. Rapid
  reversal continues from the current front. Reduced motion snaps. Extra wire
  passes disappear at the endpoint, and scan invalidation stops there.
- **C — lighting:** a tighter near-ground contact shadow supplements the broad
  shadow; a restrained cool rim light separates the shoulder. Orchard Beach
  Silver's environment intensity is 1.55 (was 1.75) and clearcoat roughness is
  0.09 (was 0.03), softening the reflection peaks.

## Capture status: blocked before browser startup

`node tools/polish/capture-scan.mjs scan` exited **1** on 2026-09-05.
Chromium's macOS process registration was denied by the sandbox:

```text
FATAL:base/apple/mach_port_rendezvous_mac.cc:159
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer:
Permission denied (1100)
```

The complete failed launch is in [scan-log.json](scan-log.json).
**No new PNGs exist yet.** New camera pixel extent, GPU shader compilation,
visual scan continuity, Silver highlights, tyre shadows and the fully open
apertures remain unverified. Unit tests verify preservation of the real
aperture shader hooks; they do not substitute for the open-body captures.

| Opening extent | Measured fraction | Status |
| --- | --- | --- |
| 1440×900 desktop | Not measured | Browser blocked; target 62–68% of vehicle canvas width |
| 390×844 phone | Not measured | Browser blocked; require clear air on all sides |

The desktop screenshot from the previous polish pass informed the small
additional pullback. It is not evidence for the new camera's extent.

## Fable: run the captures

From this worktree, serve the built site in one terminal:

```sh
corepack pnpm preview --host 127.0.0.1 --port 4190
```

Then in another terminal:

```sh
node tools/polish/capture-scan.mjs scan http://127.0.0.1:4190
```

The script follows `tools/polish/capture.mjs`: headless Playwright with
SwiftShader, device scale 1, the same Silver/21-inch-wheel URL, and reduced
motion for static poses. It runs both 1440×900 and 390×844. For scan captures it
switches to normal motion and advances Playwright's clock to approximately
500 ms, freezing time during the screenshot so SwiftShader cannot skip the
midpoint. The log records actual scan progress and rejects a missed midpoint.
The outbound trigger is B; the return and body openings use the registered
page's actual WebMCP presentation tool.

All planned paths below are relative to this directory. `{device}` expands to
`desktop` and `phone`; every row is currently pending because launch failed.

| Capture path | Verification |
| --- | --- |
| `scan-{device}-angle.png` | Opening pose, clear air |
| `scan-{device}-angle-mask.png` | Car-only rasterized alpha mask for extent measurement |
| `scan-page-{device}.png` | Whole page, including the 390-wide layout |
| `scan-{device}-profile.png` | Silver shoulder, rim light and tyre contact |
| `scan-{device}-blueprint-mid.png` | B trigger, approximately 500 ms, mixed solid/wire surfaces |
| `scan-{device}-blueprint-settled.png` | Original all-wire endpoint |
| `scan-{device}-showroom-mid.png` | Presentation tool, reverse sweep at approximately 500 ms |
| `scan-{device}-showroom-settled.png` | Solid endpoint and restored showroom |
| `scan-{device}-open-angle.png` | Tool `bodyOpen:true`; four doors, frunk and liftgate fully open |
| `scan-{device}-open-profile.png` | Aperture check: nothing crosses an opening |
| `scan-{device}-interior.png` | Interior plain-render regression |

The script writes `scan-results.md` with a capture table and measured extent
table, and `scan-log.json` with console messages, tool outcomes and scan/body
state. It also checks reduced-motion snapping and no extra render frames after
the parked profile settles. A failed extent target causes a nonzero exit after
the captures finish.

Extent measurement uses the *actual rasterized pixels* from the capture camera:
render only the vehicle into the same-sized transparent canvas with the existing
aperture materials, then bound pixels with alpha ≥16/255. This excludes the
floor, contact shadows, bloom, and UI. The reported fraction is the bounding
box width divided by canvas width (the vehicle frame, not the 1440-pixel page
including the configuration rail). The diagnostic mask is saved for inspection.

## Verification run

```text
$ corepack pnpm typecheck
$ tsc --noEmit
exit 0

$ corepack pnpm lint
$ eslint .
exit 0

$ corepack pnpm test:run
$ node scripts/sync-r2-model.mjs && vitest run
Garage → Configure R2 model mirror: already current.
Test Files  21 passed (21)
     Tests  128 passed (128)
  Duration  9.94s
exit 0

$ corepack pnpm build
$ node scripts/sync-r2-model.mjs && tsc --noEmit && vite build
Garage → Configure R2 model mirror: already current.
vite v8.2.2 building client environment for production...
✓ 2422 modules transformed.
✓ built in 1.02s
(!) Some chunks are larger than 500 kB after minification.
exit 0
```

Eight new tests cover camera bearing/aspect compensation, both scan endpoints,
duration, reversal, repeated requests, reduced motion, actual shell aperture and
flake hook preservation, refitted geometry, resource ownership and StrictMode
effect replay. Existing
presentation tool/controller tests remain green; the public state schema did
not change.
