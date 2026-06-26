import { describe, it, expect } from "vitest";
import { mergeChildEnv } from "./server-utils.js";

// mergeChildEnv reads process.platform at call time; stub it so both the
// case-insensitive (Windows) and case-sensitive (POSIX) branches are covered
// deterministically on any CI runner.
function withPlatform(platform: NodeJS.Platform, fn: () => void) {
  const orig = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", orig);
  }
}

describe("mergeChildEnv — unsetEnvKeys escape hatch", () => {
  it("strips an inherited key the overlay did not set", () => {
    const out = mergeChildEnv({ OPENAI_API_KEY: "sk-server", PATH: "/usr/bin" }, {}, ["OPENAI_API_KEY"]);
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
  });
  it("keeps an overlay-set key (agent's own key wins)", () => {
    const out = mergeChildEnv({ OPENAI_API_KEY: "sk-server" }, { OPENAI_API_KEY: "sk-agent" }, ["OPENAI_API_KEY"]);
    expect(out.OPENAI_API_KEY).toBe("sk-agent");
  });
  it("an explicit empty overlay value suppresses the inherited key (overlay wins)", () => {
    const out = mergeChildEnv({ OPENAI_API_KEY: "sk-server" }, { OPENAI_API_KEY: "" }, ["OPENAI_API_KEY"]);
    expect(out.OPENAI_API_KEY).toBe("");
  });
  it("is a no-op without unsetEnvKeys (today's behavior)", () => {
    const out = mergeChildEnv({ OPENAI_API_KEY: "sk-server", PATH: "/b" }, { FOO: "bar" });
    expect(out.OPENAI_API_KEY).toBe("sk-server");
    expect(out.FOO).toBe("bar");
  });

  // Codex P2: Windows env var names are case-insensitive — a differently-cased
  // ambient key must still be stripped, else the codex child inherits the server
  // key despite unsetEnvKeys.
  it("strips a differently-cased inherited key on Windows (case-insensitive env)", () => {
    withPlatform("win32", () => {
      const out = mergeChildEnv({ OpenAI_API_KEY: "sk-server", PATH: "/b" }, {}, ["OPENAI_API_KEY"]);
      expect(out.OpenAI_API_KEY).toBeUndefined();
      expect(out.PATH).toBe("/b");
    });
  });
  it("keeps a differently-cased overlay key on Windows (agent's own key wins, case-insensitive)", () => {
    withPlatform("win32", () => {
      const out = mergeChildEnv({ OPENAI_API_KEY: "sk-server" }, { OpenAI_API_KEY: "sk-agent" }, ["OPENAI_API_KEY"]);
      // The overlay set the key (any casing) → not stripped; the ambient one is gone.
      expect(out.OpenAI_API_KEY).toBe("sk-agent");
      expect(out.OPENAI_API_KEY).toBeUndefined();
    });
  });
  it("does NOT strip a differently-cased var on POSIX (case-sensitive env — distinct var)", () => {
    withPlatform("linux", () => {
      const out = mergeChildEnv({ OpenAI_API_KEY: "sk-other", OPENAI_API_KEY: "sk-server" }, {}, ["OPENAI_API_KEY"]);
      expect(out.OPENAI_API_KEY).toBeUndefined(); // exact-cased strip
      expect(out.OpenAI_API_KEY).toBe("sk-other"); // legitimately distinct var preserved
    });
  });
});
