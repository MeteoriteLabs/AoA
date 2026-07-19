import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InFlightFlow } from "../InFlightFlow";

const projectsList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("../../../api/projects", () => ({
  projectsApi: { list: projectsList },
}));

const agentsList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("../../../api/agents", () => ({
  agentsApi: { list: agentsList },
}));

const setFirstRunCompleted = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../api/onboarding", () => ({ setFirstRunCompleted }));

// Stub every In-flight surface with a minimal, identifiable stand-in that
// exposes an onDone button — keeps this a pure sequencer test (each surface
// already has its own unit tests).
vi.mock("../DefineDepartments", () => ({
  DefineDepartments: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-departments</button>
  ),
}));
vi.mock("../IntegrationsStep", () => ({
  IntegrationsStep: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-integrations</button>
  ),
}));
vi.mock("../BraindumpStep", () => ({
  BraindumpStep: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-braindump</button>
  ),
}));
vi.mock("../LibrarianStep", () => ({
  LibrarianStep: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-librarian</button>
  ),
}));
vi.mock("../CreateAgents", () => ({
  CreateAgents: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-agents</button>
  ),
}));
vi.mock("../FirstJobStep", () => ({
  FirstJobStep: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-first-job</button>
  ),
}));

describe("InFlightFlow (WS9 — In-flight sequencer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectsList.mockResolvedValue([]);
    agentsList.mockResolvedValue([]);
    setFirstRunCompleted.mockResolvedValue(undefined);
  });

  it("advances through every surface in order on each onDone, then calls setFirstRunCompleted and the parent onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<InFlightFlow companyId="co-1" onDone={onDone} />);

    const order = [
      "finish-departments",
      "finish-integrations",
      "finish-braindump",
      "finish-librarian",
      "finish-agents",
      "finish-first-job",
    ];

    for (const label of order) {
      const button = await screen.findByText(label);
      await user.click(button);
    }

    await waitFor(() => expect(setFirstRunCompleted).toHaveBeenCalledWith("co-1"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // setFirstRunCompleted must resolve BEFORE the parent onDone fires.
    expect(setFirstRunCompleted.mock.invocationCallOrder[0]!).toBeLessThan(onDone.mock.invocationCallOrder[0]!);
  });

  it("resumes past Departments when the company already has a department", async () => {
    projectsList.mockResolvedValue([{ id: "p1", type: "department", name: "Software" }]);
    render(<InFlightFlow companyId="co-1" onDone={vi.fn()} />);

    expect(await screen.findByText("finish-integrations")).toBeInTheDocument();
    expect(screen.queryByText("finish-departments")).toBeNull();
  });

  it("resumes to First-job when the company already has a department AND an org agent", async () => {
    projectsList.mockResolvedValue([{ id: "p1", type: "department", name: "Software" }]);
    agentsList.mockResolvedValue([{ id: "a1", kind: "org", name: "Software Lead" }]);
    render(<InFlightFlow companyId="co-1" onDone={vi.fn()} />);

    expect(await screen.findByText("finish-first-job")).toBeInTheDocument();
    expect(screen.queryByText("finish-departments")).toBeNull();
    expect(screen.queryByText("finish-integrations")).toBeNull();
    expect(screen.queryByText("finish-agents")).toBeNull();
  });

  it("starts at Departments with no pre-existing signal (fresh company)", async () => {
    render(<InFlightFlow companyId="co-1" onDone={vi.fn()} />);
    expect(await screen.findByText("finish-departments")).toBeInTheDocument();
  });
});
