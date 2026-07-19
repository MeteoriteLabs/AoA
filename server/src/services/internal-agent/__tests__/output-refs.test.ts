// server/src/services/internal-agent/__tests__/output-refs.test.ts
import { describe, it, expect } from "vitest";
import { buildOutputRefs, mergeOutputRefs, collectChunkRefs } from "../output-refs.js";
import type { OutputRefEmitCtx } from "../output-refs.js";
import { showRefsSchema } from "@armyofagents/shared";
import type { CommanderOutputRef } from "@armyofagents/shared";

const ok = (data: unknown) => ({ success: true, data, summary: "ok" });

// Emission context factory: a fresh per-ref seq allocator + a provenance base.
const emitCtx = (
  overrides: Partial<OutputRefEmitCtx["provenanceBase"] & object> = {},
): OutputRefEmitCtx => {
  let seq = 0;
  return {
    provenanceBase: {
      surface: "commander",
      entityId: "conv-1",
      runId: "run-1",
      agentId: null,
      messageId: null,
      emittedAt: "2026-07-19T10:00:00.000Z",
      ...overrides,
    },
    nextSeq: () => seq++,
  };
};

describe("buildOutputRefs", () => {
  it("create_artifact → created v2 ref; title from params; provenance:null when no ctx", () => {
    const refs = buildOutputRefs(
      "create_artifact",
      { title: "GTM Plan", type: "document" },
      ok({ artifactId: "art-1", versionId: "ver-1" }),
    );
    expect(refs).toEqual([
      expect.objectContaining({
        v: 2, kind: "artifact", id: "art-1", versionId: "ver-1",
        title: "GTM Plan", action: "created", provenance: null,
      }),
    ]);
  });

  it("with an emission ctx → v2 ref carries commander provenance (surface/entity/run)", () => {
    const refs = buildOutputRefs(
      "create_artifact",
      { title: "GTM Plan", type: "document" },
      ok({ artifactId: "art-1", versionId: "ver-1" }),
      emitCtx(),
    );
    expect(refs[0]).toMatchObject({
      v: 2,
      provenance: {
        surface: "commander",
        entityId: "conv-1",
        runId: "run-1",
        seq: 0,
      },
    });
  });

  it("multi-row query_artifacts → each ref gets a distinct, contiguous seq (0,1,2…)", () => {
    const refs = buildOutputRefs(
      "query_artifacts",
      { threadId: "t1" },
      ok([
        { artifactId: "a1", title: "One", currentVersionId: "v1" },
        { artifactId: "a2", title: "Two", currentVersionId: "v2" },
        { artifactId: "a3", title: "Three", currentVersionId: "v3" },
      ]),
      emitCtx(),
    );
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => (r as any).provenance.seq)).toEqual([0, 1, 2]);
  });

  it("null conversationId (entityId) in the ctx → provenance:null (still v2, never v1)", () => {
    const refs = buildOutputRefs(
      "create_artifact",
      { title: "X" },
      ok({ artifactId: "art-1", versionId: "ver-1" }),
      emitCtx({ entityId: null }),
    );
    expect(refs[0]).toMatchObject({ v: 2, provenance: null });
  });

  it("create_artifact_version → created ref; artifactId from params, versionNumber from data", () => {
    const refs = buildOutputRefs(
      "create_artifact_version",
      { artifactId: "art-1", content: "..." },
      ok({ versionId: "ver-2", versionNumber: 2 }),
    );
    expect(refs[0]).toMatchObject({ id: "art-1", versionId: "ver-2", versionNumber: 2, action: "created" });
  });

  it("query_artifacts → referenced ref per row, currentVersionId mapped to versionId", () => {
    const refs = buildOutputRefs("query_artifacts", { threadId: "t1" }, ok([
      { artifactId: "a1", title: "One", type: "document", currentVersionId: "v1", status: "active" },
      { artifactId: "a2", title: "Two", type: "report", currentVersionId: null, status: "draft" },
    ]));
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ id: "a1", versionId: "v1", title: "One", action: "referenced" });
  });

  it("query_company_artifacts maps like query_artifacts", () => {
    const refs = buildOutputRefs("query_company_artifacts", {}, ok([
      { artifactId: "a9", title: "Nine", type: "code", currentVersionId: "v9", status: "active" },
    ]));
    expect(refs[0]).toMatchObject({ id: "a9", action: "referenced" });
  });

  it("get_task → referenced ref iff artifactId non-null", () => {
    expect(buildOutputRefs("get_task", { taskId: "t1" }, ok({ artifactId: "a1", title: "Fix auth" })))
      .toHaveLength(1);
    expect(buildOutputRefs("get_task", { taskId: "t1" }, ok({ artifactId: null, title: "Fix auth" })))
      .toHaveLength(0);
  });

  it("unknown tool, failed result, malformed data → []", () => {
    expect(buildOutputRefs("post_entry", {}, ok({ entryId: "e1" }))).toEqual([]);
    expect(buildOutputRefs("create_artifact", { title: "X" }, { success: false, data: null, summary: "no", error: "E" })).toEqual([]);
    expect(buildOutputRefs("create_artifact", null, ok("not-an-object"))).toEqual([]);
    expect(buildOutputRefs("query_artifacts", {}, ok({ not: "an array" }))).toEqual([]);
  });

  it("clamps long titles to 200 chars", () => {
    const refs = buildOutputRefs("create_artifact", { title: "x".repeat(500) }, ok({ artifactId: "a1", versionId: null }));
    expect(refs[0]!.title).toHaveLength(200);
  });

  // Step 4: attach_task_artifact — verified return shape uses artifactId + versionId directly
  // (attach-task-artifact-tool.ts lines 170-178: data: { artifactId, versionId, taskOutputId })
  it("attach_task_artifact → created ref with artifactId + versionId from data", () => {
    const refs = buildOutputRefs(
      "attach_task_artifact",
      { taskId: "t1", artifactId: "art-99", title: "Spec v1" },
      ok({ artifactId: "art-99", versionId: "ver-5", taskOutputId: "to-1" }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "artifact",
      id: "art-99",
      versionId: "ver-5",
      title: "Spec v1",
      action: "created",
    });
  });

  it("attach_task_artifact with null versionId still emits ref", () => {
    const refs = buildOutputRefs(
      "attach_task_artifact",
      { taskId: "t1", artifactId: "art-2", title: "Brief" },
      ok({ artifactId: "art-2", versionId: null, taskOutputId: null }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ id: "art-2", versionId: null, action: "created" });
  });
});

