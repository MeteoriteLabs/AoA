import { describe, expect, it, vi } from "vitest";

const spawnArgs: any[] = [];
vi.mock("node:child_process", () => ({
  spawn: vi.fn((bin: string, args: string[]) => {
    spawnArgs.push({ bin, args });
    return {
      stdin: { write() {}, end() {} },
      stdout: {
        on(ev: string, cb: any) {
          if (ev === "data") cb(Buffer.from("SUMMARY TEXT"));
        },
      },
      stderr: { on() {} },
      on(ev: string, cb: any) {
        if (ev === "close") cb(0);
      },
    };
  }),
}));

import { summarizeViaCli } from "../services/internal-agent/cli-summarizer.js";

describe("summarizeViaCli", () => {
  it("returns the model output and never attaches the MCP bridge", async () => {
    const out = await summarizeViaCli({
      cliTool: "claude_cli",
      cheapModel: "claude-haiku-4-5",
      transcript: "user: hi\nassistant: yo",
    });
    expect(out).toBe("SUMMARY TEXT");
    const a = spawnArgs[0].args.join(" ");
    expect(a).not.toContain("--mcp-config");
    expect(a).not.toContain("mcp");
  });
});
