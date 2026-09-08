import { Copy, Orbit, Share2, Sparkles, Undo2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VehicleConfigurator } from "../features/configurator";
import { BuyerContextPanel } from "../features/configurator/VehicleConfigurator";
import {
  VehicleCanvas,
  type VehicleCanvasMode,
  type VehicleHotspot,
  type VehicleHotspotId,
  type VehicleViewPreset,
} from "../features/vehicle-canvas";
import { SCENE_MANIFEST } from "../scene/scene-manifest";
import { activeVehicleModelSource, anchorsFor } from "../scene/vehicle-model-source";
import { OwnerGuide } from "../owner-guide/OwnerGuide";
import {
  ownerGuideBridge,
  type AutoLabWorkspace,
} from "../owner-guide/owner-guide-bridge";
import { AgentActivity } from "./AgentActivity";
import { IncentiveSummary } from "./IncentiveSummary";
import { ToolStatus } from "./ToolStatus";
import { ToolActivityStrip } from "./ToolActivityStrip";
import {
  applyShareStateToHistory,
  bindShareStatePopstate,
  configuratorMutations,
  configuratorStore,
  restoreShareStateFromSearch,
  r2Catalog,
  selectCanUndo,
  selectLastTransaction,
  selectResolved,
  selectRevision,
  useConfiguratorStore,
} from "../state";
import {
  configuratorPresentation,
  type RenderedBodyDescriptor,
  observeConfiguratorSiteTools,
  registerConfiguratorSiteTools,
  type ConfiguratorSiteToolsStatus,
} from "../webmcp/configurator-tools";
import "./configurator-shell.css";
import {
  formatCurrency,
  selectedOption,
  shortBuildLabel,
  vehicleInterior,
  vehiclePaint,
  vehicleWheel,
} from "./presentation";
import {
  presentationSummary,
  revealAgentPresentation,
} from "./presentation-visibility";

const INITIAL_TOOL_STATUS: ConfiguratorSiteToolsStatus = {
  state: "registering",
  toolNames: [],
};

type ChangeNotice = {
  title: string;
  detail: string;
  source: "agent" | "human";
};

