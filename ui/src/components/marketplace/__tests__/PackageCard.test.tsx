import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { MarketplacePackage } from "@armyofagents/shared";
import { PackageCard } from "../PackageCard";

function makePkg(overrides: Partial<MarketplacePackage> = {}): MarketplacePackage {
  return {
    id: "garrytan/gstack",
    name: "gstack",
    sourceUrl: "https://github.com/garrytan/gstack",
    memberItemIds: [
      "skill:github-skills/garrytan/gstack/office-hours",
      "skill:github-skills/garrytan/gstack/qa",
    ],
    count: 2,
    verified: true,
    explicit: false,
    ...overrides,
  };
}

function renderCard(pkg: MarketplacePackage) {
  return render(
    <MemoryRouter>
      <PackageCard pkg={pkg} />
    </MemoryRouter>
  );
}

describe("PackageCard", () => {
  it("renders the package name and item count pill", () => {
    renderCard(makePkg({ name: "gstack", count: 50 }));
    expect(screen.getByText("gstack")).toBeInTheDocument();
    expect(screen.getByText(/50 items/i)).toBeInTheDocument();
  });

  it("renders the PACKAGE type chip in the corner", () => {
    renderCard(makePkg());
    expect(screen.getByText("PACKAGE")).toBeInTheDocument();
  });

  it("uses StackedIcon with amber tone (3 layers)", () => {
    const { container } = renderCard(makePkg());
    expect(container.querySelectorAll('[data-stacked-layer]').length).toBe(3);
  });

  it("shows the verified-blue checkmark when pkg.verified is true", () => {
    const { container } = renderCard(makePkg({ verified: true }));
    expect(container.querySelector('[data-testid="package-verified"]')).toBeTruthy();
  });

  it("does NOT show the verified checkmark when pkg.verified is false", () => {
    const { container } = renderCard(makePkg({ verified: false }));
    expect(container.querySelector('[data-testid="package-verified"]')).toBeNull();
  });

  it("renders the github source as 'owner/repo'", () => {
    renderCard(makePkg({ sourceUrl: "https://github.com/garrytan/gstack" }));
    expect(screen.getByText("garrytan/gstack")).toBeInTheDocument();
  });

  it("renders the by-line with the owner extracted from sourceUrl", () => {
    renderCard(makePkg({ sourceUrl: "https://github.com/garrytan/gstack" }));
    expect(screen.getByText(/by garrytan/)).toBeInTheDocument();
  });

  it("links the whole card to /marketplace/package/{id}", () => {
    renderCard(makePkg({ id: "garrytan/gstack" }));
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/marketplace/package/garrytan/gstack");
  });

  it("renders an 'Install all' button on the footer", () => {
    renderCard(makePkg());
    expect(screen.getByRole("button", { name: /install all/i })).toBeInTheDocument();
  });

  it("clicking 'Install all' does not navigate (preventDefault)", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(makePkg());
    const link = container.querySelector("a") as HTMLAnchorElement;
    const linkClickSpy = vi.fn();
    link.addEventListener("click", linkClickSpy);
    await user.click(screen.getByRole("button", { name: /install all/i }));
    const lastCall = linkClickSpy.mock.calls.at(-1);
    expect(lastCall?.[0]?.defaultPrevented).toBe(true);
  });
});
