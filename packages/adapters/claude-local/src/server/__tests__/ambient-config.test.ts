import { describe, expect, it } from "vitest";
import { mergeChildEnv } from "@armyofagents/adapter-utils/server-utils";
import {
  CLAUDE_AMBIENT_CONFIG_KEEP_KEYS,
  CLAUDE_AMBIENT_CONFIG_UNSET_PREFIXES,
} from "../ambient-config.js";

/**
 * The strip list itself. `mergeChildEnv`'s prefix semantics are proven in
 * adapter-utils; what is proven HERE is that THIS list strips the host Claude
 * config class and — the part that would break real work if it regressed —
 * leaves the keep-list alone.
 */
describe("claude ambient-config strip list", () => {
  const prefixes = [...CLAUDE_AMBIENT_CONFIG_UNSET_PREFIXES];

  it("names exactly the CLAUDE_/ANTHROPIC_ host-config classes", () => {
    expect(prefixes).toEqual(["CLAUDE_", "ANTHROPIC_"]);
  });

  it("strips ambient Claude/Anthropic config a crew run must not inherit", () => {
    const out = mergeChildEnv(
      {
        CLAUDE_CONFIG_DIR: "/home/operator/.claude",
        CLAUDE_CODE_USE_BEDROCK: "1",
        // Not enumerated anywhere — the reason this is a PREFIX class.
        CLAUDE_SOME_FUTURE_KNOB: "on",
        ANTHROPIC_API_KEY: "sk-ant-server",
        ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.example",
      },
      {},
      undefined,
      prefixes,
    );
    expect(Object.keys(out)).toEqual([]);
  });

  // 🚨 git, SSH and npm all resolve through HOME/USERPROFILE for tools the agent
  // launches, and PATH is how the CLI is found at all. Relocating or stripping
  // any of these breaks the agent's real work, not just its config isolation.
  it("leaves every keep-list variable untouched", () => {
    const ambient: Record<string, string> = {};
    for (const key of CLAUDE_AMBIENT_CONFIG_KEEP_KEYS) ambient[key] = `value-of-${key}`;
    const out = mergeChildEnv(ambient, {}, undefined, prefixes);
    for (const key of CLAUDE_AMBIENT_CONFIG_KEEP_KEYS) {
      expect(out[key], `${key} must survive the ambient-config strip`).toBe(`value-of-${key}`);
    }
  });

  it("keeps PATH, HOME and USERPROFILE on the keep-list", () => {
    expect(CLAUDE_AMBIENT_CONFIG_KEEP_KEYS).toEqual(
      expect.arrayContaining(["PATH", "HOME", "USERPROFILE"]),
    );
  });
});
