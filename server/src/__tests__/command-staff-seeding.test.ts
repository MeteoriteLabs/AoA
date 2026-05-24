import { describe, it, expect } from "vitest";

// ── Mocks (must precede imports that transitively import drizzle) ────────────
import { vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
}));

vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return {
    agents: t("agents"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
  };
});

import {
  SCRIBE_AGENT_NAME,
  SCRIBE_TOOL_ALLOWLIST,
} from "../services/internal-agent/aoa-agents/ensure-extraction-agent.js";

describe("Scribe (extended extraction agent)", () => {
  it("is named Scribe", () => {
    expect(SCRIBE_AGENT_NAME).toBe("Scribe");
  });
  it("can submit extracted items but cannot write memory directly", () => {
    expect(SCRIBE_TOOL_ALLOWLIST).toContain("submit_extracted_items");
    expect(SCRIBE_TOOL_ALLOWLIST).not.toContain("create_memory");
    expect(SCRIBE_TOOL_ALLOWLIST).not.toContain("update_memory");
  });
});
