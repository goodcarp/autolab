/* AutoLab 3D Creation Engine — page agent surface.
 * Three read-only WebMCP tools exposing the latest measured reports for the model
 * both AutoLab experiences render (the aperture report is read from out/apertures.json,
 * written by build.sh from the engine on every assembly). The numbers are a snapshot of `npm run fit`
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

  // ---- the measured report, as assembled ---------------------------------
  // build.sh runs `fit --json` and `selftest` and writes out/fit.json beside the
  // section drawings. The page and the tool read that; REPORT above is only the
  // fallback if the file is missing.
  let live = null;
  const fmt = (n, d = 3) => (n === null || n === undefined ? "—" : String(Math.round(n * 10 ** d) / 10 ** d));
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  function renderFit(fit) {
    const table = document.getElementById("fit-table"), kicker = document.getElementById("fit-kicker");
    const line = document.getElementById("selftest-line"), wb = document.getElementById("selftest-wheelbase"), story = document.getElementById("fit-story");
    const pad = (t, w) => String(t).padEnd(w);
    const rows = fit.rows.map((r) => {
      const dev = r.deviation_mm === null || r.deviation_mm === undefined ? "—" : `${r.deviation_mm > 0 ? "+" : ""}${fmt(r.deviation_mm, 1)}mm`;
      const text = `${r.status === "out" ? "!" : " "}${pad(r.dimension, 21)}${pad(fmt(r.expected_m), 11)}${pad(fmt(r.measured_m), 11)}${pad(dev, 10)}±${fmt(r.tolerance_mm, 1)}mm`;
      return r.status === "out" ? `<span class="miss">${esc(text)}</span>` : esc(text);
    });
    const s = fit.summary;
    const worst = s.worst ? ` (${s.worst.dimension ?? s.worst})` : "";
    const summary = `${s.within}/${s.compared} within tolerance · mean ${fmt(s.meanDeviation_mm, 2)}mm · worst ${fmt(s.worstDeviation_mm, 1)}mm${worst}`;
    const ext = Object.entries(fit.extremes || {}).map(([axis, v]) => `  ${axis}  ${pad(`min ${fmt(v.min.value_m)} m  ${v.min.part}`, 40)}max ${fmt(v.max.value_m)} m  ${v.max.part}`);
    if (table) table.innerHTML = `<code>${esc(pad("dimension", 22) + pad("expected", 11) + pad("measured", 11) + pad("dev", 10) + "tol")}\n${"-".repeat(62)}\n${rows.join("\n")}\n${"-".repeat(62)}\n${esc(summary)}\n\nextremes, so an out-of-tolerance row names a part:\n${esc(ext.join("\n"))}</code>`;
    if (kicker) kicker.textContent = `npm run fit · measured against ${fit.spec} · model r2-blueprint ${fit.model?.commit ?? ""} · assembled ${(fit.measuredAt || "").slice(0, 10)}`;
    if (line && fit.selftest?.passed) line.textContent = `${fit.selftest.passed}/${fit.selftest.total} passed · gate ${fit.selftest.gate}`;
    const wbRow = fit.rows.find((r) => r.dimension === "wheelbase_m");
    if (wb && wbRow) wb.textContent = `measured ${fmt(wbRow.measured_m)} m against ${fmt(wbRow.expected_m)} m`;
    if (story) {
      const out = fit.rows.filter((r) => r.status === "out");
      story.textContent = out.length
        ? `${s.within} of ${s.compared} published dimensions are within tolerance on this assembly (mean deviation ${fmt(s.meanDeviation_mm, 2)} mm). Out: ${out.map((r) => `${r.dimension} by ${fmt(r.deviation_mm, 1)} mm`).join(", ")}. The extremes below name the part that owns each end of the envelope, so a miss has an owner, not a mystery. Read from out/fit.json, written when the site was assembled.`
        : `All ${s.compared} published dimensions are within tolerance on this assembly: mean deviation ${fmt(s.meanDeviation_mm, 2)} mm, worst ${fmt(s.worstDeviation_mm, 1)} mm. The extremes below still name the part that owns each end of the envelope. Read from out/fit.json, written when the site was assembled.`;
    }
  }
  function liveReport() {
    if (!live) return REPORT;
    return {
      engine: REPORT.engine, model: live.model, measuredAt: live.measuredAt, units: "metres", spec: live.spec,
      selftest: { passed: live.selftest?.passed, total: live.selftest?.total, gate: live.selftest?.gate },
      summary: { withinTolerance: live.summary.within, total: live.summary.compared, meanDeviation_mm: live.summary.meanDeviation_mm, worstDeviation_mm: live.summary.worstDeviation_mm },
      rows: live.rows.map((r) => ({ dimension: r.dimension, expected: r.expected_m, measured: r.measured_m, deviation_mm: r.deviation_mm, tolerance_mm: r.tolerance_mm, within: r.status === "within", measuredFrom: r.measuredFrom })),
      extremes: live.extremes, basis: REPORT.basis,
    };
  }
  function renderApertures(rep) {
    const body = document.querySelector("#apertures tbody"); if (!body || !rep?.apertures) return;
    const rows = rep.apertures.map((a) => {
      const survivors = Object.values(a.poses.flatMap((p) => p.offenders).reduce((m, o) => { if (!m[o.part] || (o.inset_mm ?? 0) > (m[o.part].inset_mm ?? 0)) m[o.part] = o; return m; }, {}));
      const edge = [...new Set(a.poses.flatMap((p) => p.edgeContacts))].sort();
      const cls = a.status === "FAIL" ? "miss" : a.status === "INFO" ? "info" : "";
      return `<tr><td><code>${esc(a.aperture)}</code></td><td class="${cls}">${esc(a.status)}${a.gated === false ? " (lid, not judged)" : ""}</td><td>${survivors.length ? survivors.map((o) => `${esc(o.part)} ${fmt(o.inset_mm, 0)} / ${o.intrusionDepth_mm === null ? "?" : fmt(o.intrusionDepth_mm, 0)}`).join("; ") : "none"}</td><td>${edge.length ? esc(edge.join(", ")) : "none"}</td></tr>`;
    });
    body.innerHTML = rows.join("");
    const summary = document.getElementById("aperture-summary");
    if (summary) {
      const failing = rep.apertures.filter((a) => a.status === "FAIL");
      const named = failing.flatMap((a) => Object.values(a.poses.flatMap((p) => p.offenders).reduce((m, o) => { if (!m[o.part] || (o.inset_mm ?? 0) > (m[o.part].inset_mm ?? 0)) m[o.part] = o; return m; }, {})).map((o) => `${o.part} ${fmt(o.inset_mm, 0)} mm inside the ${a.aperture} outline`));
      summary.innerHTML = `On this assembly the gate (band ${rep.band_mm} mm behind the skin, edge margin ${rep.edge_mm} mm) ${failing.length ? `names ${failing.length} of ${rep.apertures.filter((a) => a.gated !== false).length} gated openings for the author to judge: ${esc(named.join("; "))}.` : "passes every gated opening."} Everything else that meets an opening does so within the edge margin. The full report is <a href="out/apertures.json">out/apertures.json</a>, and an agent can read it with <code>get_aperture_report</code>.`;
    }
  }
  fetch(new URL("out/apertures.json", location.href)).then((r) => (r.ok ? r.json() : null)).then((rep) => { if (rep) renderApertures(rep); }).catch(() => {});
  const fitReady = fetch(new URL("out/fit.json", location.href)).then((r) => (r.ok ? r.json() : null)).then((fit) => { if (fit && fit.rows) { live = fit; renderFit(fit); } }).catch(() => {});

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
      description: "Return the AutoLab engine's measurement of the vehicle model against its published specification, as taken when this site was assembled: per-dimension deviation in millimetres with tolerances, the part that owns each extreme, and the self-test gate. Includes the model commit and the assembly time.",
      inputSchema: noArgs, annotations: readOnly,
      execute: async () => { await fitReady; return liveReport(); },
    },
    {
      name: "list_engine_instruments",
      title: "List the engine's instruments",
      description: "Return every command the AutoLab 3D Creation Engine offers and the question each one answers.",
      inputSchema: noArgs, annotations: readOnly,
      execute: async () => ({ instruments: INSTRUMENTS, repository: "https://github.com/goodcarp/autolab/tree/main/sources/autolab-3d-creation-engine" }),
    },
  ];
  TOOLS.push({
    name: "get_aperture_report",
    title: "Read the aperture gate report",
    description: "Return the engine's aperture gate for the model: for each door, hood, liftgate and lid opening, whether any fixed geometry sits at the skin and well inside the opening at four open fractions, naming the part, how far inside the opening (mm) and how deep behind the skin (mm), plus the parts that merely touch the opening's edge. Read out/apertures.json as assembled by build.sh; PASS, FAIL or INFO per opening.",
    inputSchema: noArgs, annotations: readOnly,
    execute: async () => {
      const response = await fetch(new URL("out/apertures.json", location.href));
      if (!response.ok) throw new Error(`aperture report unavailable (${response.status}). Run node src/cli.mjs apertures in the engine.`);
      const report = await response.json();
      return {
        status: report.status, gate: report.gate, band_mm: report.band_mm, edge_mm: report.edge_mm, openFractions: report.openFractions,
        openings: report.apertures.map((a) => ({
          aperture: a.aperture, status: a.status, gated: a.gated, footprintArea_m2: a.footprintArea_m2,
          survivors: Object.values(a.poses.flatMap((p) => p.offenders).reduce((m, o) => { const k = o.part; if (!m[k] || (o.inset_mm ?? 0) > (m[k].inset_mm ?? 0)) m[k] = { part: o.part, inset_mm: o.inset_mm, depth_mm: o.intrusionDepth_mm, at_m: o.at_m }; return m; }, {})),
          edgeContacts: [...new Set(a.poses.flatMap((p) => p.edgeContacts))].sort(),
        })),
        model: report.model, basis: REPORT.basis,
      };
    },
  });
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
