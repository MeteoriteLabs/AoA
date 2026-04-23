import { describe, expect, it } from "vitest";
import {
  loadDefaultAgentInstructionsBundle,
  resolveDefaultAgentInstructionsBundleRole,
} from "../services/default-agent-instructions.js";

describe("loadDefaultAgentInstructionsBundle", () => {
  it("loads 4-file Director bundle for role=ceo", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("ceo");
    expect(bundle["AGENTS.md"]).toBeDefined();
    expect(bundle["HEARTBEAT.md"]).toBeDefined();
    expect(bundle["SOUL.md"]).toBeDefined();
    expect(bundle["TOOLS.md"]).toBeDefined();
    expect(bundle["AGENTS.md"]).toContain("Director");
    expect(bundle["AGENTS.md"]).toContain("Founder");
  });

  it("loads AGENTS-only bundle for role=default", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("default");
    expect(bundle["AGENTS.md"]).toBeDefined();
    expect(bundle["HEARTBEAT.md"]).toBeUndefined();
    expect(bundle["SOUL.md"]).toBeUndefined();
    expect(bundle["TOOLS.md"]).toBeUndefined();
  });

  it("ported content has no paperclipai repo references in Director AGENTS.md", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("ceo");
    expect(bundle["AGENTS.md"]).not.toMatch(/\bpaperclipai\b/);
  });

  it("ported HEARTBEAT.md uses AOA_* env vars not PAPERCLIP_* env vars", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("ceo");
    expect(bundle["HEARTBEAT.md"]).not.toMatch(/PAPERCLIP_(TASK_ID|WAKE_REASON|WAKE_COMMENT_ID|APPROVAL_ID)/);
    expect(bundle["HEARTBEAT.md"]).toMatch(/AOA_TASK_ID/);
    expect(bundle["HEARTBEAT.md"]).toMatch(/AOA_APPROVAL_ID/);
  });
});

describe("resolveDefaultAgentInstructionsBundleRole", () => {
  it("maps 'ceo' to 'ceo'", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("ceo")).toBe("ceo");
  });

  it("maps any other role to 'default'", () => {
    expect(resolveDefaultAgentInstructionsBundleRole("cto")).toBe("default");
    expect(resolveDefaultAgentInstructionsBundleRole("pm")).toBe("default");
    expect(resolveDefaultAgentInstructionsBundleRole("")).toBe("default");
    expect(resolveDefaultAgentInstructionsBundleRole("unknown")).toBe("default");
  });
});
