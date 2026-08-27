#!/usr/bin/env tsx
// server/src/cli/verify-e7-1-distributed-run.ts
//
// evidence-verifier A — the operator entrypoint.
//
//   DATABASE_URL=... tsx server/src/cli/verify-e7-1-distributed-run.ts <runId> \
//       [--org <organizationId>] [--company <companyId>]
//
// Reads a dispatched heartbeat run + its distributed-kernel evidence and prints the
// per-clause verdict. Exit 0 iff the run PROVABLY completed the distributed journey
// (a worker leased it, ran it, and its terminal was projected — with no leaked
// secret); exit 1 otherwise, naming the failing clause(s).
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
import { createE7DistributedRunVerifier, formatVerifyResult } from "../services/e7-distributed-run-verifier.js";
import { createDrizzleE7RunVerifierStore } from "../services/e7-distributed-run-verifier-store.js";

function parseArgs(argv: readonly string[]): {
  runId?: string;
  organizationId?: string;
  companyId?: string;
} {
  const out: { runId?: string; organizationId?: string; companyId?: string } = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--org" || arg === "--organization") {
      out.organizationId = rest[++i];
    } else if (arg === "--company") {
      out.companyId = rest[++i];
    } else if (!arg.startsWith("--") && out.runId === undefined) {
      out.runId = arg;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { runId, organizationId, companyId } = parseArgs(process.argv);

  if (!runId) {
    console.error("usage: verify-e7-1-distributed-run <runId> [--org <organizationId>] [--company <companyId>]");
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

  process.exit(result.ok ? 0 : 1);
}

void main().catch((error) => {
  // An unreadable verifier is NOT a bless. Fail closed with a non-promotion exit.
  console.error(`verify-e7-1-distributed-run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
