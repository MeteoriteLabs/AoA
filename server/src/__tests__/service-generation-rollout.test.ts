// -----------------------------------------------------------------------------
// SVC-005a — the generation rollout fence's PURE half.
//
// Two things are proved here and neither needs a database:
//
//   (1) THE WITNESS CLASSIFICATION. Which terminal authors mean "the worker said it stopped"
//       and which mean "the control plane gave up on it" — the distinction the cross-generation
//       placement fence turns on, and therefore the distinction on which E9's SVC-005
//       acceptance clause is enforced or not enforced.
//   (2) THE THREE-WAY RECONCILIATION of the author list, which lives in THREE places for the
//       usual reason: `packages/db` does not depend on `worker-protocol` and the database CHECK
//       cannot import anything at all. A value present in one copy and absent from another is
//       either an author nothing can store or a value the fence has never classified — and the
//       second is the dangerous one, because an unclassified author read as a witness would
//       admit exactly the placement this fence exists to refuse.
//
// ★ THE FAIL-CLOSED DIRECTION IS ASSERTED, NOT ASSUMED. `WITNESSED_...` is a SUBSET derived by
// naming, so a fourth author added to the frozen list without being named a witness makes the
// fence STALL rather than pass. T-P4 pins that by construction rather than by inspection.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SERVICE_INSTANCE_TERMINAL_AUTHORS,
  WITNESSED_SERVICE_INSTANCE_TERMINAL_AUTHORS,
} from "@armyofagents/db";
import {
  ROLLABLE_DESIRED_STATES,
  findBlockingPredecessor,
  isWitnessedTerminalAuthor,
  type GenerationPredecessor,
} from "../services/service-generation-rollout.js";
import { SERVICE_DESIRED_STATES } from "@armyofagents/worker-protocol";

function predecessor(overrides: Partial<GenerationPredecessor>): GenerationPredecessor {
  return {
    serviceInstanceId: "11111111-1111-4111-8111-111111111111",
    generation: 1,
    status: "lost",
    terminalizedBy: "liveness_deadline",
    attemptStatus: "running",
    ...overrides,
  };
}

