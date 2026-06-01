/**
 * Phase 0 / Task 0.2 — persona-bundle coherence.
 *
 * The crew onboarding bundles drifted from what the agents actually do at
 * runtime. This test pins the bundle text to the runtime role so the two can't
 * silently diverge again:
 *
 *   - Adjutant: the runtime directive (ensure-adjutant.ts) calls it "the
 *     discuss-phase director" that drives the conversation, proposes work via
 *     propose_crew_work, and advances the phase. Its bundle used to describe a
 *     "quiet observer" that "never interrupts" and "runs every ~4h via sweep" —
 *     directly contradictory. Assert the contradiction is gone and the director
 *     identity is present.
 *   - Engineer: its bundle said tasks are created by "the Dispatcher", a role
 *     retired in Task 2.7. Assert that reference is gone (tasks come from the
 *     founder / the Adjutant's propose_crew_work chokepoint).
 *
 * Text-only contract — no tool list, allowlist, adapter, or behavior is asserted
 * here (those live in the ensure-* and crew-persona-bundles suites).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "onboarding-assets");

describe("persona bundle coherence (Task 0.2)", () => {
  it("Adjutant SOUL matches its runtime director role", () => {
    const soul = readFileSync(join(root, "adjutant", "SOUL.md"), "utf8").toLowerCase();
    expect(soul).not.toMatch(/quiet observer|never interrupt/);
    expect(soul).toMatch(/discuss|director|orchestrat/);
  });

  it("Engineer bundle does not reference the retired Dispatcher role", () => {
    const soul = readFileSync(join(root, "engineer", "SOUL.md"), "utf8").toLowerCase();
    expect(soul).not.toMatch(/dispatcher/);
  });
});
