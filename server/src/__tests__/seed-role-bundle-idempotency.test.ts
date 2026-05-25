import { describe, it, expect, vi, beforeEach } from "vitest";

const { statMock, writeFileMock, mkdirMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  default: { stat: statMock, writeFile: writeFileMock, mkdir: mkdirMock },
}));

vi.mock("../services/default-agent-instructions.js", () => ({
  loadDefaultAgentInstructionsBundle: vi.fn().mockResolvedValue({
    "AGENTS.md": "agents content",
    "SOUL.md": "soul content",
  }),
}));

import { seedRoleInstructionBundle } from "../services/internal-agent/aoa-agents/seed-commander-bundle.js";

const agent = { id: "a1", companyId: "c1", name: "Router", adapterConfig: null };
const adapterConfig = { bundleRoot: "/bundles/a1" };

function makeService(rootPath: string | null) {
  return {
    ensureWritableBundle: vi.fn().mockResolvedValue({
      adapterConfig,
      state: { rootPath, entryFile: "AGENTS.md" },
    }),
  };
}

describe("seedRoleInstructionBundle idempotency (write-if-absent)", () => {
  beforeEach(() => {
    statMock.mockReset();
    writeFileMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
  });

  it("writes bundle files that do not yet exist", async () => {
    statMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await seedRoleInstructionBundle({ role: "router", agent, service: makeService("/root") });
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(adapterConfig);
  });

  it("does NOT overwrite files that already exist (idempotent)", async () => {
    statMock.mockResolvedValue({ isFile: () => true });
    const result = await seedRoleInstructionBundle({ role: "router", agent, service: makeService("/root") });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(result).toEqual(adapterConfig);
  });

  it("returns adapterConfig unchanged when rootPath is null (no bundle dir yet)", async () => {
    const result = await seedRoleInstructionBundle({ role: "router", agent, service: makeService(null) });
    expect(result).toEqual(adapterConfig);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes only missing files when bundle is partially seeded", async () => {
    // AGENTS.md exists, SOUL.md does not
    statMock
      .mockResolvedValueOnce({ isFile: () => true })  // AGENTS.md
      .mockRejectedValueOnce(new Error("ENOENT"));    // SOUL.md
    await seedRoleInstructionBundle({ role: "router", agent, service: makeService("/root") });
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][0]).toContain("SOUL.md");
  });
});
