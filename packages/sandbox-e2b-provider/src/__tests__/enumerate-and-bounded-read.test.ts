// -----------------------------------------------------------------------------
// CLI-012 (ruling F7, `docs/replatform/epics/E7-coding-e2b/decisions.md` `E7-D11`) —
// the provider half: metadata-only enumeration, the no-follow recheck (`E7-F039`) and the
// BOUNDED read (`E5-F009`).
//
// ★ THE MEASUREMENT THIS SUITE RESTS ON, recorded so the branch is auditable.
// `E7-D11` authorized two implementations of the `A-O2-4` refusal and told this ticket to
// MEASURE which is reachable against the INSTALLED SDK rather than guess. Measured at
// `e2b@2.30.5` (the version `package.json` pins and `pnpm` resolved into this worktree):
//   * `FilesystemReadOpts` = `{gzip?, streamIdleTimeoutMs?}` over `{requestTimeoutMs?, signal?}`
//     — NO no-follow flag, and no file-descriptor/handle-bound read anywhere in the package's
//     type surface. So the ATOMIC open-and-read is unreachable.
//   * `Filesystem.getInfo(path) => EntryInfo` carries `symlinkTarget?: string` — the `lstat`.
//   * `Filesystem.read(path, {format: "stream"}) => ReadableStream<Uint8Array>` — the bounded
//     read `E5-F009` needs.
// ⇒ BRANCH TAKEN: the per-entry `lstat` (the pre-authorized second means), and a streaming
// bounded read. The residual race between the stat and the read is `E7-F039`, bounded by SD-5.
//
// Key-free: the real binding is driven through its injected-SDK seam, the mock through its own.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { E2bSandboxProvider, E2B_MAX_ARTIFACT_BYTES } from "../e2b-provider.js";
import {
  SandboxNotFoundError,
  SandboxExportScannerUnavailableError,
  SandboxExportScannerRefusedError,
} from "../errors.js";
import { MockE2bTransport } from "../mock-transport.js";
import { RealE2bTransport, readStreamBounded, entryFromInfo } from "../real-transport.js";
import {
  E2bReadBoundExceededError,
  E2bSymlinkRefusedError,
  E2bListDirMalformedEntryError,
  E2bTransportNotFoundError,
  E2bTransportPathNotFoundError,
} from "../transport.js";
import { METADATA_KEYS } from "../directives.js";

const CTX = { deadlineMs: 5_000 } as never;
const ROOT = "/home/user/aoa-output";

async function providerOver(): Promise<{ provider: E2bSandboxProvider; transport: MockE2bTransport; sandboxId: string }> {
  const transport = new MockE2bTransport();
  const { sandboxId } = await transport.create({
    templateId: "base",
    timeoutMs: 60_000,
    metadata: { [METADATA_KEYS.env]: "{}" },
    envVars: {},
  });
  // CLI-012 (SD-5) — a PRESENT, CLEAN scanner: every export refuses without one, fail-closed on
  // its presence. The refusal has its own describe block below, with both controls.
  return {
    provider: new E2bSandboxProvider({ transport, scanExportBytes: () => undefined }),
    transport,
    sandboxId,
  };
}

describe("CLI-012 — enumerateOutputs is metadata-only and carries the marker and the size", () => {
  it("returns absolute paths under the root with sizes and link markers, and NO content field", async () => {
    const { provider, transport, sandboxId } = await providerOver();
    transport.plantFile(sandboxId, "/home/user/.aoa-run-prompt.md", new TextEncoder().encode("PROMPT"));
    transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode("hello"));
    transport.plantSymlink(sandboxId, `${ROOT}/l1`, "/home/user/.aoa-run-prompt.md");

    const result = await provider.enumerateOutputs(sandboxId, ROOT, CTX);
    expect(result.entries).toEqual([
      { path: `${ROOT}/answer.md`, sizeBytes: 5, symlink: false },
      { path: `${ROOT}/l1`, sizeBytes: 6, symlink: true },
    ]);
    // ★ NO BYTES. The whole reason this op exists rather than `captureSandboxEntries`.
    for (const entry of result.entries) {
      expect(Object.keys(entry).sort()).toEqual(["path", "sizeBytes", "symlink"]);
    }
    // And nothing outside the root leaked in, even though it is planted in the same sandbox.
    expect(result.entries.map((e) => e.path)).not.toContain("/home/user/.aoa-run-prompt.md");
  });

  it("declares `metadata`, and an exhausted budget refuses BEFORE the listing", async () => {
    const { provider, sandboxId } = await providerOver();
    expect(provider.sandboxEnumerationMode).toBe("metadata");
    await expect(provider.enumerateOutputs(sandboxId, ROOT, { deadlineMs: 0 } as never)).rejects.toThrow(
      /budget exhausted/,
    );
  });
});

