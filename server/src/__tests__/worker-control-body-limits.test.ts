import { describe, it, expect } from "vitest";
import {
  OPERATION_DESCRIPTORS,
  WORKER_PROTOCOL_OPERATIONS,
} from "@armyofagents/worker-protocol";
import {
  WORKER_CONTROL_EVENTS_BODY_LIMIT_BYTES,
  WORKER_CONTROL_BODY_LIMIT_BYTES,
  WORKER_CONTROL_BODY_HEADROOM_BYTES,
  WORKER_CONTROL_EVENTS_PATH,
  WORKER_CONTROL_PATH_PREFIX,
} from "../worker-control-body-limits.js";

// BRW-003d-1 — the parser cliff.
//
// These run in the PLAIN unit tier on purpose. The only harness that boots the
// real app is `describe.skipIf(win32 && !AOA_RUN_WIN_INTEGRATION)`, so a
// Windows developer would see the bounding clause "pass" by skipping. The
// derivation invariant is pure, so it can and must run everywhere.
describe("BRW-003d-1 worker-control body limits are DERIVED from the frozen contract", () => {
  it("mounts a limit STRICTLY GREATER than every operation's declared maxRequestBytes", () => {
    // The crux, measured rather than argued: if the mount EQUALS the contract
    // limit, express rejects at the same threshold the handler would, so the
    // handler's guard stays dead and the refusal keeps the wrong (non-protocol)
    // shape. Only a mount strictly above the contract lets the protocol-shaped
    // refusal win the race.
    for (const op of WORKER_PROTOCOL_OPERATIONS) {
      const declared = OPERATION_DESCRIPTORS[op].maxRequestBytes;
      const mounted = op === "event_upload"
        ? WORKER_CONTROL_EVENTS_BODY_LIMIT_BYTES
        : WORKER_CONTROL_BODY_LIMIT_BYTES;
      expect(
        mounted,
        `${op} declares ${declared} bytes but its path mounts ${mounted}`,
      ).toBeGreaterThan(declared);
    }
  });

  it("derives each limit from the descriptors rather than hand-typing a number", () => {
    const others = WORKER_PROTOCOL_OPERATIONS
      .filter((op) => op !== "event_upload")
      .map((op) => OPERATION_DESCRIPTORS[op].maxRequestBytes);
    expect(WORKER_CONTROL_BODY_LIMIT_BYTES).toBe(
      Math.max(...others) + WORKER_CONTROL_BODY_HEADROOM_BYTES,
    );
    expect(WORKER_CONTROL_EVENTS_BODY_LIMIT_BYTES).toBe(
      OPERATION_DESCRIPTORS.event_upload.maxRequestBytes + WORKER_CONTROL_BODY_HEADROOM_BYTES,
    );
  });

  it("keeps the wide limit off every path except the one operation that needs it", () => {
    // event_upload is 4 MiB; the next largest operation is 256 KiB. Mounting the
    // 4 MiB limit prefix-wide would give a 64 KiB operation a 4 MiB pre-auth
    // parse buffer for no contractual reason.
    expect(WORKER_CONTROL_EVENTS_BODY_LIMIT_BYTES).toBeGreaterThan(
      WORKER_CONTROL_BODY_LIMIT_BYTES,
    );
    expect(WORKER_CONTROL_EVENTS_PATH.startsWith(WORKER_CONTROL_PATH_PREFIX)).toBe(true);
    // The more specific mount must be registered first to win; asserting the
    // prefix relationship is what makes that ordering requirement checkable.
    expect(WORKER_CONTROL_EVENTS_PATH).not.toBe(WORKER_CONTROL_PATH_PREFIX);
  });

  it("pins the express default it exists to escape", () => {
    // 100 KB is what express applies when no limit is passed. Every operation
    // above this number had a provably dead ceiling guard before this ticket.
    const EXPRESS_DEFAULT_BYTES = 100 * 1024;
    const above = WORKER_PROTOCOL_OPERATIONS.filter(
      (op) => OPERATION_DESCRIPTORS[op].maxRequestBytes > EXPRESS_DEFAULT_BYTES,
    );
    // enrollment, event_upload, artifact_commit, quarantine_finalize, control_command
    expect(above.length).toBeGreaterThanOrEqual(5);
    expect(above).toContain("event_upload");
  });
});
