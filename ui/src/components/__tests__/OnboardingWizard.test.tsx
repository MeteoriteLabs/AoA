/**
 * OnboardingWizard tests for Phase 1 Phase E batch 2 (T20).
 *
 * Focus:
 *  - providerToAdapter exhaustive mapping (pure unit test)
 *  - Commander step (3) Next button gating
 *  - Crew step (4) Next button gating
 *  - Final POST /companies includes commanderAdapterConfig + crewAdapterConfig
 *
 * The wizard is heavy on context; we mock every external dependency by name
 * via vi.mock() at the top of the file so the renderer doesn't try to make
 * real HTTP/router/QC calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  OnboardingWizard,
  providerToAdapter,
} from "../OnboardingWizard";
import { ToastProvider } from "../../context/ToastContext";

// ── Context + API mocks ─────────────────────────────────────────────────────
const closeOnboarding = vi.fn();
const setSelectedCompanyId = vi.fn();
const createCompany = vi.fn().mockResolvedValue({
  id: "comp-new",
  issuePrefix: "NEW",
});
const updateCompany = vi.fn().mockResolvedValue({});
const createGoal = vi.fn().mockResolvedValue({});
const mkdir = vi.fn().mockResolvedValue({});
const homePath = vi.fn().mockResolvedValue({ homePath: "/Users/test" });

vi.mock("../../context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: true,
    onboardingOptions: {},
    closeOnboarding,
  }),
}));

vi.mock("../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: null,
    companies: [],
    setSelectedCompanyId,
  }),
}));

vi.mock("../../api/companies", () => ({
  companiesApi: {
    create: (...args: unknown[]) => createCompany(...args),
    update: (...args: unknown[]) => updateCompany(...args),
  },
}));

vi.mock("../../api/goals", () => ({
  goalsApi: { create: (...args: unknown[]) => createGoal(...args) },
}));

vi.mock("../../api/agents", () => ({
  agentsApi: {
    adapterModels: vi.fn().mockResolvedValue([]),
    testEnvironment: vi.fn().mockResolvedValue({ status: "pass", checks: [], testedAt: "" }),
    create: vi.fn().mockResolvedValue({ id: "agent-1" }),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../api/issues", () => ({
  issuesApi: { create: vi.fn().mockResolvedValue({ id: "i-1", identifier: "NEW-1" }) },
}));

vi.mock("../../api/filesystem", () => ({
  filesystemApi: {
    mkdir: (...args: unknown[]) => mkdir(...args),
    home: () => homePath(),
  },
}));

vi.mock("../FolderBrowserDialog", () => ({
  FolderBrowserDialog: () => null,
}));

vi.mock("../AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => null,
}));

vi.mock("../PathInstructionsModal", () => ({
  ChoosePathButton: () => null,
}));

vi.mock("../agent-config-primitives", () => ({
  HintIcon: () => null,
}));

vi.mock("../OpenCodeLogoIcon", () => ({
  OpenCodeLogoIcon: () => null,
}));

vi.mock("../../adapters", () => ({
  getUIAdapter: () => ({
    label: "Mock",
    buildAdapterConfig: () => ({}),
  }),
}));

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <OnboardingWizard />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("providerToAdapter", () => {
  it("maps anthropic → claude_local", () => {
    expect(providerToAdapter("anthropic")).toBe("claude_local");
  });

  it("maps openai → codex_local", () => {
    expect(providerToAdapter("openai")).toBe("codex_local");
  });

  it("maps google → gemini_local", () => {
    expect(providerToAdapter("google")).toBe("gemini_local");
  });

  it("maps opencode → opencode_local", () => {
    expect(providerToAdapter("opencode")).toBe("opencode_local");
  });
});

describe("OnboardingWizard Commander + Crew steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCompany.mockResolvedValue({ id: "comp-new", issuePrefix: "NEW" });
    updateCompany.mockResolvedValue({});
    createGoal.mockResolvedValue({});
    mkdir.mockResolvedValue({});
    homePath.mockResolvedValue({ homePath: "/Users/test" });
  });

  async function advanceToCommanderStep(user: ReturnType<typeof userEvent.setup>) {
    // Step 1: enter company name + Next
    const name = screen.getByPlaceholderText(/acme corp/i);
    await user.type(name, "Test Co");
    await user.click(screen.getByTestId("step1-next"));

    // Step 2: rootFolder is auto-suggested from filesystemApi.home — click Next.
    await waitFor(() => {
      expect(screen.getByTestId("step2-next")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("step2-next"));

    // Step 3 (Commander) should now be visible.
    await waitFor(() => {
      expect(screen.getByTestId("commander-provider")).toBeInTheDocument();
    });
  }

  it("disables Commander step Next until provider AND model are set", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    const nextBtn = screen.getByTestId("step3-next");
    expect(nextBtn).toBeDisabled();

    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    // Still disabled — no model yet.
    expect(nextBtn).toBeDisabled();

    await user.type(
      screen.getByTestId("commander-model"),
      "claude-sonnet-4-6",
    );
    expect(nextBtn).not.toBeDisabled();
  });

  it("disables Crew step Next until provider AND model are set", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    await user.type(
      screen.getByTestId("commander-model"),
      "claude-sonnet-4-6",
    );
    await user.click(screen.getByTestId("step3-next"));

    // Step 4 (Crew) visible now.
    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    const nextBtn = screen.getByTestId("step4-next");
    expect(nextBtn).toBeDisabled();

    await user.selectOptions(screen.getByTestId("crew-provider"), "openai");
    expect(nextBtn).toBeDisabled();

    await user.type(screen.getByTestId("crew-model"), "gpt-5.3-codex");
    expect(nextBtn).not.toBeDisabled();
  });

  it("POSTs /companies with both commanderAdapterConfig and crewAdapterConfig on Crew step submit", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    // Pick Commander = anthropic / claude-sonnet-4-6
    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    await user.type(
      screen.getByTestId("commander-model"),
      "claude-sonnet-4-6",
    );
    await user.click(screen.getByTestId("step3-next"));

    // Pick Crew = openai / gpt-5.3-codex
    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByTestId("crew-provider"), "openai");
    await user.type(screen.getByTestId("crew-model"), "gpt-5.3-codex");
    await user.click(screen.getByTestId("step4-next"));

    await waitFor(() => {
      expect(createCompany).toHaveBeenCalledTimes(1);
    });
    const payload = createCompany.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.name).toBe("Test Co");
    expect(payload.commanderAdapterConfig).toEqual({
      adapter: "claude_local",
      model: "claude-sonnet-4-6",
    });
    expect(payload.crewAdapterConfig).toEqual({
      default: {
        adapter: "codex_local",
        model: "gpt-5.3-codex",
      },
    });
  });
});