describe("SVC-005a — who counts as a witness that the old generation stopped", () => {
  // ── T-P1 — the one author that IS a witness ────────────────────────────────────────────
  //
  // MUTANT: add `"control_plane_backstop"` to `WITNESSED_SERVICE_INSTANCE_TERMINAL_AUTHORS`.
  // It is tempting because its precondition (a terminal attempt) really does close the fence —
  // but a closed fence stops the old worker WRITING, not its PROCESS (E9-F007 §3), and the
  // acceptance clause is about external effects. This case and T-P3 red under it.
  it("★ T-P1 — only the worker's own event is a witness", () => {
    expect(isWitnessedTerminalAuthor("worker_event")).toBe(true);
    expect(isWitnessedTerminalAuthor("liveness_deadline")).toBe(false);
    expect(isWitnessedTerminalAuthor("control_plane_backstop")).toBe(false);
  });

  // ── T-P2 — ★★★ NULL IS NOT A WITNESS, and this is the whole-fence fail-open ────────────
  //
  // A terminal row with a NULL author is one terminalized BEFORE migration 0279 — the control
  // plane has no idea who ended it. Reading that as a witness would admit a cross-generation
  // placement on no evidence at all, on every row that predates the column.
  //
  // MUTANT: `return author === null || WITNESSED.includes(author)` — i.e. treat unknown as
  // benign. This case reds; T-P1 stays green under it, which is why it is a separate case.
  it("★★★ T-P2 — an UNKNOWN author (NULL) is not a witness", () => {
    expect(isWitnessedTerminalAuthor(null)).toBe(false);
  });

  // ── T-P3 — the fence returns the row that blocked it ──────────────────────────────────
  it("★ T-P3 — an unwitnessed predecessor blocks, and is NAMED", () => {
    const blocked = predecessor({ serviceInstanceId: "22222222-2222-4222-8222-222222222222" });
    const found = findBlockingPredecessor([blocked]);
    expect(found).not.toBeNull();
    expect(found?.serviceInstanceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(found?.terminalizedBy).toBe("liveness_deadline");
  });

  it("★ T-P3b — a witnessed predecessor does NOT block", () => {
    expect(findBlockingPredecessor([predecessor({ terminalizedBy: "worker_event" })])).toBeNull();
  });

  // The first UNWITNESSED row wins, not the first row. A scan that returned `candidates[0]`
  // unconditionally would report a witnessed row as the blocker, which is a wrong diagnosis on
  // a real stall.
  it("★ T-P3c — a witnessed row ahead of an unwitnessed one does not mask it", () => {
    const found = findBlockingPredecessor([
      predecessor({ terminalizedBy: "worker_event", serviceInstanceId: "aaaaaaaa-0000-4000-8000-000000000001" }),
      predecessor({ terminalizedBy: null, serviceInstanceId: "aaaaaaaa-0000-4000-8000-000000000002" }),
    ]);
    expect(found?.serviceInstanceId).toBe("aaaaaaaa-0000-4000-8000-000000000002");
  });

  it("T-P3d — no candidates is a pass", () => {
    expect(findBlockingPredecessor([])).toBeNull();
  });

  // ── T-P4 — ★★★ AN UNCLASSIFIED AUTHOR STALLS ─────────────────────────────────────────
  //
  // The property, stated over the frozen list rather than over three hand-written names: every
  // author that is NOT explicitly named a witness must classify as one, so adding a fourth
  // author to `SERVICE_INSTANCE_TERMINAL_AUTHORS` without naming it a witness makes the fence
  // refuse rather than admit. Written as a loop over the SHIPPED list so it keeps holding
  // after that fourth author exists.
  it("★★★ T-P4 — every author not named a witness classifies as NOT a witness", () => {
    const witnesses = new Set<string>(WITNESSED_SERVICE_INSTANCE_TERMINAL_AUTHORS);
    for (const author of SERVICE_INSTANCE_TERMINAL_AUTHORS) {
      expect(isWitnessedTerminalAuthor(author), `author ${author}`).toBe(witnesses.has(author));
    }
    // And the subset relation itself: a "witness" that is not a storable author would be a
    // classification for a value the database refuses, i.e. dead.
    for (const witness of WITNESSED_SERVICE_INSTANCE_TERMINAL_AUTHORS) {
      expect(
        (SERVICE_INSTANCE_TERMINAL_AUTHORS as readonly string[]).includes(witness),
        `witness ${witness} is not a member of the frozen author list`,
      ).toBe(true);
    }
  });
});

// ── T-P5 — the THIRD copy: migration 0279's CHECK ────────────────────────────────────────
//
// `SERVICE_INSTANCE_TERMINAL_AUTHORS` (TypeScript), the schema's `check(...)` and the emitted
// migration DDL are three copies of one list, for the reason `service_instances_status_check`
// already has three: `packages/db` does not depend on `worker-protocol`, and SQL imports
// nothing. SVC-001 answered this by asserting the reconciliation server-side; so does this.
//
// SET EQUALITY, not containment, in BOTH directions — an EXTRA value in the CHECK is a value
// the fence has never classified, and an extra value in TypeScript is one the database will
// refuse at write time with a 23514 from inside a transaction that had already done work.
describe("SVC-005a — the author list agrees with the DDL that stores it", () => {
  const MIGRATION = fileURLToPath(
    new URL("../../../packages/db/src/migrations/0279_service_instance_terminalized_by.sql", import.meta.url),
  );

  it("★★★ T-P5 — migration 0279's CHECK admits EXACTLY the frozen author list", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = /terminalized_by IN \(([^)]*)\)/.exec(sql);
    expect(match, "the CHECK's IN-list was not found in 0279 — did the migration get renamed?")
      .not.toBeNull();
    const fromDdl = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...fromDdl].sort()).toEqual([...SERVICE_INSTANCE_TERMINAL_AUTHORS].sort());
  });

  // The NULL arm is the fail-closed half of the CHECK and is easy to lose in an edit: without
  // it the column would be effectively NOT NULL and every pre-0279 row would fail the
  // constraint, which would make the migration itself unappliable on a deployment with history.
  it("★ T-P5b — the CHECK admits NULL", () => {
    expect(readFileSync(MIGRATION, "utf8")).toContain("terminalized_by IS NULL OR");
  });
});

// ── T-P6 — the rollable desired states ──────────────────────────────────────────────────
describe("SVC-005a — which desired states may be rolled", () => {
  it("★ T-P6 — `deleted` is the only exclusion, and every entry is a frozen state", () => {
    expect([...ROLLABLE_DESIRED_STATES].sort()).toEqual(["paused", "running", "stopped"]);
    expect(ROLLABLE_DESIRED_STATES).not.toContain("deleted");
    for (const state of ROLLABLE_DESIRED_STATES) {
      expect((SERVICE_DESIRED_STATES as readonly string[]).includes(state), state).toBe(true);
    }
  });
});
