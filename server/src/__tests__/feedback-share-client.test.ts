import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEEDBACK_LOCAL_EXPORT_DIR_NAME,
  writeBundleLocally,
} from "../services/feedback-share-client.js";
import { stableStringify } from "../services/feedback-redaction.js";

// The share client writes under HOME by default. Tests isolate HOME to a tmp
// directory per-case so we never write into the real ~/.aoa/feedback-exports.
let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(path.join(os.tmpdir(), "aoa-feedback-share-client-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  // Windows: os.homedir() on Windows consults USERPROFILE, not HOME.
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  rmSync(tempHome, { recursive: true, force: true });
});

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    exportId: "fbexp_abcdef0123456789abcdef01",
    companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    feedbackVoteId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    createdAt: new Date("2026-04-21T10:30:00Z"),
    payloadSnapshot: {
      schemaVersion: "paperclip-feedback-envelope-v2",
      bundleVersion: "paperclip-feedback-bundle-v2",
      payloadVersion: "paperclip-feedback-v1",
      sourceApp: "aoa",
      vote: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", value: "down", reason: null },
    },
    ...overrides,
  };
}

describe("feedbackShareClient — writeBundleLocally", () => {
  it("writes a gzipped file under ~/.aoa/feedback-exports/", async () => {
    const bundle = makeBundle();
    const result = await writeBundleLocally(bundle);

    expect(result.path).toContain(path.join(FEEDBACK_LOCAL_EXPORT_DIR_NAME, ""));
    expect(result.path).toContain(tempHome);
    expect(existsSync(result.path)).toBe(true);
    expect(result.size).toBeGreaterThan(0);
  });

  it("creates the ~/.aoa/feedback-exports directory if missing", async () => {
    const bundle = makeBundle();
    const result = await writeBundleLocally(bundle);
    const dir = path.dirname(result.path);
    expect(existsSync(dir)).toBe(true);
    expect(path.basename(path.dirname(dir))).toBe(".aoa");
  });

  it("file is valid gzip that decompresses back to stableStringify(bundle)", async () => {
    const bundle = makeBundle();
    const result = await writeBundleLocally(bundle);
    const raw = readFileSync(result.path);
    const decompressed = gunzipSync(raw).toString("utf8");
    expect(decompressed).toBe(stableStringify(bundle));
    expect(JSON.parse(decompressed)).toMatchObject({
      id: bundle.id,
      exportId: bundle.exportId,
    });
  });

  it("filename format is <id>-<createdAt ISO>.json.gz (colons replaced for Windows)", async () => {
    const bundle = makeBundle();
    const result = await writeBundleLocally(bundle);
    const basename = path.basename(result.path);
    expect(basename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d+Z\.json\.gz$/);
    expect(basename).toContain(bundle.id);
    // No literal colons — breaks NTFS filenames on Windows.
    expect(basename.includes(":")).toBe(false);
  });

  it("reported size equals on-disk file size", async () => {
    const bundle = makeBundle();
    const result = await writeBundleLocally(bundle);
    const stats = readFileSync(result.path);
    expect(result.size).toBe(stats.length);
  });

  it("is idempotent — re-writing the same bundle produces the same content", async () => {
    const bundle = makeBundle();
    // Same createdAt → same filename → overwrite. Result should be identical.
    const a = await writeBundleLocally(bundle);
    const b = await writeBundleLocally(bundle);
    expect(a.path).toBe(b.path);
    expect(a.size).toBe(b.size);
  });

  it("different bundle ids produce different filenames", async () => {
    const a = await writeBundleLocally(makeBundle({ id: "id-a" }));
    const b = await writeBundleLocally(makeBundle({ id: "id-b" }));
    expect(a.path).not.toBe(b.path);
  });

  it("handles string createdAt (jsonb round-trip shape) as well as Date", async () => {
    const bundle = makeBundle({ createdAt: "2026-04-21T10:30:00.000Z" });
    const result = await writeBundleLocally(bundle);
    expect(existsSync(result.path)).toBe(true);
  });

  it("payload uses stable field ordering — same content → identical bytes", async () => {
    const bundleA = makeBundle({
      payloadSnapshot: { b: 2, a: 1, nested: { y: "y", x: "x" } },
    });
    const bundleB = makeBundle({
      payloadSnapshot: { a: 1, b: 2, nested: { x: "x", y: "y" } },
    });
    const aResult = await writeBundleLocally(bundleA);
    const bResult = await writeBundleLocally(bundleB);
    const aBytes = readFileSync(aResult.path);
    const bBytes = readFileSync(bResult.path);
    expect(aBytes.equals(bBytes)).toBe(true);
  });
});
