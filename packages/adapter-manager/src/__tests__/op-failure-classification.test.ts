// -----------------------------------------------------------------------------
// E6-F024 — a failing provider op is DIAGNOSABLE and still leaks nothing.
//
// The DEP-015 keyed run failed at `stage_files`: the adapter-manager could not reach the presign
// host. The worker logged only "adapter-manager provider operation failed", and the
// adapter-manager logged nothing. These tests drive the REAL default grant redemption
// (`fetchGrantBytes`, no injected redeemer) through the REAL gated server and wire driver, against
// four failure shapes: connection refused, an untrusted TLS certificate, an unresolvable host, and
// an HTTP error status. Each asserts two things:
//   - the classification is logged AND carried to the worker (op, class, cause, code/status);
//   - neither the log nor the wire carries the URL, its host, the signature canary or a header
//     canary. The grant is a bearer capability; the fence stays shut.
// -----------------------------------------------------------------------------

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateSandboxSpec, ProviderOpContext, ResourceLabels, StagedFileRequest } from "@armyofagents/worker-daemon";
import {
  NetworkedProviderDriver,
  OWNED_LABELS_CAPABILITY_AUDIENCE,
  OWNED_LABELS_CAPABILITY_VERSION,
  signOwnedLabelsCapability,
} from "@armyofagents/provider-wire";
import type { ArtifactDownloadGrantV1 } from "@armyofagents/worker-protocol";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";

import { createProviderServer } from "../server.js";
import { classifyOpFailure, formatOpFailure, type OpFailureClassification } from "../op-failure-classification.js";

const NOW = 1_700_000_000_000;
const SIGNATURE_CANARY = "SIGCANARYe6f024d1c2b3a4";
const HEADER_CANARY = "HDRCANARYe6f024f5e6d7c8";
const OWNED: ResourceLabels = {
  organizationId: "org-1",
  targetId: "tgt-1",
  workerId: "wkr-1",
  jobId: "job-1",
  attempt: 1,
  leaseId: "lease-1",
  deviceGeneration: 7,
};
const controlPlane = generateKeyPairSync("ed25519");
const certDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docker/d1/certs");

function grantFor(url: string): ArtifactDownloadGrantV1 {
  const bytes = new TextEncoder().encode("x");
  return {
    protocolVersion: 1,
    operation: "download",
    artifactId: "00000000-0000-4000-8000-0000000000a1",
    method: "GET",
    url,
    headers: { "x-amz-security-token": HEADER_CANARY },
    issuedAt: "2026-09-03T12:00:00.000Z",
    expiresAt: "2126-09-03T12:05:00.000Z",
    maxBytes: bytes.byteLength,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    objectKey: "organizations/org-1/jobs/job-1/attempts/1/00000000-0000-4000-8000-0000000000a1",
    redaction: "secret",
  } as ArtifactDownloadGrantV1;
}

const servers: Array<{ close: (cb: (err?: Error) => void) => void }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function listen<T extends HttpServer>(server: T): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