describe("CLI-012 / E7-F039 — the no-follow recheck at the READ boundary", () => {
  it("★★★ a file swapped for a SYMLINK after enumeration is REFUSED at digest, not hashed", async () => {
    const { provider, transport, sandboxId } = await providerOver();
    transport.plantFile(sandboxId, "/home/user/.aoa-run-prompt.md", new TextEncoder().encode("CANARY-PROMPT"));
    transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode("real output"));

    // NON-VACUITY FIRST: before the swap this digests normally, so the refusal below is caused
    // by the swap and not by the file being unreachable all along.
    const before = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
    expect(before.sizeBytes).toBe(11);

    // ★ THE MUTATION IS **BETWEEN ENUMERATION AND THE READ**, which is the only placement that
    // distinguishes a vulnerable implementation from a safe one: a check that ran only at
    // enumeration would pass here and the digest would hash the TARGET.
    transport.plantSymlink(sandboxId, `${ROOT}/answer.md`, "/home/user/.aoa-run-prompt.md");

    await expect(provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX)).rejects.toBeInstanceOf(
      E2bSymlinkRefusedError,
    );
    // ★ THE CANARY NEVER BECOMES A DIGEST. Without the recheck the call would have returned the
    // sha256 of "CANARY-PROMPT" — the run's own staged input, described as its output.
    const canaryDigest = await provider
      .digestArtifact(sandboxId, "/home/user/.aoa-run-prompt.md", CTX)
      .catch(() => null);
    expect(canaryDigest).not.toBeNull();
    await expect(provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX)).rejects.toBeInstanceOf(
      E2bSymlinkRefusedError,
    );
  });

  it("★ the EXPORT path is rechecked too — both read boundaries, not just the first", async () => {
    const { provider, transport, sandboxId } = await providerOver();
    const body = "real output";
    transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode(body));
    const described = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
    const grant = {
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

    transport.plantFile(sandboxId, "/home/user/.aoa-run-prompt.md", new TextEncoder().encode(body));
    transport.plantSymlink(sandboxId, `${ROOT}/answer.md`, "/home/user/.aoa-run-prompt.md");
    // ★ THE TARGET HASHES IDENTICALLY, which is exactly why the existing re-hash TOCTOU check
    // cannot catch this class: digest and export would both read the same stable bytes and the
    // comparison would PASS. Only the no-follow recheck refuses it.
    await expect(provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX)).rejects.toBeInstanceOf(
      E2bSymlinkRefusedError,
    );
  });

  // ---------------------------------------------------------------------------------------
  // ★★★ THE STORE ITSELF, NOT THE RETURN VALUE — `E7-D11`'s FAIL condition, run rather than
  // reasoned about. E7-D11 admits exactly two outcomes for a deliberate swap: (i) the `lstat`
  // check refuses it, or (ii) it exports and SD-5's scan refuses the bytes — and says in terms
  // that *"a swap that produces a STORED artifact containing the planted canary is a FAIL of
  // this ticket, not a residual"*. The two arms above assert that the CALL rejects, which is
  // not the same claim: a PUT already in flight, or a second write path, would still have put
  // the canary in the object store. So this arm watches the STORE.
  //
  // ★ SD-5 IS NOT CLI-012's, and this test does not pretend otherwise. Verified at source in
  // `decisions.md` `E7-D11`: SD-5's sandbox-scoped secret handoff and refusal are `CLI-017-B`'s
  // build ("SD-5 cannot be delivered by adding a content check to `exportArtifact` alone").
  // So outcome (ii) is unavailable here, and this asserts outcome (i) holds ABSOLUTELY on the
  // fixture: on the swap, the store receives NOTHING. If the recheck ever regresses, this reds
  // on the stored bytes, which is the condition E7-D11 calls a FAIL.
  // ---------------------------------------------------------------------------------------
  describe("★★★ the OBJECT STORE never receives the canary (E7-D11's FAIL condition)", () => {
    const CANARY = "CANARY-SECRET-aoa-cli012";

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

    it("★ POSITIVE CONTROL — an UNswapped file really does reach the store (so the arm below is not vacuous)", async () => {
      const { provider, transport, sandboxId } = await providerOver();
      transport.plantFile(sandboxId, "/home/user/.aoa-run-prompt.md", new TextEncoder().encode(CANARY));
      transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode("real output"));
      const described = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
      const store = recordingFetch();
      try {
        await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grantFor(described), CTX);
      } finally {
        store.restore();
      }
      // The recorder WORKS and the store is reachable — without this the arm below would pass
      // for a provider that simply never uploads anything.
      expect(store.puts).toEqual(["real output"]);
      expect(store.puts.join("")).not.toContain(CANARY);
    });

    it("★★★ a file SWAPPED for a symlink to the canary puts NOTHING in the store", async () => {
      const { provider, transport, sandboxId } = await providerOver();
      transport.plantFile(sandboxId, "/home/user/.aoa-run-prompt.md", new TextEncoder().encode(CANARY));
      transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode(CANARY));
      // Digested BEFORE the swap, so the grant's `expectedSha256` matches the target exactly —
      // the re-hash TOCTOU check provably cannot catch this, and only the recheck can.
      const described = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
      transport.plantSymlink(sandboxId, `${ROOT}/answer.md`, "/home/user/.aoa-run-prompt.md");

      const store = recordingFetch();
      let outcome: unknown;
      try {
        outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grantFor(described), CTX).catch((e) => e);
      } finally {
        store.restore();
      }
      // ★★★ THE FAIL CONDITION IS ASSERTED FIRST, AND ON THE STORE — deliberately before the
      // error kind. `E7-D11` names the stored artifact, not the return value, as what separates
      // a bound from a hole, so the assertion that must red is the one about bytes at rest. A
      // `rejects` assertion placed first would throw before ever looking at the store and the
      // evidence would be about the CALL again.
      expect(store.puts).toEqual([]);
      expect(store.puts.join("")).not.toContain(CANARY);
      // …and only then, the classification.
      expect(outcome).toBeInstanceOf(E2bSymlinkRefusedError);
    });
  });
});

