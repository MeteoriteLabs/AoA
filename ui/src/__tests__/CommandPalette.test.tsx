import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, mockCompanyContext, mockDialogContext } from "./test-utils";
import { CommandPalette } from "../components/CommandPalette";

const mockSearch = vi.fn();
const mockSemanticSearch = vi.fn();

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialogContext,
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: vi.fn(),
  }),
}));

vi.mock("../api/search", () => ({
  searchApi: {
    search: (...args: any[]) => mockSearch(...args),
  },
}));

vi.mock("../api/memory", () => ({
  memoryApi: {
    searchSemantic: (...args: any[]) => mockSemanticSearch(...args),
  },
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockSearch.mockImplementation((_companyId: string, query: string) =>
      Promise.resolve(
        query
          ? {
              tasks: [
                {
                  id: "task-1",
                  entityType: "tasks",
                  title: "Fix API search",
                  subtitle: "Implement cmd+k full-text search",
                  score: 0.9,
                  identifier: "AOA-12",
                  status: "todo",
                  role: null,
                  layer: null,
                  category: null,
                  departmentId: null,
                  departmentName: null,
                  updatedAt: new Date().toISOString(),
                },
              ],
              goals: [],
              agents: [],
              memory: [
                {
                  id: "mem-1",
                  entityType: "memory",
                  title: "API conventions",
                  subtitle: "Use stable route contracts",
                  score: 0.5,
                  identifier: null,
                  status: "approved",
                  role: null,
                  layer: "domain",
                  category: "reference",
                  departmentId: "dept-1",
                  departmentName: "Engineering",
                  updatedAt: new Date().toISOString(),
                },
              ],
            }
          : {
              tasks: [],
              goals: [],
              agents: [],
              memory: [],
            },
      ),
    );
    mockSemanticSearch.mockResolvedValue([
      { id: "mem-1", similarity: 0.93 },
    ]);
  });

  it("renders memory metadata and hides empty result groups", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search tasks, goals, agents, memory...");
    await user.type(input, "api");

    expect(await screen.findByText("Tasks")).toBeInTheDocument();
    expect(await screen.findByText("Memory")).toBeInTheDocument();
    expect(await screen.findByText("Fix API search")).toBeInTheDocument();
    expect(await screen.findByText("API conventions")).toBeInTheDocument();
    expect(screen.getByText("domain")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("reference")).toBeInTheDocument();
    expect(screen.getByText("93%")).toBeInTheDocument();
  });

  it("shows empty search messaging when grouped results are empty", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({
      tasks: [],
      goals: [],
      agents: [],
      memory: [],
    });
    mockSemanticSearch.mockResolvedValue([]);

    renderWithProviders(<CommandPalette />);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText("Search tasks, goals, agents, memory...");
    await user.type(input, "zzz");

    await waitFor(() => {
      expect(screen.getByText("No search results found.")).toBeInTheDocument();
    });
  });
});
