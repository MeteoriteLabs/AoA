import { describe, it, expect } from "vitest";
import { classifyCommanderProbe, cliToolToAdapterType } from "../services/commander-verify.js";
import type { AdapterEnvironmentTestResult } from "@armyofagents/shared";

describe("cliToolToAdapterType", () => {
  it("maps commander cliTools to adapter types", () => {
    expect(cliToolToAdapterType("claude_cli")).toBe("claude_local");
    expect(cliToolToAdapterType("codex")).toBe("codex_local");
    expect(cliToolToAdapterType("opencode")).toBe("opencode_local");
  });
  it("defaults to claude_local (Commander default)", () => {
    expect(cliToolToAdapterType(null)).toBe("claude_local");
    expect(cliToolToAdapterType(undefined)).toBe("claude_local");
    expect(cliToolToAdapterType("weird")).toBe("claude_local");
  });
});

const R = (
  checks: { code: string; level: "info" | "warn" | "error"; message?: string }[],
  status: "pass" | "warn" | "fail",
): AdapterEnvironmentTestResult => ({
  adapterType: "claude_local",
  status,
  checks: checks.map((c) => ({ ...c, message: c.message ?? c.code })),
  testedAt: "",
});

describe("classifyCommanderProbe", () => {
  it("verified on pass", () => {
    expect(classifyCommanderProbe(R([{ code: "claude_hello_probe_passed", level: "info" }], "pass")).outcome).toBe(
      "verified",
    );
  });
  it("needs_auth when login required", () => {
    expect(
      classifyCommanderProbe(R([{ code: "claude_hello_probe_auth_required", level: "warn" }], "fail")).outcome,
    ).toBe("needs_auth");
  });
  it("not_installed when command unresolvable", () => {
    expect(
      classifyCommanderProbe(R([{ code: "claude_command_unresolvable", level: "error" }], "fail")).outcome,
    ).toBe("not_installed");
  });
  it("failed on other hard errors", () => {
    expect(classifyCommanderProbe(R([{ code: "claude_hello_probe_failed", level: "error" }], "fail")).outcome).toBe(
      "failed",
    );
  });
  it("treats a cosmetic warn (no auth/install signal) as verified — not hard-blocked", () => {
    expect(classifyCommanderProbe(R([{ code: "claude_version_mismatch", level: "warn" }], "warn")).outcome).toBe(
      "verified",
    );
  });
});
