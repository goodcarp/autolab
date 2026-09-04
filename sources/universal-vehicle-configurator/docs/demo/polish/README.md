# Showroom polish — before/after captures

Captured with `node tools/polish/capture.mjs <prefix>` against a served `dist/`
(Playwright + SwiftShader, 1440×900, `prefers-reduced-motion: reduce` so the
camera lands on its pose and the idle turntable stays off). `before-*` is the
tree at `5a0501e`; `after-*` is the polished branch. Same URL, same clicks.

| Pair | What it shows |
| --- | --- |
| `angle-esker-lt21` | Opening three-quarter, Esker Silver, 21" Liquid Tungsten |
| `profile-esker-lt21` | True profile |
| `wheel-esker-lt21` | Wheel close-up, 21" Liquid Tungsten |
| `interior-esker-lt21` | Cabin view |
| `blueprint-esker-lt21` | Blueprint mode |
| `open-angle-esker-lt21`, `open-profile-esker-lt21` | Doors, frunk and liftgate open (aperture check) |
| `angle-glacier-lt21`, `angle-catalina-lt21`, `angle-forest-lt21`, `angle-launch-lt21`, `angle-borealis-lt21` | Each paint |
| `wheel-esker-bs20at`, `angle-esker-bs20at` | 20" Black Sand All-Terrain |
| `wheel-esker-bc20` | 20" Bicolor Carbon (twin-spoke face) |
| `wheel-esker-mg19` | 19" Machined Graphite |
| `garage-iso`, `garage-side-open`, `garage-q34f-explode` | The Garage drawing, untouched by this branch |

`*-log.json` records the readout text and every console warning/error per shot.

## Round 2 — Hudian RX2 rebrand, decluttered chrome, exposure 1.12, wider opening pose

`after-r2-*` were taken on the first cut (build cards still carried the RX2
prefix); `final-r2-*` on the committed tree. Both under SwiftShader at
1440×900 with `prefers-reduced-motion`, plus a 390-wide phone pass from
`tools/polish/capture-rail.mjs` (`*-page-phone.png`, `*-rail-wheels-*.png`
for the per-option wheel glyphs). The Blueprint shot is reached through the
`b` key now that the Showroom/Blueprint switch has left the visible chrome;
open-body shots need the WebMCP presentation path.
