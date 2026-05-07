import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SnapshotInstallModal } from "../SnapshotInstallModal";
import { ToastProvider } from "@/components/marketplace/toast/ToastProvider";
import { InstallToastSlot } from "@/components/marketplace/toast/InstallToastSlot";
import {
  CODE_REVIEW_SKILL,
  ENGINEERING_TEAM,
  GSTACK_BROWSE_SKILL,
} from "@/__tests__/__fixtures__/marketplace-catalog";
import { marketplaceApi } from "@/api/marketplace";
import { projectsApi } from "@/api/projects";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return {
    ...actual,
    marketplaceApi: {
      ...actual.marketplaceApi,
      install: vi.fn(),
      getOperation: vi.fn(),
      resolvePlan: vi.fn(),
    },
  };
});
vi.mock("@/api/projects", () => ({ projectsApi: { list: vi.fn() } }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "c1",
    companies: [{ id: "c1", name: "Acme", status: "active" }],
  }),
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          {node}
          <InstallToastSlot />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SnapshotInstallModal — skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectsApi.list).mockResolvedValue([
      { id: "d1", name: "Engineering", type: "department" },
    ] as any);
  });

  it("renders skill detail without a dept picker (skills don't require a department)", async () => {
    wrap(<SnapshotInstallModal item={CODE_REVIEW_SKILL} open onOpenChange={() => {}} />);
    expect(screen.getByText("Install Code Review")).toBeInTheDocument();
    // Wait for the component to fully settle (company auto-pick effect)
    await waitFor(() => expect(screen.getByRole("button", { name: /^Install$/ })).toBeInTheDocument());
    // Skills don't require a department — no dept picker shown
    expect(screen.queryByLabelText("Install to department")).not.toBeInTheDocument();
    // No company picker either (only 1 active company)
    expect(screen.queryByLabelText("Install to company")).not.toBeInTheDocument();
  });

  it("Install button is enabled immediately for skills (no department required)", async () => {
    wrap(<SnapshotInstallModal item={CODE_REVIEW_SKILL} open onOpenChange={() => {}} />);
    // With 1 active company auto-selected and no dept required, Install should be enabled at once
    await waitFor(() => {
      const installBtn = screen.getByRole("button", { name: /^Install$/ });
      expect(installBtn).not.toBeDisabled();
    });
  });
});

describe("SnapshotInstallModal — runtime requires banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows amber banner with human-readable labels when runtimeRequires is non-empty", async () => {
    wrap(<SnapshotInstallModal item={GSTACK_BROWSE_SKILL} open onOpenChange={() => {}} />);
    await waitFor(() => {
      const banner = screen.getByTestId("runtime-requires-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent("gstack CLI binaries");
      expect(banner).toHaveTextContent("gstack browse daemon ($B)");
    });
  });

  it("does not show banner when runtimeRequires is absent", async () => {
    wrap(<SnapshotInstallModal item={CODE_REVIEW_SKILL} open onOpenChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Install$/ })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("runtime-requires-banner")).not.toBeInTheDocument();
  });
});

describe("SnapshotInstallModal — team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectsApi.list).mockResolvedValue([
      { id: "d1", name: "Engineering", type: "department" },
    ] as any);
    vi.mocked(marketplaceApi.resolvePlan).mockResolvedValue({
      rootItem: { id: ENGINEERING_TEAM.id, name: "Engineering Team", type: "team", version: "1.0.0" },
      steps: [
        { catalogItemId: "skill:aoa-curated/code-review", itemType: "skill", name: "Code Review", version: "1.0.0", action: "install-new" },
        { catalogItemId: "agent:aoa-curated/engineer", itemType: "agent", name: "Engineer", version: "1.0.0", action: "install-new" },
        { catalogItemId: ENGINEERING_TEAM.id, itemType: "team", name: "Engineering Team", version: "1.0.0", action: "install-new" },
      ],
      conflicts: [],
    });
  });

  it("renders cascade tree for team installs", async () => {
    wrap(<SnapshotInstallModal item={ENGINEERING_TEAM} open onOpenChange={() => {}} />);
    expect(screen.getByText("Install Engineering Team")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Installing this team will also install/)).toBeInTheDocument());
    // Cascade tree shows the steps
    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
  });
});