describe("CLI-012 / E5-F009 — the read itself is bounded", () => {
  it("★★★ a file that GREW between enumeration and digest is refused, not materialised", async () => {
    const { provider, transport, sandboxId } = await providerOver();
    // Inside the cap at enumeration...
    transport.plantFile(sandboxId, `${ROOT}/log.txt`, new Uint8Array(16));
    expect((await provider.enumerateOutputs(sandboxId, ROOT, CTX)).entries).toEqual([
      { path: `${ROOT}/log.txt`, sizeBytes: 16, symlink: false },
    ]);
    // ...and gigantic by the time the digest reads it (the `A-O2-9`/`W7` background-writer class).
    transport.plantFile(sandboxId, `${ROOT}/log.txt`, new Uint8Array(E2B_MAX_ARTIFACT_BYTES + 1));
    await expect(provider.digestArtifact(sandboxId, `${ROOT}/log.txt`, CTX)).rejects.toBeInstanceOf(
      E2bReadBoundExceededError,
    );
    // ★ THE PRE-DIGEST CHECK CANNOT CLOSE THIS. It is the cheap arm that avoids the read in the
    // common case; the listing size is a snapshot and this is the arm that refuses.
  });

  it("admits a file EXACTLY at the cap — the bound is not off by one", async () => {
    const { provider, transport, sandboxId } = await providerOver();
    transport.plantFile(sandboxId, `${ROOT}/exact.bin`, new Uint8Array(E2B_MAX_ARTIFACT_BYTES));
    const described = await provider.digestArtifact(sandboxId, `${ROOT}/exact.bin`, CTX);
    expect(described.sizeBytes).toBe(E2B_MAX_ARTIFACT_BYTES);
  });
});

