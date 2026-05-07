import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogCard } from "../CatalogCard";
import { SLACK_PLUGIN, CODE_REVIEW_SKILL } from "@/__tests__/__fixtures__/marketplace-catalog";
import type { PluginRecord } from "@armyofagents/shared";

// PluginInstallModal and SnapshotInstallModal are now always mounted (no mount guard)
// so they require these providers even when closed (open=false).
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "c1",
    companies: [{ id: "c1", name: "Acme", status: "active" }],
  }),
}));

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return {
    ...actual,
    marketplaceApi: { ...actual.marketplaceApi, install: vi.fn(), getOperation: vi.fn() },
  };
});

function renderWithRouter(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const INSTALLED_READY: PluginRecord = {
  id: "plugin-uuid",
  companyId: "company-uuid",
  pluginKey: "aoa.plugin-slack",
  packageName: "aoa-plugin-slack",
  version: "1.0.0",
  apiVersion: 1,
  categories: ["integrations"],
  manifestJson: {} as any,
  status: "ready",
  installOrder: 1,
  packagePath: null,
  lastError: null,
  installedAt: new Date(),
  updatedAt: new Date(),
};

const INSTALLED_LOADING: PluginRecord = { ...INSTALLED_READY, status: "loading" };

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

  it("shows green Installed badge when plugin is ready", () => {
    const map = new Map([["aoa-plugin-slack", INSTALLED_READY]]);
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} installedByPackageName={map} />);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("shows Pending badge when plugin is installed but not ready", () => {
    const map = new Map([["aoa-plugin-slack", INSTALLED_LOADING]]);
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} installedByPackageName={map} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows Install button when plugin is not installed", () => {
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} installedByPackageName={new Map()} />);
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
  });

  it("shows Install button when installedByPackageName prop is omitted", () => {
    renderWithRouter(<CatalogCard item={SLACK_PLUGIN} />);
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
  });
});
