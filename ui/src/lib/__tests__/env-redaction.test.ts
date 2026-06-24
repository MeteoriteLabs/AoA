import { describe, it, expect } from "vitest";
import {
  shouldRedactSecretValue,
  redactEnvValue,
  formatEnvForDisplay,
} from "../env-redaction";

describe("shouldRedactSecretValue", () => {
  it("redacts by secret-looking key", () => {
    expect(shouldRedactSecretValue("OPENAI_API_KEY", "x")).toBe(true);
    expect(shouldRedactSecretValue("PASSWORD", "x")).toBe(true);
    expect(shouldRedactSecretValue("PORT", "8080")).toBe(false);
  });
  it("redacts JWT-shaped values regardless of key", () => {
    expect(shouldRedactSecretValue("PLAIN", "aaa.bbb.ccc")).toBe(true);
  });
});

describe("redactEnvValue", () => {
  it("masks secret_ref objects", () => {
    expect(redactEnvValue("ANY", { type: "secret_ref", secretId: "s" })).toBe(
      "***SECRET_REF***",
    );
  });
  it("masks secret keys and passes through plain values", () => {
    expect(redactEnvValue("API_KEY", "abc")).toBe("***REDACTED***");
    expect(redactEnvValue("REGION", "us-east-1")).toBe("us-east-1");
  });
});

describe("formatEnvForDisplay", () => {
  it("sorts keys and redacts", () => {
    expect(formatEnvForDisplay({ REGION: "us", API_KEY: "z" })).toBe(
      "API_KEY=***REDACTED***\nREGION=us",
    );
  });
  it("handles empty + unparseable", () => {
    expect(formatEnvForDisplay({})).toBe("<empty>");
    expect(formatEnvForDisplay("not-an-object")).toBe("<unable-to-parse>");
  });
});
