import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

async function loadWithFixture(
  entries: ReadonlyArray<{ idx: number; tag: string }>,
  files: Readonly<Record<string, Buffer>>,
) {
  const journal = JSON.stringify({ version: "7", dialect: "postgresql", entries });
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.doMock("node:fs/promises", () => ({
    ...actualFs,
    readFile: vi.fn(async (path: string | URL, encoding?: BufferEncoding) => {
      const value = String(path).replaceAll("\\", "/");
      if (value.endsWith("/migrations/meta/_journal.json")) return journal;
      const fileName = value.split("/").at(-1);
      const bytes = fileName === undefined ? undefined : files[fileName];
      if (bytes) return encoding ? bytes.toString(encoding) : bytes;
      throw new Error(`unexpected fixture read: ${value}`);
    }),
  }));
  vi.resetModules();
  return (await import("../client.js")).loadRequiredMigrationIdentity;
}

describe("required migration identity", () => {
  it("uses literal Drizzle journal array order when idx values disagree", async () => {
    // Mutation caught: sorting journal entries by idx silently changes the migration order
    // Drizzle consumes. The fixture's literal array order is intentionally the reverse of idx.
    const literalFirst = Buffer.from("literal-array-first\n", "utf8");
    const literalSecond = Buffer.from("literal-array-second\n", "utf8");
    const loadRequiredMigrationIdentity = await loadWithFixture([
      { idx: 41, tag: "literal_first" },
      { idx: 3, tag: "literal_second" },
    ], {
      "literal_first.sql": literalFirst,
      "literal_second.sql": literalSecond,
    });
    const identity = await loadRequiredMigrationIdentity();
    const orderedHashes = [literalFirst, literalSecond].map((bytes) =>
      createHash("sha256").update(bytes).digest("hex"));
    expect(identity).toEqual({
      orderedHashes,
      ledgerSha256: createHash("sha256").update(JSON.stringify(orderedHashes)).digest("hex"),
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.orderedHashes)).toBe(true);
  });

  it("preserves duplicate migration-path rejection", async () => {
    const loadRequiredMigrationIdentity = await loadWithFixture([
      { idx: 1, tag: "duplicate" },
      { idx: 2, tag: "duplicate" },
    ], {
      "duplicate.sql": Buffer.from("one checked-in path\n", "utf8"),
    });

    await expect(loadRequiredMigrationIdentity()).rejects.toThrow(
      "The checked-in migration journal contains duplicate paths",
    );
  });

  it("preserves duplicate byte-hash rejection across distinct paths", async () => {
    const identicalBytes = Buffer.from("identical checked-in bytes\n", "utf8");
    const loadRequiredMigrationIdentity = await loadWithFixture([
      { idx: 1, tag: "first_path" },
      { idx: 2, tag: "second_path" },
    ], {
      "first_path.sql": identicalBytes,
      "second_path.sql": identicalBytes,
    });

    await expect(loadRequiredMigrationIdentity()).rejects.toThrow(
      "The checked-in migration journal contains duplicate migration hashes",
    );
  });
});
