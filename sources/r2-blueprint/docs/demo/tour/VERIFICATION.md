# Tour verification, 2026-09-05

`node --test src/tour.test.js`: 11 tests, 11 passed, 0 failed (including the real
WebMCP/window.r2/postMessage dispatcher with minimal three.js constructor stubs).
JavaScript syntax checks and `bash -n tools/tour_caps.sh` passed.

The worktree server started with `python3 serve.py 8766`. Headless Google Chrome
aborted with signal 6 / exit 134 before writing a PNG, both for the pre-tour baseline
and when running `tools/tour_caps.sh`. The browser tool also reported no available
browser. No visual verification, PIL statistics, or live DOM comparison is claimed.

Fable: run `tools/tour_caps.sh` outside the restricted execution environment. Expected
outputs: `step-1.png` through `step-9.png`, corresponding `step-N_half.jpg`,
`before.png`, `default.png`, `layout-1440.png`, `layout-1024.png`, and DOM/JSON probes.
The script checks PIL mean/stddev and compares the live default controls to revision
`840772b90eec789a4be1183df8173a1669f1004b` without modifying another checkout.

Source-derived baseline controls (not a live DOM observation):
ISO, 3/4 F, 3/4 R, SIDE, FRONT, TOP; RUN, DRIVE, LIGHTS, PANELS, EXPLODE, OPEN.
The new control is TOUR. The other buttons are the drawing-panel toggle and three
minimize buttons (key, telemetry, title block). With the cards hidden only the corner
toggle and the new TOUR launcher should be visible.

`src/vehicle.js` is unchanged; geometry and measured-fit captures could not be
rechecked because Chrome could not launch.

All 13 existing tool schemas were compared against the pre-tour revision by loading
the two dispatcher modules with stub constructors: unchanged; 15 tools total.

Commit was attempted on branch `tour`, but Git could not create
the shared Git index of the main checkout
(`Operation not permitted`). The sandbox allows source writes in this worktree but
not the shared Git metadata. No files were staged and no commit was made. Fable can
commit from this worktree after review:

```bash
git add README.md build.py src/config.js src/main.js src/overlay.js src/ui.js src/webmcp.js src/tour.js src/tour.test.js styles.css tools/tour_caps.sh docs/TOUR.md docs/demo/tour/VERIFICATION.md
git commit -m "Add interruptible tool-driven tour with captions and held capture links"
```
