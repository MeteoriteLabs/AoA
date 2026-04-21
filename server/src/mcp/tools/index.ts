import { ISSUE_STATUSES } from "@paperclipai/shared";
import { readToolHandlers } from "./read-tools.js";
import { writeToolHandlers } from "./write-tools.js";
import type { ToolHandler } from "./types.js";

export { readToolHandlers, writeToolHandlers };
export * from "./types.js";

export const toolHandlers: Record<string, ToolHandler> = {
  ...readToolHandlers,
  ...writeToolHandlers,
};

export const TOOL_DEFINITIONS = [
  {
    name: "me",
    description: "Return the authenticated caller's identity and role",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list-agents",
    description: "List agents in the caller's company, scoped by RBAC",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
    },
  },
  {
    name: "get-agent",
    description: "Get a single agent by id (RBAC scoped)",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
    },
  },
  {
    name: "list-projects",
    description: "List projects (departments + projects) in the caller's company",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["department", "project"] },
      },
    },
  },
  {
    name: "get-project",
    description: "Get a single project by id (RBAC scoped)",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list-tasks",
    description:
      "List tasks in the caller's company with RBAC scoping. Supports filters: status, projectId, assigneeAgentId, assigneeUserId, touchedByUserId, unreadForUserId, labelId, q",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        projectId: { type: "string" },
        assigneeAgentId: { type: "string" },
        assigneeUserId: { type: "string" },
        touchedByUserId: { type: "string" },
        unreadForUserId: { type: "string" },
        labelId: { type: "string" },
        q: { type: "string" },
      },
    },
  },
  {
    name: "get-heartbeat-context",
    description:
      "Return a compact { task, recentComments } payload for a task (last 10 comments)",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "list-task-comments",
    description: "List comments on a task (RBAC scoped)",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "get-task-comment",
    description: "Get a single task comment by id (RBAC scoped via its task)",
    inputSchema: {
      type: "object",
      properties: { commentId: { type: "string" } },
      required: ["commentId"],
    },
  },
  {
    name: "debrief-push",
    description: "Push content into the Debrief pipeline",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        title: { type: "string" },
        departmentId: { type: "string" },
        projectId: { type: "string" },
        source: { type: "object" },
      },
      required: ["content"],
    },
  },
  {
    name: "suggest-memory",
    description: "Create a pending memory suggestion",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        departmentId: { type: "string" },
        projectId: { type: "string" },
        layer: { type: "string" },
        priority: { type: "number" },
        goalId: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["title", "content", "category"],
    },
  },
  {
    name: "update-task-status",
    description: "Update a task status with permission checks",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: [...ISSUE_STATUSES] },
      },
      required: ["taskId", "status"],
    },
  },
  {
    name: "create-task",
    description:
      "Create a task directly in the caller's company (RBAC scoped). Does NOT route through Discussion; use debrief-push for unstructured content extraction (Decision #14 revised)",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        projectId: { type: "string" },
        goalId: { type: "string" },
        parentId: { type: "string" },
        status: { type: "string", enum: [...ISSUE_STATUSES] },
        priority: { type: "string" },
        assigneeAgentId: { type: "string" },
        assigneeUserId: { type: "string" },
        labelIds: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
  },
  {
    name: "update-task",
    description:
      "Update a task's fields (title, description, status, priority, assignee, etc.) with RBAC checks",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        projectId: { type: "string" },
        goalId: { type: "string" },
        status: { type: "string", enum: [...ISSUE_STATUSES] },
        priority: { type: "string" },
        assigneeAgentId: { type: "string" },
        assigneeUserId: { type: "string" },
        labelIds: { type: "array", items: { type: "string" } },
      },
      required: ["taskId"],
    },
  },
  {
    name: "add-task-comment",
    description: "Add a comment to a task the caller can access",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        body: { type: "string" },
      },
      required: ["taskId", "body"],
    },
  },
  {
    name: "attach-artifact-version",
    description: "Add a new immutable version to an artifact",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        sourceDetail: { type: "string" },
        changelog: { type: "string" },
        parentVersionId: { type: "string" },
        content: { type: "string" },
        fileUrl: { type: "string" },
      },
      required: ["artifactId", "sourceDetail"],
    },
  },
];
