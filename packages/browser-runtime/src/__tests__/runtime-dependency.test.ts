// -----------------------------------------------------------------------------
// BRW-003b — this package's RUNTIME dependencies must be declared as such.
//
// `playwright-driver.ts` does `import { chromium } from "playwright"` at module scope, and
// the runner is STAGED INTO A SANDBOX and executed there:
//
//   host: writeFiles(runner + session.json) -> exec(node runner.js session.json)
//
// So `playwright` has to resolve in the guest. A devDependency does not travel with a
// published/installed package, which makes this a runtime resolution failure that no test
// in this repo would catch — every test here runs in the monorepo where the devDependency
// IS installed. The failure only appears in the deployment target.
//
// This test is cheap and it is the only thing standing between "works on the dev machine"
// and a sandbox that cannot start a browser.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

describe("BRW-003b — runtime dependencies are declared as dependencies", () => {
  it("declares `playwright` as a RUNTIME dependency, not a devDependency", () => {
    expect(Object.keys(manifest.dependencies ?? {})).toContain("playwright");
  });

  it("does NOT also carry `playwright` in devDependencies", () => {
    // Declared in both is the shape that hides the bug: the monorepo resolves it either
    // way, so the mistake stays invisible until the sandbox tries to import it.
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain("playwright");
  });
});
