import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: any[]) => a),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  desc: vi.fn((c: any) => ({ desc: c })),
  asc: vi.fn((c: any) => ({ asc: c })),
  inArray: vi.fn((c: any, v: any) => ({ inArray: [c, v] })),
  sql: Object.assign((s: any) => ({ sql: s }), {}),
}));
vi.mock("@armyofagents/db", () => ({
  discussions: { id: "d_id", companyId: "d_co" },
  discussionEntries: { id: "de_id", discussionId: "de_disc", authorAgentId: "de_agent", createdAt: "de_created" },
  discussionExtractedItems: { id: "dei_id", discussionEntryId: "dei_entry" },
  discussionAnnotations: { id: "da_id", discussionEntryId: "da_entry" },
  discussionEntryAttachments: {
    id: "dea_id",
    discussionEntryId: "dea_entry",
    assetId: "dea_asset",
    artifactId: "dea_artifact",
  },
  artifacts: { id: "art_id", type: "art_type", title: "art_title" },
  agents: { id: "ag_id", name: "ag_name", icon: "ag_icon" },
  projects: {}, goals: {},
  threadPlanSteps: { id: "tps_id", threadId: "tps_thread", stepOrder: "tps_order" },
}));
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("../services/issues.js", () => ({ issueService: vi.fn(() => ({})) }));
vi.mock("../services/memory.js", () => ({ memoryService: vi.fn(() => ({})) }));
vi.mock("../errors.js", () => ({
  badRequest: (m: string) => Object.assign(new Error(m), { status: 400 }),
  notFound: (m: string) => Object.assign(new Error(m), { status: 404 }),
}));

import { discussionService } from "../services/discussions.js";

function seqDb(queue: any[][]) {
  let i = 0;
  const sel = () => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    then: vi.fn((f: any) => Promise.resolve(f(queue[i++] ?? []))),
  });
  return { select: vi.fn(sel) } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("discussionService.getById — plan steps", () => {
  it("includes ordered planSteps in the thread detail payload", async () => {
    const db = seqDb([
      [{ id: "t1", companyId: "co1", summaryText: "s" }],  // discussion
      [{ entry: { id: "e1", discussionId: "t1", createdAt: "x", authorAgentId: null }, authorAgentName: null, authorAgentAvatar: null }], // entries join
      [{ id: "i1", discussionEntryId: "e1", type: "task", title: "T" }], // items
      [], // annotations
      [], // Phase E2: attachments
      [
        { id: "p1", threadId: "t1", stepOrder: 0, title: "Spec" },
        { id: "p2", threadId: "t1", stepOrder: 1, title: "Build" },
      ], // plan steps
    ]);
    const res: any = await discussionService(db).getById("co1", "t1");
    expect(res.planSteps.map((p: any) => p.title)).toEqual(["Spec", "Build"]);
    expect(res.entries[0].extractedItems[0].type).toBe("task");
  });

  it("returns empty planSteps when there are no plan steps", async () => {
    const db = seqDb([
      [{ id: "t1", companyId: "co1" }], // discussion
      [], // entries (empty)
      [], // plan steps (empty, no items so skipped)
    ]);
    const res: any = await discussionService(db).getById("co1", "t1");
    expect(res.planSteps).toEqual([]);
  });
});
