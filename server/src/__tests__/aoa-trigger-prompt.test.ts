// T1.2 — pure-function tests for buildTriggerPrompt (role-aware crew
// trigger prompt). Pins the per-role action directive table in code so
// a future edit can't quietly regress (e.g. switching Scribe's directive
// to "post_entry" and breaking extraction silently).
//
// Codex F1: prompt regression broke Maker → no posts. Codex F2: Scribe
// regression risk if the prompt's directive doesn't match its tool. Codex
// F6: dispatcher must pass wakeup.source through (covered in dispatcher
// integration tests; here we just assert the prompt CONTAINS whatever
// source is passed). Codex F7: role lookup is case-insensitive on the
// runtimeConfig.aoa.role key, not agent.name.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTriggerPrompt } from "../services/internal-agent/aoa-agents/aoa-trigger-prompt.js";

// Task 0.4 — ensure-adjutant instruction text (read raw so changes to
// the module don't require re-importing; the string constant is exported via
// the seedCrewAgent call, not directly, so read the source file directly).
const ENSURE_ADJUTANT_SRC = readFileSync(
  join(__dirname, "../services/internal-agent/aoa-agents/ensure-adjutant.ts"),
  "utf8"
);

const BASE_INSTRUCTION = "## Persona\nYou are a focused, terse agent.\n";

