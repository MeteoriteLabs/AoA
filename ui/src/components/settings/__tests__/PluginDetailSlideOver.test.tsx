import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PluginDetailSlideOver } from "../PluginDetailSlideOver";
import type { InstalledPlugin } from "@/api/plugins";

// Mock all named exports from plugins API — retryPlugin doesn't exist yet,
// so defining it here drives the failing → passing TDD cycle.
vi.mock("@/api/plugins", async () => {
  const actual = await vi.importActual<typeof import("@/api/plugins")>("@/api/plugins");
  return {
    ...actual,
    patchPluginSettings: vi.fn(),
    getPluginConfig: vi.fn().mockResolvedValue({ configJson: {} }),
    upgradePlugin: vi.fn(),
    retryPlugin: vi.fn(),
  };
});

// CapabilityDeltaModal needs its own routing; stub it out for these unit tests.
vi.mock("../CapabilityDeltaModal", () => ({
  CapabilityDeltaModal: () => null,
}));

// PluginConfigForm may import things needing extra mocks — stub it too.
vi.mock("../PluginConfigForm", () => ({
  PluginConfigForm: () => <div data-testid="plugin-config-form" />,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "plugin-123",
    companyId: "company-1",
    catalogItemId: null,
    pluginKey: "test-plugin",
    packageName: "@test/plugin",
    version: "1.0.0",
    status: "ready",
    categories: [],
    manifest: {
      displayName: "Test Plugin",
      description: "A test plugin",
      capabilities: [],
    },
    lastError: null,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: true,
    configJson: {},
    ...overrides,
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PluginDetailSlideOver — Retry activation button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Retry activation" button when plugin.status === "error"', () => {
    const plugin = makePlugin({ status: "error" });
    wrap(
      <PluginDetailSlideOver
        companyId="company-1"
        plugin={plugin}
        pendingUpdate={undefined}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /retry activation/i }),
    ).toBeInTheDocument();
  });

  it('does NOT show "Retry activation" button when plugin.status === "ready"', () => {
    const plugin = makePlugin({ status: "ready" });
    wrap(
      <PluginDetailSlideOver
        companyId="company-1"
        plugin={plugin}
        pendingUpdate={undefined}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /retry activation/i }),
    ).not.toBeInTheDocument();
  });

  it("shows lastError message when plugin has status error and a lastError", () => {
    const plugin = makePlugin({
      status: "error",
      lastError: "Worker crashed: ECONNREFUSED",
    });
    wrap(
      <PluginDetailSlideOver
        companyId="company-1"
        plugin={plugin}
        pendingUpdate={undefined}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Worker crashed: ECONNREFUSED")).toBeInTheDocument();
  });

  it('calls retryPlugin with the plugin id when "Retry activation" is clicked', async () => {
    const { retryPlugin } = await import("@/api/plugins");
    vi.mocked(retryPlugin).mockResolvedValue({ ok: true });

    const plugin = makePlugin({ status: "error" });
    wrap(
      <PluginDetailSlideOver
        companyId="company-1"
        plugin={plugin}
        pendingUpdate={undefined}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /retry activation/i }),
    );

    await waitFor(() =>
      expect(retryPlugin).toHaveBeenCalledWith("plugin-123"),
    );
  });
});
