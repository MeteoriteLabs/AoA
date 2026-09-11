// E11 M2 — the device liveness classifier is a PURE function of two timestamps and a
// deadline. Every arm is driven with an injected `now`, and the two load-bearing
// properties — the NULL fail-open and the strict `>` boundary — are pinned by named cases,
// mirroring service-liveness-deadline.test.ts.

import { describe, expect, it } from "vitest";

import {
  DEVICE_LIVENESS_DEADLINE_ENV,
  DEVICE_LIVENESS_DEADLINE_MS_DEFAULT,
  classifyDeviceLiveness,
  resolveDeviceLivenessDeadlineMs,
} from "../services/device-liveness.js";

const NOW = new Date("2026-09-11T12:00:00.000Z");
const DEADLINE = 1_800_000; // 30 min

describe("classifyDeviceLiveness", () => {
  it("★ FAIL-OPEN: a null lastSeenAt is never_seen, NEVER stale", () => {
    expect(classifyDeviceLiveness({ lastSeenAt: null, now: NOW, deadlineMs: DEADLINE }))
      .toBe("never_seen");
  });

  it("★ FAIL-OPEN holds even with a tiny deadline — null is still never_seen, not stale", () => {
    // The defect this guards is treating a missing observation as infinitely old.
    expect(classifyDeviceLiveness({ lastSeenAt: null, now: NOW, deadlineMs: 1 }))
      .toBe("never_seen");
  });

  it("a recent check-in (age < deadline) is healthy", () => {
    const lastSeenAt = new Date(NOW.getTime() - 60_000); // 1 min ago
    expect(classifyDeviceLiveness({ lastSeenAt, now: NOW, deadlineMs: DEADLINE }))
      .toBe("healthy");
  });

  it("★ BOUNDARY: an age exactly equal to the deadline is still healthy (strict >)", () => {
    const lastSeenAt = new Date(NOW.getTime() - DEADLINE);
    expect(classifyDeviceLiveness({ lastSeenAt, now: NOW, deadlineMs: DEADLINE }))
      .toBe("healthy");
  });

  it("★ BOUNDARY: one millisecond past the deadline is stale", () => {
    const lastSeenAt = new Date(NOW.getTime() - DEADLINE - 1);
    expect(classifyDeviceLiveness({ lastSeenAt, now: NOW, deadlineMs: DEADLINE }))
      .toBe("stale");
  });

  it("an old check-in is stale", () => {
    const lastSeenAt = new Date(NOW.getTime() - 24 * 60 * 60_000); // a day ago
    expect(classifyDeviceLiveness({ lastSeenAt, now: NOW, deadlineMs: DEADLINE }))
      .toBe("stale");
  });

  it("a future lastSeenAt (negative age, mild clock skew) is healthy, not stale", () => {
    const lastSeenAt = new Date(NOW.getTime() + 5_000);
    expect(classifyDeviceLiveness({ lastSeenAt, now: NOW, deadlineMs: DEADLINE }))
      .toBe("healthy");
  });
});

describe("resolveDeviceLivenessDeadlineMs", () => {
  it("returns the conservative default when the env var is unset", () => {
    expect(resolveDeviceLivenessDeadlineMs({})).toBe(DEVICE_LIVENESS_DEADLINE_MS_DEFAULT);
  });

  it("honours a valid positive-integer override", () => {
    expect(resolveDeviceLivenessDeadlineMs({ [DEVICE_LIVENESS_DEADLINE_ENV]: "600000" }))
      .toBe(600_000);
  });

  it.each(["", "  ", "not-a-number", "0", "-1", "1.5", "Infinity", "NaN"])(
    "ignores an invalid override %j and falls back to the default (never disables liveness)",
    (value) => {
      expect(resolveDeviceLivenessDeadlineMs({ [DEVICE_LIVENESS_DEADLINE_ENV]: value }))
        .toBe(DEVICE_LIVENESS_DEADLINE_MS_DEFAULT);
    },
  );

  it("trims surrounding whitespace on a valid value", () => {
    expect(resolveDeviceLivenessDeadlineMs({ [DEVICE_LIVENESS_DEADLINE_ENV]: "  900000 " }))
      .toBe(900_000);
  });
});
