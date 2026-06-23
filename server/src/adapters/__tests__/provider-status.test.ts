import { describe, it, expect } from "vitest";
import { parseCodexAuthMode, type ProviderAuthMode } from "../provider-status.js";

describe("parseCodexAuthMode", () => {
  it("returns 'apikey' when a per-agent OPENAI_API_KEY is present", () => {
    expect(parseCodexAuthMode({ agentEnvApiKey: "sk-xyz", authJson: { auth_mode: "chatgpt" } }))
      .toBe("apikey");
  });
  it("returns 'chatgpt' from the managed auth.json when no per-agent key", () => {
    expect(parseCodexAuthMode({ agentEnvApiKey: null, authJson: { auth_mode: "chatgpt" } }))
      .toBe("chatgpt");
  });
  it("returns 'apikey' from auth.json OPENAI_API_KEY field with no agent key", () => {
    expect(parseCodexAuthMode({ agentEnvApiKey: null, authJson: { OPENAI_API_KEY: "sk-x" } }))
      .toBe("apikey");
  });
  it("returns 'unknown' for an empty/missing auth.json", () => {
    expect(parseCodexAuthMode({ agentEnvApiKey: null, authJson: null })).toBe("unknown");
  });
  it("IGNORES the company/server process.env.OPENAI_API_KEY entirely", () => {
    // Even if the server env has a key, detection must not treat it as the agent's auth.
    expect(parseCodexAuthMode({ agentEnvApiKey: null, authJson: { auth_mode: "chatgpt" }, serverEnvApiKey: "sk-company" }))
      .toBe("chatgpt");
  });
});

// Type-level assertion: ProviderAuthMode must be importable and include these literals
const _typeCheck: ProviderAuthMode[] = ["subscription", "chatgpt", "apikey", "unknown"];
void _typeCheck;
