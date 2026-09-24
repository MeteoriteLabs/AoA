// scripts/lib/sandbox-output-root-check.mjs
//
// CLI-017-A — SD-4's "one `R`, provably", as an equality check that runs in CI's `policy` job.
//
// `E7-D11` §1 rules `R = /home/user/aoa-output` and §2's SD-2/SD-4 require the server-side
// directive and the worker-side `outputRoot` to be PROVABLY equal. A single shared constant is
// NOT available and this was verified at source, not assumed: the only `@armyofagents/*` package
// that BOTH `server/package.json` and `packages/worker-daemon/package.json` depend on is
// `@armyofagents/worker-protocol`, which is FROZEN (`E7-D07`). So SD-4 takes the review's second
// form — two constants plus a check — modelled on the probe pack's own
// `default-template-mismatch` assertion (`scripts/lib/cli-011-output-probe.mjs`).
//
// ★★★ IT FAILS CLOSED ON ABSENCE, NOT ONLY ON DISAGREEMENT. A constant that was renamed, moved
// or deleted makes the check UNREADABLE, and an unreadable check reports a FAILURE rather than a
// pass — "not run" must never read as "clean". A guard that silently passes when its subject
// vanishes is the `check-that-nothing-runs` class this programme keeps paying for.
//
// Pure: the caller supplies the two file texts. The executable
// (`scripts/check-sandbox-output-root.mjs`) does the reading, and
// `scripts/lib/__tests__/sandbox-output-root-check.test.mjs` is the positive control.

/** Where each half of `R` is defined. Paths are informational; the caller reads them. */
export const SANDBOX_OUTPUT_ROOT_SOURCES = Object.freeze({
  server: Object.freeze({
    path: "server/src/services/sandbox-output-root.ts",
    symbol: "SANDBOX_OUTPUT_ROOT",
  }),
  worker: Object.freeze({
    path: "packages/worker-daemon/src/lease/export-request-producer.ts",
    symbol: "DEFAULT_OUTPUT_ROOT",
  }),
});

/** The value ruled by `E7-D11` §1. Pinned here too, so a coordinated edit of BOTH constants to
 * some other path still reds: SD-4 asks for agreement, and the ruling asks for THIS value. */
export const RULED_OUTPUT_ROOT = "/home/user/aoa-output";

/**
 * Extract `export const <symbol> = "<value>";` from a TypeScript source text.
 *
 * Deliberately narrow: it matches a single exported string literal and nothing else. A
 * template literal, a computed expression or a re-export is NOT matched and therefore reads as
 * ABSENT, which fails. Widening it later is a decision someone must make on purpose.
 *
 * @returns {string | null} the literal's value, or `null` when the declaration is not found.
 */
export function readExportedStringConstant(sourceText, symbol) {
  if (typeof sourceText !== "string" || typeof symbol !== "string" || symbol.length === 0) return null;
  const pattern = new RegExp(`export\\s+const\\s+${symbol}\\s*(?::\\s*string\\s*)?=\\s*"([^"\\\\]*)"\\s*;`);
  const match = pattern.exec(sourceText);
  return match ? match[1] : null;
}

/**
 * Evaluate SD-4.
 *
 * @param {{ serverSource: string | null, workerSource: string | null }} input
 * @returns {{ ok: boolean, problems: string[], serverValue: string | null, workerValue: string | null }}
 */
export function evaluateSandboxOutputRoot(input) {
  const problems = [];
  const { server, worker } = SANDBOX_OUTPUT_ROOT_SOURCES;

  const serverSource = typeof input?.serverSource === "string" ? input.serverSource : null;
  const workerSource = typeof input?.workerSource === "string" ? input.workerSource : null;

  if (serverSource === null) problems.push(`unreadable: ${server.path} could not be read`);
  if (workerSource === null) problems.push(`unreadable: ${worker.path} could not be read`);

  const serverValue = serverSource === null ? null : readExportedStringConstant(serverSource, server.symbol);
  const workerValue = workerSource === null ? null : readExportedStringConstant(workerSource, worker.symbol);

  if (serverSource !== null && serverValue === null) {
    problems.push(`absent: \`export const ${server.symbol} = "…";\` not found in ${server.path}`);
  }
  if (workerSource !== null && workerValue === null) {
    problems.push(`absent: \`export const ${worker.symbol} = "…";\` not found in ${worker.path}`);
  }

  if (serverValue !== null && workerValue !== null && serverValue !== workerValue) {
    problems.push(
      `mismatch: ${server.symbol}=${JSON.stringify(serverValue)} but ${worker.symbol}=${JSON.stringify(workerValue)} — ` +
        "SD-4 requires ONE `R`; change both or neither",
    );
  }
  if (serverValue !== null && serverValue !== RULED_OUTPUT_ROOT) {
    problems.push(
      `unruled: ${server.symbol}=${JSON.stringify(serverValue)}, but E7-D11 §1 rules ${JSON.stringify(RULED_OUTPUT_ROOT)}`,
    );
  }
  if (workerValue !== null && workerValue !== RULED_OUTPUT_ROOT) {
    problems.push(
      `unruled: ${worker.symbol}=${JSON.stringify(workerValue)}, but E7-D11 §1 rules ${JSON.stringify(RULED_OUTPUT_ROOT)}`,
    );
  }

  return { ok: problems.length === 0, problems, serverValue, workerValue };
}
