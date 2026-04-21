import { APPROVAL_STATUSES, APPROVAL_TYPES, ISSUE_STATUSES } from "@paperclipai/shared";
import { readToolHandlers } from "./read-tools.js";
import { writeToolHandlers } from "./write-tools.js";
import { documentToolHandlers } from "./document-tools.js";
import { approvalToolHandlers } from "./approval-tools.js";
import type { ToolHandler } from "./types.js";

export {
  readToolHandlers,
  writeToolHandlers,
  documentToolHandlers,
  approvalToolHandlers,
};
export * from "./types.js";

export const toolHandlers: Record<string, ToolHandler> = {
  ...readToolHandlers,
  ...writeToolHandlers,
  ...documentToolHandlers,
  ...approvalToolHandlers,
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
  {
    name: "upsert-task-document",
    description:
      "Create or update the task's document (markdown). If the task already has a document artifact, appends a new immutable version; otherwise creates an artifact of type 'document' and links it to the task. Maps Paperclip's upsert-issue-document to AoA's artifact subsystem.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        changeSummary: { type: "string" },
        baseRevisionId: { type: "string" },
      },
      required: ["taskId", "body"],
    },
  },
  {
    name: "list-task-documents",
    description:
      "List document artifacts attached to a task (0 or 1 — AoA has 1:1 task↔artifact)",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "get-task-document",
    description: "Return the task's document artifact with its latest version (content + metadata)",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "list-task-document-revisions",
    description:
      "List all immutable revisions of the task's document artifact, ordered ascending by version number",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "restore-task-document-revision",
    description:
      "Create a NEW document artifact version whose content is copied from the specified older revision. The older revision is never mutated (preserves Decisions #43/#45 — artifact versions are immutable).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        revisionId: { type: "string" },
      },
      required: ["taskId", "revisionId"],
    },
  },
  {
    name: "list-approvals",
    description:
      "List approvals in the caller's company. Scoped users see only approvals linked to tasks in their projects. Filterable by status and type.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...APPROVAL_STATUSES] },
        type: { type: "string", enum: [...APPROVAL_TYPES] },
      },
    },
  },
  {
    name: "get-approval",
    description: "Get an approval by id (RBAC scoped; cross-company 404)",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string" } },
      required: ["approvalId"],
    },
  },
  {
    name: "get-approval-tasks",
    description:
      "List tasks linked to an approval. Scoped users see only tasks in their projects.",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string" } },
      required: ["approvalId"],
    },
  },
  {
    name: "list-approval-comments",
    description: "List comments on an approval (RBAC scoped)",
    inputSchema: {
      type: "object",
      properties: { approvalId: { type: "string" } },
      required: ["approvalId"],
    },
  },
  {
    name: "list-task-approvals",
    description: "List approvals linked to a task (RBAC scoped via the task)",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "create-approval",
    description:
      "Create a new approval request. Founders + team leads only. Team leads must link at least one task from their scope.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...APPROVAL_TYPES] },
        requestedByAgentId: { type: "string" },
        payload: { type: "object" },
        issueIds: { type: "array", items: { type: "string" } },
      },
      required: ["type", "payload"],
    },
  },
  {
    name: "approval-decision",
    description:
      "Approve, reject, request revision, or resubmit an approval. Founders + team leads only. Team leads limited to approvals with at least one task in their scope.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        action: {
          type: "string",
          enum: ["approve", "reject", "requestRevision", "resubmit"],
        },
        decisionNote: { type: "string" },
        payloadJson: { type: "string" },
      },
      required: ["approvalId", "action"],
    },
  },
  {
    name: "add-approval-comment",
    description:
      "Add a comment to an approval. Any role may comment on approvals they can see.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        body: { type: "string" },
      },
      required: ["approvalId", "body"],
    },
  },
  {
    name: "link-task-approval",
    description:
      "Link an existing approval to an existing task. Founders + team leads only.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        approvalId: { type: "string" },
      },
      required: ["taskId", "approvalId"],
    },
  },
  {
    name: "unlink-task-approval",
    description:
      "Unlink an approval from a task. Founders + team leads only.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        approvalId: { type: "string" },
      },
      required: ["taskId", "approvalId"],
    },
  },
];
