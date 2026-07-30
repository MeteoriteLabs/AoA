// packages/db/src/__tests__/organizations-migration-journal.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const journal = JSON.parse(
  readFileSync(join(__dirname, "..", "migrations", "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; version: string; tag: string; breakpoints: boolean }> };

const entry = journal.entries.find((e) => e.tag === "0188_organizations");

describe("0188 journal registration", () => {
  it("is registered at idx 188", () => {
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(188);
  });
  it("matches the journal version 7 with breakpoints", () => {
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
  });
});
