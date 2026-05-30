/**
 * Task 1.2 (Inbound Dirty-Data Routing) — classifyRouting + resolveRoutingAction
 *
 * Pure gate functions. No I/O. Table-driven.
 *
 * classifyRouting: 6 cases
 *   - uncomputable (available=false)
 *   - empty results → explicit_no_match
 *   - top within threshold, clear gap → attach_confident
 *   - top within threshold, near-tie (gap < AMBIGUITY_MARGIN) → ambiguous
 *   - top over threshold → explicit_no_match
 *   - top within threshold, no runner-up → unambiguous attach_confident
 *
 * resolveRoutingAction: 16 cells (4 outcomes × 4 levels)
 */
import { describe, expect, it } from "vitest";
import {
  classifyRouting,
  resolveRoutingAction,
} from "../services/inbox-router.js";
import {
  ATTACH_CONFIDENCE,
  AMBIGUITY_MARGIN,
} from "../services/inbound-routing-constants.js";

// ─── classifyRouting ──────────────────────────────────────────────────────────

describe("classifyRouting", () => {
  // Case 1: embedding unavailable → uncomputable (fail-closed, D2)
  it("returns uncomputable when available=false", () => {
    const result = classifyRouting({ available: false, results: [] });
    expect(result.outcome).toBe("uncomputable");
    expect(result.suggestedThreadId).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("returns uncomputable when available=false even with results present", () => {
    const result = classifyRouting({
      available: false,
      results: [{ threadId: "t-1", distance: 0.1 }],
    });
    expect(result.outcome).toBe("uncomputable");
    expect(result.suggestedThreadId).toBeNull();
    expect(result.confidence).toBeNull();
  });

  // Case 2: available=true but no results → explicit_no_match
  it("returns explicit_no_match when results is empty", () => {
    const result = classifyRouting({ available: true, results: [] });
    expect(result.outcome).toBe("explicit_no_match");
    expect(result.suggestedThreadId).toBeNull();
    expect(result.confidence).toBeNull();
  });

  // Case 3: top within threshold, gap >= AMBIGUITY_MARGIN → attach_confident
  it("returns attach_confident when top is within threshold and gap is clear", () => {
    // ATTACH_CONFIDENCE = 0.25, AMBIGUITY_MARGIN = 0.05
    // top=0.20, second=0.30 → gap=0.10 >= 0.05 ✓
    const top = 0.20;
    const second = top + AMBIGUITY_MARGIN + 0.01; // 0.26 — clearly above margin
    const result = classifyRouting({
      available: true,
      results: [
        { threadId: "t-1", distance: top },
        { threadId: "t-2", distance: second },
      ],
    });
    expect(result.outcome).toBe("attach_confident");
    expect(result.suggestedThreadId).toBe("t-1");
    expect(result.confidence).toBeCloseTo(1 - top);
  });

  // Case 4: top within threshold but near-tie (gap < AMBIGUITY_MARGIN) → ambiguous
  it("returns ambiguous when top is within threshold but near-tie with second", () => {
    // top=0.20, second=0.23 → gap=0.03 < 0.05 (AMBIGUITY_MARGIN) → ambiguous
    const top = 0.20;
    const second = top + AMBIGUITY_MARGIN - 0.02; // 0.23 — too close
    const result = classifyRouting({
      available: true,
      results: [
        { threadId: "t-1", distance: top },
        { threadId: "t-2", distance: second },
      ],
    });
    expect(result.outcome).toBe("ambiguous");
    expect(result.suggestedThreadId).toBe("t-1");
    expect(result.confidence).toBeCloseTo(1 - top);
  });

  // Case 5: top over ATTACH_CONFIDENCE threshold → explicit_no_match
  it("returns explicit_no_match when top distance exceeds ATTACH_CONFIDENCE", () => {
    // top=0.40 > ATTACH_CONFIDENCE(0.25) → no match
    const result = classifyRouting({
      available: true,
      results: [
        { threadId: "t-1", distance: 0.40 },
        { threadId: "t-2", distance: 0.50 },
      ],
    });
    expect(result.outcome).toBe("explicit_no_match");
    expect(result.suggestedThreadId).toBeNull();
    expect(result.confidence).toBeNull();
  });

  // Case 6: top within threshold but no runner-up → gap = Infinity → unambiguous
  it("returns attach_confident when only one result (no runner-up, infinite gap)", () => {
    // top=0.20 <= ATTACH_CONFIDENCE(0.25), no second → gap=Infinity >= 0.05 → confident
    const result = classifyRouting({
      available: true,
      results: [{ threadId: "t-solo", distance: 0.20 }],
    });
    expect(result.outcome).toBe("attach_confident");
    expect(result.suggestedThreadId).toBe("t-solo");
    expect(result.confidence).toBeCloseTo(0.80);
  });

  // Boundary: top exactly at ATTACH_CONFIDENCE → still qualifies as candidate
  it("classifies as candidate when top distance equals ATTACH_CONFIDENCE exactly", () => {
    const result = classifyRouting({
      available: true,
      results: [
        { threadId: "t-1", distance: ATTACH_CONFIDENCE },
        { threadId: "t-2", distance: ATTACH_CONFIDENCE + AMBIGUITY_MARGIN + 0.01 },
      ],
    });
    expect(result.outcome).toBe("attach_confident");
    expect(result.suggestedThreadId).toBe("t-1");
  });

  // Boundary: gap >= AMBIGUITY_MARGIN → attach_confident (using float-safe values)
  it("classifies as attach_confident when gap clearly exceeds AMBIGUITY_MARGIN", () => {
    // top=0.10, second=0.20 → gap=0.10 > AMBIGUITY_MARGIN(0.05) — float-safe.
    // Avoids testing the exact 0.05 boundary which is not representable in IEEE 754
    // when computed as (0.20+0.05) - 0.20.
    const result = classifyRouting({
      available: true,
      results: [
        { threadId: "t-1", distance: 0.10 },
        { threadId: "t-2", distance: 0.20 },
      ],
    });
    expect(result.outcome).toBe("attach_confident");
  });
});

// ─── resolveRoutingAction — full 4×4 = 16-cell decision table ────────────────

describe("resolveRoutingAction — 16-cell decision table", () => {
  // ── outcome: uncomputable — always human (fail-closed, D2) ──────────────────
  it("[uncomputable × off] → human", () => {
    expect(resolveRoutingAction({ level: "off", outcome: "uncomputable" })).toBe("human");
  });
  it("[uncomputable × suggest] → human", () => {
    expect(resolveRoutingAction({ level: "suggest", outcome: "uncomputable" })).toBe("human");
  });
  it("[uncomputable × auto_attach] → human", () => {
    expect(resolveRoutingAction({ level: "auto_attach", outcome: "uncomputable" })).toBe("human");
  });
  it("[uncomputable × full_auto] → human", () => {
    expect(resolveRoutingAction({ level: "full_auto", outcome: "uncomputable" })).toBe("human");
  });

  // ── outcome: attach_confident ────────────────────────────────────────────────
  it("[attach_confident × off] → human", () => {
    expect(resolveRoutingAction({ level: "off", outcome: "attach_confident" })).toBe("human");
  });
  it("[attach_confident × suggest] → suggest", () => {
    expect(resolveRoutingAction({ level: "suggest", outcome: "attach_confident" })).toBe("suggest");
  });
  it("[attach_confident × auto_attach] → auto_attach", () => {
    expect(resolveRoutingAction({ level: "auto_attach", outcome: "attach_confident" })).toBe("auto_attach");
  });
  it("[attach_confident × full_auto] → auto_attach", () => {
    expect(resolveRoutingAction({ level: "full_auto", outcome: "attach_confident" })).toBe("auto_attach");
  });

  // ── outcome: ambiguous — Navigator decides (D3) ──────────────────────────────
  it("[ambiguous × off] → human", () => {
    expect(resolveRoutingAction({ level: "off", outcome: "ambiguous" })).toBe("human");
  });
  it("[ambiguous × suggest] → escalate_navigator", () => {
    expect(resolveRoutingAction({ level: "suggest", outcome: "ambiguous" })).toBe("escalate_navigator");
  });
  it("[ambiguous × auto_attach] → escalate_navigator", () => {
    expect(resolveRoutingAction({ level: "auto_attach", outcome: "ambiguous" })).toBe("escalate_navigator");
  });
  it("[ambiguous × full_auto] → escalate_navigator", () => {
    expect(resolveRoutingAction({ level: "full_auto", outcome: "ambiguous" })).toBe("escalate_navigator");
  });

  // ── outcome: explicit_no_match — auto_create only at full_auto (D2) ──────────
  it("[explicit_no_match × off] → human", () => {
    expect(resolveRoutingAction({ level: "off", outcome: "explicit_no_match" })).toBe("human");
  });
  it("[explicit_no_match × suggest] → human", () => {
    expect(resolveRoutingAction({ level: "suggest", outcome: "explicit_no_match" })).toBe("human");
  });
  it("[explicit_no_match × auto_attach] → human", () => {
    expect(resolveRoutingAction({ level: "auto_attach", outcome: "explicit_no_match" })).toBe("human");
  });
  it("[explicit_no_match × full_auto] → auto_create", () => {
    expect(resolveRoutingAction({ level: "full_auto", outcome: "explicit_no_match" })).toBe("auto_create");
  });
});
