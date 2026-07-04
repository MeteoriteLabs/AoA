import { describe, expect, it } from "vitest";
import { toolHandlers, toolAllowedActors, TOOL_DEFINITIONS } from "../mcp/tools/index.js";

describe("ask_founder registration", () => {
  it("is registered in toolHandlers", () => {
    expect(typeof toolHandlers["ask_founder"]).toBe("function");
  });

  it("is gated to agent actors only", () => {
    expect(toolAllowedActors["ask_founder"]).toEqual(["agent"]);
  });

  it("has a TOOL_DEFINITIONS entry with a required question and optional options/context", () => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === "ask_founder");
    expect(def).toBeTruthy();
    expect(def!.inputSchema.required).toContain("question");
    expect(def!.inputSchema.properties).toHaveProperty("options");
    expect(def!.inputSchema.properties).toHaveProperty("context");
  });
});
