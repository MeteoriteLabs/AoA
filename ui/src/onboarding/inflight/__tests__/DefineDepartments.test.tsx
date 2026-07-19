import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DefineDepartments } from "../DefineDepartments";

const list = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const create = vi.hoisted(() => vi.fn(async (_companyId: string, data: Record<string, unknown>) => ({
  id: `proj-${(data.name as string).toLowerCase().replace(/\s+/g, "-")}`,
  type: data.type,
  name: data.name,
})));
const listWorkspaces = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const createWorkspace = vi.hoisted(() => vi.fn(async () => ({})));
const getCompany = vi.hoisted(() => vi.fn(async () => ({ id: "c1", rootFolder: "/home/ada/AoA" })));
const mkdir = vi.hoisted(() => vi.fn(async () => ({ created: true, path: "" })));
const companyWorkspaceFsApi = vi.hoisted(() => vi.fn((_companyId: string) => ({ mkdir })));

vi.mock("../../../api/projects", () => ({
  projectsApi: { list, create, listWorkspaces, createWorkspace },
}));
vi.mock("../../../api/companies", () => ({ companiesApi: { get: getCompany } }));
vi.mock("../../../api/filesystem", () => ({ companyWorkspaceFsApi }));

// This surface is domain-only — DefineDepartments.tsx does not even import
// "../../api/onboarding" (unlike DepartmentStep, which WS0c forbids calling
// advanceOnboarding from). Mock it anyway and assert it's never called, as a
// regression guard in case that import is ever added back.
const advanceOnboarding = vi.hoisted(() => vi.fn());
vi.mock("../../../api/onboarding", () => ({ advanceOnboarding }));

type FolderBrowserDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  companyId?: string;
  initialPath?: string;
  gitAware?: boolean;
};
const dialogPropsRef = vi.hoisted(() => ({ current: null as FolderBrowserDialogProps | null }));
vi.mock("@/components/FolderBrowserDialog", () => ({
  FolderBrowserDialog: (props: FolderBrowserDialogProps) => {
    dialogPropsRef.current = props;
    if (!props.open) return null;
    return (
      <button type="button" onClick={() => props.onSelect("/chosen/path")}>
        choose-path
      </button>
    );
  },
}));

