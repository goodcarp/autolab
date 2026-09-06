# The tour

TOUR (or T) starts nine six-second steps: ISO overview, headlamps with lights,
side elevation with dimensions, structural battery, front drive unit, open panels,
exploded assembly, drive with lights, and reset. The complete tour takes about 54 seconds.
TOUR remains reachable when the other sheet cards are hidden. The caption card uses the
sheet's type and ink, and the selected part uses the existing highlight/key-row path.

Every scene change is a tool call through `src/webmcp.js`'s dispatcher. The pure
`src/tour.js` sequencer knows nothing about three.js or the DOM. Its private caller
identity lets its own actions run; external calls still interrupt between actions.

Pressing the canvas, scrolling, pressing a key the sheet accepts, or clicking a sheet
control stops the tour. The requested manual action still runs. The caption reads
`TOUR STOPPED · STEP n OF m` for two seconds. Stopping does not restore the scene;
animations already requested can finish. T or TOUR restarts from step one. Normal
completion shows `TOUR COMPLETE` for two seconds. Tour annotation changes do not
save a new browser preference.

## Tools

The tools are registered through WebMCP, mirrored on `window.r2`, and available through
the existing postMessage bridge. Existing tool schemas are unchanged.

```js
await window.r2.start_tour({});          // step 1
await window.r2.start_tour({ from: 4 }); // step 4; integer 1–9
await window.r2.get_state();            // safe to poll during the tour
await window.r2.stop_tour({});          // stop in place
```

`get_state` adds `tour: { running, step, of, id, title }`. Step numbers are 1-based;
before the first run they are 0 with null id/title. A held capture remains running
until interrupted. Every external call that moves the scene (views, motions, camera,
framing, highlighting, annotations, reset) interrupts; reads (`get_state`, `get_part`,
`list_parts`, `measure`, `clearance`, `list_visible_parts`, `get_specification`) and the
host's `set_vehicle_context` do not, so an agent can narrate the tour and the
configurator can keep the sheet in sync without stopping it. `stop_tour`
explicitly stops; `start_tour` replaces the current run. Invalid `from` values fail
without replacing a running tour.

## Links and captures

- `?tour=1`: start on load.
- `?tour=1&step=4`: start at step four and continue.
- `?tour=1&step=4&hold=1`: perform only step four's actions, then hold indefinitely.
- `?tour=1&step=4&hold=1&nodrift=1&adv=4&cards=1`: capture a settled step.
- `snap=1` also works: preset transitions snap during the tour. `nodrift=1` keeps
  presets stationary. `adv` pre-roll happens after the initial step's actions.
  `cards=0/1` overrides the initial step's card visibility without saving a preference.

`step` and `hold` only affect startup when `tour=1`. Invalid URL step numbers use step
one. A later `start_tour` call starts a normal advancing tour, even on a held URL.
With no tour parameter the vehicle keeps its existing initial state and card
preference; only the new TOUR control is added and the caption stays hidden.

Run `tools/tour_caps.sh` from this worktree. It starts `python3 serve.py 8766` if needed,
uses the `cap.sh` Chrome flags, captures every held step as PNG plus half-size JPG,
and checks grayscale mean/stddev with PIL. It also captures the pre-tour revision and
the current default query, records DOM-visible buttons and scene state, and checks
caption/control/title-block separation and the hot battery row at 1440 and 1024 widths.
Temporary baseline source is materialized inside this worktree and removed on exit;
no other checkout is touched. Output goes in `docs/demo/tour/`.

## Re-authoring a step

Edit `CONFIG.tour` in `src/config.js`. A step is an ordered record:

```js
{
  id: 'battery', title: 'STRUCTURAL BATTERY PACK',
  caption: 'The structural battery pack is a stressed floor member.',
  dwell: 6000, // milliseconds, including action execution
  actions: [
    { name: 'reset', args: {} },
    { name: 'set_motion', args: { motion: 'panels', on: true } },
    { name: 'frame_part', args: { part: 'battery', azimuth_deg: 52, elevation_deg: 28, margin: 0.7 } },
    { name: 'highlight_part', args: { part: 'battery' } },
  ],
}
```

Use exact tool names and arguments, explicit `on` values, and enough setup to make the
step work when entered directly. `panels: on:true` means dissolve the shell. Use
`highlight_part` to make its KEY FEATURES row hot. Keep at most nine steps, each around
5–7 seconds and the total below one minute. Larger `frame_part.margin` values pull
back; check the actual capture before settling on a pose.

Caption provenance for the current tour: steps 1/9 use `CONFIG.title`; step 2 uses
`headlamps.desc`; step 3 uses `CONFIG.viewTitles.side`; step 4 uses `battery.desc`;
step 5 uses `driveUnitF.desc`; step 6 uses `hood.desc`; step 7 uses `roofGlass.desc`;
step 8 uses `CONFIG.instr`. No new vehicle figures are introduced. New numerical
captions must use an existing part description or SPEC as returned by
`get_specification` (call it before starting; it interrupts an active tour).

Run `node --test src/tour.test.js` after editing. Its injected clock/scheduler cover
start, advance, stop, from-index, interruption mid-step, stale callbacks, hold and
failure, plus the real dispatcher's three external surfaces. `start(fromIndex)` is
zero-based internally and resolves after the first step's actions. A scheduler may
return a cancellation function; a run token also protects callbacks that cannot be
cancelled. Infinite dwell is reserved for the held capture copy of the steps.

The served site needs no build. `build.py` includes the new module for future optional
standalone exports; this change does not regenerate the committed `dist/` exports.
