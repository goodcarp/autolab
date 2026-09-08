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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

    const standardRwd = screen.getByRole("radio", { name: /RX2 Standard RWD,/i });
    const standardRwdCard = standardRwd.closest("label");
    expect(standardRwdCard).not.toBeNull();
    expect(within(standardRwdCard as HTMLElement).getByText("Needs a paired change")).toBeVisible();
  });

  it("shows each option's price once without duplicating it in the impact badges", () => {
    render(<ConfiguratorHarness />);

    for (const group of catalog.groups) {
      const family = screen.getByRole("group", { name: group.label });
      const inputs = within(family).getAllByRole(group.select === "one" ? "radio" : "checkbox");
      for (const input of inputs) {
        const card = input.closest("label") as HTMLElement;
        // The existing Standard RWD description also mentions its entry price;
        // this checks the pricing UI without changing that catalog copy.
        const amounts = card.querySelector(".config-option__heading")?.textContent?.match(/\$[\d,]+/g) ?? [];
        expect(amounts.length, input.getAttribute("aria-label") ?? "option").toBeLessThanOrEqual(1);
        expect(card.querySelector(".config-option__impact")?.textContent ?? "").not.toMatch(/\$/);
      }
    }

    const paint = screen.getByRole("radio", { name: /Glacier White, Estimated \+\$1,000 vs current/i });
    expect(within(paint.closest("label") as HTMLElement).getByText("+$1,000")).toBeVisible();
    expect((paint.closest("label") as HTMLElement).querySelector(".config-option__meta")).toBeNull();
    expect(screen.queryByText("Compatible", { exact: true })).not.toBeInTheDocument();
    const wheels = screen.getByRole("radio", { name: /20.*Black Sand All-Terrain/i });
    expect(within(wheels.closest("label") as HTMLElement).getByText("−23 mi")).toBeVisible();
  });

  it("distinguishes a selected option's cost from the cost to change the current build", () => {
    render(<ConfiguratorHarness />);
    fireEvent.click(screen.getByRole("radio", { name: /Glacier White/i }));

    expect(screen.getByRole("radio", {
      name: /Glacier White, Estimated \+\$1,000 option price/i,
    })).toBeChecked();
    expect(screen.getByRole("radio", {
      name: /Rockaway Blue, Estimated No price change/i,
    })).not.toBeChecked();

    // Returning to the included color removes an estimated charge, so the
    // saving must retain that uncertainty even though Silver itself is verified.
    const silver = screen.getByRole("radio", {
      name: /Orchard Beach Silver, Estimated −\$1,000 vs current/i,
    });
    const silverCard = silver.closest("label") as HTMLElement;
    expect(within(silverCard).getByText("Est.")).toBeVisible();
    expect(within(silverCard).getByText("−$1,000")).toBeVisible();
    fireEvent.click(silver);
    expect(screen.getByRole("radio", { name: /Orchard Beach Silver, Included/i })).toBeChecked();
    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    expect(within(summary).getByText("$59,485")).toBeVisible();
  });

  it("quotes the catalog price when a choice requires companion changes", () => {
    render(<ConfiguratorHarness />);

    // Its default wheel combination is invalid, so a raw single-option delta
    // cannot promise the total after compatible wheels are selected as well.
    const standard = screen.getByRole("radio", { name: /RX2 Standard RWD, From/i });
    const card = standard.closest("label") as HTMLElement;
    expect(within(card).getByText("Needs a paired change")).toBeVisible();
    expect(within(card).queryByText("vs current")).not.toBeInTheDocument();
    expect(card.querySelector(".config-option__heading")?.textContent?.match(/\$[\d,]+/g)).toHaveLength(1);
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
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Standard RWD,/i }));

    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();
    expect(onInvalidSelection).not.toHaveBeenCalled();

    expect(screen.getByRole("radio", { name: /RX2 Standard RWD,/i })).toBeChecked();
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
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Standard RWD,/i }));
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

  it("keeps towing selected when a trim change also needs compatible wheels", () => {
    render(<ConfiguratorHarness />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Launch Package — included/i }));
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Standard RWD,/i }));
    expect(screen.getByRole("radio", { name: /RX2 Standard RWD,/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /19.*Machined Graphite/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /hitch \+ tow software/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Launch Package — included/i })).not.toBeChecked();
    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();

    // Returning to Performance must swap the package instead of losing towing.
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Performance/i }));
    expect(screen.getByRole("checkbox", { name: /Launch Package — included/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /hitch \+ tow software/i })).not.toBeChecked();
  });

  it("removes paid towing on a second click and restores its price", () => {
    render(<ConfiguratorHarness />);
    fireEvent.click(screen.getByRole("radio", { name: /RX2 Premium/i }));
    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    const priceBefore = within(summary).getByText(/\$[\d,]+/, { selector: "strong" }).textContent;
    const tow = screen.getByRole("checkbox", { name: /hitch \+ tow software/i });
    fireEvent.click(tow);
    expect(tow).toBeChecked();
    expect(within(summary).getByText(/\$[\d,]+/, { selector: "strong" }).textContent).not.toBe(priceBefore);
    fireEvent.click(tow);
    expect(tow).not.toBeChecked();
    expect(within(summary).getByText(/\$[\d,]+/, { selector: "strong" }).textContent).toBe(priceBefore);
  });

  it("shows the applicable towing package first with concise price and eligibility", () => {
    render(<ConfiguratorHarness />);
    const towing = screen.getByRole("group", { name: "Towing" });
    expect(within(towing).getAllByText("Tow package", { selector: "strong" })).toHaveLength(2);
    expect(within(towing).getAllByText("Hitch + towing software")).toHaveLength(2);
    expect(within(towing).queryByText("Needs a paired change")).not.toBeInTheDocument();
    expect(within(towing).queryByText("Explore only")).not.toBeInTheDocument();
    const included = within(towing).getAllByRole("checkbox")[0];
    expect(included).toHaveAccessibleName(/Launch Package — included.*Included/);
    expect(included).toHaveAccessibleDescription("Included with your Performance Launch Package.");
    expect(included).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /RX2 Premium/i }));
    const paid = within(towing).getAllByRole("checkbox")[0];
    expect(paid).toHaveAccessibleName(/hitch \+ tow software.*Estimated \+\$3,450/);
    expect(paid).toHaveAccessibleDescription("Availability unconfirmed.");
    expect(included).toHaveAccessibleDescription("Requires Performance with Launch Package.");
    expect(within(towing).getByText("Other builds")).toBeVisible();
  });

  it("reviews a different towing build before explicitly switching trims and packages", () => {
    render(<ConfiguratorHarness />);
    const included = screen.getByRole("checkbox", { name: /Launch Package — included/i });
    const paid = screen.getByRole("checkbox", { name: /hitch \+ tow software/i });
    const summary = screen.getByRole("contentinfo", { name: "Current build summary" });
    fireEvent.click(included);
    fireEvent.click(paid);
    expect(included).toBeChecked();
    expect(paid).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /RX2 Performance/i })).toBeChecked();
    expect(within(summary).getByText("$59,485")).toBeVisible();
    const guidance = screen.getByRole("alert", { name: "Compatibility guidance" });
    expect(within(guidance).getByText("The standalone package requires a Standard or Premium build. Availability is unconfirmed.")).toBeVisible();
    // Quote the complete change from the current build, including the package,
    // rather than only the trim delta from an invalid intermediate build.
    fireEvent.click(within(guidance).getByRole("button", { name: /Switch to Premium.*−\$550/i }));
    expect(paid).toBeChecked();
    expect(included).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /RX2 Performance/i })).not.toBeChecked();
    expect(within(summary).getByText("$58,935")).toBeVisible();
    fireEvent.click(included);
    expect(included).not.toBeChecked();
    expect(paid).toBeChecked();
    fireEvent.click(within(screen.getByRole("alert", { name: "Compatibility guidance" }))
      .getByRole("button", { name: /Switch to Performance.*\+\$550/i }));
    expect(included).toBeChecked();
    expect(paid).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /RX2 Performance/i })).toBeChecked();
    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();
  });

  it("dismisses another build's towing explanation without changing the current build", () => {
    const onSelectionPatch = vi.fn();
    render(<VehicleConfigurator catalog={catalog} selections={resolve(catalog).selections}
      onSelectionPatch={onSelectionPatch} onBuyerContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /hitch \+ tow software/i }));
    expect(onSelectionPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss compatibility guidance" }));
    expect(screen.queryByRole("alert", { name: "Compatibility guidance" })).not.toBeInTheDocument();
    expect(onSelectionPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /RX2 Performance/i })).toBeChecked();
  });

  it("exposes one mobile family at a time and retains the selection in its collapsed header", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<ConfiguratorHarness />);
    expect(screen.getByRole("button", { name: "Build options" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("radio", { name: /Glacier White/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paint options" }));
    expect(screen.getByRole("button", { name: "Build options" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("radio", { name: /Glacier White/i }));
    fireEvent.click(screen.getByRole("button", { name: "Wheels options" }));
    expect(screen.getByRole("button", { name: "Paint options" })).toHaveTextContent("Glacier White");
    expect(screen.getByRole("contentinfo", { name: "Current build summary" })).toHaveTextContent("$60,485");
  });

  it("disables review if a supplied build is invalid or there is no review handler", () => {
    const props = { catalog, onSelectionPatch: vi.fn(), onBuyerContextChange: vi.fn() };
    const view = render(<VehicleConfigurator {...props} selections={resolve(catalog).selections} />);
    expect(screen.getByRole("button", { name: /Review.*RX2 build/ })).toBeDisabled();
    view.rerender(<VehicleConfigurator {...props} onReviewBuild={vi.fn()}
      selections={{ ...resolve(catalog).selections, build: ["build.standard_rwd"] }} />);
    expect(screen.getByRole("button", { name: /Review.*RX2 build/ })).toBeDisabled();
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
