// DEP-016 — the reference provider's CANNED USAGE.
//
// The m1-spine campaign profile (tests/d1/m1-spine.test.mjs) asserts that a handed-off attempt
// through the REAL ingest writes exactly one priced `cost_events` row. That needs a provider that
// reports usage, and the fake reported none: `execute` returned only a terminal state. These tests
// pin the three properties the profile relies on:
//   1. `execute` reports FIXED, deterministic units that satisfy the frozen wire schema
//      (`usagePayloadV1Schema`), so the harness can forward them as a `usage` event unchanged;
//   2. a SUPPRESSED mode reports `usage: null` — the profile's positive control, which must turn
//      the cost assertion red;
//   3. the mode is per provider id and `reset()` restores the default, so one test's
//      suppression cannot leak into another's run on the shared D1 fake.

import { describe, expect, it } from "vitest";
import { usagePayloadV1Schema } from "@armyofagents/worker-protocol";

import {
  FAKE_PROVIDER_CANNED_USAGE_V1,
  FAKE_PROVIDER_USAGE_MODES,
  createFakeSandboxProvider,
  loadFixtureFromDir,
  defaultGoldenFixturesDir,
} from "../index.js";

async function executeUsage(provider: ReturnType<typeof createFakeSandboxProvider>, providerId: string) {
  const driver = provider.makeDriver(providerId);
  const created = await driver.invoke("create", { providerId });
  if (created.kind !== "created") throw new Error("create failed");
  const executed = await driver.invoke("execute", { providerId, resourceId: created.resource.resourceId });
  if (executed.kind !== "executed") throw new Error("execute failed");
  return executed.usage;
}

describe("canned usage (DEP-016)", () => {
  it("execute reports the canned units, and they satisfy the frozen usage wire schema", async () => {
    const provider = createFakeSandboxProvider();
    const usage = await executeUsage(provider, "p1");
    expect(usage).toEqual(FAKE_PROVIDER_CANNED_USAGE_V1);
    expect(usagePayloadV1Schema.parse(usage)).toEqual(FAKE_PROVIDER_CANNED_USAGE_V1);
    // Non-trivial units: a zero-token report would price to 0 cents and let a "cost > 0"
    // assertion pass only by accident of rounding elsewhere.
    expect(FAKE_PROVIDER_CANNED_USAGE_V1.inputTokens).toBeGreaterThan(0);
    expect(FAKE_PROVIDER_CANNED_USAGE_V1.outputTokens).toBeGreaterThan(0);
  });

  it("is deterministic: two providers, two runs, byte-identical usage", async () => {
    const a = await executeUsage(createFakeSandboxProvider(), "x");
    const b = await executeUsage(createFakeSandboxProvider(), "y");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the suppressed mode reports usage: null (the positive control)", async () => {
    const provider = createFakeSandboxProvider();
    await provider.script({
      providerId: "p1",
      fixtureId: "batch-success",
      loadFixture: (id) => loadFixtureFromDir(defaultGoldenFixturesDir(), id),
      usageMode: "suppressed",
    });
    expect(await executeUsage(provider, "p1")).toBeNull();
  });

  it("the mode is per provider id, and reset() restores the canned default", async () => {
    const provider = createFakeSandboxProvider();
    await provider.script({
      providerId: "quiet",
      fixtureId: "batch-success",
      loadFixture: (id) => loadFixtureFromDir(defaultGoldenFixturesDir(), id),
      usageMode: "suppressed",
    });
    expect(await executeUsage(provider, "quiet")).toBeNull();
    expect(await executeUsage(provider, "loud")).toEqual(FAKE_PROVIDER_CANNED_USAGE_V1);
    provider.reset();
    expect(await executeUsage(provider, "quiet")).toEqual(FAKE_PROVIDER_CANNED_USAGE_V1);
  });

  it("an unknown usage mode is refused, never read as canned or suppressed", async () => {
    const provider = createFakeSandboxProvider();
    await expect(
      provider.script({
        providerId: "p1",
        fixtureId: "batch-success",
        loadFixture: (id) => loadFixtureFromDir(defaultGoldenFixturesDir(), id),
        usageMode: "sometimes" as never,
      }),
    ).rejects.toThrow(/usageMode/);
    expect(FAKE_PROVIDER_USAGE_MODES).toEqual(["canned", "suppressed"]);
  });
});
