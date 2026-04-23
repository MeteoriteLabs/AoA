import { describe, expect, it } from "vitest";
import {
  pickWorkspaceInheritanceSourceIssueId,
  resolveExecutionWorkspaceInheritance,
} from "../services/issues.js";

describe("pickWorkspaceInheritanceSourceIssueId", () => {
  it("picks inheritExecutionWorkspaceFromIssueId when provided", () => {
    expect(
      pickWorkspaceInheritanceSourceIssueId({
        inheritExecutionWorkspaceFromIssueId: "source-id",
        parentId: null,
      }),
    ).toBe("source-id");
  });

  it("falls back to parentId when inheritExecutionWorkspaceFromIssueId is absent", () => {
    expect(
      pickWorkspaceInheritanceSourceIssueId({
        inheritExecutionWorkspaceFromIssueId: null,
        parentId: "parent-id",
      }),
    ).toBe("parent-id");
  });

  it("picks inheritExecutionWorkspaceFromIssueId over parentId when both provided", () => {
    expect(
      pickWorkspaceInheritanceSourceIssueId({
        inheritExecutionWorkspaceFromIssueId: "explicit-source",
        parentId: "parent-id",
      }),
    ).toBe("explicit-source");
  });

  it("returns null when neither provided", () => {
    expect(pickWorkspaceInheritanceSourceIssueId({})).toBeNull();
    expect(
      pickWorkspaceInheritanceSourceIssueId({
        inheritExecutionWorkspaceFromIssueId: null,
        parentId: null,
      }),
    ).toBeNull();
  });
});

describe("resolveExecutionWorkspaceInheritance", () => {
  const sourceWithWorkspace = {
    executionWorkspaceId: "ws-source",
    executionWorkspaceSettings: { customField: "keep-me" } as Record<string, unknown>,
  };

  it("inherits workspace id + reuse_existing preference + merged settings with mapped mode", () => {
    const resolved = resolveExecutionWorkspaceInheritance({
      sourceIssue: sourceWithWorkspace,
      sourceWorkspaceMode: "operator_branch",
      isolatedWorkspacesEnabled: true,
      hasExplicitOverride: false,
    });

    expect(resolved).toEqual({
      executionWorkspaceId: "ws-source",
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        customField: "keep-me",
        mode: "operator_branch",
      },
    });
  });

  it("maps adapter_managed source mode to agent_default for the issue settings", () => {
    const resolved = resolveExecutionWorkspaceInheritance({
      sourceIssue: { executionWorkspaceId: "ws-1", executionWorkspaceSettings: null },
      sourceWorkspaceMode: "adapter_managed",
      isolatedWorkspacesEnabled: true,
      hasExplicitOverride: false,
    });

    expect(resolved?.executionWorkspaceSettings).toEqual({ mode: "agent_default" });
  });

  it("returns null when source issue is null", () => {
    expect(
      resolveExecutionWorkspaceInheritance({
        sourceIssue: null,
        sourceWorkspaceMode: null,
        isolatedWorkspacesEnabled: true,
        hasExplicitOverride: false,
      }),
    ).toBeNull();
  });

  it("returns null when isolatedWorkspacesEnabled is false", () => {
    expect(
      resolveExecutionWorkspaceInheritance({
        sourceIssue: sourceWithWorkspace,
        sourceWorkspaceMode: "isolated_workspace",
        isolatedWorkspacesEnabled: false,
        hasExplicitOverride: false,
      }),
    ).toBeNull();
  });

  it("returns null when the caller passed an explicit workspace override", () => {
    expect(
      resolveExecutionWorkspaceInheritance({
        sourceIssue: sourceWithWorkspace,
        sourceWorkspaceMode: "isolated_workspace",
        isolatedWorkspacesEnabled: true,
        hasExplicitOverride: true,
      }),
    ).toBeNull();
  });

  it("returns null when source issue has no executionWorkspaceId", () => {
    expect(
      resolveExecutionWorkspaceInheritance({
        sourceIssue: { executionWorkspaceId: null, executionWorkspaceSettings: null },
        sourceWorkspaceMode: null,
        isolatedWorkspacesEnabled: true,
        hasExplicitOverride: false,
      }),
    ).toBeNull();
  });

  it("produces mode agent_default when source workspace mode is null/undefined", () => {
    const resolved = resolveExecutionWorkspaceInheritance({
      sourceIssue: { executionWorkspaceId: "ws-1", executionWorkspaceSettings: null },
      sourceWorkspaceMode: null,
      isolatedWorkspacesEnabled: true,
      hasExplicitOverride: false,
    });
    expect(resolved?.executionWorkspaceSettings).toEqual({ mode: "agent_default" });
  });
});
