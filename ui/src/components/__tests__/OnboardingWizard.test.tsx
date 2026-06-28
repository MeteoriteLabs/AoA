/**
 * OnboardingWizard tests (provider-switching UI reconnect, Task 10).
 *
 * Focus:
 *  - Commander step (3) Next button gating (provider required; model optional)
 *  - Crew step (4) Next button gating (provider required; model optional)
 *  - Final create does NOT write the dead companies.*_adapter_config columns;
 *    the LIVE internal_agent_config fields are written via a config PATCH.
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
import { OnboardingWizard } from "../OnboardingWizard";
import { ToastProvider } from "../../context/ToastContext";

// ── Context + API mocks ─────────────────────────────────────────────────────
const closeOnboarding = vi.fn();
const setSelectedCompanyId = vi.fn();
const createCompany = vi.fn().mockResolvedValue({
  id: "comp-new",
  issuePrefix: "NEW",
});
const updateCompany = vi.fn().mockResolvedValue({});
const updateConfig = vi.fn().mockResolvedValue({});
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

vi.mock("../../api/internal-agent", () => ({
  internalAgentApi: {
    updateConfig: (...args: unknown[]) => updateConfig(...args),
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

describe("OnboardingWizard Commander + Crew steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCompany.mockResolvedValue({ id: "comp-new", issuePrefix: "NEW" });
    updateCompany.mockResolvedValue({});
    updateConfig.mockResolvedValue({});
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

  it("Commander step Next requires a provider; model is optional", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    const nextBtn = screen.getByTestId("step3-next");
    // Disabled with no provider chosen yet.
    expect(nextBtn).toBeDisabled();

    // Picking a provider alone (no model) enables Next — model is optional.
    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    expect(nextBtn).not.toBeDisabled();
  });

  it("Commander picker does not offer Google (cli-mode chat is claude/codex only)", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    const select = screen.getByTestId("commander-provider");
    const values = Array.from(
      select.querySelectorAll("option"),
    ).map((o) => (o as HTMLOptionElement).value);
    // "" placeholder + anthropic + openai only — no google, no opencode.
    expect(values).toEqual(["", "anthropic", "openai"]);
  });

  it("Crew step Next requires a provider; model is optional", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    await user.click(screen.getByTestId("step3-next"));

    // Step 4 (Crew) visible now.
    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    const nextBtn = screen.getByTestId("step4-next");
    expect(nextBtn).toBeDisabled();

    // Provider alone (no model) enables Next.
    await user.selectOptions(screen.getByTestId("crew-provider"), "openai");
    expect(nextBtn).not.toBeDisabled();
  });

  it("Crew picker offers all four providers (incl. Google + OpenCode)", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    await user.click(screen.getByTestId("step3-next"));

    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    const select = screen.getByTestId("crew-provider");
    const values = Array.from(
      select.querySelectorAll("option"),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["", "anthropic", "openai", "google", "opencode"]);
  });

  it("writes live config (cliTool/provider/model/crewModel) via PATCH after create", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    // Pick Commander = openai / gpt-5.5 (→ cliTool codex).
    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "openai",
    );
    await user.type(screen.getByTestId("commander-model"), "gpt-5.5");
    await user.click(screen.getByTestId("step3-next"));

    // Pick Crew = google / gemini-2.5-pro.
    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByTestId("crew-provider"), "google");
    await user.type(screen.getByTestId("crew-model"), "gemini-2.5-pro");
    await user.click(screen.getByTestId("step4-next"));

    await waitFor(() => {
      expect(createCompany).toHaveBeenCalledTimes(1);
    });

    // (a) The create payload must NOT carry the dead adapter-config columns.
    const createPayload = createCompany.mock.calls.at(-1)![0] as Record<
      string,
      unknown
    >;
    expect(createPayload.name).toBe("Test Co");
    expect(createPayload).not.toHaveProperty("commanderAdapterConfig");
    expect(createPayload).not.toHaveProperty("crewAdapterConfig");

    // (b) A config PATCH carries the LIVE fields (commander OpenAI → codex;
    //     crew Google → google).
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith(expect.any(String), {
        cliTool: "codex",
        model: "gpt-5.5",
        provider: "google",
        crewModel: "gemini-2.5-pro",
      });
    });
  });

  it("leaves model fields blank → PATCH sends null models (provider default)", async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToCommanderStep(user);

    // Commander provider only, no model.
    await user.selectOptions(
      screen.getByTestId("commander-provider"),
      "anthropic",
    );
    await user.click(screen.getByTestId("step3-next"));

    await waitFor(() => {
      expect(screen.getByTestId("crew-provider")).toBeInTheDocument();
    });
    // Crew provider only, no model.
    await user.selectOptions(screen.getByTestId("crew-provider"), "openai");
    await user.click(screen.getByTestId("step4-next"));

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith(expect.any(String), {
        cliTool: "claude_cli",
        model: null,
        provider: "openai",
        crewModel: null,
      });
    });
  });
});
