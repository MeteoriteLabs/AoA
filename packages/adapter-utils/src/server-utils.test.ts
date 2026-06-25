import { describe, it, expect } from "vitest";
import { mergeChildEnv } from "./server-utils.js";

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
});