describe("CLI-012 — readStreamBounded NEVER allocates past the cap", () => {
  function streamOf(chunks: readonly Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[i]!);
        i += 1;
      },
      cancel() {
        onCancel?.();
      },
    });
  }

  it("★★★ refuses at the chunk that would cross the cap, and CANCELS the stream", async () => {
    let cancelled = false;
    let delivered = 0;
    const chunks = Array.from({ length: 10 }, () => {
      delivered += 1;
      return new Uint8Array(4);
    });
    const err = await readStreamBounded(streamOf(chunks, () => (cancelled = true)), "/p", 10).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(E2bReadBoundExceededError);
    expect((err as E2bReadBoundExceededError).limit).toBe(10);
    // ★ The stream was CANCELLED rather than abandoned mid-flight — an abandoned read holds a
    // pooled connection open until the idle timeout.
    expect(cancelled).toBe(true);
    // NON-VACUITY: the source really had ten chunks to give.
    expect(delivered).toBe(10);
  });

  it("returns the exact bytes when they fit, in order", async () => {
    const out = await readStreamBounded(
      streamOf([new TextEncoder().encode("he"), new TextEncoder().encode("llo")]),
      "/p",
      16,
    );
    expect(new TextDecoder().decode(out)).toBe("hello");
  });
});

describe("CLI-012 — the real binding's stat mapping is fail-closed", () => {
  it("maps an SDK EntryInfo, and REFUSES one with no size or no classifiable type", () => {
    expect(entryFromInfo("/p", { size: 4, type: "file" })).toEqual({ path: "/p", sizeBytes: 4, symlink: false });
    expect(entryFromInfo("/p", { size: 4, type: "file", symlinkTarget: "/t" })).toEqual({
      path: "/p",
      sizeBytes: 4,
      symlink: true,
    });
    expect(() => entryFromInfo("/p", { type: "file" })).toThrow(E2bListDirMalformedEntryError);
    expect(() => entryFromInfo("/p", { size: 4 })).toThrow(E2bListDirMalformedEntryError);
    expect(() => entryFromInfo("/p", null)).toThrow(E2bListDirMalformedEntryError);
  });

  it("★ the real binding asks the SDK for a STREAM when a bound is given, and bytes when not", async () => {
    const formats: unknown[] = [];
    const sdk = {
      connect: async () => ({
        files: {
          read: async (_path: string, opts?: { format?: string }) => {
            formats.push(opts?.format);
            if (opts?.format === "stream") {
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("hi"));
                  controller.close();
                },
              });
            }
            return new TextEncoder().encode("hi");
          },
          getInfo: async () => ({ size: 2, type: "file" }),
        },
      }),
    };
    const transport = new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk });
    expect(new TextDecoder().decode(await transport.readFile("s", "/p", { maxBytes: 8 }))).toBe("hi");
    expect(new TextDecoder().decode(await transport.readFile("s", "/p"))).toBe("hi");
    // ★ A BOUNDED READ THAT SILENTLY FELL BACK TO `format: "bytes"` would materialise the whole
    // file and measure it afterwards — `E5-F009` exactly — while every size assertion still passed.
    expect(formats).toEqual(["stream", "bytes"]);
    expect(await transport.statEntry("s", "/p")).toEqual({ path: "/p", sizeBytes: 2, symlink: false });
  });
});

