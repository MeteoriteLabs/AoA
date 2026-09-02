// server/src/services/e7-distributed-run-verifier.ts
//
// evidence-verifier A — the E7-1 distributed-run promotion gate (design v2).
//
// `E7-1-coding-journey` flips `unwired → wired` in `scripts/gate-clause-wiring.json`
// ONLY on a cited, dispatched, real-E2B run that completed the DISTRIBUTED journey.
// Today that citation is an operator eyeballing a database column, and every one of
// the campaign's ~6 arming prerequisites, if missing, produces a SILENT legacy
// fallback or an INERT handoff that terminalizes byte-indistinguishable from the
// golden journey (campaign plan §2, §7).
//
// This module mechanizes the promotion rule into a read-only verdict that refuses to
// bless a run unless it is provably the distributed journey — a worker leased it, ran
// it, and its terminal was projected. It FLIPS NO GATE; it produces the verdict a
// human cites when flipping the gate.
//
// SHAPE — mirrors `canary-preflight.ts` exactly: a PURE acceptance module over a
// `{ store }` port, with all drizzle in a separate adapter file
// (`e7-distributed-run-verifier-store.ts`). This module imports NO drizzle, so its
// fail-first unit tests are pure store-fixture units (CLAUDE.md drizzle-ESM split).
//
// SECURITY (Decision #104): A never receives, reads, or logs the E2B key / redeemed
// value. Clause 4 uses leak-CLASS matchers, so A needs no secret value; every
// failure reason and every `observed` field carries only SHAPE (ids, owner string,
// status, counts, matched-class name + field id) — NEVER a raw matched substring.

// ---------------------------------------------------------------------------
// The five clauses (design §2), grounded against the live schema (STEP 0):
//   1. Ownership          — heartbeat_runs.execution_owner === "distributed".
//   2. Evidence binding   — distributed_job_id AND distributed_attempt_id set.
//   3. Durably terminal   — isTerminal(status) AND finished_at set.
//   4. No leaked secret   — no provider-key / E2B / connection-string / PEM leaked
//                           into the run's real evidence surfaces.
//   5. Journey corroboration — a worker LEASED it, STARTED it, and its terminal was
//                           PROJECTED (the anti-false-PASS clause; new in v2).
//
// Clauses 1-5 answer ONE question: was the distributed journey corroborated — the
// MECHANISM. None of them reads `workload`, `args`, `exitCode`, stdout, or anything
// the agent produced, so a `claude` that exits 127 with no tools and a context-free
// prompt satisfies all five (E7-F003, pinned by a test).
//
//   6. Capability (SEPARATE DIMENSION — CLI-008 Unit A) — did anything the agent
//      produced reach AoA? Reported as `capabilityProven` / `capabilityFailures`,
//      NEVER folded into `ok`. See E7VerifyResult.capabilityProven for why.
// ---------------------------------------------------------------------------

/**
 * The terminal run-status vocabulary.
 *
 * SOURCE OF TRUTH: `server/src/services/heartbeat.ts` `TERMINAL_RUN_STATUSES`
 * (verified verbatim at STEP 0). It is copied here rather than imported because
 * `heartbeat.ts` imports drizzle / `@armyofagents/db`, and importing it would drag
 * drizzle into this PURE module (breaking the store-fixture test split). A dedicated
 * contract test (`e7-distributed-run-verifier-terminal-contract.test.ts`) imports the
 * real constant from `heartbeat.ts` and asserts deep equality, so a drift reddens CI.
 *
 * A drift here is FAIL-SAFE for a promotion gate: if `heartbeat.ts` gained a 5th
 * terminal status, clause 3 would refuse to bless a run heartbeat considers terminal
 * (an over-strict REFUSAL), never wrongly promote.
 */
export const E7_TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;

