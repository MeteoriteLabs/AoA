import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards against re-introducing the `work-questions` fail-open blind spot: an
 * integration suite gated with `<env> ? describe : describe.skip` SILENTLY SKIPS
 * its entire body when the env var is absent — and the required Linux `verify`
 * job sets no DATABASE_URL, so such a suite shows green in CI without ever
 * running (green-but-not-run). Integration DB suites must instead boot
 * embedded-postgres in beforeAll and gate with
 * `describe.skipIf(process.platform === "win32")` (Issue #114), which fails
 * CLOSED on Linux when the boot fails.
 *
 * This is a plain `.test.ts`, so it runs in the required gate and on Windows.
 */

// Matches the fail-open shape `X ? describe : describe.skip`. Intentional opt-in
// suites (thread-v2-real-e2e, aoa-realoutput) use `describe.skipIf(...)` — a
// different construct — and are not flagged.
const FAIL_OPEN_SUITE = /\?\s*describe\s*:\s*describe\.skip/;

const testsDir = fileURLToPath(new URL(".", import.meta.url));

describe("integration test hygiene", () => {
  it("no *.integration.test.ts fail-opens by skipping its whole suite on a missing env var", () => {
    const offenders = readdirSync(testsDir)
      .filter((f) => f.endsWith(".integration.test.ts"))
      .filter((f) => FAIL_OPEN_SUITE.test(readFileSync(join(testsDir, f), "utf8")));
    expect(
      offenders,
      "these integration suites silently skip when an env var is absent (fail-open — " +
        "green in CI without running). Boot embedded-postgres in beforeAll and gate with " +
        'describe.skipIf(process.platform === "win32") instead:\n' +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the hygiene regex actually catches the fail-open shape (negative control)", () => {
    expect(FAIL_OPEN_SUITE.test("const suite = databaseUrl ? describe : describe.skip;")).toBe(true);
    expect(FAIL_OPEN_SUITE.test('describe.skipIf(process.platform === "win32")("x", () => {});')).toBe(false);
  });
});
