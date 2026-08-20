// DSK-001 / D6 + I9 + I5 — the pure command planner.
//
// The planner decides HOW the OS vault is invoked. Three properties are
// security-critical and none of them is guarded by the compiler:
//
//   I5  Private key material never reaches argv. It crosses stdin only. argv is
//       visible to any same-user `ps`/Get-Process, so a secret on argv is a
//       disclosure to every process the user runs.
//   I9  Protection scope is CurrentUser, never LocalMachine — LocalMachine lets
//       ANY user on the box unprotect the blob, which defeats the entire point of
//       OS-protected custody.
//   I9  The interpreter is an absolute System32 path, never a bare name. A bare
//       `powershell.exe` is a PATH lookup, and a writable PATH entry earlier than
//       System32 is a code-execution hijack that would receive the key on stdin.
//
// The plan is also byte-locked to a committed fixture so an incidental edit to
// argv or script text becomes a deliberate fixture update rather than a silent
// change to how a private key is handled. The property tests below are NOT
// circular with that fixture — they assert the invariants directly.

import { describe, expect, it } from "vitest";
import {
  planVaultCommand,
  POWERSHELL_ABSOLUTE_PATH,
  STORE_SUCCESS_SENTINEL,
  type VaultOp,
} from "../command-plan.js";

const REF = { blobPath: "C:\\Users\\t\\AppData\\Local\\AoA\\worker\\device-identity.v1.bin" };
const OPS: VaultOp[] = ["load", "store", "delete"];

describe("DSK-001/I9 — the interpreter is an absolute System32 path", () => {
  it("never invokes a bare `powershell.exe` (a PATH-hijack vector)", () => {
    for (const op of OPS) {
      const plan = planVaultCommand(op, REF, "win32");
      expect(plan.argv[0], op).toBe(POWERSHELL_ABSOLUTE_PATH);
      expect(plan.argv[0]!.toLowerCase(), op).toContain("system32");
      expect(plan.argv[0], op).not.toBe("powershell.exe");
    }
  });

  it("passes -NoProfile and -NonInteractive so no user profile can inject code", () => {
    for (const op of OPS) {
      const argv = planVaultCommand(op, REF, "win32").argv;
      expect(argv, op).toContain("-NoProfile");
      expect(argv, op).toContain("-NonInteractive");
    }
  });

  it("delivers the script via -EncodedCommand, not -File and not a temp script", () => {
    // -File was measured to exit 0 on a genuine CryptographicException, which
    // destroys the failure oracle. A runtime-written temp script would also be a
    // substitution TOCTOU: whoever can write that path receives the key on stdin.
    for (const op of OPS) {
      const argv = planVaultCommand(op, REF, "win32").argv;
      expect(argv, op).toContain("-EncodedCommand");
      expect(argv, op).not.toContain("-File");
      expect(argv.join(" "), op).not.toMatch(/\.ps1/i);
    }
  });

  it("encodes the script as base64 of UTF-16LE, which is what -EncodedCommand requires", () => {
    const plan = planVaultCommand("load", REF, "win32");
    const encoded = plan.argv[plan.argv.indexOf("-EncodedCommand") + 1]!;
    const decoded = Buffer.from(encoded, "base64").toString("utf16le");
    expect(decoded).toBe(plan.scriptText);
  });
});

describe("DSK-001/I9 — protection scope is CurrentUser, never LocalMachine", () => {
  it("uses CurrentUser in every operation that protects or unprotects", () => {
    for (const op of OPS) {
      const plan = planVaultCommand(op, REF, "win32");
      if (op === "delete") continue; // delete touches no crypto
      expect(plan.scriptText, op).toContain("CurrentUser");
    }
  });

  it("never mentions LocalMachine anywhere in argv or script text", () => {
    // LocalMachine would let any user on the box unprotect the device key.
    for (const op of OPS) {
      const plan = planVaultCommand(op, REF, "win32");
      expect(plan.scriptText.toLowerCase(), op).not.toContain("localmachine");
      expect(plan.argv.join(" ").toLowerCase(), op).not.toContain("localmachine");
    }
  });
});

