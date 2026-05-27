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
    pinned: "conv_pinned",
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

// Mock ensure-commander and company-skills to avoid transitive db imports.
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: vi.fn(async () => "commander-agent-id"),
  COMMANDER_TOOL_ALLOWLIST: [],
}));
vi.mock("../services/company-skills.js", () => ({
  companySkillService: vi.fn(() => ({
    listSkillListItemsForAgent: vi.fn(async () => []),
  })),
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

  it("registers exactly 25 route handlers", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    // Collect all route layers (filter out non-route middleware)
    const routeLayers = router.stack.filter(
      (layer: any) => layer.route != null,
    );

    // 22 existing routes + 2 durable tool-trust rule routes + 1 runtime settings route.
    expect(routeLayers).toHaveLength(25);
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
      { path: "/companies/:companyId/internal-agent/runtime-settings", method: "get" },
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
      // durable runtime approval trust rules
      { path: "/companies/:companyId/internal-agent/tool-trust-rules", method: "get" },
      { path: "/companies/:companyId/internal-agent/tool-trust-rules/:ruleId", method: "delete" },
      // conversation messages route (Task 8)
      { path: "/companies/:companyId/internal-agent/conversations/:convId/messages", method: "get" },
      // pin + rename routes (Task 1)
      { path: "/companies/:companyId/internal-agent/conversations/:convId/pin", method: "patch" },
      { path: "/companies/:companyId/internal-agent/conversations/:convId/rename", method: "patch" },
      // hard-delete route (Task 5)
      { path: "/companies/:companyId/internal-agent/conversations/:convId", method: "delete" },
      // Commander skills route (Task 5b)
      { path: "/companies/:companyId/internal-agent/skills", method: "get" },
      // session reorder + reset routes (Batch 2)
      { path: "/companies/:companyId/internal-agent/conversations/reorder", method: "patch" },
      { path: "/companies/:companyId/internal-agent/conversations/order", method: "delete" },
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

  it("registers PATCH pin route for conversations (Task 1)", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const pinRoute = router.stack.find(
      (layer: any) =>
        layer.route?.path ===
          "/companies/:companyId/internal-agent/conversations/:convId/pin" &&
        layer.route?.methods?.patch,
    );

    expect(pinRoute).toBeDefined();
  });

  it("registers PATCH rename route for conversations (Task 1)", () => {
    const db = {} as any;
    const router = internalAgentRoutes(db);

    const renameRoute = router.stack.find(
      (layer: any) =>
        layer.route?.path ===
          "/companies/:companyId/internal-agent/conversations/:convId/rename" &&
        layer.route?.methods?.patch,
    );

    expect(renameRoute).toBeDefined();
  });
});

// ── Source-string contract assertions (Task 1) ───────────────────────────────
// These read the route source directly to assert ownership-check and default
// properties without running the handlers. This matches the migration-contract
// pattern used elsewhere in the test suite (see migration-0069-contract.test.ts).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("internal-agent pin/rename routes source contract (Task 1)", () => {
  const routeSrc = readFileSync(
    resolve(__dirname, "../routes/internal-agent.ts"),
    "utf8",
  );

  // ── Helper contract ──────────────────────────────────────────────────────
  // The ownership logic was extracted into loadOwnedConversation() to remove
  // the verbatim triplication across archive, pin, and rename. These assertions
  // verify the helper itself contains the full ownership guard.

  it("loadOwnedConversation helper contains userId ownership condition for non-founders", () => {
    // The helper body must push userId into convConditions for non-founders,
    // preserving the anti-leak pattern (no 403 vs 404 distinction for non-owners).
    const helperStart = routeSrc.indexOf("async function loadOwnedConversation(");
    expect(helperStart).toBeGreaterThan(-1);
    // Slice from the helper start to the next route registration to scope the check
    const nextRouteStart = routeSrc.indexOf("router.post(", helperStart);
    const helperBlock = routeSrc.slice(helperStart, nextRouteStart);
    expect(helperBlock).toContain("internalAgentConversations.userId");
    expect(helperBlock).toContain("actor.actorId");
  });

  it("loadOwnedConversation helper resolves founder role (getEffectiveRole)", () => {
    const helperStart = routeSrc.indexOf("async function loadOwnedConversation(");
    const nextRouteStart = routeSrc.indexOf("router.post(", helperStart);
    const helperBlock = routeSrc.slice(helperStart, nextRouteStart);
    expect(helperBlock).toContain("getEffectiveRole");
    expect(helperBlock).toContain("isFounderRole");
  });

  // ── Per-route delegation assertions ─────────────────────────────────────
  // Each of the three mutating routes (archive, pin, rename) must call
  // loadOwnedConversation() — enforcing ownership without duplicating the logic.

  it("archive route delegates ownership to loadOwnedConversation()", () => {
    const archiveRouteStart = routeSrc.indexOf("/conversations/:convId/archive");
    const pinRouteStart = routeSrc.indexOf("/conversations/:convId/pin");
    const archiveBlock = routeSrc.slice(archiveRouteStart, pinRouteStart);
    expect(archiveBlock).toContain("loadOwnedConversation(");
  });

  it("pin route delegates ownership to loadOwnedConversation()", () => {
    const pinRouteStart = routeSrc.indexOf("/conversations/:convId/pin");
    const renameRouteStart = routeSrc.indexOf("/conversations/:convId/rename");
    const pinRouteBlock = routeSrc.slice(pinRouteStart, renameRouteStart);
    expect(pinRouteBlock).toContain("loadOwnedConversation(");
  });

  it("rename route delegates ownership to loadOwnedConversation()", () => {
    const renameRouteStart = routeSrc.indexOf("/conversations/:convId/rename");
    const deleteRouteStart = routeSrc.indexOf("/conversations/:convId\",");
    const renameRouteBlock = routeSrc.slice(renameRouteStart, deleteRouteStart);
    expect(renameRouteBlock).toContain("loadOwnedConversation(");
  });

  it("pin route validates body with z.boolean()", () => {
    expect(routeSrc).toContain("z.boolean()");
  });

  it("rename route validates title with z.string().min(1).max(200)", () => {
    expect(routeSrc).toContain('z.string().min(1).max(200)');
  });
});

