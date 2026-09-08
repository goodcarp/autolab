/* Shared navigation and tools disclosure for the static AutoLab pages. */
(() => {
  const header = document.querySelector(".top");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-navigation");
  const closeNavigation = (restoreFocus = false) => {
    if (!toggle) return;
    header.dataset.menuOpen = "false";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    if (restoreFocus) toggle.focus();
  };
  if (header && toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      header.dataset.menuOpen = String(open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    nav.addEventListener("click", (event) => { if (event.target.closest("a")) closeNavigation(); });
    document.addEventListener("click", (event) => { if (!header.contains(event.target)) closeNavigation(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { event.preventDefault(); closeNavigation(true); }
    });
    const desktop = window.matchMedia("(min-width: 901px)");
    desktop.addEventListener("change", () => { if (desktop.matches) closeNavigation(); });
  }
  window.AutoLabUI = {
    bindToolsSheet() {
      const chip = document.getElementById("chip"), sheet = document.getElementById("tools-sheet");
      const close = document.getElementById("sheet-close");
      if (!chip || !sheet || !close) return;
      const previousInert = new Map();
      const inertBackground = (parent) => {
        for (const element of parent.children) {
          if (element === sheet || element === chip) continue;
          if (element.contains(sheet) || element.contains(chip)) {
            inertBackground(element);
          } else {
            previousInert.set(element, element.getAttribute("inert"));
            element.setAttribute("inert", "");
          }
        }
      };
      const restoreBackground = () => {
        for (const [element, value] of previousInert) {
          if (value === null) element.removeAttribute("inert");
          else element.setAttribute("inert", value);
        }
        previousInert.clear();
      };
      const setOpen = (open, restoreFocus = true) => {
        sheet.hidden = !open;
        chip.setAttribute("aria-expanded", String(open));
        document.documentElement.classList.toggle("tools-open", open);
        if (open) { closeNavigation(); inertBackground(document.body); close.focus(); }
        else { restoreBackground(); if (restoreFocus) chip.focus(); }
      };
      chip.addEventListener("click", () => setOpen(sheet.hidden));
      close.addEventListener("click", () => setOpen(false));
      document.addEventListener("click", (event) => {
        if (!sheet.hidden && !sheet.contains(event.target) && !chip.contains(event.target)) setOpen(false);
      });
      document.addEventListener("keydown", (event) => {
        if (sheet.hidden) return;
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "Tab") {
          const items = [...sheet.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length);
          const first = items[0], last = items.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
      });
    },
  };
})();

/* AutoLab by AutoMoto — landing page agent surface.
 * Publishes three WebMCP tools on document.modelContext (falling back to
 * navigator.modelContext), and mirrors them on window.autolab for any browser. */
(() => {
  if (!document.body.classList.contains("home-page")) return;
  const base = new URL("./", location.href);
  const url = (p) => new URL(p, base).href;

  const EXPERIENCES = [
    {
      id: "configure",
      title: "Web 4.0-enabled Vehicle Configurator",
      role: "sales",
      url: url("configure/"),
      tools: 18,
      summary:
        "Live 3D showroom where a person and an agent share one revisioned build. Pricing, options, incentives with sources, financing and ownership cost, presentation and camera control, plus the embedded Garage digital twin.",
      repo: "https://github.com/goodcarp/autolab/tree/main/sources/universal-vehicle-configurator",
    },
    {
      id: "garage",
      title: "Agentic Owner's Guide",
      role: "ownership",
      url: url("garage/"),
      tools: 18,
      summary:
        "General-arrangement drawing of the vehicle that opens into a 3D digital twin. Frame, highlight and measure 42 named components, six authored views, doors and panels open, body dissolves, exploded assembly, a guided tour an agent can start, narrate and interrupt, what is visible on the sheet by component, and surface-to-surface clearance.",
      repo: "https://github.com/goodcarp/autolab/tree/main/sources/r2-blueprint",
    },
    {
      id: "engine",
      title: "AutoLab 3D Creation Engine",
      role: "framework",
      url: url("engine/"),
      tools: 3,
      summary:
        "Node.js instruments that measure a code-native three.js model directly against published dimensions: fit, extremes, sections, clearances, symmetry, silhouette deviation, curve proposals, and the aperture gate. The page publishes the latest measured reports.",
      repo: "https://github.com/goodcarp/autolab/tree/main/sources/autolab-3d-creation-engine",
    },
  ];

  const OVERVIEW = {
    name: "AutoLab by AutoMoto",
    tagline: "Agent-native, web 4.0 tools for car lovers.",
    thesis:
      "One vehicle, one shared state, from configuration through ownership. Every screen publishes its tools with WebMCP so an agent can see, know and change the product the person is looking at, while the person keeps the last word.",
    howToRunWithAnAgent: [
      "ChatGPT desktop: open any AutoLab URL in the app's built-in browser and ask it to read the current build.",
      "Chrome 149+: enable chrome://flags/#enable-webmcp-testing, restart, load the page.",
      "The header chip on each page reports how many tools registered; 'Manual mode' means the API was not found.",
    ],
    repositories: {
      site: "https://github.com/goodcarp/autolab",
      configurator: "https://github.com/goodcarp/autolab/tree/main/sources/universal-vehicle-configurator",
      ownersGuide: "https://github.com/goodcarp/autolab/tree/main/sources/r2-blueprint",
      engine: "https://github.com/goodcarp/autolab/tree/main/sources/autolab-3d-creation-engine",
    },
    disclaimer:
      "Independent and unofficial; not associated with, endorsed by, or sponsored by Rivian or any manufacturer. Geometry is an independent reconstruction fitted to published dimensions, not manufacturer CAD.",
  };

  const noArgs = { type: "object", properties: {}, additionalProperties: false };
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  const TOOLS = [
    {
      name: "list_autolab_experiences",
      title: "List the AutoLab experiences",
      description:
        "Return the three AutoLab experiences (configure, garage, engine) with their URLs, roles, WebMCP tool counts, summaries and source repositories.",
      inputSchema: noArgs,
      annotations: readOnly,
      execute: async () => ({ experiences: EXPERIENCES }),
    },
    {
      name: "get_autolab_overview",
      title: "Read the AutoLab overview",
      description:
        "Return what AutoLab by AutoMoto is, how to run it with an agent, the repositories, and the independence disclaimer. Read this before opening an experience.",
      inputSchema: noArgs,
      annotations: readOnly,
      execute: async () => OVERVIEW,
    },
    {
      name: "open_autolab_experience",
      title: "Open an AutoLab experience",
      description:
        "Navigate this tab to the Configurator ('configure'), the Owner's Guide ('garage') or the Engine ('engine'). Each destination publishes its own WebMCP tools once loaded.",
      inputSchema: {
        type: "object",
        properties: {
          experience: { type: "string", enum: ["configure", "garage", "engine"], description: "Which experience to open." },
        },
        required: ["experience"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async ({ experience } = {}) => {
        const target = EXPERIENCES.find((e) => e.id === experience);
        if (!target) {
          const ids = EXPERIENCES.map((e) => e.id).join(", ");
          throw new Error(`no experience "${experience}". Call list_autolab_experiences; the ids are ${ids}.`);
        }
        setTimeout(() => location.assign(target.url), 50);
        return { ok: true, opening: target.id, url: target.url, toolsOnArrival: target.tools };
      },
    },
  ];

  // Any-browser mirror: await window.autolab.list_autolab_experiences()
  window.autolab = Object.fromEntries(TOOLS.map((t) => [t.name, (args) => t.execute(args ?? {})]));

  // ---- registration -------------------------------------------------------
  const chip = document.getElementById("chip");
  const chipLabel = document.getElementById("chip-label");
  const sheet = document.getElementById("tools-sheet");
  const sheetBody = document.getElementById("sheet-body");
  let status = { api: null, registered: 0, via: null };

  function renderSheet() {
    const rows = TOOLS.map(
      (t) => `<div class="tool"><b>${t.name}</b><p>${t.description}</p></div>`,
    ).join("");
    const s = status.registered
      ? `Registered ${status.registered} tools via <code>${status.via}</code>.`
      : `No WebMCP API found on this page (<code>document.modelContext</code> / <code>navigator.modelContext</code>). The same functions are available on <code>window.autolab</code>.`;
    sheetBody.innerHTML = `<div class="status">${s}</div>${rows}`;
  }

  function markLive() {
    chip.classList.add("live");
    chipLabel.textContent = `${status.registered} agent tools`;
    renderSheet();
  }

  async function tryRegister() {
    const api =
      (typeof document !== "undefined" && document.modelContext) ||
      (typeof navigator !== "undefined" && navigator.modelContext) ||
      null;
    if (!api) return false;
    status.api = api;
    const decl = TOOLS.map(({ name, title, description, inputSchema, annotations, execute }) => ({
      name, title, description, inputSchema, annotations, execute,
    }));
    try {
      if (typeof api.registerTool === "function") {
        for (const t of decl) await api.registerTool(t);
        status.via = api === document.modelContext ? "document.modelContext.registerTool" : "navigator.modelContext.registerTool";
      } else if (typeof api.provideContext === "function") {
        api.provideContext({ tools: decl });
        status.via = "navigator.modelContext.provideContext";
      } else {
        return false;
      }
      status.registered = decl.length;
      markLive();
      return true;
    } catch (err) {
      console.warn("[AutoLab] WebMCP registration failed", err);
      return false;
    }
  }

  (async () => {
    if (await tryRegister()) return;
    // The API can be injected shortly after load; watch for about twelve seconds.
    const started = Date.now();
    const timer = setInterval(async () => {
      if ((await tryRegister()) || Date.now() - started > 12000) clearInterval(timer);
    }, 400);
  })();

  renderSheet();
  window.AutoLabUI.bindToolsSheet();

  // ---- the tour, played in place ----------------------------------------
  // The still is a capture from the Owner's Guide; the click swaps in the live
  // sheet running its tour. Nothing 3D loads until someone asks for it.
  const demo = document.getElementById("hero-demo"), play = document.getElementById("hero-play");
  if (demo && play) {
    let pending = false, attempts = 0;
    const label = play.querySelector(".hero-demo__label");
    const launch = async () => {
      if (pending) return;
      pending = true;
      play.setAttribute("aria-busy", "true");
      play.setAttribute("aria-disabled", "true");
      play.setAttribute("aria-label", "Preparing the guided tour");
      if (label) label.textContent = "Preparing the guided tour…";
      // A fresh module URL lets a retry recover from a failed module fetch.
      const moduleUrl = ++attempts === 1 ? "./home-demo.mjs" : `./home-demo.mjs?retry=${attempts}`;
      let importDeadline;
      try {
        // Racing the download bounds this attempt and ignores a late result
        // after timeout, including while a newer retry is already loading.
        const { mountHomeDemo } = await Promise.race([
          import(moduleUrl),
          new Promise((_, reject) => {
            importDeadline = window.setTimeout(() => reject(new Error("The guided tour download timed out.")), 20_000);
          }),
        ]);
        const controller = mountHomeDemo({ demo, play, src: url("garage/?demo=1&tour=1&nodrift=1") });
        play.removeEventListener("click", launch);
        controller.start();
      } catch {
        play.setAttribute("aria-label", "Retry the guided tour");
        if (label) label.textContent = "Couldn’t load · Retry tour";
      } finally {
        window.clearTimeout(importDeadline);
        pending = false;
        play.removeAttribute("aria-busy");
        play.removeAttribute("aria-disabled");
      }
    };
    play.addEventListener("click", launch);
  }

  // ---- copyable starter prompts -----------------------------------------
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.textContent.trim());
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 900);
      } catch {
        const r = document.createRange(); r.selectNodeContents(btn);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    });
  });
})();
