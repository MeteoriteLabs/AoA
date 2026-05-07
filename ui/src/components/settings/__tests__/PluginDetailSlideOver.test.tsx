import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PluginDetailSlideOver } from "../PluginDetailSlideOver";
import type { InstalledPlugin } from "@/api/plugins";

// Hoist spy so it can be referenced both inside vi.mock and in test bodies.
const { retryActivationSpy } = vi.hoisted(() => ({
  retryActivationSpy: vi.fn(),
}));

// Mock all named exports from plugins API.
vi.mock("@/api/plugins", async () => {
  const actual = await vi.importActual<typeof import("@/api/plugins")>("@/api/plugins");
  return {
    ...actual,
    patchPluginSettings: vi.fn(),
    getPluginConfig: vi.fn().mockResolvedValue({ configJson: {} }),
    upgradePlugin: vi.fn(),
    pluginsApi: {
      ...(actual.pluginsApi ?? {}),
      retryActivation: retryActivationSpy,
    },
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

  it('calls retryActivation with the plugin id when "Retry activation" is clicked', async () => {
    retryActivationSpy.mockResolvedValue({ ok: true });

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
      expect(retryActivationSpy).toHaveBeenCalledWith("plugin-123"),
    );
  });

  it('shows retry error message when plugin is in error state and retryActivation rejects', async () => {
    retryActivationSpy.mockRejectedValue(new Error("Network error"));

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
      expect(screen.getByText("Network error")).toBeInTheDocument(),
    );
  });
});
