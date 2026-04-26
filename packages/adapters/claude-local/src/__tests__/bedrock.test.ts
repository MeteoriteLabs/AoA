import { describe, it, expect } from "vitest";
import { isBedrockAuth, resolveClaudeBillingType } from "../server/execute.js";

describe("isBedrockAuth", () => {
  it("detects CLAUDE_CODE_USE_BEDROCK=1", () => {
    expect(isBedrockAuth({ CLAUDE_CODE_USE_BEDROCK: "1" })).toBe(true);
  });

  it("detects CLAUDE_CODE_USE_BEDROCK=true", () => {
    expect(isBedrockAuth({ CLAUDE_CODE_USE_BEDROCK: "true" })).toBe(true);
  });

  it("detects ANTHROPIC_BEDROCK_BASE_URL", () => {
    expect(
      isBedrockAuth({ ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.us-east-1.amazonaws.com" }),
    ).toBe(true);
  });

  it("returns false for empty env", () => {
    expect(isBedrockAuth({})).toBe(false);
  });

  it("returns false for empty ANTHROPIC_BEDROCK_BASE_URL", () => {
    expect(isBedrockAuth({ ANTHROPIC_BEDROCK_BASE_URL: "" })).toBe(false);
  });

  it("returns false for CLAUDE_CODE_USE_BEDROCK=0", () => {
    expect(isBedrockAuth({ CLAUDE_CODE_USE_BEDROCK: "0" })).toBe(false);
  });

  it("returns false for CLAUDE_CODE_USE_BEDROCK=false", () => {
    expect(isBedrockAuth({ CLAUDE_CODE_USE_BEDROCK: "false" })).toBe(false);
  });
});

describe("resolveClaudeBillingType", () => {
  it("returns metered_api when CLAUDE_CODE_USE_BEDROCK=1", () => {
    expect(resolveClaudeBillingType({ CLAUDE_CODE_USE_BEDROCK: "1" })).toBe("metered_api");
  });

  it("returns metered_api when CLAUDE_CODE_USE_BEDROCK=true", () => {
    expect(resolveClaudeBillingType({ CLAUDE_CODE_USE_BEDROCK: "true" })).toBe("metered_api");
  });

  it("returns metered_api when ANTHROPIC_BEDROCK_BASE_URL is set", () => {
    expect(
      resolveClaudeBillingType({
        ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.us-east-1.amazonaws.com",
      }),
    ).toBe("metered_api");
  });

  it("returns api when ANTHROPIC_API_KEY is set (no Bedrock)", () => {
    expect(resolveClaudeBillingType({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe("api");
  });

  it("returns subscription when neither Bedrock nor API key is set", () => {
    expect(resolveClaudeBillingType({})).toBe("subscription");
  });

  it("Bedrock takes priority over ANTHROPIC_API_KEY when both set", () => {
    expect(
      resolveClaudeBillingType({
        CLAUDE_CODE_USE_BEDROCK: "1",
        ANTHROPIC_API_KEY: "sk-ant-test",
      }),
    ).toBe("metered_api");
  });
});
