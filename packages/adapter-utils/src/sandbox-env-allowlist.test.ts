import { describe, it, expect } from "vitest";
import { buildSandboxEnvAllowlist } from "./sandbox-env-allowlist.js";

const NEVER = [
  "DATABASE_URL", "DIRECT_DATABASE_URL", "AOA_SECRETS_MASTER_KEY", "AOA_SECRETS_MASTER_KEY_FILE",
  "GITHUB_PAT", "BETTER_AUTH_SECRET", "AOA_AGENT_JWT_SECRET", "REDIS_URL", "CLAUDE_CODE_OAUTH_TOKEN",
];

describe("buildSandboxEnvAllowlist", () => {
  it("drops every never-in-VM infra/operator secret even if present in the overlay", () => {
    const overlay: Record<string, string> = { AOA_API_KEY: "jwt", ANTHROPIC_API_KEY: "sk-ant-company" };
    for (const k of NEVER) overlay[k] = "LEAK";
    const out = buildSandboxEnvAllowlist(overlay, { provider: "anthropic" });
    for (const k of NEVER) expect(out[k]).toBeUndefined();
    expect(out.AOA_API_KEY).toBe("jwt");
    expect(out.ANTHROPIC_API_KEY).toBe("sk-ant-company");
  });

  it("keeps run-identity + connector tokens (AOA_MCP_*_TOKEN prefix)", () => {
    const out = buildSandboxEnvAllowlist(
      { AOA_API_URL: "https://cp", AOA_RUN_ID: "r1", AOA_EXECUTION_TARGET_ID: "t1", AOA_RUNTIME_HOOK_TOKEN: "hk", AOA_MCP_NOTION_TOKEN: "ntn", PAPERCLIP_API_KEY: "jwt2" },
      { provider: "anthropic" },
    );
    expect(out).toMatchObject({ AOA_API_URL: "https://cp", AOA_RUN_ID: "r1", AOA_EXECUTION_TARGET_ID: "t1", AOA_RUNTIME_HOOK_TOKEN: "hk", AOA_MCP_NOTION_TOKEN: "ntn", PAPERCLIP_API_KEY: "jwt2" });
  });

  it("OPENAI_API_KEY disambiguation: claude agent -> absent; codex agent -> present", () => {
    // claude run: overlay carries no OPENAI_API_KEY (embeddings key is host-side only, never in overlay)
    expect(buildSandboxEnvAllowlist({ ANTHROPIC_API_KEY: "sk-ant" }, { provider: "anthropic" }).OPENAI_API_KEY).toBeUndefined();
    // codex run: overlay carries the agent's OWN OPENAI_API_KEY (runner-model-resolution kept it) -> survives
    expect(buildSandboxEnvAllowlist({ OPENAI_API_KEY: "sk-agent-openai" }, { provider: "openai" }).OPENAI_API_KEY).toBe("sk-agent-openai");
  });

  it("also drops the OAuth refresh token / signed bundle strings (only the minted bearer crosses)", () => {
    const out = buildSandboxEnvAllowlist(
      { AOA_MCP_NOTION_TOKEN: "access-bearer", AOA_MCP_NOTION_REFRESH: "refresh-tok", "mcp:oauth:notion": "signed-bundle" },
      { provider: "anthropic" },
    );
    expect(out.AOA_MCP_NOTION_TOKEN).toBe("access-bearer");
    expect(out.AOA_MCP_NOTION_REFRESH).toBeUndefined();   // not on the *_TOKEN allowlist tail
    expect(out["mcp:oauth:notion"]).toBeUndefined();       // invalid env name + not allowed
  });
});