// ---------------------------------------------------------------------------------------
// CLI-012, second round (Codex P2, PR #576) — A MISSING OUTPUT ROOT IS "NO OUTPUT", NOT A
// MISSING SANDBOX.
//
// The task section's Failure behavior says in terms that *"an empty output root produces `[]`"*.
// A successful run that simply wrote nothing never creates `/home/user/aoa-output` at all, and
// the installed SDK rejects `files.list` on it with `FileNotFoundError`. `listDir` collapsed
// that into `E2bTransportNotFoundError` and `enumerateOutputs` then re-mapped it to
// `SandboxNotFoundError`, so every normal no-output run reported `producer_failed`.
//
// ★ THE DISCRIMINATION IS MEASURED, NOT GUESSED. `e2b@2.30.5`'s `dist/index.d.ts` declares
// `FileNotFoundError extends NotFoundError` and `SandboxNotFoundError extends NotFoundError`
// as two distinct classes, so the two cases really are distinguishable at source.
//
// ★ AND IT IS FAIL-CLOSED. Only an error POSITIVELY identified as a file-not-found becomes the
// path variant; anything else stays the sandbox error, so an unrecognisable failure is never
// reported as "the run produced nothing".
// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------
// CLI-012, planning-session ruling on §11.9 (2026-09-23) — THE SD-5 REFUSAL SHIPS BEFORE THE
// SCANNER, AND IT IS FAIL-CLOSED ON THE SCANNER'S PRESENCE.
//
// The ruling refused Codex's remedy (defer the composition) and upheld its premise. Deferral
// protects only the path someone remembered to defer, and the gate is NOT the distributed
// rollout flag: `composeDispatchRuntime` is called from the deployed worker's own boot
// (`worker-daemon.ts`, the `composeRuntime` call), whose surrounding branch fails closed on
// PROVIDERS. A deployed worker on an enabled tenant that leases a job takes this path.
//
// ★★★ SO THE CONTROL IS AT THE EXPORT BOUNDARY, KEYED ON THE SCANNER'S PRESENCE — never on a
// flag someone can set. Absent, malformed or throwing scanner ⇒ REFUSE; no bytes leave. The
// ship order inverts correctly: the refusal ships first and `CLI-017-B`'s scanner flips it on
// against an interface that already refuses without it.
// ---------------------------------------------------------------------------------------
describe("CLI-012 / SD-5 — an ABSENT export scanner REFUSES; no bytes leave the sandbox", () => {
  const SECRET = "SD5-CANARY-redeemed-secret";

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

  async function sandboxWith(
    scanExportBytes?: unknown,
  ): Promise<{ provider: E2bSandboxProvider; sandboxId: string; grant: never }> {
    const transport = new MockE2bTransport();
    const { sandboxId } = await transport.create({
      templateId: "base",
      timeoutMs: 60_000,
      metadata: { [METADATA_KEYS.env]: "{}" },
      envVars: {},
    });
    transport.plantFile(sandboxId, `${ROOT}/answer.md`, new TextEncoder().encode(SECRET));
    const provider = new E2bSandboxProvider({
      transport,
      ...(scanExportBytes === undefined ? {} : { scanExportBytes: scanExportBytes as never }),
    });
    const described = await provider.digestArtifact(sandboxId, `${ROOT}/answer.md`, CTX);
    const grant = {
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
    return { provider, sandboxId, grant };
  }

  it("★★★ NO SCANNER CONFIGURED — the export refuses and the STORE receives nothing", async () => {
    const { provider, sandboxId, grant } = await sandboxWith(undefined);
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }
    // ★ THE STORE ASSERTION FIRST, the same shape `E7-F039` uses: what must red on a regression
    // is the claim about bytes at rest, not the claim about the return value.
    expect(store.puts).toEqual([]);
    expect(store.puts.join("")).not.toContain(SECRET);
    expect(outcome).toBeInstanceOf(SandboxExportScannerUnavailableError);
    // ★ THE POSITIVE CONTROL THE RULING NAMES: delete the presence check in `exportArtifact` and
    // this same call SUCCEEDS with the secret bytes in `store.puts` — proving this arm is what
    // stops it, not some other guard.
  });

  it("★★★ A MALFORMED scanner is a REFUSAL, not a bypass", async () => {
    for (const malformed of [null, 42, "scan", {}]) {
      const { provider, sandboxId, grant } = await sandboxWith(malformed);
      const store = recordingFetch();
      let outcome: unknown;
      try {
        outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
      } finally {
        store.restore();
      }
      expect(store.puts, `malformed scanner ${JSON.stringify(malformed)} must not export`).toEqual([]);
      expect(outcome).toBeInstanceOf(SandboxExportScannerUnavailableError);
    }
  });

  it("★★★ A THROWING scanner is a REFUSAL, not a bypass — and its message never rides the error", async () => {
    const { provider, sandboxId, grant } = await sandboxWith(() => {
      throw new Error(`scanner blew up on https://store.example/put?sig=${SECRET}`);
    });
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual([]);
    expect(outcome).toBeInstanceOf(SandboxExportScannerRefusedError);
    // The scanner saw the bytes and may name the grant url in its own message; neither may ride out.
    expect(String((outcome as Error).message)).not.toContain(SECRET);
    expect(String((outcome as Error).message)).not.toContain("https://");
  });

  it("★★★ A scanner that REJECTS (a secret found) refuses, and nothing is stored", async () => {
    const seen: number[] = [];
    const { provider, sandboxId, grant } = await sandboxWith(async (bytes: Uint8Array) => {
      seen.push(bytes.byteLength);
      throw new Error("redeemed secret found in exported bytes");
    });
    const store = recordingFetch();
    let outcome: unknown;
    try {
      outcome = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX).catch((e) => e);
    } finally {
      store.restore();
    }
    expect(store.puts).toEqual([]);
    expect(outcome).toBeInstanceOf(SandboxExportScannerRefusedError);
    // NON-VACUITY: the scanner really was handed the file's bytes, not an empty buffer.
    expect(seen).toEqual([SECRET.length]);
  });

  it("★★★ ANTI-VACUITY — a scanner that is PRESENT and CLEAN exports normally", async () => {
    const scanned: number[] = [];
    const { provider, sandboxId, grant } = await sandboxWith(async (bytes: Uint8Array) => {
      scanned.push(bytes.byteLength);
    });
    const store = recordingFetch();
    let result: unknown;
    try {
      result = await provider.exportArtifact(sandboxId, `${ROOT}/answer.md`, grant, CTX);
    } finally {
      store.restore();
    }
    // Without this arm the refusal above would be indistinguishable from "export never works".
    expect(result).toEqual({ objectKey: "k" });
    expect(store.puts).toEqual([SECRET]);
    expect(scanned).toEqual([SECRET.length]);
  });
});