// ── DELETE /conversations/:convId source contract (Task 5) ────────────────────
describe("internal-agent runtime settings source contract", () => {
  const routeSrc = readFileSync(
    resolve(__dirname, "../routes/internal-agent.ts"),
    "utf8",
  );

  it("runtime settings route is company-access scoped but not founder-only", () => {
    const routeStart = routeSrc.indexOf("/internal-agent/runtime-settings");
    const nextRouteStart = routeSrc.indexOf("/internal-agent/tool-trust-rules", routeStart);
    const routeBlock = routeSrc.slice(routeStart, nextRouteStart);

    expect(routeStart).toBeGreaterThan(-1);
    expect(routeBlock).toContain("assertCompanyAccess");
    expect(routeBlock).not.toContain("assertRole");
    expect(routeBlock).toContain("runtimeAllowAlwaysEnabled");
  });
});

describe("internal-agent DELETE conversation route source contract (Task 5)", () => {
  const routeSrc = readFileSync(
    resolve(__dirname, "../routes/internal-agent.ts"),
    "utf8",
  );

  it("DELETE conversations/:convId route is registered", () => {
    // Matches router.delete("/companies/:companyId/internal-agent/conversations/:convId"
    expect(routeSrc).toMatch(/router\.delete\(\s*["']\/companies\/:companyId\/internal-agent\/conversations\/:convId["']/);
  });

  it("DELETE route delegates ownership to loadOwnedConversation()", () => {
    const deleteRouteStart = routeSrc.indexOf("/conversations/:convId\",");
    const messagesRouteStart = routeSrc.indexOf("/conversations/:convId/messages");
    const deleteRouteBlock = routeSrc.slice(deleteRouteStart, messagesRouteStart);
    expect(deleteRouteBlock).toContain("loadOwnedConversation(");
  });

  it("DELETE route responds with { ok: true }", () => {
    const deleteRouteStart = routeSrc.indexOf("/conversations/:convId\",");
    const messagesRouteStart = routeSrc.indexOf("/conversations/:convId/messages");
    const deleteRouteBlock = routeSrc.slice(deleteRouteStart, messagesRouteStart);
    expect(deleteRouteBlock).toContain("ok: true");
  });
});

// ── Commander skills route source contract (Task 5b) ─────────────────────────
describe("internal-agent Commander-scoped skills route source contract (Task 5b)", () => {
  const routeSrc = readFileSync(
    resolve(__dirname, "../routes/internal-agent.ts"),
    "utf8",
  );

  it("registers the Commander-scoped skills route", () => {
    expect(routeSrc).toContain('"/companies/:companyId/internal-agent/skills"');
  });

  it("scopes the skills route to the commander agent", () => {
    expect(routeSrc).toContain("ensureCommanderAgent");
    expect(routeSrc).toContain("listSkillListItemsForAgent");
  });
});

// ── Reorder + reset route source contract (Batch 2) ──────────────────────────
describe("internal-agent session reorder/reset route source contract (Batch 2)", () => {
  const routeSrc = readFileSync(
    resolve(__dirname, "../routes/internal-agent.ts"),
    "utf8",
  );

  it("registers PATCH reorder + DELETE order routes", () => {
    expect(routeSrc).toContain('"/companies/:companyId/internal-agent/conversations/reorder"');
    expect(routeSrc).toContain('"/companies/:companyId/internal-agent/conversations/order"');
  });

  it("registers reorder/order BEFORE the :convId routes (avoids path capture)", () => {
    const reorderIdx = routeSrc.indexOf("/conversations/reorder");
    const convIdDeleteIdx = routeSrc.indexOf('/conversations/:convId",');
    expect(reorderIdx).toBeGreaterThan(-1);
    expect(convIdDeleteIdx).toBeGreaterThan(-1);
    expect(reorderIdx).toBeLessThan(convIdDeleteIdx);
  });

  it("scopes reorder writes to the actor's own conversations (userId)", () => {
    const start = routeSrc.indexOf("/conversations/reorder");
    const end = routeSrc.indexOf("/conversations/order");
    const block = routeSrc.slice(start, end);
    expect(block).toContain("internalAgentConversations.userId");
    expect(block).toContain("actor.actorId");
  });

  it("reset clears sortOrder scoped to the actor's own conversations", () => {
    const start = routeSrc.indexOf("/conversations/order");
    const end = routeSrc.indexOf("/conversations/:convId/archive");
    const block = routeSrc.slice(start, end);
    expect(block).toContain("sortOrder: null");
    expect(block).toContain("internalAgentConversations.userId");
  });
});

describe("internal-agent-conversations sort_order column schema contract (Batch 2)", () => {
  const schemaSrc = readFileSync(
    resolve(__dirname, "../../../packages/db/src/schema/internal_agent.ts"),
    "utf8",
  );

  it("sort_order column exists (nullable integer) in internalAgentConversations", () => {
    expect(schemaSrc).toContain('integer("sort_order")');
  });
});

describe("internal-agent-conversations pinned column schema contract (Task 1)", () => {
  const schemaSrc = readFileSync(
    resolve(__dirname, "../../../packages/db/src/schema/internal_agent.ts"),
    "utf8",
  );

  it("pinned column exists in internalAgentConversations with DEFAULT false NOT NULL", () => {
    // Drizzle ORM form: boolean("pinned").notNull().default(false) or .default(false).notNull()
    expect(schemaSrc).toMatch(/boolean\("pinned"\)\.notNull\(\)\.default\(false\)|boolean\("pinned"\)\.default\(false\)\.notNull\(\)/);
  });
});