export function App() {
  const catalog = useConfiguratorStore((state) => state.catalog);
  const domain = useConfiguratorStore((state) => state.domain);
  const resolved = useConfiguratorStore(selectResolved);
  const revision = useConfiguratorStore(selectRevision);
  const canUndo = useConfiguratorStore(selectCanUndo);
  const activeAgentTransaction = useConfiguratorStore(
    (state) => state.session.activeAgentTransaction,
  );
  const lastTransaction = useConfiguratorStore(selectLastTransaction);
  const [dismissedReceiptId, setDismissedReceiptId] = useState<string | null>(null);
  const [siteTools, setSiteTools] = useState<ConfiguratorSiteToolsStatus>(INITIAL_TOOL_STATUS);
  const [presentation, setPresentation] = useState(() => configuratorPresentation.getState());
  const [workspace, setWorkspace] = useState<AutoLabWorkspace>(() => ownerGuideBridge.getWorkspace());


  useEffect(() => ownerGuideBridge.observeWorkspace(setWorkspace), []);
  const [changeNotice, setChangeNotice] = useState<ChangeNotice | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [shareUrl, setShareUrl] = useState("");
  const [sharedBuild, setSharedBuild] = useState<{ revision: number; workspace: AutoLabWorkspace } | null>(null);
  const visibleShareStatus = shareStatus === "copying" || (sharedBuild?.revision === revision && sharedBuild.workspace === workspace) ? shareStatus : "idle";
  const [reviewOpen, setReviewOpen] = useState(() => Boolean(window.history.state?.autolabReview));
  const reviewRef = useRef<HTMLElement>(null);
  const reviewOpenRef = useRef(reviewOpen);
  const reviewReturnFocus = useRef<HTMLElement | null>(null);
  const currentBuildUrl = useRef(window.location.href);
  const shareTimer = useRef<number | undefined>(undefined);
  const sharePending = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingHumanPresentationRevision = useRef<number | null>(null);

  useEffect(() => {
    // Subscribe first: a host that injects the API after first paint upgrades
    // this status in place instead of leaving the page stuck in Manual mode.
    const unobserve = observeConfiguratorSiteTools(setSiteTools);
    void registerConfiguratorSiteTools();
    return unobserve;
  }, []);

  useEffect(() => configuratorPresentation.subscribe((nextPresentation) => {
    setPresentation(nextPresentation);

    if (pendingHumanPresentationRevision.current === nextPresentation.revision) {
      pendingHumanPresentationRevision.current = null;
      return;
    }

    setChangeNotice({
      title: "Agent moved the vehicle",
      detail: presentationSummary(nextPresentation),
      source: "agent",
    });
    revealAgentPresentation(viewportRef.current);
  }), []);

  useEffect(() => {
    if (window.location.search) {
      restoreShareStateFromSearch(
        r2Catalog,
        configuratorStore,
        configuratorMutations,
        window.location.search,
      );
    }
    const unbind = bindShareStatePopstate(
      r2Catalog,
      configuratorStore,
      configuratorMutations,
    );
    return unbind;
  }, []);

  useEffect(() => {
    currentBuildUrl.current = applyShareStateToHistory(catalog, configuratorStore.getState().domain, {
      mode: "replace",
    });
  }, [catalog, domain, workspace]);

  const closeReview = useCallback(() => {
    if (window.history.state?.autolabReview) window.history.back();
    else setReviewOpen(false);
  }, []);

  const openReview = () => {
    currentBuildUrl.current = window.location.href;
    reviewReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!window.history.state?.autolabReview) {
      window.history.pushState({ ...window.history.state, autolabReview: true }, "", window.location.href);
    }
    reviewOpenRef.current = true;
    setReviewOpen(true);
  };

  useEffect(() => {
    const onPopstate = (event: PopStateEvent) => {
      const opening = Boolean(event.state?.autolabReview);
      if (reviewOpenRef.current && !opening) {
        // This entry is the review's same-page origin. Preserve buyer edits
        // before the URL restore listeners run, so closing never undoes them.
        const currentUrl = new URL(currentBuildUrl.current);
        if (currentUrl.pathname === window.location.pathname) {
          // The history destination owns navigation. Only carry over build
          // edits; a stale workspace must never reroute a dismissed review.
          const destination = new URL(window.location.href);
          currentUrl.searchParams.delete("workspace");
          if (destination.searchParams.get("workspace") === "garage") currentUrl.searchParams.set("workspace", "garage");
          currentUrl.hash = destination.hash;
          window.history.replaceState(event.state, "", currentUrl);
        }
      }
      reviewOpenRef.current = opening;
      setReviewOpen(opening);
    };
    window.addEventListener("popstate", onPopstate, true);
    return () => window.removeEventListener("popstate", onPopstate, true);
  }, []);

  useEffect(() => {
    if (!reviewOpen) return;
    const sheet = reviewRef.current;
    if (!sheet) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
    )).filter((element) => !element.closest('[hidden]') && !Array.from(sheet.querySelectorAll("details:not([open])")).some(
      (details) => details.contains(element) && element !== details.querySelector("summary"),
    ));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReview();
      }
      if (event.key !== "Tab") return;
      const targets = focusable();
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!sheet.contains(event.target as Node)) focusable()[0]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", containFocus);
      reviewReturnFocus.current?.focus({ preventScroll: true });
    };
  }, [closeReview, reviewOpen]);

  useEffect(() => () => window.clearTimeout(shareTimer.current), []);

  useEffect(() => {
    if (!changeNotice) return;
    const timer = window.setTimeout(() => setChangeNotice(null), 2_800);
    return () => window.clearTimeout(timer);
  }, [changeNotice]);

  // An agent rewriting the build is the headline behaviour. Announce it in the
  // same live region the human's own edits use, so it is never silent.
  useEffect(() => {
    let seen = configuratorStore.getState().session.lastTransaction?.id ?? null;
    return configuratorStore.subscribe((state) => {
      const receipt = state.session.lastTransaction;
      if (!receipt || receipt.id === seen) return;
      seen = receipt.id;
      const applied = receipt.completedStages.length;
      const skipped = receipt.skippedStages.length;
      setChangeNotice({
        title:
          receipt.status === "interrupted"
            ? "You interrupted the agent"
            : "Agent updated the build",
        detail: [
          `${applied} of ${applied + skipped} steps applied`,
          formatCurrency(receipt.afterSummary.vehicleTotal),
          receipt.afterSummary.rangeMiles === null
            ? null
            : `${receipt.afterSummary.rangeMiles} mi`,
        ]
          .filter(Boolean)
          .join(" · "),
        source: "agent",
      });
    });
  }, []);

  const buildOption = selectedOption(catalog, resolved, "build");
  const paintOption = selectedOption(catalog, resolved, "paint");
  const wheelOption = selectedOption(catalog, resolved, "wheels");
  const interiorOption = selectedOption(catalog, resolved, "interior");
  const towingOption = selectedOption(catalog, resolved, "towing");
  const paint = vehiclePaint(paintOption);
  const wheel = vehicleWheel(wheelOption);
  const interior = vehicleInterior(interiorOption);
  const canvasMode: VehicleCanvasMode = presentation.mode;
  const viewPreset: VehicleViewPreset = presentation.viewPreset;
  const activeHotspot: VehicleHotspotId | null =
    presentation.focus === "none" ? null : presentation.focus;

  const setPresentationFromUser = useCallback((
    patch: Parameters<typeof configuratorPresentation.setFromUser>[0],
  ) => {
    const previousRevision = configuratorPresentation.getState().revision;
    pendingHumanPresentationRevision.current = previousRevision + 1;
    const nextPresentation = configuratorPresentation.setFromUser(patch);
    if (nextPresentation.revision === previousRevision) {
      pendingHumanPresentationRevision.current = null;
    }
    return nextPresentation;
  }, []);

  /**
   * Publish what the canvas is really drawing.
   *
   * Adopting a body that cannot open shuts the panels, which bumps the
   * presentation revision. Left unattributed that reads as an agent action and
   * fires the "agent moved the vehicle" notice, so it is claimed as a local
   * change first — the same mechanism the human controls use.
   */
  const [renderedBody, setRenderedBody] = useState<RenderedBodyDescriptor | null>(null);
  const describeRenderedBody = useCallback((body: RenderedBodyDescriptor) => {
    const current = configuratorPresentation.getState();
    if (!body.canOpen && current.bodyOpen) {
      pendingHumanPresentationRevision.current = current.revision + 1;
    }
    setRenderedBody(body);
    configuratorPresentation.describeBody(body);
  }, []);

  const bodySource = activeVehicleModelSource();
  // Only describe a selection as rendered once that body is on screen.
  const showingConfiguredBody = renderedBody?.representsConfiguredVehicle ?? false;
  const anchors = showingConfiguredBody ? anchorsFor(bodySource) : SCENE_MANIFEST.anchors;
  const paintPresentation = renderedBody?.id === bodySource.id
    ? `selection rendered on ${bodySource.hotspotBasis}`
    : renderedBody?.id === "unavailable" ? "vehicle preview unavailable" : "vehicle preview loading";
  const hotspots: VehicleHotspot[] = [
    {
      id: "paint",
      label: "Exterior finish",
      detail: `${paintOption?.label ?? "Representative finish"} · ${paintPresentation}`,
      anchor: anchors.bodyPaint,
      accuracy: "representative",
    },
    {
      id: "charge-port",
      label: "Charging setup",
      detail: "Home-charging setup is tracked outside vehicle MSRP.",
      anchor: anchors.chargePort,
      accuracy: "representative",
    },
    {
      id: "wheels",
      label: "Wheel package",
      detail: `${wheelOption?.label ?? "Representative wheel"} · ${wheel.diameterInches} in`,
      anchor: anchors.frontWheel,
      accuracy: "representative",
    },
    {
      id: "utility",
      label: "Rear utility",
      detail: towingOption?.label ?? "No tow package selected",
      anchor: anchors.rearHitch,
      accuracy: "representative",
    },
  ];

  const twinContext = useMemo(() => ({
    build: buildOption?.label ?? "Hudian RX2",
    paint: paintOption?.label ?? paint.label,
    wheels: wheelOption?.label ?? wheel.label,
    interior: interiorOption?.label ?? interior.label,
    rangeMiles: typeof resolved.specs.range_mi === "number" ? resolved.specs.range_mi : null,
    vehicleTotal: resolved.price.vehicleTotal,
    revision,
  }), [
    buildOption?.label,
    interior.label,
    interiorOption?.label,
    paint.label,
    paintOption?.label,
    resolved.price.vehicleTotal,
    resolved.specs.range_mi,
    revision,
    wheel.label,
    wheelOption?.label,
  ]);

  const handleShare = async () => {
    if (sharePending.current) return;
    sharePending.current = true;
    window.clearTimeout(shareTimer.current);
    const url = applyShareStateToHistory(catalog, configuratorStore.getState().domain, {
      mode: "replace",
    });
    setShareUrl(url);
    setSharedBuild({ revision, workspace });
    setShareStatus("copying");
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      shareTimer.current = window.setTimeout(() => setShareStatus("idle"), 2_800);
    } catch {
      setShareStatus("failed");
    } finally {
      sharePending.current = false;
    }
  };

  const handleUndo = () => {
    const result = configuratorMutations.undoLastAgentTransaction({
      expectedRevision: configuratorStore.getState().domain.revision,
    });
    if (result.ok) {
      setChangeNotice({
        title: "Agent changes undone",
        detail: `Restored configuration · revision ${result.revision}`,
        source: "human",
      });
    }
  };

  return (
    <main className="configurator-shell" data-workspace={workspace}>
      <header className="configurator-header" inert={reviewOpen}>
        <a className="configurator-header__brand" href="../" aria-label="AutoLab home">
          <span className="configurator-header__mark" aria-hidden="true">A</span>
          <span className="configurator-header__wordmark">
            <strong>AutoLab</strong>
            <small>by AutoMoto</small>
          </span>
        </a>

        <div className="configurator-header__center">
          <nav className="lifecycle-switch" aria-label="Vehicle lifecycle">
            <button
              type="button"
              aria-pressed={workspace === "configure"}
              onClick={() => ownerGuideBridge.setWorkspace("configure")}
            >
              <Orbit aria-hidden="true" /> Shop
            </button>
            <button
              type="button"
              aria-pressed={workspace === "garage"}
              onClick={() => ownerGuideBridge.setWorkspace("garage")}
            >
              <Wrench aria-hidden="true" /> My Car
            </button>
          </nav>
          <div className="configurator-header__model">
            <span>RX2 / {workspace === "configure" ? "Build" : "Digital twin"}</span>
            <strong>{shortBuildLabel(buildOption)}</strong>
            <span>Rev {revision}</span>
          </div>
        </div>

        <div className="configurator-header__actions">
          {activeAgentTransaction && (
            <span className="header-action" data-state="ready">
              <Sparkles aria-hidden="true" />
              <span>
                Agent configuring {activeAgentTransaction.completedCount}/{activeAgentTransaction.stageCount}
              </span>
            </span>
          )}
          {canUndo && (
            <button className="header-action" type="button" onClick={handleUndo} aria-label="Undo agent changes">
              <Undo2 aria-hidden="true" /> <span>Undo agent</span>
            </button>
          )}
          <button className="header-action" type="button" onClick={() => void handleShare()}
            aria-label={visibleShareStatus === "copied" ? "Link copied" : "Share build"} disabled={visibleShareStatus === "copying"}>
            {visibleShareStatus === "copied" ? <Copy aria-hidden="true" /> : <Share2 aria-hidden="true" />}
            <span>{visibleShareStatus === "copied" ? "Link copied" : "Share"}</span>
          </button>
          <ToolStatus status={siteTools} />
        </div>
      </header>

      <ToolActivityStrip />

      {visibleShareStatus === "failed" && !reviewOpen && (
        <div className="share-fallback" role="status">
          <label>Copy this build link<input aria-label="Build link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></label>
          <button type="button" aria-label="Dismiss build link" onClick={() => setShareStatus("idle")}><X aria-hidden="true" /></button>
        </div>
      )}
      <span className="visually-hidden" role="status">{visibleShareStatus === "copied" ? "Build link copied" : visibleShareStatus === "failed" ? "Copy unavailable. Select the build link to copy it manually." : ""}</span>

      <div className="autolab-surfaces" inert={reviewOpen}>
        <section
          className="configurator-workspace"
          data-active={workspace === "configure" || undefined}
          aria-label="Vehicle configuration workspace"
          aria-hidden={workspace !== "configure"}
        >
        <div
          className="configurator-viewport"
          data-has-focus-card={activeHotspot || undefined}
          ref={viewportRef}
        >
          <VehicleCanvas
            paint={paint}
            wheel={wheel}
            interior={interior}
            headerAside={
              <div className="configuration-facts" aria-label="Current vehicle total">
                <small>Vehicle total</small>
                <strong aria-live="polite" aria-atomic="true">{formatCurrency(resolved.price.vehicleTotal)}</strong>
              </div>
            }
            accessories={{ towHitch: Boolean(resolved.specs.tow_hitch) }}
            mode={canvasMode}
            viewPreset={viewPreset}
            bodyOpen={presentation.bodyOpen}
            onBodyOpenChange={(nextBodyOpen) =>
              setPresentationFromUser({ bodyOpen: nextBodyOpen })}
            onRenderedBodyChange={describeRenderedBody}
            activeHotspotId={activeHotspot}
            hotspots={hotspots}
            onModeChange={(mode) => setPresentationFromUser({ mode })}
            onViewPresetChange={(nextViewPreset) =>
              setPresentationFromUser({ viewPreset: nextViewPreset })
            }
            onHotspotChange={(hotspot) =>
              setPresentationFromUser({ focus: hotspot ?? "none" })
            }
          />

        </div>

        <aside className="configurator-rail" aria-label="Configuration choices">
          <div className="configurator-rail__inner">
            {(changeNotice || (lastTransaction && lastTransaction.id !== dismissedReceiptId)) && (
              <div className="rail-activity">
                {changeNotice && (
                  <aside
                    className="configuration-change"
                    data-source={changeNotice.source}
                    aria-live="polite"
                  >
                    <Sparkles aria-hidden="true" />
                    <div>
                      <strong>{changeNotice.title}</strong>
                      <span>{changeNotice.detail}</span>
                    </div>
                    <button type="button" onClick={() => setChangeNotice(null)} aria-label="Dismiss change summary">
                      <X aria-hidden="true" />
                    </button>
                  </aside>
                )}
                {lastTransaction && lastTransaction.id !== dismissedReceiptId && (
                  <AgentActivity
                    receipt={lastTransaction}
                    canUndo={canUndo}
                    onUndo={handleUndo}
                    onDismiss={() => setDismissedReceiptId(lastTransaction.id)}
                  />
                )}
              </div>
            )}
            <VehicleConfigurator
              catalog={catalog}
              selections={domain.selections}
              buyerContext={domain.buyerContext}
              onSelectionPatch={(patch, meta) => {
                const before = configuratorStore.getState().resolved;
                const result = configuratorMutations.applyHumanPatch({
                  expectedRevision: configuratorStore.getState().domain.revision,
                  patch,
                });
                if (!result.ok) return;

                const changedGroup = meta.primaryGroup;
                const nextId = patch.set[changedGroup]?.[0];
                const nextOption = catalog.options.find((option) => option.id === nextId);
                const beforeRange = typeof before.specs.range_mi === "number" ? before.specs.range_mi : null;
                const nextRange = typeof meta.candidate.specs.range_mi === "number"
                  ? meta.candidate.specs.range_mi
                  : null;
                const priceDelta = meta.candidate.price.vehicleTotal - before.price.vehicleTotal;
                const detail = [
                  priceDelta === 0 ? null : `${priceDelta > 0 ? "+" : "−"}${formatCurrency(Math.abs(priceDelta))}`,
                  beforeRange !== null && nextRange !== null && beforeRange !== nextRange
                    ? `${nextRange - beforeRange > 0 ? "+" : ""}${nextRange - beforeRange} mi`
                    : null,
                  meta.candidate.delivery?.window ?? null,
                ].filter(Boolean).join(" · ");

                // Say what else had to move so an auto-resolved pick is never a
                // silent surprise.
                const companions = meta.companionChanges ?? [];
                const detailWithCompanions = [
                  detail || null,
                  companions.length > 0 ? `also switched ${companions.join(" and ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");

                setChangeNotice({
                  title: nextOption?.label ?? "Configuration updated",
                  detail: detailWithCompanions || "Applied to the current build",
                  source: "human",
                });

                // The camera belongs to whoever is driving. Selecting a colour
                // or an interior used to yank the view, which made the viewer
                // feel broken; only the person and the agent move it now.
              }}
              onBuyerContextChange={(patch) => {
                configuratorMutations.setBuyerContext({
                  expectedRevision: configuratorStore.getState().domain.revision,
                  patch,
                  source: "human",
                });
              }}
              onReviewBuild={openReview}
              onViewVehicle={() => {
                viewportRef.current?.scrollIntoView({
                  behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                  block: "start",
                });
              }}
            />
          </div>
        </aside>
        </section>

        {/*
          The visible notice lives in the Configure rail, which Garage hides —
          so a build change made by an agent while the person is in the Garage
          was announced to nobody. This announcer sits outside that subtree and
          always speaks.
        */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {changeNotice ? `${changeNotice.title}. ${changeNotice.detail}` : ""}
        </p>

        <OwnerGuide active={workspace === "garage"} context={twinContext} />
      </div>

      {reviewOpen && (
        <div className="review-layer">
          <button
            className="review-layer__scrim"
            type="button"
            aria-label="Close build review"
            tabIndex={-1}
            onClick={closeReview}
          />
          <aside className="review-sheet" ref={reviewRef} role="dialog" aria-modal="true" aria-labelledby="review-title">
            <header>
              <div>
                <span>Configuration / Rev {revision}</span>
                <h2 id="review-title">Review your RX2</h2>
              </div>
              <button type="button" onClick={closeReview} aria-label="Close build review">
                <X aria-hidden="true" />
              </button>
            </header>

            <div className="review-sheet__body">
            <div className="review-sheet__specs">
              <span><strong>{String(resolved.specs.range_mi ?? "—")} mi</strong><small>Est. range</small></span>
              <span><strong>{resolved.delivery?.window ?? "TBD"}</strong><small>Delivery</small></span>
              <span><strong>{formatCurrency(resolved.price.vehicleTotal)}</strong><small>Vehicle total</small></span>
            </div>

            <div className="review-sheet__choices">
              {catalog.groups.map((group) => {
                const options = catalog.options.filter(
                  (option) => option.group === group.id && resolved.selectedOptionIds.includes(option.id),
                );
                return (
                  <div key={group.id}>
                    <span>{group.label}</span>
                    <strong>{options.length > 0 ? options.map((option) => option.label).join(", ") : "None"}</strong>
                  </div>
                );
              })}
            </div>

            <div className="review-sheet__math">
              <span><small>Base MSRP</small><strong>{formatCurrency(resolved.price.baseMSRP)}</strong></span>
              <span><small>Vehicle options</small><strong>{formatCurrency(resolved.price.vehicleOptions)}</strong></span>
              <span><small>Destination</small><strong>{formatCurrency(resolved.price.destination)}</strong></span>
              <span className="review-sheet__total"><small>Vehicle total</small><strong>{formatCurrency(resolved.price.vehicleTotal)}</strong></span>
              {resolved.price.ownershipSetup > 0 && (
                <span><small>Separate home setup</small><strong>{formatCurrency(resolved.price.ownershipSetup)}</strong></span>
              )}
            </div>

            <details className="buyer-disclosure review-sheet__buyer">
              <summary>Buyer details</summary>
              <BuyerContextPanel result={resolved} instanceId="review-buyer" onChange={(patch) => {
                configuratorMutations.setBuyerContext({
                  expectedRevision: configuratorStore.getState().domain.revision, patch, source: "human",
                });
              }} />
            </details>
            <IncentiveSummary catalog={catalog} incentives={resolved.incentives} />

            <div className="review-sheet__notes">
              <p>Independent buyer-side estimate. Verify pricing, availability, taxes, and eligibility with the seller.</p>
              {catalog.product.disclaimer && (
                <p className="review-sheet__disclaimer">{catalog.product.disclaimer}</p>
              )}
            </div>
            </div>
            <footer>
              {visibleShareStatus === "failed" && <label className="review-sheet__share-link">Copy this build link<input aria-label="Build link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></label>}
              <button type="button" onClick={() => void handleShare()} disabled={visibleShareStatus === "copying"}>
                <Share2 aria-hidden="true" /> {visibleShareStatus === "copied" ? "Build link copied" : visibleShareStatus === "copying" ? "Copying link…" : "Copy build link"}
              </button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
