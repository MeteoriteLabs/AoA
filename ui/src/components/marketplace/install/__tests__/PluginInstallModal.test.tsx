import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PluginInstallModal } from "../PluginInstallModal";
import { ToastProvider } from "@/components/marketplace/toast/ToastProvider";
import { InstallToastSlot } from "@/components/marketplace/toast/InstallToastSlot";
import { SLACK_PLUGIN } from "@/__tests__/__fixtures__/marketplace-catalog";
import { marketplaceApi } from "@/api/marketplace";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return {
    ...actual,
    marketplaceApi: { ...actual.marketplaceApi, install: vi.fn(), getOperation: vi.fn() },
  };
});

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

describe("PluginInstallModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders capabilities + version + trust badge", () => {
    wrap(<PluginInstallModal item={SLACK_PLUGIN} open onOpenChange={() => {}} />);
    expect(screen.getByText("Install Slack")).toBeInTheDocument();
    expect(screen.getByText("companies.read")).toBeInTheDocument();
    expect(screen.getByText("issues.read")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Instance-wide")).toBeInTheDocument();
  });

  it("on Install click: closes modal + shows installing toast + POSTs install", async () => {
    vi.mocked(marketplaceApi.install).mockResolvedValueOnce({
      operationId: "op-1",
      status: "pending",
    });
    const onOpenChange = vi.fn();
    wrap(<PluginInstallModal item={SLACK_PLUGIN} open onOpenChange={onOpenChange} />);

    // The Cancel button is variant=outline; the Install button is the primary one
    const installBtn = screen.getByRole("button", { name: "Install" });
    await userEvent.click(installBtn);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(marketplaceApi.install).toHaveBeenCalledWith("c1", {
      catalogItemId: SLACK_PLUGIN.id,
    });
    await waitFor(() =>
      expect(screen.getByText(/Installing Slack/)).toBeInTheDocument(),
    );
  });

  it("on install API failure: shows failure toast", async () => {
    vi.mocked(marketplaceApi.install).mockRejectedValueOnce(
      new Error("503 Service Unavailable"),
    );
    wrap(<PluginInstallModal item={SLACK_PLUGIN} open onOpenChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to start install/)).toBeInTheDocument(),
    );
    expect(screen.getByText("503 Service Unavailable")).toBeInTheDocument();
  });
});