// ---------------------------------------------------------------------------------------
// CLI-012, Codex round 4 (P2) — THE DEADLINE BOUNDS THE OPERATION, NOT JUST THE CALLER.
//
// `boundedBySignal` returns at `ctx.deadlineMs` and deliberately leaves the abandoned work to
// settle on its own. So a read that keeps delivering chunks slowly was ABANDONED at the deadline
// while the SDK request ran on — holding a pooled connection, and still streaming a tenant's
// bytes into a shared adapter-manager process after the op that asked for them gave up. That is
// family 3 of the build rules' self-audit: a bound that bounds the caller is not a bound on the
// operation.
//
// ★ THE SEAM EXISTS: `e2b@2.30.5`'s `FilesystemRequestOpts` carries `signal`, and every
// `FilesystemReadOpts` extends it. So the fix is to thread it, not to invent one.
//
// ★★★ AND THE PROOF IS THE ABORT ITSELF, NOT THE CALLER'S TIMING. A test that only checked
// "the call rejected on time" would pass against the defect verbatim — `boundedBySignal` already
// guarantees that. What is asserted here is that the SDK RECEIVED an AbortSignal and that the
// signal FIRED.
// ---------------------------------------------------------------------------------------
describe("CLI-012 — a bounded read ABORTS the underlying SDK request, not merely the caller", () => {
  it("★★★ the SDK is handed a signal, and that signal is ABORTED when the deadline passes", async () => {
    let handed: AbortSignal | undefined;
    let aborted = false;
    const sdk = {
      connect: async () => ({
        files: {
          getInfo: async () => ({ size: 2, type: "file" }),
          read: async (_path: string, opts?: { format?: string; signal?: AbortSignal }) => {
            handed = opts?.signal;
            handed?.addEventListener("abort", () => {
              aborted = true;
            });
            // A stream that keeps delivering slowly and never ends: the shape the finding names.
            return new ReadableStream<Uint8Array>({
              async pull(controller) {
                await new Promise((r) => setTimeout(r, 5));
                controller.enqueue(new TextEncoder().encode("x"));
              },
            });
          },
        },
      }),
    };
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk }) as never });
    await expect(
      provider.digestArtifact("s", `${ROOT}/slow.bin`, { deadlineMs: 25 } as never),
    ).rejects.toThrow(/timed out/);

    // NON-VACUITY: the read really was reached and really was given a signal — not `undefined`,
    // which is what the defect handed it.
    expect(handed, "the SDK read received no AbortSignal at all").toBeInstanceOf(AbortSignal);
    // ★★★ THE CLAIM THAT MATTERS: the request was ABORTED, not abandoned.
    await new Promise((r) => setTimeout(r, 20));
    expect(handed!.aborted, "the signal handed to the SDK never fired").toBe(true);
    expect(aborted, "nothing observed the abort").toBe(true);
  });

  // -------------------------------------------------------------------------------------
  // ★★★ THE FAMILY SWEEP, not one more patch. The read was the member Codex pointed at; the
  // remedy ruled was to sweep the CLASS. Every `boundedBySignal` site in `e2b-provider.ts` was
  // checked (5) and every SDK call reachable beneath one: `listDir` and `statEntry` carried the
  // SAME defect and are fixed here with the SAME abort-fired proof, not a timing-only test.
  // `FilesystemListOpts` and `FilesystemRequestOpts` both carry `signal` in `e2b@2.30.5`.
  // -------------------------------------------------------------------------------------
  it("★★★ SWEEP — the output LISTING is aborted at its deadline too, not abandoned mid-enumeration", async () => {
    let handed: AbortSignal | undefined;
    let aborted = false;
    const sdk = {
      connect: async () => ({
        files: {
          list: async (_path: string, opts?: { signal?: AbortSignal }) => {
            handed = opts?.signal;
            handed?.addEventListener("abort", () => {
              aborted = true;
            });
            return await new Promise(() => undefined); // stalls forever, the finding's shape
          },
        },
      }),
    };
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk }) as never });
    await expect(provider.enumerateOutputs("s", ROOT, { deadlineMs: 25 } as never)).rejects.toThrow(/timed out/);
    expect(handed, "the SDK listing received no AbortSignal at all").toBeInstanceOf(AbortSignal);
    await new Promise((r) => setTimeout(r, 20));
    expect(handed!.aborted, "the signal handed to files.list never fired").toBe(true);
    expect(aborted, "nothing observed the listing abort").toBe(true);
  });

  it("★★★ SWEEP — the no-follow STAT is aborted at its deadline too", async () => {
    let handed: AbortSignal | undefined;
    const sdk = {
      connect: async () => ({
        files: {
          getInfo: async (_path: string, opts?: { signal?: AbortSignal }) => {
            handed = opts?.signal;
            return await new Promise(() => undefined);
          },
        },
      }),
    };
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk }) as never });
    await expect(provider.digestArtifact("s", `${ROOT}/x.bin`, { deadlineMs: 25 } as never)).rejects.toThrow(/timed out/);
    expect(handed, "the SDK stat received no AbortSignal at all").toBeInstanceOf(AbortSignal);
    await new Promise((r) => setTimeout(r, 20));
    expect(handed!.aborted, "the signal handed to files.getInfo never fired").toBe(true);
  });

  it("★ a read that FITS inside the deadline is not aborted — the bound is not just 'everything fails'", async () => {
    let handed: AbortSignal | undefined;
    const sdk = {
      connect: async () => ({
        files: {
          getInfo: async () => ({ size: 2, type: "file" }),
          read: async (_path: string, opts?: { signal?: AbortSignal }) => {
            handed = opts?.signal;
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("hi"));
                controller.close();
              },
            });
          },
        },
      }),
    };
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk }) as never });
    const digest = await provider.digestArtifact("s", `${ROOT}/quick.bin`, { deadlineMs: 5_000 } as never);
    expect(digest.sizeBytes).toBe(2);
    expect(handed).toBeInstanceOf(AbortSignal);
    expect(handed!.aborted).toBe(false);
  });
});

