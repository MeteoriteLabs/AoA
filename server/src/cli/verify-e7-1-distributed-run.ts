#!/usr/bin/env tsx
// server/src/cli/verify-e7-1-distributed-run.ts
//
// evidence-verifier A — the operator entrypoint.
//
//   DATABASE_URL=... tsx server/src/cli/verify-e7-1-distributed-run.ts <runId> \
//       [--org <organizationId>] [--company <companyId>] [--require-capability]
//
// Reads a dispatched heartbeat run + its distributed-kernel evidence and prints the
// per-clause verdict. Exit 0 iff the run PROVABLY completed the distributed journey
// (a worker leased it, ran it, and its terminal was projected — with no leaked
// secret); exit 1 otherwise, naming the failing clause(s).
//
// ★ TWO DIMENSIONS, TWO EXIT CODES.
//
// `ok` (exit 0/1) answers "was the distributed journey corroborated" — the MECHANISM.
// It reads NOTHING about the workload, the argv, the exit code, stdout, or anything the
// agent produced, so a `claude` that exits 127 with no tools and a context-free prompt
// passes it (E7-F003). That is not a bug in `ok`; `ok` answers a different question.
//
// `capabilityProven` answers "did anything the agent produced reach AoA" — the
// CAPABILITY. It is ALWAYS printed and ALWAYS in `verdict-json`. `--require-capability`
// makes an unproven capability exit 3.
//
// --require-capability is OFF BY DEFAULT, deliberately. Output capture is unbuilt
// (CLI-008 Unit F: the E2B driver passes no stream handlers, stdoutRef/stderrRef are
// fabricated literals, observeRun is uncomposed, buildWorkspacePatch and
// createResultCommitter have zero production callers), so the counts are STRUCTURALLY
// zero and the flag on-by-default would be a gate nobody can pass — which in this
// repository is how a guard gets bypassed, argued around, and then deleted. This is the
// flag the campaign flips once Unit F lands; until then it is an operator opt-in, and
// the always-printed CAPABILITY line is what stops a green run being read as capability.
//
// Exit codes: 0 = verdict clean · 1 = mechanism FAIL (or an unreadable verifier)
//             2 = usage · 3 = mechanism PASS but capability unproven, with
//                            --require-capability set.
//
// This FLIPS NO GATE. It produces the machine-checkable verdict a human cites when
// deciding to flip `E7-1-coding-journey` in `scripts/gate-clause-wiring.json`. The
// full journey observation + non-canary isolation remain the operator's (design §5).
//
// RLS: the distributed kernel tables carry FORCE RLS. Run with a DATABASE_URL whose
// role can read the run's tenant rows; otherwise clause 5 fails SAFE-CLOSED (missing
// corroboration → refuse to bless), never a false PASS. It performs only SELECTs.
//
// SECURITY (Decision #104): A never receives or logs the E2B key / redeemed value.
// Clause 4 uses leak-CLASS matchers and prints match-class + field id + count only —
// never a raw matched substring.

import { createDb } from "@armyofagents/db";
import {
  createE7DistributedRunVerifier,
  e7VerifyExitCode,
  formatVerifyResult,
} from "../services/e7-distributed-run-verifier.js";
import { createDrizzleE7RunVerifierStore } from "../services/e7-distributed-run-verifier-store.js";

function parseArgs(argv: readonly string[]): {
  runId?: string;
  organizationId?: string;
  companyId?: string;
  requireCapability: boolean;
} {
  const out: { runId?: string; organizationId?: string; companyId?: string; requireCapability: boolean } = {
    requireCapability: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--org" || arg === "--organization") {
      out.organizationId = rest[++i];
    } else if (arg === "--company") {
      out.companyId = rest[++i];
    } else if (arg === "--require-capability") {
      out.requireCapability = true;
    } else if (!arg.startsWith("--") && out.runId === undefined) {
      out.runId = arg;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { runId, organizationId, companyId, requireCapability } = parseArgs(process.argv);

  if (!runId) {
    console.error(
      "usage: verify-e7-1-distributed-run <runId> [--org <organizationId>] [--company <companyId>] [--require-capability]",
    );
    process.exit(2);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }

  const db = createDb(dbUrl);
  const verifier = createE7DistributedRunVerifier({ store: createDrizzleE7RunVerifierStore(db) });

  const expected =
    organizationId || companyId ? { organizationId, companyId } : undefined;
  const result = await verifier.verify({ runId, expected });

  // Print the human-readable verdict + a machine-parseable JSON line (SHAPE only;
  // no raw secret can appear in either — see clause 4 / formatVerifyResult).
  console.log(formatVerifyResult(result));
  console.log(`\nverdict-json: ${JSON.stringify(result)}`);

  // The decision is a PURE function (`e7VerifyExitCode`) so every branch is reachable in a
  // test; reaching them here would need a live DATABASE_URL. This block only reports.
  const code = e7VerifyExitCode(result, requireCapability);
  if (code === 3) {
    console.error(
      "--require-capability: this run does NOT prove the agent could work (see the capability clause above)",
    );
  }
  process.exit(code);
}

void main().catch((error) => {
  // An unreadable verifier is NOT a bless. Fail closed with a non-promotion exit.
  console.error(`verify-e7-1-distributed-run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
