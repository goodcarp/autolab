import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteNav } from "../../../src/app/SiteNav";

afterEach(cleanup);

describe("SiteNav", () => {
  it("names the four destinations with the official mark", () => {
    const { container } = render(<SiteNav />);
    expect(screen.getByRole("navigation", { name: "AutoLab" })).toBeVisible();
    expect(screen.getByRole("link", { name: "AutoLab" })).toHaveAttribute("href", "../");
    expect(screen.getByRole("link", { name: "Build" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Learn" })).toHaveAttribute("href", "../garage/");
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("href", "../engine/");
    expect(container.querySelector(".site-nav__brand img")?.getAttribute("src")).toMatch(/brand-mark\.svg$/);
  });

  it("keeps the build in place when Build is followed from this page", () => {
    const onBuild = vi.fn();
    render(<SiteNav buildIsCurrent={false} onBuild={onBuild} />);
    const build = screen.getByRole("link", { name: "Build" });
    expect(build).not.toHaveAttribute("aria-current");

    const click = createEvent.click(build);
    fireEvent(build, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onBuild).toHaveBeenCalledTimes(1);

    // A modified click still opens a fresh configurator in a new tab.
    const newTab = createEvent.click(build, { metaKey: true });
    fireEvent(build, newTab);
    expect(newTab.defaultPrevented).toBe(false);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});
