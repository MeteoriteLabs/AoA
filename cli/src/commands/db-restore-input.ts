import path from "node:path";
import { expandHomePrefix } from "../config/home.js";

/**
 * Resolve the REQUIRED `--file` argument for `aoa db:restore` to an absolute backup path.
 *
 * A restore with no source file must fail LOUDLY. `runDatabaseRestore` overwrites the target
 * database's schema and data, so silently resolving an unset `--file` (to the cwd, or anywhere)
 * is the one outcome an operator must never get. Extracted from the command so this guard is
 * unit-testable without loading the `@armyofagents/db` barrel or the CLI IO layer — the CLI test
 * convention is to test pure helpers directly (see `data-dir.test.ts`).
 */
export function resolveRestoreBackupFile(raw: string | undefined): string {
  // STUB (RED phase): the required-file guard is intentionally absent here. `db-restore-input.test.ts`
  // asserts the throw; the GREEN commit adds it. Without the guard an unset `--file` resolves to the
  // cwd, which is exactly the silent-wrong-target failure the guard exists to prevent.
  return path.resolve(expandHomePrefix((raw ?? "").trim()));
}