/** Stage one file whose grant points at `url`, through the gated AM with the REAL redemption. */
async function stageAgainst(url: string, onOpFailure?: (c: OpFailureClassification) => void) {
  const provider = new E2bSandboxProvider({ transport: new MockE2bTransport() }); // default fetchGrantBytes
  const am = createProviderServer({ provider, controlPlanePublicKey: controlPlane.publicKey, now: () => NOW, onOpFailure });
  const port = await listen(am);
  const baseUrl = `http://127.0.0.1:${port}`;
  const capability = signOwnedLabelsCapability(
    { v: OWNED_LABELS_CAPABILITY_VERSION, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: OWNED, expiresAt: NOW + 60_000 },
    controlPlane.privateKey,
  );
  const driver = new NetworkedProviderDriver({ baseUrl, capability });
  const ctx: ProviderOpContext = { deadlineMs: 10_000, idempotencyKey: "idem-1" };
  const spec: CreateSandboxSpec = { resourceLabels: OWNED, command: "run.sh", args: [], env: {}, workloadType: "coding" };
  const { sandboxId } = await driver.create(spec, { ...ctx, idempotencyKey: "c-1" });
  const files: readonly StagedFileRequest[] = [{ path: "/home/user/.aoa/AGENTS.md", grant: grantFor(url) }];
  const rawBody = await (
    await fetch(`${baseUrl}/op/stage_files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: { sandboxId, files }, ctx, capability }),
    })
  ).text();
  const rejection = await driver.stageFiles(sandboxId, files, { ...ctx, idempotencyKey: "s-1" }).then(
    () => null,
    (err: unknown) => err as Error,
  );
  return { rawBody, rejection };
}

function assertNoLeak(text: string, url: string): void {
  expect(text).not.toContain(SIGNATURE_CANARY);
  expect(text).not.toContain(HEADER_CANARY);
  expect(text).not.toContain(url);
  expect(text).not.toContain(new URL(url).host);
  expect(text).not.toMatch(/X-Amz-Signature/i);
}

describe("E6-F024 — a failing grant redemption is classified, logged and relayed, never leaked", () => {
  it("connection refused: cause=connect code=ECONNREFUSED", async () => {
    const closed = createHttpServer();
    const port = await listen(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    servers.pop();
    const url = `http://127.0.0.1:${port}/aoa-artifacts/obj?X-Amz-Signature=${SIGNATURE_CANARY}`;
    const logged: OpFailureClassification[] = [];
    const { rawBody, rejection } = await stageAgainst(url, (c) => logged.push(c));

    expect(logged[0]).toEqual({ op: "stage_files", errorClass: "TypeError", cause: "connect", code: "ECONNREFUSED", httpStatus: null });
    expect(rawBody).toContain("op=stage_files class=TypeError cause=connect code=ECONNREFUSED");
    expect(rejection?.message).toContain("cause=connect"); // what the worker logs
    for (const text of [rawBody, JSON.stringify(logged), String(rejection?.message)]) assertNoLeak(text, url);
  });

  it("an untrusted TLS certificate (the lane's missing-CA class): cause=tls", async () => {
    const tls = createHttpsServer(
      { key: readFileSync(path.join(certDir, "private.key")), cert: readFileSync(path.join(certDir, "public.crt")) },
      (_req, res) => res.end("x"),
    );
    const port = await listen(tls as unknown as HttpServer);
    const url = `https://127.0.0.1:${port}/aoa-artifacts/obj?X-Amz-Signature=${SIGNATURE_CANARY}`;
    const logged: OpFailureClassification[] = [];
    const { rawBody, rejection } = await stageAgainst(url, (c) => logged.push(c));

    expect(logged[0]?.cause).toBe("tls");
    expect(logged[0]?.op).toBe("stage_files");
    expect(rawBody).toContain("cause=tls");
    expect(rejection?.message).toContain("cause=tls");
    for (const text of [rawBody, JSON.stringify(logged), String(rejection?.message)]) assertNoLeak(text, url);
  });

  it("an unresolvable host (the lane's missing-network class): cause=dns", async () => {
    const url = `https://aoa-e6-f024-no-such-host.invalid/aoa-artifacts/obj?X-Amz-Signature=${SIGNATURE_CANARY}`;
    const logged: OpFailureClassification[] = [];
    const { rawBody } = await stageAgainst(url, (c) => logged.push(c));

    expect(logged[0]?.cause).toBe("dns");
    expect(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]).toContain(logged[0]?.code);
    expect(rawBody).toContain("cause=dns");
    for (const text of [rawBody, JSON.stringify(logged)]) assertNoLeak(text, url);
  });

  it("an HTTP error from the store: cause=http_status status=403", async () => {
    const store = createHttpServer((_req, res) => {
      res.statusCode = 403;
      res.end("denied");
    });
    const port = await listen(store);
    const url = `http://127.0.0.1:${port}/aoa-artifacts/obj?X-Amz-Signature=${SIGNATURE_CANARY}`;
    const logged: OpFailureClassification[] = [];
    const { rawBody, rejection } = await stageAgainst(url, (c) => logged.push(c));

    expect(logged[0]).toEqual({ op: "stage_files", errorClass: "Error", cause: "http_status", code: null, httpStatus: 403 });
    expect(rejection?.message).toContain("cause=http_status status=403");
    for (const text of [rawBody, JSON.stringify(logged), String(rejection?.message)]) assertNoLeak(text, url);
  });

  it("the DEFAULT sink logs the classification to stderr (a failure is never silent) — and no canary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = `http://127.0.0.1:1/aoa-artifacts/obj?X-Amz-Signature=${SIGNATURE_CANARY}`;
    await stageAgainst(url);
    const lines = spy.mock.calls.map((args) => JSON.stringify(args));
    const line = lines.find((l) => l.includes("adapter-manager provider operation failed"));
    expect(line).toBeDefined();
    expect(line).toContain('"op":"stage_files"');
    assertNoLeak(lines.join("\n"), url);
  });
});