describe("mergeOutputRefs", () => {
  const ref = (id: string, action: "created" | "referenced", versionId: string | null = null): CommanderOutputRef =>
    ({ v: 1, kind: "artifact", id, versionId, action });

  it("dedupes by (kind,id,versionId); created beats referenced", () => {
    const merged = mergeOutputRefs([ref("a1", "referenced")], [ref("a1", "created")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.action).toBe("created");
  });

  it("different versionIds are distinct refs", () => {
    expect(mergeOutputRefs([ref("a1", "created", "v1")], [ref("a1", "created", "v2")])).toHaveLength(2);
  });

  it("caps at 20 with created surviving first", () => {
    const referenced = Array.from({ length: 25 }, (_, i) => ref(`r${i}`, "referenced"));
    const created = [ref("c1", "created"), ref("c2", "created")];
    const merged = mergeOutputRefs(referenced, created);
    expect(merged).toHaveLength(20);
    expect(merged.filter((r) => r.action === "created")).toHaveLength(2);
  });
});

describe("mergeOutputRefs v1/v2 coalescing + field-wise provenance precedence", () => {
  const prov = (emittedAt: string, seq = 0) => ({
    surface: "commander" as const,
    entityId: "conv-1",
    runId: "run-1",
    agentId: null,
    messageId: null,
    seq,
    emittedAt,
  });
  const v1 = (
    id: string,
    action: "created" | "referenced",
    versionId: string | null = null,
    title: string | null = null,
  ): any => ({ v: 1, kind: "artifact", id, versionId, action, title });
  const v2 = (
    id: string,
    action: "created" | "referenced",
    provenance: ReturnType<typeof prov> | null = null,
    versionId: string | null = null,
    title: string | null = null,
  ): any => ({ v: 2, kind: "artifact", id, versionId, action, title, provenance });

  const EARLY = "2026-07-19T10:00:00.000Z";
  const LATE = "2026-07-19T11:00:00.000Z";

  it("v1-created + v2-referenced (v1 first) → ONE entry: created + v2's provenance + v:2", () => {
    const merged = mergeOutputRefs([v1("a1", "created")], [v2("a1", "referenced", prov(EARLY))]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      v: 2,
      action: "created",
      provenance: { emittedAt: EARLY, surface: "commander" },
    });
  });

  it("v2-referenced + v1-created (v2 first) → coalesces IDENTICALLY (order-independent — Codex P2.1)", () => {
    const merged = mergeOutputRefs([v2("a1", "referenced", prov(EARLY))], [v1("a1", "created")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      v: 2,
      action: "created",
      provenance: { emittedAt: EARLY, surface: "commander" },
    });
  });

  it("two v2 created refs, differing emittedAt → newer emittedAt wins (both orders)", () => {
    const older = v2("a1", "created", prov(EARLY));
    const newer = v2("a1", "created", prov(LATE));
    expect((mergeOutputRefs([older], [newer])[0] as any).provenance.emittedAt).toBe(LATE);
    expect((mergeOutputRefs([newer], [older])[0] as any).provenance.emittedAt).toBe(LATE);
  });

  it("a real provenance beats a null one (both orders)", () => {
    const withProv = v2("a1", "created", prov(EARLY));
    const noProv = v2("a1", "created", null);
    expect((mergeOutputRefs([noProv], [withProv])[0] as any).provenance.emittedAt).toBe(EARLY);
    expect((mergeOutputRefs([withProv], [noProv])[0] as any).provenance.emittedAt).toBe(EARLY);
  });

  it("same-artifact v1 + v2 → exactly one card (coalesced, not two)", () => {
    expect(mergeOutputRefs([v1("a1", "referenced")], [v2("a1", "referenced", prov(EARLY))])).toHaveLength(1);
  });

  it("backfills title first-non-empty across a v1/v2 collision (same versionId)", () => {
    const merged = mergeOutputRefs(
      [v1("a1", "created", "ver-9", null)],
      [v2("a1", "referenced", prov(EARLY), "ver-9", "From V2")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ v: 2, action: "created", title: "From V2", versionId: "ver-9" });
  });

  it("emitted merge output still validates against the shared schema", () => {
    const merged = mergeOutputRefs([v1("a1", "created")], [v2("a1", "referenced", prov(EARLY))]);
    expect(showRefsSchema.safeParse(merged).success).toBe(true);
  });
});