describe("buildTriggerPrompt (T1.2)", () => {
  describe("role-specific action directive", () => {
    it("scribe → submit_extracted_items directive (NOT post_entry)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "outbox", entryId: "e1" },
        agentName: "Scribe",
        agentRoleKey: "scribe",
      });
      expect(out).toContain("submit_extracted_items");
      // CRITICAL REGRESSION GUARD: must NOT tell Scribe to post_entry.
      // Doing so would break extraction (Scribe's allowlist doesn't have
      // post_entry; even if it did, calling it would skip extraction).
      expect(out).not.toContain("post_entry");
    });

    it("maker → post_entry directive with parentEntryId reference", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention", entryId: "e1", mention: "@Maker" },
        agentName: "Maker",
        agentRoleKey: "maker",
      });
      expect(out).toContain("post_entry");
      expect(out).toContain("parentEntryId");
    });

    it("adjutant → propose_crew_work at convergence (Task 0.4)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "sweep.adjutant" },
        agentName: "Adjutant",
        agentRoleKey: "adjutant",
      });
      // Must mention the new propose_crew_work tool and scope-proposing
      expect(out).toContain("propose_crew_work");
      // advance_phase is still valid for phase transitions
      expect(out).toContain("advance_phase");
      // Silence must be explicitly correct (not a bug)
      expect(out).toMatch(/silence is correct/i);
    });

    it("adjutant → does NOT carry the 'returning is a bug' forcing clause (Task 0.4)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "sweep.adjutant" },
        agentName: "Adjutant",
        agentRoleKey: "adjutant",
      });
      // The old forcing clause said returning without the directed action is a bug.
      // This must be removed — silence is the correct behavior when idle.
      expect(out).not.toMatch(/returning without taking the directed action is a bug/i);
    });

    it("router → post_entry with department recommendation", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "phase-advance" },
        agentName: "Router",
        agentRoleKey: "router",
      });
      expect(out).toContain("post_entry");
      expect(out).toContain("department");
    });

    it("planner → post_entry with plan", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "phase-advance" },
        agentName: "Planner",
        agentRoleKey: "planner",
      });
      expect(out).toContain("post_entry");
      expect(out).toContain("plan");
    });

    it("dispatcher → create_task + assign_task + add_task_dependency", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "phase-advance" },
        agentName: "Dispatcher",
        agentRoleKey: "dispatcher",
      });
      expect(out).toContain("create_task");
      expect(out).toContain("assign_task");
      expect(out).toContain("add_task_dependency");
    });

    it("memory_keeper → suggest_memory (propose-only)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "event" },
        agentName: "Memory Keeper",
        agentRoleKey: "memory_keeper",
      });
      expect(out).toContain("suggest_memory");
      expect(out).toContain("propose-only");
    });

    it("commander → post_entry with synthesis", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention", mention: "@Commander" },
        agentName: "Commander",
        agentRoleKey: "commander",
      });
      expect(out).toContain("post_entry");
      expect(out).toContain("synthesis");
    });

    it("unknown role → generic directive (no crash)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention" },
        agentName: "MysteryAgent",
        agentRoleKey: "mystery",
      });
      expect(out).toContain("use the tools in your allowlist");
    });

    it("case-insensitive role lookup (per codex F7 — runtimeConfig may have mixed case)", () => {
      const lower = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "outbox" },
        agentName: "X", agentRoleKey: "scribe",
      });
      const upper = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "outbox" },
        agentName: "X", agentRoleKey: "SCRIBE",
      });
      const mixed = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "outbox" },
        agentName: "X", agentRoleKey: "Scribe",
      });
      // All three should resolve to the same directive
      expect(lower).toContain("submit_extracted_items");
      expect(upper).toContain("submit_extracted_items");
      expect(mixed).toContain("submit_extracted_items");
    });
  });

  describe("trigger context block", () => {
    it("includes trigger source verbatim (codex F6 dispatcher pass-through)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention" },
        agentName: "Maker", agentRoleKey: "maker",
      });
      expect(out).toContain("Trigger source: thread_mention");
    });

    it("includes threadId, entryId, mention when present", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: {
          companyId: "co", source: "thread_mention",
          threadId: "thr-1", entryId: "entry-42", mention: "@Maker",
        },
        agentName: "Maker", agentRoleKey: "maker",
      });
      expect(out).toContain("Thread: thr-1");
      expect(out).toContain("Inviting entry: entry-42");
      expect(out).toContain("Mention: @Maker");
    });

    it("omits absent fields (no 'undefined' lines confusing the LLM)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "sweep" }, // no threadId, no entry, no mention
        agentName: "Adjutant", agentRoleKey: "adjutant",
      });
      expect(out).not.toContain("undefined");
      expect(out).not.toContain("Thread:");
      expect(out).not.toContain("Inviting entry:");
      expect(out).not.toContain("Mention:");
    });

    it("includes routed role when present", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "phase-advance", role: "dispatcher" },
        agentName: "Dispatcher", agentRoleKey: "dispatcher",
      });
      expect(out).toContain("Routed role: dispatcher");
    });
  });

  describe("structure", () => {
    it("instruction bundle precedes the trigger context block", () => {
      const out = buildTriggerPrompt({
        instruction: "## INSTRUCTION_MARKER\n",
        payload: { companyId: "co", source: "outbox" },
        agentName: "Scribe", agentRoleKey: "scribe",
      });
      const instructionIdx = out.indexOf("INSTRUCTION_MARKER");
      const wakeupIdx = out.indexOf("## This wakeup");
      expect(instructionIdx).toBeGreaterThanOrEqual(0);
      expect(wakeupIdx).toBeGreaterThan(instructionIdx);
    });

    it("agent name appears in the directive sentence", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention" },
        agentName: "Maker", agentRoleKey: "maker",
      });
      expect(out).toContain("You are Maker");
    });

    it("escape hatch for uncertainty (surfaces feedback to the human)", () => {
      const out = buildTriggerPrompt({
        instruction: BASE_INSTRUCTION,
        payload: { companyId: "co", source: "thread_mention" },
        agentName: "Maker", agentRoleKey: "maker",
      });
      // Match the actual prompt language: "surfaces feedback to the human"
      // (was "ask the human" but that copy got reworded to not mention
      // post_entry by name — the Scribe regression test forbids that)
      expect(out).toMatch(/surfaces? feedback to the human/i);
    });
  });
});

