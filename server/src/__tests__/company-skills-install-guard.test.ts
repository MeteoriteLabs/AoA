/**
 * T2.9 — the non-catalog (github / url / local) install + reinstall paths must
 * honour `company_skills.customized`, exactly as the catalog auto-apply path
 * already does (`skill-auto-updater.ts:100-133`).
 *
 * Two entry points reach an existing row's `markdown` from a source re-read:
 *   1. `POST /companies/:cid/skills/:skillId/install-update` → `installUpdate`
 *   2. `POST /companies/:cid/skills/import`                  → `importFromSource`
 *                                                            → `upsertImportedSkills`
 *
 * Every "refuses" case here is paired with an "uncustomized still updates" case:
 * without that discriminator a change that simply blocked all reinstalls would
 * pass the suite.
 */
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted before the service import) ────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  asc: vi.fn((x: unknown) => x),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  companySkills: new Proxy({}, { get: (_t, k) => `companySkills.${String(k)}` }),
  agents: new Proxy({}, { get: (_t, k) => `agents.${String(k)}` }),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../adapters/registry.js", () => ({ findActiveServerAdapter: vi.fn() }));
vi.mock("../services/projects.js", () => ({ projectService: () => ({ list: vi.fn() }) }));
vi.mock("../services/secrets.js", () => ({ secretService: () => ({}) }));
vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    getById: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  }),
}));

const httpBodies = vi.hoisted(() => new Map<string, string>());

vi.mock("../services/outbound-url-guard.js", () => ({
  validateAndResolveFetchUrl: vi.fn(async (url: string) => ({ url })),
  executePinnedRequest: vi.fn(async (target: { url: string }) => {
    const body = httpBodies.get(target.url);
    if (body === undefined) return { status: 404, body: "" };
    return { status: 200, body };
  }),
}));

import { companySkillService } from "../services/company-skills.js";

// ── Minimal in-memory Drizzle stand-in ───────────────────────────────────────

type Row = Record<string, any>;

function evalCond(cond: any, row: Row): boolean {
  if (cond === undefined || cond === null) return true;
  if (Array.isArray(cond)) return cond.every((c) => evalCond(c, row));
  if (cond.and) return (cond.and as unknown[]).every((c) => evalCond(c, row));
  if (cond.eq) {
    const [col, value] = cond.eq as [string, unknown];
    const column = String(col).split(".")[1]!;
    return row[column] === value;
  }
  return true;
}

interface FakeDb {
  db: any;
  rows: Row[];
  /** Every `update(...).set(values)` that actually matched at least one row. */
  appliedUpdates: Array<{ values: Row; ids: string[] }>;
  /** Every `update(...).set(values)` issued, matched or not. */
  attemptedUpdates: Array<{ values: Row; ids: string[] }>;
  inserted: Row[];
}