describe("review-promoted edge cases", () => {
  const ok = (data: unknown) => ({ success: true, data, summary: "ok" });

  it("query path dedupes duplicate rows BEFORE capping (no distinct ref lost)", () => {
    const dup = { artifactId: "dup", title: "Dup", type: "document", currentVersionId: "v1", status: "active" };
    const rows = [...Array.from({ length: 21 }, () => dup), { artifactId: "distinct", title: "Distinct", type: "report", currentVersionId: null, status: "draft" }];
    const refs = buildOutputRefs("query_artifacts", {}, ok(rows));
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.id)).toContain("distinct");
  });

  it("mergeOutputRefs backfills title in both directions", () => {
    const created = (title: string | null) => ({ v: 1, kind: "artifact", id: "a1", versionId: null, action: "created", title } as any);
    const referenced = (title: string | null) => ({ v: 1, kind: "artifact", id: "a1", versionId: null, action: "referenced", title } as any);
    // created (no title) first, referenced (title) second → stays created, adopts title
    const m1 = mergeOutputRefs([created(null)], [referenced("From Ref")]);
    expect(m1[0]).toMatchObject({ action: "created", title: "From Ref" });
    // referenced (title) first, created (no title) second → becomes created, keeps title
    const m2 = mergeOutputRefs([referenced("Kept")], [created(null)]);
    expect(m2[0]).toMatchObject({ action: "created", title: "Kept" });
  });

  it("builder output always validates against the shared schema", () => {
    const cases = [
      buildOutputRefs("create_artifact", { title: "T", type: "document" }, ok({ artifactId: "a1", versionId: "v1" })),
      buildOutputRefs("get_task", { taskId: "t" }, ok({ artifactId: "a1", title: "Task title" })),
      buildOutputRefs("query_artifacts", {}, ok([{ artifactId: "a1", title: "Q", type: "code", currentVersionId: null, status: "active" }])),
    ];
    for (const refs of cases) {
      expect(showRefsSchema.safeParse(refs).success).toBe(true);
    }
  });

  it("create_artifact infers versionNumber 1 only when versionId present", () => {
    expect(buildOutputRefs("create_artifact", { title: "T" }, ok({ artifactId: "a1", versionId: "v1" }))[0]!.versionNumber).toBe(1);
    expect(buildOutputRefs("create_artifact", { title: "T" }, ok({ artifactId: "a1", versionId: null }))[0]!.versionNumber).toBeNull();
  });
});

describe("collectChunkRefs", () => {
  const created = { v: 1, kind: "artifact", id: "a1", action: "created" } as any;
  it("collects refs from tool_result chunks and ignores everything else", () => {
    const sink: any[] = [];
    collectChunkRefs(sink, { type: "tool_result", name: "mcp__aoa__create_artifact", result: { success: true, data: null, summary: "" }, refs: [created] } as any);
    collectChunkRefs(sink, { type: "text", delta: "hi" } as any);
    collectChunkRefs(sink, { type: "tool_result", name: "post_entry", result: { success: true, data: null, summary: "" } } as any);
    expect(sink).toHaveLength(1);
  });
});
