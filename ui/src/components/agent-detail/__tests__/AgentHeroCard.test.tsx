import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { Agent } from "@armyofagents/shared";
import { renderWithProviders, makeAgent } from "../../../__tests__/test-utils";
import { AgentHeroCard } from "../AgentHeroCard";

const agent = makeAgent({
  name: "Atlas",
  status: "active",
  role: "engineer",
  title: "Backend",
  adapterType: "claude_local",
}) as unknown as Agent;

describe("AgentHeroCard", () => {
  it("renders identity, status pill, and role/title", () => {
    renderWithProviders(<AgentHeroCard agent={agent} />);
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText(/Backend/)).toBeInTheDocument();
  });

  it("renders adapter/model badges", () => {
    renderWithProviders(
      <AgentHeroCard agent={agent} badges={{ adapter: "claude_local", model: "sonnet-4.6" }} />,
    );
    expect(screen.getByText("sonnet-4.6")).toBeInTheDocument();
  });

  it("renders KPI tiles; links only when `to` is set", () => {
    renderWithProviders(
      <AgentHeroCard
        agent={agent}
        kpis={[
          { key: "cost", label: "Cost", value: "$4.10", to: "/agents/atlas?tab=overview" },
          { key: "trust", label: "Trust", value: 88 },
        ]}
      />,
    );
    const cost = screen.getByTestId("hero-kpi-cost");
    expect(cost.tagName).toBe("A");
    expect(cost.getAttribute("href")).toContain("tab=overview");
    expect(screen.getByText("$4.10")).toBeInTheDocument();

    const trust = screen.getByTestId("hero-kpi-trust");
    expect(trust.tagName).not.toBe("A");
    expect(screen.getByText("88")).toBeInTheDocument();
  });

  it("renders the error line (role=alert) and the actions slot", () => {
    renderWithProviders(
      <AgentHeroCard agent={agent} error="Boom" actions={<button>Invoke</button>} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByRole("button", { name: "Invoke" })).toBeInTheDocument();
  });

  it("exposes an aria-label on the icon button when editable", () => {
    renderWithProviders(<AgentHeroCard agent={agent} onIconChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /change agent icon/i }),
    ).toBeInTheDocument();
  });

  // Codex P2: KPI deep-links must run through the unsaved-changes guard so they
  // don't navigate away (and drop a dirty draft) without the discard-confirm.
  it("routes KPI deep-link clicks through onNavigate", () => {
    const onNavigate = vi.fn().mockReturnValue(true);
    renderWithProviders(
      <AgentHeroCard
        agent={agent}
        onNavigate={onNavigate}
        kpis={[{ key: "last-run", label: "Last run", value: "1m", to: "/agents/x/runs/r1" }]}
      />,
    );
    fireEvent.click(screen.getByTestId("hero-kpi-last-run"));
    expect(onNavigate).toHaveBeenCalledWith("/agents/x/runs/r1");
  });
});
