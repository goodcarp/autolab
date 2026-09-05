import { Copy, Orbit, Share2, Sparkles, Undo2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VehicleConfigurator } from "../features/configurator";
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
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [reviewOpen, setReviewOpen] = useState(false);
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
    applyShareStateToHistory(catalog, configuratorStore.getState().domain, {
      mode: "replace",
    });
  }, [catalog, domain]);

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
  // Hotspots are markers on a picture, so they follow the picture. On the
  // authored still they would otherwise sit at the R2's coordinates, on a
  // differently shaped car, describing a body that is not being drawn.
  const showingConfiguredBody = renderedBody?.representsConfiguredVehicle ?? false;
  const anchors = showingConfiguredBody ? anchorsFor(bodySource) : SCENE_MANIFEST.anchors;
  const hotspotBasis = showingConfiguredBody
    ? bodySource.hotspotBasis
    : "the authored still of the licensed reference vehicle";
  const hotspots: VehicleHotspot[] = [
    {
      id: "paint",
      label: "Exterior finish",
      detail: `${paintOption?.label ?? "Representative finish"} · selection rendered on ${hotspotBasis}`,
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
    const url = applyShareStateToHistory(catalog, configuratorStore.getState().domain, {
      mode: "replace",
    });
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 1_800);
    } catch {
      window.history.replaceState(null, "", url);
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
      <header className="configurator-header">
        <a className="configurator-header__brand" href="/" aria-label="AutoLab home">
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
              <Orbit aria-hidden="true" /> Configure
            </button>
            <button
              type="button"
              aria-pressed={workspace === "garage"}
              onClick={() => ownerGuideBridge.setWorkspace("garage")}
            >
              <Wrench aria-hidden="true" /> Garage
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
            <button className="header-action" type="button" onClick={handleUndo}>
              <Undo2 aria-hidden="true" /> <span>Undo agent</span>
            </button>
          )}
          <button className="header-action" type="button" onClick={() => void handleShare()}>
            {shareStatus === "copied" ? <Copy aria-hidden="true" /> : <Share2 aria-hidden="true" />}
            <span>{shareStatus === "copied" ? "Link copied" : "Share"}</span>
          </button>
          <ToolStatus status={siteTools} />
        </div>
      </header>

      <ToolActivityStrip />

      <div className="autolab-surfaces">
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

          <div className="configuration-facts" aria-label="Current configuration quick facts">
            <span><small>Vehicle total</small><strong>{formatCurrency(resolved.price.vehicleTotal)}</strong></span>
            <span><small>Range</small><strong>{String(resolved.specs.range_mi ?? "—")} mi</strong></span>
            <span><small>Interior</small><strong>{interiorOption?.label ?? "—"}</strong></span>
          </div>
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
              onReviewBuild={() => setReviewOpen(true)}
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
            onClick={() => setReviewOpen(false)}
          />
          <aside className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <header>
              <div>
                <span>Configuration / Rev {revision}</span>
                <h2 id="review-title">Review your RX2</h2>
              </div>
              <button type="button" onClick={() => setReviewOpen(false)} aria-label="Close build review">
                <X aria-hidden="true" />
              </button>
            </header>

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

            <IncentiveSummary catalog={catalog} incentives={resolved.incentives} />

            <footer>
              <p>Independent buyer-side estimate. Verify pricing, availability, taxes, and eligibility with the seller.</p>
              {catalog.product.disclaimer && (
                <p className="review-sheet__disclaimer">{catalog.product.disclaimer}</p>
              )}
              <button type="button" onClick={() => void handleShare()}>
                <Share2 aria-hidden="true" /> {shareStatus === "copied" ? "Build link copied" : "Copy build link"}
              </button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