describe("E6-F024 — classifyOpFailure copies nothing out of an error", () => {
  it("an unknown error class, an unknown code and a secret-bearing message all fall to the closed vocabulary", () => {
    const err = Object.assign(new Error(`e2b failed for sk-${SIGNATURE_CANARY} at https://x.example/?t=${HEADER_CANARY}`), {
      name: `Leaky${SIGNATURE_CANARY}`,
      code: `E${SIGNATURE_CANARY.toUpperCase()}`,
    });
    const c = classifyOpFailure("stage_files", err);
    expect(c).toEqual({ op: "stage_files", errorClass: "other", cause: "unclassified", code: null, httpStatus: null });
    expect(formatOpFailure(c)).not.toContain(SIGNATURE_CANARY);
  });

  it("an unknown op is 'other'; a non-Error throw is classified, not stringified", () => {
    expect(classifyOpFailure("steal_keys", new Error("x")).op).toBe("other");
    expect(classifyOpFailure("create", `raw string with ${SIGNATURE_CANARY}`)).toEqual({
      op: "create",
      errorClass: "other",
      cause: "unclassified",
      code: null,
      httpStatus: null,
    });
  });

  it("the digest / size refusals of stageFiles are named without their paths or digests", () => {
    const digest = classifyOpFailure("stage_files", new Error(`staged-input for /p hashed ${"a".repeat(64)}, expected ${"b".repeat(64)}`));
    expect(digest.cause).toBe("digest_mismatch");
    const size = classifyOpFailure("stage_files", new Error("staged-input for /p is 9 bytes, over the granted 1"));
    expect(size.cause).toBe("size_exceeded");
  });

  it("a cyclic cause chain terminates", () => {
    const a: Error & { cause?: unknown } = new Error("fetch failed");
    a.cause = a;
    expect(classifyOpFailure("execute", a).cause).toBe("fetch_failed");
  });
});

// ---------------------------------------------------------------------------------------
// CLI-017-B, round 1 (Codex P2, PR #592) — THE SD-5 EXPORT REFUSALS ARE THEIR OWN CAUSES.
//
// Before this, `export_artifact` was not a KNOWN_OP and none of the refusal classes were known,
// so a secret refusal reported `op=other class=other cause=unclassified` — identical to a generic
// infrastructure failure. `E5-D07` makes the refusal per-file and best-effort outward, which is
// only actionable if an operator can tell the two apart at the one place it is observed.
//
// The causes are derived from the error CLASS NAME, never from message text: these classes'
// messages are fixed vocabulary, and pattern-matching them would couple the classifier to wording
// the wire is free to change. Nothing tenant-derived can reach the output by construction.
// ---------------------------------------------------------------------------------------
describe("CLI-017-B — SD-5 export refusals classify as themselves", () => {
  class Refusal extends Error {
    constructor(name: string, message: string) {
      super(message);
      this.name = name;
    }
  }

  const cases = [
    ["SandboxExportScannerRefusedError", "export_secret_refused"],
    ["SandboxExportSecretSetUnavailableError", "export_secret_set_unavailable"],
    ["SandboxExportScannerUnavailableError", "export_scanner_unavailable"],
  ] as const;

  for (const [name, cause] of cases) {
    it(`${name} -> cause=${cause}, with the real op and the real class`, () => {
      const c = classifyOpFailure("export_artifact", new Refusal(name, "artifact export refused: fixed text"));
      expect(c.op).toBe("export_artifact");
      expect(c.errorClass).toBe(name);
      expect(c.cause).toBe(cause);
      // Nothing from the message, the path or a grant can appear in the rendered line.
      expect(formatOpFailure(c)).toBe(`op=export_artifact class=${name} cause=${cause}`);
    });
  }

  it("★ the refusal wins over an incidental code further down the cause chain", () => {
    // A verdict about the bytes must not be overwritten by transport noise attached beneath it.
    const refusal = new Refusal("SandboxExportScannerRefusedError", "refused");
    (refusal as unknown as { cause: unknown }).cause = Object.assign(new Error("boom"), { code: "ETIMEDOUT" });
    expect(classifyOpFailure("export_artifact", refusal).cause).toBe("export_secret_refused");
  });

  it("★ digest_artifact is a KNOWN op too — swept as a pair, not fixed as the one instance", () => {
    // It reads the sandbox through the same `#readArtifactBytes` and was equally unknown.
    expect(classifyOpFailure("digest_artifact", new Error("x")).op).toBe("digest_artifact");
  });

  it("★ POSITIVE CONTROL — a genuine infrastructure failure on the SAME op is still distinguishable", () => {
    // Without this arm the rows above could pass for a classifier that called everything a
    // refusal, which would be exactly as useless as calling everything unclassified.
    const c = classifyOpFailure("export_artifact", Object.assign(new Error("fetch failed"), { name: "TypeError" }));
    expect(c.cause).toBe("fetch_failed");
    expect(c.cause).not.toBe("export_secret_refused");
  });

  it("★ an UNKNOWN op is still reported as `other` — the vocabulary stays closed", () => {
    expect(classifyOpFailure("teleport_artifact", new Error("x")).op).toBe("other");
  });
});