function makeFakeDb(rows: Row[]): FakeDb {
  const state: FakeDb = {
    db: null,
    rows,
    appliedUpdates: [],
    attemptedUpdates: [],
    inserted: [],
  };
  let seq = 0;

  const selectChain = (cond?: any) => {
    const run = () => state.rows.filter((r) => evalCond(cond, r)).map((r) => ({ ...r }));
    return {
      orderBy: () => Promise.resolve(run()),
      limit: () => Promise.resolve(run()),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
  };

  state.db = {
    select: (_cols?: unknown) => ({
      from: () => ({
        where: (cond: any) => selectChain(cond),
        ...selectChain(),
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: (cond: any) => {
          let matched: Row[] | null = null;
          const run = () => {
            if (matched !== null) return matched;
            matched = state.rows.filter((r) => evalCond(cond, r));
            for (const r of matched) Object.assign(r, values);
            const record = { values, ids: matched.map((r) => r.id) };
            state.attemptedUpdates.push(record);
            if (matched.length > 0) state.appliedUpdates.push(record);
            return matched;
          };
          return {
            returning: () => Promise.resolve(run().map((r) => ({ ...r }))),
            then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
          };
        },
      }),
    }),
    insert: () => ({
      values: (values: Row) => {
        const row: Row = {
          id: `inserted-${++seq}`,
          customized: false,
          createdAt: new Date("2026-07-24T00:00:00Z"),
          updatedAt: new Date("2026-07-24T00:00:00Z"),
          ...values,
        };
        const commit = () => {
          state.rows.push(row);
          state.inserted.push(row);
          return [{ ...row }];
        };
        return {
          returning: () => Promise.resolve(commit()),
          then: (res: any, rej: any) => Promise.resolve(commit()).then(res, rej),
        };
      },
    }),
    delete: () => ({
      where: (cond: any) => {
        const keep = state.rows.filter((r) => !evalCond(cond, r));
        state.rows.length = 0;
        state.rows.push(...keep);
        return Promise.resolve([]);
      },
    }),
  };

  return state;
}

const FOUNDER_MARKDOWN = "---\nname: Brainstorming\n---\n\n# Brainstorming (founder's edit)\n";
const UPSTREAM_MARKDOWN = "---\nname: Brainstorming\n---\n\n# Brainstorming (upstream v2)\n";

function urlSkillRow(overrides: Row = {}): Row {
  return {
    id: "skill-1",
    companyId: "co-1",
    key: "url/example-com/deadbeef/brainstorming",
    slug: "brainstorming",
    name: "Brainstorming",
    description: "Think first",
    markdown: FOUNDER_MARKDOWN,
    sourceType: "url",
    sourceLocator: "https://example.com/SKILL.md",
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    metadata: { sourceKind: "url" },
    customized: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

const cleanupDirs = new Set<string>();

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.add(dir);
  return dir;
}

beforeEach(() => {
  httpBodies.clear();
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs, (dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});

// ── 1. installUpdate (POST /skills/:id/install-update) ───────────────────────

describe("installUpdate — customized guard", () => {
  it("refuses to overwrite a CUSTOMIZED url skill", async () => {
    httpBodies.set("https://example.com/SKILL.md", UPSTREAM_MARKDOWN);
    const fake = makeFakeDb([urlSkillRow({ customized: true })]);
    const svc = companySkillService(fake.db);

    await expect(svc.installUpdate("co-1", "skill-1")).rejects.toMatchObject({
      status: 409,
    });

    // The founder's bytes survive — the assertion is on stored content, not a status.
    expect(fake.rows[0]!.markdown).toBe(FOUNDER_MARKDOWN);
    expect(fake.appliedUpdates).toHaveLength(0);
  });

  it("still updates an UNCUSTOMIZED url skill (discriminator)", async () => {
    httpBodies.set("https://example.com/SKILL.md", UPSTREAM_MARKDOWN);
    const fake = makeFakeDb([urlSkillRow({ customized: false })]);
    const svc = companySkillService(fake.db);

    const updated = await svc.installUpdate("co-1", "skill-1");

    expect(updated?.markdown).toBe(UPSTREAM_MARKDOWN);
    expect(fake.rows[0]!.markdown).toBe(UPSTREAM_MARKDOWN);
    expect(fake.appliedUpdates).toHaveLength(1);
  });

  it("refuses to overwrite a CUSTOMIZED github skill", async () => {
    httpBodies.set("https://api.github.com/repos/acme/skills/commits/main", JSON.stringify({ sha: "f".repeat(40) }));
    httpBodies.set(
      `https://raw.githubusercontent.com/acme/skills/${"f".repeat(40)}/brainstorming/SKILL.md`,
      UPSTREAM_MARKDOWN,
    );
    const fake = makeFakeDb([
      urlSkillRow({
        key: "acme/skills/brainstorming",
        sourceType: "github",
        sourceLocator: "https://github.com/acme/skills/tree/main/brainstorming",
        sourceRef: "main",
        metadata: { sourceKind: "github", owner: "acme", repo: "skills", skillPath: "brainstorming", ref: "main" },
        customized: true,
      }),
    ]);
    const svc = companySkillService(fake.db);

    await expect(svc.installUpdate("co-1", "skill-1")).rejects.toMatchObject({ status: 409 });
    expect(fake.rows[0]!.markdown).toBe(FOUNDER_MARKDOWN);
  });

  it("still updates an UNCUSTOMIZED github skill (discriminator)", async () => {
    httpBodies.set("https://api.github.com/repos/acme/skills/commits/main", JSON.stringify({ sha: "f".repeat(40) }));
    httpBodies.set(
      `https://raw.githubusercontent.com/acme/skills/${"f".repeat(40)}/brainstorming/SKILL.md`,
      UPSTREAM_MARKDOWN,
    );
    const fake = makeFakeDb([
      urlSkillRow({
        key: "acme/skills/brainstorming",
        sourceType: "github",
        sourceLocator: "https://github.com/acme/skills/tree/main/brainstorming",
        sourceRef: "main",
        metadata: { sourceKind: "github", owner: "acme", repo: "skills", skillPath: "brainstorming", ref: "main" },
        customized: false,
      }),
    ]);
    const svc = companySkillService(fake.db);

    const updated = await svc.installUpdate("co-1", "skill-1");
    expect(updated?.markdown).toBe(UPSTREAM_MARKDOWN);
  });

  it("optimistic lock: a concurrent founder edit between the read and the write still refuses", async () => {
    httpBodies.set("https://example.com/SKILL.md", UPSTREAM_MARKDOWN);
    const row = urlSkillRow({ customized: false });
    const fake = makeFakeDb([row]);
    const svc = companySkillService(fake.db);

    // Simulate the founder committing `customized = true` after installUpdate has
    // read the row but before it issues the UPDATE.
    const originalUpdate = fake.db.update;
    fake.db.update = (...args: unknown[]) => {
      row.customized = true;
      fake.db.update = originalUpdate;
      return originalUpdate(...args);
    };

    await expect(svc.installUpdate("co-1", "skill-1")).rejects.toMatchObject({ status: 409 });
    expect(fake.rows[0]!.markdown).toBe(FOUNDER_MARKDOWN);
  });

  it("a refused install leaves the on-disk skill directory byte-identical", async () => {
    const skillDir = await makeTempDir("aoa-t29-local-skill-");
    await fs.writeFile(path.join(skillDir, "SKILL.md"), UPSTREAM_MARKDOWN, "utf8");
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "references", "notes.md"), "keep me", "utf8");

    const fake = makeFakeDb([
      urlSkillRow({
        key: "company/co-1/brainstorming",
        sourceType: "local_path",
        sourceLocator: skillDir,
        metadata: { sourceKind: "managed_local" },
        customized: true,
      }),
    ]);
    const svc = companySkillService(fake.db);

    await expect(svc.installUpdate("co-1", "skill-1")).rejects.toMatchObject({ status: 409 });

    // Bytes, not a status string.
    expect(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8")).toBe(UPSTREAM_MARKDOWN);
    expect(await fs.readFile(path.join(skillDir, "references", "notes.md"), "utf8")).toBe("keep me");
    expect((await fs.readdir(skillDir)).sort()).toEqual(["SKILL.md", "references"]);
    expect(fake.rows[0]!.markdown).toBe(FOUNDER_MARKDOWN);
  });
});

// ── 2. importFromSource (POST /skills/import) ────────────────────────────────

describe("importFromSource — customized guard", () => {
  const SOURCE_URL = "https://example.com/skills/brainstorming/SKILL.md";

  /** Import once into an empty company so the canonical key is derived, not guessed. */
  async function seedImportedRow(): Promise<Row> {
    httpBodies.set(SOURCE_URL, FOUNDER_MARKDOWN);
    const fake = makeFakeDb([]);
    const svc = companySkillService(fake.db);
    await svc.importFromSource("co-1", SOURCE_URL);
    expect(fake.inserted).toHaveLength(1);
    return { ...fake.inserted[0]!, id: "skill-1", markdown: FOUNDER_MARKDOWN };
  }

  it("refuses to overwrite a CUSTOMIZED row on re-import", async () => {
    const seeded = await seedImportedRow();
    httpBodies.set(SOURCE_URL, UPSTREAM_MARKDOWN);

    const fake = makeFakeDb([{ ...seeded, customized: true }]);
    const svc = companySkillService(fake.db);

    const result = await svc.importFromSource("co-1", SOURCE_URL);

    expect(fake.rows[0]!.markdown).toBe(FOUNDER_MARKDOWN);
    expect(fake.appliedUpdates).toHaveLength(0);
    expect(result.imported).toHaveLength(0);
    expect(result.refusedCustomized).toEqual([
      expect.objectContaining({ skillId: "skill-1", reason: "customized" }),
    ]);
    expect(result.warnings.join(" ")).toMatch(/edit/i);
  });

  it("still updates an UNCUSTOMIZED row on re-import (discriminator)", async () => {
    const seeded = await seedImportedRow();
    httpBodies.set(SOURCE_URL, UPSTREAM_MARKDOWN);

    const fake = makeFakeDb([{ ...seeded, customized: false }]);
    const svc = companySkillService(fake.db);

    const result = await svc.importFromSource("co-1", SOURCE_URL);

    expect(fake.rows[0]!.markdown).toBe(UPSTREAM_MARKDOWN);
    expect(result.imported).toHaveLength(1);
    expect(result.refusedCustomized).toEqual([]);
    expect(fake.inserted).toHaveLength(0); // updated in place, not duplicated
  });
});
