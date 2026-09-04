import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "@playwright/test";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.argv[2] ?? "http://127.0.0.1:4173/";
const outputDir = process.argv[3] ?? "/private/tmp/uvc-range-reality-capture";
const frameIntervalMs = 167;
const storyFrames = 37;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--disable-gpu"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${outputDir}/000.png` });

  await page.getByRole("button", { name: "Explain this build" }).click();
  const storyStartedAt = Date.now();
  const storyCompletion = page
    .getByText("Blueprint complete")
    .waitFor()
    .then(() => Date.now() - storyStartedAt);

  for (let index = 1; index <= storyFrames; index += 1) {
    const targetElapsed = index * frameIntervalMs;
    const remaining = targetElapsed - (Date.now() - storyStartedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    await page.screenshot({ path: `${outputDir}/${String(index).padStart(3, "0")}.png` });
  }

  const storyElapsedMs = await storyCompletion;

  await page.getByRole("button", { name: "Showroom" }).click();
  await page.getByRole("button", { name: "Explain this build" }).click();
  await page.waitForTimeout(850);
  const interruptionStartedAt = Date.now();
  await page.locator(".range-stage").dispatchEvent("pointerdown");
  await page.getByText("Interrupted · complete blueprint shown").waitFor();
  const interruptionMs = Date.now() - interruptionStartedAt;
  await page.screenshot({ path: `${outputDir}/interruption.png` });

  const report = {
    viewport: "1280x720",
    mode: "authored_2_5d",
    storyElapsedMs,
    interruptionMs,
    frameIntervalMs,
    frameCount: storyFrames + 1,
  };

  await writeFile(`${outputDir}/capture-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
}
