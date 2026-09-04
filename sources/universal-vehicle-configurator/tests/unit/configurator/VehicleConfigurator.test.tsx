import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import catalogData from "../../../src/data/catalogs/r2.catalog.json";
import type {
  BuyerContextInput,
  Catalog,
  SelectionInput,
  SelectionPatch,
} from "../../../src/domain/catalog.types";
import { resolve } from "../../../src/domain/resolve";
import { readableCompatibilityReason } from "../../../src/features/configurator/compatibility-copy";
import {
  VehicleConfigurator,
  type SelectionChangeMeta,
} from "../../../src/features/configurator/VehicleConfigurator";

const catalog = catalogData as unknown as Catalog;

afterEach(cleanup);

function ConfiguratorHarness() {
  const [selections, setSelections] = useState<SelectionInput>(() => resolve(catalog).selections);
  const [buyer, setBuyer] = useState<BuyerContextInput>({});

  const applySelection = (_patch: SelectionPatch, meta: SelectionChangeMeta) => {
    setSelections(meta.candidate.selections);
  };

  return (
    <VehicleConfigurator
      catalog={catalog}
      selections={selections}
      buyerContext={buyer}
      onSelectionPatch={applySelection}
      onBuyerContextChange={(patch) => setBuyer((current) => ({ ...current, ...patch }))}
    />
  );
}