describe("DefineDepartments (WS4 — In-flight standalone surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([]);
    listWorkspaces.mockResolvedValue([]);
    getCompany.mockResolvedValue({ id: "c1", rootFolder: "/home/ada/AoA" });
    mkdir.mockResolvedValue({ created: true, path: "" });
    dialogPropsRef.current = null;
  });

  it("defaults to a single Software department", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    expect(screen.getByDisplayValue("Software")).toBeTruthy();
    // Software shows folder + repo controls.
    expect(screen.getByText(/Local folder/)).toBeTruthy();
    expect(screen.getByText(/GitHub repo/)).toBeTruthy();
    await waitFor(() => expect(getCompany).toHaveBeenCalled());
  });

  it("non-software departments hide folder/repo controls", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    // Switch the default department to Marketing.
    fireEvent.click(screen.getByText("Marketing"));
    await waitFor(() => expect(screen.queryByText(/Local folder/)).toBeNull());
    expect(screen.queryByText(/GitHub repo/)).toBeNull();
  });

  it("adds and removes departments; first (Software) stays present", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    expect(screen.getAllByPlaceholderText("Department name")).toHaveLength(1);

    fireEvent.click(screen.getByText(/Add department/));
    expect(screen.getAllByPlaceholderText("Department name")).toHaveLength(2);
    expect(screen.getByDisplayValue("Software")).toBeTruthy();

    const removeButtons = screen.getAllByRole("button", { name: /^Remove /i });
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(screen.getAllByPlaceholderText("Department name")).toHaveLength(1);
    expect(screen.getByDisplayValue("Software")).toBeTruthy();
    await waitFor(() => expect(getCompany).toHaveBeenCalled());
  });

  it("cannot remove the last remaining department", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Remove /i })).toBeNull();
    await waitFor(() => expect(getCompany).toHaveBeenCalled());
  });

  it("blocks submit when the GitHub URL is invalid", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/GitHub repo/));
    const continueBtn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    // Repo checked but empty URL → blocked.
    expect(continueBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo"), {
      target: { value: "https://gitlab.com/acme/product" },
    });
    expect(continueBtn.disabled).toBe(true);
    expect(screen.getByText(/valid GitHub repository URL/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo"), {
      target: { value: "https://github.com/acme/product" },
    });
    expect(continueBtn.disabled).toBe(false);
  });

  it("opens the FolderBrowserDialog scoped to companyId", async () => {
    render(<DefineDepartments companyId="c1" onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());
    expect(dialogPropsRef.current?.open).toBe(false);
    fireEvent.click(screen.getByText("Browse"));
    expect(dialogPropsRef.current?.open).toBe(true);
    expect(dialogPropsRef.current?.companyId).toBe("c1");

    fireEvent.click(screen.getByText("choose-path"));
    await waitFor(() => expect(screen.getByDisplayValue("/chosen/path")).toBeTruthy());
  });

  it("creates the department via the project-create API and calls onDone with NO onboarding-state advance", async () => {
    const onDone = vi.fn();
    render(<DefineDepartments companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(create).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ name: "Software", type: "department", functionType: "software_development" }),
    );
    expect(createWorkspace).toHaveBeenCalledWith(
      "proj-software",
      expect.objectContaining({ cwd: "/home/ada/AoA/software" }),
      "c1",
    );
    expect(advanceOnboarding).not.toHaveBeenCalled();
  });

  it("creates multiple departments in one submit", async () => {
    const onDone = vi.fn();
    render(<DefineDepartments companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());

    fireEvent.click(screen.getByText(/Add department/));
    const nameInputs = screen.getAllByPlaceholderText("Department name");
    fireEvent.change(nameInputs[1], { target: { value: "Marketing" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, "c1", expect.objectContaining({ name: "Software" }));
    expect(create).toHaveBeenNthCalledWith(2, "c1", expect.objectContaining({ name: "Marketing" }));
  });

  it("is idempotent — reuses an existing same-named department (no second create)", async () => {
    list.mockResolvedValue([{ id: "existing", type: "department", name: "Software" }]);
    const onDone = vi.fn();
    render(<DefineDepartments companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith(
      "existing",
      expect.objectContaining({ cwd: "/home/ada/AoA/software" }),
      "c1",
    );
  });

  it("a mid-sequence department failure leaves a retryable per-department state; already-created ones aren't recreated; onDone only fires once all succeed", async () => {
    // Second department (Marketing) fails on its project create call.
    create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => {
      if (data.name === "Marketing") throw new Error("boom");
      return { id: `proj-${(data.name as string).toLowerCase()}`, type: data.type, name: data.name };
    });
    const onDone = vi.fn();
    render(<DefineDepartments companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());

    fireEvent.click(screen.getByText(/Add department/));
    const nameInputs = screen.getAllByPlaceholderText("Department name");
    fireEvent.change(nameInputs[1], { target: { value: "Marketing" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Software succeeded, Marketing surfaces a retryable error; onDone must NOT fire yet.
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "Software" }));

    // Retry Marketing only — Software must not be recreated.
    create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
      id: `proj-${(data.name as string).toLowerCase()}`,
      type: data.type,
      name: data.name,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Software's create call count stays at 1 (never re-created); only Marketing's retry adds one more.
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls.filter((c) => (c[1] as Record<string, unknown>).name === "Software")).toHaveLength(1);
  });

  it("surfaces a workspace/folder failure without losing the already-created project (idempotent retry)", async () => {
    mkdir.mockRejectedValueOnce(new Error("EACCES"));
    const onDone = vi.fn();
    render(<DefineDepartments companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/software")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Couldn't create the folder/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    mkdir.mockResolvedValue({ created: true, path: "" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // The project was NOT re-created on retry.
    expect(create).toHaveBeenCalledTimes(1);
    expect(createWorkspace).toHaveBeenCalledTimes(1);
  });
});
