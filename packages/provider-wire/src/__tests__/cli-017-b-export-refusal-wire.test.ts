// packages/provider-wire/src/__tests__/cli-017-b-export-refusal-wire.test.ts
//
// CLI-017-B, round 1 (Codex P2, PR #592) — THE SD-5 REFUSAL'S CLASSIFICATION MUST SURVIVE THE
// PROVIDER WIRE, because in production that is the only place it is read.
//
// THE DEFECT, verified at source before fixing. `E7-D11` section 3 requires the SD-5 refusal to be
// CLASSIFIED, and `E5-D07` makes it per-file and best-effort outward — which is only actionable if
// the worker can tell "this file carried a secret" from "the adapter-manager could not reach the
// store". In production the export runs through the adapter-manager, whose error boundary passes
// through only errors `isModelledWireError` recognises and otherwise substitutes a fixed generic
// `WireProtocolError`. None of the three export refusals were in that vocabulary, so every secret
// refusal arrived at the worker indistinguishable from a generic infrastructure failure. A
// classification that is erased before anyone reads it is not a classification.
//
// THE CLASS, stated: *a fixed-vocabulary domain refusal that is modelled in the provider but not in
// the wire codec, so it degrades to `WireProtocolError` on the hop.* All three export refusals were
// in it; all three are fixed here, and each is proven in BOTH directions (`serializeError` and
// `reconstructError`), because missing either half re-opens the erasure on one side only.

import { describe, expect, it } from "vitest";
import {
  WireProtocolError,
  isModelledWireError,
  reconstructError,
  serializeError,
} from "../codec.js";
import {
  SandboxExportScannerRefusedError,
  SandboxExportScannerUnavailableError,
  SandboxExportSecretSetUnavailableError,
} from "@armyofagents/sandbox-e2b-provider/errors.js";

const REFUSALS = [
  ["SandboxExportScannerRefusedError", () => new SandboxExportScannerRefusedError()],
  ["SandboxExportScannerUnavailableError", () => new SandboxExportScannerUnavailableError()],
  ["SandboxExportSecretSetUnavailableError", () => new SandboxExportSecretSetUnavailableError()],
] as const;

describe("CLI-017-B — the three export refusals survive the provider wire with their class", () => {
  for (const [name, make] of REFUSALS) {
    it(`${name} is a MODELLED wire error, so the AM boundary passes it through`, () => {
      // Without this the adapter-manager substitutes a generic WireProtocolError and the worker
      // sees `cause=unclassified` for a refusal that was fully classified one process earlier.
      expect(isModelledWireError(make())).toBe(true);
    });

    it(`${name} round-trips serialize -> reconstruct with its class intact`, () => {
      const payload = serializeError(make());
      expect(payload.name).toBe(name);
      const rebuilt = reconstructError(payload);
      expect(rebuilt.name).toBe(name);
      // Not the degraded generic: that is the exact failure being closed.
      expect(rebuilt).not.toBeInstanceOf(WireProtocolError);
      expect(rebuilt).toBeInstanceOf(make().constructor as new () => Error);
      // The message is fixed by the class, so the round trip is byte-stable.
      expect(rebuilt.message).toBe(make().message);
    });

    it(`${name} carries NO discriminant and nothing tenant-derived over the wire`, () => {
      const payload = serializeError(make()) as Record<string, unknown>;
      // Exactly two fields. A discriminant added later must be a deliberate act, because these
      // messages are the one thing standing between a refusal and a leak.
      expect(Object.keys(payload).sort()).toEqual(["message", "name"]);
      expect(String(payload.message)).not.toMatch(/\/home\/user|https?:|sk-|Bearer/);
    });
  }

  it("★ POSITIVE CONTROL — an UNMODELLED error still degrades, so the predicate is not 'always true'", () => {
    class SomethingElseError extends Error {
      constructor() {
        super("a message that could carry anything at all");
        this.name = "SomethingElseError";
      }
    }
    expect(isModelledWireError(new SomethingElseError())).toBe(false);
    // …and an unrecognised name still decodes to the generic, never silently to an `ok`.
    expect(reconstructError(serializeError(new SomethingElseError()))).toBeInstanceOf(WireProtocolError);
  });

  it("★ NON-VACUITY — the three names really are distinct from each other", () => {
    const names = REFUSALS.map(([, make]) => make().name);
    expect(new Set(names).size).toBe(3);
  });
});
