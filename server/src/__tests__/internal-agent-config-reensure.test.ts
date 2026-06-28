// server/src/__tests__/internal-agent-config-reensure.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: the mock fns are referenced inside the vi.mock factory (hoisted to
// the top of the module), so they must be defined via vi.hoisted to exist at
// factory-evaluation time. Matches the codebase idiom (aoa-ensure-commander.test.ts).
const { ensureAll, isManaged } = vi.hoisted(() => ({
  ensureAll: vi.fn(async () => {}),
  isManaged: vi.fn(async () => false),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-all-crew.js", () => ({
  ensureAllCrewAgents: ensureAll,
  isCrewMarketplaceManaged: isManaged,
}));

import { maybeReensureAgentsOnConfigChange } from "../routes/internal-agent.js";

const base = { provider: "openai", crewModel: null, cliTool: "claude_cli", model: null } as const;

describe("maybeReensureAgentsOnConfigChange", () => {
  beforeEach(() => { ensureAll.mockClear(); isManaged.mockClear(); isManaged.mockResolvedValue(false); });

  it("re-ensures when crew provider changed", async () => {
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", { ...base, provider: "anthropic" }, { ...base, provider: "openai" });
    expect(ensureAll).toHaveBeenCalledWith({}, "co-1");
  });
  it("re-ensures when crewModel changed", async () => {
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", base, { ...base, crewModel: "gpt-5.5" });
    expect(ensureAll).toHaveBeenCalledTimes(1);
  });
  it("re-ensures when Commander cliTool changed", async () => {
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", base, { ...base, cliTool: "codex" });
    expect(ensureAll).toHaveBeenCalledTimes(1);
  });
  it("re-ensures when Commander model changed", async () => {
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", base, { ...base, model: "claude-opus-4-1" });
    expect(ensureAll).toHaveBeenCalledTimes(1);
  });
  it("does NOT re-ensure when nothing adapter-affecting changed", async () => {
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", base, { ...base });
    expect(ensureAll).not.toHaveBeenCalled();
  });
  it("skips when marketplace-managed", async () => {
    isManaged.mockResolvedValue(true);
    await maybeReensureAgentsOnConfigChange({} as any, "co-1", base, { ...base, provider: "anthropic" });
    expect(ensureAll).not.toHaveBeenCalled();
  });
});
