import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { MyTasksWidget } from "../../components/home/widgets/MyTasksWidget";

const { issuesApiMock } = vi.hoisted(() => ({ issuesApiMock: { list: vi.fn() } }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../api/issues", () => ({ issuesApi: issuesApiMock }));

describe("MyTasksWidget", () => {
  beforeEach(() => {
    issuesApiMock.list.mockResolvedValue([
      { id: "t1", title: "Draft launch post", status: "in_progress", priority: "high" },
      { id: "t2", title: "Review crew output", status: "todo", priority: "medium" },
      { id: "t3", title: "Done thing", status: "done", priority: "low" },
    ]);
  });
  it("lists my non-terminal tasks with status", async () => {
    renderWithProviders(<MyTasksWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    expect(await screen.findByText("Draft launch post")).toBeInTheDocument();
    expect(screen.getByText("Review crew output")).toBeInTheDocument();
    // terminal tasks excluded
    expect(screen.queryByText("Done thing")).not.toBeInTheDocument();
  });

  it("renders nothing when I have no assigned tasks", async () => {
    issuesApiMock.list.mockResolvedValue([]);
    const { container } = renderWithProviders(<MyTasksWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    await waitFor(() => expect(issuesApiMock.list).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders nothing when every assigned task is terminal (done/cancelled)", async () => {
    issuesApiMock.list.mockResolvedValue([
      { id: "t1", title: "Done thing", status: "done", priority: "low" },
      { id: "t2", title: "Cancelled thing", status: "cancelled", priority: "low" },
    ]);
    const { container } = renderWithProviders(<MyTasksWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    await waitFor(() => expect(issuesApiMock.list).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("caps the list at 5 tasks", async () => {
    issuesApiMock.list.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, status: "todo", priority: "medium" })),
    );
    renderWithProviders(<MyTasksWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    expect(await screen.findByText("Task 0")).toBeInTheDocument();
    expect(screen.getByText("Task 4")).toBeInTheDocument();
    expect(screen.queryByText("Task 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Task 7")).not.toBeInTheDocument();
  });
});