describe("VehicleConfigurator", () => {
  it("renders every catalog family and every option as an operable input", () => {
    render(<ConfiguratorHarness />);

    for (const group of catalog.groups) {
      expect(screen.getByRole("group", { name: group.label })).toBeVisible();
    }

    const oneChoiceOptions = catalog.options.filter((option) =>
      catalog.groups.find((group) => group.id === option.group)?.select === "one"
    );
    const manyChoiceOptions = catalog.options.filter((option) =>
      catalog.groups.find((group) => group.id === option.group)?.select === "many"
    );
    expect(screen.getAllByRole("radio")).toHaveLength(oneChoiceOptions.length + 3);
    expect(screen.getAllByRole("checkbox")).toHaveLength(manyChoiceOptions.length + 2);
    expect(screen.getByRole("radio", { name: /Performance/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Orchard Beach Silver/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /21.*Liquid Tungsten/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Black Crater/i })).toBeChecked();

    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    expect(summary.previousElementSibling).toHaveClass("configurator-scroll");
  });

  it("previews price, range, timing, and compatibility before committing a choice", () => {
    render(<ConfiguratorHarness />);

    const allTerrain = screen.getByRole("radio", { name: /20.*Black Sand All-Terrain/i });
    const allTerrainCard = allTerrain.closest("label");
    expect(allTerrainCard).not.toBeNull();
    expect(within(allTerrainCard as HTMLElement).getByText("−23 mi")).toBeVisible();

    const forestGreen = screen.getByRole("radio", { name: /Forest Green/i });
    const forestGreenCard = forestGreen.closest("label");
    expect(forestGreenCard).not.toBeNull();
    expect(within(forestGreenCard as HTMLElement).getByText("Late 2026")).toBeVisible();

    const standardRwd = screen.getByRole("radio", { name: /RX2 Standard RWD, From/i });
    const standardRwdCard = standardRwd.closest("label");
    expect(standardRwdCard).not.toBeNull();
    expect(within(standardRwdCard as HTMLElement).getByText("Needs a paired change")).toBeVisible();
  });

  it("lets the buyer configure all five vehicle families and keeps the total coherent", () => {
    render(<ConfiguratorHarness />);

    fireEvent.click(screen.getByRole("radio", { name: /RX2 Premium/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Glacier White/i }));
    fireEvent.click(screen.getByRole("radio", { name: /20.*Black Sand All-Terrain/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Coastal Cloud/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /hitch \+ tow software/i }));

    expect(screen.getByRole("radio", { name: /RX2 Premium/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Glacier White/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /20.*Black Sand All-Terrain/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Coastal Cloud/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /hitch \+ tow software/i })).toBeChecked();

    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    expect(within(summary).getByText("$61,935")).toBeVisible();
    expect(within(summary).getByText("307 mi estimated range")).toBeVisible();
    expect(within(summary).getByText("Late 2026")).toBeVisible();
  });

  it("updates price, range, and delivery consequences as the buyer configures", () => {
    render(<ConfiguratorHarness />);

    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    expect(within(summary).getByText("$59,485")).toBeVisible();
    expect(within(summary).getByText("330 mi estimated range")).toBeVisible();
    expect(within(summary).getByText("Available now")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: /20.*Black Sand All-Terrain/i }));
    expect(within(summary).getByText("$60,485")).toBeVisible();
    expect(within(summary).getByText("307 mi estimated range")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: /Forest Green/i }));
    expect(within(summary).getByText("$61,485")).toBeVisible();
    expect(within(summary).getByText("Late 2026")).toBeVisible();
    expect(screen.getByText("Timing changed")).toBeVisible();
  });

  it("resolves an incompatible choice in one click instead of bouncing the buyer", () => {
    const onInvalidSelection = vi.fn();
    const onSelectionPatch = vi.fn();

    function InvalidHarness() {
      const [selections, setSelections] = useState<SelectionInput>(() => resolve(catalog).selections);
      return (
        <VehicleConfigurator
          catalog={catalog}
          selections={selections}
          onSelectionPatch={(patch, meta) => {
            onSelectionPatch(patch, meta);
            setSelections(meta.candidate.selections);
          }}
          onBuyerContextChange={() => undefined}
          onInvalidSelection={onInvalidSelection}
        />
      );
    }

    render(<InvalidHarness />);
    // Standard RWD is invalid with the default 21" wheels. The buyer should not
    // be sent back up the rail to make a second, different decision.
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Standard RWD, From/i }));

    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();
    expect(onInvalidSelection).not.toHaveBeenCalled();

    expect(screen.getByRole("radio", { name: /RX2 Standard RWD, From/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /19.*Machined Graphite/i })).toBeChecked();
    expect(screen.getByText("275 mi estimated range")).toBeVisible();

    expect(onSelectionPatch).toHaveBeenCalledWith(
      {
        set: {
          build: ["build.standard_rwd"],
          wheels: ["wheels.mg19_as"],
        },
      },
      expect.objectContaining({
        source: "compatible-alternative",
        changedGroups: ["build", "wheels"],
        primaryGroup: "build",
        companionChanges: ['19" Machined Graphite All-Season'],
      }),
    );
  });

  it("resolves against the build an external agent just set, not a stale one", () => {
    const defaults = resolve(catalog).selections;
    const onSelectionPatch = vi.fn();
    const props = {
      catalog,
      buyerContext: {},
      onSelectionPatch,
      onBuyerContextChange: vi.fn(),
    };
    const view = render(<VehicleConfigurator {...props} selections={defaults} />);

    // An agent moves the build underneath the person.
    const agentSelections = resolve(catalog, { wheels: "wheels.bs20_at" }).selections;
    view.rerender(<VehicleConfigurator {...props} selections={agentSelections} />);
    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();

    // The companion change must be computed from the agent's build.
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Standard RWD, From/i }));
    const [patch, meta] = onSelectionPatch.mock.calls.at(-1) ?? [];
    expect(patch.set.build).toEqual(["build.standard_rwd"]);
    expect(meta.candidate.valid).toBe(true);
    // All-terrain wheels are already compatible with Standard RWD, so nothing
    // else has to move. Resolving against the stale default build would have
    // forced a needless wheel swap.
    expect(meta.changedGroups).toEqual(["build"]);
    expect(meta.candidate.selections.wheels).toEqual(["wheels.bs20_at"]);
  });

  it("emits resolved selection metadata and buyer-context patches", () => {
    const onSelectionPatch = vi.fn();
    const onBuyerContextChange = vi.fn();
    const onReviewBuild = vi.fn();
    render(
      <VehicleConfigurator
        catalog={catalog}
        selections={resolve(catalog).selections}
        onSelectionPatch={onSelectionPatch}
        onBuyerContextChange={onBuyerContextChange}
        onReviewBuild={onReviewBuild}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Glacier White/i }));
    expect(onSelectionPatch).toHaveBeenCalledWith(
      { set: { paint: ["paint.glacier_white"] } },
      expect.objectContaining({
        source: "option",
        candidate: expect.objectContaining({ valid: true }),
        changedGroups: ["paint"],
        primaryGroup: "paint",
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /EV curious/i }));
    expect(onBuyerContextChange).toHaveBeenCalledWith({ evExperience: "new" });

    fireEvent.click(screen.getByRole("checkbox", { name: /Tesla Model Y/i }));
    expect(onBuyerContextChange).toHaveBeenCalledWith({ crossShopIds: ["model_y"] });

    fireEvent.click(screen.getByRole("button", { name: /Review \$59,485 RX2 build/i }));
    expect(onReviewBuild).toHaveBeenCalledWith(expect.objectContaining({
      valid: true,
      price: expect.objectContaining({ vehicleTotal: 59_485 }),
    }));
  });
});

describe("compatibility guidance wording", () => {
  it("does not tell the buyer an option pairs with the build it conflicts with", () => {
    // towing.standalone is gated by {not: {selected: build.performance}}, which
    // renders as "requires NOT(requires option 'build.performance')". Scraping
    // that string without honouring the NOT reported the blocking build as a
    // required pairing, the exact inverse of the truth.
    const negated = readableCompatibilityReason(
      {
        rule: "option.unavailable",
        severity: "error",
        message:
          "'Tow Package (hitch + tow software)' is not available with this build: requires NOT(requires option 'build.performance')",
      },
      catalog,
    );
    expect(negated).toMatch(/cannot be combined with/i);
    expect(negated).toMatch(/Performance/);
    expect(negated).not.toMatch(/pairs with/i);

    // A positive requirement still reads as a pairing.
    const positive = readableCompatibilityReason(
      {
        rule: "option.unavailable",
        severity: "error",
        message: "'19\" Machined Graphite All-Season' is not available with this build: requires option 'build.standard_rwd'",
      },
      catalog,
    );
    expect(positive).toMatch(/pairs with/i);
    expect(positive).not.toMatch(/cannot be combined/i);
  });
});
