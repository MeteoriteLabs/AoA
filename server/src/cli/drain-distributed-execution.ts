#!/usr/bin/env tsx
// server/src/cli/drain-distributed-execution.ts
//
// MIG-009 (M1a) — the OPERATOR TRIGGER for the distributed-execution rollback drain.
//
//   DATABASE_URL=postgres://<owner>@host/db \
//   AOA_DISTRIBUTED_EXECUTION_ENABLED=true \
//   AOA_APP_DATABASE_URL=postgres://aoa_app:...@host/db \
//   AOA_OPERATOR_DATABASE_URL=postgres://aoa_operator:...@host/db \
//     pnpm drain:distributed-execution --operator <who>
//
// Cancels every non-terminal distributed attempt across EVERY admitted Organization through the
// shipped `createDistributedExecutionDrain(...).drainAll()`, one attempt at a time, each cancel
// in one tenant transaction with its actor-attributed `job.drain.requested` activity_log row.
// Prints one JSON line per Organization and one summary line.
//
// Exit 0 iff no Organization was skipped AND every cancel committed. Exit 1 otherwise (including
// flag off, pools unavailable, or a drain that threw). Exit 2 on usage.
//
// ★ WHY THIS FILE IS THE POINT OF THE TICKET. `createDistributedExecutionDrain` had ZERO
// production callers, so exit criterion 6's rollback rehearsal had a runbook and no mechanism
// (founder decision D-9). This is its caller, and `scripts/gate-clause-wiring.json` now declares
// `E10-1-drain` `wired` against it. Ruling F6 sets the grain: this CLI now, the kill-switch UI
// later (REL-005). It is an OPERATOR action, never automatic: boot, SIGTERM and the sweeper are
// the wrong triggers — they would cancel in-flight work on every restart.
//
// ★ RUN IT BEFORE UNSETTING THE FLAG. It opens the same bounded aoa_app / aoa_operator pools the
// server does, through the same startup gate (`openDistributedExecutionDatabases`), so a
// flag-off process opens no pool and refuses. See docs/deploy/environment-variables.md.
//
// All logic lives in services/distributed-execution-drain-trigger.ts (unit-tested) and its
// drizzle composition in services/distributed-execution-drain-trigger-store.ts (embedded-PG
// tested); this file is process wiring only.

import { createDb, loadRequiredMigrationIdentity } from "@armyofagents/db";
import { loadConfig } from "../config.js";
import { openDistributedExecutionDatabases } from "../db/distributed-execution-databases.js";
import { runDrainDistributedExecutionCli } from "../services/distributed-execution-drain-trigger.js";
import { composeDistributedExecutionDrainTriggerDeps } from "../services/distributed-execution-drain-trigger-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const code = await runDrainDistributedExecutionCli({
    argv: process.argv,
    distributedExecutionEnabled: config.distributedExecutionEnabled,
    async openPools() {
      if (!config.databaseUrl) {
        console.error("DATABASE_URL is required (the owner connection the bounded-pool startup gate verifies against)");
        return null;
      }
      return openDistributedExecutionDatabases({
        enabled: true,
        ownerDb: createDb(config.databaseUrl),
        requiredMigrationIdentity: await loadRequiredMigrationIdentity(),
        appDatabaseUrl: process.env.AOA_APP_DATABASE_URL,
        operatorDatabaseUrl: process.env.AOA_OPERATOR_DATABASE_URL,
      });
    },
    composeDeps: (pools) =>
      composeDistributedExecutionDrainTriggerDeps({ appDb: pools.appDb, operatorDb: pools.operatorDb }),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}

void main().catch((error) => {
  // An unreadable config or a pool that failed its startup gate is NOT a clean sweep.
  console.error(
    `drain-distributed-execution failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
