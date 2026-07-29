import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCliInvocation, type McpConfigParams } from "../cli-mode.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

function mcpParams(suffix: string): McpConfigParams {
  return {
    companyId: `company-${suffix}`,
    userId: `user-${suffix}`,
    userRole: "founder",
    enabledCapabilities: [],
    bridgeEntrypoint: path.join(os.tmpdir(), "aoa-test-bridge.js"),
  };
}

describe("Commander CLI runtime authentication", () => {
  it("copies Codex subscription auth from the governed CODEX_HOME, not the server-global home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-commander-codex-subscription-"));
    cleanup.push(root);
    const scopedHome = path.join(root, "scoped-codex");
    await fs.mkdir(scopedHome, { recursive: true });
    const expectedAuth = { tokens: { access_token: "scoped-token" } };
    await fs.writeFile(path.join(scopedHome, "auth.json"), JSON.stringify(expectedAuth));

    const invocation = await resolveCliInvocation(
      "codex",
      mcpParams("subscription"),
      "hello",
      null,
      undefined,
      true,
      null,
      undefined,
      undefined,
      { HOME: root, CODEX_HOME: scopedHome },
    );

    expect(invocation?.spawnEnv?.HOME).toBe(root);
    expect(invocation?.spawnEnv?.CODEX_HOME).not.toBe(scopedHome);
    cleanup.push(invocation!.spawnEnv!.CODEX_HOME);
    await expect(
      fs.readFile(path.join(invocation!.spawnEnv!.CODEX_HOME, "auth.json"), "utf8"),
    ).resolves.toBe(JSON.stringify(expectedAuth));
  });

  it("materializes a saved OpenAI API key into the managed Commander Codex home", async () => {
    const invocation = await resolveCliInvocation(
      "codex",
      mcpParams("api-key"),
      "hello",
      null,
      undefined,
      true,
      null,
      undefined,
      undefined,
      { OPENAI_API_KEY: "sk-company-key" },
    );

    const auth = JSON.parse(
      await fs.readFile(path.join(invocation!.spawnEnv!.CODEX_HOME, "auth.json"), "utf8"),
    );
    cleanup.push(invocation!.spawnEnv!.CODEX_HOME);
    expect(auth).toEqual({ OPENAI_API_KEY: "sk-company-key" });
    expect(invocation?.spawnEnv?.OPENAI_API_KEY).toBeUndefined();
  });

  it("keeps HTTP MCP but rejects same-user stdio MCP in a credential-bearing Codex home", async () => {
    const params = mcpParams("codex-mcp-isolation");
    params.extraMcpServers = {
      docs: {
        kind: "http",
        url: "https://docs.example.com/mcp",
        headers: {},
      },
      untrusted: {
        kind: "stdio",
        command: "node",
        args: ["connector.js"],
        env: {},
      },
    };
    const invocation = await resolveCliInvocation(
      "codex",
      params,
      "hello",
      null,
      undefined,
      true,
      null,
      undefined,
      undefined,
      { OPENAI_API_KEY: "sk-company-key" },
    );
    cleanup.push(invocation!.spawnEnv!.CODEX_HOME);

    const config = await fs.readFile(
      path.join(invocation!.spawnEnv!.CODEX_HOME, "config.toml"),
      "utf8",
    );
    expect(config).toContain("[mcp_servers.aoa]");
    expect(config).toContain("[mcp_servers.docs]");
    expect(config).not.toContain("[mcp_servers.untrusted]");
  });

  it("fails closed and removes stale Codex auth when governed evidence disappears", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "aoa-commander-codex-missing-"),
    );
    cleanup.push(root);
    const scopedHome = path.join(root, "scoped-codex");
    await fs.mkdir(scopedHome, { recursive: true });
    await fs.writeFile(
      path.join(scopedHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "first-token" } }),
    );
    const params = mcpParams("missing-evidence");

    const first = await resolveCliInvocation(
      "codex",
      params,
      "hello",
      null,
      undefined,
      true,
      null,
      undefined,
      undefined,
      { CODEX_HOME: scopedHome },
    );
    const managedHome = first!.spawnEnv!.CODEX_HOME;
    cleanup.push(managedHome);
    await fs.rm(path.join(scopedHome, "auth.json"));

    await expect(
      resolveCliInvocation(
        "codex",
        params,
        "hello again",
        null,
        undefined,
        true,
        null,
        undefined,
        undefined,
        { CODEX_HOME: scopedHome },
      ),
    ).rejects.toThrow("Governed Codex credential evidence is missing");
    await expect(fs.stat(path.join(managedHome, "auth.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("passes governed Claude subscription and API-key variables to the CLI invocation", async () => {
    const invocation = await resolveCliInvocation(
      "claude_cli",
      mcpParams("claude"),
      "hello",
      null,
      undefined,
      true,
      null,
      "hello",
      null,
      {
        HOME: "/aoa/company/owner",
        CLAUDE_CONFIG_DIR: "/aoa/company/owner/claude",
        ANTHROPIC_API_KEY: "sk-ant-company",
      },
    );

    expect(invocation?.spawnEnv).toMatchObject({
      HOME: "/aoa/company/owner",
      CLAUDE_CONFIG_DIR: "/aoa/company/owner/claude",
      ANTHROPIC_API_KEY: "sk-ant-company",
    });
  });

  it("masks parent provider credentials from Claude stdio MCP children", async () => {
    const params = mcpParams("claude-stdio-mask");
    params.extraMcpServers = {
      untrusted: {
        kind: "stdio",
        command: "node",
        args: ["connector.js"],
        env: {},
      },
      ownAnthropicCredential: {
        kind: "stdio",
        command: "node",
        args: ["owned-connector.js"],
        env: {
          ANTHROPIC_API_KEY: "${AOA_MCP_OWN_TOKEN}",
        },
      },
    };
    const invocation = await resolveCliInvocation(
      "claude_cli",
      params,
      "hello",
      null,
      undefined,
      true,
      null,
      "hello",
      null,
      {
        ANTHROPIC_API_KEY: "sk-ant-company",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-company",
      },
    );
    cleanup.push(invocation!.mcpArtifactPath);
    const config = JSON.parse(
      await fs.readFile(invocation!.mcpArtifactPath, "utf8"),
    );

    expect(invocation?.spawnEnv?.ANTHROPIC_API_KEY).toBe("sk-ant-company");
    expect(config.mcpServers.untrusted.env).toMatchObject({
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      OPENAI_API_KEY: "",
    });
    expect(
      config.mcpServers.ownAnthropicCredential.env.ANTHROPIC_API_KEY,
    ).toBe("${AOA_MCP_OWN_TOKEN}");
  });
});
