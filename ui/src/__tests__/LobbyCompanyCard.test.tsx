import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeCompany } from "./test-utils";
import { LobbyCompanyCard } from "../components/LobbyCompanyCard";
import type { CompanyStats } from "@/api/companies";

type StatEntry = CompanyStats[string];

function makeStats(overrides: Partial<StatEntry> = {}): StatEntry {
  return {
    agentCount: 0,
    issueCount: 0,
    pendingApprovalCount: 0,
    unreadNotificationCount: 0,
    ...overrides,
  };
}

describe("LobbyCompanyCard", () => {
  it("renders the company name", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany({ name: "Acme Inc" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
  });

  it("renders all four stats when stats are provided", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        stats={makeStats({
          agentCount: 5,
          issueCount: 12,
          pendingApprovalCount: 3,
          unreadNotificationCount: 7,
        })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/5 agents/i)).toBeInTheDocument();
    expect(screen.getByText(/12 tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it("uses singular forms when count is 1", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        stats={makeStats({ agentCount: 1, issueCount: 1 })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 agent$/)).toBeInTheDocument();
    expect(screen.getByText(/1 task$/)).toBeInTheDocument();
  });

  it("hides approvals + notifications stats when their counts are 0", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        stats={makeStats({
          agentCount: 2,
          issueCount: 4,
          pendingApprovalCount: 0,
          unreadNotificationCount: 0,
        })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/pending approvals/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/unread notifications/i)).not.toBeInTheDocument();
  });

  it("shows pending approvals stat when count > 0", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        stats={makeStats({ pendingApprovalCount: 3 })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/pending approvals/i)).toBeInTheDocument();
  });

  it("shows unread notifications stat when count > 0", () => {
    renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        stats={makeStats({ unreadNotificationCount: 9 })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/unread notifications/i)).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <LobbyCompanyCard company={makeCompany()} onClick={onClick} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders skeleton placeholders when statsLoading is true", () => {
    const { container } = renderWithProviders(
      <LobbyCompanyCard
        company={makeCompany()}
        statsLoading
        onClick={vi.fn()}
      />,
    );
    // Skeletons render as elements with the animate-pulse class.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("uses the bg-card/85 surface (PR-C gradient prep)", () => {
    const { container } = renderWithProviders(
      <LobbyCompanyCard company={makeCompany()} onClick={vi.fn()} />,
    );
    const button = container.querySelector("button");
    expect(button?.className).toMatch(/bg-card\/85/);
  });
});
