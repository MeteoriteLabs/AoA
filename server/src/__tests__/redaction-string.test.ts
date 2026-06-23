import { describe, it, expect } from "vitest";
import { redactSecretsInString } from "../redaction.js";
describe("redactSecretsInString", () => {
  it("strips an OpenAI/Anthropic-style key embedded in free text", () => {
    const out = redactSecretsInString("probe failed: key sk-ant-abc123DEF456ghi789 was rejected");
    expect(out).not.toContain("sk-ant-abc123DEF456ghi789");
    expect(out).toContain("***REDACTED***");
  });
  it("leaves ordinary text untouched", () => {
    expect(redactSecretsInString("Codex hello probe succeeded.")).toBe("Codex hello probe succeeded.");
  });
  it("redacts a whitespace-delimited JWT token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactSecretsInString(`token ${jwt} end`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("***REDACTED***");
  });
});
