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
import { MockE2bTransport } from "../mock-transport.js";
import { RealE2bTransport, readStreamBounded, entryFromInfo } from "../real-transport.js";
import { E2bReadBoundExceededError, E2bSymlinkRefusedError, E2bListDirMalformedEntryError } from "../transport.js";
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
  return { provider: new E2bSandboxProvider({ transport }), transport, sandboxId };
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
