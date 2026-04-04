import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewProjectDialog } from "../components/NewProjectDialog";

vi.mock("@mdxeditor/editor", () => ({
  CodeMirrorEditor: {},
  MDXEditor: () => null,
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  BoldItalicUnderlineToggles: () => null,
  ListsToggle: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
  tablePlugin: () => ({}),
  imagePlugin: () => ({}),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { name: "Acme Corp" },
  }),
}));

const mockCloseNewProject = vi.fn();

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    newProjectOpen: true,
    newProjectDefaults: { type: "department" },
    closeNewProject: mockCloseNewProject,
  }),
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    create: vi.fn().mockResolvedValue({ id: "proj-1" }),
    createWorkspace: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../api/goals", () => ({
  goalsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/assets", () => ({
  assetsApi: { uploadImage: vi.fn() },
}));

vi.mock("../components/PathInstructionsModal", () => ({
  ChoosePathButton: () => <button type="button">Choose</button>,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ id: "proj-1" }),
      isPending: false,
      isError: false,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewProjectDialog />
    </QueryClientProvider>
  );
}

describe("NewProjectDialog — function type picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 10 function type options for departments", () => {
    renderDialog();
    expect(screen.getByText("Product (Software)")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("HR")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("selecting Product (Software) shows repo setup", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByText("Product (Software)"));
    expect(screen.getByText("A local folder")).toBeInTheDocument();
    expect(screen.getByText("A github repo")).toBeInTheDocument();
    expect(screen.getByText("Both")).toBeInTheDocument();
  });

  it("selecting a non-software type shows working directory input, not repo setup", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByText("Marketing"));
    expect(screen.queryByText("A local folder")).not.toBeInTheDocument();
    expect(screen.queryByText("A github repo")).not.toBeInTheDocument();
    expect(screen.getByText("Working directory")).toBeInTheDocument();
  });

  it("workspace mode toggle renders and Shared can be selected", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByText("Marketing"));
    const sharedBtn = screen.getByRole("button", { name: /shared/i });
    await user.click(sharedBtn);
    expect(sharedBtn.className).toContain("border-foreground");
  });
});
