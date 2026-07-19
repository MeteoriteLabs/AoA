import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LibrarianStep } from "../LibrarianStep";

const list = vi.hoisted(() => vi.fn());
vi.mock("../../../api/projects", () => ({
  projectsApi: { list },
}));

const listByDepartment = vi.hoisted(() => vi.fn());
const retry = vi.hoisted(() => vi.fn());
vi.mock("../../../api/braindump", async () => {
  const actual = await vi.importActual<typeof import("../../../api/braindump")>("../../../api/braindump");
  return {
    ...actual,
    braindumpApi: { submit: vi.fn(), listByDepartment, get: vi.fn(), retry },
  };
});

const memoryList = vi.hoisted(() => vi.fn());
const memoryApprove = vi.hoisted(() => vi.fn());
vi.mock("../../../api/memory", () => ({
  memoryApi: { list: memoryList, approve: memoryApprove },
}));

function makeDept(overrides: Record<string, unknown> = {}) {
  return { id: "dept-1", name: "Software", type: "department", functionType: "software_development", ...overrides };
}

function makeCapture(overrides: Record<string, unknown> = {}) {
  return {
    id: "bd-1",
    companyId: "c1",
    departmentId: "dept-1",
    idempotencyKey: "dept-1:sess",
    content: "notes",
    contentLength: 5,
    status: "proposed",
    effectiveStatus: "proposed",
    librarianAgentId: "agent-1",
    runId: "run-1",
    proposedMemoryItemIds: ["mem-1"],
    failureReason: null,
    dispatchStartedAt: null,
    dispatchCompletedAt: null,
    createdByUserId: null,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

function makeMemoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    companyId: "c1",
    title: "We use Postgres",
    content: "The team standardized on Postgres + Drizzle ORM.",
    category: "context",
    source: "agent",
    status: "pending",
    tags: null,
    departmentId: "dept-1",
    projectId: null,
    createdBy: "agent-1",
    layer: "domain",
    priority: 0,
    visibility: "team",
    expiresAt: null,
    goalId: null,
    taskId: null,
    sourceArtifactId: null,
    sourceContext: "braindump",
    accessedAt: null,
    currentVersionId: null,
    embeddingRetries: 0,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("LibrarianStep (WS6 — In-flight standalone surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([makeDept()]);
    listByDepartment.mockResolvedValue([makeCapture()]);
    memoryList.mockResolvedValue({ items: [makeMemoryItem()], semanticAvailable: true });
    memoryApprove.mockResolvedValue({ ...makeMemoryItem(), status: "approved" });
    retry.mockResolvedValue(makeCapture());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the done AgentCharacter and lists proposed items when captures are already terminal", async () => {
    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "agent done" })).toBeTruthy();
    expect(screen.getByText("We use Postgres")).toBeTruthy();
    expect(screen.getByText(/Review what the Librarian found/i)).toBeTruthy();
  });

  it("shows the thinking AgentCharacter while a capture is still running, then flips to done via polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listByDepartment.mockResolvedValueOnce([makeCapture({ status: "running" })]);
    listByDepartment.mockResolvedValueOnce([makeCapture({ status: "proposed" })]);

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "agent thinking" })).toBeTruthy();
    expect(screen.getByText(/The Librarian is reading through/)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => expect(listByDepartment).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("img", { name: "agent done" })).toBeTruthy();
    expect(screen.getByText("We use Postgres")).toBeTruthy();
  });

  it("scopes the approve list to this run's proposed memory item ids, excluding unrelated pending items", async () => {
    listByDepartment.mockResolvedValue([
      makeCapture({ id: "bd-1", proposedMemoryItemIds: ["mem-1"] }),
      makeCapture({ id: "bd-2", departmentId: "dept-2", proposedMemoryItemIds: ["mem-2"] }),
    ]);
    memoryList.mockResolvedValue({
      items: [
        makeMemoryItem({ id: "mem-1", title: "We use Postgres" }),
        makeMemoryItem({ id: "mem-2", title: "We ship weekly" }),
        makeMemoryItem({ id: "mem-unrelated", title: "Unrelated pending item" }),
      ],
      semanticAvailable: true,
    });

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByText("We use Postgres")).toBeTruthy();
    expect(screen.getByText("We ship weekly")).toBeTruthy();
    expect(screen.queryByText("Unrelated pending item")).toBeNull();
  });

  it("shows an empty state (and still allows Continue) when no captures propose any memory items, even if unrelated pending items exist", async () => {
    listByDepartment.mockResolvedValue([makeCapture({ proposedMemoryItemIds: [] })]);
    memoryList.mockResolvedValue({
      items: [makeMemoryItem({ id: "mem-unrelated", title: "Unrelated pending item" })],
      semanticAvailable: true,
    });

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "agent done" })).toBeTruthy();
    expect(screen.getByText(/No proposed memory items yet/)).toBeTruthy();
    expect(screen.queryByText("Unrelated pending item")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("Approve calls the real founder approval route and removes the item from the list", async () => {
    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approveBtn);

    await waitFor(() => expect(memoryApprove).toHaveBeenCalledWith("c1", "mem-1"));
    await waitFor(() => expect(screen.queryByText("We use Postgres")).toBeNull());
  });

  it("shows a failed capture's failure reason with a Retry action", async () => {
    listByDepartment.mockResolvedValue([
      makeCapture({ id: "bd-2", status: "failed", failureReason: "The Librarian agent is not provisioned." }),
    ]);
    memoryList.mockResolvedValue({ items: [], semanticAvailable: true });

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByText("The Librarian agent is not provisioned.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Retry calls the retry endpoint and clears the failure once it succeeds", async () => {
    listByDepartment.mockResolvedValueOnce([
      makeCapture({ id: "bd-2", status: "failed", failureReason: "boom" }),
    ]);
    memoryList.mockResolvedValueOnce({ items: [], semanticAvailable: true });
    retry.mockResolvedValueOnce(makeCapture({ id: "bd-2", status: "proposed", failureReason: null }));

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(retry).toHaveBeenCalledWith("c1", "bd-2"));
    await waitFor(() => expect(screen.queryByText("boom")).toBeNull());
  });

  it("Continue calls onDone even while still organizing", async () => {
    listByDepartment.mockResolvedValue([makeCapture({ status: "running" })]);
    const onDone = vi.fn();
    render(<LibrarianStep companyId="c1" onDone={onDone} />);

    await screen.findByRole("img", { name: "agent thinking" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Continue only fires onDone once even on a rapid double-click", async () => {
    listByDepartment.mockResolvedValue([makeCapture({ status: "running" })]);
    const onDone = vi.fn();
    render(<LibrarianStep companyId="c1" onDone={onDone} />);

    await screen.findByRole("img", { name: "agent thinking" });
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(continueBtn);
    fireEvent.click(continueBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not crash and stops polling after unmount while organizing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listByDepartment.mockResolvedValue([makeCapture({ status: "running" })]);

    const { unmount } = render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);
    await screen.findByRole("img", { name: "agent thinking" });

    expect(() => unmount()).not.toThrow();

    listByDepartment.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(listByDepartment).not.toHaveBeenCalled();
  });

  it("handles a department with no braindumps yet (empty list) without hanging on thinking", async () => {
    listByDepartment.mockResolvedValue([]);
    memoryList.mockResolvedValue({ items: [], semanticAvailable: true });

    render(<LibrarianStep companyId="c1" onDone={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "agent done" })).toBeTruthy();
    expect(screen.getByText(/No proposed memory items yet/)).toBeTruthy();
  });
});
