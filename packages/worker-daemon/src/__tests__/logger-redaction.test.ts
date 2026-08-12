import { describe, expect, it } from "vitest";

import { createWorkerLogger } from "../logging/logger.js";

/** A pino destination that captures each written line. */
function capture() {
  const lines: string[] = [];
  return {
    lines,
    records: () => lines.map((l) => JSON.parse(l)),
    stream: { write: (chunk: string) => void lines.push(chunk) },
  };
}

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----AAAA-fake-ed25519-secret-BBBB-----END PRIVATE KEY-----";
const SESSION_TOKEN = "sess_live_9f8e7d6c5b4a3210-secret";
const RAW_CODE = "ENROLL-CODE-4242-RAW-SECRET";

describe("createWorkerLogger — redaction guard", () => {
  it("drops private key / session token / raw enrollment code fields", () => {
    const cap = capture();
    const logger = createWorkerLogger({ destination: cap.stream });

    logger.info(
      {
        workerId: "wrk_abc",
        privateKey: PRIVATE_KEY,
        sessionToken: SESSION_TOKEN,
        enrollmentCode: RAW_CODE,
      },
      "enrolled",
    );

    const whole = cap.lines.join("");
    expect(whole).not.toContain(PRIVATE_KEY);
    expect(whole).not.toContain(SESSION_TOKEN);
    expect(whole).not.toContain(RAW_CODE);

    const [record] = cap.records();
    // Opaque IDs survive; secrets are redacted (not merely absent-by-accident).
    expect(record.workerId).toBe("wrk_abc");
    expect(record.privateKey).not.toBe(PRIVATE_KEY);
    expect(record.sessionToken).not.toBe(SESSION_TOKEN);
    expect(record.enrollmentCode).not.toBe(RAW_CODE);
  });

  it("redacts sensitive fields nested inside objects and arrays", () => {
    const cap = capture();
    const logger = createWorkerLogger({ destination: cap.stream });

    logger.info(
      {
        correlationId: "corr_1",
        auth: { authorization: "Bearer " + SESSION_TOKEN, deviceGeneration: 4 },
        proofs: [{ signature: "sig-" + PRIVATE_KEY }],
      },
      "poll",
    );

    const whole = cap.lines.join("");
    expect(whole).not.toContain(SESSION_TOKEN);
    expect(whole).not.toContain(PRIVATE_KEY);
    // Opaque IDs and generations remain visible for debuggability.
    expect(whole).toContain("corr_1");
    expect(whole).toContain("deviceGeneration");
  });

  it("preserves opaque IDs and passes plain string messages through", () => {
    const cap = capture();
    const logger = createWorkerLogger({ destination: cap.stream });

    logger.info(
      {
        workerId: "wrk_1",
        targetId: "tgt_2",
        deviceGeneration: 7,
        correlationId: "corr_9",
        leaseId: "lease_3",
        sandboxId: "sbx_4",
      },
      "starting",
    );
    logger.info("plain message");

    const [structured, plain] = cap.records();
    expect(structured.workerId).toBe("wrk_1");
    expect(structured.targetId).toBe("tgt_2");
    expect(structured.deviceGeneration).toBe(7);
    expect(structured.leaseId).toBe("lease_3");
    expect(structured.sandboxId).toBe("sbx_4");
    expect(plain.msg).toBe("plain message");
  });

  it("still serializes an Error passed as { err }", () => {
    const cap = capture();
    const logger = createWorkerLogger({ destination: cap.stream });
    logger.error({ err: new Error("health server close failed"), step: "health-server" }, "shutdown step failed");
    const [record] = cap.records();
    expect(record.step).toBe("health-server");
    expect(JSON.stringify(record)).toContain("health server close failed");
  });
});