describe("CLI-012 — a MISSING output root lists empty; a missing SANDBOX still throws", () => {
  class FileNotFoundError extends Error {
    constructor() {
      super("file not found");
      this.name = "FileNotFoundError";
    }
  }
  class SandboxGoneError extends Error {
    constructor() {
      super("sandbox not found");
      this.name = "SandboxNotFoundError";
    }
  }

  function transportRejecting(error: Error): RealE2bTransport {
    return new RealE2bTransport({
      apiKey: "test-key-not-a-credential",
      sdk: {
        connect: async () => ({
          files: {
            list: async () => {
              throw error;
            },
          },
        }),
      } as never,
    });
  }

  it("★★★ the transport tells the two apart, and the provider lists EMPTY for a missing root", async () => {
    const missingRoot = transportRejecting(new FileNotFoundError());
    await expect(missingRoot.listDir("s", ROOT)).rejects.toBeInstanceOf(E2bTransportPathNotFoundError);
    // Still a not-found for every existing handler — the new class is a SUBCLASS, so nothing
    // that already caught the old one changes behaviour.
    await expect(missingRoot.listDir("s", ROOT)).rejects.toBeInstanceOf(E2bTransportNotFoundError);

    const provider = new E2bSandboxProvider({ transport: missingRoot as never });
    expect(await provider.enumerateOutputs("s", ROOT, CTX)).toEqual({ entries: [] });
  });

  it("★ a MISSING SANDBOX is still a SandboxNotFoundError — the distinction is not collapsed the other way", async () => {
    const goneSandbox = transportRejecting(new SandboxGoneError());
    await expect(goneSandbox.listDir("s", ROOT)).rejects.toBeInstanceOf(E2bTransportNotFoundError);
    await expect(goneSandbox.listDir("s", ROOT)).rejects.not.toBeInstanceOf(E2bTransportPathNotFoundError);

    const provider = new E2bSandboxProvider({ transport: goneSandbox as never });
    await expect(provider.enumerateOutputs("s", ROOT, CTX)).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("★ an UNRECOGNISABLE failure is NOT reported as 'no output' — fail-closed", async () => {
    const weird = transportRejecting(new Error("the control API melted"));
    await expect(weird.listDir("s", ROOT)).rejects.not.toBeInstanceOf(E2bTransportNotFoundError);
    const provider = new E2bSandboxProvider({ transport: weird as never });
    await expect(provider.enumerateOutputs("s", ROOT, CTX)).rejects.toThrow();
  });

  it("★ NON-VACUITY — the same seam DOES return entries when the root exists", async () => {
    const listing = new RealE2bTransport({
      apiKey: "test-key-not-a-credential",
      sdk: {
        connect: async () => ({
          files: { list: async () => [{ path: `${ROOT}/a.md`, type: "file", size: 3 }] },
        }),
      } as never,
    });
    expect(await listing.listDir("s", ROOT)).toEqual([{ path: `${ROOT}/a.md`, sizeBytes: 3, symlink: false }]);
  });
});
