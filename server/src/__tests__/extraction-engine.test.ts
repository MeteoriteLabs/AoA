import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// resolveExtractionEngine's injected `opts` short-circuit the real probes, so
// the decision logic is fully testable without binaries or keys. We still mock
// the DB layer + the downstream probe/provider modules so the NON-injected
// branches (resolveCompanyCliTool's select, probeExtractionCli) don't blow up
// if a test ever exercises them.

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: { companyId: "iac_cid", cliTool: "iac_cli_tool" },
}));

const mockDetectCliTool = vi.fn();
vi.mock("../services/internal-agent/cli-mode.js", () => ({
  detectCliTool: (...args: unknown[]) => mockDetectCliTool(...args),
}));

const mockResolveAvailableProvider = vi.fn();
vi.mock("../services/internal-agent/providers/index.js", () => ({
  resolveAvailableProvider: (...args: unknown[]) => mockResolveAvailableProvider(...args),
}));

import {
  resolveExtractionEngine,
  resolveCompanyCliTool,
  probeExtractionCli,
  DEFAULT_EXTRACTION_CLI_TOOL,
} from "../services/extraction-engine.js";

/** Minimal db stub: select(...).from(...).where(...) resolves to `rows`. */
function makeDb(rows: unknown[]) {
  return {
    select: () => {
      const chain: any = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve(rows);
      return chain;
    },
  } as any;
}

describe("resolveExtractionEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'cli' when a CLI is available (injected)", async () => {
    const engine = await resolveExtractionEngine(makeDb([]), "c1", {
      cliAvailable: true,
    });
    expect(engine).toBe("cli");
    // CLI won — the provider resolver must never be consulted.
    expect(mockResolveAvailableProvider).not.toHaveBeenCalled();
  });

  it("returns 'api' when no CLI but a hosted key exists (injected)", async () => {
    const engine = await resolveExtractionEngine(makeDb([]), "c1", {
      cliAvailable: false,
      apiKey: true,
    });
    expect(engine).toBe("api");
  });

  it("throws /no extraction engine/i when neither CLI nor key exists (injected)", async () => {
    await expect(
      resolveExtractionEngine(makeDb([]), "c1", {
        cliAvailable: false,
        apiKey: false,
      }),
    ).rejects.toThrow(/no extraction engine/i);
  });

  it("falls back to the real provider resolver when apiKey not injected", async () => {
    mockResolveAvailableProvider.mockResolvedValueOnce({
      provider: "anthropic",
      apiKey: "k",
      model: "claude",
    });
    const engine = await resolveExtractionEngine(makeDb([]), "c1", {
      cliAvailable: false,
    });
    expect(engine).toBe("api");
    expect(mockResolveAvailableProvider).toHaveBeenCalledTimes(1);
  });

  it("throws when CLI not injected (probe fails) and provider resolver rejects", async () => {
    mockDetectCliTool.mockResolvedValueOnce({ available: false, error: "nope" });
    mockResolveAvailableProvider.mockRejectedValueOnce(new Error("no key"));
    await expect(resolveExtractionEngine(makeDb([]), "c1")).rejects.toThrow(
      /no extraction engine/i,
    );
  });

  it("returns 'cli' when the real probe finds the configured binary", async () => {
    mockDetectCliTool.mockResolvedValueOnce({ available: true, path: "/usr/bin/claude" });
    const engine = await resolveExtractionEngine(makeDb([{ cliTool: "claude_cli" }]), "c1");
    expect(engine).toBe("cli");
    expect(mockDetectCliTool).toHaveBeenCalledWith("claude_cli");
    expect(mockResolveAvailableProvider).not.toHaveBeenCalled();
  });
});

describe("resolveCompanyCliTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the company's configured cliTool when present", async () => {
    const tool = await resolveCompanyCliTool(makeDb([{ cliTool: "codex" }]), "c1");
    expect(tool).toBe("codex");
  });

  it("falls back to the default when no config row exists", async () => {
    const tool = await resolveCompanyCliTool(makeDb([]), "c1");
    expect(tool).toBe(DEFAULT_EXTRACTION_CLI_TOOL);
  });

  it("falls back to the default when config row has null cliTool", async () => {
    const tool = await resolveCompanyCliTool(makeDb([{ cliTool: null }]), "c1");
    expect(tool).toBe(DEFAULT_EXTRACTION_CLI_TOOL);
  });
});

describe("probeExtractionCli", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports available + tool when detectCliTool finds the binary", async () => {
    mockDetectCliTool.mockResolvedValueOnce({ available: true, path: "/x/claude" });
    const res = await probeExtractionCli("claude_cli");
    expect(res).toEqual({ available: true, tool: "claude_cli", error: undefined });
    expect(mockDetectCliTool).toHaveBeenCalledWith("claude_cli");
  });

  it("reports unavailable + error when the binary is missing", async () => {
    mockDetectCliTool.mockResolvedValueOnce({ available: false, error: "not found" });
    const res = await probeExtractionCli("codex");
    expect(res).toEqual({ available: false, tool: "codex", error: "not found" });
  });

  it("defaults the tool to claude_cli when none is given", async () => {
    mockDetectCliTool.mockResolvedValueOnce({ available: false });
    const res = await probeExtractionCli();
    expect(res.tool).toBe(DEFAULT_EXTRACTION_CLI_TOOL);
    expect(mockDetectCliTool).toHaveBeenCalledWith(DEFAULT_EXTRACTION_CLI_TOOL);
  });
});
