import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitPanel } from "../components/workspace/tools/GitPanel";

// Mock clipboard API
const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    companyId: "comp-1",
    projectId: "proj-1",
    projectWorkspaceId: null,
    sourceIssueId: "issue-1",
    mode: "isolated_workspace" as const,
    strategyType: "git_worktree" as const,
    name: "ENG-99-fix-auth",
    status: "active" as const,
    cwd: "/tmp/ws/ENG-99",
    repoUrl: "https://github.com/acme/repo",
    baseRef: "main",
    branchName: "ENG-99-fix-auth",
    providerType: "git_worktree" as const,
    providerRef: null,
    derivedFromExecutionWorkspaceId: null,
    lastUsedAt: new Date(),
    openedAt: new Date(),
    closedAt: null,
    cleanupEligibleAt: null,
    cleanupReason: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("GitPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders branch name, base ref, and repo URL", () => {
    render(<GitPanel workspace={makeWorkspace() as any} />);

    expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github\.com/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo",
    );
  });

  it("copy button copies branch name to clipboard", async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub; spy on whatever is current
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<GitPanel workspace={makeWorkspace() as any} />);

    const copyBtn = screen.getByTestId("copy-branch-btn");
    await user.click(copyBtn);

    expect(spy).toHaveBeenCalledWith("ENG-99-fix-auth");
    spy.mockRestore();
  });

  it("shows 'No PR created' when metadata.pr is absent", () => {
    render(<GitPanel workspace={makeWorkspace() as any} />);
    expect(screen.getByText("No PR created")).toBeInTheDocument();
  });

  it("renders PR badge and link when metadata.pr is present", () => {
    const ws = makeWorkspace({
      metadata: {
        pr: { url: "https://github.com/acme/repo/pull/42", status: "open", number: 42 },
      },
    });
    render(<GitPanel workspace={ws as any} />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#42/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
  });

  it("hides repo URL row when repoUrl is null", () => {
    render(<GitPanel workspace={makeWorkspace({ repoUrl: null }) as any} />);
    expect(screen.queryByTestId("repo-url-row")).not.toBeInTheDocument();
  });

  it("hides branch row when branchName is null", () => {
    render(<GitPanel workspace={makeWorkspace({ branchName: null }) as any} />);
    expect(screen.queryByTestId("branch-row")).not.toBeInTheDocument();
  });
});
