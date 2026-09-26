// packages/sandbox-e2b-provider/src/__tests__/cli-017-b-export-secret-refusal.test.ts
//
// CLI-017-B — SD-5: the sandbox-scoped secret handoff and the export refusal (`E7-D11` section 3,
// ruling F7). Acceptance rows **2, 6, 6b, 7, 8** and the EXPORT half of row 5, plus `E7-F039`'s
// SD-5 arm (outcome (ii)) and `E7-F040`'s abort-fired proof.
//
// WHAT THE PROBE MEASURED, because this suite exists to close a measured hazard rather than an
// imagined one: run `35833717162`, arm `S-P7`, verdict `nonce-exported-in-file-bytes`,
// decision-table row **R4** on `noncePresent=true`. An environment value CAN land in a file under
// `R` and be read back out of the sandbox. Without a provider-side refusal a tenant secret written
// into `R` reaches a durable store, which Decision #104 forbids.
//
// WHAT THIS DOES NOT CLAIM. SD-5 is a LITERAL-VALUE refusal and is not a boundary against a
// hostile agent — row 8 below carries the encoded, reversed and split cases as CHARACTERISATION
// tests asserting they PASS THROUGH, which is the current behaviour. The residual is `E7-F038`
// (MEDIUM, open, `unowned`) and it is NOT closed by this slice shipping.

import { describe, expect, it, vi } from "vitest";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { MockE2bTransport } from "../mock-transport.js";
import { createRunSecretExportScanner, classifyRunSecrets, isSecretClassified } from "../export-secret-scan.js";
import {
  SandboxExportScannerRefusedError,
  SandboxExportSecretSetUnavailableError,
} from "../errors.js";

const ROOT = "/home/user/aoa-output";
const CTX = { deadlineMs: 5_000 } as never;
const LABELS = { leaseId: "lease-1", attemptId: "attempt-1", deviceGeneration: 1 } as never;

/** A realistic redeemed credential: long, high-entropy, and matched by the value patterns. */
const SECRET_A = "sk-ant-api03-AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555";
const SECRET_B = "sk-ant-api03-ZZZZ9999YYYY8888XXXX7777WWWW6666VVVV5555";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Replace `fetch` with a recorder; every PUT body is kept as text. Restored by the caller. */
function recordingFetch(): { puts: string[]; restore: () => void } {
  const puts: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: unknown }) => {
    const body = init?.body;
    puts.push(typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array));
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;
  return { puts, restore: () => { globalThis.fetch = original; } };
}

function grantFor(described: { sha256: string; sizeBytes: number }) {
  return {
    protocolVersion: 1,
    operation: "upload",
    artifactId: "a",
    method: "PUT",
    url: "https://store.example/put",
    headers: {},
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    maxBytes: described.sizeBytes,
    expectedSha256: described.sha256,
    objectKey: "k",
    redaction: "secret",
  } as never;
}

/**
 * A provider over a live mock sandbox, created THROUGH `provider.create` so SD-5's registry is
 * populated exactly as production populates it. `env` is the run's own environment.
 */
async function sandbox(options: {
  env: Record<string, string>;
  scanner?: unknown;
  ttlMs?: number;
  provider?: E2bSandboxProvider;
  transport?: MockE2bTransport;
}) {
  const transport = options.transport ?? new MockE2bTransport();
  const provider =
    options.provider ??
    new E2bSandboxProvider({
      transport,
      scanExportBytes: (options.scanner ?? createRunSecretExportScanner()) as never,
    });
  const { sandboxId } = await provider.create(
    { resourceLabels: LABELS, command: "claude", args: [], env: options.env, workloadType: "batch" },
    (options.ttlMs === undefined ? CTX : ({ deadlineMs: options.ttlMs } as never)),
  );
  return { provider, transport, sandboxId };
}