// Task 1.7 — inbox-routing trigger prompt
describe("buildTriggerPrompt (T1.7) — inbox.routing_ambiguous", () => {
  it("renders inboxItemId, candidateThreadIds with distances, and ambiguity gap", () => {
    const out = buildTriggerPrompt({
      instruction: "BUNDLE",
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: {
        companyId: "co-1",
        source: "inbox.routing_ambiguous",
        inboxItemId: "inbox-1",
        candidateThreadIds: ["thread-a", "thread-b"],
        distances: [0.12, 0.34],
        gap: 0.22,
      },
    });
    // Inbox item ID must appear
    expect(out).toContain("inbox-1");
    // Both candidate thread IDs must appear
    expect(out).toContain("thread-a");
    expect(out).toContain("thread-b");
    // Distances rendered to 3 decimal places
    expect(out).toContain("0.120");
    expect(out).toContain("0.340");
    // Gap rendered to 3 decimal places
    expect(out).toContain("0.220");
  });

  it("contains attach_to_thread and spin_off_thread in the directive", () => {
    const out = buildTriggerPrompt({
      instruction: "BUNDLE",
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: {
        companyId: "co-1",
        source: "inbox.routing_ambiguous",
        inboxItemId: "inbox-1",
        candidateThreadIds: ["thread-a"],
        distances: [0.15],
        gap: null,
      },
    });
    expect(out).toContain("attach_to_thread");
    expect(out).toContain("spin_off_thread");
  });

  it("uses the inbox-routing directive — not the generic navigator role directive", () => {
    const out = buildTriggerPrompt({
      instruction: "BUNDLE",
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: {
        companyId: "co-1",
        source: "inbox.routing_ambiguous",
        inboxItemId: "inbox-1",
        candidateThreadIds: ["thread-a", "thread-b"],
        distances: [0.12, 0.34],
        gap: 0.22,
      },
    });
    // Distinctive phrase from INBOX_ROUTING_DIRECTIVE
    expect(out).toContain("An inbound item needs routing");
    // The generic navigator ROLE_ACTION_DIRECTIVE must NOT appear instead
    expect(out).not.toContain("decide whether to `attach_to_thread`");
  });

  it("guard case: empty candidateThreadIds + no gap still renders without throwing", () => {
    const out = buildTriggerPrompt({
      instruction: "BUNDLE",
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: {
        companyId: "co-1",
        source: "inbox.routing_ambiguous",
        inboxItemId: "inbox-2",
        candidateThreadIds: [],
        distances: [],
        gap: undefined,
      },
    });
    // Must still contain the inbox item ID
    expect(out).toContain("inbox-2");
    // Must not crash or produce "undefined"
    expect(out).not.toContain("undefined");
    // Candidate threads line should be absent (empty array)
    expect(out).not.toContain("Candidate threads:");
    // Gap line should be absent (undefined / not a finite number)
    expect(out).not.toContain("Ambiguity gap:");
  });

  it("guard case: gap=null renders without gap line", () => {
    const out = buildTriggerPrompt({
      instruction: "BUNDLE",
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: {
        companyId: "co-1",
        source: "inbox.routing_ambiguous",
        inboxItemId: "inbox-3",
        candidateThreadIds: ["thread-x"],
        distances: [0.25],
        gap: null,
      },
    });
    expect(out).toContain("inbox-3");
    expect(out).toContain("thread-x");
    expect(out).not.toContain("Ambiguity gap:");
  });

  it("non-inbox navigator wakeup still uses the role-table directive (regression guard)", () => {
    const out = buildTriggerPrompt({
      instruction: BASE_INSTRUCTION,
      agentName: "Navigator",
      agentRoleKey: "navigator",
      payload: { companyId: "co", source: "thread_mention", mention: "@Navigator" },
    });
    // Role-table directive for 'navigator' must appear
    expect(out).toContain("attach_to_thread");
    // But the inbox-routing opener must NOT appear for a non-inbox trigger
    expect(out).not.toContain("An inbound item needs routing");
  });
});

// Task 0.4 — ensure-adjutant stale-framing guard
describe("ensure-adjutant instruction (Task 0.4)", () => {
  it("does NOT contain stale 'Dispatcher and Engineer take over' framing", () => {
    // The Dispatcher card-making role is retired in a later task.
    // The Adjutant now proposes work directly via propose_crew_work.
    expect(ENSURE_ADJUTANT_SRC).not.toMatch(/Dispatcher.*take over/i);
  });

  it("does NOT reference Dispatcher taking over at the scope transition", () => {
    // Even partial "Dispatcher … take over" in any form is stale
    expect(ENSURE_ADJUTANT_SRC).not.toMatch(/Dispatcher[^.]*take over/i);
  });
});
