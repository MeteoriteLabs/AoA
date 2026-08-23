// BRW-001 — browser job configuration normalisation (unit-shaped; runs on Windows, DEC-03).
//
// The submission surface types `input` as `z.record(z.unknown())` bounded only at 64 KiB,
// while `buildJobEnvelope` passes that raw blob straight through as the workload and gates
// it ONLY with `jobEnvelopeV1Schema.safeParse`. A browser job whose input does not exactly
// satisfy the FROZEN `browserWorkloadV1Schema` therefore submits successfully and then
// silently never leases. These tests pin the normaliser that closes that gap.
//
// The frozen schema — not this module — is the final authority: every accepted output is
// re-validated against `browserWorkloadV1Schema` so the normaliser cannot drift from the
// wire contract.
import { describe, expect, it } from "vitest";
import { browserWorkloadV1Schema } from "@armyofagents/worker-protocol";
import {
  BROWSER_SESSION_CEILINGS,
  FROZEN_MAX_SESSION_SECONDS,
  normalizeBrowserJobInput,
} from "../services/browser-job-config.js";

/** The exact frozen shape, for the fixture table. */
const exactFrozenShape = {
  engine: "chromium",
  viewport: { width: 1280, height: 720 },
  locale: "en-US",
  timezone: "UTC",
  recordTrace: true,
  recordVideo: false,
  maxSessionSeconds: 900,
};

describe("BRW-001 — browser job config: the server ceiling is bounded by the frozen ceiling", () => {
  // GUARD (mutation-tested): the platform ceiling must never exceed the frozen wire
  // ceiling. If it did, the normaliser would emit a workload the frozen schema rejects,
  // reintroducing the silent-non-lease this ticket exists to close.
  it("keeps the server session ceiling at or below the frozen 43200", () => {
    expect(FROZEN_MAX_SESSION_SECONDS).toBe(43_200);
    expect(BROWSER_SESSION_CEILINGS.maxSessionSeconds).toBeLessThanOrEqual(FROZEN_MAX_SESSION_SECONDS);
    expect(BROWSER_SESSION_CEILINGS.maxSessionSeconds).toBeGreaterThan(0);
  });
});

describe("BRW-001 — browser job config: TTL is mandatory and bounded", () => {
  it("supplies a bounded default when the caller omits the TTL", () => {
    const result = normalizeBrowserJobInput({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxSessionSeconds).toBeGreaterThan(0);
    expect(result.value.maxSessionSeconds).toBeLessThanOrEqual(BROWSER_SESSION_CEILINGS.maxSessionSeconds);
  });

  it("rejects a TTL above the server ceiling with a typed reason", () => {
    const result = normalizeBrowserJobInput({
      ...exactFrozenShape,
      maxSessionSeconds: BROWSER_SESSION_CEILINGS.maxSessionSeconds + 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("max_session_seconds_above_ceiling");
  });

  it("rejects a zero or negative TTL", () => {
    for (const bad of [0, -1, -43_200]) {
      const result = normalizeBrowserJobInput({ ...exactFrozenShape, maxSessionSeconds: bad });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a non-integer TTL rather than rounding it", () => {
    const result = normalizeBrowserJobInput({ ...exactFrozenShape, maxSessionSeconds: 900.5 });
    expect(result.ok).toBe(false);
  });

  it("accepts a TTL exactly at the server ceiling", () => {
    const result = normalizeBrowserJobInput({
      ...exactFrozenShape,
      maxSessionSeconds: BROWSER_SESSION_CEILINGS.maxSessionSeconds,
    });
    expect(result.ok).toBe(true);
  });
});

describe("BRW-001 — browser job config: every accepted output satisfies the FROZEN schema", () => {
  const acceptedInputs: Array<[string, Record<string, unknown>]> = [
    ["empty input (all defaults)", {}],
    ["the exact frozen shape", exactFrozenShape],
    ["partial: viewport only", { viewport: { width: 800, height: 600 } }],
    ["partial: locale only", { locale: "fr-FR" }],
    ["trace and video both on", { recordTrace: true, recordVideo: true }],
  ];

  for (const [name, raw] of acceptedInputs) {
    it(`accepts ${name} and emits a frozen-valid workload`, () => {
      const result = normalizeBrowserJobInput(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The frozen schema is the authority, not this module.
      const frozen = browserWorkloadV1Schema.safeParse(result.value);
      expect(frozen.success).toBe(true);
    });
  }
});

describe("BRW-001 — browser job config: rejection fixtures", () => {
  const rejected: Array<[string, unknown]> = [
    ["a non-object input", "not-an-object"],
    ["null", null],
    ["an array", []],
    ["a batch-shaped input", { command: "run", args: [], stdinArtifactId: null, maxRuntimeSeconds: 600 }],
    ["an unknown engine", { ...exactFrozenShape, engine: "firefox" }],
    ["a viewport above the frozen bound", { ...exactFrozenShape, viewport: { width: 16_385, height: 720 } }],
    ["a zero-dimension viewport", { ...exactFrozenShape, viewport: { width: 0, height: 720 } }],
    ["an unknown extra key", { ...exactFrozenShape, cookies: "secret" }],
  ];

  for (const [name, raw] of rejected) {
    it(`rejects ${name}`, () => {
      const result = normalizeBrowserJobInput(raw);
      expect(result.ok).toBe(false);
    });
  }

  // An unknown key must not be silently dropped. A caller who smuggles `cookies` into the
  // config has to be told, not quietly ignored — dropping it would let a caller believe a
  // credential was delivered when it was not.
  it("rejects rather than strips an unknown key", () => {
    const result = normalizeBrowserJobInput({ ...exactFrozenShape, cookies: "secret" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_field");
  });
});

describe("BRW-001 — browser job config: defaulting is deterministic", () => {
  // Test gap found by plan review. Idempotent replay compares the RAW command digest, but
  // an equivalent resubmission must also produce an identical stored workload — otherwise
  // two runs of the same request could diverge in what actually executes.
  it("produces byte-identical output for the same raw input", () => {
    const first = normalizeBrowserJobInput({ locale: "en-GB" });
    const second = normalizeBrowserJobInput({ locale: "en-GB" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
  });

  it("does not mutate the caller's input object", () => {
    const raw = { locale: "en-GB" };
    const snapshot = JSON.stringify(raw);
    normalizeBrowserJobInput(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it("emits keys in a stable order regardless of input key order", () => {
    const a = normalizeBrowserJobInput({ locale: "en-GB", recordTrace: true });
    const b = normalizeBrowserJobInput({ recordTrace: true, locale: "en-GB" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Object.keys(a.value)).toEqual(Object.keys(b.value));
  });
});
