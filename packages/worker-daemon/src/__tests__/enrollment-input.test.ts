// DSK-001 — reading the enrollment ticket, without reaching off-machine and
// without ever putting a live credential where it can be read later.
//
// `config.enrollmentCodeSource` is parsed today and has ZERO readers. This is the
// reader, and three of its properties are security properties.
//
//   THE FIELD IS NAMED `enrollmentCode`, NOT `code`. The daemon logger redacts by
//   substring against SENSITIVE_SUBSTRINGS, which contains "enrollmentcode" and
//   does NOT contain "code" (logging/logger.ts:37-49, verified). So an object
//   logged with a `code` field prints the credential in full while the same value
//   under `enrollmentCode` prints `[redacted]`. The name IS the mitigation.
//
//   A PATH SOURCE MUST BE LOCAL, CHECKED BEFORE THE READ. `parseEnrollmentCodeSource`
//   validates only non-emptiness and mutual exclusion (config.ts, verified) — it
//   does no locality check. Reading a UNC path is an authenticated SMB round trip
//   to a host someone else chose, which both leaks the fact of enrolment and
//   invites a hostile file.
//
//   AN ERROR NEVER ECHOES THE CONTENTS. A malformed ticket file must not put its
//   bytes into an exception that then lands in a log or a crash report.

import { describe, expect, it, vi } from "vitest";
import { readEnrollmentInput } from "../enrollment/enrollment-input.js";
import { encodeEnrollmentTicket } from "../enrollment/ticket.js";

const TARGET_ID = "a3000000-0000-4000-8000-000000000003";
const CODE = "aoa_enr_" + "A".repeat(22) + "." + "B".repeat(43);
const TICKET = encodeEnrollmentTicket({ v: 1, targetId: TARGET_ID, code: CODE });

describe("DSK-001 — the reader resolves both source kinds", () => {
  it("reads a ticket from an environment variable", () => {
    const out = readEnrollmentInput(
      { kind: "env", envVar: "AOA_TICKET" },
      { AOA_TICKET: TICKET },
      () => { throw new Error("must not read a file"); },
    );
    expect(out).toEqual({ targetId: TARGET_ID, enrollmentCode: CODE });
  });

  it("reads a ticket from a local absolute path", () => {
    const readFileText = vi.fn(() => TICKET);
    const out = readEnrollmentInput({ kind: "path", path: "C:\\AoA\\ticket.txt" }, {}, readFileText);
    expect(out.targetId).toBe(TARGET_ID);
    expect(readFileText).toHaveBeenCalledWith("C:\\AoA\\ticket.txt");
  });

  it("tolerates exactly one trailing newline, as every text editor adds", () => {
    for (const suffix of ["\n", "\r\n", ""]) {
      const out = readEnrollmentInput({ kind: "path", path: "C:\\t.txt" }, {}, () => TICKET + suffix);
      expect(out.targetId, JSON.stringify(suffix)).toBe(TARGET_ID);
    }
  });
});

describe("DSK-001 — the field name is the redaction mitigation", () => {
  it("returns `enrollmentCode`, a name the daemon logger redacts", () => {
    const out = readEnrollmentInput({ kind: "env", envVar: "T" }, { T: TICKET }, () => "");
    expect(Object.keys(out).sort()).toEqual(["enrollmentCode", "targetId"]);
    // `code` would print in full: the logger's substring list has
    // "enrollmentcode" but not "code".
    expect(Object.keys(out)).not.toContain("code");
  });
});

describe("DSK-001 — a path source must be local, rejected BEFORE the read", () => {
  const hostile = [
    ["UNC share", "\\\\attacker\\share\\ticket.txt"],
    ["UNC long path", "\\\\?\\UNC\\attacker\\share\\ticket.txt"],
    ["forward-slash UNC", "//attacker/share/ticket.txt"],
    ["device namespace", "\\\\.\\pipe\\ticket"],
  ];

  for (const [name, path] of hostile) {
    it(`rejects a ${name} without reading it`, () => {
      const readFileText = vi.fn(() => TICKET);
      expect(() => readEnrollmentInput({ kind: "path", path }, {}, readFileText)).toThrow();
      // The REAL assertion: the read never happened. A rejection after the read
      // has already leaked the enrolment attempt to the remote host.
      expect(readFileText, name).not.toHaveBeenCalled();
    });
  }

  it("rejects a relative path, which resolves against an unpredictable cwd", () => {
    const readFileText = vi.fn(() => TICKET);
    expect(() => readEnrollmentInput({ kind: "path", path: "ticket.txt" }, {}, readFileText)).toThrow();
    expect(readFileText).not.toHaveBeenCalled();
  });
});

describe("DSK-001 — failures never expose the credential", () => {
  it("throws when the environment variable is absent, naming the variable only", () => {
    expect(() => readEnrollmentInput({ kind: "env", envVar: "MISSING" }, {}, () => "")).toThrow(/MISSING/);
  });

  it("never puts the file contents into the error", () => {
    const secretish = "aoa_enr_" + "S".repeat(22) + "." + "T".repeat(43);
    const badTicket = "aoa_tkt_" + Buffer.from(
      JSON.stringify({ v: 9, targetId: TARGET_ID, code: secretish }),
    ).toString("base64url");
    try {
      readEnrollmentInput({ kind: "path", path: "C:\\t.txt" }, {}, () => badTicket);
      throw new Error("expected a rejection");
    } catch (err) {
      const text = `${(err as Error).message} ${(err as Error).stack ?? ""}`;
      expect(text).not.toContain(secretish);
      expect(text).not.toContain(badTicket);
      expect(text).not.toContain("S".repeat(22));
    }
  });

  it("never puts the raw file text into the error when it is not a ticket at all", () => {
    const junk = "this file actually contains a password: hunter2";
    try {
      readEnrollmentInput({ kind: "path", path: "C:\\t.txt" }, {}, () => junk);
      throw new Error("expected a rejection");
    } catch (err) {
      expect(`${(err as Error).message}`).not.toContain("hunter2");
    }
  });
});
