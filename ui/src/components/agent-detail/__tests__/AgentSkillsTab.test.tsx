import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { AgentSkillsTab } from "../AgentSkillsTab";
import { agentsApi } from "../../../api/agents";
import { companySkillsApi } from "../../../api/companySkills";

vi.mock("../../../api/agents", () => ({ agentsApi: { update: vi.fn() } }));
vi.mock("../../../api/companySkills", () => ({ companySkillsApi: { list: vi.fn() } }));

const skills = [
  { id: "s-a", key: "skill-a", name: "Skill A", description: "first" },
  { id: "s-b", key: "skill-b", name: "Skill B", description: "second" },
];

const row = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(companySkillsApi.list).mockResolvedValue(skills as never);
});

describe("AgentSkillsTab — concurrency guard", () => {
  it("locks every row while a toggle is in flight so overlapping updates can't race", async () => {
    // First PATCH never resolves → the toggle stays in flight (busy).
    vi.mocked(agentsApi.update).mockReturnValue(new Promise(() => {}) as never);

    renderWithProviders(<AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} />);
    await screen.findByText("Skill A");

    // Toggle A → exactly one update fires and the tab enters the busy state.
    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(agentsApi.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(row("Skill B")).toHaveAttribute("aria-disabled", "true"));

    // While A is still saving, clicking B must NOT fire a second (racing) update.
    fireEvent.click(row("Skill B"));
    await new Promise((r) => setTimeout(r, 0));
    expect(agentsApi.update).toHaveBeenCalledTimes(1);
  });

  it("sends the full skillKeys array on toggle (attach)", async () => {
    vi.mocked(agentsApi.update).mockResolvedValue({} as never);

    renderWithProviders(<AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} />);
    await screen.findByText("Skill A");

    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(agentsApi.update).toHaveBeenCalledTimes(1));
    expect(agentsApi.update).toHaveBeenCalledWith("a1", { skillKeys: ["skill-a"] });
  });

  it("does not clobber an optimistic toggle when an unrelated refetch lands mid-save", async () => {
    // PATCH never resolves → the toggle stays in flight (busy).
    vi.mocked(agentsApi.update).mockReturnValue(new Promise(() => {}) as never);

    const { rerender } = renderWithProviders(
      <AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} />,
    );
    await screen.findByText("Skill A");

    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(row("Skill A")).toHaveAttribute("aria-pressed", "true"));

    // A parent refetch lands mid-save with a different attached set. The resync
    // guard must NOT overwrite the in-flight optimistic toggle.
    rerender(<AgentSkillsTab agentId="a1" companyId="c1" skillKeys={["skill-b"]} />);
    expect(row("Skill A")).toHaveAttribute("aria-pressed", "true");
  });

  it("resyncs from props when idle (external change to the attached set)", async () => {
    renderWithProviders(
      <AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} />,
    ).rerender(<AgentSkillsTab agentId="a1" companyId="c1" skillKeys={["skill-a"]} />);

    await waitFor(() => expect(row("Skill A")).toHaveAttribute("aria-pressed", "true"));
  });
});
