import { describe, expect, it } from "vitest";

// devDependency import (UNRESTRICTED for test source): the boundary gate excludes
// `*.test.ts`, so a test may import `@armyofagents/shared` to cross-check that the
// worker's VENDORED header names never drift from the server source of truth
// (`packages/shared/src/constants.ts` — WORKER_CONTROL_HEADERS). A runtime import
// of `@armyofagents/shared` is forbidden, which is exactly why the worker vendors
// the values and proves parity here.
import { WORKER_CONTROL_HEADERS as SHARED_HEADERS } from "@armyofagents/shared";

import { WORKER_CONTROL_HEADERS } from "../transport/headers.js";

// The documented lowercase `aoa-*` worker-control set (WRK-002 constraint #5 /
// docs source of truth `packages/shared/src/constants.ts:452-460`). Duplicated
// literally here so a silent rename in BOTH the vendored copy and shared still
// fails against this independent third copy.
const DOCUMENTED = {
  enrollmentCode: "aoa-enrollment-code",
  proofVersion: "aoa-device-proof-version",
  publicKey: "aoa-device-public-key",
  signature: "aoa-device-signature",
  issuedAt: "aoa-device-issued-at",
  proofId: "aoa-device-proof-id",
  requestId: "aoa-device-request-id",
  session: "aoa-worker-session",
} as const;

describe("transport headers — vendored/shared parity", () => {
  it("the vendored worker-control header names equal the documented lowercase set", () => {
    expect({ ...WORKER_CONTROL_HEADERS }).toEqual(DOCUMENTED);
  });

  it("the vendored values equal @armyofagents/shared WORKER_CONTROL_HEADERS exactly (drift fails)", () => {
    expect({ ...WORKER_CONTROL_HEADERS }).toEqual({ ...SHARED_HEADERS });
  });

  it("every header name is a lowercase HTTP token (no upper-case / underscores)", () => {
    for (const name of Object.values(WORKER_CONTROL_HEADERS)) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("declares exactly the eight worker-control headers", () => {
    expect(Object.keys(WORKER_CONTROL_HEADERS).sort()).toEqual(Object.keys(DOCUMENTED).sort());
    expect(new Set(Object.values(WORKER_CONTROL_HEADERS)).size).toBe(8);
  });
});
