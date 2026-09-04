// Positive controls for the instruments.
//
// Finding 12: a number can be real, correctly read, and about the wrong thing.
// A harness that has never been seen to respond has not been calibrated, and a
// null result from it is not evidence — it is silence.
//
// So each instrument is driven twice: once where the thing it measures is known
// NOT to change, and once where it is known to change, by a route that does not
// go through the instrument. Both directions must come out right. A frame
// differencer that says "changed" for everything passes the second check and
// fails the first, and would have hidden the touch-orbit false negative.
//
//   pnpm eyes:selftest

import { APP_URL, frameChanged, liveReady, open, report, shoot } from "./lib.mjs";
import { Buffer } from "node:buffer";

const r = report("selftest");

// --- frameChanged, on synthetic buffers -------------------------------------
{
  const a = Buffer.alloc(40_000, 7);
  const b = Buffer.alloc(40_000, 7);
  r.ok("differencer: identical buffers do not read as changed", !frameChanged(a, b).changed);

  const c = Buffer.alloc(40_000, 7);
  for (let i = 0; i < c.length; i += 1) c[i] = i % 251;
  r.ok("differencer: a wholly different buffer reads as changed", frameChanged(a, c).changed);

  // One byte in forty thousand is noise, not a change. If this trips, the
  // threshold is too tight and every capture will read as movement.
  const d = Buffer.from(a);
  d[123] = 200;
  r.ok("differencer: a single byte is below the noise floor", !frameChanged(a, d).changed);

  r.ok("differencer: mismatched lengths read as changed", frameChanged(a, Buffer.alloc(10)).changed);
}

// --- frameChanged, against the real renderer --------------------------------
{
  const s = await open({ viewport: { width: 1300, height: 850 } });
  const live = await liveReady(s.page);
  r.ok("renderer reached ready", live, live ? "" : `is ${APP_URL} being served?`);
  if (live) {
    await s.page.waitForTimeout(3500);

    // Negative control: nothing touched, nothing should move. A demand-driven
    // renderer must be genuinely still here.
    const first = await shoot(s.page, ".vc-stage");
    await s.page.waitForTimeout(1500);
    const second = await shoot(s.page, ".vc-stage");
    const still = frameChanged(first, second);
    r.ok("negative control: an untouched stage does not read as changed",
      !still.changed, `${(still.fraction * 100).toFixed(1)}% of samples differ`);

    // Positive control: change the view by a route that is not the instrument,
    // and require the instrument to notice.
    await s.page.getByRole("button", { name: "Profile", exact: true }).click();
    await s.page.waitForTimeout(2500);
    const moved = frameChanged(second, await shoot(s.page, ".vc-stage"));
    r.ok("positive control: a preset change does read as changed",
      moved.changed, `${(moved.fraction * 100).toFixed(1)}% of samples differ`);
  }
  await s.close();
}

// --- the WebGL block actually blocks ----------------------------------------
{
  const s = await open({ viewport: { width: 1200, height: 800 }, webgl: false });
  await s.page.waitForTimeout(5000);
  const renderer = await s.page.locator(".vehicle-canvas").getAttribute("data-renderer");
  r.ok("the no-WebGL control actually denies a context", renderer !== "live_3d", `data-renderer=${renderer}`);
  await s.close();
}

r.finish();