function isTerminalRunStatus(status: string): boolean {
  return (E7_TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

// --- The read-only store port (every method returns plain data) --------------

/** The heartbeat run under verification (decision fields only). */
export interface E7RunRow {
  readonly id: string;
  readonly companyId: string;
  readonly executionOwner: string | null;
  readonly distributedJobId: string | null;
  readonly distributedAttemptId: string | null;
  readonly status: string;
  readonly errorCode: string | null;
  readonly error: string | null;
  readonly finishedAt: Date | null;
}

/** The distributed attempt the run's ids name (`job_attempts`). */
export interface E7AttemptRow {
  readonly id: string;
  readonly organizationId: string;
  readonly companyId: string;
  readonly jobId: string;
  readonly status: string;
}

/** A lease over the attempt (`leases`; company_id is nullable at the kernel level). */
export interface E7LeaseRow {
  readonly id: string;
  readonly companyId: string | null;
  readonly status: string;
}

/** An accepted worker event for the attempt (`job_events`). */
export interface E7JobEventRow {
  readonly eventId: string;
  readonly companyId: string;
  readonly eventType: string;
  /** The raw PRT-004 event jsonb — scanned by clause 4 (never a dedicated key). */
  readonly payload: unknown;
}

/** The attempt-terminal projection receipt (`job_projection_receipts`). */
export interface E7AttemptTerminalReceiptRow {
  readonly projectionKind: string;
  readonly status: string;
  readonly companyId: string;
}

/**
 * One text blob to scan for a leaked secret. The adapter has ALREADY fetched the
 * text (it is raw at rest); the service matches leak-class patterns over it and
 * discards it. `surface`/`fieldOrEventId` are SHAPE only — safe to print.
 */
export interface E7ScanSurface {
  readonly surface: string;
  readonly fieldOrEventId: string;
  readonly text: string;
}

/** SHOULD-surface produced-output counts (advisory; a deliberate cancel pre-empts produce). */
export interface E7ProducedOutputCounts {
  readonly workspacePatchArtifacts: number;
  readonly taskOutputs: number;
}

/**
 * The read-only slice of the run + job-kernel state A needs. It exposes ONLY
 * SELECTs; no mutating member exists, so A structurally cannot change state as a
 * side effect of being consulted. NO key value ever crosses this port.
 */
export interface E7RunVerifierStore {
  getRun(runId: string): Promise<E7RunRow | null>;
  getAttempt(attemptId: string): Promise<E7AttemptRow | null>;
  listLeases(attemptId: string): Promise<readonly E7LeaseRow[]>;
  listJobEvents(attemptId: string): Promise<readonly E7JobEventRow[]>;
  getAttemptTerminalReceipt(attemptId: string): Promise<E7AttemptTerminalReceiptRow | null>;
  /** The non-event scan surfaces (heartbeat raw fields, task_outputs, job_artifacts, issue_comments). */
  listRunSecretScanSurfaces(run: E7RunRow): Promise<readonly E7ScanSurface[]>;
  countProducedOutputs(run: E7RunRow): Promise<E7ProducedOutputCounts>;
}

// --- The verdict -------------------------------------------------------------

export interface E7VerifyFailure {
  /**
   * Clauses 1-5 are the `ok` clauses — the distributed-journey corroboration.
   *
   * Clause 6 is the CAPABILITY clause and lives ONLY in `capabilityFailures`. It
   * must never be pushed into `failures`: doing so folds capability into `ok`, and
   * `producedArtifacts` is structurally 0 until CLI-008 Unit F ships output capture,
   * so `ok` would be permanently false — a gate nobody can pass. (A verifier test
   * pins that: `E7-F003 blind spot`.)
   */
  readonly clause: 1 | 2 | 3 | 4 | 5 | 6;
  /** SHAPE only — NEVER a raw matched secret substring. */
  readonly reason: string;
}

/** A broad-heuristic hit (advisory, NOT a hard fail): matched-class + field, never the value. */
export interface E7SuspectedHeuristicHit {
  readonly surface: string;
  readonly fieldOrEventId: string;
  readonly matchedClass: string;
  readonly count: number;
}

export interface E7VerifyObserved {
  readonly executionOwner: string | null;
  readonly distributedJobId: string | null;
  readonly distributedAttemptId: string | null;
  readonly companyId: string | null;
  readonly organizationId: string | null;
  readonly status: string | null;
  readonly errorCode: string | null;
  readonly finishedAt: string | null;
  readonly leaseCount: number;
  readonly attemptStartedEvents: number;
  readonly terminalEvents: number;
  readonly projectionReceiptApplied: boolean;
  readonly producedArtifacts: E7ProducedOutputCounts;
  readonly suspectedHeuristicHits: readonly E7SuspectedHeuristicHit[];
}

export interface E7VerifyResult {
  readonly ok: boolean;
  readonly runId: string;
  readonly notFound?: true;
  readonly failures: readonly E7VerifyFailure[];
  /**
   * Did the agent DO anything that reached AoA? Independent of `ok`, deliberately.
   * `ok` answers "was the distributed journey corroborated" — the MECHANISM. This answers
   * "could the agent work" — the CAPABILITY. They are different questions and E7-F003 exists
   * because one was being read as the other.
   *
   * FALSE ON EVERY REAL RUN TODAY, and that is the intended outcome of CLI-008 Unit A: the
   * verifier starts telling a truth it already had the data for. It becomes achievable when
   * Unit F builds a producer for `job_artifacts` / `task_outputs`.
   */
  readonly capabilityProven: boolean;
  readonly capabilityFailures: readonly E7VerifyFailure[];
  readonly observed: E7VerifyObserved;
}

export interface E7DistributedRunVerifier {
  verify(input: {
    runId: string;
    expected?: { organizationId?: string; companyId?: string };
  }): Promise<E7VerifyResult>;
}

const EMPTY_OBSERVED: E7VerifyObserved = {
  executionOwner: null,
  distributedJobId: null,
  distributedAttemptId: null,
  companyId: null,
  organizationId: null,
  status: null,
  errorCode: null,
  finishedAt: null,
  leaseCount: 0,
  attemptStartedEvents: 0,
  terminalEvents: 0,
  projectionReceiptApplied: false,
  producedArtifacts: { workspacePatchArtifacts: 0, taskOutputs: 0 },
  suspectedHeuristicHits: [],
};

// --- Clause 4 leak-class matchers -------------------------------------------
//
// LEAK-SPECIFIC (hard-FAIL), NOT the egress over-redactor. The redactor's broad
// pattern legitimately matches session ids / hashes in a CLEAN distributed run
// (fields are raw at rest; egress redaction over-redacts — design §8 HIGH), so a
// hard gate on it would false-positive and get overridden. A hard-fails only on
// classes the promotion rule names, and surfaces the broad heuristic as ADVISORY.
//
// The matchers are kept here (not imported from redaction.ts) so A's leak-class set
// is auditable in ONE place; each cites the `redaction.ts` pattern it mirrors.

interface LeakClassMatcher {
  readonly matchedClass: string;
  readonly re: RegExp;
}

const HARD_LEAK_MATCHERS: readonly LeakClassMatcher[] = [
  // Provider-key class — mirrors redaction.ts SECRET_VALUE_PATTERNS[1]. Verified to
  // cover the redeemed Company key (`sk-…` / `sk-ant-…`).
  { matchedClass: "provider_key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g },
  // Explicit E2B matcher — no E2B shape is fixed in the tree, so the generic pattern
  // misses infix forms. Catch the bare key …
  { matchedClass: "e2b_key", re: /\be2b_[A-Za-z0-9]{16,}\b/g },
  // … and the literal assignment, which catches an E2B key regardless of value shape.
  { matchedClass: "e2b_api_key_assignment", re: /E2B_API_KEY\s*[=:]/g },
  // Connection-string URIs — mirrors redaction.ts SECRET_VALUE_PATTERNS[0].
  {
    matchedClass: "connection_string",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|kafka|nats|mssql|sqlserver):\/\/[^\s<>'")]+/gi,
  },
  // PEM private-key block header — mirrors redaction.ts SECRET_VALUE_PATTERNS[7].
  { matchedClass: "private_key", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g },
];

// Broad heuristic (ADVISORY only) — mirrors redaction.ts SECRET_VALUE_PATTERNS[6].
// It matches innocuous `<prefix>_<20+>` session ids / hashes, so it is NEVER a hard
// fail — only surfaced for operator judgment.
const BROAD_HEURISTIC_MATCHER: LeakClassMatcher = {
  matchedClass: "broad_prefixed_token",
  re: /\b[A-Za-z][A-Za-z0-9]{1,}_[A-Za-z0-9]{20,}\b/g,
};

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Which HARD leak classes does this text trip? Returns matched-CLASS names only —
 * never the matched value. Exposed so a test can assert (anti-vacuity) that a planted
 * value trips a SPECIFIC arm in isolation — e.g. a bare `e2b_<16+>` value must trip
 * `e2b_key` and NOT the `e2b_api_key_assignment` arm, so the value arm is not tested
 * only by proxy through the assignment arm. Uses `String.match` (not `.test()`) so the
 * global regexes' `lastIndex` never carries between calls.
 */
export function detectHardLeakClasses(text: string): string[] {
  return HARD_LEAK_MATCHERS.filter((m) => text.match(m.re) !== null).map((m) => m.matchedClass);
}

interface HardHit {
  readonly surface: string;
  readonly fieldOrEventId: string;
  readonly matchedClass: string;
  readonly count: number;
}

/**
 * Scan every surface for leak-class matches. Returns SHAPE only — the match COUNT,
 * never the matched substring (`String.match` results are discarded). A global regex
 * used with `String.prototype.match` resets `lastIndex`, so module-level reuse is safe.
 */
function scanSurfacesForLeaks(surfaces: readonly E7ScanSurface[]): {
  hardHits: HardHit[];
  heuristicHits: E7SuspectedHeuristicHit[];
} {
  const hardHits: HardHit[] = [];
  const heuristicHits: E7SuspectedHeuristicHit[] = [];
  for (const s of surfaces) {
    for (const m of HARD_LEAK_MATCHERS) {
      const found = s.text.match(m.re);
      if (found && found.length > 0) {
        hardHits.push({ surface: s.surface, fieldOrEventId: s.fieldOrEventId, matchedClass: m.matchedClass, count: found.length });
      }
    }
    const broad = s.text.match(BROAD_HEURISTIC_MATCHER.re);
    if (broad && broad.length > 0) {
      heuristicHits.push({
        surface: s.surface,
        fieldOrEventId: s.fieldOrEventId,
        matchedClass: BROAD_HEURISTIC_MATCHER.matchedClass,
        count: broad.length,
      });
    }
  }
  return { hardHits, heuristicHits };
}

export function createE7DistributedRunVerifier(deps: {
  store: E7RunVerifierStore;
}): E7DistributedRunVerifier {
  const { store } = deps;

  return {
    async verify({ runId, expected }) {
      const run = await store.getRun(runId);
      if (!run) {
        return {
          ok: false,
          runId,
          notFound: true,
          failures: [],
          capabilityProven: false,
          capabilityFailures: [],
          observed: EMPTY_OBSERVED,
        };
      }

      const failures: E7VerifyFailure[] = [];

      // Clause 1 — Ownership. Only `null` (legacy) and `"distributed"` ever persist
      // (heartbeat_runs.executionOwner; sole writer buildHandoffRunPatch throws on
      // any other owner). Strict `=== "distributed"` can only refuse, never bless a
      // legacy run — but "not legacy" ≠ "the journey ran" (that is clause 5).
      if (run.executionOwner !== "distributed") {
        failures.push({
          clause: 1,
          reason: `execution_owner is ${run.executionOwner === null ? "null (legacy)" : JSON.stringify(run.executionOwner)}, not "distributed"`,
        });
      }

      // Clause 2 — Evidence binding. Both ids are written atomically with the marker,
      // so on a real row this never fails independently of clause 1; kept as a cheap
      // defense-in-depth null-check that BINDS the run to distributed evidence.
      const bothIds = run.distributedJobId !== null && run.distributedAttemptId !== null;
      if (!bothIds) {
        failures.push({
          clause: 2,
          reason: `distributed evidence ids incomplete (job_id=${run.distributedJobId ? "set" : "null"}, attempt_id=${run.distributedAttemptId ? "set" : "null"})`,
        });
      }

      // Clause 3 — Durably terminal. Terminal-AGNOSTIC: the golden journey ends in a
      // deliberate `cancelled`; `failed`/`timed_out` are accepted too, safe ONLY
      // because clause 5 proves a worker actually leased+ran.
      if (!isTerminalRunStatus(run.status) || run.finishedAt === null) {
        failures.push({
          clause: 3,
          reason: `not durably terminal (status=${run.status}, finished_at=${run.finishedAt ? "set" : "null"})`,
        });
      }

      // Clause 5 — Journey corroboration against the job kernel. Evaluated ONLY when
      // both ids are present; if not, clause 2 owns the failure and there is no
      // well-formed attempt id to corroborate (keeps each fixture to one clause).
      let attempt: E7AttemptRow | null = null;
      let leaseCount = 0;
      let attemptStartedEvents = 0;
      let terminalEvents = 0;
      let projectionReceiptApplied = false;
      let events: readonly E7JobEventRow[] = [];
      if (bothIds) {
        const attemptId = run.distributedAttemptId as string;
        const [attemptRow, leases, jobEvents, terminalReceipt] = await Promise.all([
          store.getAttempt(attemptId),
          store.listLeases(attemptId),
          store.listJobEvents(attemptId),
          store.getAttemptTerminalReceipt(attemptId),
        ]);
        attempt = attemptRow;
        events = jobEvents;

        // Tenant-match every corroborating row on company_id. leases.company_id is
        // nullable at the kernel level; a lease that carries a DIFFERENT company_id is
        // rejected, a null-company kernel lease is allowed (the attempt id is globally
        // unique, so the lease is tenant-bound by its composite FK regardless).
        const tenantLeases = leases.filter((l) => l.companyId === null || l.companyId === run.companyId);
        leaseCount = tenantLeases.length;
        const tenantEvents = events.filter((e) => e.companyId === run.companyId);
        attemptStartedEvents = tenantEvents.filter((e) => e.eventType === "attempt_started").length;
        terminalEvents = tenantEvents.filter((e) => e.eventType === "terminal").length;
        projectionReceiptApplied =
          terminalReceipt !== null &&
          terminalReceipt.projectionKind === "attempt_terminal" &&
          terminalReceipt.status === "applied" &&
          terminalReceipt.companyId === run.companyId;

        if (!attempt) {
          failures.push({ clause: 5, reason: "no job_attempts row names distributed_attempt_id (dangling handoff)" });
        } else {
          if (attempt.companyId !== run.companyId) {
            failures.push({ clause: 5, reason: "attempt tenant mismatch: job_attempts.company_id != heartbeat_runs.company_id" });
          }
          if (attempt.jobId !== run.distributedJobId) {
            failures.push({ clause: 5, reason: "attempt job binding mismatch: job_attempts.job_id != distributed_job_id" });
          }
        }
        if (leaseCount < 1) {
          failures.push({ clause: 5, reason: "no worker lease for the attempt (never-leased inert handoff — the v1 false-PASS)" });
        }
        if (attemptStartedEvents < 1) {
          failures.push({ clause: 5, reason: "no attempt_started job_event: no worker started the attempt" });
        }
        if (terminalEvents < 1) {
          failures.push({ clause: 5, reason: "no terminal job_event for the attempt" });
        }
        if (!projectionReceiptApplied) {
          failures.push({ clause: 5, reason: "no APPLIED attempt_terminal projection receipt (the projector did not run)" });
        }
        // A deliberate cancel must have revoked the fence (design §8 LOW 7).
        if (run.status === "cancelled" && !tenantLeases.some((l) => l.status === "revoked")) {
          failures.push({ clause: 5, reason: "cancelled terminal without a revoked lease (fence not revoked)" });
        }
      }

      // Optional operator assertion: the run belongs to the intended canary (§8 MED 5).
      // Folded into the tenant/identity family (clause 5).
      if (expected?.companyId !== undefined && run.companyId !== expected.companyId) {
        failures.push({ clause: 5, reason: "run company_id does not match the expected canary companyId" });
      }
      if (expected?.organizationId !== undefined && (attempt?.organizationId ?? null) !== expected.organizationId) {
        failures.push({ clause: 5, reason: "attempt organization_id does not match the expected canary organizationId" });
      }

      // Clause 4 — No leaked secret. Scan the run's real evidence surfaces with
      // leak-class matchers; hard-fail on a named class, surface the broad heuristic
      // as advisory. NEVER quotes a match (design §6 / §8 BLOCKER 3).
      const scanSurfaces = await store.listRunSecretScanSurfaces(run);
      const allSurfaces: E7ScanSurface[] = [
        ...events.map((e) => ({ surface: "job_events", fieldOrEventId: e.eventId, text: safeStringify(e.payload) })),
        ...scanSurfaces,
      ];
      const { hardHits, heuristicHits } = scanSurfacesForLeaks(allSurfaces);
      for (const h of hardHits) {
        failures.push({
          clause: 4,
          reason: `leaked ${h.matchedClass} in ${h.surface}#${h.fieldOrEventId} (${h.count} match${h.count === 1 ? "" : "es"})`,
        });
      }

      const produced = await store.countProducedOutputs(run);

      const observed: E7VerifyObserved = {
        executionOwner: run.executionOwner,
        distributedJobId: run.distributedJobId,
        distributedAttemptId: run.distributedAttemptId,
        companyId: run.companyId,
        organizationId: attempt?.organizationId ?? null,
        status: run.status,
        errorCode: run.errorCode,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        leaseCount,
        attemptStartedEvents,
        terminalEvents,
        projectionReceiptApplied,
        producedArtifacts: produced,
        suspectedHeuristicHits: heuristicHits,
      };

      // --- Clause 6 — CAPABILITY, computed beside the verdict and kept OUT of it ---
      //
      // `failures` / `ok` are NOT touched here. Deliberately: `producedArtifacts` is
      // structurally 0 until CLI-008 Unit F ships a producer, so a capability failure
      // folded into `ok` would make E7-1 permanently red — a gate nobody can pass gets
      // bypassed, argued around, or deleted (scripts/lib/gate-clause-wiring.mjs says so
      // in its own header), and it would retroactively invalidate the D1 40/40 evidence,
      // which is honest evidence OF THE MECHANISM and stays true.
      //
      // The CLI's `--require-capability` is where an operator opts INTO enforcing this.
      const capabilityFailures: E7VerifyFailure[] = [];
      if (produced.workspacePatchArtifacts < 1 && produced.taskOutputs < 1) {
        capabilityFailures.push({
          clause: 6,
          reason:
            "nothing the agent produced reached AoA: no committed workspace_patch job_artifact and no task_output " +
            "for this run. Output capture is UNBUILT (CLI-008 Unit F) — the E2B driver passes no stream handlers, " +
            "stdoutRef/stderrRef are fabricated literals rather than references to stored bytes, observeRun is " +
            "uncomposed, and buildWorkspacePatch/createResultCommitter have zero production callers. So this run " +
            "cannot be distinguished from a context-free one (E7-F003), whatever the agent actually did.",
        });
      }

      return {
        ok: failures.length === 0,
        runId,
        failures,
        capabilityProven: capabilityFailures.length === 0,
        capabilityFailures,
        observed,
      };
    },
  };
}

/**
 * Pure printer for the CLI — per-clause verdict + observed. Prints SHAPE only, never a raw secret.
 *
 * ★ The RESULT line is NEVER unqualified. It used to read "PASS — distributed journey
 * corroborated", which is accurate and was still read as "the canary works". Both dimensions
 * now appear on that one line, so neither can be quoted alone: a reader who sees only the
 * first line cannot come away believing capability was proven when it was not. The CAPABILITY
 * block below it prints on pass and fail alike — an unproven capability is exactly when it
 * matters, so it is never suppressed.
 */
export function formatVerifyResult(result: E7VerifyResult): string {
  const lines: string[] = [];
  lines.push(`evidence-verifier A — run ${result.runId}`);
  if (result.notFound) {
    lines.push("  RESULT: NOT FOUND — no heartbeat_runs row for this id");
    return lines.join("\n");
  }
  const mechanism = result.ok
    ? "PASS (mechanism) — distributed journey corroborated"
    : "FAIL (mechanism) — does NOT prove the distributed journey";
  const capability = result.capabilityProven
    ? "CAPABILITY: PROVEN — output from the agent reached AoA"
    : "CAPABILITY: NOT PROVEN — nothing the agent produced reached AoA";
  lines.push(`  RESULT: ${mechanism} | ${capability}`);
  const o = result.observed;
  lines.push("  observed:");
  lines.push(`    execution_owner=${o.executionOwner ?? "-"} job=${o.distributedJobId ?? "-"} attempt=${o.distributedAttemptId ?? "-"}`);
  lines.push(`    company=${o.companyId ?? "-"} org=${o.organizationId ?? "-"} status=${o.status ?? "-"} error_code=${o.errorCode ?? "-"} finished_at=${o.finishedAt ?? "-"}`);
  lines.push(`    leases=${o.leaseCount} attempt_started=${o.attemptStartedEvents} terminal_events=${o.terminalEvents} terminal_receipt_applied=${o.projectionReceiptApplied}`);
  // ALWAYS printed, on pass and fail alike — see the doc comment above.
  lines.push(
    `  capability: ${result.capabilityProven ? "PROVEN" : "NOT PROVEN"}` +
      ` (workspace_patch_artifacts=${o.producedArtifacts.workspacePatchArtifacts} task_outputs=${o.producedArtifacts.taskOutputs})`,
  );
  for (const f of result.capabilityFailures) {
    lines.push(`    clause ${f.clause}: ${f.reason}`);
  }
  if (o.suspectedHeuristicHits.length > 0) {
    lines.push("    advisory heuristic hits (NOT a gate — likely session ids/hashes):");
    for (const h of o.suspectedHeuristicHits) {
      lines.push(`      ${h.matchedClass} in ${h.surface}#${h.fieldOrEventId} (count ${h.count})`);
    }
  }
  if (result.failures.length > 0) {
    lines.push("  failing clauses:");
    for (const f of result.failures) {
      lines.push(`    clause ${f.clause}: ${f.reason}`);
    }
  }
  return lines.join("\n");
}
