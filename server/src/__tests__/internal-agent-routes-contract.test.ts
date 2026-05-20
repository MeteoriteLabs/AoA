import { describe, expect, it, vi } from "vitest";

// ── drizzle-orm mock ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  desc: vi.fn((value: any) => ({ desc: value })),
  asc: vi.fn((value: any) => ({ asc: value })),
  gte: vi.fn((a: any, b: any) => ({ gte: [a, b] })),
  lte: vi.fn((a: any, b: any) => ({ lte: [a, b] })),
  isNull: vi.fn((a: any) => ({ isNull: a })),
  sql: Object.assign(
    vi.fn((strings: any, ...values: any[]) => ({
      sql: strings,
      values,
      as: vi.fn().mockReturnValue("aliased"),
    })),
    { raw: vi.fn((input: any) => input) },
  ),
}));

// ── DB table stubs ───────────────────────────────────────────────────────────
vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: {
    id: "config_id",
    companyId: "config_company_id",
    autonomyLevel: "config_autonomy_level",
  },
  internalAgentConversations: {
    id: "conv_id",
    companyId: "conv_company_id",
    userId: "conv_user_id",
    status: "conv_status",
    archivedAt: "conv_archived_at",
    updatedAt: "conv_updated_at",
    title: "conv_title",
  },
  internalAgentMessages: {
    id: "msg_id",
    conversationId: "msg_conversation_id",
    createdAt: "msg_created_at",
  },
  internalAgentRuns: {
    id: "run_id",
    companyId: "run_company_id",
    triggerType: "run_trigger_type",
    triggerSource: "run_trigger_source",
    status: "run_status",
    createdAt: "run_created_at",
  },
  internalAgentReminders: {
    id: "reminder_id",
    companyId: "reminder_company_id",
    userId: "reminder_user_id",
    status: "reminder_status",
  },
}));

// ── Mock dependencies that routes need ───────────────────────────────────────
vi.mock("../middleware/rbac.js", () => ({
  assertRole: vi.fn(),
}));

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn(() => ({
    actorType: "user",
    actorId: "user-1",
    agentId: null,
    runId: null,
  })),
}));

// Mock agent-loop to prevent company-skills → projects → heartbeat transitive
// import (heartbeat.ts uses many @armyofagents/db exports not in our mock stub).
// This test only checks the router structure, not runtime agent-loop behaviour.
vi.mock("../services/internal-agent/agent-loop.js", () => ({
  agentLoopService: vi.fn(() => ({ chat: vi.fn() })),
}));

// Mock tool-registry and service-container for the same reason: their transitive
// imports (action-tools → heartbeat, service-container → heartbeat/dependencies)
// reference @armyofagents/db exports not present in our stub above.
vi.mock("../services/internal-agent/tool-registry.js", () => ({
  createToolRegistry: vi.fn(() => []),
  executeTool: vi.fn(),
}));
vi.mock("../services/internal-agent/service-container.js", () => ({
  createServiceContainer: vi.fn(() => ({})),
}));

import { internalAgentRoutes } from "../routes/internal-agent.js";

describe("internal-agent-routes-contract", () => {
  it("returns an Express Router", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);
    expect(router).toBeDefined();
    // Express Router has a `stack` property containing route layers
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers exactly 13 route handlers", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    // Collect all route layers (filter out non-route middleware)
    const routeLayers = router.stack.filter(
      (layer: any) => layer.route != null,
    );

    // 10 original routes + 3 new multi-conversation routes (list, create, archive) + 2 tool-permissions routes
    expect(routeLayers).toHaveLength(15);
  });

  it("registers all expected paths and methods", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const routes = router.stack
      .filter((layer: any) => layer.route != null)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const expectedRoutes = [
      { path: "/companies/:companyId/internal-agent/chat", method: "post" },
      { path: "/companies/:companyId/internal-agent/confirm", method: "post" },
      { path: "/companies/:companyId/internal-agent/conversation", method: "get" },
      { path: "/companies/:companyId/internal-agent/conversation", method: "delete" },
      { path: "/companies/:companyId/internal-agent/config", method: "get" },
      { path: "/companies/:companyId/internal-agent/config", method: "patch" },
      { path: "/companies/:companyId/internal-agent/greeting", method: "get" },
      { path: "/companies/:companyId/internal-agent/runs", method: "get" },
      { path: "/companies/:companyId/internal-agent/reminders", method: "get" },
      { path: "/companies/:companyId/internal-agent/reminders/:reminderId", method: "patch" },
      // multi-conversation routes (Task 3.2)
      { path: "/companies/:companyId/internal-agent/conversations", method: "get" },
      { path: "/companies/:companyId/internal-agent/conversations", method: "post" },
      { path: "/companies/:companyId/internal-agent/conversations/:convId/archive", method: "patch" },
      // tool-permissions routes (Task 6)
      { path: "/companies/:companyId/internal-agent/tool-permissions", method: "get" },
      { path: "/companies/:companyId/internal-agent/tool-permissions", method: "patch" },
    ];

    for (const expected of expectedRoutes) {
      const found = routes.find(
        (r: any) =>
          r.path === expected.path && r.methods.includes(expected.method),
      );
      expect(
        found,
        `Expected route ${expected.method.toUpperCase()} ${expected.path}`,
      ).toBeDefined();
    }
  });

  it("has SSE chat endpoint as POST, not GET", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const chatRoute = router.stack.find(
      (layer: any) =>
        layer.route?.path ===
        "/companies/:companyId/internal-agent/chat",
    );

    expect(chatRoute).toBeDefined();
    expect(chatRoute.route.methods.post).toBe(true);
    expect(chatRoute.route.methods.get).toBeUndefined();
  });

  it("uses DELETE for conversation reset (per spec 2.4)", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const resetRoute = router.stack.find(
      (layer: any) =>
        layer.route?.path ===
          "/companies/:companyId/internal-agent/conversation" &&
        layer.route?.methods?.delete,
    );

    expect(resetRoute).toBeDefined();
  });

  it("uses PATCH for reminder cancellation (per spec 2.9)", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const cancelRoute = router.stack.find(
      (layer: any) =>
        layer.route?.path ===
          "/companies/:companyId/internal-agent/reminders/:reminderId" &&
        layer.route?.methods?.patch,
    );

    expect(cancelRoute).toBeDefined();
  });
});