/** Plant `body` at `R/answer.md`, digest it, and return the matching grant. */
async function planted(provider: E2bSandboxProvider, transport: MockE2bTransport, sandboxId: string, body: string) {
  transport.plantFile(sandboxId, `${ROOT}/answer.md`, enc(body));
  const described = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
  return grantFor(described);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 2 — PC-11. A planted canary env value written into `R/x` makes the export REFUSE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 2 (PC-11) — a secret does not reach the store", () => {
  it("a canary env value written into `R/x` REFUSES, and the store receives NOTHING", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const grant = await planted(provider, transport, sandboxId, `here is the key: ${SECRET_A}\n`);

    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }

    // ★★★ THE STORE FIRST. `E7-D11` names the STORED artifact, not the return value, as what
    // separates a bound from a hole. An assertion on the error kind placed first would throw
    // before ever looking at the store.
    expect(store.puts).toEqual([]);
    expect(store.puts.join("")).not.toContain(SECRET_A);
    // …and only then, the classification.
    expect(outcome).toBeInstanceOf(SandboxExportScannerRefusedError);
    // Row 7: the refusal names no value, no path, no key.
    const message = String((outcome as Error).message);
    expect(message).not.toContain(SECRET_A);
    expect(message).not.toContain("ANTHROPIC_API_KEY");
    expect(message).not.toContain(`${ROOT}/answer.md`);
  });

  it("★ THE MUTANT — a provider WITHOUT the check exports the very same bytes", async () => {
    // The row's stated positive control: "a provider without the check exports it — run the same
    // case against the pre-change path and see the bytes exported". The pre-change path is a
    // scanner that inspects nothing, which is exactly what shipped before SD-5's scanner existed.
    const { provider, transport, sandboxId } = await sandbox({
      env: { ANTHROPIC_API_KEY: SECRET_A },
      scanner: () => undefined,
    });
    const grant = await planted(provider, transport, sandboxId, `here is the key: ${SECRET_A}\n`);
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    // Without the check the credential lands in durable object storage. This is the hazard.
    expect(store.puts.join("")).toContain(SECRET_A);
  });

  it("★ NEGATIVE HALF — the same run's CLEAN bytes export normally", async () => {
    // Without this, "refuses" would be indistinguishable from "export never works".
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const grant = await planted(provider, transport, sandboxId, "a perfectly ordinary deliverable\n");
    const store = recordingFetch();
    let result: unknown;
    try {
      result = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    expect(result).toEqual({ objectKey: "k" });
    expect(store.puts).toEqual(["a perfectly ordinary deliverable\n"]);
  });

  it("★ a run with NO secret-classified env exports freely — over-refusal would be an outage", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { LANG: "C", CI: "1", TERM: "xterm" } });
    const grant = await planted(provider, transport, sandboxId, "output mentioning C and 1 and xterm\n");
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    // The length floor is what stops `CI=1` refusing every export in the fleet.
    expect(store.puts).toEqual(["output mentioning C and 1 and xterm\n"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 6 — fail-closed when the secret set is ABSENT (the adapter-manager-restart state).
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 6 — an export with NO registered secret set is REFUSED", () => {
  it("the restart state: a live sandbox this provider never created REFUSES, and nothing is read", async () => {
    const transport = new MockE2bTransport();
    // A sandbox that exists in the fleet but was created by a PREVIOUS process — exactly what an
    // adapter-manager restart leaves behind. The registry is process memory and is empty for it.
    const { sandboxId } = await transport.create({ templateId: "base", timeoutMs: 60_000, metadata: {}, envVars: {} });
    transport.plantFile(sandboxId, `${ROOT}/answer.md`, enc("hello"));

    let reads = 0;
    const watchingTransport = new Proxy(transport, {
      get(target, prop, receiver) {
        if (prop === "readFile") {
          return (...args: unknown[]) => {
            reads += 1;
            return (target as unknown as Record<string, (...a: unknown[]) => unknown>).readFile.apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const provider = new E2bSandboxProvider({
      transport: watchingTransport as unknown as MockE2bTransport,
      scanExportBytes: createRunSecretExportScanner() as never,
    });

    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider
        .exportArtifact(sandboxId, `${ROOT}/answer.md`, grantFor({ sha256: "x".repeat(64), sizeBytes: 5 }), CTX)
        .catch((e) => e);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual([]);
    expect(outcome).toBeInstanceOf(SandboxExportSecretSetUnavailableError);
    // ★ REFUSED BEFORE THE READ. The bytes were never even materialised.
    expect(reads).toBe(0);
  });

  it("★ POSITIVE CONTROL — the SAME sandbox, once created through this provider, exports", async () => {
    // Without this the row above would pass for a provider that refuses everything always.
    const { provider, transport, sandboxId } = await sandbox({ env: {} });
    const grant = await planted(provider, transport, sandboxId, "hello");
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual(["hello"]);
  });

  it("★ after DESTROY the set is purged, and a later export for that sandbox hits the row-6 arm", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const grant = await planted(provider, transport, sandboxId, "hello");
    expect(provider.registeredSecretSetCount()).toBe(1);
    await provider.destroy(sandboxId, CTX);
    expect(provider.registeredSecretSetCount()).toBe(0);
    await expect(provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX)).rejects.toBeInstanceOf(
      SandboxExportSecretSetUnavailableError,
    );
  });

  it("★ reconcileCleanup purges too, and a SECOND purge is a no-op (idempotent, no throw)", async () => {
    const { provider, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    await provider.reconcileCleanup(sandboxId, CTX);
    expect(provider.registeredSecretSetCount()).toBe(0);
    await provider.destroy(sandboxId, CTX);
    await provider.reconcileCleanup(sandboxId, CTX);
    expect(provider.registeredSecretSetCount()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 6b — the set expires with the sandbox, on the TTL, with NO cleanup call.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 6b — the secret set expires with the sandbox's own TTL", () => {
  it("advancing past the TTL with NO destroy/reconcileCleanup drops the entry, and row 6 then refuses", async () => {
    vi.useFakeTimers();
    try {
      const { provider, transport, sandboxId } = await sandbox({
        env: { ANTHROPIC_API_KEY: SECRET_A },
        ttlMs: 60_000,
      });
      const grant = await planted(provider, transport, sandboxId, "hello");
      // NON-VACUITY: it is really there before the clock moves, and it really exports.
      expect(provider.registeredSecretSetCount()).toBe(1);

      vi.advanceTimersByTime(59_999);
      expect(provider.registeredSecretSetCount()).toBe(1);
      vi.advanceTimersByTime(2);
      // Gone, with neither cleanup method ever called on this provider instance.
      expect(provider.registeredSecretSetCount()).toBe(0);

      await expect(provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX)).rejects.toBeInstanceOf(
        SandboxExportSecretSetUnavailableError,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("★ explicit cleanup still purges AND leaves no stale timer that could purge a successor", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockE2bTransport();
      const provider = new E2bSandboxProvider({
        transport,
        scanExportBytes: createRunSecretExportScanner() as never,
      });
      const first = await provider.create(
        { resourceLabels: LABELS, command: "claude", args: [], env: { API_KEY: SECRET_A }, workloadType: "batch" },
        { deadlineMs: 60_000 } as never,
      );
      await provider.destroy(first.sandboxId, CTX);
      expect(provider.registeredSecretSetCount()).toBe(0);

      // A NEW sandbox now, then the old timer's deadline passes. A timer that was not cancelled —
      // or one that purged by key rather than by entry identity — would delete the live set here,
      // and a live sandbox whose set has vanished refuses every export (a self-inflicted outage
      // that looks exactly like the control working).
      const second = await provider.create(
        { resourceLabels: LABELS, command: "claude", args: [], env: { API_KEY: SECRET_B }, workloadType: "batch" },
        { deadlineMs: 300_000 } as never,
      );
      vi.advanceTimersByTime(120_000);
      expect(provider.registeredSecretSetCount()).toBe(1);

      // And the surviving set is the SECOND sandbox's, not a resurrected first.
      transport.plantFile(second.sandboxId, `${ROOT}/answer.md`, enc(`leak ${SECRET_B}`));
      const described = await provider.digestArtifact(second.sandboxId, `${ROOT}/answer.md`, CTX);
      await expect(
        provider.exportArtifact(second.sandboxId, `${ROOT}/answer.md`, grantFor(described), CTX),
      ).rejects.toBeInstanceOf(SandboxExportScannerRefusedError);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 5 (export half) — CROSS-TENANT, founder ruling F10.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 5 (F10) — the handoff is keyed by sandboxId, so tenants never read each other", () => {
  it("B's export is NOT refused on A's secrets, and A's own export IS refused on A's", async () => {
    // Two Organizations on ONE provider instance — the shape a global secret set would fail, in
    // both directions at once.
    const transport = new MockE2bTransport();
    const provider = new E2bSandboxProvider({
      transport,
      scanExportBytes: createRunSecretExportScanner() as never,
    });
    const a = await provider.create(
      { resourceLabels: LABELS, command: "claude", args: [], env: { ANTHROPIC_API_KEY: SECRET_A }, workloadType: "batch" },
      CTX,
    );
    const b = await provider.create(
      { resourceLabels: LABELS, command: "claude", args: [], env: { ANTHROPIC_API_KEY: SECRET_B }, workloadType: "batch" },
      CTX,
    );
    expect(a.sandboxId).not.toBe(b.sandboxId);

    // Organization B writes a file that happens to contain ORGANIZATION A's secret value. B's
    // export must NOT be refused on A's secrets — B's set is the only one consulted for B.
    transport.plantFile(b.sandboxId, `${ROOT}/answer.md`, enc(`mentions ${SECRET_A}`));
    const bDescribed = await provider.digestArtifact(b.sandboxId, `${ROOT}/answer.md`, CTX);
    const bStore = recordingFetch();
    try {
      await provider.exportArtifact(b.sandboxId, `${ROOT}/answer.md`, grantFor(bDescribed), CTX);
    } finally {
      bStore.restore();
    }
    expect(bStore.puts).toEqual([`mentions ${SECRET_A}`]);

    // SAME-TENANT POSITIVE CONTROL: the identical bytes in ORGANIZATION A's OWN sandbox refuse.
    // Without it the arm above would pass for a provider whose scan does nothing at all.
    transport.plantFile(a.sandboxId, `${ROOT}/answer.md`, enc(`mentions ${SECRET_A}`));
    const aDescribed = await provider.digestArtifact(a.sandboxId, `${ROOT}/answer.md`, CTX);
    const aStore = recordingFetch();
    let aOutcome: unknown;
    try {
      aOutcome = await provider
        .exportArtifact(a.sandboxId, `${ROOT}/answer.md`, grantFor(aDescribed), CTX)
        .catch((e) => e);
    } finally {
      aStore.restore();
    }
    expect(aStore.puts).toEqual([]);
    expect(aOutcome).toBeInstanceOf(SandboxExportScannerRefusedError);

    // And the mirror: B's own secret refuses in B's sandbox.
    transport.plantFile(b.sandboxId, `${ROOT}/own.md`, enc(`mentions ${SECRET_B}`));
    const bOwn = await provider.digestArtifact(b.sandboxId, `${ROOT}/own.md`, CTX);
    await expect(provider.exportArtifact(b.sandboxId, `${ROOT}/own.md`, grantFor(bOwn), CTX)).rejects.toBeInstanceOf(
      SandboxExportScannerRefusedError,
    );
  });

  it("★ tearing ONE tenant down leaves the OTHER's set intact", async () => {
    const transport = new MockE2bTransport();
    const provider = new E2bSandboxProvider({
      transport,
      scanExportBytes: createRunSecretExportScanner() as never,
    });
    const a = await provider.create(
      { resourceLabels: LABELS, command: "claude", args: [], env: { API_KEY: SECRET_A }, workloadType: "batch" },
      CTX,
    );
    const b = await provider.create(
      { resourceLabels: LABELS, command: "claude", args: [], env: { API_KEY: SECRET_B }, workloadType: "batch" },
      CTX,
    );
    expect(provider.registeredSecretSetCount()).toBe(2);
    await provider.destroy(a.sandboxId, CTX);
    expect(provider.registeredSecretSetCount()).toBe(1);

    transport.plantFile(b.sandboxId, `${ROOT}/answer.md`, enc(`leak ${SECRET_B}`));
    const described = await provider.digestArtifact(b.sandboxId, `${ROOT}/answer.md`, CTX);
    await expect(
      provider.exportArtifact(b.sandboxId, `${ROOT}/answer.md`, grantFor(described), CTX),
    ).rejects.toBeInstanceOf(SandboxExportScannerRefusedError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 7 — the set is not durable and does not leak.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 7 — the secret set is process memory only, and it leaks nowhere", () => {
  it("it is absent from the transport's recorded METADATA, from `list` and from `inspect`", async () => {
    const { provider, transport, sandboxId } = await sandbox({
      env: { ANTHROPIC_API_KEY: SECRET_A, DATABASE_URL: `postgres://u:${SECRET_B}@h/db` },
    });

    // The metadata E2B would persist. `[Cred-1]` (DEP-012 slices 4+5) and Decision #104 forbid the
    // tenant env from reaching it, and SD-5's registry must not have re-introduced the copy.
    const record = await transport.getInfo(sandboxId);
    const metadataText = JSON.stringify(record.metadata ?? {});
    expect(metadataText).not.toContain(SECRET_A);
    expect(metadataText).not.toContain(SECRET_B);

    const listed = JSON.stringify(await provider.list({ pageSize: 10 } as never, CTX));
    expect(listed).not.toContain(SECRET_A);
    expect(listed).not.toContain(SECRET_B);

    const inspected = JSON.stringify(await provider.inspect(sandboxId, CTX));
    expect(inspected).not.toContain(SECRET_A);
    expect(inspected).not.toContain(SECRET_B);

    // NON-VACUITY: the values really were registered — otherwise every assertion above is trivial.
    expect(provider.registeredSecretSetCount()).toBe(1);
  });

  it("it is absent from every THROWN message on the refusal path, and from the provider's own JSON", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const grant = await planted(provider, transport, sandboxId, `leak ${SECRET_A}`);
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }
    const error = outcome as Error;
    expect(`${error.name} ${error.message} ${error.stack ?? ""}`).not.toContain(SECRET_A);
    // The provider object itself must not serialise the set: `#runSecrets` is a private field.
    expect(JSON.stringify(provider)).not.toContain(SECRET_A);
    expect(Object.keys(provider as unknown as Record<string, unknown>).join(",")).not.toContain("runSecrets");
  });

  it("the registry's observable reports a COUNT, never a value", () => {
    expect(typeof new E2bSandboxProvider({
      transport: new MockE2bTransport(),
      scanExportBytes: createRunSecretExportScanner() as never,
    }).registeredSecretSetCount()).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Row 8 — CHARACTERISATION. The encoded and split cases PASS THROUGH today. `E7-F038`.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B · row 8 — encoded and split credentials are characterised, NOT claimed closed", () => {
  it("★ a BASE64-encoded canary EXPORTS — this is the current behaviour, and it is the gap", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const encoded = Buffer.from(SECRET_A, "utf8").toString("base64");
    const grant = await planted(provider, transport, sandboxId, `payload: ${encoded}\n`);
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    // A future boundary design must FLIP this row to a refusal. A build that quietly makes it
    // pass as a refusal without a ruling has improvised a boundary (`E7-F038` is out of `M1b`).
    expect(store.puts).toEqual([`payload: ${encoded}\n`]);
    expect(store.puts.join("")).not.toContain(SECRET_A);
  });

  it("★ a HEX-encoded and a REVERSED canary both EXPORT", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    for (const [name, body] of [
      ["hex", Buffer.from(SECRET_A, "utf8").toString("hex")],
      ["reversed", [...SECRET_A].reverse().join("")],
    ] as const) {
      transport.plantFile(sandboxId, `${ROOT}/${name}.md`, enc(body));
      const described = await provider.digestArtifact(sandboxId, `${ROOT}/${name}.md`, CTX);
      const store = recordingFetch();
      try {
        await provider.exportArtifact(sandboxId, `${ROOT}/${name}.md`, grantFor(described), CTX);
      } finally {
        store.restore();
      }
      expect(store.puts, `${name} is characterised as PASSING THROUGH`).toEqual([body]);
    }
  });

  it("★ a canary SPLIT across two files exports both — the per-file policy (E5-D07) sees neither half", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const half = Math.ceil(SECRET_A.length / 2);
    const parts = [SECRET_A.slice(0, half), SECRET_A.slice(half)];
    const exported: string[] = [];
    for (const [index, part] of parts.entries()) {
      transport.plantFile(sandboxId, `${ROOT}/part${index}.md`, enc(part));
      const described = await provider.digestArtifact(sandboxId, `${ROOT}/part${index}.md`, CTX);
      const store = recordingFetch();
      try {
        await provider.exportArtifact(sandboxId, `${ROOT}/part${index}.md`, grantFor(described), CTX);
      } finally {
        store.restore();
      }
      exported.push(...store.puts);
    }
    expect(exported).toEqual(parts);
    // And the gap, stated as an assertion rather than as prose: reassembled, the store now holds
    // the whole credential, while no single PUT ever carried it.
    expect(exported.join("")).toBe(SECRET_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// E7-F039's SD-5 arm — outcome (ii), and the FAIL condition asserted on the STORE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B / E7-F039 — outcome (ii): SD-5 refuses the bytes a won swap would export", () => {
  // `E7-F039` names exactly two acceptable outcomes for a symlink swap between the `lstat` check
  // and the read: (i) the `lstat` recheck refuses it — BUILT by `CLI-012` and pinned in
  // `enumerate-and-bounded-read.test.ts` — or (ii) it exports and SD-5's scan refuses the bytes.
  // Outcome (ii) is this slice's, and the bound it provides is why the residual is bounded rather
  // than a hole.
  //
  // ★ HOW THE RACE WINNER IS MODELLED, STATED HONESTLY. A won race delivers the LINK TARGET's
  // bytes to the read. On this fixture the transport refuses a symlink outright, so the swap can
  // never reach the scan — which is outcome (i) holding absolutely, and it is already pinned.
  // What is NOT yet pinned is that SD-5 would catch it if outcome (i) ever regressed, so these
  // arms present the SAME BYTES the winner would deliver (`/proc/self/environ` and the run's own
  // staged prompt, each carrying the run's secrets) and assert SD-5 refuses them. That is the
  // property the bound rests on, and it is measured rather than argued.
  //
  // ★ THE KEYED REAL-RUN SWAP ATTEMPT IS STILL OWED, and this suite does not stand in for it.

  it("★★★ /proc/self/environ bytes: the STORE receives NOTHING (asserted BEFORE the error kind)", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    // What `R/l1 -> /proc/self/environ` would deliver: the run's environment, NUL-separated.
    const environBytes = `PATH=/usr/bin\0ANTHROPIC_API_KEY=${SECRET_A}\0HOME=/home/user\0`;
    const grant = await planted(provider, transport, sandboxId, environBytes);

    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }

    // ★★★ THE FAIL CONDITION, FIRST AND ON THE STORE. `E7-D11`: "a swap that produces a STORED
    // artifact containing the planted canary is a FAIL, not a residual."
    expect(store.puts).toEqual([]);
    expect(store.puts.join("")).not.toContain(SECRET_A);
    expect(outcome).toBeInstanceOf(SandboxExportScannerRefusedError);
  });

  it("★★★ the run's own STAGED PROMPT bytes, when they carry a secret, are refused too", async () => {
    const { provider, transport, sandboxId } = await sandbox({ env: { AOA_API_KEY: SECRET_B } });
    // What `R/l1 -> /home/user/.aoa-run-prompt.md` would deliver when the prompt carries the
    // run's own bearer — the §4.3 class the output mechanism was designed to exclude.
    const grant = await planted(provider, transport, sandboxId, `# Task\n\ntoken: ${SECRET_B}\n`);
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual([]);
    expect(outcome).toBeInstanceOf(SandboxExportScannerRefusedError);
  });

  it("★ POSITIVE CONTROL — a swap to a target with NO secret still exports (SD-5 is not a blanket refusal)", async () => {
    // `E7-F039`'s two outcomes are about secrets reaching storage. A target carrying no secret is
    // outside SD-5's remit and outcome (i) is what covers it — this arm keeps the two claims
    // distinct instead of letting "everything refuses" masquerade as a security property.
    const { provider, transport, sandboxId } = await sandbox({ env: { ANTHROPIC_API_KEY: SECRET_A } });
    const grant = await planted(provider, transport, sandboxId, "# Task\n\nnothing sensitive here\n");
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual(["# Task\n\nnothing sensitive here\n"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// E7-F040 — the scan seam now carries the op's abort signal. Abort-FIRED proof.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B / E7-F040 — the scan seam takes the op's signal, and it FIRES", () => {
  it("★★★ the scanner RECEIVES a signal and that signal FIRES when the op's deadline passes", async () => {
    // The shape `CLI-012` used for `readFile`/`listDir`/`statEntry`: assert the callee was handed
    // a non-undefined AbortSignal AND that it aborted. A test that only checks the CALLER returned
    // on time passes against the defect verbatim.
    let received: AbortSignal | undefined;
    let fired = false;
    const { provider, transport, sandboxId } = await sandbox({
      env: {},
      scanner: (input: { signal: AbortSignal }) => {
        received = input.signal;
        return new Promise<void>((resolve) => {
          input.signal.addEventListener("abort", () => {
            fired = true;
            resolve();
          });
          // Never settles on its own: only the abort ends it.
        });
      },
    });
    const grant = await planted(provider, transport, sandboxId, "hello");
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider
        .exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, { deadlineMs: 25 } as never)
        .catch((e) => e);
    } finally {
      store.restore();
    }
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received).not.toBeUndefined();
    expect(fired).toBe(true);
    // The op refuses on its own budget, and nothing is stored.
    expect(store.puts).toEqual([]);
    expect(String((outcome as Error).message)).toContain("secret scan timed out");
  });

  it("★ THE IN-DEADLINE TWIN — a scan that finishes inside the budget gets an UNaborted signal", async () => {
    // Without this the arm above would pass for a seam that handed over an already-aborted
    // signal, or for a provider whose budget was zero all along.
    let abortedAtCompletion: boolean | undefined;
    let sawSignal = false;
    const { provider, transport, sandboxId } = await sandbox({
      env: {},
      scanner: async (input: { signal: AbortSignal }) => {
        sawSignal = input.signal instanceof AbortSignal;
        abortedAtCompletion = input.signal.aborted;
      },
    });
    const grant = await planted(provider, transport, sandboxId, "hello");
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, { deadlineMs: 5_000 } as never);
    } finally {
      store.restore();
    }
    expect(sawSignal).toBe(true);
    expect(abortedAtCompletion).toBe(false);
    expect(store.puts).toEqual(["hello"]);
  });

  it("★ the scanner is handed THIS sandbox's secret set, not a global one", async () => {
    let handed: readonly string[] | undefined;
    let handedSandboxId: string | undefined;
    const { provider, transport, sandboxId } = await sandbox({
      env: { ANTHROPIC_API_KEY: SECRET_A, LANG: "C" },
      scanner: (input: { secrets: readonly string[]; sandboxId: string }) => {
        handed = input.secrets;
        handedSandboxId = input.sandboxId;
      },
    });
    const grant = await planted(provider, transport, sandboxId, "hello");
    const store = recordingFetch();
    try {
      await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    expect(handedSandboxId).toBe(sandboxId);
    // The classified value, and NOT the short structural one.
    expect(handed).toEqual([SECRET_A]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// The classification rule itself.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("CLI-017-B — the secret classification, stated and pinned", () => {
  it("classifies by KEY name, by VALUE shape, and never below the length floor", () => {
    expect(isSecretClassified("ANTHROPIC_API_KEY", SECRET_A)).toBe(true);
    expect(isSecretClassified("MY_TOKEN", "abcdefghijklmnop")).toBe(true);
    // Value shape, on an innocuously named variable.
    expect(isSecretClassified("DATABASE_URL", "postgres://u:p@host/db")).toBe(true);
    expect(isSecretClassified("ENDPOINT", SECRET_A)).toBe(true);
    // Below the floor — the anti-collision arm. Without it these refuse every export.
    expect(isSecretClassified("CI", "1")).toBe(false);
    expect(isSecretClassified("API_KEY", "short")).toBe(false);
    expect(isSecretClassified("LANG", "C")).toBe(false);
    // Non-strings are never classified.
    expect(isSecretClassified("API_KEY", undefined)).toBe(false);

    // ★★★ THE SHORT-FRAGMENT CLASS, swept rather than spot-fixed. `pat` as a bare substring
    // classifies `PATH` — which every sandbox has, whose value clears the length floor, and which
    // appears in any deliverable printing a shell line. That would have refused a large share of
    // clean exports while looking like a working control. All three fragments at or below three
    // characters (`pat`, `dsn`, `jwt`) are token-anchored; these arms pin the anchoring in both
    // directions.
    expect(isSecretClassified("PATH", "/usr/local/bin:/usr/bin")).toBe(false);
    expect(isSecretClassified("COMPATIBILITY_MODE", "legacy-behaviour-on")).toBe(false);
    expect(isSecretClassified("JWTISON", "not-a-token-name-at-all")).toBe(false);
    expect(isSecretClassified("DSNAKE", "just-a-long-plain-value")).toBe(false);
    // …and the anchored forms DO still classify, so the fix did not turn the fragments off.
    expect(isSecretClassified("GITHUB_PAT", "aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isSecretClassified("PAT", "aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isSecretClassified("SENTRY_DSN_PROD", "aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isSecretClassified("JWT", "aaaaaaaaaaaaaaaaaaaa")).toBe(true);
  });

  it("classifyRunSecrets returns DISTINCT VALUES only — never the key names", () => {
    const values = classifyRunSecrets({
      ANTHROPIC_API_KEY: SECRET_A,
      COPY_OF_THE_SAME_TOKEN: SECRET_A,
      LANG: "C",
      PATH: "/usr/local/bin:/usr/bin",
    });
    expect(values).toEqual([SECRET_A]);
    expect(values.join(",")).not.toContain("ANTHROPIC_API_KEY");
    expect(classifyRunSecrets(undefined)).toEqual([]);
    expect(classifyRunSecrets({})).toEqual([]);
  });

  it("the scanner is a no-op on an EMPTY secret set, and refuses on a non-empty match", () => {
    const scan = createRunSecretExportScanner();
    const signal = new AbortController().signal;
    expect(() => scan({ bytes: enc("anything"), sandboxId: "s", secrets: [], signal })).not.toThrow();
    expect(() => scan({ bytes: enc(`x${SECRET_A}y`), sandboxId: "s", secrets: [SECRET_A], signal })).toThrow();
    expect(() => scan({ bytes: enc("clean"), sandboxId: "s", secrets: [SECRET_A], signal })).not.toThrow();
  });

  it("★ a BINARY artifact is still SCANNED, not waved through as 'not text'", () => {
    const scan = createRunSecretExportScanner();
    const signal = new AbortController().signal;
    // Invalid UTF-8 around an ASCII secret: lossy decoding must not lose the secret.
    const bytes = new Uint8Array([0xff, 0xfe, ...enc(SECRET_A), 0x00, 0xc3]);
    expect(() => scan({ bytes, sandboxId: "s", secrets: [SECRET_A], signal })).toThrow();
  });
});