describe("DSK-001/I5 — the secret crosses stdin only, never argv", () => {
  it("declares stdin as the secret channel for store, and none for load/delete", () => {
    expect(planVaultCommand("store", REF, "win32").stdin).toBe("secret");
    expect(planVaultCommand("load", REF, "win32").stdin).toBe("none");
    expect(planVaultCommand("delete", REF, "win32").stdin).toBe("none");
  });

  it("takes no secret parameter at all — the planner cannot leak what it never sees", () => {
    // Structural: the planner's signature is (op, ref, platform). There is no
    // argument through which key material could reach argv, so I5 holds by
    // construction for this layer rather than by careful coding.
    expect(planVaultCommand.length).toBe(3);
  });

  it("produces argv containing only non-secret, fixed tokens plus the encoded script", () => {
    const plan = planVaultCommand("store", REF, "win32");
    const encodedIdx = plan.argv.indexOf("-EncodedCommand") + 1;
    const withoutScript = plan.argv.filter((_, i) => i !== encodedIdx);
    for (const token of withoutScript) {
      expect(token).toMatch(/^(-NoProfile|-NonInteractive|-EncodedCommand|.*System32.*)$/i);
    }
  });
});

describe("DSK-001/D6 — the hardened script reports failure deliberately", () => {
  it("sets ErrorActionPreference Stop and exits 3 on any caught failure", () => {
    // Without this the exit code is invocation-shape dependent: the same
    // CryptographicException measured exit 1 under -EncodedCommand and exit 0
    // under -File. A deliberate exit 3 is what makes `locked` distinguishable.
    for (const op of OPS) {
      const s = planVaultCommand(op, REF, "win32").scriptText;
      expect(s, op).toContain("$ErrorActionPreference = 'Stop'");
      expect(s, op).toContain("exit 3");
      expect(s, op).toContain("exit 0");
    }
  });

  it("maps its exit codes explicitly so the classifier is not guessing", () => {
    const plan = planVaultCommand("load", REF, "win32");
    expect(plan.exitCodes).toEqual({ ok: 0, locked: 3, alreadyExists: 4 });
  });

  it("writes diagnostics to stderr, never to stdout, so stdout stays the envelope channel", () => {
    for (const op of OPS) {
      const s = planVaultCommand(op, REF, "win32").scriptText;
      expect(s, op).toContain("[Console]::Error.Write");
    }
  });
});

describe("DSK-001/D4 — non-Windows platforms are ports, not production adapters", () => {
  it("refuses to plan for darwin and linux rather than emitting an untested command", () => {
    // The design ships ONE production adapter. A macOS `security add-generic-password`
    // would put the key on argv, which is strictly worse than the 0600 file it
    // replaces — so the planner must refuse rather than improvise.
    for (const platform of ["darwin", "linux"] as const) {
      expect(() => planVaultCommand("load", REF, platform)).toThrow(/unsupported|not supported/i);
    }
  });
});

// -- corrections found by attacking the design against the code ---------------

describe("DSK-001 — the store script must not confuse 'full disk' with 'already enrolled'", () => {
  it("narrows the already-exists catch to ERROR_FILE_EXISTS by HResult", () => {
    // `catch [IO.IOException]` is far too wide. DirectoryNotFoundException,
    // a full disk, a vanished network path and a sharing violation are ALL
    // IOException — so an unqualified catch reported every one of them as
    // "someone else got here first". The caller then treats a failed enrolment
    // as a lost race, reports success, and the device is never enrolled.
    const s = planVaultCommand("store", REF, "win32").scriptText;
    expect(s).toContain("0x80070050");
  });

  it("flushes to disk before releasing the handle", () => {
    // Without Flush($true) the bytes may sit in the OS cache. A power loss
    // between Dispose and the physical write leaves a zero-length blob that is
    // PRESENT (so not absence) but undecodable — a bricked device rather than an
    // unenrolled one.
    const s = planVaultCommand("store", REF, "win32").scriptText;
    expect(s).toContain("Flush($true)");
  });

  it("emits a success sentinel on stdout so success is positive, not inferred", () => {
    // The store previously inferred "stored" from `corrupt && exitCode === 0`,
    // i.e. from the ABSENCE of output. That is the same shape as inferring
    // absence from empty stdout, which is the bug this whole package exists to
    // avoid. Success must be a thing the script SAYS.
    const s = planVaultCommand("store", REF, "win32").scriptText;
    expect(s).toContain(STORE_SUCCESS_SENTINEL);
  });

  it("exposes the sentinel as a shared constant, not a duplicated literal", () => {
    expect(typeof STORE_SUCCESS_SENTINEL).toBe("string");
    expect(STORE_SUCCESS_SENTINEL.length).toBeGreaterThan(0);
  });
});
