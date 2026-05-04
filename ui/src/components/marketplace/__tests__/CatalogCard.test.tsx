import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CatalogCard } from "../CatalogCard";
import { SLACK_PLUGIN, CODE_REVIEW_SKILL } from "@/__tests__/__fixtures__/marketplace-catalog";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("CatalogCard", () => {
  it("renders item name, description, version, type icon, trust badge", () => {
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} />);
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText(/Slack notifications/)).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    // CatalogCard renders TrustBadge with showLabel={false} — visible "Verified"
    // text is hidden; the verified-tier description lives in the sr-only span.
    expect(
      screen.getByText(/reviewed and signed off by aoa team/i),
    ).toBeInTheDocument();
  });

  it("links to detail page with slashes preserved (splat route)", () => {
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} />);
    const link = screen.getByRole("link");
    // SLACK_PLUGIN.id = "plugin:aoa-curated/aoa-plugin-slack"
    // detail URL: /marketplace/plugin/aoa-curated/aoa-plugin-slack
    expect(link.getAttribute("href")).toBe(
      "/marketplace/plugin/aoa-curated/aoa-plugin-slack",
    );
  });

  it("renders skill type label for skill items", () => {
    renderWithRouter(<CatalogCard item={CODE_REVIEW_SKILL} />);
    expect(screen.getByText("Skill")).toBeInTheDocument();
  });
});
