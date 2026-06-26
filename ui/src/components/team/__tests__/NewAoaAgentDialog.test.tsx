import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../../../context/ToastContext";
import { ToastViewport } from "../../ToastViewport";
import { NewAoaAgentDialog } from "../NewAoaAgentDialog";
import { agentsApi } from "../../../api/agents";

// ToastViewport's action/ref Link comes from @/lib/router (which calls useCompany);
// swap it for the plain react-router-dom Link so no CompanyProvider is needed.
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, Link: actual.Link };
});

vi.mock("../../../api/agents", () => ({
  agentsApi: { create: vi.fn() },
}));

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSuccess = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <NewAoaAgentDialog open onOpenChange={() => {}} companyId="company-1" onSuccess={onSuccess} />
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onSuccess };
}

describe("NewAoaAgentDialog model-correction warnings (create flow)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces server model-correction warnings as a toast on create", async () => {
    vi.mocked(agentsApi.create).mockResolvedValue({
      id: "AGENT-1",
      name: "Helper",
      warnings: ["codex model gpt-9 is unavailable; using gpt-5.5"],
    } as never);
    setup();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Agent name"), "Helper");
    await user.click(screen.getByRole("button", { name: /Create agent/ }));

    expect(await screen.findByText("Model adjusted")).toBeInTheDocument();
    expect(
      screen.getByText("codex model gpt-9 is unavailable; using gpt-5.5"),
    ).toBeInTheDocument();
  });

  it("shows the success toast but no model-correction toast when there are no warnings", async () => {
    vi.mocked(agentsApi.create).mockResolvedValue({ id: "AGENT-2", name: "Clean" } as never);
    setup();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Agent name"), "Clean");
    await user.click(screen.getByRole("button", { name: /Create agent/ }));

    expect(await screen.findByText("AoA agent created")).toBeInTheDocument();
    expect(screen.queryByText("Model adjusted")).not.toBeInTheDocument();
  });
});
