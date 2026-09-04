/* AutoLab 3D Creation Engine — page agent surface.
 * Two read-only WebMCP tools exposing the latest measured report for the model
 * both AutoLab experiences render. The numbers are a snapshot of `npm run fit`
 * and `npm run selftest`; the commit and date are carried in the payload. */
(() => {
  const REPORT = {
    engine: "autolab-3d-creation-engine",
    model: { repository: "r2-blueprint", file: "src/vehicle.js", commit: "de1afa2" },
    measuredAt: "2026-09-04",
    units: "metres",
    selftest: { passed: 57, total: 57, gate: "passed", wheelbaseMeasured_m: 2.936, wheelbasePublished_m: 2.936 },
    summary: { withinTolerance: 5, total: 9, meanDeviation_mm: 14.19, worst: { dimension: "length_m", deviation_mm: 54 } },
    rows: [
      { dimension: "length_m", expected: 4.722, measured: 4.776, deviation_mm: 54, tolerance_mm: 10, within: false, owners: ["headlamps", "tailgate"] },
      { dimension: "widthOverBody_m", expected: 1.905, measured: 1.896, deviation_mm: -9, tolerance_mm: 10, within: true },
      { dimension: "widthOverMirrors_m", expected: 2.151, measured: 2.151, deviation_mm: 0, tolerance_mm: 10, within: true },
      { dimension: "height_m", expected: 1.699, measured: 1.7097, deviation_mm: 10.7, tolerance_mm: 10, within: false, owners: ["roofGlass"] },
      { dimension: "wheelbase_m", expected: 2.936, measured: 2.936, deviation_mm: 0, tolerance_mm: 3, within: true },
      { dimension: "frontTrack_m", expected: 1.64, measured: 1.64, deviation_mm: 0, tolerance_mm: 3, within: true },
      { dimension: "rearTrack_m", expected: 1.64, measured: 1.64, deviation_mm: 0, tolerance_mm: 3, within: true },
      { dimension: "frontOverhang_m", expected: 0.842, measured: 0.876, deviation_mm: 34, tolerance_mm: 10, within: false, owners: ["headlamps"] },
      { dimension: "rearOverhang_m", expected: 0.944, measured: 0.964, deviation_mm: 20, tolerance_mm: 10, within: false, owners: ["tailgate"] },
    ],
    extremes: {
      x: { min: { value_m: -2.432, part: "tailgate" }, max: { value_m: 2.344, part: "headlamps" } },
      y: { min: { value_m: 0, part: "wheelFL" }, max: { value_m: 1.7097, part: "roofGlass" } },
      z: { min: { value_m: -1.0755, part: "doorFL" }, max: { value_m: 1.0755, part: "doorFR" } },
    },
    basis: "Independent procedural reconstruction fitted to published dimensions and photographs; not manufacturer CAD.",
  };

  const INSTRUMENTS = [...document.querySelectorAll("#instruments tbody tr")].map((tr) => ({
    command: tr.children[0].textContent.trim(),
    question: tr.children[1].textContent.trim(),
  }));

  const noArgs = { type: "object", properties: {}, additionalProperties: false };
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const TOOLS = [
    {
      name: "get_engine_fit_report",
      title: "Read the measured fit report",
      description: "Return the AutoLab engine's latest measurement of the vehicle model against its published specification: per-dimension deviation in millimetres with tolerances, the part that owns each extreme, and the self-test gate. Includes the model commit and date it was measured.",
      inputSchema: noArgs, annotations: readOnly,
      execute: async () => REPORT,
    },
    {
      name: "list_engine_instruments",
      title: "List the engine's instruments",
      description: "Return every command the AutoLab 3D Creation Engine offers and the question each one answers.",
      inputSchema: noArgs, annotations: readOnly,
      execute: async () => ({ instruments: INSTRUMENTS, repository: "https://github.com/goodcarp/autolab/tree/main/sources/autolab-3d-creation-engine" }),
    },
  ];
  window.autolabEngine = Object.fromEntries(TOOLS.map((t) => [t.name, (a) => t.execute(a ?? {})]));

  const chip = document.getElementById("chip"), chipLabel = document.getElementById("chip-label");
  const sheet = document.getElementById("tools-sheet"), sheetBody = document.getElementById("sheet-body");
  let status = { registered: 0, via: null };
  const renderSheet = () => {
    const s = status.registered
      ? `Registered ${status.registered} tools via <code>${status.via}</code>.`
      : `No WebMCP API found on this page. The same functions are on <code>window.autolabEngine</code>.`;
    sheetBody.innerHTML = `<div class="status">${s}</div>` + TOOLS.map((t) => `<div class="tool"><b>${t.name}</b><p>${t.description}</p></div>`).join("");
  };
  async function tryRegister() {
    const api = document.modelContext || navigator.modelContext || null;
    if (!api) return false;
    try {
      if (typeof api.registerTool === "function") {
        for (const t of TOOLS) await api.registerTool(t);
        status.via = api === document.modelContext ? "document.modelContext.registerTool" : "navigator.modelContext.registerTool";
      } else if (typeof api.provideContext === "function") {
        api.provideContext({ tools: TOOLS }); status.via = "navigator.modelContext.provideContext";
      } else return false;
      status.registered = TOOLS.length;
      chip.classList.add("live"); chipLabel.textContent = `${status.registered} agent tools`; renderSheet();
      return true;
    } catch (err) { console.warn("[AutoLab] WebMCP registration failed", err); return false; }
  }
  (async () => {
    if (await tryRegister()) return;
    const started = Date.now();
    const timer = setInterval(async () => { if ((await tryRegister()) || Date.now() - started > 12000) clearInterval(timer); }, 400);
  })();
  renderSheet();
  chip.addEventListener("click", () => { const open = sheet.hidden; sheet.hidden = !open; chip.setAttribute("aria-expanded", String(open)); });
  document.getElementById("sheet-close").addEventListener("click", () => { sheet.hidden = true; chip.setAttribute("aria-expanded", "false"); });
})();
