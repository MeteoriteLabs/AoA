import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentStep } from "../AgentStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

const agentsList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const agentsCreate = vi.hoisted(() => vi.fn(async () => ({ id: "a1" })));
const projectsList = vi.hoisted(() =>
  vi.fn(async () => [{ id: "d1", type: "department", name: "Engineering" }] as unknown[]),
);
const assignAgent = vi.hoisted(() => vi.fn(async () => ({})));
const getConfig = vi.hoisted(() => vi.fn(async () => ({ cliTool: "codex" })));

vi.mock("../../../api/agents", () => ({ agentsApi: { list: agentsList, create: agentsCreate } }));
vi.mock("../../../api/projects", () => ({ projectsApi: { list: projectsList, assignAgent } }));
vi.mock("../../../api/internal-agent", () => ({ internalAgentApi: { getConfig } }));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: [] })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: [
    "AUTHENTICATED",
    "PROFILE_SET",
    "ORGANIZATION_CREATED",
    "ENVIRONMENT_READY",
    "COMMANDER_SELECTED",
    "COMMANDER_VERIFIED",
    "DEPARTMENT_CREATED",
  ],
};

describe("AgentStep (Stage C / order 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsList.mockResolvedValue([]);
    agentsCreate.mockResolvedValue({ id: "a1" });
    projectsList.mockResolvedValue([{ id: "d1", type: "department", name: "Engineering" }]);
    getConfig.mockResolvedValue({ cliTool: "codex" });
  });

  it("creates an agent inheriting the Commander runtime, assigns it to the department, advances", async () => {
    const onComplete = vi.fn();
    render(<AgentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    // department preselect must resolve before create is allowed
    await waitFor(() =>
      expect((screen.getByText("Create & assign").closest("button") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("Create & assign"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // codex cliTool → codex_local adapter (inherited)
    expect(agentsCreate).toHaveBeenCalledWith("c1", expect.objectContaining({ adapterType: "codex_local" }));
    // FIX: assigned to the department at creation
    expect(assignAgent).toHaveBeenCalledWith("d1", "a1", "c1");
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "AGENT_ASSIGNED",
    });
  });

  it("is idempotent — reuses an existing same-named org agent, still assigns it", async () => {
    agentsList.mockResolvedValue([{ id: "existing", kind: "org", name: "Director" }]);
    const onComplete = vi.fn();
    render(<AgentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() =>
      expect((screen.getByText("Create & assign").closest("button") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("Create & assign"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(agentsCreate).not.toHaveBeenCalled();
    expect(assignAgent).toHaveBeenCalledWith("d1", "existing", "c1");
  });
});

describe("assembled registry includes the agent step", () => {
  it("passes the guard and registers at order 7", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
    const a = ONBOARDING_STEPS.find((s) => s.state === "AGENT_ASSIGNED");
    expect(a?.order).toBe(7);
    expect(a?.dependsOn).toEqual(["DEPARTMENT_CREATED"]);
  });
});
